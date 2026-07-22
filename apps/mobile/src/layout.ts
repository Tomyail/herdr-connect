/**
 * Width-driven responsive layout helpers.
 *
 * The app adapts to the *current window width*, not to the device type, so an
 * iPad in Split View / Slide Over / Stage Manager at a phone-like width behaves
 * exactly like an iPhone, and a window dragged wide on any device becomes the
 * split layout. The single named breakpoint below is the only width threshold
 * in the codebase — never inline another magic number.
 */

import { useWindowDimensions } from "react-native";

/**
 * Width at/above which the wide split layout is used.
 *
 * The wide layout reserves fixed columns — 220pt sidebar + 340pt list = 560pt —
 * before the detail column even starts, so the window needs enough remaining
 * width for a usable detail pane. 768 keeps the narrowest iPad portrait widths
 * (e.g. iPad mini at 744pt) in the phone layout by design, since 744 − 560 =
 * 184pt is too cramped for the detail/transcript column, while giving the next
 * size up enough room. It is a single width threshold, not a device-type check,
 * so any window resized across it (iPad Split View / Slide Over / Stage Manager
 * included) switches layouts live.
 */
export const SPLIT_BREAKPOINT = 768;

/** True when the current window is at least {@link SPLIT_BREAKPOINT} wide. */
export function useIsWideLayout(): boolean {
  const { width } = useWindowDimensions();
  return width >= SPLIT_BREAKPOINT;
}
