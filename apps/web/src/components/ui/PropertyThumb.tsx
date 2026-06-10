import { Building2 } from "lucide-react";
import styles from "./primitives.module.css";
import { cx } from "./utils";

type PropertyThumbProps = {
  src?: string | null;
  /** Address or name; kept for img alt semantics even though the fallback is an icon. */
  alt: string;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
};

const sizeClass = {
  sm: styles.propertyThumbSm,
  md: undefined,
  lg: styles.propertyThumbLg,
  xl: styles.propertyThumbXl,
} as const;

const iconSize = { sm: 13, md: 16, lg: 20, xl: 26 } as const;

/**
 * Property photo with a building-icon fallback so cards never show a broken
 * box — and never a stray letter/digit (street numbers made the old letter
 * tile read like a data value).
 */
export function PropertyThumb({ src, alt, size = "md", className }: PropertyThumbProps) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- remote listing photos, unknown hosts
      <img src={src} alt="" loading="lazy" className={cx(styles.propertyThumb, sizeClass[size], className)} />
    );
  }
  return (
    <span
      aria-hidden="true"
      title={alt || undefined}
      className={cx(styles.propertyThumb, styles.propertyThumbFallback, sizeClass[size], className)}
    >
      <Building2 size={iconSize[size]} strokeWidth={1.7} />
    </span>
  );
}
