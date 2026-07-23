/**
 * Continuous voice mode state machine.
 *
 * A single useReducer that owns all phase transitions. Effects read the
 * reducer state and manage timers / engine calls; no mutation happens outside
 * the reducer. This replaces the previous collection of interlocked refs
 * (userStoppedRef / sawWorkingRef / intentRef / etc.) and ad-hoc useEffect
 * signal chains that kept drifting out of sync.
 */

import { useReducer } from "react";

export type CPhase = "idle" | "listening" | "countingDown" | "waitingForAgent";

interface CState {
  phase: CPhase;
  countdown: number | null;
  /** Date.now() of the most recent recognition result (for silence detection). */
  lastActivityAt: number;
  /** In "waitingForAgent": have we observed "working" yet? */
  sawWorking: boolean;
}

type CAction =
  | { type: "USER_START" }
  | { type: "RESULT_ACTIVITY"; at: number }
  | { type: "SILENCE_DETECTED" }
  | { type: "COUNTDOWN_TICK" }
  | { type: "COUNTDOWN_DONE" }
  | { type: "NO_SPEECH" }
  | { type: "PERMISSION_DENIED" }
  | { type: "USER_STOP" }
  | { type: "AGENT_WORKING" }
  | { type: "AGENT_READY" }
  | { type: "RESET" };

const INITIAL_CSTATE: CState = {
  phase: "idle",
  countdown: null,
  lastActivityAt: 0,
  sawWorking: false,
};

function cReducer(state: CState, action: CAction): CState {
  switch (state.phase) {

    // ── idle ───────────────────────────────────────────────────
    case "idle":
      switch (action.type) {
        // Rule 1: idle → listening on user start.
        case "USER_START":
          return { ...INITIAL_CSTATE, phase: "listening", lastActivityAt: Date.now() };
        // Rule 7 (agent switch / unmount): RESET stays idle.
        case "RESET":
          return INITIAL_CSTATE;
        default:
          return state;
      }

    // ── listening ──────────────────────────────────────────────
    case "listening":
      switch (action.type) {
        // Every recognition result refreshes the activity timestamp.
        case "RESULT_ACTIVITY":
          return { ...state, lastActivityAt: action.at };
        // Rule 2: only enter countdown if there IS draft content AND silence.
        case "SILENCE_DETECTED":
          return { ...state, phase: "countingDown", countdown: 3 };
        // Rule 8: no-speech or permission denied → back to idle.
        case "NO_SPEECH":
        case "PERMISSION_DENIED":
          return INITIAL_CSTATE;
        // Rule 6: user taps mic → idle.
        case "USER_STOP":
          return INITIAL_CSTATE;
        case "RESET":
          return INITIAL_CSTATE;
        default:
          return state;
      }

    // ── countingDown ───────────────────────────────────────────
    case "countingDown":
      switch (action.type) {
        // Rule 3: new result → abort countdown, back to listening.
        case "RESULT_ACTIVITY":
          return { ...state, phase: "listening", countdown: null, lastActivityAt: action.at };
        // Decrement every 1s interval tick.
        case "COUNTDOWN_TICK": {
          const nextCountdown = state.countdown !== null && state.countdown > 0
            ? state.countdown - 1
            : state.countdown;
          if (nextCountdown === state.countdown) return state;
          return { ...state, countdown: nextCountdown };
        }
        // Rule 4: countdown reached 0 → waitingForAgent.
        case "COUNTDOWN_DONE":
          return { ...INITIAL_CSTATE, phase: "waitingForAgent", sawWorking: false };
        // Rule 6: user taps mic → idle.
        case "USER_STOP":
          return INITIAL_CSTATE;
        case "RESET":
          return INITIAL_CSTATE;
        default:
          return state;
      }

    // ── waitingForAgent ────────────────────────────────────────
    case "waitingForAgent":
      switch (action.type) {
        // Rule 5: first observe working, then ready_input/blocked.
        case "AGENT_WORKING":
          return { ...state, sawWorking: true };
        case "AGENT_READY":
          if (state.sawWorking) {
            return { ...INITIAL_CSTATE, phase: "listening", lastActivityAt: Date.now() };
          }
          return state; // haven't seen working yet — ignore.
        // Rule 6: user taps mic → idle.
        case "USER_STOP":
          return INITIAL_CSTATE;
        case "NO_SPEECH":
        case "PERMISSION_DENIED":
          return INITIAL_CSTATE;
        case "RESET":
          return INITIAL_CSTATE;
        default:
          return state;
      }

    default:
      return state;
  }
}

export { cReducer, INITIAL_CSTATE as INITIAL_STATE };
