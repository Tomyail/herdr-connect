interface CompletionSoundPlayer {
  seekTo(position: number): unknown;
  play(): unknown;
}

/** Restore a playback-capable audio session before rewinding and playing. */
export async function playSoundFromStart(
  player: CompletionSoundPlayer,
  restorePlaybackAudioMode: () => Promise<void>,
): Promise<void> {
  await restorePlaybackAudioMode();
  await player.seekTo(0);
  player.play();
}

/** Completion-sound name retained for the provider and its focused regression test. */
export const playCompletionSound = playSoundFromStart;
