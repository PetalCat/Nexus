-- Apr-17 data-model unification, part 3/3: drop the legacy `activity` table.
-- Backfill happened in 0007, writers stopped targeting it in the same PR.
-- See docs/superpowers/specs/2026-04-17-data-model-unification-plan.md.

DROP TABLE IF EXISTS `activity`;
