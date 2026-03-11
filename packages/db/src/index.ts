/**
 * @re-sourcing/db
 * Repositories and migrations. Import types from @re-sourcing/contracts.
 */

export { getPool, closePool } from "./pool.js";
export { dbConfig, getDatabaseUrl } from "./config.js";
export { mapListing, listingNormalizedToRow } from "./map.js";
export { ProfileRepo } from "./repos/ProfileRepo.js";
export { RunRepo } from "./repos/RunRepo.js";
export { JobRepo } from "./repos/JobRepo.js";
export { ListingRepo } from "./repos/ListingRepo.js";
export type { ListListingsFilters } from "./repos/ListingRepo.js";
export { SnapshotRepo } from "./repos/SnapshotRepo.js";
export type { ListSnapshotsFilters } from "./repos/SnapshotRepo.js";
export { PropertyRepo } from "./repos/PropertyRepo.js";
export { MatchRepo } from "./repos/MatchRepo.js";
export { PermitRepo, PERMIT_SOURCE } from "./repos/PermitRepo.js";
export type { UpsertPermitParams, PermitRow } from "./repos/PermitRepo.js";
export { PropertyEnrichmentStateRepo, ENRICHMENT_PERMITS } from "./repos/PropertyEnrichmentStateRepo.js";
export type { PropertyEnrichmentStateRow, UpsertEnrichmentStateParams } from "./repos/PropertyEnrichmentStateRepo.js";
export { ZoningZtlRepo } from "./repos/ZoningZtlRepo.js";
export type { UpsertZoningZtlParams, ZoningZtlRow } from "./repos/ZoningZtlRepo.js";
export { CertificateOfOccupancyRepo } from "./repos/CertificateOfOccupancyRepo.js";
export type { UpsertCertificateOfOccupancyParams, CertificateOfOccupancyRow } from "./repos/CertificateOfOccupancyRepo.js";
export { HpdRegistrationRepo } from "./repos/HpdRegistrationRepo.js";
export type { UpsertHpdRegistrationParams, HpdRegistrationRow } from "./repos/HpdRegistrationRepo.js";
export { HpdViolationsRepo } from "./repos/HpdViolationsRepo.js";
export type { UpsertHpdViolationParams, HpdViolationRow } from "./repos/HpdViolationsRepo.js";
export { DobComplaintsRepo } from "./repos/DobComplaintsRepo.js";
export type { UpsertDobComplaintParams, DobComplaintRow } from "./repos/DobComplaintsRepo.js";
export { HousingLitigationsRepo } from "./repos/HousingLitigationsRepo.js";
export type { UpsertHousingLitigationParams, HousingLitigationRow } from "./repos/HousingLitigationsRepo.js";
export { AffordableHousingRepo } from "./repos/AffordableHousingRepo.js";
export type { UpsertAffordableHousingParams, AffordableHousingRow } from "./repos/AffordableHousingRepo.js";
export type { ListMatchesFilters } from "./repos/MatchRepo.js";
export { EventRepo } from "./repos/EventRepo.js";
export type { ListEventsFilters } from "./repos/EventRepo.js";
export { mapInquiryEmail, mapInquiryDocument, mapPropertyUploadedDocument } from "./map.js";
export { InquiryEmailRepo } from "./repos/InquiryEmailRepo.js";
export type { InquiryEmailRepoOptions, InsertInquiryEmailParams } from "./repos/InquiryEmailRepo.js";
export { InquiryDocumentRepo } from "./repos/InquiryDocumentRepo.js";
export type { InquiryDocumentRepoOptions, InsertInquiryDocumentParams } from "./repos/InquiryDocumentRepo.js";
export { InquirySendRepo } from "./repos/InquirySendRepo.js";
export type { InquirySendRepoOptions, InquiryReplyMatchingSendRow } from "./repos/InquirySendRepo.js";
export { PropertyUploadedDocumentRepo } from "./repos/PropertyUploadedDocumentRepo.js";
export type { PropertyUploadedDocumentRepoOptions, InsertPropertyUploadedDocumentParams } from "./repos/PropertyUploadedDocumentRepo.js";
export { mapDocument, mapUserProfile, mapSavedDeal, mapDealSignalRow, mapDealScoreOverride } from "./map.js";
export {
  mapBrokerContact,
  mapRecipientResolution,
  mapPropertySourcingState,
  mapPropertyOutreachFlag,
  mapPropertyActionItem,
  mapOutreachBatch,
  mapOutreachBatchItem,
} from "./map.js";
export { DocumentRepo } from "./repos/DocumentRepo.js";
export type { DocumentRepoOptions, InsertDocumentParams } from "./repos/DocumentRepo.js";
export { UserProfileRepo } from "./repos/UserProfileRepo.js";
export type { UserProfileRepoOptions, UpsertUserProfileParams } from "./repos/UserProfileRepo.js";
export { SavedDealsRepo } from "./repos/SavedDealsRepo.js";
export type { SavedDealsRepoOptions } from "./repos/SavedDealsRepo.js";
export { DealSignalsRepo } from "./repos/DealSignalsRepo.js";
export type { DealSignalsRepoOptions, InsertDealSignalsParams } from "./repos/DealSignalsRepo.js";
export { BrokerContactRepo } from "./repos/BrokerContactRepo.js";
export type { BrokerContactRepoOptions, UpsertBrokerContactParams } from "./repos/BrokerContactRepo.js";
export { RecipientResolutionRepo } from "./repos/RecipientResolutionRepo.js";
export type { RecipientResolutionRepoOptions, UpsertRecipientResolutionParams } from "./repos/RecipientResolutionRepo.js";
export { PropertySourcingStateRepo } from "./repos/PropertySourcingStateRepo.js";
export type { PropertySourcingStateRepoOptions, UpsertPropertySourcingStateParams } from "./repos/PropertySourcingStateRepo.js";
export { PropertyOutreachFlagRepo } from "./repos/PropertyOutreachFlagRepo.js";
export type { PropertyOutreachFlagRepoOptions } from "./repos/PropertyOutreachFlagRepo.js";
export { PropertyActionItemRepo } from "./repos/PropertyActionItemRepo.js";
export type { PropertyActionItemRepoOptions } from "./repos/PropertyActionItemRepo.js";
export { OutreachBatchRepo } from "./repos/OutreachBatchRepo.js";
export type { OutreachBatchRepoOptions, CreateOutreachBatchParams } from "./repos/OutreachBatchRepo.js";
export { InboxSyncStateRepo } from "./repos/InboxSyncStateRepo.js";
export type { InboxSyncStateRepoOptions } from "./repos/InboxSyncStateRepo.js";
export { DealScoreOverridesRepo } from "./repos/DealScoreOverridesRepo.js";
export type {
  DealScoreOverridesRepoOptions,
  UpsertDealScoreOverrideParams,
} from "./repos/DealScoreOverridesRepo.js";
export { mapOmAuthoritativeSnapshotRecord, mapOmIngestionRun } from "./map.js";
export { OmIngestionRunRepo } from "./repos/OmIngestionRunRepo.js";
export type {
  CreateOmIngestionRunParams,
  OmIngestionRunRepoOptions,
  UpdateOmIngestionRunParams,
} from "./repos/OmIngestionRunRepo.js";
export { OmAuthoritativeSnapshotRepo } from "./repos/OmAuthoritativeSnapshotRepo.js";
export type {
  OmAuthoritativeSnapshotRepoOptions,
  PromoteOmAuthoritativeSnapshotParams,
} from "./repos/OmAuthoritativeSnapshotRepo.js";
