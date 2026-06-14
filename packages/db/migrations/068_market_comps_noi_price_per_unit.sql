-- Persist printed/analyst-reviewed comp NOI and $/unit values from market
-- documents. These are not inferred; $/unit may still be derived by readers
-- when absent and sale_price + units_total are available.

ALTER TABLE market_comps ADD COLUMN IF NOT EXISTS noi NUMERIC;
ALTER TABLE market_comps ADD COLUMN IF NOT EXISTS price_per_unit NUMERIC;

COMMENT ON COLUMN market_comps.noi IS 'NOI exactly as printed/reviewed for an extracted comp; never inferred.';
COMMENT ON COLUMN market_comps.price_per_unit IS '$/unit exactly as printed/reviewed for an extracted comp; readers may derive when this is null.';
