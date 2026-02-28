/**
 * System event for audit trail (UI actions, job events).
 */
export interface SystemEvent {
  id: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

/**
 * Event types used in Phase 1.
 */
export type SystemEventType =
  | "ui.profile.created"
  | "ui.profile.updated"
  | "ui.listing.manual_add"
  | "job.run.started"
  | "job.run.completed"
  | "job.run.failed"
  | "job.job.started"
  | "job.job.completed"
  | "job.job.failed";
