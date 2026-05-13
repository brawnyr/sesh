import type { RecState } from "../lib/state";

type Props = {
  state: RecState;
  onClick: () => void;
  barProgress: number; // 0..1 within current bar
  disabled?: boolean;
};

export function RecordOrb({ state, onClick, barProgress, disabled }: Props) {
  const armed = state === "arming";
  const recording = state === "recording";
  const stopping = state === "stopping";

  const R = 84;
  const C = 2 * Math.PI * R;
  const offset = C * (1 - barProgress);

  return (
    <div className="relative">
      <button
        type="button"
        className={`orb ${armed ? "armed" : ""} ${recording ? "recording" : ""}`}
        onClick={onClick}
        disabled={disabled || stopping}
        aria-label={
          recording
            ? "stop recording"
            : armed
              ? "cancel count-in"
              : "start recording"
        }
        title="space"
      >
        <span className="orb-ring" />
        <span className="orb-disc" />
      </button>

      <svg
        className="orb-progress"
        viewBox="-100 -100 200 200"
        width="100%"
        height="100%"
        aria-hidden
      >
        <circle
          cx={0}
          cy={0}
          r={R}
          fill="none"
          stroke="rgba(244,232,208,0.08)"
          strokeWidth={2}
        />
        {(armed || recording) && (
          <circle
            cx={0}
            cy={0}
            r={R}
            fill="none"
            stroke={armed ? "#ffb976" : "#ff7a5c"}
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={offset}
            style={{
              transition: "stroke-dashoffset 80ms linear, stroke 200ms ease",
              filter: armed
                ? "drop-shadow(0 0 6px rgba(255,154,60,0.7))"
                : "drop-shadow(0 0 8px rgba(255,77,46,0.8))",
            }}
          />
        )}
      </svg>
    </div>
  );
}
