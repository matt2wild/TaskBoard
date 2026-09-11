import type { EntityType } from '@homestead/shared';
import type { DB } from '../db/index.js';
import { activityLog } from '../db/schema.js';

const SKIP = new Set(['updatedAt', 'createdAt', 'updatedBy', 'createdBy']);

export function diffOf(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const k of keys) {
    if (SKIP.has(k)) continue;
    const a = before?.[k]; const b = after?.[k];
    if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) out[k] = { from: a ?? null, to: b ?? null };
  }
  return out;
}

export async function logActivity(
  db: DB,
  args: {
    userId?: string | null; action: 'create' | 'update' | 'delete' | 'restore' | 'complete' | string;
    entityType: EntityType | string; entityId: string; summary?: string;
    before?: Record<string, unknown> | null; after?: Record<string, unknown> | null;
  },
): Promise<void> {
  const diff = args.action === 'update' ? diffOf(args.before ?? null, args.after ?? null) : undefined;
  if (args.action === 'update' && diff && Object.keys(diff).length === 0) return;
  await db.insert(activityLog).values({
    userId: args.userId ?? null,
    action: args.action,
    entityType: args.entityType,
    entityId: args.entityId,
    summary: args.summary,
    diff,
  });
}
