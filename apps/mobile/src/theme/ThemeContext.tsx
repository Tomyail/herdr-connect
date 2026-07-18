/**
 * Theme React layer.
 *
 * - Initial appearance is read synchronously from {@link appearanceStorage} so
 *   the very first render uses the correct theme (no light-theme flash).
 * - When the choice is "system", `useColorScheme` keeps the resolved theme in
 *   sync with the device setting, including live changes while the app is open.
 * - Exposes the semantic {@link ThemeColors} for the resolved theme, plus
 *   `setAppearance` to persist + apply a new choice.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useColorScheme } from "react-native";

import { resolveTheme, type AppearanceChoice, type ResolvedTheme } from "./appearance";
import { appearanceStorage } from "./storage";
import { themeColors, type ThemeColors } from "./tokens";

export interface ThemeValue {
  /** Owner's persisted choice (System Default / Light / Dark). */
  appearance: AppearanceChoice;
  /** Concrete theme currently rendered. */
  theme: ResolvedTheme;
  /** Semantic colors for the current theme. */
  colors: ThemeColors;
  /** Persist + apply a new appearance choice. */
  setAppearance: (choice: AppearanceChoice) => void;
}

const ThemeContext = createContext<ThemeValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Synchronous initial read -> first render already has the right theme.
  const [appearance, setAppearanceState] = useState<AppearanceChoice>(() =>
    appearanceStorage.read(),
  );
  const systemScheme = useColorScheme();

  const theme = resolveTheme(appearance, systemScheme);

  const setAppearance = useCallback((next: AppearanceChoice) => {
    appearanceStorage.write(next);
    setAppearanceState(next);
  }, []);

  const value = useMemo<ThemeValue>(
    () => ({ appearance, theme, colors: themeColors[theme], setAppearance }),
    [appearance, theme, setAppearance],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used within a ThemeProvider");
  return value;
}

/**
 * Memoized themed StyleSheet. Pass a module-level factory so the identity is
 * stable and styles are only rebuilt when the theme actually changes.
 */
export function useThemedStyles<T>(factory: (colors: ThemeColors) => T): T {
  const { colors } = useTheme();
  return useMemo(() => factory(colors), [factory, colors]);
}
