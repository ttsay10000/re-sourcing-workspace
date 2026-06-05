import type { ReactNode } from "react";
import { Check } from "lucide-react";
import styles from "./primitives.module.css";
import { cx } from "./utils";

export type StepStatus = "complete" | "current" | "pending";

export type ProgressStep = {
  description?: ReactNode;
  id: string;
  label: ReactNode;
  status?: StepStatus;
};

type ProgressStepperProps = {
  steps: ProgressStep[];
};

export function ProgressStepper({ steps }: ProgressStepperProps) {
  return (
    <div className={styles.stepper}>
      {steps.map((step, index) => {
        const status = step.status ?? "pending";
        return (
          <div
            key={step.id}
            className={cx(
              styles.step,
              status === "complete" && styles.stepComplete,
              status === "current" && styles.stepCurrent
            )}
          >
            <span className={styles.stepMarker} aria-hidden="true">
              {status === "complete" ? <Check size={14} strokeWidth={2.2} /> : index + 1}
            </span>
            <span>
              <p className={styles.stepLabel}>{step.label}</p>
              {step.description ? <p className={styles.stepDescription}>{step.description}</p> : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}
