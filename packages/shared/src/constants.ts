/** Vocabularies shared by the server and the web client. The server validates
 *  against these; the client renders labels from them. One source of truth. */

export const ROLES = ['admin', 'member', 'limited', 'readonly'] as const;
export type Role = typeof ROLES[number];
/** Higher wins. Used for "at least member" style checks. */
export const ROLE_RANK: Record<Role, number> = { readonly: 1, limited: 1, member: 2, admin: 3 };

export const ENTITY_TYPES = [
  'property', 'location', 'asset', 'task', 'schedule', 'maintenance_plan', 'maintenance_record',
  'project', 'project_phase', 'project_material', 'quote', 'permit',
  'transaction', 'account', 'category', 'budget_period', 'recurring_bill', 'goal',
  'product', 'stock_item', 'shopping_list', 'recipe',
  'storage_item', 'loan', 'tool_kit', 'battery_platform',
  'pet', 'pet_visit', 'pet_medication', 'pet_condition',
  'contact', 'file', 'user',
] as const;
export type EntityType = typeof ENTITY_TYPES[number];

/** Entities a transaction split may be attributed to: "what was this money for?" */
export const ATTRIBUTABLE = [
  'asset', 'project', 'pet', 'location', 'property', 'maintenance_record',
  'product', 'storage_item', 'goal', 'task',
] as const;

/** Kinds of measure the shared attribution ledger carries (INT-007). */
export const MEASURE_KINDS = ['split', 'activity'] as const;
export type MeasureKind = typeof MEASURE_KINDS[number];
export type AttributableType = typeof ATTRIBUTABLE[number];

export const TASK_STATUS = ['open', 'in_progress', 'blocked', 'done', 'cancelled'] as const;
export type TaskStatus = typeof TASK_STATUS[number];
export const OPEN_TASK_STATUS: readonly TaskStatus[] = ['open', 'in_progress', 'blocked'];

export const PRIORITY = ['low', 'normal', 'high', 'urgent'] as const;
export type Priority = typeof PRIORITY[number];
export const PRIORITY_RANK: Record<Priority, number> = { low: 0, normal: 1, high: 2, urgent: 3 };

export const TASK_ORIGIN = [
  'manual', 'maintenance', 'project', 'pet_medication', 'pet_appointment',
  'bill', 'shopping', 'loan_return', 'automation',
] as const;
export type TaskOrigin = typeof TASK_ORIGIN[number];

export const LOCATION_TYPES = [
  'building', 'floor', 'room', 'zone', 'container', 'shelf', 'exterior', 'vehicle',
] as const;
export type LocationType = typeof LOCATION_TYPES[number];

export const TEMPERATURE_CLASSES = ['ambient', 'refrigerated', 'frozen'] as const;
export type TemperatureClass = typeof TEMPERATURE_CLASSES[number];

export const ASSET_CONDITION = ['new', 'good', 'fair', 'poor', 'failed', 'retired'] as const;
export const ASSET_STATUS = ['active', 'in_storage', 'retired', 'disposed'] as const;

export const TOOL_STATUS = ['available', 'in_use', 'loaned_out', 'needs_repair', 'retired'] as const;
export const TOOL_TYPES = [
  'hand', 'power_corded', 'power_battery', 'pneumatic', 'garden', 'measuring', 'safety', 'access', 'other',
] as const;

export const PROJECT_STATUS = [
  'idea', 'planning', 'approved', 'in_progress', 'on_hold', 'complete', 'cancelled',
] as const;
export type ProjectStatus = typeof PROJECT_STATUS[number];
export const ACTIVE_PROJECT_STATUS: readonly ProjectStatus[] = ['planning', 'approved', 'in_progress'];

export const MATERIAL_STATUS = ['needed', 'ordered', 'received', 'installed', 'returned'] as const;
export const QUOTE_STATUS = ['requested', 'received', 'accepted', 'rejected', 'expired'] as const;
export const PERMIT_STATUS = ['not_required', 'applied', 'issued', 'expired', 'closed'] as const;

export const PROJECT_COST_BUCKETS = [
  'materials', 'labour', 'permits', 'tools', 'disposal', 'contingency', 'other',
] as const;

export const TRANSACTION_TYPES = ['expense', 'income', 'transfer'] as const;
export type TransactionType = typeof TRANSACTION_TYPES[number];

export const ACCOUNT_TYPES = ['checking', 'savings', 'credit', 'cash', 'other'] as const;
export const ROLLOVER_RULES = ['none', 'carry_positive', 'carry_all'] as const;

export const STOCK_REASONS = ['add', 'consume', 'waste', 'adjust', 'audit', 'transfer'] as const;
export type StockReason = typeof STOCK_REASONS[number];

export const WASTE_REASONS = ['expired', 'spoiled', 'disliked', 'excess', 'damaged', 'other'] as const;

export const MAINTENANCE_KINDS = ['planned', 'adhoc', 'repair', 'inspection'] as const;

export const LOAN_DIRECTIONS = ['out', 'in'] as const;

export const PET_STATUS = ['active', 'deceased', 'rehomed'] as const;
export const DOSE_STATUS = ['due', 'given', 'missed', 'skipped'] as const;
export const JOURNAL_SEVERITY = ['info', 'mild', 'moderate', 'severe', 'emergency'] as const;

export const CONTACT_TYPES = [
  'contractor', 'vendor', 'vet', 'service_provider', 'person', 'insurer', 'utility', 'authority',
] as const;

export const DOC_TYPES = [
  'manual', 'receipt', 'warranty', 'invoice', 'quote', 'contract', 'permit',
  'certificate', 'photo', 'plan', 'lab_result', 'other',
] as const;
export type DocType = typeof DOC_TYPES[number];

export const NOTIFICATION_EVENTS = [
  'task.due', 'task.overdue', 'maintenance.due', 'warranty.expiring', 'bill.due',
  'budget.threshold', 'project.budget_threshold', 'carbon.threshold', 'food.expiring', 'stock.low',
  'pet.dose_due', 'pet.dose_missed', 'pet.vaccination_due', 'pet.refill_low',
  'loan.return_due', 'comment.mention', 'digest.daily', 'digest.weekly',
] as const;
export type NotificationEvent = typeof NOTIFICATION_EVENTS[number];

export const NOTIFICATION_CHANNELS = ['inapp', 'email', 'webpush', 'ntfy', 'gotify', 'webhook'] as const;
export type NotificationChannel = typeof NOTIFICATION_CHANNELS[number];

export const NOTIFICATION_TIMING = ['immediate', 'daily_digest', 'weekly_digest', 'off'] as const;

export const VISIBILITY = ['household', 'private'] as const;

export const UNIT_SYSTEMS = ['metric', 'imperial'] as const;

/** Colour tokens the UI maps to a palette; never raw hex in the database. */
export const TAG_COLOURS = [
  'slate', 'red', 'amber', 'green', 'teal', 'blue', 'indigo', 'violet', 'pink', 'stone',
] as const;

export const MODULE_KEYS = [
  'tasks', 'maintenance', 'projects', 'budget', 'carbon', 'food', 'storage', 'tools',
  'pets', 'contacts', 'documents',
] as const;
export type ModuleKey = typeof MODULE_KEYS[number];
