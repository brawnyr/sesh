import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ShaderCanvas } from "./components/ShaderCanvas";
import { driftShader } from "./shaders/drift";
import {
  CLICK_VOICES,
  Metronome,
  type ClickVoice,
} from "./lib/metronome";
import {
  onMeter,
  seshApi,
  type InputDevice,
  type TakeMeta,
} from "./lib/tauri";
import { clamp, formatDuration } from "./lib/util";
import type { RecState } from "./lib/state";
import { TempoDial } from "./components/TempoDial";
import { ClickPicker } from "./components/ClickPicker";
import { DevicePanel } from "./components/DevicePanel";
import { RecordOrb } from "./components/RecordOrb";
import { BeatStrip } from "./components/BeatStrip";
import { VuMeter } from "./components/VuMeter";
import { Splash, type SplashEvent } from "./components/Splash";
import { TakesShelf } from "./components/TakesShelf";

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
  } catch {
    // ignore
  }
}

export function App() {
  const metronomeRef = useRef<Metronome | null>(null);
  if (!metronomeRef.current) metronomeRef.current = new Metronome();
  const metronome = metronomeRef.current;

  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs());
  const [state, setState] = useState<RecState>("idle");
  const [activeBeat, setActiveBeat] = useState<number | null>(null);
  const [devices, setDevices] = useState<InputDevice[]>([]);
  const [takes, setTakes] = useState<TakeMeta[]>([]);
  const [takesDir, setTakesDir] = useState<string>("");
  const [meter, setMeter] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [barProgress, setBarProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [splash, setSplash] = useState<SplashEvent | null>(null);

  const recordStartRef = useRef<number | null>(null);
  const barStartRef = useRef<number | null>(null);
  const armTimerRef = useRef<number | null>(null);
  const orbRectRef = useRef<DOMRect | null>(null);
  const orbWrapRef = useRef<HTMLDivElement | null>(null);

  // Persist prefs whenever they change
  useEffect(() => {
    savePrefs(prefs);
  }, [prefs]);

  const updatePrefs = useCallback((patch: Partial<Prefs>) => {
    setPrefs((p) => ({ ...p, ...patch }));
  }, []);

  // Push metronome options whenever they change
  useEffect(() => {
    metronome.setOptions({
      bpm: prefs.bpm,
      beatsPerBar: BEATS_PER_BAR,
      volume: prefs.metroVolume,
      voice: prefs.voice,
    });
  }, [metronome, prefs.bpm, prefs.metroVolume, prefs.voice]);

  // Subscribe to beat events for visual sync + bar reset
  useEffect(() => {
    const off = metronome.onBeat((beat, downbeat) => {
      setActiveBeat(beat);
      if (downbeat) {
        barStartRef.current = performance.now();
      }
      // brief release after a beat
      window.setTimeout(() => {
        setActiveBeat((prev) => (prev === beat ? null : prev));
      }, Math.max(80, (60_000 / prefs.bpm) * 0.3));
    });
    return off;
  }, [metronome, prefs.bpm]);

  // Subscribe to level meter events from Rust (smoothed)
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let raf = 0;
    let target = 0;
    let current = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      current = current * 0.8 + target * 0.2;
      target *= 0.92;
      setMeter(current);
    };
    raf = requestAnimationFrame(animate);
    onMeter((peak) => {
      if (peak > target) target = peak;
    }).then((u) => {
      unlisten = u;
    });
    return () => {
      cancelAnimationFrame(raf);
      unlisten?.();
    };
  }, []);

  // Elapsed timer + bar progress while running
  useEffect(() => {
    if (state === "idle") {
      setElapsed(0);
      setBarProgress(0);
      return;
    }
    let raf = 0;
    const barDurMs = (60_000 / prefs.bpm) * BEATS_PER_BAR;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      if (state === "recording" && recordStartRef.current !== null) {
        setElapsed((now - recordStartRef.current) / 1000);
      }
      const bs = barStartRef.current;
      if (bs !== null) {
        const t = ((now - bs) % barDurMs) / barDurMs;
        setBarProgress(clamp(t, 0, 1));
      } else {
        setBarProgress(0);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state, prefs.bpm]);

  // Initial load
  useEffect(() => {
    void refreshDevices();
    void refreshSettings();
    void refreshTakes();
  }, []);

  async function refreshDevices() {
    try {
      const list = await seshApi.listInputDevices();
      setDevices(list);
      if (!prefs.device || !list.find((d) => d.name === prefs.device)) {
        const def = list.find((d) => d.is_default) ?? list[0];
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

  const cancelArming = useCallback(() => {
    if (armTimerRef.current !== null) {
      clearTimeout(armTimerRef.current);
      armTimerRef.current = null;
    }
    metronome.stop();
    setState("idle");
    setActiveBeat(null);
    barStartRef.current = null;
  }, [metronome]);

  const triggerSplash = useCallback(() => {
    const rect = orbRectRef.current ?? orbWrapRef.current?.getBoundingClientRect();
    const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const y = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
    setSplash({ id: Date.now() + Math.random(), x, y });
  }, []);

  const toggleRecord = useCallback(async () => {
    setError(null);
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
        setError(String(e));
      }
      if (prefs.metroOn) metronome.stop();
      recordStartRef.current = null;
      barStartRef.current = null;
      setActiveBeat(null);
      triggerSplash();
      setState("idle");
      void refreshTakes();
      return;
    }

    // idle → arming/recording
    try {
      if (prefs.metroOn) await metronome.start();

      const beginCapture = async () => {
        await seshApi.startRecording(prefs.device);
        recordStartRef.current = performance.now();
        if (!barStartRef.current) barStartRef.current = performance.now();
        setState("recording");
      };

      if (prefs.metroOn && prefs.countIn) {
        setState("arming");
        const barMs = (60_000 / prefs.bpm) * BEATS_PER_BAR;
        const cached = orbWrapRef.current?.getBoundingClientRect();
        if (cached) orbRectRef.current = cached;
        armTimerRef.current = window.setTimeout(async () => {
          armTimerRef.current = null;
          try {
            await beginCapture();
          } catch (e) {
            setError(String(e));
            metronome.stop();
            setState("idle");
          }
        }, barMs);
      } else {
        await beginCapture();
      }
    } catch (e) {
      setError(String(e));
      metronome.stop();
      setState("idle");
    }
  }, [state, prefs, metronome, cancelArming, triggerSplash]);

  // Spacebar = toggle record
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
      case "idle":
        return "ready";
      case "arming":
        return "count-in";
      case "recording":
        return "recording";
      case "stopping":
        return "saving…";
    }
  }, [state]);

  const isBusy = state !== "idle";

  return (
    <div className="h-screen w-screen relative overflow-hidden">
      <ShaderCanvas source={driftShader} active />
      <div className="field-veil" />

      {error && (
        <div className="banner absolute top-3 left-1/2 -translate-x-1/2 z-50 px-3 py-1.5 font-mono text-sm rounded">
          {error}
        </div>
      )}

      <div className="relative z-10 h-full flex flex-col">
        {/* TOP BAR */}
        <header className="px-6 py-3 flex items-center gap-4">
          <div className="flex items-center gap-2 font-display text-xl text-cream-50">
            <span
              className={`inline-block w-2.5 h-2.5 rounded-full transition-colors ${
                state === "recording"
                  ? "bg-rec-500 shadow-rec-glow"
                  : state === "arming"
                    ? "bg-crema-400 shadow-crema-glow"
                    : "bg-crema-400"
              }`}
            />
            sesh
          </div>
          <div
            className={`font-pixel text-xs uppercase tracking-[0.25em] px-2 py-0.5 rounded transition-colors ${
              state === "recording"
                ? "text-rec-400 bg-rec-600/15"
                : state === "arming"
                  ? "text-crema-400 bg-crema-500/15"
                  : "text-cream-400"
            }`}
          >
            {stateLabel}
          </div>
          <div
            className={`ml-2 readout text-2xl font-pixel ${state === "recording" ? "rec" : "dim"}`}
          >
            {formatDuration(elapsed)}
          </div>
          <div className="ml-auto flex items-center gap-2 font-mono text-xs text-cream-400">
            <span className="kbd">space</span>
            <span>record</span>
            <span className="opacity-40">·</span>
            <span className="kbd">tab</span>
            <span>dial</span>
          </div>
        </header>

        {/* MAIN STAGE */}
        <main className="flex-1 grid place-items-center px-6 pb-4">
          <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-6 items-start">
            {/* LEFT: tempo dial */}
            <section className="panel p-5 flex flex-col items-center gap-6">
              <TempoDial
                bpm={prefs.bpm}
                onChange={(bpm) => updatePrefs({ bpm })}
                disabled={isBusy}
              />
            </section>

            {/* CENTER: orb + beat strip */}
            <section className="flex flex-col items-center gap-5">
              <BeatStrip beatsPerBar={BEATS_PER_BAR} activeBeat={activeBeat} />
              <div ref={orbWrapRef}>
                <RecordOrb
                  state={state}
                  onClick={toggleRecord}
                  barProgress={barProgress}
                />
              </div>
              <div className="font-pixel text-[11px] uppercase tracking-[0.25em] text-cream-400">
                {state === "recording"
                  ? "rolling"
                  : state === "arming"
                    ? "ready in…"
                    : state === "stopping"
                      ? "writing wav"
                      : "press to record"}
              </div>
            </section>

            {/* RIGHT: click voice + count-in + volume + device */}
            <section className="panel p-5 flex flex-col gap-5">
              <ClickPicker
                value={prefs.voice}
                onChange={(voice) => updatePrefs({ voice })}
                onAudition={(voice) => {
                  metronome.setOptions({ voice });
                  void metronome.audition();
                }}
                disabled={state === "recording" || state === "stopping"}
              />

              <div className="flex flex-col gap-2">
                <div className="font-pixel text-[10px] uppercase tracking-widest text-cream-400">
                  options
                </div>
                <div className="flex gap-1 flex-wrap">
                  <button
                    type="button"
                    onClick={() => updatePrefs({ metroOn: !prefs.metroOn })}
                    disabled={isBusy}
                    className={`btn ${prefs.metroOn ? "active" : ""}`}
                  >
                    metro {prefs.metroOn ? "on" : "off"}
                  </button>
                  <button
                    type="button"
                    onClick={() => updatePrefs({ countIn: !prefs.countIn })}
                    disabled={isBusy}
                    className={`btn ${prefs.countIn ? "active" : ""}`}
                  >
                    count-in {prefs.countIn ? "on" : "off"}
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <div className="font-pixel text-[10px] uppercase tracking-widest text-cream-400 flex justify-between">
                  <span>click volume</span>
                  <span className="font-mono">
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
                  className="accent-crema-500"
                />
              </div>

              <DevicePanel
                devices={devices}
                selected={prefs.device}
                onSelect={(name) => updatePrefs({ device: name })}
                onRefresh={refreshDevices}
                disabled={state === "recording" || state === "stopping"}
              />

              <div className="flex flex-col gap-2">
                <div className="font-pixel text-[10px] uppercase tracking-widest text-cream-400">
                  level
                </div>
                <VuMeter level={meter} />
              </div>
            </section>
          </div>
        </main>

        {/* BOTTOM: takes shelf */}
        <footer className="px-6 pb-5 pt-1 grid gap-3">
          <div className="flex items-end justify-between gap-3">
            <div className="flex flex-col gap-2 min-w-0 flex-1">
              <div className="font-pixel text-[10px] uppercase tracking-widest text-cream-400">
                recent takes
              </div>
              <TakesShelf takes={takes} />
            </div>
            <div className="flex flex-col items-end gap-2 shrink-0">
              <div className="font-pixel text-[10px] uppercase tracking-widest text-cream-400">
                save to
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={handlePickDir}
                  className="btn"
                  title={takesDir}
                  style={{ maxWidth: 320 }}
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
