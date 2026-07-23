export type ComposerActionState = {
  mode: "send" | "interrupt";
  disabled: boolean;
  pending: boolean;
};

/** Resolve the single composer action without mixing its send and interrupt rules. */
export function resolveComposerAction({
  canInterrupt,
  canSend,
  interruptPending,
  sendPending,
  voiceListening,
}: {
  canInterrupt: boolean;
  canSend: boolean;
  interruptPending: boolean;
  sendPending: boolean;
  voiceListening: boolean;
}): ComposerActionState {
  if (canInterrupt) {
    return {
      mode: "interrupt",
      disabled: interruptPending,
      pending: interruptPending,
    };
  }
  return {
    mode: "send",
    disabled: !canSend || voiceListening,
    pending: sendPending,
  };
}
