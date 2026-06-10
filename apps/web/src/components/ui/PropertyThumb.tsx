import styles from "./primitives.module.css";
import { cx } from "./utils";

type PropertyThumbProps = {
  src?: string | null;
  /** Address or name; first character seeds the letter-tile fallback. */
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

/** Property photo with a letter-tile fallback so cards never show a broken box. */
export function PropertyThumb({ src, alt, size = "md", className }: PropertyThumbProps) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- remote listing photos, unknown hosts
      <img src={src} alt="" loading="lazy" className={cx(styles.propertyThumb, sizeClass[size], className)} />
    );
  }
  return (
    <span aria-hidden="true" className={cx(styles.propertyThumb, styles.propertyThumbFallback, sizeClass[size], className)}>
      {(alt.trim().charAt(0) || "•").toUpperCase()}
    </span>
  );
}
