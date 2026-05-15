import { seshApi, type TakeMeta } from "../lib/tauri";
import { formatBytes } from "../lib/util";

type Props = {
  takes: TakeMeta[];
};

export function TakesShelf({ takes }: Props) {
  if (takes.length === 0) {
    return (
      <div className="font-pixel text-xs text-cream-400 tracking-widest uppercase py-2">
        no takes yet · hit <span className="kbd">space</span>
      </div>
    );
  }
  return (
    <div className="flex gap-2 overflow-x-auto scrollbar-thin pb-1.5 pt-0.5">
      {takes.slice(0, 16).map((t, i) => (
        <button
          key={t.path}
          type="button"
          onClick={() => seshApi.revealInFolder(t.path)}
          className="cassette text-left"
          title={t.path}
        >
          <div className="cassette-reels">
            <div className="cassette-reel" />
            <div className="cassette-tape" />
            <div className="cassette-reel" />
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="cassette-label">take {takes.length - i}</span>
            <span className="cassette-meta">{formatBytes(t.bytes)}</span>
          </div>
          <span className="cassette-title">
            {t.name.replace(/^sesh-/, "").replace(/\.wav$/, "")}
          </span>
        </button>
      ))}
    </div>
  );
}
