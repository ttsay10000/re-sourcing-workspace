/**
 * Seed script: profiles, runs, jobs, listings (incl. manual), properties, matches, snapshots.
 * Snapshots point to local files under packages/db/seed-payloads/ (or project-relative path).
 * Run after migrations: npm run build && npm run seed
 */

import { getPool } from "./pool.js";
import { ProfileRepo } from "./repos/ProfileRepo.js";
import { RunRepo } from "./repos/RunRepo.js";
import { JobRepo } from "./repos/JobRepo.js";
import { ListingRepo } from "./repos/ListingRepo.js";
import { SnapshotRepo } from "./repos/SnapshotRepo.js";
import { PropertyRepo } from "./repos/PropertyRepo.js";
import { MatchRepo } from "./repos/MatchRepo.js";
import { EventRepo } from "./repos/EventRepo.js";
import type { ListingRow } from "@re-sourcing/contracts";

const SEED_PAYLOAD_DIR = "seed-payloads";

async function main(): Promise<void> {
  const pool = getPool();
  const profileRepo = new ProfileRepo({ pool });
  const runRepo = new RunRepo({ pool });
  const jobRepo = new JobRepo({ pool });
  const listingRepo = new ListingRepo({ pool });
  const snapshotRepo = new SnapshotRepo({ pool });
  const propertyRepo = new PropertyRepo({ pool });
  const matchRepo = new MatchRepo({ pool });
  const eventRepo = new EventRepo({ pool });

  console.log("Seeding profiles...");
  const p1 = await profileRepo.create({
    name: "Manhattan UES Rentals",
    locationMode: "single",
    singleLocationSlug: "upper-east-side",
    areaCodes: [],
    minPrice: 2000,
    maxPrice: 5000,
    minBeds: 1,
    maxBeds: 2,
    minBaths: 1,
    requiredAmenities: ["doorman"],
    sourceToggles: { streeteasy: true, manual: true },
    scheduleCron: "0 8 * * *",
    runIntervalMinutes: null,
  });
  const p2 = await profileRepo.create({
    name: "Brooklyn Multi-Area",
    locationMode: "multi",
    singleLocationSlug: null,
    areaCodes: ["11201", "11215", "11217"],
    minPrice: 1500,
    maxPrice: 4000,
    minBeds: 2,
    maxBeds: null,
    requiredAmenities: [],
    sourceToggles: { streeteasy: true, manual: true },
    scheduleCron: null,
    runIntervalMinutes: 60,
  });

  console.log("Seeding ingestion runs + jobs (one success, one with failure)...");
  const run1 = await runRepo.create(p1.id);
  const run2 = await runRepo.create(p2.id);
  const job1a = await jobRepo.create(run1.id, "streeteasy");
  const job1b = await jobRepo.create(run1.id, "manual");
  await jobRepo.start(job1a.id);
  await jobRepo.finish(job1a.id, "completed");
  await jobRepo.start(job1b.id);
  await jobRepo.finish(job1b.id, "completed");
  await runRepo.finish(run1.id, "completed", {
    listingsSeen: 15,
    listingsNew: 10,
    listingsUpdated: 5,
    jobsCompleted: 2,
  });

  const job2a = await jobRepo.create(run2.id, "streeteasy");
  await jobRepo.start(job2a.id);
  await jobRepo.finish(job2a.id, "failed", "Connection timeout to StreetEasy");
  await runRepo.finish(run2.id, "failed", {
    jobsFailed: 1,
    errors: ["Connection timeout to StreetEasy"],
  });

  console.log("Seeding listings (20 StreetEasy-like + 3 manual)...");
  const streeteasyListings: ListingRow[] = [];
  for (let i = 1; i <= 20; i++) {
    const u = await listingRepo.upsert({
      source: "streeteasy",
      externalId: `se-${1000 + i}`,
      address: `${150 + i} E 45th St`,
      city: "New York",
      state: "NY",
      zip: "10017",
      price: 2800 + i * 100,
      beds: i % 3 === 0 ? 2 : 1,
      baths: 1,
      sqft: 700 + i * 20,
      url: `https://streeteasy.com/building/1/listing-${1000 + i}`,
      title: `Unit ${i} - East Midtown`,
      listedAt: new Date(Date.now() - i * 86400000).toISOString(),
    });
    streeteasyListings.push(u.listing);
  }
  const manualListings = [
    await listingRepo.upsert({
      source: "manual",
      externalId: "manual-1",
      address: "200 W 90th St",
      city: "New York",
      state: "NY",
      zip: "10024",
      price: 3200,
      beds: 2,
      baths: 2,
      url: "https://example.com/manual-1",
      title: "Manual entry UWS",
    }),
    await listingRepo.upsert({
      source: "manual",
      externalId: "manual-2",
      address: "150 E 45th St",
      city: "New York",
      state: "NY",
      zip: "10017",
      price: 2700,
      beds: 1,
      baths: 1,
      url: "https://example.com/manual-2",
      title: "Manual entry same building",
    }),
    await listingRepo.upsert({
      source: "manual",
      externalId: "manual-3",
      address: "301 W 110th St",
      city: "New York",
      state: "NY",
      zip: "10025",
      price: 2900,
      beds: 2,
      baths: 1,
      url: "https://example.com/manual-3",
      title: "Manual entry Morningside",
    }),
  ];

  const listingIds = [
    ...streeteasyListings.map((l) => l.id),
    ...manualListings.map((r) => r.listing.id),
  ];

  console.log("Seeding properties + duplicates/near-duplicates for dedupe...");
  const prop1 = await propertyRepo.create("150 E 45th St, New York, NY 10017");
  await propertyRepo.create("200 W 90th St, New York, NY 10024");
  await propertyRepo.create("301 W 110th St, New York, NY 10025");

  const listingRepoForMatches = new ListingRepo({ pool });
  const l151 = await listingRepoForMatches.bySourceAndExternalId("streeteasy", "se-1");
  const l152 = await listingRepoForMatches.bySourceAndExternalId("streeteasy", "se-2");
  const manual2Listing = manualListings[1].listing;
  if (l151 && prop1) {
    await matchRepo.create({
      listingId: l151.id,
      propertyId: prop1.id,
      confidence: 0.95,
      reasons: { addressMatch: true, normalizedAddressDistance: 0 },
    });
  }
  if (l152 && prop1) {
    await matchRepo.create({
      listingId: l152.id,
      propertyId: prop1.id,
      confidence: 0.88,
      reasons: { addressMatch: true, normalizedAddressDistance: 0.1 },
    });
  }
  if (manual2Listing && prop1) {
    await matchRepo.create({
      listingId: manual2Listing.id,
      propertyId: prop1.id,
      confidence: 0.92,
      reasons: { addressMatch: true, priceConsistent: true },
    });
  }

  console.log("Seeding snapshots (pointing to seed-payloads/)...");
  for (let i = 0; i < Math.min(10, listingIds.length); i++) {
    const lid = listingIds[i];
    await snapshotRepo.create({
      listingId: lid,
      runId: run1.id,
      rawPayloadPath: `${SEED_PAYLOAD_DIR}/listing_${lid}.json`,
      metadata: { fetchedAt: new Date().toISOString(), statusCode: 200 },
    });
  }

  console.log("Seeding system events...");
  await eventRepo.emit("ui.profile.created", { profileId: p1.id });
  await eventRepo.emit("job.run.completed", { runId: run1.id });
  await eventRepo.emit("job.run.failed", { runId: run2.id });

  await pool.end();
  console.log("Seed complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
