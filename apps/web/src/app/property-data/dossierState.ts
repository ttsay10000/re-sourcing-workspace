export type PropertyDossierGenerationStatus =
  | "not_started"
  | "running"
  | "completed"
  | "failed";

export interface PropertyDossierAssumptions {
  renovationCosts?: number | null;
  furnishingSetupCosts?: number | null;
  updatedAt?: string | null;
}

export interface PropertyDossierGeneration {
  status?: PropertyDossierGenerationStatus | null;
  stageLabel?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  lastError?: string | null;
  dealScore?: number | null;
  dossierDocumentId?: string | null;
  excelDocumentId?: string | null;
}

export interface PropertyDossierState {
  assumptions?: PropertyDossierAssumptions | null;
  generation?: PropertyDossierGeneration | null;
}

export interface LocalDossierJobState {
  status: "running" | "completed" | "failed";
  startedAt: number;
  progressPct: number;
  stageLabel: string;
  notice?: string | null;
}

export const DOSSIER_GENERATION_ESTIMATE_MS = 95_000;
export const DOSSIER_GENERATION_STEPS = [
  { startPct: 0, label: "Preparing property inputs" },
  { startPct: 16, label: "Running underwriting model" },
  { startPct: 38, label: "Drafting investment memo" },
  { startPct: 67, label: "Rendering PDF and Excel" },
  { startPct: 90, label: "Saving documents" },
] as const;

export function estimateGenerationProgress(elapsedMs: number): number {
  const clampedRatio = Math.min(Math.max(elapsedMs / DOSSIER_GENERATION_ESTIMATE_MS, 0), 1);
  const easedRatio = 1 - Math.pow(1 - clampedRatio, 1.6);
  return Math.min(96, Math.max(3, Math.round(easedRatio * 96)));
}

export function generationStageLabel(progressPct: number): string {
  let activeLabel: string = DOSSIER_GENERATION_STEPS[0].label;
  for (const step of DOSSIER_GENERATION_STEPS) {
    if (progressPct >= step.startPct) activeLabel = step.label;
  }
  return activeLabel;
}

export function getPropertyDossierState(details: Record<string, unknown> | null | undefined): PropertyDossierState | null {
  const dossier = details?.dealDossier;
  if (!dossier || typeof dossier !== "object") return null;
  return dossier as PropertyDossierState;
}

export function getPropertyDossierGeneration(
  details: Record<string, unknown> | null | undefined
): PropertyDossierGeneration | null {
  return getPropertyDossierState(details)?.generation ?? null;
}

export function getPropertyDossierAssumptions(
  details: Record<string, unknown> | null | undefined
): PropertyDossierAssumptions | null {
  return getPropertyDossierState(details)?.assumptions ?? null;
}
