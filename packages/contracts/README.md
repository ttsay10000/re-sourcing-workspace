# @re-sourcing/contracts

**Authoritative source of truth for Phase 1.** All other agents MUST import types and API contracts from this package. Do not redefine schemas elsewhere.

## Ownership

- **CONTRACT + DB OWNER** is the only agent allowed to edit:
  - This package (all types and API interfaces)
  - Migrations and core schema in `@re-sourcing/db`

## What lives here

- **Enums**: `ListingSource`, `ListingLifecycleState`, `LocationMode`, `IngestionRunStatus`, `IngestionJobStatus`, `MatchStatus`
- **Domain models**: `ListingNormalized`, `ListingRow`, `SearchProfile`, `SearchProfileInput`, `IngestionRun`, `IngestionJob`, `ListingSnapshot`, `Property`, `DedupeCandidate`, `DedupeQueueItem`, `ListingPropertyMatch`, `SystemEvent`
- **API contracts**: Request/response interfaces for Phase 1 endpoints (e.g. `ProfilesListResponse`, `ListingUpsertRequest`). Endpoints are **not** implemented here—only the TypeScript interfaces.

## Usage

```ts
import {
  type ListingNormalized,
  type SearchProfile,
  type ListingsListResponse,
} from "@re-sourcing/contracts";
```

## Conventions

- **Listing source**: StreetEasy-first; `ListingSource` enum is extensible (`streeteasy` | `manual` | `zillow` | `other`).
- **Lifecycle**: Listings have `lifecycleState`: `active` | `missing` | `pruned`. Timestamps: `firstSeenAt`, `lastSeenAt`, `missingSince`, `prunedAt`.
- **Snapshots**: Use a `pruned` flag (see db README); no hard delete by default for audit/undelete.
- **SearchProfile**: `locationMode` `single` → use `singleLocationSlug`; `multi` → use `areaCodes`. Numeric filters and `requiredAmenities` as defined in the type.

## Building

From repo root: `npm run build` (builds all workspaces). From this package: `npm run build`.
