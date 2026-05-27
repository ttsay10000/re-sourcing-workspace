import type { SourceToggles } from "@re-sourcing/contracts";
import { loopNetAdapter } from "./loopNetAdapter.js";
import { streetEasyAdapter } from "./streetEasyAdapter.js";
import type { AnySourceAdapter, SourceAdapterId, SourceToggleInput } from "./types.js";

const adapters = {
  streeteasy: streetEasyAdapter,
  loopnet: loopNetAdapter,
} as const satisfies Record<SourceAdapterId, AnySourceAdapter>;

export const SOURCE_ADAPTER_IDS = Object.keys(adapters) as SourceAdapterId[];

export function isSourceAdapterId(value: unknown): value is SourceAdapterId {
  return typeof value === "string" && value in adapters;
}

export function getSourceAdapter(id: SourceAdapterId): AnySourceAdapter {
  return adapters[id];
}

export function listSourceAdapters(): AnySourceAdapter[] {
  return SOURCE_ADAPTER_IDS.map((id) => adapters[id]);
}

export function resolveSourceAdapterId(value: unknown): SourceAdapterId {
  return isSourceAdapterId(value) ? value : "streeteasy";
}

export function sanitizeSourceToggles(input: SourceToggleInput): SourceToggles {
  const raw = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  return {
    streeteasy: typeof raw.streeteasy === "boolean" ? raw.streeteasy : true,
    manual: typeof raw.manual === "boolean" ? raw.manual : true,
    zillow: typeof raw.zillow === "boolean" ? raw.zillow : undefined,
    loopnet: typeof raw.loopnet === "boolean" ? raw.loopnet : false,
  };
}

export function listEnabledSavedSearchAdapters(toggles: SourceToggleInput): AnySourceAdapter[] {
  const sanitized = sanitizeSourceToggles(toggles);
  return listSourceAdapters().filter((adapter) => adapter.capabilities.savedSearch && sanitized[adapter.id] !== false);
}

export function listEnabledManualAdapters(toggles: SourceToggleInput): AnySourceAdapter[] {
  const sanitized = sanitizeSourceToggles(toggles);
  return listSourceAdapters().filter((adapter) => adapter.capabilities.manualSearch && sanitized[adapter.id] !== false);
}
