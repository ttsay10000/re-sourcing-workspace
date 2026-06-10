"use client";

import styles from "./primitives.module.css";
import { Button } from "./Button";
import { Dialog } from "./Dialog";

/** A lookup result surfaced for manual confirmation (verified or needs-review). */
export type BrokerSearchCandidate = {
  name: string | null;
  email: string | null;
  phone: string | null;
  firm: string | null;
  confidence: number | null;
  evidence: string | null;
  sourceUrl: string | null;
  tier: "verified" | "needs_review" | "rejected";
};

export type BrokerContactDraft = {
  /** Property address shown as the dialog description. */
  address: string;
  name: string;
  email: string;
  saving: boolean;
  /** Web-search lookup state; only used where onSearch is wired up. */
  searching?: boolean;
  searchMessage?: string | null;
  candidates?: BrokerSearchCandidate[] | null;
};

type BrokerContactDialogProps = {
  /** null keeps the dialog closed. */
  state: BrokerContactDraft | null;
  onClose: () => void;
  onChange: (patch: Partial<Pick<BrokerContactDraft, "name" | "email">>) => void;
  onSubmit: () => void;
  /** When provided, renders a "Search the web" action that runs the broker lookup. */
  onSearch?: () => void;
};

function tierLabel(tier: BrokerSearchCandidate["tier"]): string {
  if (tier === "verified") return "Verified";
  if (tier === "needs_review") return "Needs review";
  return "Low confidence";
}

/**
 * Add/overwrite a property's broker contact in place. Both the pipeline table
 * and the Deal Progress board open this against
 * `PUT /api/ui-v2/properties/:id/broker`. Surfaces with onSearch wired can run
 * the standalone broker web lookup and adopt one of its candidates.
 */
export function BrokerContactDialog({ state, onClose, onChange, onSubmit, onSearch }: BrokerContactDialogProps) {
  const candidates = state?.candidates ?? [];
  return (
    <Dialog
      open={state != null}
      onClose={onClose}
      title="Add broker contact"
      description={state?.address}
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={state?.saving}>
            Cancel
          </Button>
          {onSearch ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={onSearch}
              disabled={state == null || state.saving || state.searching === true}
              title="Run the broker web lookup (deep search) for this property's listing agents and show every candidate found."
            >
              {state?.searching ? "Searching…" : "Search the web"}
            </Button>
          ) : null}
          <Button
            variant="primary"
            size="sm"
            onClick={onSubmit}
            disabled={state == null || state.saving || !state.email.trim()}
          >
            {state?.saving ? "Saving…" : "Save contact"}
          </Button>
        </>
      }
    >
      {state ? (
        <div className={styles.dialogFieldStack}>
          <label className={styles.dialogFieldGroup}>
            <span>Broker name</span>
            <input
              type="text"
              value={state.name}
              placeholder="Optional"
              onChange={(event) => onChange({ name: event.target.value })}
            />
          </label>
          <label className={styles.dialogFieldGroup}>
            <span>Broker email</span>
            <input
              type="email"
              value={state.email}
              placeholder="broker@firm.com"
              autoFocus
              onChange={(event) => onChange({ email: event.target.value })}
            />
          </label>
          {state.searchMessage ? <p className={styles.dialogHint}>{state.searchMessage}</p> : null}
          {candidates.length > 0 ? (
            <div className={styles.dialogFieldGroup}>
              <span>Search results</span>
              <ul className={styles.dialogCandidateList}>
                {candidates.map((candidate, index) => (
                  <li key={`${candidate.email ?? candidate.phone ?? "candidate"}-${index}`} className={styles.dialogCandidate}>
                    <div className={styles.dialogCandidateBody}>
                      <strong>
                        {candidate.email ?? candidate.phone ?? "Contact"}
                        <em data-tier={candidate.tier}>{tierLabel(candidate.tier)}{candidate.confidence != null ? ` · ${candidate.confidence}` : ""}</em>
                      </strong>
                      <small>
                        {[candidate.name, candidate.firm].filter(Boolean).join(" — ")}
                      </small>
                      {candidate.evidence ? <small>{candidate.evidence}</small> : null}
                      {candidate.sourceUrl ? (
                        <small>
                          <a href={candidate.sourceUrl} target="_blank" rel="noreferrer">
                            source
                          </a>
                        </small>
                      ) : null}
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={!candidate.email || state.saving}
                      onClick={() =>
                        onChange({
                          email: candidate.email ?? state.email,
                          name: candidate.name ?? state.name,
                        })
                      }
                    >
                      Use
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}
