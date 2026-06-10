import { STAGE_AGING } from "@re-sourcing/contracts";
import { Badge, type BadgeTone } from "./Badge";

type AgingChipProps = {
  /** ISO timestamp of when the deal entered its current stage. */
  since: string | null | undefined;
  className?: string;
};

/** "9d in stage" chip — amber past the warn threshold, red past danger. */
export function AgingChip({ since, className }: AgingChipProps) {
  if (!since) return null;
  const entered = new Date(since);
  if (Number.isNaN(entered.getTime())) return null;
  const days = Math.floor((Date.now() - entered.getTime()) / 86_400_000);
  if (days < 1) return null;

  const tone: BadgeTone = days >= STAGE_AGING.dangerDays ? "danger" : days >= STAGE_AGING.warnDays ? "warning" : "neutral";
  return (
    <Badge
      tone={tone}
      className={className}
      title={`In this stage since ${entered.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
    >
      {days}d in stage
    </Badge>
  );
}
