-- Backfill canonical deal_stage/deal_state for existing saved deals so aging
-- starts from a sane baseline. stage_entered_at uses the property's
-- updated_at — the best timestamp available without mining free-text events.
-- Additive/idempotent: only touches rows where deal_stage is still NULL.

UPDATE properties p
SET deal_state = CASE
      WHEN pr.id IS NOT NULL THEN 'dead'
      WHEN sd.deal_status IN ('deal_closed', 'archived') THEN 'closed'
      WHEN sd.deal_status = 'rejected' THEN 'dead'
      ELSE 'active'
    END,
    deal_stage = CASE sd.deal_status
      WHEN 'new' THEN 'inbox'
      WHEN 'screening' THEN 'screening'
      WHEN 'interesting' THEN 'screening'
      WHEN 'saved' THEN 'pursuing'
      WHEN 'outreach' THEN 'outreach'
      WHEN 'awaiting_broker' THEN 'outreach'
      WHEN 'om_received' THEN 'om_review'
      WHEN 'underwriting' THEN 'underwriting'
      WHEN 'dossier_generated' THEN 'underwriting'
      WHEN 'tour_scheduled' THEN 'tour'
      WHEN 'tour_completed_awaiting_inputs' THEN 'tour'
      WHEN 'offer_review' THEN 'offer_loi'
      WHEN 'negotiation' THEN 'offer_loi'
      WHEN 'contract_signed' THEN 'contract_dd'
      WHEN 'deal_closed' THEN 'closed'
      WHEN 'archived' THEN 'closed'
      WHEN 'rejected' THEN 'screening'
      ELSE 'pursuing'
    END,
    stage_entered_at = COALESCE(p.stage_entered_at, p.updated_at, now())
FROM saved_deals sd
LEFT JOIN LATERAL (
  SELECT id FROM property_rejections
  WHERE property_id = sd.property_id AND restored_at IS NULL
  ORDER BY rejected_at DESC
  LIMIT 1
) pr ON true
WHERE sd.property_id = p.id
  AND p.deal_stage IS NULL;
