/* eslint-disable @typescript-eslint/no-explicit-any */
import { eq, inArray, isNull, and } from 'drizzle-orm';
import type { EntityType } from '@homestead/shared';
import type { DB } from '../db/index.js';
import * as s from '../db/schema.js';
import { badRequest } from './errors.js';

export interface EntityDef {
  table: any;
  /** Column holding a human label, used by search, links and pickers. */
  labelColumn: string;
  /** Where the web client shows this entity. */
  route: (id: string) => string;
  searchable: boolean;
  icon: string;
}

/** The single source of truth for which polymorphic types exist (INT-001). */
export const ENTITIES: Record<EntityType, EntityDef> = {
  property: { table: s.properties, labelColumn: 'name', route: (id) => `/home/property/${id}`, searchable: true, icon: 'home' },
  location: { table: s.locations, labelColumn: 'name', route: (id) => `/storage/location/${id}`, searchable: true, icon: 'box' },
  asset: { table: s.assets, labelColumn: 'name', route: (id) => `/assets/${id}`, searchable: true, icon: 'cpu' },
  task: { table: s.tasks, labelColumn: 'title', route: (id) => `/tasks/${id}`, searchable: true, icon: 'check' },
  schedule: { table: s.schedules, labelColumn: 'originType', route: (id) => `/tasks?schedule=${id}`, searchable: false, icon: 'repeat' },
  maintenance_plan: { table: s.maintenancePlans, labelColumn: 'title', route: (id) => `/maintenance/plan/${id}`, searchable: true, icon: 'wrench' },
  maintenance_record: { table: s.maintenanceRecords, labelColumn: 'title', route: (id) => `/maintenance/record/${id}`, searchable: true, icon: 'wrench' },
  project: { table: s.projects, labelColumn: 'name', route: (id) => `/projects/${id}`, searchable: true, icon: 'hammer' },
  project_phase: { table: s.projectPhases, labelColumn: 'name', route: (id) => `/projects?phase=${id}`, searchable: false, icon: 'hammer' },
  project_material: { table: s.projectMaterials, labelColumn: 'description', route: (id) => `/projects?material=${id}`, searchable: true, icon: 'hammer' },
  quote: { table: s.quotes, labelColumn: 'scope', route: (id) => `/projects?quote=${id}`, searchable: true, icon: 'file' },
  permit: { table: s.permits, labelColumn: 'name', route: (id) => `/projects?permit=${id}`, searchable: true, icon: 'file' },
  transaction: { table: s.transactions, labelColumn: 'memo', route: (id) => `/budget/transactions/${id}`, searchable: true, icon: 'coin' },
  account: { table: s.accounts, labelColumn: 'name', route: (id) => `/budget/accounts/${id}`, searchable: true, icon: 'bank' },
  category: { table: s.categories, labelColumn: 'name', route: (id) => `/budget/categories/${id}`, searchable: true, icon: 'tag' },
  budget_period: { table: s.budgetAllocations, labelColumn: 'period', route: (id) => `/budget?allocation=${id}`, searchable: false, icon: 'chart' },
  recurring_bill: { table: s.recurringBills, labelColumn: 'name', route: (id) => `/budget/bills/${id}`, searchable: true, icon: 'coin' },
  goal: { table: s.goals, labelColumn: 'name', route: (id) => `/budget/goals/${id}`, searchable: true, icon: 'target' },
  product: { table: s.products, labelColumn: 'name', route: (id) => `/food/products/${id}`, searchable: true, icon: 'can' },
  stock_item: { table: s.stockItems, labelColumn: 'note', route: (id) => `/food/stock/${id}`, searchable: false, icon: 'can' },
  shopping_list: { table: s.shoppingLists, labelColumn: 'name', route: (id) => `/food/lists/${id}`, searchable: true, icon: 'cart' },
  recipe: { table: s.recipes, labelColumn: 'name', route: (id) => `/food/recipes/${id}`, searchable: true, icon: 'book' },
  storage_item: { table: s.storageItems, labelColumn: 'name', route: (id) => `/storage/items/${id}`, searchable: true, icon: 'box' },
  loan: { table: s.loans, labelColumn: 'contactName', route: (id) => `/storage/loans/${id}`, searchable: false, icon: 'handshake' },
  tool_kit: { table: s.toolKits, labelColumn: 'name', route: (id) => `/tools/kits/${id}`, searchable: true, icon: 'toolbox' },
  battery_platform: { table: s.batteryPlatforms, labelColumn: 'name', route: (id) => `/tools/platforms/${id}`, searchable: true, icon: 'battery' },
  pet: { table: s.pets, labelColumn: 'name', route: (id) => `/pets/${id}`, searchable: true, icon: 'paw' },
  pet_visit: { table: s.petVisits, labelColumn: 'reason', route: (id) => `/pets?visit=${id}`, searchable: true, icon: 'stethoscope' },
  pet_medication: { table: s.petMedications, labelColumn: 'name', route: (id) => `/pets?medication=${id}`, searchable: true, icon: 'pill' },
  pet_condition: { table: s.petConditions, labelColumn: 'name', route: (id) => `/pets?condition=${id}`, searchable: true, icon: 'heart' },
  contact: { table: s.contacts, labelColumn: 'name', route: (id) => `/contacts/${id}`, searchable: true, icon: 'user' },
  file: { table: s.files, labelColumn: 'originalName', route: (id) => `/documents/${id}`, searchable: true, icon: 'file' },
  user: { table: s.users, labelColumn: 'displayName', route: (id) => `/settings/members/${id}`, searchable: false, icon: 'user' },
};

export function entityDef(type: string): EntityDef {
  const def = ENTITIES[type as EntityType];
  if (!def) throw badRequest(`Unknown entity type: ${type}`);
  return def;
}

export function isEntityType(t: string): t is EntityType {
  return t in ENTITIES;
}

/** Resolve display labels for a batch of refs in one query per type. */
export async function resolveLabels(
  db: DB, refs: Array<{ type: string; id: string }>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const byType = new Map<string, string[]>();
  for (const r of refs) {
    if (!isEntityType(r.type)) continue;
    const list = byType.get(r.type) ?? [];
    list.push(r.id);
    byType.set(r.type, list);
  }
  for (const [type, ids] of byType) {
    const def = ENTITIES[type as EntityType];
    const cols = def.table as unknown as Record<string, any>;
    const rows = await db.select({ id: cols.id, label: cols[def.labelColumn] ?? cols.id })
      .from(def.table).where(inArray(cols.id, [...new Set(ids)]));
    for (const row of rows as Array<{ id: string; label: string | null }>) {
      out.set(`${type}:${row.id}`, row.label || `(untitled ${type.replace(/_/g, ' ')})`);
    }
  }
  return out;
}

export async function entityExists(db: DB, type: string, id: string): Promise<boolean> {
  const def = entityDef(type);
  const cols = def.table as unknown as Record<string, any>;
  const where = 'deletedAt' in cols ? and(eq(cols.id, id), isNull(cols.deletedAt)) : eq(cols.id, id);
  const rows = await db.select({ id: cols.id }).from(def.table).where(where).limit(1);
  return rows.length > 0;
}

export async function assertEntity(db: DB, type: string, id: string): Promise<void> {
  if (!(await entityExists(db, type, id))) {
    throw badRequest(`No such ${type}: ${id}`);
  }
}
