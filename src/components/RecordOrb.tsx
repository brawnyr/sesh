import type { RecState } from "../lib/state";

type Props = {
  state: RecState;
  onClick: () => void;
  disabled?: boolean;
};

export function RecordOrb({ state, onClick, disabled }: Props) {
  const armed = state === "arming";
  const recording = state === "recording";
  const stopping = state === "stopping";

  return (
    <button
      type="button"
      className={`blob ${state}`}
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
      <span className="blob-body">
        <span className="blob-glyph">{recording ? "stop" : "rec"}</span>
      </span>
    </button>
  );
}
