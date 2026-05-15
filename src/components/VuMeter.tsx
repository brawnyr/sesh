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
  const holdFrac = dbToFraction(peakHoldDb);
  const peakLit = Math.round(peakFrac * CELLS);

  const peakColor =
    peakDb >= RED_DB
      ? "var(--crimson)"
      : peakDb >= AMBER_DB
        ? "var(--ochre-deep)"
        : "var(--sap)";

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
            className="absolute top-[3px] bottom-[3px] w-[2px] pointer-events-none"
            style={{
              left: `calc(${holdFrac * 100}% - 1px)`,
              background: "var(--ink)",
              transition: "left 80ms linear",
            }}
            aria-hidden
          />
        )}
        <div
          className="absolute inset-y-0 pointer-events-none"
          style={{
            left: `${dbToFraction(AMBER_DB) * 100}%`,
            width: 1,
            background: "rgba(40, 30, 15, 0.25)",
          }}
        />
        <div
          className="absolute inset-y-0 pointer-events-none"
          style={{
            left: `${dbToFraction(RED_DB) * 100}%`,
            width: 1,
            background: "rgba(200, 53, 30, 0.5)",
          }}
        />
      </div>

      <div className="relative h-3 font-mono text-[9px] text-[var(--bone-soft)]">
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
          <span
            className="font-mono text-base"
            style={{ color: peakColor, fontWeight: 600 }}
          >
            {formatDb(peakDb)}
          </span>
          <span className="stamp" style={{ fontSize: "0.6rem" }}>
            peak db
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="stamp" style={{ fontSize: "0.6rem" }}>
            rms
          </span>
          <span className="text-[var(--bone)]">{formatDb(rmsDb)}</span>
        </div>
        <div
          className={`stamp px-1.5 py-0.5 rounded transition-opacity ${
            clipped ? "animate-blink opacity-100" : "opacity-40"
          }`}
          style={{
            color: clipped ? "var(--crimson)" : "var(--bone-faint)",
            background: clipped ? "rgba(200, 53, 30, 0.12)" : "transparent",
            fontSize: "0.6rem",
          }}
        >
          ● clip
        </div>
      </div>
    </div>
  );
}
