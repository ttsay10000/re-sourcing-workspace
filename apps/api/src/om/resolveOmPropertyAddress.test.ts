import { describe, expect, it } from "vitest";
import { resolveOmPropertyAddress } from "./resolveOmPropertyAddress.js";

describe("resolveOmPropertyAddress", () => {
  it("builds a canonical borough address from OM property info", () => {
    const resolved = resolveOmPropertyAddress({
      address: "18 Christopher Street",
      borough: "Manhattan",
    });

    expect(resolved).toEqual({
      rawAddress: "18 Christopher Street",
      addressLine: "18 Christopher Street",
      locality: "Manhattan",
      zip: null,
      canonicalAddress: "18 Christopher Street, Manhattan, NY",
      addressSource: "address",
      canAttemptBblResolution: true,
    });
  });

  it("prefers packageAddress and preserves zip when present", () => {
    const resolved = resolveOmPropertyAddress({
      packageAddress: "125-127 Authoritative Avenue, Manhattan, NY 10001",
      borough: "New York",
    });

    expect(resolved).toEqual({
      rawAddress: "125-127 Authoritative Avenue, Manhattan, NY 10001",
      addressLine: "125-127 Authoritative Avenue",
      locality: "Manhattan",
      zip: "10001",
      canonicalAddress: "125-127 Authoritative Avenue, Manhattan, NY 10001",
      addressSource: "packageAddress",
      canAttemptBblResolution: true,
    });
  });

  it("falls back to the address string when borough is not broken out separately", () => {
    const resolved = resolveOmPropertyAddress({
      address: "201 Bedford Avenue, Brooklyn, NY 11211",
    });

    expect(resolved).toEqual({
      rawAddress: "201 Bedford Avenue, Brooklyn, NY 11211",
      addressLine: "201 Bedford Avenue",
      locality: "Brooklyn",
      zip: "11211",
      canonicalAddress: "201 Bedford Avenue, Brooklyn, NY 11211",
      addressSource: "address",
      canAttemptBblResolution: true,
    });
  });

  it("keeps a usable canonical address even when only zip can be recovered", () => {
    const resolved = resolveOmPropertyAddress({
      addressLine: "45-02 Ditmars Blvd",
      zip: "11105",
    });

    expect(resolved).toEqual({
      rawAddress: "45-02 Ditmars Blvd",
      addressLine: "45-02 Ditmars Boulevard",
      locality: null,
      zip: "11105",
      canonicalAddress: "45-02 Ditmars Boulevard, NYC, NY 11105",
      addressSource: "addressLine",
      canAttemptBblResolution: true,
    });
  });

  it("cleans zip and casing from OM-uploaded address lines before matching", () => {
    const resolved = resolveOmPropertyAddress({
      addressLine: "252 east 33rd st 10016",
    });

    expect(resolved).toEqual({
      rawAddress: "252 east 33rd st 10016",
      addressLine: "252 East 33rd Street",
      locality: null,
      zip: "10016",
      canonicalAddress: "252 East 33rd Street, NYC, NY 10016",
      addressSource: "addressLine",
      canAttemptBblResolution: true,
    });
  });

  it("expands directional and suffix abbreviations from compact OM addresses", () => {
    const resolved = resolveOmPropertyAddress({
      address: "252 E 33 St, New York, NY 10016",
    });

    expect(resolved).toEqual({
      rawAddress: "252 E 33 St, New York, NY 10016",
      addressLine: "252 East 33rd Street",
      locality: "Manhattan",
      zip: "10016",
      canonicalAddress: "252 East 33rd Street, Manhattan, NY 10016",
      addressSource: "address",
      canAttemptBblResolution: true,
    });
  });

  it("does not remove New York when it is part of the street name", () => {
    const resolved = resolveOmPropertyAddress({
      address: "123 New York Ave, Brooklyn, NY 11213",
    });

    expect(resolved?.addressLine).toBe("123 New York Avenue");
    expect(resolved?.canonicalAddress).toBe("123 New York Avenue, Brooklyn, NY 11213");
  });
});
