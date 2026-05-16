import type { RecState } from "../lib/state";

type Props = {
  state: RecState;
  onClick: () => void;
  disabled?: boolean;
};

export function RecordOrb({ state, onClick, disabled }: Props) {
  const recording = state === "recording";
  const armed = state === "arming";
  const stopping = state === "stopping";

  const label = recording
    ? "stop"
    : armed
      ? "cancel"
      : stopping
        ? "saving"
        : "record";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || stopping}
      aria-label={label}
      title="space"
      className={recording || armed ? "active" : ""}
      style={{
        padding: "10px 24px",
        fontWeight: 700,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
      }}
    >
      {label}
    </button>
  );
}
