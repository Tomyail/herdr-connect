import { setAudioModeAsync } from "expo-audio";

const PLAYBACK_AUDIO_MODE: Parameters<typeof setAudioModeAsync>[0] = {
  playsInSilentMode: true,
  interruptionMode: "duckOthers",
  shouldPlayInBackground: false,
};

/**
 * Re-apply the app's playback session after speech recognition has replaced the
 * shared iOS AVAudioSession category/mode with playAndRecord/measurement.
 */
export function restorePlaybackAudioMode(): Promise<void> {
  return setAudioModeAsync(PLAYBACK_AUDIO_MODE);
}
