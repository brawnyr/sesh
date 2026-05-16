import { CLICK_VOICES, type ClickVoice } from "../lib/metronome";

type Props = {
  value: ClickVoice;
  onChange: (voice: ClickVoice) => void;
  onAudition: (voice: ClickVoice) => void;
  disabled?: boolean;
};

export function ClickPicker({ value, onChange, onAudition, disabled }: Props) {
  return (
    <div className="flex flex-wrap gap-1">
      {CLICK_VOICES.map((v) => (
        <button
          key={v}
          type="button"
          disabled={disabled}
          onClick={() => {
            onChange(v);
            onAudition(v);
          }}
          className={value === v ? "active" : ""}
        >
          {v}
        </button>
      ))}
    </div>
  );
}
