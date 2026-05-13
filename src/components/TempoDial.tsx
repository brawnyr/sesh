import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clamp } from "../lib/util";

type Props = {
  bpm: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  onChange: (bpm: number) => void;
};

export function TempoDial({
  bpm,
  min = 40,
  max = 240,
  disabled,
  onChange,
}: Props) {
  const dragRef = useRef<{
    startY: number;
    startBpm: number;
    fine: boolean;
  } | null>(null);
  const tapTimes = useRef<number[]>([]);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(bpm.toString());

  useEffect(() => {
    if (!editing) setEditValue(bpm.toString());
  }, [bpm, editing]);

  const angle = useMemo(() => {
    const t = (bpm - min) / (max - min);
    return -135 + t * 270;
  }, [bpm, min, max]);

  const tickMarks = useMemo(() => {
    return Array.from({ length: 13 }, (_, i) => -135 + i * (270 / 12));
  }, []);

  const commit = useCallback(
    (next: number) => {
      onChange(clamp(Math.round(next), min, max));
    },
    [onChange, min, max],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled || editing) return;
      (e.target as Element).setPointerCapture(e.pointerId);
      dragRef.current = {
        startY: e.clientY,
        startBpm: bpm,
        fine: e.shiftKey,
      };
    },
    [bpm, disabled, editing],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dy = drag.startY - e.clientY;
      const sensitivity = drag.fine ? 0.25 : 1;
      const next = drag.startBpm + dy * sensitivity;
      commit(next);
    },
    [commit],
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (dragRef.current) {
      (e.target as Element).releasePointerCapture?.(e.pointerId);
      dragRef.current = null;
    }
  }, []);

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      if (disabled) return;
      e.preventDefault();
      const step = e.shiftKey ? 0.5 : 1;
      const delta = e.deltaY > 0 ? -step : step;
      commit(bpm + delta);
    },
    [bpm, commit, disabled],
  );

  const tapTempo = useCallback(() => {
    const now = performance.now();
    const taps = tapTimes.current;
    const last = taps[taps.length - 1];
    if (last && now - last > 2500) taps.length = 0;
    taps.push(now);
    if (taps.length > 8) taps.shift();
    if (taps.length < 2) return;
    let total = 0;
    for (let i = 1; i < taps.length; i++) total += taps[i] - taps[i - 1];
    const avg = total / (taps.length - 1);
    if (avg > 0) commit(60000 / avg);
  }, [commit]);

  const beginEdit = () => {
    if (disabled) return;
    setEditing(true);
    setEditValue(bpm.toString());
  };

  const finishEdit = () => {
    const n = parseFloat(editValue);
    if (!isNaN(n)) commit(n);
    setEditing(false);
  };

  return (
    <div className="flex flex-col items-center gap-3 select-none">
      <div
        className="dial"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        onDoubleClick={beginEdit}
        style={
          {
            ["--dial-angle"]: `${angle}deg`,
            opacity: disabled ? 0.55 : 1,
          } as React.CSSProperties
        }
        role="slider"
        aria-label="tempo"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={bpm}
        title="drag vertical · scroll · double-click to type"
      >
        <div className="dial-tick">
          {tickMarks.map((a, i) => {
            const major = i % 3 === 0;
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  inset: 0,
                  transform: `rotate(${a}deg)`,
                  pointerEvents: "none",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    top: 4,
                    left: "50%",
                    transform: "translateX(-50%)",
                    width: major ? 2 : 1,
                    height: major ? 8 : 5,
                    background: major
                      ? "rgba(244,232,208,0.55)"
                      : "rgba(244,232,208,0.25)",
                  }}
                />
              </div>
            );
          })}
        </div>
        <div className="dial-cap" />
        <div className="dial-needle" />
      </div>

      <div className="flex items-center gap-2">
        {editing ? (
          <input
            autoFocus
            type="number"
            min={min}
            max={max}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={finishEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") finishEdit();
              if (e.key === "Escape") {
                setEditValue(bpm.toString());
                setEditing(false);
              }
            }}
            className="w-24 text-center bg-roast-950 border-2 border-roast-700 readout text-3xl font-pixel py-1"
          />
        ) : (
          <button
            type="button"
            onClick={beginEdit}
            disabled={disabled}
            className="readout text-3xl font-pixel px-2 py-0.5 hover:bg-roast-800/60 rounded transition-colors"
            title="type a BPM"
          >
            {Math.round(bpm).toString().padStart(3, "0")}
          </button>
        )}
        <span className="font-pixel text-[10px] uppercase tracking-widest text-cream-400">
          bpm
        </span>
      </div>

      <button
        type="button"
        onClick={tapTempo}
        disabled={disabled}
        className="btn"
        title="tap to set tempo"
      >
        tap
      </button>
    </div>
  );
}
