-- Rental price history (for rental listings)

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS rental_price_history JSONB;

COMMENT ON COLUMN listings.rental_price_history IS 'Rental/rent price history (date, price, event) when applicable; from LLM extraction.';
