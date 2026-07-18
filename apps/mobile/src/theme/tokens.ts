/**
 * Semantic color tokens for both themes.
 *
 * Light keeps the original hand-tuned palette (warm paper + forest green).
 * Dark is derived from the app icon: pure black ground, the icon's neon-green
 * outline as accent, the ram's off-white as primary text, and the icon's three
 * traffic-light dots as status colors. Screens must consume colors through
 * these tokens only — never hardcode a hex in a component.
 */

import type { ResolvedTheme } from "./appearance";

export interface ThemeColors {
  /** Screen ground. */
  background: string;
  /** Elevated surfaces: cards, list containers, composer. */
  card: string;
  cardBorder: string;
  /** Hairline between rows inside a card. */
  separator: string;

  textPrimary: string;
  textSecondary: string;
  /** Row icons, placeholders, de-emphasized labels. */
  textMuted: string;
  /** Chevrons and other barely-there glyphs. */
  textFaint: string;

  /** Brand color: header tint, checkmarks, selected states. */
  accent: string;
  /** Prominent action fills (refresh, send). */
  actionBg: string;
  onAction: string;
  actionDisabledBg: string;
  onActionDisabled: string;

  statusCard: string;
  statusCardConnected: string;
  /** Dot while discovering / not connected. */
  statusDot: string;
  statusDotConnected: string;

  selectedCard: string;
  selectedCardBorder: string;

  success: string;
  danger: string;

  switchTrackOff: string;
  switchTrackOn: string;
  switchThumb: string;

  /** Monospace history text. */
  transcript: string;
  spinner: string;

  tabBarActive: string;
  tabBarInactive: string;
}

const light: ThemeColors = {
  background: "#F3F1EA",
  card: "#FFFFFF",
  cardBorder: "#DAD8D0",
  separator: "#ECEAE3",

  textPrimary: "#1B1E1A",
  textSecondary: "#777B72",
  textMuted: "#8A8E86",
  textFaint: "#B4B7B0",

  accent: "#466447",
  actionBg: "#1E211D",
  onAction: "#FFFFFF",
  actionDisabledBg: "#C7C9C3",
  onActionDisabled: "#FFFFFF",

  statusCard: "#E8E5DC",
  statusCardConnected: "#DFE9DA",
  statusDot: "#9A7B57",
  statusDotConnected: "#467347",

  selectedCard: "#F4F8F1",
  selectedCardBorder: "#6F916B",

  success: "#4F744D",
  danger: "#A34B43",

  switchTrackOff: "#D6D4CC",
  switchTrackOn: "#6F916B",
  switchThumb: "#FFFFFF",

  transcript: "#30342E",
  spinner: "#646B61",

  tabBarActive: "#1E211D",
  tabBarInactive: "#8A8E86",
};

const dark: ThemeColors = {
  background: "#000000", // icon ground
  card: "#121712",
  cardBorder: "#222A23",
  separator: "#1E251F",

  textPrimary: "#E7E5E0", // icon ram body
  textSecondary: "#969C92",
  textMuted: "#7C837A",
  textFaint: "#4C544D",

  accent: "#60FA97", // icon outline
  actionBg: "#60FA97",
  onAction: "#04130A",
  actionDisabledBg: "#1F2620",
  onActionDisabled: "#5F695F",

  statusCard: "#121712",
  statusCardConnected: "#0E2417",
  statusDot: "#FEB62B", // icon amber dot
  statusDotConnected: "#6DE23A", // icon green dot

  selectedCard: "#0E2417",
  selectedCardBorder: "#60FA97",

  success: "#6DE23A",
  danger: "#FE425A", // icon red dot

  switchTrackOff: "#2A322B",
  switchTrackOn: "#2E8C55",
  switchThumb: "#FFFFFF",

  transcript: "#C6CCC1",
  spinner: "#969C92",

  tabBarActive: "#60FA97",
  tabBarInactive: "#6F776E",
};

export const themeColors: Record<ResolvedTheme, ThemeColors> = { light, dark };
