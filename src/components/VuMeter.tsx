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

const GREEN = "#22aa33";
const AMBER = "#d4a017";
const RED = "#cc2222";

function dbToFraction(db: number) {
  const t = (db - DB_MIN) / (DB_MAX - DB_MIN);
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t;
}

function classifyCell(i: number) {
  const dbForCell = DB_MIN + ((i + 0.5) / CELLS) * (DB_MAX - DB_MIN);
  if (dbForCell >= RED_DB) return RED;
  if (dbForCell >= AMBER_DB) return AMBER;
  return GREEN;
}

function peakColor(db: number) {
  if (db >= RED_DB) return RED;
  if (db >= AMBER_DB) return AMBER;
  return GREEN;
}

function formatDb(db: number) {
  if (db <= DB_MIN + 0.5) return "-inf";
  return db.toFixed(1);
}

export function VuMeter({ peakDb, rmsDb, peakHoldDb, clipped }: Props) {
  const peakFrac = dbToFraction(peakDb);
  const holdFrac = dbToFraction(peakHoldDb);
  const peakLit = Math.round(peakFrac * CELLS);

  return (
    <div className="flex flex-col gap-1">
      <div
        style={{
          position: "relative",
          display: "grid",
          gridTemplateColumns: `repeat(${CELLS}, 1fr)`,
          gap: 1,
          height: 16,
          padding: 2,
          border: "1px solid #000",
        }}
      >
        {Array.from({ length: CELLS }, (_, i) => (
          <div
            key={i}
            style={{
              background: i < peakLit ? classifyCell(i) : "#fff",
            }}
          />
        ))}
        {peakHoldDb > DB_MIN + 0.5 && (
          <div
            style={{
              position: "absolute",
              top: 2,
              bottom: 2,
              width: 2,
              left: `calc(${holdFrac * 100}% - 1px)`,
              background: "#000",
              pointerEvents: "none",
              transition: "left 80ms linear",
            }}
            aria-hidden
          />
        )}
      </div>

      <div style={{ position: "relative", height: 14, fontSize: 10 }}>
        {LABELS.map((db) => (
          <span
            key={db}
            style={{
              position: "absolute",
              left: `${dbToFraction(db) * 100}%`,
              transform: "translateX(-50%)",
              top: 0,
            }}
          >
            <span
              aria-hidden
              style={{
                display: "block",
                width: 1,
                height: 4,
                background: "#000",
                margin: "0 auto",
              }}
            />
            <span style={{ display: "block" }}>{db}</span>
          </span>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <span>peak <span style={{ color: peakColor(peakDb) }}>{formatDb(peakDb)}</span></span>
        <span>rms {formatDb(rmsDb)}</span>
        <span style={{ color: RED, visibility: clipped ? "visible" : "hidden" }}>CLIP</span>
      </div>
    </div>
  );
}
