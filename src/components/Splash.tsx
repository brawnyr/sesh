import { useEffect, useState, type CSSProperties } from "react";

export type SplashEvent = {
  id: number;
  x: number;
  y: number;
};

type Props = {
  splash: SplashEvent | null;
};

type Droplet = {
  dx: number;
  dy: number;
  ds: number;
  size: number;
};

function makeDroplets(seed: number, count = 10): Droplet[] {
  let s = seed | 0;
  const rand = () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return ((s >>> 8) & 0xffff) / 0xffff;
  };
  const out: Droplet[] = [];
  for (let i = 0; i < count; i++) {
    const angle = rand() * Math.PI * 2;
    const dist = 50 + rand() * 90;
    out.push({
      dx: Math.cos(angle) * dist,
      dy: Math.sin(angle) * dist,
      ds: 0.8 + rand() * 1.8,
      size: 6 + rand() * 12,
    });
  }
  return out;
}

export function Splash({ splash }: Props) {
  const [show, setShow] = useState<SplashEvent | null>(null);

  useEffect(() => {
    if (!splash) return;
    setShow(splash);
    const t = setTimeout(() => setShow(null), 900);
    return () => clearTimeout(t);
  }, [splash]);

  if (!show) return null;
  const droplets = makeDroplets(show.id);
  return (
    <div className="splash-layer">
      <div className="splash" style={{ left: show.x, top: show.y }} />
      {droplets.map((d, i) => (
        <div
          key={i}
          className="splash-dot"
          style={
            {
              left: show.x,
              top: show.y,
              width: `${d.size}px`,
              height: `${d.size}px`,
              "--dx": `${d.dx}px`,
              "--dy": `${d.dy}px`,
              "--ds": d.ds,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
