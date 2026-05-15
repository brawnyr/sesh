import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ShaderCanvas } from "./components/ShaderCanvas";
import { brewShader } from "./shaders/brew";
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
import { ClickPicker } from "./components/ClickPicker";
import { DevicePanel } from "./components/DevicePanel";
import { BeatStrip } from "./components/BeatStrip";
import { VuMeter } from "./components/VuMeter";
import { Splash, type SplashEvent } from "./components/Splash";
import { TakesShelf } from "./components/TakesShelf";
import { RecordOrb } from "./components/RecordOrb";

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
  const [peakDb, setPeakDb] = useState(-90);
  const [rmsDb, setRmsDb] = useState(-90);
  const [peakHoldDb, setPeakHoldDb] = useState(-90);
  const [clipped, setClipped] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [barProgress, setBarProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [splash, setSplash] = useState<SplashEvent | null>(null);

  const recordStartRef = useRef<number | null>(null);
  const barStartRef = useRef<number | null>(null);
  const armTimerRef = useRef<number | null>(null);
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
    const DB_FLOOR = -90;
    const HOLD_MS = 1500;
    const HOLD_DECAY_DB_PER_S = 12;
    const RELEASE_DB_PER_S = 26;
    const CLIP_HIDE_MS = 700;

    let unlisten: (() => void) | null = null;
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
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      if (state === "recording" && recordStartRef.current !== null) {
        setElapsed((now - recordStartRef.current) / 1000);
      }
      if (barStartRef.current !== null) {
        const barMs = (60_000 / prefs.bpm) * BEATS_PER_BAR;
        const dt = (now - barStartRef.current) % barMs;
        setBarProgress(dt / barMs);
      } else {
        setBarProgress(0);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state, prefs.bpm]);

  useEffect(() => {
    void refreshDevices();
    void refreshSettings();
    void refreshTakes();
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

    try {
      if (prefs.metroOn) await metronome.start();

      const beginCapture = async () => {
        await seshApi.startRecording();
        recordStartRef.current = performance.now();
        if (!barStartRef.current) barStartRef.current = performance.now();
        setState("recording");
      };

      if (prefs.metroOn && prefs.countIn) {
        setState("arming");
        const barMs = (60_000 / prefs.bpm) * BEATS_PER_BAR;
        const cached = recordBtnRef.current?.getBoundingClientRect();
        if (cached) recordRectRef.current = cached;
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
  const reelsSpin = state === "recording" || state === "arming";

  return (
    <div className="h-screen w-screen relative overflow-hidden">
      <ShaderCanvas source={brewShader} active />
      <div className="field-veil" />

      {error && (
        <div className="banner absolute top-3 left-1/2 -translate-x-1/2 z-50 px-3 py-1.5 text-sm">
          {error}
        </div>
      )}

      <div className="relative z-10 h-full flex flex-col overflow-y-auto scrollbar-thin">
        {/* ─── NAMEPLATE HEADER ─── */}
        <header className="px-6 pt-5 pb-3 flex items-center justify-center gap-4">
          <div className="nameplate">
            <span className={`nameplate-led ${state}`} />
            <span className="nameplate-text">sesh</span>
            <span className="nameplate-sub">session recorder</span>
          </div>
          <span
            className={`status-pill ${
              state === "recording"
                ? "recording"
                : state === "arming"
                  ? "arming"
                  : ""
            }`}
          >
            <span>{stateLabel}</span>
          </span>
        </header>

        {/* ─── HERO: TAPE WINDOW + RECORD ORB ─── */}
        <main className="px-6 flex-1 flex flex-col items-center gap-6">
          <div className="w-full max-w-3xl">
            <TapeWindow
              elapsed={elapsed}
              state={state}
              bpm={prefs.bpm}
              activeBeat={activeBeat}
              reelsSpin={reelsSpin}
              editingBpm={editingBpm}
              bpmInput={bpmInput}
              setEditingBpm={setEditingBpm}
              setBpmInput={setBpmInput}
              commitBpm={commitBpm}
              tapTempo={tapTempo}
              isBusy={isBusy}
            />
          </div>

          <div ref={recordBtnRef} className="flex flex-col items-center gap-2">
            <RecordOrb
              state={state}
              onClick={toggleRecord}
              barProgress={barProgress}
              disabled={state === "stopping"}
            />
            <div className="font-pixel text-[11px] uppercase tracking-[0.3em] text-cream-300 mt-1">
              {state === "recording"
                ? "■ press to stop"
                : state === "arming"
                  ? "× cancel count-in"
                  : state === "stopping"
                    ? "writing wav…"
                    : "● press to record"}
            </div>
          </div>

          {/* ─── MODULE RACK ─── */}
          <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-3 gap-4 mt-2">
            {/* INPUT */}
            <section className="module">
              <Screws />
              <span className="module-tab">input</span>
              <DevicePanel
                devices={devices}
                selected={prefs.device}
                onSelect={(name) => updatePrefs({ device: name })}
                onRefresh={refreshDevices}
                disabled={state === "recording" || state === "stopping"}
              />
            </section>

            {/* CLICK */}
            <section className="module flex flex-col gap-3">
              <Screws />
              <span className="module-tab">click</span>

              <ClickPicker
                value={prefs.voice}
                onChange={(voice) => updatePrefs({ voice })}
                onAudition={(voice) => {
                  metronome.setOptions({ voice });
                  void metronome.audition();
                }}
                disabled={state === "recording" || state === "stopping"}
              />

              <div className="module-divider" />

              <div className="flex flex-wrap gap-2">
                <Switch
                  on={prefs.metroOn}
                  disabled={isBusy}
                  label={`metro ${prefs.metroOn ? "on" : "off"}`}
                  onToggle={() => updatePrefs({ metroOn: !prefs.metroOn })}
                />
                <Switch
                  on={prefs.countIn}
                  disabled={isBusy}
                  label={`count-in ${prefs.countIn ? "on" : "off"}`}
                  onToggle={() => updatePrefs({ countIn: !prefs.countIn })}
                />
              </div>

              <div className="module-divider" />

              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between font-pixel text-[11px] uppercase tracking-[0.28em] text-cream-300">
                  <span>volume</span>
                  <span className="font-mono tracking-normal text-cream-400">
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

            {/* LEVEL */}
            <section className="module flex flex-col gap-3">
              <Screws />
              <span className="module-tab">level</span>
              <VuMeter
                peakDb={peakDb}
                rmsDb={rmsDb}
                peakHoldDb={peakHoldDb}
                clipped={clipped}
              />
            </section>
          </div>
        </main>

        {/* ─── TAPE RACK FOOTER ─── */}
        <footer className="px-6 pt-6 pb-5 grid gap-3">
          <div className="max-w-5xl mx-auto w-full flex items-end justify-between gap-4">
            <div className="flex flex-col gap-2 min-w-0 flex-1">
              <span className="font-pixel text-[11px] uppercase tracking-[0.32em] text-cream-300">
                tape rack
              </span>
              <TakesShelf takes={takes} />
            </div>

            <div className="flex flex-col items-end gap-2 shrink-0">
              <span className="font-pixel text-[11px] uppercase tracking-[0.32em] text-cream-300">
                save to
              </span>
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

          <div className="max-w-5xl mx-auto w-full flex items-center justify-center gap-3 pt-1 font-mono text-[11px] text-cream-400/70">
            <span className="kbd">space</span>
            <span>record · stop</span>
            <span className="opacity-40">·</span>
            <span className="kbd">click bpm</span>
            <span>edit tempo</span>
          </div>
        </footer>
      </div>

      <Splash splash={splash} />
    </div>
  );
}

/* ─────────── tape window subcomponent ─────────── */

type TapeWindowProps = {
  elapsed: number;
  state: RecState;
  bpm: number;
  activeBeat: number | null;
  reelsSpin: boolean;
  editingBpm: boolean;
  bpmInput: string;
  setEditingBpm: (v: boolean) => void;
  setBpmInput: (v: string) => void;
  commitBpm: (n: number) => void;
  tapTempo: () => void;
  isBusy: boolean;
};

function TapeWindow({
  elapsed,
  state,
  bpm,
  activeBeat,
  reelsSpin,
  editingBpm,
  bpmInput,
  setEditingBpm,
  setBpmInput,
  commitBpm,
  tapTempo,
  isBusy,
}: TapeWindowProps) {
  const tcRec = state === "recording";
  const tcDim = state === "idle";

  return (
    <div className="tape-window relative">
      {/* top row: reel · timecode · reel */}
      <div className="relative z-10 flex items-center justify-between gap-4">
        <Reel spin={reelsSpin} fast={state === "recording"} />

        <div className="flex flex-col items-center gap-1.5">
          <span className="tape-label">timecode</span>
          <div className="lcd-stack">
            <span className="lcd-ghost lcd huge">88:88</span>
            <span
              className={`lcd huge ${tcRec ? "rec" : tcDim ? "dim" : ""}`}
            >
              {formatDuration(elapsed)}
            </span>
          </div>
        </div>

        <Reel spin={reelsSpin} fast={state === "recording"} />
      </div>

      {/* mid row: beat LEDs */}
      <div className="relative z-10 flex items-center justify-center gap-2 mt-4">
        <span className="tape-label mr-2">bar</span>
        <BeatStrip beatsPerBar={BEATS_PER_BAR} activeBeat={activeBeat} />
      </div>

      <div className="relative z-10 module-divider my-4 opacity-60" />

      {/* bottom row: tempo controls */}
      <div className="relative z-10 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-baseline gap-2">
          <span className="tape-label">tempo</span>
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
              className="w-28 text-center bg-roast-950 border border-roast-700 lcd big py-0.5 rounded"
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setBpmInput(String(Math.round(bpm)));
                setEditingBpm(true);
              }}
              disabled={isBusy}
              className="lcd big px-2 py-0.5 rounded hover:bg-black/20 transition-colors"
              title="click to type a BPM"
            >
              {Math.round(bpm).toString().padStart(3, "0")}
            </button>
          )}
          <span className="tape-label">bpm</span>
        </div>

        <div className="flex gap-1">
          <button
            type="button"
            className="btn sm"
            disabled={isBusy}
            onClick={() => commitBpm(bpm - 1)}
            aria-label="decrease bpm"
          >
            −
          </button>
          <button
            type="button"
            className="btn sm"
            disabled={isBusy}
            onClick={() => commitBpm(bpm + 1)}
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
    </div>
  );
}

/* ─────────── reel ─────────── */

function Reel({ spin, fast }: { spin: boolean; fast?: boolean }) {
  return (
    <div className={`reel ${spin ? "spin" : ""} ${spin && fast ? "fast" : ""}`}>
      <div className="reel-spokes">
        <span />
        <span />
        <span />
      </div>
      <div className="reel-hub" />
    </div>
  );
}

/* ─────────── physical switch ─────────── */

function Switch({
  on,
  disabled,
  label,
  onToggle,
}: {
  on: boolean;
  disabled?: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`switch ${on ? "on" : ""}`}
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={on}
    >
      <span className="switch-track">
        <span className="switch-thumb" />
      </span>
      <span>{label}</span>
    </button>
  );
}

/* ─────────── module corner screws ─────────── */

function Screws() {
  return (
    <>
      <span className="screw tl" />
      <span className="screw tr" />
      <span className="screw bl" />
      <span className="screw br" />
    </>
  );
}

function truncMid(s: string, max: number) {
  if (s.length <= max) return s;
  const half = Math.floor((max - 1) / 2);
  return s.slice(0, half) + "…" + s.slice(s.length - half);
}
