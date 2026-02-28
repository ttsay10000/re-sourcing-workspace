-- Phase 1: Enum types (source-agnostic listing source, lifecycle, etc.)

CREATE TYPE listing_source AS ENUM ('streeteasy', 'manual', 'zillow', 'other');

CREATE TYPE listing_lifecycle_state AS ENUM ('active', 'missing', 'pruned');

CREATE TYPE location_mode AS ENUM ('single', 'multi');

CREATE TYPE ingestion_run_status AS ENUM ('running', 'completed', 'failed', 'cancelled');

CREATE TYPE ingestion_job_status AS ENUM ('pending', 'running', 'completed', 'failed');

CREATE TYPE match_status AS ENUM ('pending', 'accepted', 'rejected');
