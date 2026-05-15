import { useEffect, useState } from "react";
import { onMeter } from "../lib/tauri";

// useLevelMeter — owns peak/RMS ballistics and the Tauri `sesh:meter` subscription.
// Invariants:
//   * Exactly one RAF loop and one `sesh:meter` listener while mounted.
//   * Listener registration is race-safe on unmount: if the component
//     unmounts before listen() resolves, we still tear the listener down.
//   * Displayed peak/RMS never jump downward faster than RELEASE_DB_PER_S;
//     `peakHoldDb` holds the recent maximum for HOLD_MS then decays.
//   * `clipped` self-clears CLIP_HIDE_MS after the last clipped reading.
export function useLevelMeter() {
  const [peakDb, setPeakDb] = useState(-90);
  const [rmsDb, setRmsDb] = useState(-90);
  const [peakHoldDb, setPeakHoldDb] = useState(-90);
  const [clipped, setClipped] = useState(false);

  useEffect(() => {
    const DB_FLOOR = -90;
    const HOLD_MS = 1500;
    const HOLD_DECAY_DB_PER_S = 12;
    const RELEASE_DB_PER_S = 26;
    const CLIP_HIDE_MS = 700;

    let cancelled = false;
    let unlistenFn: (() => void) | null = null;
    let raf = 0;
    let lastFrame = performance.now();
    let displayPeak = DB_FLOOR;
    let displayRms = DB_FLOOR;
    let targetPeak = DB_FLOOR;
    let targetRms = DB_FLOOR;
    let hold = DB_FLOOR;
    let holdSetAt = 0;
    let clipHideAt = 0;

    const animate = (now: number) => {
      raf = requestAnimationFrame(animate);
      const dt = Math.min(0.1, (now - lastFrame) / 1000);
      lastFrame = now;

      displayPeak =
        targetPeak >= displayPeak
          ? targetPeak
          : Math.max(targetPeak, displayPeak - RELEASE_DB_PER_S * dt);
      displayRms =
        targetRms >= displayRms
          ? targetRms
          : Math.max(targetRms, displayRms - RELEASE_DB_PER_S * dt);

      if (targetPeak >= hold) {
        hold = targetPeak;
        holdSetAt = now;
      } else if (now - holdSetAt > HOLD_MS) {
        hold = Math.max(targetPeak, hold - HOLD_DECAY_DB_PER_S * dt);
      }

      setPeakDb(displayPeak);
      setRmsDb(displayRms);
      setPeakHoldDb(hold);

      if (clipHideAt && now > clipHideAt) {
        clipHideAt = 0;
        setClipped(false);
      }
    };
    raf = requestAnimationFrame(animate);

    onMeter((r) => {
      targetPeak = r.peak_db;
      targetRms = r.rms_db;
      if (r.clipped) {
        clipHideAt = performance.now() + CLIP_HIDE_MS;
        setClipped(true);
      }
    }).then((u) => {
      // Race-safe: if effect cleanup ran before listen() resolved, tear
      // down immediately; otherwise stash the unlistener for cleanup.
      if (cancelled) u();
      else unlistenFn = u;
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      unlistenFn?.();
    };
  }, []);

  return { peakDb, rmsDb, peakHoldDb, clipped };
}
