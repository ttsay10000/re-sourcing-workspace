-- Deal-intel fields for the analyst lens: who bought/sold, GRM (how small
-- buildings are actually quoted), printed sale conditions (portfolio/partial-
-- interest/etc. prints that must not poison neighborhood medians), and each
-- publisher's stated coverage universe (the fact that reconciles conflicting
-- aggregates across brokerages).

ALTER TABLE market_comps ADD COLUMN IF NOT EXISTS buyer TEXT;
ALTER TABLE market_comps ADD COLUMN IF NOT EXISTS seller TEXT;
-- Gross rent multiplier as printed; never derived or converted to/from cap rate.
ALTER TABLE market_comps ADD COLUMN IF NOT EXISTS grm NUMERIC;
-- Printed/footnoted sale conditions (portfolio_sale, partial_interest, note_sale,
-- ground_lease, distressed, estate_sale, delivered_vacant, 1031_exchange,
-- related_party). Non-arm's-length/non-fee-simple flags exclude a comp from
-- neighborhood median math while keeping it visible.
ALTER TABLE market_comps ADD COLUMN IF NOT EXISTS sale_conditions JSONB NOT NULL DEFAULT '[]';

COMMENT ON COLUMN market_comps.buyer IS 'Purchaser exactly as printed (institutional-trend tracking); never inferred.';
COMMENT ON COLUMN market_comps.sale_conditions IS 'Printed sale-condition flags; portfolio/partial-interest/note/ground-lease prints stay out of rollup medians.';

-- Publisher methodology/universe verbatim ("sales $1M+ in 5+ unit buildings, all
-- Manhattan"); feeds the knowledge + live-review prompts so cross-publisher
-- discrepancies can be explained instead of just flagged.
ALTER TABLE market_documents ADD COLUMN IF NOT EXISTS coverage_universe TEXT;
