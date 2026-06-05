import type { CSSProperties } from "react";
import styles from "./primitives.module.css";
import { cx } from "./utils";

type ScoreTone = "brand" | "success" | "warning" | "danger" | "neutral";

type ScoreGaugeProps = {
  label?: string;
  max?: number;
  score: number | null | undefined;
  size?: "md" | "lg";
  tone?: ScoreTone;
};

const toneColor: Record<ScoreTone, string> = {
  brand: "var(--brand)",
  success: "var(--app-green)",
  warning: "var(--app-amber)",
  danger: "var(--app-red)",
  neutral: "var(--app-muted)",
};

export function ScoreGauge({ label = "Score", max = 100, score, size = "md", tone = "brand" }: ScoreGaugeProps) {
  const safeMax = max > 0 ? max : 100;
  const numericScore = typeof score === "number" && Number.isFinite(score) ? score : null;
  const clampedScore = numericScore === null ? 0 : Math.max(0, Math.min(safeMax, numericScore));
  const angle = (clampedScore / safeMax) * 360;
  const displayScore = numericScore === null ? "-" : Math.round(clampedScore).toString();
  const style = {
    "--score-angle": `${angle}deg`,
    "--score-tone": toneColor[tone],
  } as CSSProperties;

  return (
    <span className={cx(styles.scoreGauge, size === "lg" && styles.scoreGaugeLg)} style={style}>
      <span className={styles.scoreDial}>{displayScore}</span>
      <span className={styles.scoreMeta}>
        <span className={styles.scoreLabel}>{label}</span>
        <span className={styles.scoreValue}>
          {displayScore}/{safeMax}
        </span>
      </span>
    </span>
  );
}
