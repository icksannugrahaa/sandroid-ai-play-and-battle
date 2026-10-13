import type { ReactNode } from "react";

export interface CellStyle {
  bg: string;
  text?: ReactNode;
  fg?: string;
  ring?: string;
}

/** Square-cell grid used by maze, sudoku, sliding puzzle and ARC views. */
export function CellGrid({
  rows,
  cols,
  cell,
  size = 22,
  gap = 1,
}: {
  rows: number;
  cols: number;
  cell: (r: number, c: number) => CellStyle;
  size?: number;
  gap?: number;
}) {
  const s = Math.max(10, Math.min(size, Math.floor(360 / Math.max(rows, cols))));
  return (
    <div className="inline-grid rounded-md bg-slate-800 p-px" style={{ gridTemplateColumns: `repeat(${cols}, ${s}px)`, gap }}>
      {Array.from({ length: rows * cols }, (_, k) => {
        const r = Math.floor(k / cols);
        const c = k % cols;
        const st = cell(r, c);
        return (
          <div
            key={k}
            className="flex items-center justify-center font-mono leading-none"
            style={{
              width: s,
              height: s,
              background: st.bg,
              color: st.fg ?? "#e2e8f0",
              fontSize: Math.max(8, s * 0.55),
              boxShadow: st.ring ? `inset 0 0 0 2px ${st.ring}` : undefined,
            }}
          >
            {st.text}
          </div>
        );
      })}
    </div>
  );
}

export function Caption({ children }: { children: ReactNode }) {
  return <div className="mb-1 text-[11px] tracking-wide text-slate-500 uppercase">{children}</div>;
}

export function Side({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-start gap-6">{children}</div>;
}
