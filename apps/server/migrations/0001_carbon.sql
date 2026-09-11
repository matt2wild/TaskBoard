CREATE TABLE `activity` (
	`id` text PRIMARY KEY NOT NULL,
	`property_id` text,
	`location_id` text,
	`type` text NOT NULL,
	`amount` real NOT NULL,
	`unit` text NOT NULL,
	`occurred_on` text NOT NULL,
	`note` text,
	`transaction_id` text,
	`source_type` text,
	`source_id` text,
	`reading_id` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `activity_date_ix` ON `activity` (`occurred_on`);--> statement-breakpoint
CREATE INDEX `activity_type_ix` ON `activity` (`type`);--> statement-breakpoint
CREATE INDEX `activity_source_ix` ON `activity` (`source_type`,`source_id`);--> statement-breakpoint
CREATE INDEX `activity_transaction_ix` ON `activity` (`transaction_id`);--> statement-breakpoint
CREATE TABLE `attribution` (
	`id` text PRIMARY KEY NOT NULL,
	`source_kind` text NOT NULL,
	`source_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `attr_entity_ix` ON `attribution` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `attr_source_ix` ON `attribution` (`source_kind`,`source_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `attr_uq` ON `attribution` (`source_kind`,`source_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `carbon_target` (
	`id` text PRIMARY KEY NOT NULL,
	`period` text NOT NULL,
	`g_co2e` integer NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `carbon_target_uq` ON `carbon_target` (`period`);--> statement-breakpoint
CREATE TABLE `emission_factor` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`activity_unit` text NOT NULL,
	`kg_per_unit` real NOT NULL,
	`scope` integer DEFAULT 3 NOT NULL,
	`region` text,
	`valid_from` text,
	`valid_to` text,
	`source` text,
	`confidence` text DEFAULT 'medium' NOT NULL,
	`notes` text,
	`is_default` integer DEFAULT false NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `factor_key_ix` ON `emission_factor` (`key`);--> statement-breakpoint
CREATE INDEX `factor_category_ix` ON `emission_factor` (`category`);--> statement-breakpoint
CREATE TABLE `emission` (
	`id` text PRIMARY KEY NOT NULL,
	`activity_id` text NOT NULL,
	`factor_id` text,
	`factor_key` text NOT NULL,
	`factor_kg_per_unit` real NOT NULL,
	`quantity_in_factor_unit` real NOT NULL,
	`factor_unit` text NOT NULL,
	`g_co2e` integer NOT NULL,
	`scope` integer NOT NULL,
	`category` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text,
	FOREIGN KEY (`activity_id`) REFERENCES `activity`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `emission_activity_ix` ON `emission` (`activity_id`);--> statement-breakpoint
CREATE INDEX `emission_scope_ix` ON `emission` (`scope`);--> statement-breakpoint
CREATE TABLE `intervention_template` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`description_md` text,
	`typical_cost` integer,
	`embodied_g_co2e` integer,
	`lifetime_years` integer DEFAULT 20 NOT NULL,
	`saving_model` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `intervention_template_key_uq` ON `intervention_template` (`key`);--> statement-breakpoint
CREATE TABLE `intervention` (
	`id` text PRIMARY KEY NOT NULL,
	`template_key` text,
	`name` text NOT NULL,
	`description_md` text,
	`category` text DEFAULT 'other' NOT NULL,
	`property_id` text,
	`target_asset_id` text,
	`capital_cost` integer,
	`embodied_g_co2e` integer DEFAULT 0 NOT NULL,
	`annual_saving_kwh` real,
	`annual_saving_cost` integer,
	`annual_saving_g_co2e` integer DEFAULT 0 NOT NULL,
	`basis` text DEFAULT 'estimated' NOT NULL,
	`basis_note` text,
	`lifetime_years` integer DEFAULT 20 NOT NULL,
	`project_id` text,
	`status` text DEFAULT 'candidate' NOT NULL,
	`notes_md` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `intervention_status_ix` ON `intervention` (`status`);--> statement-breakpoint
CREATE TABLE `meter` (
	`asset_id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`unit` text NOT NULL,
	`emission_factor_key` text,
	`multiplier` real DEFAULT 1 NOT NULL,
	`rollover_at` real,
	`installed_on` text,
	`replaced_meter_asset_id` text,
	`serial` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
ALTER TABLE `product_category` ADD `emission_factor_key` text;--> statement-breakpoint
ALTER TABLE `product` ADD `emission_factor_key` text;--> statement-breakpoint
ALTER TABLE `product` ADD `unit_mass_kg` real;--> statement-breakpoint
ALTER TABLE `project_material` ADD `emission_factor_key` text;--> statement-breakpoint
ALTER TABLE `project_material` ADD `unit_mass_kg` real;--> statement-breakpoint
ALTER TABLE `project_material` ADD `activity_id` text;--> statement-breakpoint
ALTER TABLE `recurring_bill` ADD `metered_unit` text;--> statement-breakpoint
ALTER TABLE `recurring_bill` ADD `emission_factor_key` text;--> statement-breakpoint
ALTER TABLE `recurring_bill` ADD `meter_asset_id` text;