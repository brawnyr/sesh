type Props = {
  beatsPerBar: number;
  activeBeat: number | null;
  size?: number;
};

export function BeatStrip({ beatsPerBar, activeBeat, size = 14 }: Props) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: Math.max(4, Math.round(size / 4)) }} aria-label="beats">
      {Array.from({ length: beatsPerBar }, (_, i) => {
        const lit = activeBeat === i;
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              width: size,
              height: size,
              border: "2px solid #000",
              background: lit ? "#000" : "#fff",
            }}
          />
        );
      })}
    </div>
  );
}
