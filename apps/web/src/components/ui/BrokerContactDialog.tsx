"use client";

import styles from "./primitives.module.css";
import { Button } from "./Button";
import { Dialog } from "./Dialog";

export type BrokerContactDraft = {
  /** Property address shown as the dialog description. */
  address: string;
  name: string;
  email: string;
  saving: boolean;
};

type BrokerContactDialogProps = {
  /** null keeps the dialog closed. */
  state: BrokerContactDraft | null;
  onClose: () => void;
  onChange: (patch: Partial<Pick<BrokerContactDraft, "name" | "email">>) => void;
  onSubmit: () => void;
};

/**
 * Add/overwrite a property's broker contact in place. Both the pipeline table
 * and the Deal Progress board open this against
 * `PUT /api/ui-v2/properties/:id/broker`.
 */
export function BrokerContactDialog({ state, onClose, onChange, onSubmit }: BrokerContactDialogProps) {
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
        </div>
      ) : null}
    </Dialog>
  );
}
