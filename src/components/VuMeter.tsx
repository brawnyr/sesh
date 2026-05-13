type Props = {
  peakDb: number;
  rmsDb: number;
  peakHoldDb: number;
  clipped: boolean;
};

const CELLS = 28;
const DB_MIN = -60;
const DB_MAX = 0;
const AMBER_DB = -12;
const RED_DB = -3;
const LABELS: number[] = [-60, -40, -20, -12, -6, -3, 0];

function dbToFraction(db: number) {
  const t = (db - DB_MIN) / (DB_MAX - DB_MIN);
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t;
}

function classifyCell(i: number) {
  const dbForCell = DB_MIN + ((i + 0.5) / CELLS) * (DB_MAX - DB_MIN);
  if (dbForCell >= RED_DB) return "on-red";
  if (dbForCell >= AMBER_DB) return "on-amber";
  return "on-green";
}

function formatDb(db: number) {
  if (db <= DB_MIN + 0.5) return "-∞";
  return db.toFixed(1);
}

export function VuMeter({ peakDb, rmsDb, peakHoldDb, clipped }: Props) {
  const peakFrac = dbToFraction(peakDb);
  const rmsFrac = dbToFraction(rmsDb);
  const holdFrac = dbToFraction(peakHoldDb);
  const peakLit = Math.round(peakFrac * CELLS);
  void rmsFrac;

  const peakColor =
    peakDb >= RED_DB
      ? "text-rec-400"
      : peakDb >= AMBER_DB
        ? "text-crema-400"
        : "text-vu-green";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative">
        <div className="vu" style={{ gridTemplateColumns: `repeat(${CELLS}, 1fr)` }}>
          {Array.from({ length: CELLS }, (_, i) => {
            let cls = "vu-cell";
            if (i < peakLit) cls += " " + classifyCell(i);
            return <div key={i} className={cls} />;
          })}
        </div>
        {peakHoldDb > DB_MIN + 0.5 && (
          <div
            className="absolute top-[3px] bottom-[3px] w-[2px] bg-cream-50 pointer-events-none"
            style={{
              left: `calc(${holdFrac * 100}% - 1px)`,
              boxShadow: "0 0 6px rgba(244,232,208,0.85)",
              transition: "left 80ms linear",
            }}
            aria-hidden
          />
        )}
        <div className="absolute inset-y-0 pointer-events-none" style={{ left: `${dbToFraction(AMBER_DB) * 100}%`, width: 1, background: "rgba(244,232,208,0.18)" }} />
        <div className="absolute inset-y-0 pointer-events-none" style={{ left: `${dbToFraction(RED_DB) * 100}%`, width: 1, background: "rgba(255,77,46,0.35)" }} />
      </div>

      <div className="relative h-3 font-mono text-[9px] text-cream-400">
        {LABELS.map((db) => (
          <span
            key={db}
            className="absolute -translate-x-1/2"
            style={{ left: `${dbToFraction(db) * 100}%` }}
          >
            {db}
          </span>
        ))}
      </div>

      <div className="flex items-center justify-between font-mono text-xs">
        <div className="flex items-baseline gap-2">
          <span className={`readout text-base ${peakColor}`} style={{ textShadow: "none" }}>
            {formatDb(peakDb)}
          </span>
          <span className="font-pixel text-[10px] uppercase tracking-widest text-cream-400">
            peak db
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="font-pixel text-[10px] uppercase tracking-widest text-cream-400">
            rms
          </span>
          <span className="text-cream-300">{formatDb(rmsDb)}</span>
        </div>
        <div
          className={`font-pixel text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded transition-opacity ${
            clipped
              ? "bg-rec-600/30 text-rec-400 animate-blink opacity-100"
              : "text-cream-400/40 opacity-50"
          }`}
        >
          ● clip
        </div>
      </div>
    </div>
  );
}
