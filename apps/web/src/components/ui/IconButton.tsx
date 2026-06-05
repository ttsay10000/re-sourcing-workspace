import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./primitives.module.css";
import { cx } from "./utils";

type IconButtonSize = "sm" | "md" | "lg";

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  label: string;
  size?: IconButtonSize;
};

const sizeClass: Record<IconButtonSize, string | undefined> = {
  sm: styles.iconButtonSm,
  md: undefined,
  lg: styles.iconButtonLg,
};

export function IconButton({
  children,
  className,
  label,
  size = "md",
  type = "button",
  ...props
}: IconButtonProps) {
  return (
    <button
      {...props}
      type={type}
      aria-label={label}
      title={props.title ?? label}
      className={cx(styles.iconButton, sizeClass[size], className)}
    >
      {children}
    </button>
  );
}
