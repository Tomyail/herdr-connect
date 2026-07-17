import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Animated, Easing, PanResponder, StyleSheet, useWindowDimensions } from "react-native";

const EDGE_WIDTH = 32;
const DIRECTION_SLOP = 8;
const FLING_VELOCITY = 0.35;
const ENTER_DURATION = 260;
const EXIT_DURATION = 200;

interface SlideOverProps {
  onClosed: () => void;
  children: (close: () => void) => ReactNode;
}

export function SlideOver({ onClosed, children }: SlideOverProps) {
  const { width } = useWindowDimensions();
  const translateX = useRef(new Animated.Value(width)).current;
  const widthRef = useRef(width);
  widthRef.current = width;
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;
  const closingRef = useRef(false);

  useEffect(() => {
    Animated.timing(translateX, {
      toValue: 0,
      duration: ENTER_DURATION,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [translateX]);

  const close = useRef(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    Animated.timing(translateX, {
      toValue: widthRef.current,
      duration: EXIT_DURATION,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        onClosedRef.current();
      } else {
        closingRef.current = false;
      }
    });
  }).current;

  const settleBack = () => {
    Animated.spring(translateX, { toValue: 0, bounciness: 0, useNativeDriver: true }).start();
  };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) =>
        !closingRef.current &&
        gesture.x0 <= EDGE_WIDTH &&
        gesture.dx > DIRECTION_SLOP &&
        Math.abs(gesture.dy) < gesture.dx,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_event, gesture) => {
        translateX.setValue(Math.max(0, gesture.dx));
      },
      onPanResponderRelease: (_event, gesture) => {
        if (gesture.dx > widthRef.current / 3 || gesture.vx > FLING_VELOCITY) {
          close();
        } else {
          settleBack();
        }
      },
      onPanResponderTerminate: settleBack,
    }),
  ).current;

  return (
    <Animated.View
      style={[styles.overlay, { transform: [{ translateX }] }]}
      {...panResponder.panHandlers}
    >
      {children(close)}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: "#F3F1EA",
    shadowColor: "#000000",
    shadowOffset: { width: -6, height: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 14,
    elevation: 16,
  },
});
