-- Promote deal_stage from the old coarse lifecycle buckets to the exact Deal
-- Progress board taxonomy. deal_state now carries lifecycle state:
-- active, dead, closed. Rejected/archived deals stay recallable via pipeline
-- metadata, but are not active stage work.

WITH latest_saved AS (
  SELECT DISTINCT ON (property_id)
    property_id,
    deal_status::text AS deal_status
  FROM saved_deals
  ORDER BY property_id, created_at DESC
),
active_rejections AS (
  SELECT DISTINCT property_id
  FROM property_rejections
  WHERE restored_at IS NULL
),
desired AS (
  SELECT
    p.id,
    CASE
      WHEN p.deal_stage IN (
        'sourced',
        'om_requested',
        'underwriting_awaiting_review',
        'underwriting_review_completed',
        'tour_requested',
        'tour_scheduled',
        'tour_completed_awaiting_inputs',
        'drafting_loi',
        'loi_sent_awaiting_response',
        'negotiation',
        'contract_signed_diligence',
        'deal_closed'
      ) THEN p.deal_stage
      WHEN p.deal_stage IN ('inbox', 'screening', 'pursuing') THEN 'sourced'
      WHEN p.deal_stage = 'outreach' THEN 'om_requested'
      WHEN p.deal_stage IN ('om_review', 'underwriting') THEN 'underwriting_awaiting_review'
      WHEN p.deal_stage = 'tour'
        AND (
          p.details#>>'{pipeline,dealPath,status}' = 'tour_completed_awaiting_inputs'
          OR p.details#>>'{pipeline,dealPath,tourCompletedAt}' IS NOT NULL
        ) THEN 'tour_completed_awaiting_inputs'
      WHEN p.deal_stage = 'tour'
        AND p.details#>>'{pipeline,dealPath,tourScheduledAt}' IS NOT NULL THEN 'tour_scheduled'
      WHEN p.deal_stage = 'tour' THEN 'tour_requested'
      WHEN p.deal_stage = 'offer_loi'
        AND p.details#>>'{pipeline,uiV2Status}' = 'negotiation' THEN 'negotiation'
      WHEN p.deal_stage = 'offer_loi'
        AND (
          p.details#>>'{pipeline,status}' = 'loi_sent'
          OR p.details#>>'{pipeline,uiV2Status}' = 'loi_sent_awaiting_response'
        ) THEN 'loi_sent_awaiting_response'
      WHEN p.deal_stage = 'offer_loi' THEN 'drafting_loi'
      WHEN p.deal_stage = 'contract_dd' THEN 'contract_signed_diligence'
      WHEN p.deal_stage = 'closed' THEN 'deal_closed'
      WHEN p.deal_stage IN ('offer_review', 'offer_candidate') THEN 'drafting_loi'
      WHEN p.deal_stage = 'loi_sent' THEN 'loi_sent_awaiting_response'
      WHEN p.deal_stage = 'contract_signed' THEN 'contract_signed_diligence'
      WHEN p.deal_stage IN ('archived', 'rejected', 'rejected_removed') THEN 'sourced'
      WHEN p.details#>>'{pipeline,uiV2Status}' IN ('rejected', 'archived') THEN 'sourced'
      WHEN p.details#>>'{pipeline,status}' = 'rejected_removed' THEN 'sourced'
      WHEN p.details#>>'{pipeline,uiV2Status}' IN ('new', 'screening', 'interesting', 'saved') THEN 'sourced'
      WHEN p.details#>>'{pipeline,uiV2Status}' IN ('outreach', 'awaiting_broker') THEN 'om_requested'
      WHEN p.details#>>'{pipeline,uiV2Status}' IN ('om_received', 'underwriting', 'dossier_generated') THEN 'underwriting_awaiting_review'
      WHEN p.details#>>'{pipeline,uiV2Status}' = 'tour_completed_awaiting_inputs' THEN 'tour_completed_awaiting_inputs'
      WHEN p.details#>>'{pipeline,uiV2Status}' = 'tour_scheduled'
        AND p.details#>>'{pipeline,dealPath,tourScheduledAt}' IS NULL THEN 'tour_requested'
      WHEN p.details#>>'{pipeline,uiV2Status}' = 'tour_scheduled' THEN 'tour_scheduled'
      WHEN p.details#>>'{pipeline,uiV2Status}' = 'offer_review' THEN 'drafting_loi'
      WHEN p.details#>>'{pipeline,status}' = 'loi_sent' THEN 'loi_sent_awaiting_response'
      WHEN p.details#>>'{pipeline,uiV2Status}' = 'negotiation' THEN 'negotiation'
      WHEN p.details#>>'{pipeline,uiV2Status}' = 'contract_signed' THEN 'contract_signed_diligence'
      WHEN p.details#>>'{pipeline,uiV2Status}' = 'deal_closed' THEN 'deal_closed'
      WHEN ls.deal_status IN ('new', 'interesting', 'saved') THEN 'sourced'
      WHEN ls.deal_status = 'dossier_generated' THEN 'underwriting_awaiting_review'
      WHEN ls.deal_status = 'rejected' THEN 'sourced'
      ELSE 'sourced'
    END AS next_stage,
    CASE
      WHEN ar.property_id IS NOT NULL THEN 'dead'
      WHEN p.details#>>'{pipeline,status}' = 'rejected_removed' THEN 'dead'
      WHEN p.details#>>'{pipeline,uiV2Status}' IN ('rejected', 'archived') THEN 'dead'
      WHEN ls.deal_status = 'rejected' THEN 'dead'
      WHEN p.deal_stage IN ('closed', 'deal_closed') THEN 'closed'
      WHEN p.details#>>'{pipeline,uiV2Status}' = 'deal_closed' THEN 'closed'
      WHEN ls.deal_status = 'deal_closed' THEN 'closed'
      ELSE COALESCE(NULLIF(p.deal_state, ''), 'active')
    END AS next_state
  FROM properties p
  LEFT JOIN latest_saved ls ON ls.property_id = p.id
  LEFT JOIN active_rejections ar ON ar.property_id = p.id
)
UPDATE properties p
SET deal_stage = desired.next_stage,
    deal_state = desired.next_state,
    stage_entered_at = COALESCE(p.stage_entered_at, p.updated_at, now()),
    updated_at = now()
FROM desired
WHERE desired.id = p.id
  AND (
    p.deal_stage IS DISTINCT FROM desired.next_stage
    OR p.deal_state IS DISTINCT FROM desired.next_state
    OR p.stage_entered_at IS NULL
  );

CREATE OR REPLACE FUNCTION _map_deal_stage_058(stage text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN stage IN (
      'sourced',
      'om_requested',
      'underwriting_awaiting_review',
      'underwriting_review_completed',
      'tour_requested',
      'tour_scheduled',
      'tour_completed_awaiting_inputs',
      'drafting_loi',
      'loi_sent_awaiting_response',
      'negotiation',
      'contract_signed_diligence',
      'deal_closed'
    ) THEN stage
    WHEN stage IN ('inbox', 'screening', 'pursuing') THEN 'sourced'
    WHEN stage = 'outreach' THEN 'om_requested'
    WHEN stage IN ('om_review', 'underwriting') THEN 'underwriting_awaiting_review'
    WHEN stage = 'tour' THEN 'tour_requested'
    WHEN stage IN ('offer_loi', 'offer_review', 'offer_candidate') THEN 'drafting_loi'
    WHEN stage = 'loi_sent' THEN 'loi_sent_awaiting_response'
    WHEN stage = 'negotiation' THEN 'negotiation'
    WHEN stage IN ('contract_dd', 'contract_signed') THEN 'contract_signed_diligence'
    WHEN stage IN ('closed', 'deal_closed') THEN 'deal_closed'
    WHEN stage IN ('archived', 'rejected', 'rejected_removed') THEN 'sourced'
    ELSE stage
  END
$$;

UPDATE stage_transitions
SET from_stage = _map_deal_stage_058(from_stage)
WHERE from_stage IS NOT NULL
  AND from_stage IS DISTINCT FROM _map_deal_stage_058(from_stage);

UPDATE stage_transitions
SET to_stage = _map_deal_stage_058(to_stage)
WHERE to_stage IS DISTINCT FROM _map_deal_stage_058(to_stage);

DROP FUNCTION _map_deal_stage_058(text);

COMMENT ON COLUMN properties.deal_stage IS
  'Canonical Deal Progress stage id: sourced, om_requested, underwriting_awaiting_review, underwriting_review_completed, tour_requested, tour_scheduled, tour_completed_awaiting_inputs, drafting_loi, loi_sent_awaiting_response, negotiation, contract_signed_diligence, deal_closed.';

COMMENT ON COLUMN properties.deal_state IS
  'Deal lifecycle state independent from stage taxonomy: active, dead, closed.';
