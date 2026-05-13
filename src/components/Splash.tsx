import { useEffect, useState } from "react";

export type SplashEvent = {
  id: number;
  x: number;
  y: number;
};

type Props = {
  splash: SplashEvent | null;
};

export function Splash({ splash }: Props) {
  const [show, setShow] = useState<SplashEvent | null>(null);

  useEffect(() => {
    if (!splash) return;
    setShow(splash);
    const t = setTimeout(() => setShow(null), 900);
    return () => clearTimeout(t);
  }, [splash]);

  if (!show) return null;
  return (
    <div className="splash-layer">
      <div className="splash" style={{ left: show.x, top: show.y }} />
      <div
        className="splash two"
        style={{ left: show.x, top: show.y }}
      />
      <div
        className="splash-drop"
        style={{ left: show.x, top: show.y }}
      />
    </div>
  );
}
