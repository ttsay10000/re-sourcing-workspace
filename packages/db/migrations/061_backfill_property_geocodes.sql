-- Backfill properties.lat/lng for rows created or matched after 056's one-time
-- backfill ran. The enrichment and listing-refresh flows now keep these columns
-- in sync (apps/api syncPropertyGeocode); this heals existing rows at deploy
-- time so map views are complete immediately. Only touches rows with lat NULL.

-- 1) Building-level coordinates cached in details by BBL resolution
--    (Geoclient or listing sale details).
UPDATE properties p
SET lat = (p.details->>'lat')::double precision,
    lng = (p.details->>'lon')::double precision,
    geocode_source = 'details',
    geocoded_at = now()
WHERE p.lat IS NULL
  AND p.details->>'lat' ~ '^-?[0-9]+(\.[0-9]+)?$'
  AND p.details->>'lon' ~ '^-?[0-9]+(\.[0-9]+)?$'
  AND ABS((p.details->>'lat')::double precision) <= 90
  AND ABS((p.details->>'lon')::double precision) <= 180
  AND NOT ((p.details->>'lat')::double precision = 0 AND (p.details->>'lon')::double precision = 0);

-- 2) Best matched listing coordinates (same source as the 056 backfill, for
--    properties matched since it ran).
UPDATE properties p
SET lat = source.lat,
    lng = source.lon,
    geocode_source = 'listing',
    geocoded_at = now()
FROM (
  SELECT DISTINCT ON (m.property_id) m.property_id, l.lat, l.lon
  FROM listing_property_matches m
  JOIN listings l ON l.id = m.listing_id
  WHERE l.lat IS NOT NULL AND l.lon IS NOT NULL AND m.status <> 'rejected'
  ORDER BY m.property_id, (m.status = 'accepted') DESC, m.confidence DESC NULLS LAST
) AS source
WHERE source.property_id = p.id
  AND p.lat IS NULL
  AND ABS(source.lat) <= 90
  AND ABS(source.lon) <= 180
  AND NOT (source.lat = 0 AND source.lon = 0);

-- 3) PLUTO lot centroid from neighborhood enrichment.
UPDATE properties p
SET lat = (p.details#>>'{neighborhood,geography,latitude}')::double precision,
    lng = (p.details#>>'{neighborhood,geography,longitude}')::double precision,
    geocode_source = 'pluto',
    geocoded_at = now()
WHERE p.lat IS NULL
  AND p.details#>>'{neighborhood,geography,latitude}' ~ '^-?[0-9]+(\.[0-9]+)?$'
  AND p.details#>>'{neighborhood,geography,longitude}' ~ '^-?[0-9]+(\.[0-9]+)?$'
  AND ABS((p.details#>>'{neighborhood,geography,latitude}')::double precision) <= 90
  AND ABS((p.details#>>'{neighborhood,geography,longitude}')::double precision) <= 180
  AND NOT ((p.details#>>'{neighborhood,geography,latitude}')::double precision = 0
       AND (p.details#>>'{neighborhood,geography,longitude}')::double precision = 0);
