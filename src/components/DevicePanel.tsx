import { useEffect, useRef, useState } from "react";
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
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const current = devices.find((d) => d.name === selected) ?? null;
  const label = current ? current.name : selected ?? "no input selected";

  return (
    <div className="flex flex-col gap-2 relative" ref={containerRef}>
      <div className="flex gap-1">
        <button
          type="button"
          className="btn flex-1 justify-between"
          onClick={() => setOpen((o) => !o)}
          disabled={disabled}
          title={current?.name ?? ""}
        >
          <span className="truncate font-mono normal-case tracking-normal text-cream-100">
            {label}
          </span>
          <span className="font-pixel text-xs text-cream-400">
            {current
              ? `${current.channels}ch · ${(current.sample_rate / 1000).toFixed(1)}k`
              : "—"}
          </span>
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={() => {
            onRefresh();
            setOpen(true);
          }}
          disabled={disabled}
          title="rescan devices"
          aria-label="rescan devices"
        >
          ↻
        </button>
      </div>

      {open && (
        <div
          className="absolute left-0 top-full mt-1 w-full z-30 panel max-h-72 overflow-auto scrollbar-thin"
          role="listbox"
        >
          {devices.length === 0 && (
            <div className="px-3 py-3 font-mono text-sm text-cream-400">
              no inputs detected — check that your scarlett is plugged in and
              not claimed by another app.
            </div>
          )}
          {devices.map((d) => {
            const isSelected = d.name === selected;
            return (
              <button
                key={d.name}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onSelect(d.name);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-2 font-mono text-sm flex justify-between gap-3 transition-colors ${
                  isSelected
                    ? "bg-roast-700 text-cream-50"
                    : "hover:bg-roast-800 text-cream-200"
                }`}
              >
                <span className="truncate">
                  {d.is_default ? "★ " : ""}
                  {d.name}
                </span>
                <span className="text-cream-400 shrink-0">
                  {d.channels || "?"}ch ·{" "}
                  {d.sample_rate ? `${(d.sample_rate / 1000).toFixed(1)}k` : "?"}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
