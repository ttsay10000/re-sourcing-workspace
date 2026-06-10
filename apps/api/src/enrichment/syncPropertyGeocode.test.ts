import { describe, expect, it } from "vitest";
import { pickGeocodeCandidate } from "./syncPropertyGeocode.js";

describe("pickGeocodeCandidate", () => {
  it("prefers details.lat/lon (BBL-resolution coordinates) over everything else", () => {
    const candidate = pickGeocodeCandidate({
      details: {
        lat: 40.7359,
        lon: -73.9911,
        neighborhood: { geography: { latitude: 40.73, longitude: -73.99 } },
      },
      listingLat: 40.7,
      listingLon: -74.0,
    });
    expect(candidate).toEqual({ lat: 40.7359, lng: -73.9911, source: "details" });
  });

  it("accepts numeric strings (JSON round-trips and Socrata payloads stringify)", () => {
    const candidate = pickGeocodeCandidate({
      details: { lat: "40.7359", lon: "-73.9911" },
    });
    expect(candidate).toEqual({ lat: 40.7359, lng: -73.9911, source: "details" });
  });

  it("falls back to the matched listing when details has only half a pair", () => {
    const candidate = pickGeocodeCandidate({
      details: { lat: 40.7359 },
      listingLat: 40.71,
      listingLon: -74.01,
    });
    expect(candidate).toEqual({ lat: 40.71, lng: -74.01, source: "listing" });
  });

  it("falls back to PLUTO geography when neither details nor listing has coordinates", () => {
    const candidate = pickGeocodeCandidate({
      details: { neighborhood: { geography: { latitude: 40.68, longitude: -73.95 } } },
    });
    expect(candidate).toEqual({ lat: 40.68, lng: -73.95, source: "pluto" });
  });

  it("rejects (0,0) and out-of-range coordinates", () => {
    expect(pickGeocodeCandidate({ details: { lat: 0, lon: 0 } })).toBeNull();
    expect(
      pickGeocodeCandidate({ details: { lat: 140.7, lon: -73.99 }, listingLat: 40.7, listingLon: -200 })
    ).toBeNull();
  });

  it("rejects non-numeric values and returns null when nothing is available", () => {
    expect(
      pickGeocodeCandidate({ details: { lat: "uptown", lon: "east" }, listingLat: null, listingLon: null })
    ).toBeNull();
    expect(pickGeocodeCandidate({ details: null })).toBeNull();
  });
});
