import { useState } from "react";
import { Animated, StyleSheet, View } from "react-native";

import { useTheme } from "../theme/ThemeContext";

const BAR_SPACING = 4;
const BAR_PROFILES = [0.68, 0.84, 1, 0.76, 0.9, 0.72, 0.58] as const;

/** A restrained, full-width microphone-level trace below the composer input. */
export function VoiceWaveform({
  accessibilityLabel,
  samples,
}: {
  accessibilityLabel: string;
  samples: readonly Animated.Value[];
}) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const barCount = Math.max(samples.length, Math.floor(width / BAR_SPACING));

  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="text"
      pointerEvents="none"
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={styles.track}
    >
      {Array.from({ length: barCount }, (_, index) => {
        const sampleIndex = Math.min(
          samples.length - 1,
          Math.floor((index / barCount) * samples.length),
        );
        const sample = samples[sampleIndex];
        if (!sample) return null;
        const profile = BAR_PROFILES[index % BAR_PROFILES.length] ?? 1;
        const scaleY = sample.interpolate({
          inputRange: [0, 0.18, 0.5, 1],
          outputRange: [0.12, 0.2 + profile * 0.1, 0.36 + profile * 0.24, 0.62 + profile * 0.38],
          extrapolate: "clamp",
        });
        return (
          <Animated.View
            key={index}
            style={[
              styles.bar,
              {
                backgroundColor: colors.accent,
                opacity: 0.52,
                transform: [{ scaleY }],
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: "100%",
    height: 12,
    marginTop: 1,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    overflow: "hidden",
  },
  bar: {
    width: 1,
    height: 10,
    borderRadius: 0.5,
  },
});
