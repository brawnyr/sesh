import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  CLICK_VOICES,
  Metronome,
  type ClickVoice,
} from "./lib/metronome";
import {
  onWriteError,
  seshApi,
  type InputDevice,
  type TakeMeta,
} from "./lib/tauri";
import { clamp, formatDuration } from "./lib/util";
import { ClickPicker } from "./components/ClickPicker";
import { DevicePanel } from "./components/DevicePanel";
import { BeatStrip } from "./components/BeatStrip";
import { VuMeter } from "./components/VuMeter";
import { TakesShelf } from "./components/TakesShelf";
import { RecordOrb } from "./components/RecordOrb";
import { useLevelMeter } from "./hooks/useLevelMeter";
import { useRecorder } from "./hooks/useRecorder";

const PREFS_KEY = "sesh:prefs:v1";

const BEATS_PER_BAR = 4;

type Prefs = {
  bpm: number;
  metroVolume: number;
  metroOn: boolean;
  countIn: boolean;
  voice: ClickVoice;
  device: string | null;
};

const DEFAULT_PREFS: Prefs = {
  bpm: 100,
  metroVolume: 0.55,
  metroOn: true,
  countIn: true,
  voice: "tick",
  device: null,
};

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_PREFS,
      ...parsed,
      voice: CLICK_VOICES.includes(parsed.voice) ? parsed.voice : "tick",
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {}
}

export function App() {
  const metronomeRef = useRef<Metronome | null>(null);
  if (!metronomeRef.current) metronomeRef.current = new Metronome();
  const metronome = metronomeRef.current;

  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs());
  const [activeBeat, setActiveBeat] = useState<number | null>(null);
  const [devices, setDevices] = useState<InputDevice[]>([]);
  const [takes, setTakes] = useState<TakeMeta[]>([]);
  const [takesDir, setTakesDir] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const { peakDb, rmsDb, peakHoldDb, clipped } = useLevelMeter();

  const barStartRef = useRef<number | null>(null);
  const tapTimesRef = useRef<number[]>([]);

  const [editingBpm, setEditingBpm] = useState(false);
  const [bpmInput, setBpmInput] = useState("");

  useEffect(() => {
    savePrefs(prefs);
  }, [prefs]);

  const updatePrefs = useCallback((patch: Partial<Prefs>) => {
    setPrefs((p) => ({ ...p, ...patch }));
  }, []);

  useEffect(() => {
    metronome.setOptions({
      bpm: prefs.bpm,
      beatsPerBar: BEATS_PER_BAR,
      volume: prefs.metroVolume,
      voice: prefs.voice,
    });
  }, [metronome, prefs.bpm, prefs.metroVolume, prefs.voice]);

  useEffect(() => {
    const off = metronome.onBeat((beat, downbeat) => {
      setActiveBeat(beat);
      if (downbeat) {
        barStartRef.current = performance.now();
      }
      window.setTimeout(() => {
        setActiveBeat((prev) => (prev === beat ? null : prev));
      }, Math.max(80, (60_000 / prefs.bpm) * 0.3));
    });
    return off;
  }, [metronome, prefs.bpm]);

  useEffect(() => {
    void refreshDevices();
    void refreshSettings();
    void refreshTakes();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlistenFn: (() => void) | null = null;
    onWriteError((msg) => {
      setError(`disk write failed: ${msg}`);
    }).then((u) => {
      if (cancelled) u();
      else unlistenFn = u;
    });
    return () => {
      cancelled = true;
      unlistenFn?.();
    };
  }, []);

  useEffect(() => {
    if (!prefs.device) return;
    seshApi
      .setInputDevice(prefs.device)
      .catch((e: unknown) => setError(String(e)));
  }, [prefs.device]);

  async function refreshDevices() {
    try {
      const list = await seshApi.listInputDevices();
      setDevices(list);
      if (!prefs.device || !list.find((d) => d.name === prefs.device)) {
        const scarlett = list.find((d) => /scarlett\s*solo/i.test(d.name));
        const def =
          scarlett ?? list.find((d) => d.is_default) ?? list[0];
        if (def) updatePrefs({ device: def.name });
      }
    } catch (e) {
      setError(String(e));
    }
  }

  async function refreshSettings() {
    try {
      const s = await seshApi.getSettings();
      setTakesDir(s.takes_dir);
    } catch (e) {
      setError(String(e));
    }
  }

  async function refreshTakes() {
    try {
      const list = await seshApi.listTakes();
      setTakes(list);
    } catch (e) {
      setError(String(e));
    }
  }

  const commitBpm = useCallback(
    (next: number) => updatePrefs({ bpm: clamp(Math.round(next), 40, 240) }),
    [updatePrefs],
  );

  const tapTempo = useCallback(() => {
    const now = performance.now();
    const taps = tapTimesRef.current;
    const last = taps[taps.length - 1];
    if (last && now - last > 2500) taps.length = 0;
    taps.push(now);
    if (taps.length > 8) taps.shift();
    if (taps.length < 2) return;
    let total = 0;
    for (let i = 1; i < taps.length; i++) total += taps[i] - taps[i - 1];
    const avg = total / (taps.length - 1);
    if (avg > 0) commitBpm(60000 / avg);
  }, [commitBpm]);

  const { state, elapsed, toggleRecord } = useRecorder({
    metronome,
    bpm: prefs.bpm,
    metroOn: prefs.metroOn,
    countIn: prefs.countIn,
    onError: setError,
    onStopped: useCallback(() => {
      barStartRef.current = null;
      setActiveBeat(null);
      void refreshTakes();
    }, []),
    onArmStart: useCallback(() => {}, []),
    onArmExit: useCallback(() => {
      setActiveBeat(null);
      barStartRef.current = null;
    }, []),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat) {
        const target = e.target as HTMLElement | null;
        if (target && /input|textarea|select/i.test(target.tagName)) return;
        e.preventDefault();
        void toggleRecord();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleRecord]);

  const handlePickDir = useCallback(async () => {
    try {
      const picked = await openDialog({ directory: true, multiple: false });
      if (!picked || Array.isArray(picked)) return;
      const s = await seshApi.setTakesDir(picked);
      setTakesDir(s.takes_dir);
      void refreshTakes();
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const stateLabel = useMemo(() => {
    switch (state) {
      case "idle":      return "ready";
      case "arming":    return "count-in";
      case "recording": return "rolling";
      case "stopping":  return "saving";
    }
  }, [state]);

  const isBusy = state !== "idle";

  return (
    <div style={{ height: "100vh", width: "100vw", display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 16px 8px", minHeight: 0 }}>
        <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
          {error && (
            <div
              role="button"
              tabIndex={0}
              onClick={() => setError(null)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") setError(null);
              }}
              title="click to dismiss"
              style={{ border: "1px solid #000", padding: "4px 8px", cursor: "pointer" }}
            >
              ! {error}
            </div>
          )}

          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontFamily: '"Press Start 2P", "JetBrains Mono", monospace', fontSize: 22, letterSpacing: "0.05em" }}>sesh</span>
            <span>[{stateLabel}]</span>
          </header>

          <section style={{ display: "flex", flexDirection: "column", gap: 16, padding: "16px 0", borderTop: "1px solid #000", borderBottom: "1px solid #000" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
            <span style={{ fontSize: 72, fontWeight: 700, lineHeight: 1, letterSpacing: "0.04em" }}>{formatDuration(elapsed)}</span>
            <BeatStrip beatsPerBar={BEATS_PER_BAR} activeBeat={activeBeat} size={36} />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 18 }}>
            <span>tempo</span>
            {editingBpm ? (
              <input
                autoFocus
                type="number"
                min={40}
                max={240}
                value={bpmInput}
                onChange={(e) => setBpmInput(e.target.value)}
                onBlur={() => {
                  const n = parseFloat(bpmInput);
                  if (!isNaN(n)) commitBpm(n);
                  setEditingBpm(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") setEditingBpm(false);
                }}
                style={{ width: 100, fontSize: 22, fontWeight: 700, padding: "4px 8px", textAlign: "center" }}
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setBpmInput(String(Math.round(prefs.bpm)));
                  setEditingBpm(true);
                }}
                disabled={isBusy}
                title="click to type"
                style={{ fontSize: 22, fontWeight: 700, padding: "4px 12px", minWidth: 80, textAlign: "center" }}
              >
                {Math.round(prefs.bpm).toString().padStart(3, "0")}
              </button>
            )}
            <span>bpm</span>
            <button type="button" disabled={isBusy} onClick={() => commitBpm(prefs.bpm - 1)} aria-label="decrease bpm" style={{ fontSize: 18, padding: "4px 12px", minWidth: 36, textAlign: "center" }}>−</button>
            <button type="button" disabled={isBusy} onClick={() => commitBpm(prefs.bpm + 1)} aria-label="increase bpm" style={{ fontSize: 18, padding: "4px 12px", minWidth: 36, textAlign: "center" }}>+</button>
            <button type="button" disabled={isBusy} onClick={tapTempo} title="tap to set tempo" style={{ fontSize: 18, padding: "4px 14px" }}>tap</button>
          </div>
        </section>

        <section style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span>input</span>
          <DevicePanel
            devices={devices}
            selected={prefs.device}
            onSelect={(name) => updatePrefs({ device: name })}
            onRefresh={refreshDevices}
            disabled={state === "recording" || state === "stopping"}
          />
        </section>

        <section style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span>click</span>
          <ClickPicker
            value={prefs.voice}
            onChange={(voice) => updatePrefs({ voice })}
            onAudition={(voice) => {
              metronome.setOptions({ voice });
              void metronome.audition();
            }}
            disabled={state === "recording" || state === "stopping"}
          />
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: isBusy ? "not-allowed" : "pointer" }}>
              <input
                type="checkbox"
                checked={prefs.metroOn}
                disabled={isBusy}
                onChange={(e) => updatePrefs({ metroOn: e.target.checked })}
              />
              metronome
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: isBusy ? "not-allowed" : "pointer" }}>
              <input
                type="checkbox"
                checked={prefs.countIn}
                disabled={isBusy}
                onChange={(e) => updatePrefs({ countIn: e.target.checked })}
              />
              count-in
            </label>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ minWidth: 60 }}>volume {Math.round(prefs.metroVolume * 100)}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(prefs.metroVolume * 100)}
              onChange={(e) =>
                updatePrefs({
                  metroVolume: clamp(Number(e.target.value) / 100, 0, 1),
                })
              }
            />
          </div>
        </section>

        <section style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span>level</span>
          <VuMeter
            peakDb={peakDb}
            rmsDb={rmsDb}
            peakHoldDb={peakHoldDb}
            clipped={clipped}
          />
        </section>

        <section style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span>takes</span>
          <TakesShelf takes={takes} />
        </section>

        <section style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span>save to</span>
          <div style={{ display: "flex", gap: 4 }}>
            <button
              type="button"
              onClick={handlePickDir}
              title={takesDir}
              style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              {takesDir || "choose folder..."}
            </button>
            <button
              type="button"
              onClick={() => takesDir && seshApi.revealInFolder(takesDir)}
              disabled={!takesDir}
              title="open folder"
            >
              open
            </button>
          </div>
        </section>
        </div>
      </div>

      <div
        style={{
          flexShrink: 0,
          borderTop: "2px solid #000",
          background: "#fff",
          padding: 12,
        }}
      >
        <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", alignItems: "center", gap: 12 }}>
          <RecordOrb
            state={state}
            onClick={toggleRecord}
            disabled={state === "stopping"}
          />
          <span>space = record/stop</span>
        </div>
      </div>
    </div>
  );
}
