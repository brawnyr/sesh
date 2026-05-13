type Props = {
  level: number; // 0..1
  cells?: number;
};

export function VuMeter({ level, cells = 18 }: Props) {
  const greenEnd = Math.floor(cells * 0.65);
  const amberEnd = Math.floor(cells * 0.85);
  const litCount = Math.min(cells, Math.round(level * cells));
  return (
    <div className="vu" aria-label="input level">
      {Array.from({ length: cells }, (_, i) => {
        const lit = i < litCount;
        let cls = "vu-cell";
        if (lit) {
          if (i < greenEnd) cls += " on-green";
          else if (i < amberEnd) cls += " on-amber";
          else cls += " on-red";
        }
        return <div key={i} className={cls} />;
      })}
    </div>
  );
}
