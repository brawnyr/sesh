import { seshApi, type TakeMeta } from "../lib/tauri";
import { formatBytes } from "../lib/util";

type Props = {
  takes: TakeMeta[];
};

export function TakesShelf({ takes }: Props) {
  if (takes.length === 0) {
    return (
      <div className="font-pixel text-xs text-cream-400 tracking-widest uppercase">
        no takes yet · hit <span className="kbd">space</span>
      </div>
    );
  }
  return (
    <div className="flex gap-2 overflow-x-auto scrollbar-thin pb-1">
      {takes.slice(0, 16).map((t, i) => (
        <button
          key={t.path}
          type="button"
          onClick={() => seshApi.revealInFolder(t.path)}
          className="panel px-3 py-2 flex flex-col items-start gap-0.5 min-w-[10.5rem] transition-transform hover:-translate-y-0.5"
          title={t.path}
        >
          <span className="font-pixel text-[10px] uppercase tracking-widest text-cream-400">
            take {takes.length - i}
          </span>
          <span className="font-mono text-xs text-cream-100 truncate w-full text-left">
            {t.name.replace(/^sesh-/, "").replace(/\.wav$/, "")}
          </span>
          <span className="font-mono text-[10px] text-cream-400">
            {formatBytes(t.bytes)}
          </span>
        </button>
      ))}
    </div>
  );
}
