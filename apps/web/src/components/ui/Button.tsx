import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./primitives.module.css";
import { cx } from "./utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive" | "bulk";
export type ButtonSize = "sm" | "md" | "lg";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  fullWidth?: boolean;
  size?: ButtonSize;
  variant?: ButtonVariant;
};

const sizeClass: Record<ButtonSize, string> = {
  sm: styles.buttonSm,
  md: styles.buttonMd,
  lg: styles.buttonLg,
};

const variantClass: Record<ButtonVariant, string> = {
  primary: styles.buttonPrimary,
  secondary: styles.buttonSecondary,
  ghost: styles.buttonGhost,
  destructive: styles.buttonDestructive,
  bulk: styles.buttonBulk,
};

export function Button({
  children,
  className,
  fullWidth = false,
  size = "md",
  type = "button",
  variant = "secondary",
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      type={type}
      className={cx(
        styles.button,
        sizeClass[size],
        variantClass[variant],
        fullWidth && styles.buttonFullWidth,
        className
      )}
    >
      {children}
    </button>
  );
}
