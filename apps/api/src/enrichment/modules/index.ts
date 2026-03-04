import type { EnrichmentModule } from "../types.js";
import { zoningZtlModule } from "./zoningZtl.js";
import { certificateOfOccupancyModule } from "./certificateOfOccupancy.js";
import { hpdRegistrationModule } from "./hpdRegistration.js";
import { hpdViolationsModule } from "./hpdViolations.js";
import { dobComplaintsModule } from "./dobComplaints.js";
import { housingLitigationsModule } from "./housingLitigations.js";

export const ENRICHMENT_MODULES: EnrichmentModule[] = [
  zoningZtlModule,
  certificateOfOccupancyModule,
  hpdRegistrationModule,
  hpdViolationsModule,
  dobComplaintsModule,
  housingLitigationsModule,
];

export function getEnrichmentModule(name: string): EnrichmentModule | undefined {
  return ENRICHMENT_MODULES.find((m) => m.name === name);
}

export {
  zoningZtlModule,
  certificateOfOccupancyModule,
  hpdRegistrationModule,
  hpdViolationsModule,
  dobComplaintsModule,
  housingLitigationsModule,
};
