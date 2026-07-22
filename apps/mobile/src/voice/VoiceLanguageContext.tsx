/**
 * Voice recognition language React layer.
 *
 * Mirrors the language/appearance contexts: the persisted choice is read
 * synchronously on mount (MMKV, no flash), and a setter persists + applies the
 * new value. The concrete BCP-47 tag passed to the recognizer is resolved from
 * the choice (with "system" following the device locale) — but components only
 * need the raw choice for display/selection, so this context exposes `choice`
 * rather than the resolved tag.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { voiceLanguageStorage, VOICE_LANG_SYSTEM } from "./storage";

export interface VoiceLanguageValue {
  /** Persisted choice: a BCP-47 tag or the "system" sentinel. */
  choice: string;
  /** Persist + apply a new choice. */
  setChoice: (lang: string) => void;
}

const VoiceLanguageContext = createContext<VoiceLanguageValue | undefined>(undefined);

export function VoiceLanguageProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<string>(() => voiceLanguageStorage.read());

  const setChoice = useCallback((lang: string) => {
    voiceLanguageStorage.write(lang);
    setChoiceState(lang);
  }, []);

  const value = useMemo<VoiceLanguageValue>(() => ({ choice, setChoice }), [choice, setChoice]);

  return <VoiceLanguageContext.Provider value={value}>{children}</VoiceLanguageContext.Provider>;
}

export function useVoiceLanguage(): VoiceLanguageValue {
  const value = useContext(VoiceLanguageContext);
  if (!value) throw new Error("useVoiceLanguage must be used within a VoiceLanguageProvider");
  return value;
}

export { VOICE_LANG_SYSTEM };
