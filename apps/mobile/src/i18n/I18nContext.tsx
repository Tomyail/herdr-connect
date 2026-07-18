/**
 * i18n React layer.
 *
 * - Initial language is read synchronously from {@link languageStorage} so the
 *   very first render uses the correct locale (no flicker — decision #8).
 * - When the choice is "system", the device locale is re-read whenever the app
 *   returns to the foreground so language changes apply instantly (decision #4).
 * - Exposes a `t` (UI messages) and `tError` (stable error codes) bound to the
 *   current locale, plus `formatTime` and `setLanguage`.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AppState, type AppStateStatus } from "react-native";
import { getLocales } from "expo-localization";

import {
  APP_LANGUAGES,
  resolveLocale,
  localeForTime,
  type AppLanguage,
  type ResolvedLocale,
} from "./locale";
import { languageStorage } from "./storage";
import {
  translateUi,
  translateError,
  type MessageKey,
  type TranslateParams,
} from "./messages";
import type { NetworkErrorCode } from "./errors";

export interface I18nValue {
  /** Owner's persisted choice (System Default / 简体中文 / English). */
  language: AppLanguage;
  /** Concrete locale currently rendered. */
  locale: ResolvedLocale;
  /** Translate a UI message, with optional `{placeholder}` params. */
  t: (key: MessageKey, params?: TranslateParams) => string;
  /** Translate a stable error code, with optional `{placeholder}` params. */
  tError: (code: NetworkErrorCode, params?: TranslateParams) => string;
  /** Persist + apply a new language choice. */
  setLanguage: (language: AppLanguage) => void;
  /** Format an ISO timestamp using the current locale; invalid input falls back to "Unknown". */
  formatTime: (iso: string) => string;
}

const I18nContext = createContext<I18nValue | undefined>(undefined);

function readSystemLanguageTag(): string | undefined {
  try {
    return getLocales()[0]?.languageTag ?? undefined;
  } catch {
    return undefined;
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  // Synchronous initial read -> first render already has the right locale.
  const [language, setLanguageState] = useState<AppLanguage>(() => languageStorage.read());
  const [systemLanguageTag, setSystemLanguageTag] = useState<string | undefined>(
    readSystemLanguageTag,
  );

  // Re-read the device locale on foreground (Android can change it without restart).
  useEffect(() => {
    const refresh = () => setSystemLanguageTag(readSystemLanguageTag());
    const subscription = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "active") refresh();
    });
    return () => subscription.remove();
  }, []);

  const locale = useMemo<ResolvedLocale>(
    () => resolveLocale(language, systemLanguageTag),
    [language, systemLanguageTag],
  );

  const setLanguage = useCallback((next: AppLanguage) => {
    languageStorage.write(next);
    setLanguageState(next);
  }, []);

  const t = useCallback(
    (key: MessageKey, params?: TranslateParams) =>
      translateUi(locale, key, params),
    [locale],
  );
  const tError = useCallback(
    (code: NetworkErrorCode, params?: TranslateParams) =>
      translateError(locale, code, params),
    [locale],
  );
  const formatTime = useCallback(
    (iso: string) => {
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return translateUi(locale, "common.unknown");
      return date.toLocaleTimeString(localeForTime(locale), {
        hour: "2-digit",
        minute: "2-digit",
      });
    },
    [locale],
  );

  const value = useMemo<I18nValue>(
    () => ({ language, locale, t, tError, setLanguage, formatTime }),
    [language, locale, t, tError, setLanguage, formatTime],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used within an I18nProvider");
  return value;
}

/** Ordered language options for the Language screen. */
export const LANGUAGE_OPTIONS: readonly AppLanguage[] = APP_LANGUAGES;
