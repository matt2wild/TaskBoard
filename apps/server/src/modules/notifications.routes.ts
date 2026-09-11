import type { FastifyInstance } from 'fastify';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { NOTIFICATION_CHANNELS, NOTIFICATION_EVENTS, NOTIFICATION_TIMING } from '@homestead/shared';
import { notificationDeliveries, notificationPrefs, notifications } from '../db/schema.js';
import { requireAdmin, requireWrite } from '../core/auth.js';
import { flushDeliveries, markRead, unreadCount } from '../services/notify.js';

export function notificationRoutes(app: FastifyInstance): void {
  app.get('/api/v1/notifications', async (req) => {
    const q = z.object({
      unread: z.coerce.boolean().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }).parse(req.query);
    const where = [eq(notifications.userId, req.ctx.user!.id)];
    if (q.unread) where.push(isNull(notifications.readAt));
    const rows = await req.ctx.db.select().from(notifications).where(and(...where))
      .orderBy(desc(notifications.createdAt)).limit(q.limit);
    return { items: rows, unread: await unreadCount(req.ctx, req.ctx.user!.id) };
  });

  app.post('/api/v1/notifications/read', async (req) => {
    requireWrite(req.ctx.user);
    const body = z.object({ ids: z.array(z.string()).optional() }).parse(req.body ?? {});
    const n = await markRead(req.ctx, req.ctx.user!.id, body.ids);
    return { marked: n, unread: await unreadCount(req.ctx, req.ctx.user!.id) };
  });

  app.get('/api/v1/notifications/preferences', async (req) => {
    const rows = await req.ctx.db.select().from(notificationPrefs)
      .where(eq(notificationPrefs.userId, req.ctx.user!.id));
    const byEvent = new Map(rows.map((r) => [r.eventType, r]));
    return {
      items: NOTIFICATION_EVENTS.map((eventType) => {
        const pref = byEvent.get(eventType);
        return {
          eventType,
          channels: pref?.channels ?? ['inapp'],
          timing: pref?.timing ?? 'immediate',
          leadDays: pref?.leadDays ?? null,
        };
      }),
      channels: NOTIFICATION_CHANNELS,
    };
  });

  app.put('/api/v1/notifications/preferences', async (req) => {
    requireWrite(req.ctx.user);
    const body = z.object({
      items: z.array(z.object({
        eventType: z.enum(NOTIFICATION_EVENTS),
        channels: z.array(z.enum(NOTIFICATION_CHANNELS)),
        timing: z.enum(NOTIFICATION_TIMING).default('immediate'),
        leadDays: z.array(z.number().int().min(0).max(365)).nullable().optional(),
      })),
    }).parse(req.body);
    for (const item of body.items) {
      await req.ctx.db.insert(notificationPrefs).values({
        userId: req.ctx.user!.id, eventType: item.eventType,
        channels: item.channels, timing: item.timing, leadDays: item.leadDays ?? null,
      }).onConflictDoUpdate({
        target: [notificationPrefs.userId, notificationPrefs.eventType],
        set: { channels: item.channels, timing: item.timing, leadDays: item.leadDays ?? null },
      });
    }
    return { updated: body.items.length };
  });

  /** The delivery log: a reminder that silently failed is a bug, so show it. */
  app.get('/api/v1/notifications/deliveries', async (req) => {
    requireAdmin(req.ctx.user);
    const q = z.object({
      status: z.enum(['pending', 'delivered', 'failed']).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }).parse(req.query);
    const where = q.status ? [eq(notificationDeliveries.status, q.status)] : [];
    const rows = await req.ctx.db.select({ d: notificationDeliveries, n: notifications })
      .from(notificationDeliveries)
      .innerJoin(notifications, eq(notifications.id, notificationDeliveries.notificationId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(notificationDeliveries.createdAt)).limit(q.limit);
    return { items: rows.map((r) => ({ ...r.d, title: r.n.title, eventType: r.n.eventType })) };
  });

  app.post('/api/v1/notifications/flush', async (req) => {
    requireAdmin(req.ctx.user);
    return flushDeliveries(req.ctx, 200);
  });

  app.post('/api/v1/notifications/test', async (req) => {
    requireAdmin(req.ctx.user);
    const body = z.object({ channel: z.enum(NOTIFICATION_CHANNELS).default('inapp') }).parse(req.body ?? {});
    const { notify } = await import('../services/notify.js');
    await notify(req.ctx, {
      eventType: 'digest.daily',
      title: 'Homestead test notification',
      body: 'If you can read this, notifications are working.',
      dedupeKey: `test:${Date.now()}`,
      userIds: [req.ctx.user!.id],
    });
    await req.ctx.db.update(notificationDeliveries).set({ channel: body.channel, status: 'pending' })
      .where(eq(notificationDeliveries.notificationId,
        (await req.ctx.db.select({ id: notifications.id }).from(notifications)
          .where(eq(notifications.userId, req.ctx.user!.id))
          .orderBy(desc(notifications.createdAt)).limit(1))[0]!.id));
    return flushDeliveries(req.ctx, 5);
  });
}
