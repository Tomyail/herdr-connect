/**
 * Pure appearance resolution logic — no React Native dependencies, fully testable.
 *
 * - {@link AppearanceChoice} is the owner's *choice* (System Default / Light / Dark).
 * - {@link ResolvedTheme} is the concrete theme the UI renders with.
 *
 * Resolution rules mirror the language preference:
 *  - An explicit choice wins immediately.
 *  - "system" follows the device color scheme; a missing scheme falls back to light.
 */

/** Owner-facing appearance choice persisted in storage. */
export type AppearanceChoice = "system" | "light" | "dark";

/** Concrete theme the UI renders with. */
export type ResolvedTheme = "light" | "dark";

/** Ordered list of selectable appearances shown on the Appearance screen. */
export const APPEARANCE_CHOICES: readonly AppearanceChoice[] = ["system", "light", "dark"];

/** Fallback theme when the device reports no color scheme. */
export const DEFAULT_THEME: ResolvedTheme = "light";

const APPEARANCE_CHOICE_SET: ReadonlySet<AppearanceChoice> = new Set(APPEARANCE_CHOICES);

/** Type guard for a persisted appearance value read from storage. */
export function isAppearanceChoice(value: unknown): value is AppearanceChoice {
  return typeof value === "string" && (APPEARANCE_CHOICE_SET as Set<string>).has(value);
}

/**
 * Parse a raw stored value into a safe {@link AppearanceChoice}.
 * Unknown / missing values fall back to "system" (the initial default).
 */
export function parseStoredAppearance(value: string | undefined | null): AppearanceChoice {
  return isAppearanceChoice(value) ? value : "system";
}

/**
 * Resolve the concrete theme for a choice given the device color scheme.
 * Accepts any raw scheme string (React Native may report "unspecified");
 * anything other than "dark" resolves to light.
 */
export function resolveTheme(
  choice: AppearanceChoice,
  systemScheme: string | null | undefined,
): ResolvedTheme {
  switch (choice) {
    case "light":
      return "light";
    case "dark":
      return "dark";
    case "system":
      return systemScheme === "dark" ? "dark" : DEFAULT_THEME;
  }
}
