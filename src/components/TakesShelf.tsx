import { seshApi, type TakeMeta } from "../lib/tauri";
import { formatBytes } from "../lib/util";

type Props = {
  takes: TakeMeta[];
};

// deterministic pseudo-waveform from the take name so each chip looks distinct
function waveform(seed: string, bars = 24) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const out: number[] = [];
  for (let i = 0; i < bars; i++) {
    h = (h * 1103515245 + 12345) >>> 0;
    out.push(0.25 + ((h >>> 8) & 0xff) / 255 * 0.75);
  }
  return out;
}

export function TakesShelf({ takes }: Props) {
  if (takes.length === 0) {
    return (
      <div className="scribble-label py-1">
        no takes yet · hit <span className="kbd">space</span>
      </div>
    );
  }
  return (
    <div className="flex gap-2 overflow-x-auto scrollbar-thin pb-1.5 pt-0.5">
      {takes.slice(0, 16).map((t, i) => {
        const w = waveform(t.name);
        return (
          <button
            key={t.path}
            type="button"
            onClick={() => seshApi.revealInFolder(t.path)}
            className="take-chip"
            title={t.path}
          >
            <div className="take-waveform">
              {w.map((v, j) => (
                <span key={j} style={{ height: `${Math.round(v * 100)}%` }} />
              ))}
            </div>
            <div className="take-chip-row">
              <span className="take-chip-num">take {takes.length - i}</span>
              <span className="take-chip-meta">{formatBytes(t.bytes)}</span>
            </div>
            <span className="take-chip-title">
              {t.name.replace(/^sesh-/, "").replace(/\.wav$/, "")}
            </span>
          </button>
        );
      })}
    </div>
  );
}
