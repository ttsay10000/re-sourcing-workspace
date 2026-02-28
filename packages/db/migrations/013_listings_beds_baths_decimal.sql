-- Allow decimal beds/baths (e.g. 7.5 baths) so display matches API data

ALTER TABLE listings
  ALTER COLUMN beds TYPE NUMERIC(4,1) USING beds::numeric,
  ALTER COLUMN baths TYPE NUMERIC(4,1) USING baths::numeric;
