import type { CPhase } from "./continuousReducer";

export type MicPressAction =
  | "toggleManualRecording"
  | "startContinuousSession"
  | "stopContinuousSession";

export type ContinuousModePressAction =
  | "enableContinuousMode"
  | "disableContinuousMode"
  | "disableContinuousModeAndStop";

export function actionForMicPress({
  continuousEnabled,
  phase,
  listening,
}: {
  continuousEnabled: boolean;
  phase: CPhase;
  listening: boolean;
}): MicPressAction {
  if (continuousEnabled && phase !== "idle") return "stopContinuousSession";
  if (listening) return "toggleManualRecording";
  if (continuousEnabled) return "startContinuousSession";
  return "toggleManualRecording";
}

export function actionForContinuousModePress({
  continuousEnabled,
  listening,
}: {
  continuousEnabled: boolean;
  listening: boolean;
}): ContinuousModePressAction {
  if (!continuousEnabled) return "enableContinuousMode";
  return listening ? "disableContinuousModeAndStop" : "disableContinuousMode";
}
