type Props = {
  beatsPerBar: number;
  activeBeat: number | null;
};

export function BeatStrip({ beatsPerBar, activeBeat }: Props) {
  return (
    <div className="flex items-center gap-2" aria-label="beats">
      {Array.from({ length: beatsPerBar }, (_, i) => {
        const lit = activeBeat === i;
        const downbeat = i === 0;
        return (
          <div
            key={i}
            className={[
              "beat-dab",
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
