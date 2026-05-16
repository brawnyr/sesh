import { useCallback, useEffect, useRef, useState } from "react";
import type { Metronome } from "../lib/metronome";
import { seshApi } from "../lib/tauri";
import type { RecState } from "../lib/state";

const BEATS_PER_BAR = 4;

type UseRecorderOptions = {
  metronome: Metronome;
  bpm: number;
  metroOn: boolean;
  countIn: boolean;
  onError: (message: string | null) => void;
  /** Called after a successful stop (UI can refresh takes list, fire splash, etc.). */
  onStopped: () => void;
  /** Called the moment we enter `arming` (e.g. to cache the record-button rect). */
  onArmStart?: () => void;
  /** Called when arming is cancelled or fails mid-arm (e.g. to reset bar/beat UI). */
  onArmExit?: () => void;
  /** Called once capture actually begins. */
  onRecordingStarted?: () => void;
};

// useRecorder — owns the recording state machine and the elapsed-time clock.
// Invariants:
//   * `state` transitions: idle -> (arming -> idle | arming -> recording -> stopping -> idle | recording -> stopping -> idle).
//   * `armTimerRef` is non-null iff state === "arming"; cleared on cancel/fire.
//   * `recordStartRef` is non-null iff state === "recording"; cleared on stop.
//   * `elapsed` is driven by RAF only while state !== "idle"; resets to 0 on idle.
//   * The metronome is started before arming (if enabled) and stopped on idle.
export function useRecorder({
  metronome,
  bpm,
  metroOn,
  countIn,
  onError,
  onStopped,
  onArmStart,
  onArmExit,
  onRecordingStarted,
}: UseRecorderOptions) {
  const [state, setState] = useState<RecState>("idle");
  const [elapsed, setElapsed] = useState(0);

  const recordStartRef = useRef<number | null>(null);
  const armTimerRef = useRef<number | null>(null);

  // Always read the freshest callbacks/prefs from inside `toggleRecord`
  // without rebuilding it on every keystroke — keeps the Space-bar key
  // listener stable.
  const latest = useRef({
    bpm,
    metroOn,
    countIn,
    onError,
    onStopped,
    onArmStart,
    onArmExit,
    onRecordingStarted,
  });
  latest.current = {
    bpm,
    metroOn,
    countIn,
    onError,
    onStopped,
    onArmStart,
    onArmExit,
    onRecordingStarted,
  };

  useEffect(() => {
    if (state === "idle") {
      setElapsed(0);
      return;
    }
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      if (state === "recording" && recordStartRef.current !== null) {
        setElapsed((now - recordStartRef.current) / 1000);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state]);

  const cancelArming = useCallback(() => {
    if (armTimerRef.current !== null) {
      clearTimeout(armTimerRef.current);
      armTimerRef.current = null;
    }
    metronome.stop();
    setState("idle");
    latest.current.onArmExit?.();
  }, [metronome]);

  const toggleRecord = useCallback(async () => {
    const { metroOn, countIn, bpm, onError, onStopped, onArmStart, onArmExit, onRecordingStarted } =
      latest.current;

    onError(null);
    if (state === "stopping") return;

    if (state === "arming") {
      cancelArming();
      return;
    }

    if (state === "recording") {
      setState("stopping");
      try {
        await seshApi.stopRecording();
      } catch (e) {
        onError(String(e));
      }
      if (metroOn) metronome.stop();
      recordStartRef.current = null;
      setState("idle");
      onStopped();
      return;
    }

    try {
      if (metroOn) await metronome.start();

      const beginCapture = async () => {
        await seshApi.startRecording();
        recordStartRef.current = performance.now();
        setState("recording");
        onRecordingStarted?.();
      };

      if (metroOn && countIn) {
        onArmStart?.();
        setState("arming");
        const barMs = (60_000 / bpm) * BEATS_PER_BAR * 2;
        armTimerRef.current = window.setTimeout(async () => {
          armTimerRef.current = null;
          try {
            await beginCapture();
          } catch (e) {
            onError(String(e));
            metronome.stop();
            setState("idle");
            onArmExit?.();
          }
        }, barMs);
      } else {
        await beginCapture();
      }
    } catch (e) {
      onError(String(e));
      metronome.stop();
      setState("idle");
    }
  }, [state, metronome, cancelArming]);

  return { state, elapsed, toggleRecord };
}
