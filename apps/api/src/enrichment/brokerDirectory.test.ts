import { describe, expect, it } from "vitest";
import { findDirectoryContact, recordVerifiedContactsInDirectory } from "./brokerDirectory.js";

type QueryCall = { text: string; values: unknown[] };

function fakePool(handler: (call: QueryCall) => { rows: unknown[] }) {
  const calls: QueryCall[] = [];
  return {
    calls,
    query: async (text: string, values?: unknown[]) => {
      const call = { text, values: values ?? [] };
      calls.push(call);
      return handler(call);
    },
  } as unknown as import("pg").Pool & { calls: QueryCall[] };
}

describe("brokerDirectory", () => {
  it("returns a verified directory entry for a known broker at a compatible firm", async () => {
    const pool = fakePool(() => ({
      rows: [
        {
          normalized_email: "jane@example-realty.com",
          display_name: "Jane Broker",
          firm: "Example Realty LLC",
          phone: "212-555-0100",
          updated_at: "2026-06-01T00:00:00.000Z",
        },
      ],
    }));

    const hit = await findDirectoryContact(pool, "Jane Broker", "Example Realty");
    expect(hit).not.toBeNull();
    expect(hit!.email).toBe("jane@example-realty.com");
    expect(hit!.source).toBe("directory");
    expect(hit!.verificationTier).toBe("verified");
    expect(hit!.needsReview).toBe(false);
  });

  it("skips directory rows whose firm is incompatible with the listing brokerage", async () => {
    const pool = fakePool(() => ({
      rows: [
        {
          normalized_email: "jane@somewhere-else.com",
          display_name: "Jane Broker",
          firm: "Totally Different Partners",
          phone: null,
          updated_at: "2026-06-01T00:00:00.000Z",
        },
      ],
    }));

    const hit = await findDirectoryContact(pool, "Jane Broker", "Example Realty");
    expect(hit).toBeNull();
  });

  it("records only verified entries with emails into the directory", async () => {
    const inserted: unknown[][] = [];
    const pool = fakePool((call) => {
      if (/^SELECT \* FROM broker_contacts WHERE normalized_email/.test(call.text)) {
        return { rows: [] };
      }
      if (/^INSERT INTO broker_contacts/.test(call.text)) {
        inserted.push(call.values);
        return {
          rows: [
            {
              id: "00000000-0000-0000-0000-000000000001",
              normalized_email: call.values[0],
              display_name: call.values[2],
              firm: call.values[3],
              phone: call.values[4],
              source: call.values[5],
              source_metadata: {},
              manual_review_only: false,
              notes: null,
              activity_summary: {},
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
        };
      }
      return { rows: [] };
    });

    const recorded = await recordVerifiedContactsInDirectory(pool, [
      {
        name: "Jane Broker",
        firm: "Example Realty",
        email: "jane@example-realty.com",
        phone: null,
        source: "llm",
        confidence: 88,
        verificationTier: "verified",
      },
      // Needs-review entries must not pollute the directory.
      {
        name: "John Pending",
        firm: "Example Realty",
        email: "john@example-realty.com",
        phone: null,
        source: "llm",
        confidence: 55,
        verificationTier: "needs_review",
      },
      // No email — nothing to key on.
      { name: "No Email", firm: "Example Realty", email: null, phone: null },
    ]);

    expect(recorded).toBe(1);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]![0]).toBe("jane@example-realty.com");
  });
});
