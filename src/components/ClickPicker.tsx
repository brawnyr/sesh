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
    <div className="flex flex-col gap-2">
      <div className="font-pixel text-[10px] uppercase tracking-widest text-cream-400">
        click voice
      </div>
      <div className="flex gap-1">
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
              className={`btn ${isActive ? "active" : ""}`}
              style={{ minWidth: "3.6rem" }}
              title={`use the ${LABELS[v]} click`}
            >
              {LABELS[v]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
