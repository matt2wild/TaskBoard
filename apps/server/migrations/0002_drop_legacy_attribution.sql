-- Carry the money attributions onto the shared ledger before the old table goes.
INSERT INTO `attribution` (`id`, `source_kind`, `source_id`, `entity_type`, `entity_id`, `created_at`)
SELECT `id`, 'split', `split_id`, `entity_type`, `entity_id`, CURRENT_TIMESTAMP
FROM `split_attribution`;
--> statement-breakpoint
DROP TABLE `split_attribution`;