import { describe, expect, it } from "vitest";
import type { Property } from "@re-sourcing/contracts";
import {
  findOrCreateDealAnalysisDraftProperty,
  type DealAnalysisDraftPropertyRepo,
} from "./dealAnalysis.js";

function property(id: string, canonicalAddress: string): Property {
  return {
    id,
    canonicalAddress,
    details: null,
    createdAt: "2026-05-27T00:00:00.000Z",
    updatedAt: "2026-05-27T00:00:00.000Z",
  };
}

function fakeRepo(params: {
  exact?: Property | null;
  addressLine?: Property | null;
}): DealAnalysisDraftPropertyRepo & { created: string[] } {
  const created: string[] = [];
  return {
    created,
    async byCanonicalAddress() {
      return params.exact ?? null;
    },
    async findByAddressFirstLine() {
      return params.addressLine ?? null;
    },
    async create(canonicalAddress: string) {
      created.push(canonicalAddress);
      return property("created-property", canonicalAddress);
    },
  };
}

describe("findOrCreateDealAnalysisDraftProperty", () => {
  it("reuses an exact canonical-address match", async () => {
    const existing = property("existing-property", "123 Main St, Brooklyn, NY 11201");
    const repo = fakeRepo({ exact: existing });

    const result = await findOrCreateDealAnalysisDraftProperty({
      propertyRepo: repo,
      canonicalAddress: existing.canonicalAddress,
      addressLine: "123 Main St",
    });

    expect(result).toEqual({
      property: existing,
      createdProperty: false,
      matchStrategy: "exact_canonical",
    });
    expect(repo.created).toEqual([]);
  });

  it("reuses an address-line match before creating a draft property", async () => {
    const existing = property("address-line-property", "123 Main Street, Brooklyn, NY");
    const repo = fakeRepo({ addressLine: existing });

    const result = await findOrCreateDealAnalysisDraftProperty({
      propertyRepo: repo,
      canonicalAddress: "123 Main St, Brooklyn, NY 11201",
      addressLine: "123 Main St",
    });

    expect(result.property).toBe(existing);
    expect(result.createdProperty).toBe(false);
    expect(result.matchStrategy).toBe("address_line");
    expect(repo.created).toEqual([]);
  });

  it("creates one draft property only when no existing property matches", async () => {
    const repo = fakeRepo({});

    const result = await findOrCreateDealAnalysisDraftProperty({
      propertyRepo: repo,
      canonicalAddress: "123 Main St, Brooklyn, NY 11201",
      addressLine: "123 Main St",
    });

    expect(result.property).toMatchObject({
      id: "created-property",
      canonicalAddress: "123 Main St, Brooklyn, NY 11201",
    });
    expect(result.createdProperty).toBe(true);
    expect(result.matchStrategy).toBe("new");
    expect(repo.created).toEqual(["123 Main St, Brooklyn, NY 11201"]);
  });
});
