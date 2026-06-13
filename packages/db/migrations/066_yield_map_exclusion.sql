-- Per-property yield-map calculation exclusion.
--
-- Operators can scrub individual properties (e.g. rent-stabilized buildings
-- surfacing misleading cap rates) out of every yield-map aggregate — medians,
-- averages, neighborhood/borough stats, and area badges — while keeping the
-- property and its history. The designation persists on the property until
-- explicitly cleared, independent of pipeline stage or rejection status.

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS yield_map_excluded BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS yield_map_excluded_at TIMESTAMPTZ;

COMMENT ON COLUMN properties.yield_map_excluded IS 'Manually scrubbed from yield-map calculations (medians/averages/area stats); the row stays visible behind a toggle.';
COMMENT ON COLUMN properties.yield_map_excluded_at IS 'When the yield-map exclusion was last turned on (NULL while included).';
