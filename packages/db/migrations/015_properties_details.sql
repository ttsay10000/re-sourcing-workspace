-- Optional details on canonical properties (permit, tax, owner, etc.)

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS details JSONB;

COMMENT ON COLUMN properties.details IS 'Optional details: permitInfo, taxCode, buildingLotBlock, ownerInfo, omFurnishedPricing.';
