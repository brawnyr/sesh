import { useCallback, useEffect, useRef, useState } from "react";
import {
  CLICK_VOICES,
  Metronome,
  type ClickVoice,
} from "./lib/metronome";
import {
  onWriteError,
  seshApi,
  type InputDevice,
} from "./lib/tauri";
import { clamp } from "./lib/util";
import { useRecorder } from "./hooks/useRecorder";

const PREFS_KEY = "sesh:prefs:v1";
const BEATS_PER_BAR = 4;
const COUNT_IN_BARS = 2;

type Prefs = {
  bpm: number;
  metroVolume: number;
  voice: ClickVoice;
  device: string | null;
};

const DEFAULT_PREFS: Prefs = {
  bpm: 100,
  metroVolume: 0.55,
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

type Scene = "hello" | "tempo" | "click" | "input" | "ready";

const SCENES: Scene[] = ["hello", "tempo", "click", "input", "ready"];

function formatElapsed(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function App() {
  const metronomeRef = useRef<Metronome | null>(null);
  if (!metronomeRef.current) metronomeRef.current = new Metronome();
  const metronome = metronomeRef.current;

  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs());
  const [scene, setScene] = useState<Scene>("hello");
  const [devices, setDevices] = useState<InputDevice[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Count-in tracking: how many beats since arming started
  const [armBeatCount, setArmBeatCount] = useState(0);
  const [activeBeat, setActiveBeat] = useState<number | null>(null);

  const tapTimesRef = useRef<number[]>([]);

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
    const off = metronome.onBeat((beat) => {
      setActiveBeat(beat);
      setArmBeatCount((c) => c + 1);
      window.setTimeout(() => {
        setActiveBeat((prev) => (prev === beat ? null : prev));
      }, Math.max(80, (60_000 / prefs.bpm) * 0.3));
    });
    return off;
  }, [metronome, prefs.bpm]);

  useEffect(() => {
    void refreshDevices();
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
        const def = scarlett ?? list.find((d) => d.is_default) ?? list[0];
        if (def) updatePrefs({ device: def.name });
      }
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
    metroOn: true,
    countIn: true,
    onError: setError,
    onStopped: useCallback(() => {
      setActiveBeat(null);
      setArmBeatCount(0);
      setScene("hello");
    }, []),
    onArmStart: useCallback(() => {
      setArmBeatCount(0);
    }, []),
    onArmExit: useCallback(() => {
      setActiveBeat(null);
      setArmBeatCount(0);
    }, []),
  });

  const goNext = useCallback(() => {
    setScene((s) => {
      const i = SCENES.indexOf(s);
      return i < SCENES.length - 1 ? SCENES[i + 1] : s;
    });
  }, []);

  const goBack = useCallback(() => {
    setScene((s) => {
      const i = SCENES.indexOf(s);
      return i > 0 ? SCENES[i - 1] : s;
    });
  }, []);

  const isRecording = state === "recording" || state === "stopping";
  const isCountIn = state === "arming";

  // Global keyboard handler
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inInput = target && /input|textarea|select/i.test(target.tagName);

      if (e.code === "Enter" && !e.repeat) {
        if (inInput) return; // tempo input handles Enter itself
        e.preventDefault();
        if (isRecording) {
          void toggleRecord();
          return;
        }
        if (isCountIn) {
          void toggleRecord();
          return;
        }
        if (scene === "ready") {
          void toggleRecord();
        } else {
          goNext();
        }
        return;
      }

      if (e.code === "Escape" && !e.repeat) {
        if (inInput) return;
        e.preventDefault();
        if (isCountIn) {
          void toggleRecord();
          return;
        }
        if (!isRecording) goBack();
        return;
      }

      if (scene === "click" && !isRecording && !isCountIn) {
        if (inInput) return;
        if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
          e.preventDefault();
          const dir = e.code === "ArrowRight" ? 1 : -1;
          const i = CLICK_VOICES.indexOf(prefs.voice);
          const next = CLICK_VOICES[(i + dir + CLICK_VOICES.length) % CLICK_VOICES.length];
          updatePrefs({ voice: next });
          metronome.setOptions({ voice: next });
          return;
        }
        if (e.code === "ArrowUp" || e.code === "ArrowDown") {
          e.preventDefault();
          const step = 0.05;
          const dir = e.code === "ArrowUp" ? 1 : -1;
          updatePrefs({ metroVolume: clamp(prefs.metroVolume + dir * step, 0, 1) });
          return;
        }
        if (e.code === "KeyE" && !e.repeat) {
          e.preventDefault();
          metronome.setOptions({ voice: prefs.voice });
          void metronome.audition();
          return;
        }
      }

      if (scene === "input" && !isRecording && !isCountIn) {
        if (inInput) return;
        if (e.code === "ArrowUp" || e.code === "ArrowDown") {
          e.preventDefault();
          if (devices.length === 0) return;
          const i = devices.findIndex((d) => d.name === prefs.device);
          const dir = e.code === "ArrowDown" ? 1 : -1;
          const next = devices[(i + dir + devices.length) % devices.length];
          if (next) updatePrefs({ device: next.name });
          return;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scene, isRecording, isCountIn, toggleRecord, goNext, goBack, prefs.voice, prefs.metroVolume, prefs.device, devices, updatePrefs, metronome]);

  // Derived view
  let view: "hello" | "tempo" | "click" | "input" | "ready" | "countin" | "recording";
  if (isRecording) view = "recording";
  else if (isCountIn) view = "countin";
  else view = scene;

  return (
    <div
      style={{
        height: "100vh",
        width: "100vw",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {error && (
        <div
          role="button"
          tabIndex={0}
          onClick={() => setError(null)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") setError(null);
          }}
          title="click to dismiss"
          style={{
            position: "absolute",
            top: 8,
            left: "50%",
            transform: "translateX(-50%)",
            border: "1px solid #000",
            padding: "4px 8px",
            cursor: "pointer",
            background: "#fff",
            zIndex: 50,
          }}
        >
          ! {error}
        </div>
      )}

      <div
        style={{
          position: "absolute",
          top: 12,
          left: 16,
          fontFamily: '"Press Start 2P", "JetBrains Mono", monospace',
          fontSize: 12,
        }}
      >
        sesh
      </div>

      <main
        key={view}
        className="scene"
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: 32,
          gap: 32,
        }}
      >
        {view === "hello" && <HelloScene />}
        {view === "tempo" && (
          <TempoScene
            bpm={prefs.bpm}
            onChange={commitBpm}
            onTap={tapTempo}
            onNext={goNext}
          />
        )}
        {view === "click" && (
          <ClickScene
            voice={prefs.voice}
            volume={prefs.metroVolume}
            onVoice={(v) => {
              updatePrefs({ voice: v });
              metronome.setOptions({ voice: v });
              void metronome.audition();
            }}
            onVolume={(v) => updatePrefs({ metroVolume: v })}
          />
        )}
        {view === "input" && (
          <InputScene
            devices={devices}
            selected={prefs.device}
            onSelect={(name) => updatePrefs({ device: name })}
            onRefresh={refreshDevices}
          />
        )}
        {view === "ready" && (
          <ReadyScene
            bpm={prefs.bpm}
            voice={prefs.voice}
            device={prefs.device}
          />
        )}
        {view === "countin" && (
          <CountInScene
            activeBeat={activeBeat}
            armBeatCount={armBeatCount}
          />
        )}
        {view === "recording" && (
          <RecordingScene
            elapsed={elapsed}
            activeBeat={activeBeat}
            stopping={state === "stopping"}
            onStop={toggleRecord}
          />
        )}
      </main>

      <footer
        style={{
          padding: "10px 16px",
          fontSize: 11,
          color: "#000",
          display: "flex",
          justifyContent: "center",
          gap: 16,
          borderTop: "1px solid #000",
        }}
      >
        {view === "recording" ? (
          <span>enter = stop</span>
        ) : view === "countin" ? (
          <span>enter / esc = cancel</span>
        ) : view === "hello" ? (
          <span>enter = begin</span>
        ) : view === "ready" ? (
          <span>enter = start · esc = back</span>
        ) : view === "click" ? (
          <span>← → voice · ↑ ↓ volume · e = preview · enter = next · esc = back</span>
        ) : view === "input" ? (
          <span>↑ ↓ select · enter = next · esc = back</span>
        ) : (
          <span>enter = next · esc = back</span>
        )}
      </footer>
    </div>
  );
}

function HelloScene() {
  return (
    <>
      <h1
        className="pixel flash-in"
        style={{ fontSize: 56, margin: 0, fontWeight: 400 }}
      >
        hello
      </h1>
      <p className="pixel" style={{ fontSize: 12, margin: 0 }}>
        press <span className="blink-cursor">enter</span> to begin
      </p>
    </>
  );
}

function TempoScene({
  bpm,
  onChange,
  onTap,
  onNext,
}: {
  bpm: number;
  onChange: (n: number) => void;
  onTap: () => void;
  onNext: () => void;
}) {
  const [text, setText] = useState(String(Math.round(bpm)));
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setText(String(Math.round(bpm)));
  }, [bpm]);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const commit = () => {
    const n = parseFloat(text);
    if (!isNaN(n)) onChange(n);
  };

  return (
    <>
      <h1 className="pixel" style={{ fontSize: 22, margin: 0, fontWeight: 400, textAlign: "center" }}>
        what tempo?
      </h1>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <input
          ref={inputRef}
          type="number"
          min={40}
          max={240}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commit();
              onNext();
            }
          }}
          className="pixel"
          style={{
            fontSize: 48,
            width: 180,
            textAlign: "center",
            padding: "8px 12px",
            border: "2px solid #000",
            background: "#fff",
            fontFamily: '"Press Start 2P", "JetBrains Mono", monospace',
          }}
        />
        <span className="pixel" style={{ fontSize: 14 }}>bpm</span>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={() => onChange(bpm - 1)}
          style={{ padding: "6px 14px", fontSize: 16, minWidth: 40 }}
          aria-label="decrease"
        >−</button>
        <button
          type="button"
          onClick={() => onChange(bpm + 1)}
          style={{ padding: "6px 14px", fontSize: 16, minWidth: 40 }}
          aria-label="increase"
        >+</button>
        <button
          type="button"
          onClick={onTap}
          style={{ padding: "6px 16px", fontSize: 14 }}
          className="pixel"
        >tap</button>
      </div>
    </>
  );
}

function ClickScene({
  voice,
  volume,
  onVoice,
  onVolume,
}: {
  voice: ClickVoice;
  volume: number;
  onVoice: (v: ClickVoice) => void;
  onVolume: (v: number) => void;
}) {
  return (
    <>
      <h1 className="pixel" style={{ fontSize: 18, margin: 0, fontWeight: 400, textAlign: "center", lineHeight: 1.6 }}>
        how should the<br />metronome sound?
      </h1>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
        {CLICK_VOICES.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onVoice(v)}
            className={`pixel ${voice === v ? "active" : ""}`}
            style={{ padding: "10px 18px", fontSize: 12, minWidth: 90 }}
          >
            {v}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, width: 360 }}>
        <div className="pixel" style={{ fontSize: 11 }}>
          volume {Math.round(volume * 100)}
        </div>
        <VolumeBar value={volume} onChange={onVolume} />
        <div className="pixel" style={{ fontSize: 9, opacity: 0.6 }}>
          ← → voice · ↑ ↓ volume · e to preview
        </div>
      </div>
    </>
  );
}

function VolumeBar({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  const setFromClientX = (clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const v = clamp((clientX - rect.left) / rect.width, 0, 1);
    onChange(v);
  };

  return (
    <div
      ref={ref}
      role="slider"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      tabIndex={-1}
      onMouseDown={(e) => {
        e.preventDefault();
        setFromClientX(e.clientX);
        const move = (me: MouseEvent) => setFromClientX(me.clientX);
        const up = () => {
          window.removeEventListener("mousemove", move);
          window.removeEventListener("mouseup", up);
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
      }}
      style={{
        position: "relative",
        width: "100%",
        height: 36,
        border: "2px solid #000",
        background: "#fff",
        cursor: "pointer",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: `${Math.round(value * 100)}%`,
          background: "#000",
          transition: "width 60ms steps(8, end)",
        }}
      />
    </div>
  );
}

function InputScene({
  devices,
  selected,
  onSelect,
  onRefresh,
}: {
  devices: InputDevice[];
  selected: string | null;
  onSelect: (name: string) => void;
  onRefresh: () => void;
}) {
  return (
    <>
      <h1 className="pixel" style={{ fontSize: 18, margin: 0, fontWeight: 400, textAlign: "center", lineHeight: 1.6 }}>
        what's picking up<br />the session?
      </h1>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 0,
          border: "1px solid #000",
          maxWidth: 500,
          width: "100%",
          maxHeight: 240,
          overflowY: "auto",
        }}
      >
        {devices.length === 0 && (
          <div style={{ padding: 16, fontSize: 12, textAlign: "center" }}>
            no inputs detected
          </div>
        )}
        {devices.map((d, i) => {
          const isSelected = d.name === selected;
          return (
            <button
              key={d.name}
              type="button"
              onClick={() => onSelect(d.name)}
              className={isSelected ? "active" : ""}
              style={{
                border: "none",
                borderBottom: i < devices.length - 1 ? "1px solid #000" : "none",
                padding: "8px 12px",
                textAlign: "left",
                fontSize: 12,
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {isSelected ? "> " : "  "}
                {d.is_default ? "* " : ""}
                {d.name}
              </span>
              <span style={{ flexShrink: 0, fontSize: 10, opacity: 0.7 }}>
                {d.channels || "?"}ch {d.sample_rate ? `${(d.sample_rate / 1000).toFixed(1)}k` : "?"}
              </span>
            </button>
          );
        })}
      </div>
      <button type="button" onClick={onRefresh} style={{ padding: "6px 16px", fontSize: 12 }}>
        rescan
      </button>
    </>
  );
}

function ReadyScene({
  bpm,
  voice,
  device,
}: {
  bpm: number;
  voice: ClickVoice;
  device: string | null;
}) {
  return (
    <>
      <h1 className="pixel flash-in" style={{ fontSize: 40, margin: 0, fontWeight: 400 }}>
        ready?
      </h1>
      <div className="pixel" style={{ fontSize: 11, lineHeight: 2, textAlign: "center", opacity: 0.75 }}>
        <div>{Math.round(bpm)} bpm · {voice}</div>
        <div style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          in: {device ?? "none"}
        </div>
      </div>
      <p className="pixel" style={{ fontSize: 12, margin: 0 }}>
        press <span className="blink-cursor">enter</span> when ready
      </p>
    </>
  );
}

function CountInScene({
  activeBeat,
  armBeatCount,
}: {
  activeBeat: number | null;
  armBeatCount: number;
}) {
  const bar = Math.min(COUNT_IN_BARS, Math.floor(Math.max(0, armBeatCount - 1) / BEATS_PER_BAR) + 1);
  const beatNum = activeBeat !== null ? activeBeat + 1 : null;

  return (
    <>
      <div className="pixel" style={{ fontSize: 12, opacity: 0.55, letterSpacing: "0.15em" }}>
        bar {bar} of {COUNT_IN_BARS}
      </div>
      <div
        key={`${bar}-${beatNum ?? "x"}`}
        className="calm-fade pixel"
        style={{ fontSize: 100, fontWeight: 400, lineHeight: 1, opacity: beatNum === null ? 0.25 : 1 }}
      >
        {beatNum ?? "·"}
      </div>
      <div style={{ display: "flex", gap: 14 }}>
        {Array.from({ length: BEATS_PER_BAR }, (_, i) => (
          <span
            key={i}
            style={{
              display: "inline-block",
              width: 18,
              height: 18,
              border: "1px solid #000",
              background: activeBeat === i ? "#000" : "#fff",
              transition: "background 220ms ease-out",
            }}
          />
        ))}
      </div>
    </>
  );
}

function RecordingScene({
  elapsed,
  activeBeat,
  stopping,
  onStop,
}: {
  elapsed: number;
  activeBeat: number | null;
  stopping: boolean;
  onStop: () => void;
}) {
  return (
    <>
      <div className="pixel" style={{ fontSize: 14, color: "#cc2222" }}>
        ● rec
      </div>
      <div className="pixel" style={{ fontSize: 88, fontWeight: 400, lineHeight: 1 }}>
        {formatElapsed(elapsed)}
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        {Array.from({ length: BEATS_PER_BAR }, (_, i) => (
          <span
            key={i}
            style={{
              display: "inline-block",
              width: 20,
              height: 20,
              border: "2px solid #000",
              background: activeBeat === i ? "#000" : "#fff",
            }}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={onStop}
        disabled={stopping}
        className="pixel"
        style={{
          padding: "14px 36px",
          fontSize: 18,
          background: "#000",
          color: "#fff",
          border: "2px solid #000",
          letterSpacing: "0.1em",
        }}
      >
        {stopping ? "saving" : "stop"}
      </button>
    </>
  );
}
