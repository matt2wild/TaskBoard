CREATE TABLE `avoided_emission` (
	`id` text PRIMARY KEY NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`occurred_on` text NOT NULL,
	`counterfactual` text NOT NULL,
	`g_co2e_100` integer DEFAULT 0 NOT NULL,
	`g_co2e_20` integer DEFAULT 0 NOT NULL,
	`cost` integer DEFAULT 0 NOT NULL,
	`basis` text DEFAULT 'estimated' NOT NULL,
	`category` text DEFAULT 'other' NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `avoided_source_ix` ON `avoided_emission` (`source_type`,`source_id`);--> statement-breakpoint
CREATE INDEX `avoided_date_ix` ON `avoided_emission` (`occurred_on`);--> statement-breakpoint
CREATE TABLE `bed` (
	`id` text PRIMARY KEY NOT NULL,
	`property_id` text NOT NULL,
	`location_id` text,
	`name` text NOT NULL,
	`method` text DEFAULT 'raised' NOT NULL,
	`area_sqft` real,
	`sun` text,
	`irrigation` text,
	`soil_notes` text,
	`active_from` text,
	`active_to` text,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `bed_property_ix` ON `bed` (`property_id`);--> statement-breakpoint
CREATE TABLE `circulation_event` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`item_type` text,
	`item_id` text,
	`item_text` text,
	`occurred_on` text NOT NULL,
	`contact_id` text,
	`quantity` real,
	`unit` text,
	`value` integer,
	`avoided_g_co2e` integer,
	`note` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `circulation_kind_ix` ON `circulation_event` (`kind`);--> statement-breakpoint
CREATE INDEX `circulation_date_ix` ON `circulation_event` (`occurred_on`);--> statement-breakpoint
CREATE TABLE `compost_event` (
	`id` text PRIMARY KEY NOT NULL,
	`system_id` text NOT NULL,
	`kind` text DEFAULT 'turned' NOT NULL,
	`occurred_on` text NOT NULL,
	`temperature_f` real,
	`moisture` text,
	`note` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text,
	FOREIGN KEY (`system_id`) REFERENCES `compost_system`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `compost_event_system_ix` ON `compost_event` (`system_id`,`occurred_on`);--> statement-breakpoint
CREATE TABLE `compost_input` (
	`id` text PRIMARY KEY NOT NULL,
	`system_id` text NOT NULL,
	`material_key` text NOT NULL,
	`quantity` real NOT NULL,
	`unit` text DEFAULT 'kg' NOT NULL,
	`occurred_on` text NOT NULL,
	`source_type` text,
	`source_id` text,
	`cn_ratio` real,
	`note` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text,
	FOREIGN KEY (`system_id`) REFERENCES `compost_system`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `compost_input_system_ix` ON `compost_input` (`system_id`);--> statement-breakpoint
CREATE INDEX `compost_input_date_ix` ON `compost_input` (`occurred_on`);--> statement-breakpoint
CREATE TABLE `compost_material` (
	`key` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`cn_ratio` real NOT NULL,
	`kind` text DEFAULT 'green' NOT NULL,
	`moisture` text,
	`acceptable` integer DEFAULT true NOT NULL,
	`caution` text,
	`source` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `compost_output` (
	`id` text PRIMARY KEY NOT NULL,
	`system_id` text NOT NULL,
	`occurred_on` text NOT NULL,
	`quantity` real NOT NULL,
	`unit` text DEFAULT 'cuft' NOT NULL,
	`bed_id` text,
	`est_value` integer,
	`note` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text,
	FOREIGN KEY (`system_id`) REFERENCES `compost_system`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `compost_output_system_ix` ON `compost_output` (`system_id`);--> statement-breakpoint
CREATE TABLE `compost_system` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`method` text DEFAULT 'hot_pile' NOT NULL,
	`location_id` text,
	`capacity` real,
	`capacity_unit` text DEFAULT 'cuft' NOT NULL,
	`active_from` text,
	`status` text DEFAULT 'active' NOT NULL,
	`notes` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `garden_observation` (
	`id` text PRIMARY KEY NOT NULL,
	`planting_id` text,
	`bed_id` text,
	`observed_on` text NOT NULL,
	`kind` text DEFAULT 'note' NOT NULL,
	`text` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `observation_planting_ix` ON `garden_observation` (`planting_id`);--> statement-breakpoint
CREATE INDEX `observation_bed_ix` ON `garden_observation` (`bed_id`);--> statement-breakpoint
CREATE TABLE `greenhouse_gas` (
	`key` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`formula` text,
	`gwp_100` real NOT NULL,
	`gwp_20` real NOT NULL,
	`lifetime_years` real,
	`is_biogenic` integer DEFAULT false NOT NULL,
	`kind` text DEFAULT 'primary' NOT NULL,
	`source` text,
	`notes` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `harvest` (
	`id` text PRIMARY KEY NOT NULL,
	`planting_id` text NOT NULL,
	`harvested_on` text NOT NULL,
	`quantity` real NOT NULL,
	`unit` text DEFAULT 'lb' NOT NULL,
	`quality` text,
	`stock_item_id` text,
	`est_value` integer,
	`value_basis` text,
	`notes` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text,
	FOREIGN KEY (`planting_id`) REFERENCES `planting`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `harvest_planting_ix` ON `harvest` (`planting_id`);--> statement-breakpoint
CREATE INDEX `harvest_date_ix` ON `harvest` (`harvested_on`);--> statement-breakpoint
CREATE TABLE `plant_variety` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`cultivar` text,
	`family` text,
	`species` text,
	`category` text DEFAULT 'vegetable' NOT NULL,
	`days_to_maturity` integer,
	`sow_depth_in` real,
	`spacing_in` real,
	`sun` text,
	`frost_hardy` integer DEFAULT false NOT NULL,
	`perennial` integer DEFAULT false NOT NULL,
	`open_pollinated` integer DEFAULT true NOT NULL,
	`seed_viability_years` integer,
	`indoor_weeks` integer,
	`sow_window` text,
	`emission_factor_key` text,
	`typical_price` integer,
	`typical_price_unit` text,
	`yield_per_plant_lb` real,
	`notes` text,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `variety_name_ix` ON `plant_variety` (`name`);--> statement-breakpoint
CREATE INDEX `variety_family_ix` ON `plant_variety` (`family`);--> statement-breakpoint
CREATE TABLE `planting` (
	`id` text PRIMARY KEY NOT NULL,
	`variety_id` text NOT NULL,
	`bed_id` text,
	`seed_lot_id` text,
	`method` text DEFAULT 'direct' NOT NULL,
	`sown_on` text NOT NULL,
	`transplanted_on` text,
	`expected_harvest_on` text,
	`quantity` real,
	`status` text DEFAULT 'growing' NOT NULL,
	`removed_on` text,
	`failure_reason` text,
	`notes` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text,
	FOREIGN KEY (`variety_id`) REFERENCES `plant_variety`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `planting_bed_ix` ON `planting` (`bed_id`);--> statement-breakpoint
CREATE INDEX `planting_variety_ix` ON `planting` (`variety_id`);--> statement-breakpoint
CREATE INDEX `planting_sown_ix` ON `planting` (`sown_on`);--> statement-breakpoint
CREATE TABLE `repair` (
	`id` text PRIMARY KEY NOT NULL,
	`target_type` text,
	`target_id` text,
	`target_text` text,
	`occurred_on` text NOT NULL,
	`symptom` text NOT NULL,
	`work_done` text,
	`parts_cost` integer DEFAULT 0 NOT NULL,
	`time_min` integer,
	`by_user_id` text,
	`by_contact_id` text,
	`outcome` text DEFAULT 'fixed' NOT NULL,
	`extended_life_years` real,
	`avoided_cost` integer,
	`avoided_g_co2e` integer,
	`transaction_id` text,
	`notes` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `repair_target_ix` ON `repair` (`target_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `repair_date_ix` ON `repair` (`occurred_on`);--> statement-breakpoint
CREATE TABLE `seed_lot` (
	`id` text PRIMARY KEY NOT NULL,
	`variety_id` text NOT NULL,
	`origin` text DEFAULT 'bought' NOT NULL,
	`supplier_contact_id` text,
	`saved_from_planting_id` text,
	`quantity` real DEFAULT 0 NOT NULL,
	`unit` text DEFAULT 'seed' NOT NULL,
	`year_packed` integer,
	`location_id` text,
	`cost` integer,
	`germination_rate` real,
	`tested_on` text,
	`notes` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text,
	FOREIGN KEY (`variety_id`) REFERENCES `plant_variety`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `seed_lot_variety_ix` ON `seed_lot` (`variety_id`);--> statement-breakpoint
CREATE INDEX `seed_lot_saved_ix` ON `seed_lot` (`saved_from_planting_id`);--> statement-breakpoint
CREATE TABLE `soil_test` (
	`id` text PRIMARY KEY NOT NULL,
	`bed_id` text NOT NULL,
	`taken_on` text NOT NULL,
	`ph` real,
	`n` real,
	`p` real,
	`k` real,
	`organic_matter_pct` real,
	`lab` text,
	`notes` text,
	`created_at` text NOT NULL,
	`created_by` text,
	`updated_at` text NOT NULL,
	`updated_by` text,
	`deleted_at` text,
	FOREIGN KEY (`bed_id`) REFERENCES `bed`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `soil_test_bed_ix` ON `soil_test` (`bed_id`);--> statement-breakpoint
ALTER TABLE `emission_factor` ADD `gases` text;--> statement-breakpoint
ALTER TABLE `emission` ADD `gas` text DEFAULT 'co2e' NOT NULL;--> statement-breakpoint
ALTER TABLE `emission` ADD `mass_mg` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `emission` ADD `gwp` real DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `emission` ADD `gwp_horizon` integer DEFAULT 100 NOT NULL;--> statement-breakpoint
CREATE INDEX `emission_gas_ix` ON `emission` (`gas`);--> statement-breakpoint
-- Existing rows were recorded as CO₂e with no composition. Under the gas model
-- that is the `co2e` mixture at a potential of 1, so its mass is its own CO₂e
-- figure — in milligrams, the unit gas masses are held in. Backfilling keeps
-- every historical row internally consistent rather than leaving a zero mass
-- behind a non-zero equivalent.
UPDATE `emission` SET `mass_mg` = `g_co2e` * 1000 WHERE `mass_mg` = 0 AND `g_co2e` <> 0;
