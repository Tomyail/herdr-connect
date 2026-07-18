import Svg, { Path } from "react-native-svg";

import { brandGlyphForAgent } from "./brand-icons";
import { Ionicons } from "./icons";

/**
 * Monochrome brand mark for an agent type, tinted via the given color.
 * Unknown agent names fall back to a generic terminal glyph.
 */
export function AgentBrandIcon({ name, size, color }: { name?: string; size: number; color: string }) {
  const glyph = brandGlyphForAgent(name);
  if (!glyph) {
    return <Ionicons name="terminal-outline" size={size} color={color} accessibilityLabel={name} />;
  }
  return (
    <Svg width={size} height={size} viewBox={glyph.viewBox ?? "0 0 24 24"} accessible accessibilityLabel={name}>
      <Path d={glyph.d} fill={color} fillRule="evenodd" />
    </Svg>
  );
}
