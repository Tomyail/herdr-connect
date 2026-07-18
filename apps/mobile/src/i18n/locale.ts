/**
 * Pure locale resolution logic — no React Native dependencies, fully testable.
 *
 * - {@link AppLanguage} is the owner's *choice* (System Default / 简体中文 / English).
 * - {@link ResolvedLocale} is the concrete locale the UI renders with.
 *
 * Resolution rules (see product decisions #3, #5):
 *  - An explicit choice wins immediately.
 *  - "system" follows the device locale; only Simplified Chinese variants map to zh-Hans.
 *  - Any non-Chinese system locale falls back to English.
 */

/** Owner-facing language choice persisted in storage. */
export type AppLanguage = "system" | "zh-Hans" | "en";

/** Concrete locale the UI renders with. Only these two are supported. */
export type ResolvedLocale = "zh-Hans" | "en";

/** Ordered list of selectable languages shown on the Language screen. */
export const APP_LANGUAGES: readonly AppLanguage[] = ["system", "zh-Hans", "en"];

/** Supported concrete locales. */
export const RESOLVED_LOCALES: readonly ResolvedLocale[] = ["zh-Hans", "en"];

/** Fallback locale when nothing else matches (product decision #3). */
export const DEFAULT_LOCALE: ResolvedLocale = "en";

const APP_LANGUAGE_SET: ReadonlySet<AppLanguage> = new Set(APP_LANGUAGES);

/** Type guard for a persisted language value read from storage. */
export function isAppLanguage(value: unknown): value is AppLanguage {
  return typeof value === "string" && (APP_LANGUAGE_SET as Set<string>).has(value);
}

/**
 * Parse a raw stored value into a safe {@link AppLanguage}.
 * Unknown / missing values fall back to "system" (the initial default).
 */
export function parseStoredLanguage(value: string | undefined | null): AppLanguage {
  return isAppLanguage(value) ? value : "system";
}

/**
 * Resolve the concrete locale for a "system" choice from the device language tag.
 *
 * Explicit Simplified Chinese tags map to zh-Hans. Traditional Chinese and
 * ambiguous bare `zh` tags fall back to English because the app does not ship
 * Traditional Chinese and must not present Simplified Chinese as a substitute.
 */
export function resolveSystemLocale(languageTag: string | undefined | null): ResolvedLocale {
  if (!languageTag) return DEFAULT_LOCALE;
  const tag = languageTag.toLowerCase();
  const parts = tag.split("-");
  if (
    parts[0] === "zh" &&
    (parts.includes("hans") || parts.includes("cn") || parts.includes("sg") || parts.includes("my"))
  ) {
    return "zh-Hans";
  }
  if (tag.startsWith("en")) return "en";
  return DEFAULT_LOCALE;
}

/** Resolve the concrete locale for a language choice given the device tag. */
export function resolveLocale(
  language: AppLanguage,
  systemLanguageTag: string | undefined | null,
): ResolvedLocale {
  switch (language) {
    case "zh-Hans":
      return "zh-Hans";
    case "en":
      return "en";
    case "system":
      return resolveSystemLocale(systemLanguageTag);
  }
}

/** BCP-47 tag for time formatting for a given locale. */
export function localeForTime(locale: ResolvedLocale): string {
  return locale === "zh-Hans" ? "zh-CN" : "en-US";
}
