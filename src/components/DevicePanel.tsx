import type { InputDevice } from "../lib/tauri";

type Props = {
  devices: InputDevice[];
  selected: string | null;
  onSelect: (name: string) => void;
  onRefresh: () => void;
  disabled?: boolean;
};

export function DevicePanel({
  devices,
  selected,
  onSelect,
  onRefresh,
  disabled,
}: Props) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-1">
        <select
          value={selected ?? ""}
          disabled={disabled}
          onChange={(e) => onSelect(e.target.value)}
          style={{
            flex: 1,
            background: "#fff",
            border: "1px solid #000",
            padding: "4px 6px",
            fontFamily: "inherit",
            fontSize: "inherit",
            color: "#000",
          }}
        >
          {devices.length === 0 && <option value="">no inputs</option>}
          {devices.map((d) => (
            <option key={d.name} value={d.name}>
              {d.is_default ? "* " : ""}
              {d.name} [{d.channels || "?"}ch {d.sample_rate ? `${(d.sample_rate / 1000).toFixed(1)}k` : "?"}]
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onRefresh}
          disabled={disabled}
          title="rescan"
        >
          rescan
        </button>
      </div>
    </div>
  );
}
