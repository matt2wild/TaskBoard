/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { NotificationChannel, NotificationEvent } from '@homestead/shared';
import { config } from '../config.js';
import type { Ctx } from '../core/ctx.js';
import {
  notificationDeliveries, notificationPrefs, notifications, users,
} from '../db/schema.js';

export interface NotifyInput {
  eventType: NotificationEvent | string;
  title: string;
  body?: string;
  entityType?: string | null;
  entityId?: string | null;
  /** Stable per (event, subject, occasion). The uniqueness guarantee that makes
   *  reminders exactly-once across restarts and retries (DASH-013). */
  dedupeKey: string;
  userIds?: string[];
}

const DEFAULT_CHANNELS: NotificationChannel[] = ['inapp'];

async function channelsFor(ctx: Ctx, userId: string, eventType: string): Promise<{
  channels: NotificationChannel[]; timing: string;
}> {
  const rows = await ctx.db.select().from(notificationPrefs)
    .where(and(eq(notificationPrefs.userId, userId), eq(notificationPrefs.eventType, eventType))).limit(1);
  const pref = rows[0];
  if (!pref) return { channels: DEFAULT_CHANNELS, timing: 'immediate' };
  if (pref.timing === 'off') return { channels: [], timing: 'off' };
  return {
    channels: (pref.channels ?? DEFAULT_CHANNELS) as NotificationChannel[],
    timing: pref.timing,
  };
}

/** Creates the notification and its per-channel delivery rows. Safe to re-run. */
export async function notify(ctx: Ctx, input: NotifyInput): Promise<{ created: number; skipped: number }> {
  const recipients = input.userIds?.length
    ? input.userIds
    : (await ctx.db.select({ id: users.id }).from(users)
      .where(and(eq(users.isActive, true), isNull(users.deletedAt)))).map((u) => u.id);

  let created = 0; let skipped = 0;
  for (const userId of recipients) {
    const { channels, timing } = await channelsFor(ctx, userId, input.eventType);
    if (!channels.length) { skipped++; continue; }
    const [row] = await ctx.db.insert(notifications).values({
      userId, eventType: input.eventType, title: input.title, body: input.body ?? null,
      entityType: input.entityType ?? null, entityId: input.entityId ?? null,
      dedupeKey: input.dedupeKey,
    }).onConflictDoNothing().returning();
    if (!row) { skipped++; continue; } // already sent for this occasion
    created++;
    const wanted = timing === 'immediate' ? channels : channels.filter((c) => c === 'inapp');
    await ctx.db.insert(notificationDeliveries).values(
      wanted.map((channel) => ({
        notificationId: row.id, channel,
        status: channel === 'inapp' ? 'delivered' : 'pending',
        deliveredAt: channel === 'inapp' ? new Date().toISOString() : null,
      })),
    );
  }
  return { created, skipped };
}

interface Deliverable {
  deliveryId: string; channel: string; title: string; body: string | null;
  entityType: string | null; entityId: string | null; attempts: number; email: string;
}

async function pendingDeliveries(ctx: Ctx, limit = 50): Promise<Deliverable[]> {
  const rows = await ctx.db.select({
    d: notificationDeliveries, n: notifications, email: users.email,
  }).from(notificationDeliveries)
    .innerJoin(notifications, eq(notifications.id, notificationDeliveries.notificationId))
    .innerJoin(users, eq(users.id, notifications.userId))
    .where(and(eq(notificationDeliveries.status, 'pending'), lt(notificationDeliveries.attempts, 5)))
    .limit(limit);
  return rows.map((r) => ({
    deliveryId: r.d.id, channel: r.d.channel, title: r.n.title, body: r.n.body,
    entityType: r.n.entityType, entityId: r.n.entityId, attempts: r.d.attempts, email: r.email,
  }));
}

async function send(item: Deliverable): Promise<void> {
  switch (item.channel) {
    case 'email': {
      if (!config.smtp.host) throw new Error('SMTP is not configured');
      const nodemailer = await import('nodemailer');
      const transport = nodemailer.createTransport({
        host: config.smtp.host, port: config.smtp.port, secure: config.smtp.secure,
        auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
      });
      await transport.sendMail({
        from: config.smtp.from, to: item.email, subject: item.title,
        text: [item.body, item.entityId ? `${config.publicUrl}/` : ''].filter(Boolean).join('\n\n'),
      });
      return;
    }
    case 'ntfy': {
      if (!config.ntfy.url || !config.ntfy.topic) throw new Error('ntfy is not configured');
      const res = await fetch(`${config.ntfy.url.replace(/\/$/, '')}/${config.ntfy.topic}`, {
        method: 'POST', body: item.body ?? item.title, headers: { Title: item.title },
      });
      if (!res.ok) throw new Error(`ntfy responded ${res.status}`);
      return;
    }
    case 'gotify': {
      if (!config.gotify.url || !config.gotify.token) throw new Error('Gotify is not configured');
      const res = await fetch(`${config.gotify.url.replace(/\/$/, '')}/message?token=${config.gotify.token}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: item.title, message: item.body ?? '' }),
      });
      if (!res.ok) throw new Error(`Gotify responded ${res.status}`);
      return;
    }
    case 'webhook': {
      if (!config.webhookUrl) throw new Error('No webhook URL configured');
      const res = await fetch(config.webhookUrl, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: item.title, body: item.body,
          entityType: item.entityType, entityId: item.entityId,
        }),
      });
      if (!res.ok) throw new Error(`Webhook responded ${res.status}`);
      return;
    }
    case 'inapp':
      return;
    default:
      throw new Error(`Channel not supported here: ${item.channel}`);
  }
}

/** Drains the delivery queue. Failures back off and are visible to admins. */
export async function flushDeliveries(ctx: Ctx, limit = 50): Promise<{ sent: number; failed: number }> {
  const queue = await pendingDeliveries(ctx, limit);
  let sent = 0; let failed = 0;
  for (const item of queue) {
    try {
      await send(item);
      await ctx.db.update(notificationDeliveries).set({
        status: 'delivered', deliveredAt: new Date().toISOString(),
        attempts: item.attempts + 1, lastError: null,
      }).where(eq(notificationDeliveries.id, item.deliveryId));
      sent++;
    } catch (err) {
      const attempts = item.attempts + 1;
      await ctx.db.update(notificationDeliveries).set({
        status: attempts >= 5 ? 'failed' : 'pending',
        attempts, lastError: (err as Error).message.slice(0, 500),
      }).where(eq(notificationDeliveries.id, item.deliveryId));
      failed++;
    }
  }
  return { sent, failed };
}

export async function unreadCount(ctx: Ctx, userId: string): Promise<number> {
  const rows = await ctx.db.select({ n: sql<number>`count(*)` }).from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return Number(rows[0]?.n ?? 0);
}

export async function markRead(ctx: Ctx, userId: string, ids?: string[]): Promise<number> {
  const where = ids?.length
    ? and(eq(notifications.userId, userId), inArray(notifications.id, ids))
    : and(eq(notifications.userId, userId), isNull(notifications.readAt));
  const res = await ctx.db.update(notifications)
    .set({ readAt: new Date().toISOString() }).where(where).returning({ id: notifications.id });
  return res.length;
}
