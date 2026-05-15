import { CLICK_VOICES, type ClickVoice } from "../lib/metronome";

type Props = {
  value: ClickVoice;
  onChange: (voice: ClickVoice) => void;
  onAudition: (voice: ClickVoice) => void;
  disabled?: boolean;
};

const LABELS: Record<ClickVoice, string> = {
  tick: "tick",
  wood: "wood",
  rim: "rim",
  cowbell: "bell",
  beep: "beep",
};

export function ClickPicker({ value, onChange, onAudition, disabled }: Props) {
  return (
    <div className="flex flex-wrap gap-1">
      {CLICK_VOICES.map((v) => {
        const isActive = value === v;
        return (
          <button
            key={v}
            type="button"
            disabled={disabled}
            onClick={() => {
              onChange(v);
              onAudition(v);
            }}
            className={`btn sm ${isActive ? "active" : ""}`}
            style={{ minWidth: "3.2rem" }}
            title={`use the ${LABELS[v]} click`}
          >
            {LABELS[v]}
          </button>
        );
      })}
    </div>
  );
}
