type Props = {
  beatsPerBar: number;
  activeBeat: number | null;
};

export function BeatStrip({ beatsPerBar, activeBeat }: Props) {
  return (
    <div className="flex items-end gap-1.5" aria-label="beats">
      {Array.from({ length: beatsPerBar }, (_, i) => {
        const lit = activeBeat === i;
        const downbeat = i === 0;
        return (
          <div
            key={i}
            className={[
              "beat-cell",
              downbeat ? "downbeat" : "",
              lit ? "lit" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          />
        );
      })}
    </div>
  );
}
