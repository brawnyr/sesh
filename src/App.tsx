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
import { Splash, type SplashEvent } from "./components/Splash";
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
  const [splash, setSplash] = useState<SplashEvent | null>(null);

  const { peakDb, rmsDb, peakHoldDb, clipped } = useLevelMeter();

  const barStartRef = useRef<number | null>(null);
  const recordRectRef = useRef<DOMRect | null>(null);
  const recordBtnRef = useRef<HTMLDivElement | null>(null);
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

  // Surface disk write failures from the audio worker as the error banner.
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

  const triggerSplash = useCallback(() => {
    const rect =
      recordRectRef.current ?? recordBtnRef.current?.getBoundingClientRect();
    const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const y = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
    setSplash({ id: Date.now() + Math.random(), x, y });
  }, []);

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
      triggerSplash();
      void refreshTakes();
    }, [triggerSplash]),
    onArmStart: useCallback(() => {
      const cached = recordBtnRef.current?.getBoundingClientRect();
      if (cached) recordRectRef.current = cached;
    }, []),
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
      case "stopping":  return "saving…";
    }
  }, [state]);

  const isBusy = state !== "idle";
  const tcRec = state === "recording";
  const tcDim = state === "idle";

  return (
    <div className="h-screen w-screen relative overflow-hidden">
      {error && (
        <div
          className="banner absolute top-3 left-1/2 -translate-x-1/2 z-50 px-3 py-1.5 cursor-pointer"
          role="button"
          tabIndex={0}
          onClick={() => setError(null)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") setError(null);
          }}
          title="click to dismiss"
        >
          {error}
        </div>
      )}

      <div className="relative z-10 h-full flex flex-col overflow-y-auto scrollbar-thin">
        <header className="px-8 pt-7 pb-4 flex items-center justify-between gap-4 max-w-6xl w-full mx-auto">
          <div className="title">
            <span className={`title-dot ${state}`} aria-hidden />
            <span className="title-mark">sesh</span>
            <span className="title-sub">session recorder</span>
          </div>
          <span
            className={`stamp-chip ${
              state === "recording"
                ? "recording"
                : state === "arming"
                  ? "arming"
                  : ""
            }`}
          >
            {stateLabel}
          </span>
        </header>

        <main className="px-8 flex-1 flex flex-col items-center gap-8 max-w-6xl w-full mx-auto">
          <section className="paper timecode-card pinned-c w-full max-w-2xl">
            <span className="tape-strip">register</span>

            <div className="flex items-end justify-between gap-4">
              <div className="flex flex-col gap-2">
                <span className="stamp">timecode</span>
                <div className="timecode-stack">
                  <span className={`numerals huge ${tcRec ? "rec" : tcDim ? "dim" : ""}`}>
                    {formatDuration(elapsed)}
                  </span>
                </div>
              </div>

              <div className="flex flex-col items-end gap-2">
                <span className="stamp">bar</span>
                <BeatStrip beatsPerBar={BEATS_PER_BAR} activeBeat={activeBeat} />
              </div>
            </div>

            <div className="divider" />

            <div className="tempo-row">
              <div className="flex items-baseline gap-2">
                <span className="scribble-label">tempo</span>
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
                    className="tempo-input"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setBpmInput(String(Math.round(prefs.bpm)));
                      setEditingBpm(true);
                    }}
                    disabled={isBusy}
                    className="numerals big"
                    title="click to type a BPM"
                    style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
                  >
                    {Math.round(prefs.bpm).toString().padStart(3, "0")}
                  </button>
                )}
                <span className="scribble-label">bpm</span>
              </div>

              <div className="flex gap-1.5">
                <button
                  type="button"
                  className="btn sm"
                  disabled={isBusy}
                  onClick={() => commitBpm(prefs.bpm - 1)}
                  aria-label="decrease bpm"
                >
                  −
                </button>
                <button
                  type="button"
                  className="btn sm"
                  disabled={isBusy}
                  onClick={() => commitBpm(prefs.bpm + 1)}
                  aria-label="increase bpm"
                >
                  +
                </button>
                <button
                  type="button"
                  className="btn sm"
                  disabled={isBusy}
                  onClick={tapTempo}
                  title="tap to set tempo"
                >
                  tap
                </button>
              </div>
            </div>
          </section>

          <div ref={recordBtnRef} className="flex flex-col items-center gap-2">
            <RecordOrb
              state={state}
              onClick={toggleRecord}
              disabled={state === "stopping"}
            />
            <div className="scribble-label mt-1">
              {state === "recording"
                ? "tap to stop"
                : state === "arming"
                  ? "tap to cancel"
                  : state === "stopping"
                    ? "saving wav…"
                    : "tap to record · space"}
            </div>
          </div>

          <div className="w-full grid grid-cols-1 md:grid-cols-3 gap-6 mt-2">
            <section className="paper pinned-l">
              <span className="pin blue tr" />
              <div className="paper-heading">
                <span className="stamp">input</span>
              </div>
              <DevicePanel
                devices={devices}
                selected={prefs.device}
                onSelect={(name) => updatePrefs({ device: name })}
                onRefresh={refreshDevices}
                disabled={state === "recording" || state === "stopping"}
              />
            </section>

            <section className="paper pinned-c">
              <span className="pin tl" />
              <span className="pin ochre tr" />
              <div className="paper-heading">
                <span className="stamp">click</span>
              </div>

              <ClickPicker
                value={prefs.voice}
                onChange={(voice) => updatePrefs({ voice })}
                onAudition={(voice) => {
                  metronome.setOptions({ voice });
                  void metronome.audition();
                }}
                disabled={state === "recording" || state === "stopping"}
              />

              <div className="divider" />

              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  className={`ink-toggle ${prefs.metroOn ? "on" : ""}`}
                  disabled={isBusy}
                  onClick={() => updatePrefs({ metroOn: !prefs.metroOn })}
                  aria-pressed={prefs.metroOn}
                >
                  <span className="ink-box" />
                  metronome
                </button>
                <button
                  type="button"
                  className={`ink-toggle ${prefs.countIn ? "on" : ""}`}
                  disabled={isBusy}
                  onClick={() => updatePrefs({ countIn: !prefs.countIn })}
                  aria-pressed={prefs.countIn}
                >
                  <span className="ink-box" />
                  count-in
                </button>
              </div>

              <div className="divider" />

              <div className="flex flex-col gap-1">
                <div className="flex justify-between items-baseline">
                  <span className="scribble-label">volume</span>
                  <span className="font-mono text-[11px] text-[var(--bone-soft)]">
                    {Math.round(prefs.metroVolume * 100)}
                  </span>
                </div>
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

            <section className="paper pinned-r">
              <span className="pin br" />
              <div className="paper-heading">
                <span className="stamp">level</span>
              </div>
              <VuMeter
                peakDb={peakDb}
                rmsDb={rmsDb}
                peakHoldDb={peakHoldDb}
                clipped={clipped}
              />
            </section>
          </div>
        </main>

        <footer className="px-8 pt-8 pb-6 grid gap-3 max-w-6xl w-full mx-auto">
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div className="flex flex-col gap-2 min-w-0 flex-1">
              <span className="stamp">tape rack</span>
              <TakesShelf takes={takes} />
            </div>

            <div className="flex flex-col items-end gap-2 shrink-0">
              <span className="stamp">save to</span>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={handlePickDir}
                  className="btn"
                  title={takesDir}
                  style={{ maxWidth: 340 }}
                >
                  <span className="truncate font-mono normal-case tracking-normal">
                    {takesDir ? truncMid(takesDir, 36) : "choose folder…"}
                  </span>
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => takesDir && seshApi.revealInFolder(takesDir)}
                  disabled={!takesDir}
                  title="open folder"
                  aria-label="open folder"
                >
                  ↗
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-center gap-3 pt-2 font-mono text-[11px] text-[var(--bone-soft)]">
            <span className="kbd">space</span>
            <span>record · stop</span>
          </div>
        </footer>
      </div>

      <Splash splash={splash} />
    </div>
  );
}

function truncMid(s: string, max: number) {
  if (s.length <= max) return s;
  const half = Math.floor((max - 1) / 2);
  return s.slice(0, half) + "…" + s.slice(s.length - half);
}
