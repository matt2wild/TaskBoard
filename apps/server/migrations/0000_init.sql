CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'checking' NOT NULL,
	`opening_balance` integer DEFAULT 0 NOT NULL,
	`opening_date` text,
	`currency` text,
	`archived` integer DEFAULT false NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `activity_log` (
	`id` text PRIMARY KEY NOT NULL,
	`ts` text NOT NULL,
	`user_id` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`summary` text,
	`diff` text
);
--> statement-breakpoint
CREATE INDEX `activity_entity_ix` ON `activity_log` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `activity_ts_ix` ON `activity_log` (`ts`);--> statement-breakpoint
CREATE TABLE `api_token` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`scope` text DEFAULT 'read' NOT NULL,
	`last_used_at` text,
	`expires_at` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_token_uq` ON `api_token` (`token_hash`);--> statement-breakpoint
CREATE TABLE `asset_category` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`default_lifespan_years` integer,
	`icon` text,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `asset_category_slug_uq` ON `asset_category` (`slug`);--> statement-breakpoint
CREATE TABLE `asset_component` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`name` text NOT NULL,
	`spec` text,
	`product_id` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text,
	FOREIGN KEY (`asset_id`) REFERENCES `asset`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `asset` (
	`id` text PRIMARY KEY NOT NULL,
	`property_id` text NOT NULL,
	`location_id` text,
	`category_id` text,
	`kind` text DEFAULT 'asset' NOT NULL,
	`name` text NOT NULL,
	`make` text,
	`model` text,
	`serial` text,
	`purchase_date` text,
	`purchase_price` integer,
	`purchase_vendor_id` text,
	`purchase_transaction_id` text,
	`installed_date` text,
	`warranty_expiry` text,
	`expected_lifespan_years` integer,
	`replacement_cost_estimate` integer,
	`condition` text DEFAULT 'good' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`retired_at` text,
	`disposal` text,
	`replaced_by_asset_id` text,
	`notes_md` text,
	`custom` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text,
	FOREIGN KEY (`property_id`) REFERENCES `property`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `asset_property_ix` ON `asset` (`property_id`);--> statement-breakpoint
CREATE INDEX `asset_location_ix` ON `asset` (`location_id`);--> statement-breakpoint
CREATE INDEX `asset_kind_ix` ON `asset` (`kind`);--> statement-breakpoint
CREATE INDEX `asset_category_ix` ON `asset` (`category_id`);--> statement-breakpoint
CREATE TABLE `attachment` (
	`id` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`doc_type` text DEFAULT 'other' NOT NULL,
	`title` text,
	`description` text,
	`is_primary` integer DEFAULT false NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text,
	FOREIGN KEY (`file_id`) REFERENCES `file`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `attachment_entity_ix` ON `attachment` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `battery` (
	`id` text PRIMARY KEY NOT NULL,
	`platform_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'battery' NOT NULL,
	`capacity_ah` real,
	`health` text DEFAULT 'good' NOT NULL,
	`purchased_at` text,
	`location_id` text,
	`note` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text,
	FOREIGN KEY (`platform_id`) REFERENCES `battery_platform`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `battery_platform` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`brand` text,
	`voltage` real,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `board_task` (
	`board_id` text NOT NULL,
	`lane_id` text NOT NULL,
	`task_id` text NOT NULL,
	`sort` real DEFAULT 0 NOT NULL,
	PRIMARY KEY(`board_id`, `task_id`),
	FOREIGN KEY (`board_id`) REFERENCES `board`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `board_task_lane_ix` ON `board_task` (`lane_id`);--> statement-breakpoint
CREATE TABLE `board` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`property_id` text,
	`filter` text,
	`owner_user_id` text,
	`shared` integer DEFAULT true NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `budget_allocation` (
	`id` text PRIMARY KEY NOT NULL,
	`period` text NOT NULL,
	`category_id` text NOT NULL,
	`amount` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `allocation_uq` ON `budget_allocation` (`period`,`category_id`);--> statement-breakpoint
CREATE TABLE `category` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`kind` text DEFAULT 'expense' NOT NULL,
	`rollover_rule` text DEFAULT 'none' NOT NULL,
	`archived` integer DEFAULT false NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `category_parent_ix` ON `category` (`parent_id`);--> statement-breakpoint
CREATE TABLE `checklist_item` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`text` text NOT NULL,
	`done` integer DEFAULT false NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `checklist_task_ix` ON `checklist_item` (`task_id`);--> statement-breakpoint
CREATE TABLE `checklist_template` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`items` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `comment` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`user_id` text NOT NULL,
	`body_md` text NOT NULL,
	`parent_comment_id` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `comment_entity_ix` ON `comment` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `contact` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'vendor' NOT NULL,
	`phones` text,
	`email` text,
	`website` text,
	`address` text,
	`notes_md` text,
	`rating` integer,
	`preferred` integer DEFAULT false NOT NULL,
	`specialties` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `contact_type_ix` ON `contact` (`type`);--> statement-breakpoint
CREATE INDEX `contact_name_ix` ON `contact` (`name`);--> statement-breakpoint
CREATE TABLE `decision` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`decided_at` text NOT NULL,
	`title` text NOT NULL,
	`rationale_md` text,
	`alternatives_md` text,
	`decided_by` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `decision_project_ix` ON `decision` (`project_id`);--> statement-breakpoint
CREATE TABLE `entity_link` (
	`id` text PRIMARY KEY NOT NULL,
	`from_type` text NOT NULL,
	`from_id` text NOT NULL,
	`to_type` text NOT NULL,
	`to_id` text NOT NULL,
	`relation` text DEFAULT 'related' NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	`created_by` text
);
--> statement-breakpoint
CREATE INDEX `entity_link_from_ix` ON `entity_link` (`from_type`,`from_id`);--> statement-breakpoint
CREATE INDEX `entity_link_to_ix` ON `entity_link` (`to_type`,`to_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `entity_link_uq` ON `entity_link` (`from_type`,`from_id`,`to_type`,`to_id`,`relation`);--> statement-breakpoint
CREATE TABLE `entity_tag` (
	`tag_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`tag_id`, `entity_type`, `entity_id`),
	FOREIGN KEY (`tag_id`) REFERENCES `tag`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `entity_tag_entity_ix` ON `entity_tag` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `file` (
	`id` text PRIMARY KEY NOT NULL,
	`sha256` text NOT NULL,
	`size` integer NOT NULL,
	`mime` text NOT NULL,
	`original_name` text NOT NULL,
	`width` integer,
	`height` integer,
	`storage_key` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `file_sha_ix` ON `file` (`sha256`);--> statement-breakpoint
CREATE TABLE `goal` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`target_amount` integer NOT NULL,
	`target_date` text,
	`account_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`notes_md` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `household` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`locale` text DEFAULT 'en-US' NOT NULL,
	`unit_system` text DEFAULT 'imperial' NOT NULL,
	`settings` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `import_profile` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`mapping` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `inspection` (
	`id` text PRIMARY KEY NOT NULL,
	`permit_id` text NOT NULL,
	`task_id` text,
	`name` text NOT NULL,
	`scheduled_at` text,
	`outcome` text,
	`notes` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text,
	FOREIGN KEY (`permit_id`) REFERENCES `permit`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `invite` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`email` text,
	`expires_at` text NOT NULL,
	`used_by_user_id` text,
	`used_at` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invite_token_uq` ON `invite` (`token_hash`);--> statement-breakpoint
CREATE TABLE `job_run` (
	`id` text PRIMARY KEY NOT NULL,
	`job_key` text NOT NULL,
	`ran_for_date` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text DEFAULT 'running' NOT NULL,
	`detail` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_run_uq` ON `job_run` (`job_key`,`ran_for_date`);--> statement-breakpoint
CREATE TABLE `label_code` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`assigned_at` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `label_code_uq` ON `label_code` (`code`);--> statement-breakpoint
CREATE INDEX `label_entity_ix` ON `label_code` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `lane` (
	`id` text PRIMARY KEY NOT NULL,
	`board_id` text NOT NULL,
	`name` text NOT NULL,
	`status_mapping` text,
	`wip_limit` integer,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text,
	FOREIGN KEY (`board_id`) REFERENCES `board`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `lane_board_ix` ON `lane` (`board_id`);--> statement-breakpoint
CREATE TABLE `loan` (
	`id` text PRIMARY KEY NOT NULL,
	`item_type` text DEFAULT 'storage_item' NOT NULL,
	`item_id` text NOT NULL,
	`direction` text DEFAULT 'out' NOT NULL,
	`contact_id` text,
	`contact_name` text,
	`lent_at` text NOT NULL,
	`due_back` text,
	`returned_at` text,
	`return_condition` text,
	`task_id` text,
	`note` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `loan_item_ix` ON `loan` (`item_type`,`item_id`);--> statement-breakpoint
CREATE INDEX `loan_open_ix` ON `loan` (`returned_at`);--> statement-breakpoint
CREATE TABLE `location` (
	`id` text PRIMARY KEY NOT NULL,
	`property_id` text NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`type` text DEFAULT 'room' NOT NULL,
	`short_code` text,
	`description` text,
	`photo_file_id` text,
	`holds_food` integer DEFAULT false NOT NULL,
	`temperature_class` text,
	`dimensions` text,
	`path_cache` text,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text,
	FOREIGN KEY (`property_id`) REFERENCES `property`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `location_parent_ix` ON `location` (`parent_id`);--> statement-breakpoint
CREATE INDEX `location_property_ix` ON `location` (`property_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `location_code_uq` ON `location` (`short_code`);--> statement-breakpoint
CREATE TABLE `maintenance_consumption` (
	`id` text PRIMARY KEY NOT NULL,
	`record_id` text NOT NULL,
	`product_id` text NOT NULL,
	`stock_item_id` text,
	`quantity` real NOT NULL,
	`unit` text DEFAULT 'ea' NOT NULL,
	FOREIGN KEY (`record_id`) REFERENCES `maintenance_record`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `maintenance_plan` (
	`id` text PRIMARY KEY NOT NULL,
	`target_type` text DEFAULT 'asset' NOT NULL,
	`target_id` text NOT NULL,
	`title` text NOT NULL,
	`description_md` text,
	`schedule_id` text,
	`estimate_min` integer,
	`estimate_cost` integer,
	`priority` text DEFAULT 'normal' NOT NULL,
	`diy` integer DEFAULT true NOT NULL,
	`vendor_contact_id` text,
	`assignee_user_id` text,
	`checklist` text,
	`season_tags` text,
	`grace_days` integer,
	`reading_trigger` text,
	`instructions_md` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `plan_target_ix` ON `maintenance_plan` (`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `maintenance_record` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`task_id` text,
	`kind` text DEFAULT 'planned' NOT NULL,
	`title` text NOT NULL,
	`performed_at` text NOT NULL,
	`performer_user_id` text,
	`performer_contact_id` text,
	`cost_transaction_id` text,
	`minutes` integer,
	`notes_md` text,
	`failure_description` text,
	`cause` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `record_target_ix` ON `maintenance_record` (`target_type`,`target_id`,`performed_at`);--> statement-breakpoint
CREATE INDEX `record_plan_ix` ON `maintenance_record` (`plan_id`);--> statement-breakpoint
CREATE TABLE `maintenance_template` (
	`id` text PRIMARY KEY NOT NULL,
	`category_slug` text NOT NULL,
	`title` text NOT NULL,
	`description_md` text,
	`mode` text DEFAULT 'fixed' NOT NULL,
	`rrule` text,
	`every` text,
	`estimate_min` integer,
	`diy` integer DEFAULT true NOT NULL,
	`season_tags` text,
	`checklist` text,
	`consumables` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `mtemplate_cat_ix` ON `maintenance_template` (`category_slug`);--> statement-breakpoint
CREATE TABLE `meal_plan_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`slot` text DEFAULT 'dinner' NOT NULL,
	`recipe_id` text,
	`text` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `meal_plan_date_ix` ON `meal_plan_entry` (`date`);--> statement-breakpoint
CREATE TABLE `notification_delivery` (
	`id` text PRIMARY KEY NOT NULL,
	`notification_id` text NOT NULL,
	`channel` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`delivered_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`notification_id`) REFERENCES `notification`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `delivery_status_ix` ON `notification_delivery` (`status`);--> statement-breakpoint
CREATE TABLE `notification_pref` (
	`user_id` text NOT NULL,
	`event_type` text NOT NULL,
	`channels` text,
	`timing` text DEFAULT 'immediate' NOT NULL,
	`lead_days` text,
	PRIMARY KEY(`user_id`, `event_type`)
);
--> statement-breakpoint
CREATE TABLE `notification` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`event_type` text NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`title` text NOT NULL,
	`body` text,
	`dedupe_key` text NOT NULL,
	`created_at` text NOT NULL,
	`read_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_dedupe_uq` ON `notification` (`user_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `notification_user_ix` ON `notification` (`user_id`,`read_at`);--> statement-breakpoint
CREATE TABLE `payee` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`contact_id` text,
	`default_category_id` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payee_name_uq` ON `payee` (`name`);--> statement-breakpoint
CREATE TABLE `permit` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`authority_contact_id` text,
	`name` text NOT NULL,
	`permit_number` text,
	`fee_transaction_id` text,
	`applied_at` text,
	`issued_at` text,
	`expires_at` text,
	`status` text DEFAULT 'applied' NOT NULL,
	`notes_md` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `pet_claim` (
	`id` text PRIMARY KEY NOT NULL,
	`insurance_id` text NOT NULL,
	`visit_id` text,
	`claimed_amount` integer NOT NULL,
	`reimbursed_transaction_id` text,
	`status` text DEFAULT 'submitted' NOT NULL,
	`submitted_at` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text,
	FOREIGN KEY (`insurance_id`) REFERENCES `pet_insurance`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `pet_condition` (
	`id` text PRIMARY KEY NOT NULL,
	`pet_id` text NOT NULL,
	`name` text NOT NULL,
	`onset_date` text,
	`status` text DEFAULT 'active' NOT NULL,
	`notes_md` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text,
	FOREIGN KEY (`pet_id`) REFERENCES `pet`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `condition_pet_ix` ON `pet_condition` (`pet_id`);--> statement-breakpoint
CREATE TABLE `pet_diet_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`pet_id` text NOT NULL,
	`time_of_day` text NOT NULL,
	`product_id` text,
	`description` text,
	`amount` real DEFAULT 1 NOT NULL,
	`unit` text DEFAULT 'ea' NOT NULL,
	`active_from` text,
	`active_to` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text,
	FOREIGN KEY (`pet_id`) REFERENCES `pet`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `diet_pet_ix` ON `pet_diet_entry` (`pet_id`);--> statement-breakpoint
CREATE TABLE `pet_dose` (
	`id` text PRIMARY KEY NOT NULL,
	`medication_id` text NOT NULL,
	`pet_id` text NOT NULL,
	`task_id` text,
	`due_date` text NOT NULL,
	`due_time` text NOT NULL,
	`due_at` text NOT NULL,
	`given_at` text,
	`given_by` text,
	`status` text DEFAULT 'due' NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text,
	FOREIGN KEY (`medication_id`) REFERENCES `pet_medication`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dose_slot_uq` ON `pet_dose` (`medication_id`,`due_date`,`due_time`);--> statement-breakpoint
CREATE INDEX `dose_due_ix` ON `pet_dose` (`due_at`,`status`);--> statement-breakpoint
CREATE INDEX `dose_pet_ix` ON `pet_dose` (`pet_id`);--> statement-breakpoint
CREATE TABLE `pet_insurance` (
	`id` text PRIMARY KEY NOT NULL,
	`pet_id` text NOT NULL,
	`insurer_contact_id` text,
	`policy_number` text,
	`premium_bill_id` text,
	`deductible` integer,
	`reimbursement_pct` real,
	`notes_md` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text,
	FOREIGN KEY (`pet_id`) REFERENCES `pet`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `pet_journal` (
	`id` text PRIMARY KEY NOT NULL,
	`pet_id` text NOT NULL,
	`ts` text NOT NULL,
	`body_md` text NOT NULL,
	`tags` text,
	`severity` text DEFAULT 'info' NOT NULL,
	`visit_id` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text,
	FOREIGN KEY (`pet_id`) REFERENCES `pet`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `journal_pet_ix` ON `pet_journal` (`pet_id`,`ts`);--> statement-breakpoint
CREATE TABLE `pet_lab_result` (
	`id` text PRIMARY KEY NOT NULL,
	`pet_id` text NOT NULL,
	`visit_id` text,
	`test` text NOT NULL,
	`value` real NOT NULL,
	`unit` text,
	`ref_low` real,
	`ref_high` real,
	`taken_at` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text,
	FOREIGN KEY (`pet_id`) REFERENCES `pet`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `lab_pet_ix` ON `pet_lab_result` (`pet_id`,`test`,`taken_at`);--> statement-breakpoint
CREATE TABLE `pet_medication` (
	`id` text PRIMARY KEY NOT NULL,
	`pet_id` text NOT NULL,
	`name` text NOT NULL,
	`form` text,
	`strength` text,
	`dose` text,
	`route` text,
	`times_of_day` text,
	`every_days` integer DEFAULT 1 NOT NULL,
	`kind` text DEFAULT 'medication' NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`ongoing` integer DEFAULT true NOT NULL,
	`vet_contact_id` text,
	`pharmacy_contact_id` text,
	`product_id` text,
	`doses_per_unit` real DEFAULT 1 NOT NULL,
	`refills_remaining` integer,
	`refill_qty` real,
	`instructions_md` text,
	`condition_id` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text,
	FOREIGN KEY (`pet_id`) REFERENCES `pet`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `med_pet_ix` ON `pet_medication` (`pet_id`,`active`);--> statement-breakpoint
CREATE TABLE `pet_vaccination` (
	`id` text PRIMARY KEY NOT NULL,
	`pet_id` text NOT NULL,
	`vaccine` text NOT NULL,
	`given_at` text NOT NULL,
	`provider_contact_id` text,
	`lot` text,
	`next_due` text,
	`task_id` text,
	`notes` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text,
	FOREIGN KEY (`pet_id`) REFERENCES `pet`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `vax_pet_ix` ON `pet_vaccination` (`pet_id`);--> statement-breakpoint
CREATE INDEX `vax_due_ix` ON `pet_vaccination` (`next_due`);--> statement-breakpoint
CREATE TABLE `pet_visit` (
	`id` text PRIMARY KEY NOT NULL,
	`pet_id` text NOT NULL,
	`visited_at` text NOT NULL,
	`provider_contact_id` text,
	`reason` text NOT NULL,
	`notes_md` text,
	`diagnosis` text,
	`weight` real,
	`weight_unit` text,
	`follow_up_date` text,
	`follow_up_task_id` text,
	`cost_transaction_id` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text,
	FOREIGN KEY (`pet_id`) REFERENCES `pet`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `visit_pet_ix` ON `pet_visit` (`pet_id`,`visited_at`);--> statement-breakpoint
CREATE TABLE `pet_weight` (
	`id` text PRIMARY KEY NOT NULL,
	`pet_id` text NOT NULL,
	`taken_at` text NOT NULL,
	`weight` real NOT NULL,
	`unit` text DEFAULT 'lb' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`visit_id` text,
	`note` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text,
	FOREIGN KEY (`pet_id`) REFERENCES `pet`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `weight_pet_ix` ON `pet_weight` (`pet_id`,`taken_at`);--> statement-breakpoint
CREATE TABLE `pet` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`species_code` text DEFAULT 'cat' NOT NULL,
	`breed` text,
	`sex` text,
	`neutered` integer,
	`dob` text,
	`adopted_at` text,
	`microchip` text,
	`markings` text,
	`photo_file_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`status_date` text,
	`primary_vet_contact_id` text,
	`emergency_vet_contact_id` text,
	`target_weight_min` real,
	`target_weight_max` real,
	`weight_unit` text DEFAULT 'lb' NOT NULL,
	`care_notes_md` text,
	`notes_md` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `maintenance_plan_consumable` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`product_id` text NOT NULL,
	`quantity` real DEFAULT 1 NOT NULL,
	`unit` text DEFAULT 'ea' NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `maintenance_plan`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `maintenance_plan_tool` (
	`plan_id` text NOT NULL,
	`asset_id` text NOT NULL,
	PRIMARY KEY(`plan_id`, `asset_id`),
	FOREIGN KEY (`plan_id`) REFERENCES `maintenance_plan`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `product_barcode` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`barcode` text NOT NULL,
	`symbology` text,
	FOREIGN KEY (`product_id`) REFERENCES `product`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `barcode_uq` ON `product_barcode` (`barcode`);--> statement-breakpoint
CREATE TABLE `product_category` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`is_food` integer DEFAULT true NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_category_slug_uq` ON `product_category` (`slug`);--> statement-breakpoint
CREATE TABLE `product` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`brand` text,
	`category_id` text,
	`is_food` integer DEFAULT true NOT NULL,
	`is_pet_supply` integer DEFAULT false NOT NULL,
	`default_unit` text DEFAULT 'ea' NOT NULL,
	`package_size` real,
	`package_unit` text,
	`shelf_life` text,
	`use_within_days_opened` integer,
	`min_quantity` real,
	`auto_shopping` integer DEFAULT true NOT NULL,
	`default_location_id` text,
	`image_file_id` text,
	`nutrition` text,
	`spec` text,
	`notes` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `product_name_ix` ON `product` (`name`);--> statement-breakpoint
CREATE INDEX `product_category_ix` ON `product` (`category_id`);--> statement-breakpoint
CREATE TABLE `project_location` (
	`project_id` text NOT NULL,
	`location_id` text NOT NULL,
	PRIMARY KEY(`project_id`, `location_id`),
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `project_material` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`phase_id` text,
	`product_id` text,
	`description` text NOT NULL,
	`quantity` real DEFAULT 1 NOT NULL,
	`unit` text DEFAULT 'ea' NOT NULL,
	`est_unit_cost` integer,
	`actual_cost` integer,
	`status` text DEFAULT 'needed' NOT NULL,
	`supplier_contact_id` text,
	`transaction_id` text,
	`storage_item_id` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `material_project_ix` ON `project_material` (`project_id`);--> statement-breakpoint
CREATE INDEX `material_status_ix` ON `project_material` (`status`);--> statement-breakpoint
CREATE TABLE `project_phase` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`target_start` text,
	`target_end` text,
	`status` text DEFAULT 'planning' NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `phase_project_ix` ON `project_phase` (`project_id`);--> statement-breakpoint
CREATE TABLE `project_template` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description_md` text,
	`phases` text,
	`materials` text,
	`tools` text,
	`permits` text,
	`budget_breakdown` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `project_tool_wish` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`description` text NOT NULL,
	`est_cost` integer,
	`rent_or_buy` text DEFAULT 'buy' NOT NULL,
	`note` text,
	`resolved_asset_id` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `project_tool` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`required_from` text,
	`required_to` text,
	`checked_out_at` text,
	`checked_in_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_tool_uq` ON `project_tool` (`project_id`,`asset_id`);--> statement-breakpoint
CREATE TABLE `project` (
	`id` text PRIMARY KEY NOT NULL,
	`property_id` text NOT NULL,
	`name` text NOT NULL,
	`description_md` text,
	`status` text DEFAULT 'idea' NOT NULL,
	`owner_user_id` text,
	`priority` text DEFAULT 'normal' NOT NULL,
	`target_start` text,
	`target_end` text,
	`actual_start` text,
	`actual_end` text,
	`budget_amount` integer,
	`budget_breakdown` text,
	`cover_file_id` text,
	`estimate_cost` integer,
	`retrospective` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `project_status_ix` ON `project` (`status`);--> statement-breakpoint
CREATE TABLE `property` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'house' NOT NULL,
	`address` text,
	`purchase_date` text,
	`purchase_price` integer,
	`area_sqft` real,
	`year_built` integer,
	`lot_size` text,
	`notes_md` text,
	`profile` text,
	`is_primary` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `quote` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`contact_id` text,
	`scope` text NOT NULL,
	`amount` integer,
	`quoted_at` text,
	`valid_until` text,
	`status` text DEFAULT 'requested' NOT NULL,
	`notes_md` text,
	`lines` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `quote_project_ix` ON `quote` (`project_id`);--> statement-breakpoint
CREATE TABLE `reading` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`metric` text NOT NULL,
	`value` real NOT NULL,
	`unit` text,
	`taken_at` text NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text,
	FOREIGN KEY (`asset_id`) REFERENCES `asset`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reading_asset_ix` ON `reading` (`asset_id`,`metric`,`taken_at`);--> statement-breakpoint
CREATE TABLE `recipe_ingredient` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_id` text NOT NULL,
	`product_id` text,
	`text` text NOT NULL,
	`quantity` real DEFAULT 1 NOT NULL,
	`unit` text DEFAULT 'ea' NOT NULL,
	`optional` integer DEFAULT false NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `recipe` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`servings` real DEFAULT 2 NOT NULL,
	`prep_min` integer,
	`cook_min` integer,
	`steps_md` text,
	`source_url` text,
	`image_file_id` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `recurring_bill` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`payee_id` text,
	`category_id` text,
	`account_id` text,
	`amount` integer,
	`variable` integer DEFAULT false NOT NULL,
	`schedule_id` text,
	`lead_days` integer DEFAULT 5 NOT NULL,
	`every_months` integer DEFAULT 1 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `saved_view` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`list_key` text NOT NULL,
	`name` text NOT NULL,
	`filters` text,
	`shared` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `schedule` (
	`id` text PRIMARY KEY NOT NULL,
	`mode` text DEFAULT 'one_off' NOT NULL,
	`rrule` text,
	`anchor_date` text,
	`every` text,
	`time_of_day` text,
	`grace_days` integer,
	`until_date` text,
	`count` integer,
	`horizon_days` integer DEFAULT 45 NOT NULL,
	`next_due` text,
	`last_completed_at` text,
	`template` text,
	`origin_type` text DEFAULT 'manual' NOT NULL,
	`origin_id` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `schedule_origin_ix` ON `schedule` (`origin_type`,`origin_id`);--> statement-breakpoint
CREATE INDEX `schedule_next_ix` ON `schedule` (`next_due`);--> statement-breakpoint
CREATE TABLE `service_account` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_id` text NOT NULL,
	`kind` text NOT NULL,
	`account_number_enc` text,
	`emergency_phone` text,
	`recurring_bill_id` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text,
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`ip` text,
	`user_agent` text,
	`created_at` text NOT NULL,
	`last_seen_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_uq` ON `session` (`token_hash`);--> statement-breakpoint
CREATE INDEX `session_user_ix` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `setting` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shopping_line` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`product_id` text,
	`text` text NOT NULL,
	`quantity` real DEFAULT 1 NOT NULL,
	`unit` text DEFAULT 'ea' NOT NULL,
	`note` text,
	`store_contact_id` text,
	`checked_at` text,
	`checked_by` text,
	`source_type` text,
	`source_id` text,
	`sort` real DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text,
	FOREIGN KEY (`list_id`) REFERENCES `shopping_list`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `shopping_line_list_ix` ON `shopping_line` (`list_id`);--> statement-breakpoint
CREATE INDEX `shopping_line_source_ix` ON `shopping_line` (`source_type`,`source_id`);--> statement-breakpoint
CREATE TABLE `shopping_list` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`store_contact_id` text,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `species_profile` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`labels` text,
	`vaccine_presets` text,
	`journal_tags` text,
	`common_conditions` text,
	`lab_tests` text,
	`weight_warn_pct` real DEFAULT 10 NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `species_code_uq` ON `species_profile` (`code`);--> statement-breakpoint
CREATE TABLE `split_attribution` (
	`id` text PRIMARY KEY NOT NULL,
	`split_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	FOREIGN KEY (`split_id`) REFERENCES `transaction_split`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `attribution_entity_ix` ON `split_attribution` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `attribution_split_ix` ON `split_attribution` (`split_id`);--> statement-breakpoint
CREATE TABLE `stock_item` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`location_id` text,
	`quantity` real DEFAULT 0 NOT NULL,
	`unit` text DEFAULT 'ea' NOT NULL,
	`expiry_date` text,
	`opened_at` text,
	`purchased_at` text,
	`transaction_id` text,
	`unit_price` integer,
	`note` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text,
	FOREIGN KEY (`product_id`) REFERENCES `product`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `stock_product_ix` ON `stock_item` (`product_id`);--> statement-breakpoint
CREATE INDEX `stock_location_ix` ON `stock_item` (`location_id`);--> statement-breakpoint
CREATE INDEX `stock_expiry_ix` ON `stock_item` (`expiry_date`);--> statement-breakpoint
CREATE TABLE `stock_movement` (
	`id` text PRIMARY KEY NOT NULL,
	`stock_item_id` text,
	`product_id` text NOT NULL,
	`delta` real NOT NULL,
	`unit` text DEFAULT 'ea' NOT NULL,
	`reason` text NOT NULL,
	`user_id` text,
	`ts` text NOT NULL,
	`ref_type` text,
	`ref_id` text,
	`note` text
);
--> statement-breakpoint
CREATE INDEX `movement_product_ix` ON `stock_movement` (`product_id`,`ts`);--> statement-breakpoint
CREATE TABLE `storage_category` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `storage_category_slug_uq` ON `storage_category` (`slug`);--> statement-breakpoint
CREATE TABLE `storage_item` (
	`id` text PRIMARY KEY NOT NULL,
	`location_id` text,
	`category_id` text,
	`name` text NOT NULL,
	`description` text,
	`quantity` real DEFAULT 1 NOT NULL,
	`unit` text DEFAULT 'ea' NOT NULL,
	`est_value` integer,
	`purchase_date` text,
	`purchase_price` integer,
	`condition` text DEFAULT 'good' NOT NULL,
	`review_by` text,
	`project_id` text,
	`status` text DEFAULT 'stored' NOT NULL,
	`last_seen_at` text,
	`notes_md` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `storage_item_location_ix` ON `storage_item` (`location_id`);--> statement-breakpoint
CREATE INDEX `storage_item_name_ix` ON `storage_item` (`name`);--> statement-breakpoint
CREATE TABLE `tag` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`colour` text DEFAULT 'slate' NOT NULL,
	`description` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tag_name_uq` ON `tag` (`name`);--> statement-breakpoint
CREATE TABLE `task_assignee` (
	`task_id` text NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY(`task_id`, `user_id`),
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_assignee_user_ix` ON `task_assignee` (`user_id`);--> statement-breakpoint
CREATE TABLE `task_dependency` (
	`task_id` text NOT NULL,
	`blocked_by_task_id` text NOT NULL,
	PRIMARY KEY(`task_id`, `blocked_by_task_id`),
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `task` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description_md` text,
	`status` text DEFAULT 'open' NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`due_date` text,
	`due_time` text,
	`start_date` text,
	`parent_task_id` text,
	`origin_type` text DEFAULT 'manual' NOT NULL,
	`origin_id` text,
	`schedule_id` text,
	`property_id` text,
	`location_id` text,
	`project_id` text,
	`phase_id` text,
	`estimate_min` integer,
	`actual_min` integer,
	`completed_at` text,
	`completed_by` text,
	`completion_note` text,
	`visibility` text DEFAULT 'household' NOT NULL,
	`sort_key` real DEFAULT 0 NOT NULL,
	`snoozed_from` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `task_status_due_ix` ON `task` (`status`,`due_date`);--> statement-breakpoint
CREATE INDEX `task_origin_ix` ON `task` (`origin_type`,`origin_id`);--> statement-breakpoint
CREATE INDEX `task_project_ix` ON `task` (`project_id`);--> statement-breakpoint
CREATE INDEX `task_schedule_ix` ON `task` (`schedule_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `task_schedule_instance_uq` ON `task` (`schedule_id`,`due_date`);--> statement-breakpoint
CREATE TABLE `time_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`user_id` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`minutes` integer,
	`note` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tool_consumable_product` (
	`spec_id` text NOT NULL,
	`product_id` text NOT NULL,
	PRIMARY KEY(`spec_id`, `product_id`),
	FOREIGN KEY (`spec_id`) REFERENCES `tool_consumable_spec`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tool_consumable_spec` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`description` text NOT NULL,
	`spec` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text,
	FOREIGN KEY (`asset_id`) REFERENCES `asset`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tool_kit_member` (
	`kit_id` text NOT NULL,
	`asset_id` text NOT NULL,
	PRIMARY KEY(`kit_id`, `asset_id`),
	FOREIGN KEY (`kit_id`) REFERENCES `tool_kit`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tool_kit` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`location_id` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `tool_profile` (
	`asset_id` text PRIMARY KEY NOT NULL,
	`tool_type` text DEFAULT 'hand' NOT NULL,
	`power_source` text,
	`battery_platform_id` text,
	`status` text DEFAULT 'available' NOT NULL,
	`accessories` text,
	`hours_used` real DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `tool_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`project_id` text,
	`task_id` text,
	`ts` text NOT NULL,
	`hours` real DEFAULT 0 NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `transaction_line_item` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`product_id` text,
	`description` text NOT NULL,
	`quantity` real DEFAULT 1 NOT NULL,
	`unit` text DEFAULT 'ea' NOT NULL,
	`unit_price` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transaction`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `line_item_product_ix` ON `transaction_line_item` (`product_id`);--> statement-breakpoint
CREATE TABLE `transaction_split` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`amount` integer NOT NULL,
	`category_id` text,
	`memo` text,
	`sort` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `transaction`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `split_transaction_ix` ON `transaction_split` (`transaction_id`);--> statement-breakpoint
CREATE INDEX `split_category_ix` ON `transaction_split` (`category_id`);--> statement-breakpoint
CREATE TABLE `transaction` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text,
	`fx_rate` real,
	`type` text DEFAULT 'expense' NOT NULL,
	`account_id` text,
	`transfer_account_id` text,
	`payee_id` text,
	`memo` text,
	`cleared` integer DEFAULT false NOT NULL,
	`paid_by_user_id` text,
	`shared` integer DEFAULT true NOT NULL,
	`import_hash` text,
	`recurring_bill_id` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `transaction_date_ix` ON `transaction` (`date`);--> statement-breakpoint
CREATE INDEX `transaction_account_ix` ON `transaction` (`account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `transaction_import_uq` ON `transaction` (`import_hash`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`password_hash` text,
	`role` text DEFAULT 'member' NOT NULL,
	`avatar_file_id` text,
	`is_active` integer DEFAULT true NOT NULL,
	`totp_secret` text,
	`prefs` text,
	`last_login_at` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_uq` ON `user` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_username_uq` ON `user` (`username`);--> statement-breakpoint
CREATE TABLE `warranty` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`provider_contact_id` text,
	`type` text DEFAULT 'manufacturer' NOT NULL,
	`start_date` text,
	`end_date` text NOT NULL,
	`coverage_md` text,
	`claim_contact` text,
	`cost_transaction_id` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text,
	FOREIGN KEY (`asset_id`) REFERENCES `asset`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `warranty_asset_ix` ON `warranty` (`asset_id`);--> statement-breakpoint
CREATE INDEX `warranty_end_ix` ON `warranty` (`end_date`);--> statement-breakpoint
CREATE TABLE `waste_log` (
	`id` text PRIMARY KEY NOT NULL,
	`stock_item_id` text,
	`product_id` text NOT NULL,
	`quantity` real NOT NULL,
	`unit` text DEFAULT 'ea' NOT NULL,
	`reason` text DEFAULT 'expired' NOT NULL,
	`est_cost` integer,
	`ts` text NOT NULL,
	`user_id` text
);
--> statement-breakpoint
CREATE INDEX `waste_ts_ix` ON `waste_log` (`ts`);