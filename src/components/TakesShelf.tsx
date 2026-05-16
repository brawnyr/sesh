import { seshApi, type TakeMeta } from "../lib/tauri";
import { formatBytes } from "../lib/util";

type Props = {
  takes: TakeMeta[];
};

export function TakesShelf({ takes }: Props) {
  if (takes.length === 0) {
    return <div>no takes yet — press space</div>;
  }
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 0,
        maxHeight: 180,
        overflowY: "auto",
        border: "1px solid #000",
      }}
    >
      {takes.map((t, i) => (
        <button
          key={t.path}
          type="button"
          onClick={() => seshApi.revealInFolder(t.path)}
          title={t.path}
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            border: "none",
            borderBottom: i < takes.length - 1 ? "1px solid #000" : "none",
            padding: "4px 8px",
          }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {takes.length - i}. {t.name.replace(/^sesh-/, "").replace(/\.wav$/, "")}
          </span>
          <span style={{ flexShrink: 0 }}>{formatBytes(t.bytes)}</span>
        </button>
      ))}
    </div>
  );
}
