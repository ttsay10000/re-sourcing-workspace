/**
 * Types for permit enrichment: Socrata row shape, query options, summary.
 */

export interface PermitsSummary {
  count?: number;
  last_issued_date?: string;
  owner_business_name?: string;
  owner_name?: string;
}

/** Raw row from Socrata (API returns snake_case field names). */
export interface SocrataPermitRow {
  bbl?: string | null;
  block?: string | null;
  lot?: string | null;
  bin?: string | null;
  borough?: string | null;
  house_no?: string | null;
  street_name?: string | null;
  owner_business_name?: string | null;
  owner_name?: string | null;
  permit_status?: string | null;
  work_permit?: string | null;
  job_filing_number?: string | null;
  work_on_floor?: string | null;
  work_type?: string | null;
  applicant_first_name?: string | null;
  applicant_middle_name?: string | null;
  applicant_last_name?: string | null;
  applicant_business_name?: string | null;
  applicant_business_address?: string | null;
  approved_date?: string | null;
  issued_date?: string | null;
  expired_date?: string | null;
  job_description?: string | null;
  estimated_job_costs?: string | number | null;
  tracking_number?: string | null;
  sequence_number?: number | null;
  [key: string]: unknown;
}

export interface PermitQueryOptions {
  bbl?: string | null;
  borough?: string | null;
  houseNo?: string | null;
  streetName?: string | null;
  cutoffDate?: string; // YYYY-MM-DD
  limit?: number;
  offset?: number;
}
