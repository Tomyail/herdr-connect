/**
 * Voice recognition language resolution.
 *
 * The recognition language can be:
 *  - "follow system": use the device's real system locale (via expo-localization),
 *    so a device in Japanese/French/etc. recognizes that language even though
 *    the app's own UI only ships zh-Hans/en.
 *  - a fixed BCP-47 tag the owner picked (e.g. "zh-CN", "ja-JP"), overriding the
 *    system default.
 *
 * Supported locales are queried from the device at runtime via
 * {@link loadSupportedVoiceLocales} — different devices ship different language
 * models, so the picker is populated dynamically rather than from a hardcoded list.
 */

import { getLocales } from "expo-localization";
import { ExpoSpeechRecognitionModule } from "expo-speech-recognition";

import { VOICE_LANG_SYSTEM } from "./storage";

/** Read the device's primary system locale as a BCP-47 tag (e.g. "ja-JP"). */
export function systemVoiceLocale(): string {
  try {
    return getLocales()[0]?.languageTag ?? "en-US";
  } catch {
    return "en-US";
  }
}

/**
 * Map a locale tag that uses a script subtag (which speech recognizers reject)
 * to the language-REGION form they accept. Recognizers want e.g. "zh-CN" /
 * "zh-TW", not "zh-Hans" / "zh-Hant" (the form expo-localization / app UI
 * locales often report). Also folds a few common ambiguous cases.
 */
const SCRIPT_TO_REGION: Record<string, string> = {
  "zh-Hans": "zh-CN",
  "zh-Hant": "zh-TW",
  "zh-Hans-CN": "zh-CN",
  "zh-Hant-TW": "zh-TW",
  "zh-Hans-HK": "zh-HK",
  "zh-Hant-HK": "zh-HK",
  // A bare language code with no region is also not a valid recognizer locale.
  zh: "zh-CN",
  en: "en-US",
};

function mapScriptToRegion(lang: string): string {
  return SCRIPT_TO_REGION[lang] ?? lang;
}

/**
 * Resolve the stored choice to a concrete recognizer locale, normalized to a
 * form the engine accepts and validated against the device's supported list.
 *
 * - "system" follows the device locale.
 * - Script-based tags (zh-Hans etc.) are mapped to their region form (zh-CN).
 * - If the result still isn't in `supported`, we try the mapped form, then a
 *   same-language match, and finally fall back to en-US so recognition never
 *   hard-fails with language-not-supported.
 *
 * Pass an empty `supported` list to skip validation (e.g. when the query is
 * unavailable on the device).
 */
export function resolveVoiceLang(choice: string | undefined, supported: ReadonlyArray<string> = []): string {
  const raw = choice && choice !== VOICE_LANG_SYSTEM && choice.length > 0 ? choice : systemVoiceLocale();
  const mapped = mapScriptToRegion(raw);
  if (supported.length === 0) return mapped;
  if (supported.includes(mapped)) return mapped;
  if (supported.includes(raw)) return raw;
  // Try any supported locale with the same language prefix (e.g. zh-TW for zh-CN).
  const prefix = mapped.split("-")[0];
  const sameLang = supported.find((locale) => locale.split("-")[0] === prefix);
  if (sameLang) return sameLang;
  return supported.includes("en-US") ? "en-US" : (supported[0] ?? "en-US");
}

/** Result of querying the device for the languages it can actually recognize. */
export interface SupportedVoiceLocales {
  /** All locales the recognizer advertises as supported. */
  locales: string[];
}

/** Human-friendly label for a BCP-47 tag, using that locale's own display name. */
export function localeDisplay(tag: string): string {
  try {
    // Intl.DisplayNames gives a native-spelled name (e.g. "\u65E5\u672C\u8A9E", "Fran\u00E7ais").
    const display = new Intl.DisplayNames([tag], { type: "language" });
    const parts = tag.split("-");
    const base = parts[0];
    const region = parts[1];
    const name = base ? display.of(base) : undefined;
    if (name && region) return `${name} (${region})`;
    return name ?? tag;
  } catch {
    return tag;
  }
}

/**
 * Ask the device which speech-recognition locales it supports. Used to populate
 * the language picker. Returns an empty list if the query fails or is
 * unsupported (Android < 13) — callers should still offer the "follow system"
 * option and let the recognizer reject an unsupported tag at start() time.
 */
export async function loadSupportedVoiceLocales(): Promise<SupportedVoiceLocales> {
  try {
    const result = await ExpoSpeechRecognitionModule.getSupportedLocales({});
    return { locales: [...(result?.locales ?? [])].sort() };
  } catch (error) {
    console.warn("[voice] getSupportedLocales failed:", error);
    return { locales: [] };
  }
}
