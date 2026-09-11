/* eslint-disable @typescript-eslint/no-explicit-any */
import { sqliteTable, text, integer, real, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core';
import { ulid } from 'ulid';

const pk = () => text('id').primaryKey().$defaultFn(() => ulid());
const now = () => new Date().toISOString();

/** Every user-created record carries who/when, and soft deletion (GEN-003/004). */
const audit = {
  createdAt: text('created_at').notNull().$defaultFn(now),
  createdBy: text('created_by'),
  updatedAt: text('updated_at').notNull().$defaultFn(now).$onUpdateFn(now),
  updatedBy: text('updated_by'),
  deletedAt: text('deleted_at'),
};
const json = <T>(name: string) => text(name, { mode: 'json' }).$type<T>();

/* ────────────────────────────── platform ────────────────────────────── */

export const households = sqliteTable('household', {
  id: pk(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull().default('UTC'),
  currency: text('currency').notNull().default('USD'),
  locale: text('locale').notNull().default('en-US'),
  unitSystem: text('unit_system').notNull().default('imperial'),
  settings: json<Record<string, unknown>>('settings'),
  ...audit,
});

export const users = sqliteTable('user', {
  id: pk(),
  email: text('email').notNull(),
  username: text('username').notNull(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash'),
  role: text('role').notNull().default('member'),
  avatarFileId: text('avatar_file_id'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  totpSecret: text('totp_secret'),
  prefs: json<Record<string, unknown>>('prefs'),
  lastLoginAt: text('last_login_at'),
  ...audit,
}, (t) => [uniqueIndex('user_email_uq').on(t.email), uniqueIndex('user_username_uq').on(t.username)]);

export const sessions = sqliteTable('session', {
  id: pk(),
  userId: text('user_id').notNull().references(() => users.id),
  tokenHash: text('token_hash').notNull(),
  expiresAt: text('expires_at').notNull(),
  ip: text('ip'), userAgent: text('user_agent'),
  createdAt: text('created_at').notNull().$defaultFn(now),
  lastSeenAt: text('last_seen_at'),
}, (t) => [uniqueIndex('session_token_uq').on(t.tokenHash), index('session_user_ix').on(t.userId)]);

export const invites = sqliteTable('invite', {
  id: pk(),
  tokenHash: text('token_hash').notNull(),
  role: text('role').notNull().default('member'),
  email: text('email'),
  expiresAt: text('expires_at').notNull(),
  usedByUserId: text('used_by_user_id'),
  usedAt: text('used_at'),
  ...audit,
}, (t) => [uniqueIndex('invite_token_uq').on(t.tokenHash)]);

export const apiTokens = sqliteTable('api_token', {
  id: pk(),
  userId: text('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull(),
  scope: text('scope').notNull().default('read'),
  lastUsedAt: text('last_used_at'),
  expiresAt: text('expires_at'),
  ...audit,
}, (t) => [uniqueIndex('api_token_uq').on(t.tokenHash)]);

export const tags = sqliteTable('tag', {
  id: pk(),
  name: text('name').notNull(),
  colour: text('colour').notNull().default('slate'),
  description: text('description'),
  ...audit,
}, (t) => [uniqueIndex('tag_name_uq').on(t.name)]);

export const entityTags = sqliteTable('entity_tag', {
  tagId: text('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  createdAt: text('created_at').notNull().$defaultFn(now),
}, (t) => [
  primaryKey({ columns: [t.tagId, t.entityType, t.entityId] }),
  index('entity_tag_entity_ix').on(t.entityType, t.entityId),
]);

export const entityLinks = sqliteTable('entity_link', {
  id: pk(),
  fromType: text('from_type').notNull(), fromId: text('from_id').notNull(),
  toType: text('to_type').notNull(), toId: text('to_id').notNull(),
  relation: text('relation').notNull().default('related'),
  note: text('note'),
  createdAt: text('created_at').notNull().$defaultFn(now),
  createdBy: text('created_by'),
}, (t) => [
  index('entity_link_from_ix').on(t.fromType, t.fromId),
  index('entity_link_to_ix').on(t.toType, t.toId),
  uniqueIndex('entity_link_uq').on(t.fromType, t.fromId, t.toType, t.toId, t.relation),
]);

export const comments = sqliteTable('comment', {
  id: pk(),
  entityType: text('entity_type').notNull(), entityId: text('entity_id').notNull(),
  userId: text('user_id').notNull(),
  bodyMd: text('body_md').notNull(),
  parentCommentId: text('parent_comment_id'),
  ...audit,
}, (t) => [index('comment_entity_ix').on(t.entityType, t.entityId)]);

export const activityLog = sqliteTable('activity_log', {
  id: pk(),
  ts: text('ts').notNull().$defaultFn(now),
  userId: text('user_id'),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(), entityId: text('entity_id').notNull(),
  summary: text('summary'),
  diff: json<Record<string, { from: unknown; to: unknown }>>('diff'),
}, (t) => [index('activity_entity_ix').on(t.entityType, t.entityId), index('activity_ts_ix').on(t.ts)]);

export const files = sqliteTable('file', {
  id: pk(),
  sha256: text('sha256').notNull(),
  size: integer('size').notNull(),
  mime: text('mime').notNull(),
  originalName: text('original_name').notNull(),
  width: integer('width'), height: integer('height'),
  storageKey: text('storage_key').notNull(),
  ...audit,
}, (t) => [index('file_sha_ix').on(t.sha256)]);

export const attachments = sqliteTable('attachment', {
  id: pk(),
  fileId: text('file_id').notNull().references(() => files.id),
  entityType: text('entity_type').notNull(), entityId: text('entity_id').notNull(),
  docType: text('doc_type').notNull().default('other'),
  title: text('title'), description: text('description'),
  isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(false),
  sort: integer('sort').notNull().default(0),
  ...audit,
}, (t) => [index('attachment_entity_ix').on(t.entityType, t.entityId)]);

export const labelCodes = sqliteTable('label_code', {
  id: pk(),
  code: text('code').notNull(),
  entityType: text('entity_type'), entityId: text('entity_id'),
  assignedAt: text('assigned_at'),
  ...audit,
}, (t) => [uniqueIndex('label_code_uq').on(t.code), index('label_entity_ix').on(t.entityType, t.entityId)]);

export const savedViews = sqliteTable('saved_view', {
  id: pk(),
  userId: text('user_id').notNull(),
  listKey: text('list_key').notNull(),
  name: text('name').notNull(),
  filters: json<Record<string, unknown>>('filters'),
  shared: integer('shared', { mode: 'boolean' }).notNull().default(false),
  ...audit,
});

export const notifications = sqliteTable('notification', {
  id: pk(),
  userId: text('user_id').notNull(),
  eventType: text('event_type').notNull(),
  entityType: text('entity_type'), entityId: text('entity_id'),
  title: text('title').notNull(), body: text('body'),
  /** Stable key making reminder delivery idempotent (DASH-013). */
  dedupeKey: text('dedupe_key').notNull(),
  createdAt: text('created_at').notNull().$defaultFn(now),
  readAt: text('read_at'),
}, (t) => [
  uniqueIndex('notification_dedupe_uq').on(t.userId, t.dedupeKey),
  index('notification_user_ix').on(t.userId, t.readAt),
]);

export const notificationDeliveries = sqliteTable('notification_delivery', {
  id: pk(),
  notificationId: text('notification_id').notNull().references(() => notifications.id, { onDelete: 'cascade' }),
  channel: text('channel').notNull(),
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  deliveredAt: text('delivered_at'),
  createdAt: text('created_at').notNull().$defaultFn(now),
}, (t) => [index('delivery_status_ix').on(t.status)]);

export const notificationPrefs = sqliteTable('notification_pref', {
  userId: text('user_id').notNull(),
  eventType: text('event_type').notNull(),
  channels: json<string[]>('channels'),
  timing: text('timing').notNull().default('immediate'),
  leadDays: json<number[]>('lead_days'),
}, (t) => [primaryKey({ columns: [t.userId, t.eventType] })]);

export const settings = sqliteTable('setting', {
  key: text('key').primaryKey(),
  value: json<unknown>('value'),
  updatedAt: text('updated_at').notNull().$defaultFn(now),
});

/* ────────────────────────────── registry ────────────────────────────── */

export const properties = sqliteTable('property', {
  id: pk(),
  name: text('name').notNull(),
  type: text('type').notNull().default('house'),
  address: json<Record<string, string>>('address'),
  purchaseDate: text('purchase_date'),
  purchasePrice: integer('purchase_price'),
  areaSqft: real('area_sqft'),
  yearBuilt: integer('year_built'),
  lotSize: text('lot_size'),
  notesMd: text('notes_md'),
  profile: json<Record<string, unknown>>('profile'),
  isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(false),
  ...audit,
});

export const locations = sqliteTable('location', {
  id: pk(),
  propertyId: text('property_id').notNull().references(() => properties.id),
  parentId: text('parent_id'),
  name: text('name').notNull(),
  type: text('type').notNull().default('room'),
  shortCode: text('short_code'),
  description: text('description'),
  photoFileId: text('photo_file_id'),
  holdsFood: integer('holds_food', { mode: 'boolean' }).notNull().default(false),
  temperatureClass: text('temperature_class'),
  dimensions: json<Record<string, number>>('dimensions'),
  pathCache: text('path_cache'),
  sort: integer('sort').notNull().default(0),
  ...audit,
}, (t) => [
  index('location_parent_ix').on(t.parentId),
  index('location_property_ix').on(t.propertyId),
  uniqueIndex('location_code_uq').on(t.shortCode),
]);

export const assetCategories = sqliteTable('asset_category', {
  id: pk(),
  parentId: text('parent_id'),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  defaultLifespanYears: integer('default_lifespan_years'),
  icon: text('icon'),
  sort: integer('sort').notNull().default(0),
  ...audit,
}, (t) => [uniqueIndex('asset_category_slug_uq').on(t.slug)]);

export const assets = sqliteTable('asset', {
  id: pk(),
  propertyId: text('property_id').notNull().references(() => properties.id),
  locationId: text('location_id'),
  categoryId: text('category_id'),
  /** `asset` or `tool`: tools are assets with extra behaviour (TOOL module). */
  kind: text('kind').notNull().default('asset'),
  name: text('name').notNull(),
  make: text('make'), model: text('model'), serial: text('serial'),
  purchaseDate: text('purchase_date'),
  purchasePrice: integer('purchase_price'),
  purchaseVendorId: text('purchase_vendor_id'),
  purchaseTransactionId: text('purchase_transaction_id'),
  installedDate: text('installed_date'),
  warrantyExpiry: text('warranty_expiry'),
  expectedLifespanYears: integer('expected_lifespan_years'),
  replacementCostEstimate: integer('replacement_cost_estimate'),
  condition: text('condition').notNull().default('good'),
  status: text('status').notNull().default('active'),
  retiredAt: text('retired_at'),
  disposal: json<Record<string, unknown>>('disposal'),
  replacedByAssetId: text('replaced_by_asset_id'),
  notesMd: text('notes_md'),
  custom: json<Record<string, unknown>>('custom'),
  ...audit,
}, (t) => [
  index('asset_property_ix').on(t.propertyId), index('asset_location_ix').on(t.locationId),
  index('asset_kind_ix').on(t.kind), index('asset_category_ix').on(t.categoryId),
]);

export const assetComponents = sqliteTable('asset_component', {
  id: pk(),
  assetId: text('asset_id').notNull().references(() => assets.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  spec: json<Record<string, unknown>>('spec'),
  productId: text('product_id'),
  ...audit,
});

export const warranties = sqliteTable('warranty', {
  id: pk(),
  assetId: text('asset_id').notNull().references(() => assets.id, { onDelete: 'cascade' }),
  providerContactId: text('provider_contact_id'),
  type: text('type').notNull().default('manufacturer'),
  startDate: text('start_date'), endDate: text('end_date').notNull(),
  coverageMd: text('coverage_md'),
  claimContact: text('claim_contact'),
  costTransactionId: text('cost_transaction_id'),
  ...audit,
}, (t) => [index('warranty_asset_ix').on(t.assetId), index('warranty_end_ix').on(t.endDate)]);

export const readings = sqliteTable('reading', {
  id: pk(),
  assetId: text('asset_id').notNull().references(() => assets.id, { onDelete: 'cascade' }),
  metric: text('metric').notNull(),
  value: real('value').notNull(),
  unit: text('unit'),
  takenAt: text('taken_at').notNull(),
  note: text('note'),
  ...audit,
}, (t) => [index('reading_asset_ix').on(t.assetId, t.metric, t.takenAt)]);

/* ──────────────────────────────── tasks ─────────────────────────────── */

export const schedules = sqliteTable('schedule', {
  id: pk(),
  mode: text('mode').notNull().default('one_off'),
  rrule: text('rrule'),
  anchorDate: text('anchor_date'),
  every: json<{ days?: number; weeks?: number; months?: number; years?: number }>('every'),
  timeOfDay: text('time_of_day'),
  graceDays: integer('grace_days'),
  untilDate: text('until_date'),
  count: integer('count'),
  horizonDays: integer('horizon_days').notNull().default(45),
  nextDue: text('next_due'),
  lastCompletedAt: text('last_completed_at'),
  /** Prototype for generated instances: title, priority, assignees, checklist… */
  template: json<Record<string, unknown>>('template'),
  originType: text('origin_type').notNull().default('manual'),
  originId: text('origin_id'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  ...audit,
}, (t) => [index('schedule_origin_ix').on(t.originType, t.originId), index('schedule_next_ix').on(t.nextDue)]);

export const tasks = sqliteTable('task', {
  id: pk(),
  title: text('title').notNull(),
  descriptionMd: text('description_md'),
  status: text('status').notNull().default('open'),
  priority: text('priority').notNull().default('normal'),
  dueDate: text('due_date'),
  dueTime: text('due_time'),
  startDate: text('start_date'),
  parentTaskId: text('parent_task_id'),
  originType: text('origin_type').notNull().default('manual'),
  originId: text('origin_id'),
  scheduleId: text('schedule_id'),
  propertyId: text('property_id'),
  locationId: text('location_id'),
  projectId: text('project_id'),
  phaseId: text('phase_id'),
  estimateMin: integer('estimate_min'),
  actualMin: integer('actual_min'),
  completedAt: text('completed_at'),
  completedBy: text('completed_by'),
  completionNote: text('completion_note'),
  visibility: text('visibility').notNull().default('household'),
  sortKey: real('sort_key').notNull().default(0),
  snoozedFrom: text('snoozed_from'),
  ...audit,
}, (t) => [
  index('task_status_due_ix').on(t.status, t.dueDate),
  index('task_origin_ix').on(t.originType, t.originId),
  index('task_project_ix').on(t.projectId),
  index('task_schedule_ix').on(t.scheduleId),
  uniqueIndex('task_schedule_instance_uq').on(t.scheduleId, t.dueDate),
]);

export const taskAssignees = sqliteTable('task_assignee', {
  taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(),
}, (t) => [primaryKey({ columns: [t.taskId, t.userId] }), index('task_assignee_user_ix').on(t.userId)]);

export const taskDependencies = sqliteTable('task_dependency', {
  taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  blockedByTaskId: text('blocked_by_task_id').notNull(),
}, (t) => [primaryKey({ columns: [t.taskId, t.blockedByTaskId] })]);

export const checklistItems = sqliteTable('checklist_item', {
  id: pk(),
  taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  text: text('text').notNull(),
  done: integer('done', { mode: 'boolean' }).notNull().default(false),
  sort: integer('sort').notNull().default(0),
}, (t) => [index('checklist_task_ix').on(t.taskId)]);

export const checklistTemplates = sqliteTable('checklist_template', {
  id: pk(),
  name: text('name').notNull(),
  items: json<string[]>('items'),
  ...audit,
});

export const boards = sqliteTable('board', {
  id: pk(),
  name: text('name').notNull(),
  propertyId: text('property_id'),
  filter: json<Record<string, unknown>>('filter'),
  ownerUserId: text('owner_user_id'),
  shared: integer('shared', { mode: 'boolean' }).notNull().default(true),
  sort: integer('sort').notNull().default(0),
  ...audit,
});

export const lanes = sqliteTable('lane', {
  id: pk(),
  boardId: text('board_id').notNull().references(() => boards.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  statusMapping: text('status_mapping'),
  wipLimit: integer('wip_limit'),
  sort: integer('sort').notNull().default(0),
  ...audit,
}, (t) => [index('lane_board_ix').on(t.boardId)]);

export const boardTasks = sqliteTable('board_task', {
  boardId: text('board_id').notNull().references(() => boards.id, { onDelete: 'cascade' }),
  laneId: text('lane_id').notNull(),
  taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  sort: real('sort').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.boardId, t.taskId] }), index('board_task_lane_ix').on(t.laneId)]);

export const timeEntries = sqliteTable('time_entry', {
  id: pk(),
  taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at'),
  minutes: integer('minutes'),
  note: text('note'),
  ...audit,
});

/* ───────────────────────────── maintenance ──────────────────────────── */

export const maintenancePlans = sqliteTable('maintenance_plan', {
  id: pk(),
  targetType: text('target_type').notNull().default('asset'),
  targetId: text('target_id').notNull(),
  title: text('title').notNull(),
  descriptionMd: text('description_md'),
  scheduleId: text('schedule_id'),
  estimateMin: integer('estimate_min'),
  estimateCost: integer('estimate_cost'),
  priority: text('priority').notNull().default('normal'),
  diy: integer('diy', { mode: 'boolean' }).notNull().default(true),
  vendorContactId: text('vendor_contact_id'),
  assigneeUserId: text('assignee_user_id'),
  checklist: json<string[]>('checklist'),
  seasonTags: json<string[]>('season_tags'),
  /** Days past due before this is called overdue rather than "due soon". */
  graceDays: integer('grace_days'),
  readingTrigger: json<{ metric: string; op: 'lt' | 'gt'; value: number }>('reading_trigger'),
  instructionsMd: text('instructions_md'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  ...audit,
}, (t) => [index('plan_target_ix').on(t.targetType, t.targetId)]);

export const planTools = sqliteTable('maintenance_plan_tool', {
  planId: text('plan_id').notNull().references(() => maintenancePlans.id, { onDelete: 'cascade' }),
  assetId: text('asset_id').notNull(),
}, (t) => [primaryKey({ columns: [t.planId, t.assetId] })]);

export const planConsumables = sqliteTable('maintenance_plan_consumable', {
  id: pk(),
  planId: text('plan_id').notNull().references(() => maintenancePlans.id, { onDelete: 'cascade' }),
  productId: text('product_id').notNull(),
  quantity: real('quantity').notNull().default(1),
  unit: text('unit').notNull().default('ea'),
});

export const maintenanceRecords = sqliteTable('maintenance_record', {
  id: pk(),
  planId: text('plan_id'),
  targetType: text('target_type').notNull(), targetId: text('target_id').notNull(),
  taskId: text('task_id'),
  kind: text('kind').notNull().default('planned'),
  title: text('title').notNull(),
  performedAt: text('performed_at').notNull(),
  performerUserId: text('performer_user_id'),
  performerContactId: text('performer_contact_id'),
  costTransactionId: text('cost_transaction_id'),
  minutes: integer('minutes'),
  notesMd: text('notes_md'),
  failureDescription: text('failure_description'),
  cause: text('cause'),
  ...audit,
}, (t) => [index('record_target_ix').on(t.targetType, t.targetId, t.performedAt), index('record_plan_ix').on(t.planId)]);

export const maintenanceConsumption = sqliteTable('maintenance_consumption', {
  id: pk(),
  recordId: text('record_id').notNull().references(() => maintenanceRecords.id, { onDelete: 'cascade' }),
  productId: text('product_id').notNull(),
  stockItemId: text('stock_item_id'),
  quantity: real('quantity').notNull(),
  unit: text('unit').notNull().default('ea'),
});

export const maintenanceTemplates = sqliteTable('maintenance_template', {
  id: pk(),
  categorySlug: text('category_slug').notNull(),
  title: text('title').notNull(),
  descriptionMd: text('description_md'),
  mode: text('mode').notNull().default('fixed'),
  rrule: text('rrule'),
  every: json<Record<string, number>>('every'),
  estimateMin: integer('estimate_min'),
  diy: integer('diy', { mode: 'boolean' }).notNull().default(true),
  seasonTags: json<string[]>('season_tags'),
  checklist: json<string[]>('checklist'),
  consumables: json<Array<{ name: string; quantity: number; unit: string }>>('consumables'),
  ...audit,
}, (t) => [index('mtemplate_cat_ix').on(t.categorySlug)]);

/* ──────────────────────────────  projects ───────────────────────────── */

export const projects = sqliteTable('project', {
  id: pk(),
  propertyId: text('property_id').notNull(),
  name: text('name').notNull(),
  descriptionMd: text('description_md'),
  status: text('status').notNull().default('idea'),
  ownerUserId: text('owner_user_id'),
  priority: text('priority').notNull().default('normal'),
  targetStart: text('target_start'), targetEnd: text('target_end'),
  actualStart: text('actual_start'), actualEnd: text('actual_end'),
  budgetAmount: integer('budget_amount'),
  budgetBreakdown: json<Record<string, number>>('budget_breakdown'),
  coverFileId: text('cover_file_id'),
  estimateCost: integer('estimate_cost'),
  retrospective: json<Record<string, unknown>>('retrospective'),
  ...audit,
}, (t) => [index('project_status_ix').on(t.status)]);

export const projectLocations = sqliteTable('project_location', {
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  locationId: text('location_id').notNull(),
}, (t) => [primaryKey({ columns: [t.projectId, t.locationId] })]);

export const projectPhases = sqliteTable('project_phase', {
  id: pk(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  sort: integer('sort').notNull().default(0),
  targetStart: text('target_start'), targetEnd: text('target_end'),
  status: text('status').notNull().default('planning'),
  ...audit,
}, (t) => [index('phase_project_ix').on(t.projectId)]);

export const projectMaterials = sqliteTable('project_material', {
  id: pk(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  phaseId: text('phase_id'),
  productId: text('product_id'),
  description: text('description').notNull(),
  quantity: real('quantity').notNull().default(1),
  unit: text('unit').notNull().default('ea'),
  estUnitCost: integer('est_unit_cost'),
  actualCost: integer('actual_cost'),
  status: text('status').notNull().default('needed'),
  supplierContactId: text('supplier_contact_id'),
  transactionId: text('transaction_id'),
  storageItemId: text('storage_item_id'),
  ...audit,
}, (t) => [index('material_project_ix').on(t.projectId), index('material_status_ix').on(t.status)]);

export const projectTools = sqliteTable('project_tool', {
  id: pk(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  assetId: text('asset_id').notNull(),
  requiredFrom: text('required_from'), requiredTo: text('required_to'),
  checkedOutAt: text('checked_out_at'), checkedInAt: text('checked_in_at'),
}, (t) => [uniqueIndex('project_tool_uq').on(t.projectId, t.assetId)]);

export const projectToolWishes = sqliteTable('project_tool_wish', {
  id: pk(),
  projectId: text('project_id'),
  description: text('description').notNull(),
  estCost: integer('est_cost'),
  rentOrBuy: text('rent_or_buy').notNull().default('buy'),
  note: text('note'),
  resolvedAssetId: text('resolved_asset_id'),
  ...audit,
});

export const quotes = sqliteTable('quote', {
  id: pk(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  contactId: text('contact_id'),
  scope: text('scope').notNull(),
  amount: integer('amount'),
  quotedAt: text('quoted_at'), validUntil: text('valid_until'),
  status: text('status').notNull().default('requested'),
  notesMd: text('notes_md'),
  lines: json<Array<{ description: string; amount: number }>>('lines'),
  ...audit,
}, (t) => [index('quote_project_ix').on(t.projectId)]);

export const permits = sqliteTable('permit', {
  id: pk(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  authorityContactId: text('authority_contact_id'),
  name: text('name').notNull(),
  permitNumber: text('permit_number'),
  feeTransactionId: text('fee_transaction_id'),
  appliedAt: text('applied_at'), issuedAt: text('issued_at'), expiresAt: text('expires_at'),
  status: text('status').notNull().default('applied'),
  notesMd: text('notes_md'),
  ...audit,
});

export const inspections = sqliteTable('inspection', {
  id: pk(),
  permitId: text('permit_id').notNull().references(() => permits.id, { onDelete: 'cascade' }),
  taskId: text('task_id'),
  name: text('name').notNull(),
  scheduledAt: text('scheduled_at'),
  outcome: text('outcome'),
  notes: text('notes'),
  ...audit,
});

export const decisions = sqliteTable('decision', {
  id: pk(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  decidedAt: text('decided_at').notNull(),
  title: text('title').notNull(),
  rationaleMd: text('rationale_md'),
  alternativesMd: text('alternatives_md'),
  decidedBy: text('decided_by'),
  ...audit,
}, (t) => [index('decision_project_ix').on(t.projectId)]);

export const projectTemplates = sqliteTable('project_template', {
  id: pk(),
  name: text('name').notNull(),
  descriptionMd: text('description_md'),
  phases: json<Array<{ name: string; tasks?: string[] }>>('phases'),
  materials: json<Array<{ description: string; quantity: number; unit: string; estUnitCost?: number }>>('materials'),
  tools: json<string[]>('tools'),
  permits: json<string[]>('permits'),
  budgetBreakdown: json<Record<string, number>>('budget_breakdown'),
  ...audit,
});

/* ──────────────────────────────── budget ────────────────────────────── */

export const accounts = sqliteTable('account', {
  id: pk(),
  name: text('name').notNull(),
  type: text('type').notNull().default('checking'),
  openingBalance: integer('opening_balance').notNull().default(0),
  openingDate: text('opening_date'),
  currency: text('currency'),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  sort: integer('sort').notNull().default(0),
  ...audit,
});

export const categories = sqliteTable('category', {
  id: pk(),
  parentId: text('parent_id'),
  name: text('name').notNull(),
  kind: text('kind').notNull().default('expense'),
  rolloverRule: text('rollover_rule').notNull().default('none'),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  sort: integer('sort').notNull().default(0),
  ...audit,
}, (t) => [index('category_parent_ix').on(t.parentId)]);

export const payees = sqliteTable('payee', {
  id: pk(),
  name: text('name').notNull(),
  contactId: text('contact_id'),
  defaultCategoryId: text('default_category_id'),
  ...audit,
}, (t) => [uniqueIndex('payee_name_uq').on(t.name)]);

export const transactions = sqliteTable('transaction', {
  id: pk(),
  date: text('date').notNull(),
  amount: integer('amount').notNull(),
  currency: text('currency'),
  fxRate: real('fx_rate'),
  type: text('type').notNull().default('expense'),
  accountId: text('account_id'),
  transferAccountId: text('transfer_account_id'),
  payeeId: text('payee_id'),
  memo: text('memo'),
  cleared: integer('cleared', { mode: 'boolean' }).notNull().default(false),
  paidByUserId: text('paid_by_user_id'),
  shared: integer('shared', { mode: 'boolean' }).notNull().default(true),
  importHash: text('import_hash'),
  recurringBillId: text('recurring_bill_id'),
  ...audit,
}, (t) => [
  index('transaction_date_ix').on(t.date),
  index('transaction_account_ix').on(t.accountId),
  uniqueIndex('transaction_import_uq').on(t.importHash),
]);

export const transactionSplits = sqliteTable('transaction_split', {
  id: pk(),
  transactionId: text('transaction_id').notNull().references(() => transactions.id, { onDelete: 'cascade' }),
  amount: integer('amount').notNull(),
  categoryId: text('category_id'),
  memo: text('memo'),
  sort: integer('sort').notNull().default(0),
}, (t) => [index('split_transaction_ix').on(t.transactionId), index('split_category_ix').on(t.categoryId)]);

export const splitAttributions = sqliteTable('split_attribution', {
  id: pk(),
  splitId: text('split_id').notNull().references(() => transactionSplits.id, { onDelete: 'cascade' }),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
}, (t) => [index('attribution_entity_ix').on(t.entityType, t.entityId), index('attribution_split_ix').on(t.splitId)]);

export const transactionLineItems = sqliteTable('transaction_line_item', {
  id: pk(),
  transactionId: text('transaction_id').notNull().references(() => transactions.id, { onDelete: 'cascade' }),
  productId: text('product_id'),
  description: text('description').notNull(),
  quantity: real('quantity').notNull().default(1),
  unit: text('unit').notNull().default('ea'),
  unitPrice: integer('unit_price').notNull().default(0),
}, (t) => [index('line_item_product_ix').on(t.productId)]);

export const budgetAllocations = sqliteTable('budget_allocation', {
  id: pk(),
  /** YYYY-MM. Monthly is the only period the UI exposes today. */
  period: text('period').notNull(),
  categoryId: text('category_id').notNull(),
  amount: integer('amount').notNull().default(0),
  ...audit,
}, (t) => [uniqueIndex('allocation_uq').on(t.period, t.categoryId)]);

export const recurringBills = sqliteTable('recurring_bill', {
  id: pk(),
  name: text('name').notNull(),
  payeeId: text('payee_id'),
  categoryId: text('category_id'),
  accountId: text('account_id'),
  amount: integer('amount'),
  variable: integer('variable', { mode: 'boolean' }).notNull().default(false),
  scheduleId: text('schedule_id'),
  leadDays: integer('lead_days').notNull().default(5),
  everyMonths: integer('every_months').notNull().default(1),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  ...audit,
});

export const goals = sqliteTable('goal', {
  id: pk(),
  name: text('name').notNull(),
  targetAmount: integer('target_amount').notNull(),
  targetDate: text('target_date'),
  accountId: text('account_id'),
  status: text('status').notNull().default('active'),
  notesMd: text('notes_md'),
  ...audit,
});

export const importProfiles = sqliteTable('import_profile', {
  id: pk(),
  name: text('name').notNull(),
  mapping: json<Record<string, string>>('mapping'),
  ...audit,
});

/* ───────────────────────────  food & consumables ─────────────────────── */

export const productCategories = sqliteTable('product_category', {
  id: pk(),
  parentId: text('parent_id'),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  isFood: integer('is_food', { mode: 'boolean' }).notNull().default(true),
  sort: integer('sort').notNull().default(0),
  ...audit,
}, (t) => [uniqueIndex('product_category_slug_uq').on(t.slug)]);

export const products = sqliteTable('product', {
  id: pk(),
  name: text('name').notNull(),
  brand: text('brand'),
  categoryId: text('category_id'),
  isFood: integer('is_food', { mode: 'boolean' }).notNull().default(true),
  isPetSupply: integer('is_pet_supply', { mode: 'boolean' }).notNull().default(false),
  defaultUnit: text('default_unit').notNull().default('ea'),
  packageSize: real('package_size'),
  packageUnit: text('package_unit'),
  /** Shelf life in days, keyed by temperature class. */
  shelfLife: json<Record<string, number>>('shelf_life'),
  useWithinDaysOpened: integer('use_within_days_opened'),
  minQuantity: real('min_quantity'),
  autoShopping: integer('auto_shopping', { mode: 'boolean' }).notNull().default(true),
  defaultLocationId: text('default_location_id'),
  imageFileId: text('image_file_id'),
  nutrition: json<Record<string, number>>('nutrition'),
  spec: json<Record<string, unknown>>('spec'),
  notes: text('notes'),
  ...audit,
}, (t) => [index('product_name_ix').on(t.name), index('product_category_ix').on(t.categoryId)]);

export const productBarcodes = sqliteTable('product_barcode', {
  id: pk(),
  productId: text('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  barcode: text('barcode').notNull(),
  symbology: text('symbology'),
}, (t) => [uniqueIndex('barcode_uq').on(t.barcode)]);

export const stockItems = sqliteTable('stock_item', {
  id: pk(),
  productId: text('product_id').notNull().references(() => products.id),
  locationId: text('location_id'),
  quantity: real('quantity').notNull().default(0),
  unit: text('unit').notNull().default('ea'),
  expiryDate: text('expiry_date'),
  openedAt: text('opened_at'),
  purchasedAt: text('purchased_at'),
  transactionId: text('transaction_id'),
  unitPrice: integer('unit_price'),
  note: text('note'),
  ...audit,
}, (t) => [
  index('stock_product_ix').on(t.productId),
  index('stock_location_ix').on(t.locationId),
  index('stock_expiry_ix').on(t.expiryDate),
]);

export const stockMovements = sqliteTable('stock_movement', {
  id: pk(),
  stockItemId: text('stock_item_id'),
  productId: text('product_id').notNull(),
  delta: real('delta').notNull(),
  unit: text('unit').notNull().default('ea'),
  reason: text('reason').notNull(),
  userId: text('user_id'),
  ts: text('ts').notNull().$defaultFn(now),
  refType: text('ref_type'), refId: text('ref_id'),
  note: text('note'),
}, (t) => [index('movement_product_ix').on(t.productId, t.ts)]);

export const shoppingLists = sqliteTable('shopping_list', {
  id: pk(),
  name: text('name').notNull(),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  storeContactId: text('store_contact_id'),
  sort: integer('sort').notNull().default(0),
  ...audit,
});

export const shoppingLines = sqliteTable('shopping_line', {
  id: pk(),
  listId: text('list_id').notNull().references(() => shoppingLists.id, { onDelete: 'cascade' }),
  productId: text('product_id'),
  text: text('text').notNull(),
  quantity: real('quantity').notNull().default(1),
  unit: text('unit').notNull().default('ea'),
  note: text('note'),
  storeContactId: text('store_contact_id'),
  checkedAt: text('checked_at'),
  checkedBy: text('checked_by'),
  /** Where this line came from: low stock, a project material, a plan… */
  sourceType: text('source_type'), sourceId: text('source_id'),
  sort: real('sort').notNull().default(0),
  ...audit,
}, (t) => [index('shopping_line_list_ix').on(t.listId), index('shopping_line_source_ix').on(t.sourceType, t.sourceId)]);

export const recipes = sqliteTable('recipe', {
  id: pk(),
  name: text('name').notNull(),
  servings: real('servings').notNull().default(2),
  prepMin: integer('prep_min'), cookMin: integer('cook_min'),
  stepsMd: text('steps_md'),
  sourceUrl: text('source_url'),
  imageFileId: text('image_file_id'),
  ...audit,
});

export const recipeIngredients = sqliteTable('recipe_ingredient', {
  id: pk(),
  recipeId: text('recipe_id').notNull().references(() => recipes.id, { onDelete: 'cascade' }),
  productId: text('product_id'),
  text: text('text').notNull(),
  quantity: real('quantity').notNull().default(1),
  unit: text('unit').notNull().default('ea'),
  optional: integer('optional', { mode: 'boolean' }).notNull().default(false),
  sort: integer('sort').notNull().default(0),
});

export const mealPlanEntries = sqliteTable('meal_plan_entry', {
  id: pk(),
  date: text('date').notNull(),
  slot: text('slot').notNull().default('dinner'),
  recipeId: text('recipe_id'),
  text: text('text'),
  ...audit,
}, (t) => [index('meal_plan_date_ix').on(t.date)]);

export const wasteLog = sqliteTable('waste_log', {
  id: pk(),
  stockItemId: text('stock_item_id'),
  productId: text('product_id').notNull(),
  quantity: real('quantity').notNull(),
  unit: text('unit').notNull().default('ea'),
  reason: text('reason').notNull().default('expired'),
  estCost: integer('est_cost'),
  ts: text('ts').notNull().$defaultFn(now),
  userId: text('user_id'),
}, (t) => [index('waste_ts_ix').on(t.ts)]);

/* ───────────────────────────  storage & tools ───────────────────────── */

export const storageCategories = sqliteTable('storage_category', {
  id: pk(),
  parentId: text('parent_id'),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  sort: integer('sort').notNull().default(0),
  ...audit,
}, (t) => [uniqueIndex('storage_category_slug_uq').on(t.slug)]);

export const storageItems = sqliteTable('storage_item', {
  id: pk(),
  locationId: text('location_id'),
  categoryId: text('category_id'),
  name: text('name').notNull(),
  description: text('description'),
  quantity: real('quantity').notNull().default(1),
  unit: text('unit').notNull().default('ea'),
  estValue: integer('est_value'),
  purchaseDate: text('purchase_date'),
  purchasePrice: integer('purchase_price'),
  condition: text('condition').notNull().default('good'),
  reviewBy: text('review_by'),
  projectId: text('project_id'),
  status: text('status').notNull().default('stored'),
  lastSeenAt: text('last_seen_at'),
  notesMd: text('notes_md'),
  ...audit,
}, (t) => [index('storage_item_location_ix').on(t.locationId), index('storage_item_name_ix').on(t.name)]);

export const loans = sqliteTable('loan', {
  id: pk(),
  itemType: text('item_type').notNull().default('storage_item'),
  itemId: text('item_id').notNull(),
  direction: text('direction').notNull().default('out'),
  contactId: text('contact_id'),
  contactName: text('contact_name'),
  lentAt: text('lent_at').notNull(),
  dueBack: text('due_back'),
  returnedAt: text('returned_at'),
  returnCondition: text('return_condition'),
  taskId: text('task_id'),
  note: text('note'),
  ...audit,
}, (t) => [index('loan_item_ix').on(t.itemType, t.itemId), index('loan_open_ix').on(t.returnedAt)]);

export const toolProfiles = sqliteTable('tool_profile', {
  assetId: text('asset_id').primaryKey(),
  toolType: text('tool_type').notNull().default('hand'),
  powerSource: text('power_source'),
  batteryPlatformId: text('battery_platform_id'),
  status: text('status').notNull().default('available'),
  accessories: json<string[]>('accessories'),
  hoursUsed: real('hours_used').notNull().default(0),
  ...audit,
});

export const batteryPlatforms = sqliteTable('battery_platform', {
  id: pk(),
  name: text('name').notNull(),
  brand: text('brand'),
  voltage: real('voltage'),
  ...audit,
});

export const batteries = sqliteTable('battery', {
  id: pk(),
  platformId: text('platform_id').notNull().references(() => batteryPlatforms.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  kind: text('kind').notNull().default('battery'),
  capacityAh: real('capacity_ah'),
  health: text('health').notNull().default('good'),
  purchasedAt: text('purchased_at'),
  locationId: text('location_id'),
  note: text('note'),
  ...audit,
});

export const toolConsumableSpecs = sqliteTable('tool_consumable_spec', {
  id: pk(),
  assetId: text('asset_id').notNull().references(() => assets.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  spec: json<Record<string, unknown>>('spec'),
  ...audit,
});

export const toolConsumableProducts = sqliteTable('tool_consumable_product', {
  specId: text('spec_id').notNull().references(() => toolConsumableSpecs.id, { onDelete: 'cascade' }),
  productId: text('product_id').notNull(),
}, (t) => [primaryKey({ columns: [t.specId, t.productId] })]);

export const toolKits = sqliteTable('tool_kit', {
  id: pk(),
  name: text('name').notNull(),
  description: text('description'),
  locationId: text('location_id'),
  ...audit,
});

export const toolKitMembers = sqliteTable('tool_kit_member', {
  kitId: text('kit_id').notNull().references(() => toolKits.id, { onDelete: 'cascade' }),
  assetId: text('asset_id').notNull(),
}, (t) => [primaryKey({ columns: [t.kitId, t.assetId] })]);

export const toolUsage = sqliteTable('tool_usage', {
  id: pk(),
  assetId: text('asset_id').notNull(),
  projectId: text('project_id'), taskId: text('task_id'),
  ts: text('ts').notNull(),
  hours: real('hours').notNull().default(0),
  note: text('note'),
  ...audit,
});

/* ──────────────────────────────── pets ──────────────────────────────── */

export const speciesProfiles = sqliteTable('species_profile', {
  id: pk(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  labels: json<Record<string, string>>('labels'),
  vaccinePresets: json<Array<{ name: string; core: boolean; intervalMonths: number; note?: string }>>('vaccine_presets'),
  journalTags: json<string[]>('journal_tags'),
  commonConditions: json<string[]>('common_conditions'),
  labTests: json<Array<{ name: string; unit: string; refLow?: number; refHigh?: number }>>('lab_tests'),
  weightWarnPct: real('weight_warn_pct').notNull().default(10),
  ...audit,
}, (t) => [uniqueIndex('species_code_uq').on(t.code)]);

export const pets = sqliteTable('pet', {
  id: pk(),
  name: text('name').notNull(),
  speciesCode: text('species_code').notNull().default('cat'),
  breed: text('breed'),
  sex: text('sex'),
  neutered: integer('neutered', { mode: 'boolean' }),
  dob: text('dob'),
  adoptedAt: text('adopted_at'),
  microchip: text('microchip'),
  markings: text('markings'),
  photoFileId: text('photo_file_id'),
  status: text('status').notNull().default('active'),
  statusDate: text('status_date'),
  primaryVetContactId: text('primary_vet_contact_id'),
  emergencyVetContactId: text('emergency_vet_contact_id'),
  targetWeightMin: real('target_weight_min'),
  targetWeightMax: real('target_weight_max'),
  weightUnit: text('weight_unit').notNull().default('lb'),
  careNotesMd: text('care_notes_md'),
  notesMd: text('notes_md'),
  ...audit,
});

export const petVaccinations = sqliteTable('pet_vaccination', {
  id: pk(),
  petId: text('pet_id').notNull().references(() => pets.id, { onDelete: 'cascade' }),
  vaccine: text('vaccine').notNull(),
  givenAt: text('given_at').notNull(),
  providerContactId: text('provider_contact_id'),
  lot: text('lot'),
  nextDue: text('next_due'),
  taskId: text('task_id'),
  notes: text('notes'),
  ...audit,
}, (t) => [index('vax_pet_ix').on(t.petId), index('vax_due_ix').on(t.nextDue)]);

export const petMedications = sqliteTable('pet_medication', {
  id: pk(),
  petId: text('pet_id').notNull().references(() => pets.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  form: text('form'), strength: text('strength'),
  dose: text('dose'), route: text('route'),
  /** Wall-clock times each day a dose is due, e.g. ["08:00","20:00"]. */
  timesOfDay: json<string[]>('times_of_day'),
  /** Days between dosing days; 1 = daily, 30 = monthly preventive. */
  everyDays: integer('every_days').notNull().default(1),
  kind: text('kind').notNull().default('medication'),
  startDate: text('start_date').notNull(),
  endDate: text('end_date'),
  ongoing: integer('ongoing', { mode: 'boolean' }).notNull().default(true),
  vetContactId: text('vet_contact_id'),
  pharmacyContactId: text('pharmacy_contact_id'),
  productId: text('product_id'),
  dosesPerUnit: real('doses_per_unit').notNull().default(1),
  refillsRemaining: integer('refills_remaining'),
  refillQty: real('refill_qty'),
  instructionsMd: text('instructions_md'),
  conditionId: text('condition_id'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  ...audit,
}, (t) => [index('med_pet_ix').on(t.petId, t.active)]);

export const petDoses = sqliteTable('pet_dose', {
  id: pk(),
  medicationId: text('medication_id').notNull().references(() => petMedications.id, { onDelete: 'cascade' }),
  petId: text('pet_id').notNull(),
  taskId: text('task_id'),
  dueDate: text('due_date').notNull(),
  dueTime: text('due_time').notNull(),
  dueAt: text('due_at').notNull(),
  givenAt: text('given_at'),
  givenBy: text('given_by'),
  status: text('status').notNull().default('due'),
  note: text('note'),
  ...audit,
}, (t) => [
  uniqueIndex('dose_slot_uq').on(t.medicationId, t.dueDate, t.dueTime),
  index('dose_due_ix').on(t.dueAt, t.status),
  index('dose_pet_ix').on(t.petId),
]);

export const petVisits = sqliteTable('pet_visit', {
  id: pk(),
  petId: text('pet_id').notNull().references(() => pets.id, { onDelete: 'cascade' }),
  visitedAt: text('visited_at').notNull(),
  providerContactId: text('provider_contact_id'),
  reason: text('reason').notNull(),
  notesMd: text('notes_md'),
  diagnosis: text('diagnosis'),
  weight: real('weight'), weightUnit: text('weight_unit'),
  followUpDate: text('follow_up_date'),
  followUpTaskId: text('follow_up_task_id'),
  costTransactionId: text('cost_transaction_id'),
  ...audit,
}, (t) => [index('visit_pet_ix').on(t.petId, t.visitedAt)]);

export const petWeights = sqliteTable('pet_weight', {
  id: pk(),
  petId: text('pet_id').notNull().references(() => pets.id, { onDelete: 'cascade' }),
  takenAt: text('taken_at').notNull(),
  weight: real('weight').notNull(),
  unit: text('unit').notNull().default('lb'),
  source: text('source').notNull().default('manual'),
  visitId: text('visit_id'),
  note: text('note'),
  ...audit,
}, (t) => [index('weight_pet_ix').on(t.petId, t.takenAt)]);

export const petJournal = sqliteTable('pet_journal', {
  id: pk(),
  petId: text('pet_id').notNull().references(() => pets.id, { onDelete: 'cascade' }),
  ts: text('ts').notNull(),
  bodyMd: text('body_md').notNull(),
  tags: json<string[]>('tags'),
  severity: text('severity').notNull().default('info'),
  visitId: text('visit_id'),
  ...audit,
}, (t) => [index('journal_pet_ix').on(t.petId, t.ts)]);

export const petConditions = sqliteTable('pet_condition', {
  id: pk(),
  petId: text('pet_id').notNull().references(() => pets.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  onsetDate: text('onset_date'),
  status: text('status').notNull().default('active'),
  notesMd: text('notes_md'),
  ...audit,
}, (t) => [index('condition_pet_ix').on(t.petId)]);

export const petLabResults = sqliteTable('pet_lab_result', {
  id: pk(),
  petId: text('pet_id').notNull().references(() => pets.id, { onDelete: 'cascade' }),
  visitId: text('visit_id'),
  test: text('test').notNull(),
  value: real('value').notNull(),
  unit: text('unit'),
  refLow: real('ref_low'), refHigh: real('ref_high'),
  takenAt: text('taken_at').notNull(),
  ...audit,
}, (t) => [index('lab_pet_ix').on(t.petId, t.test, t.takenAt)]);

export const petDietEntries = sqliteTable('pet_diet_entry', {
  id: pk(),
  petId: text('pet_id').notNull().references(() => pets.id, { onDelete: 'cascade' }),
  timeOfDay: text('time_of_day').notNull(),
  productId: text('product_id'),
  description: text('description'),
  amount: real('amount').notNull().default(1),
  unit: text('unit').notNull().default('ea'),
  activeFrom: text('active_from'), activeTo: text('active_to'),
  ...audit,
}, (t) => [index('diet_pet_ix').on(t.petId)]);

export const petInsurance = sqliteTable('pet_insurance', {
  id: pk(),
  petId: text('pet_id').notNull().references(() => pets.id, { onDelete: 'cascade' }),
  insurerContactId: text('insurer_contact_id'),
  policyNumber: text('policy_number'),
  premiumBillId: text('premium_bill_id'),
  deductible: integer('deductible'),
  reimbursementPct: real('reimbursement_pct'),
  notesMd: text('notes_md'),
  ...audit,
});

export const petClaims = sqliteTable('pet_claim', {
  id: pk(),
  insuranceId: text('insurance_id').notNull().references(() => petInsurance.id, { onDelete: 'cascade' }),
  visitId: text('visit_id'),
  claimedAmount: integer('claimed_amount').notNull(),
  reimbursedTransactionId: text('reimbursed_transaction_id'),
  status: text('status').notNull().default('submitted'),
  submittedAt: text('submitted_at'),
  ...audit,
});

/* ─────────────────────────────── contacts ───────────────────────────── */

export const contacts = sqliteTable('contact', {
  id: pk(),
  name: text('name').notNull(),
  type: text('type').notNull().default('vendor'),
  phones: json<Array<{ label: string; number: string }>>('phones'),
  email: text('email'),
  website: text('website'),
  address: json<Record<string, string>>('address'),
  notesMd: text('notes_md'),
  rating: integer('rating'),
  preferred: integer('preferred', { mode: 'boolean' }).notNull().default(false),
  specialties: json<string[]>('specialties'),
  ...audit,
}, (t) => [index('contact_type_ix').on(t.type), index('contact_name_ix').on(t.name)]);

export const serviceAccounts = sqliteTable('service_account', {
  id: pk(),
  contactId: text('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  accountNumberEnc: text('account_number_enc'),
  emergencyPhone: text('emergency_phone'),
  recurringBillId: text('recurring_bill_id'),
  ...audit,
});

/* ─────────────────────────────── jobs ───────────────────────────────── */

/** Durable job rows give the scheduler exactly-once semantics across restarts. */
export const jobRuns = sqliteTable('job_run', {
  id: pk(),
  jobKey: text('job_key').notNull(),
  ranForDate: text('ran_for_date').notNull(),
  startedAt: text('started_at').notNull().$defaultFn(now),
  finishedAt: text('finished_at'),
  status: text('status').notNull().default('running'),
  detail: json<Record<string, unknown>>('detail'),
}, (t) => [uniqueIndex('job_run_uq').on(t.jobKey, t.ranForDate)]);
