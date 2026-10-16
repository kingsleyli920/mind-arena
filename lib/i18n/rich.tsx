// 把带 `**强调**` 的文案渲染出来。解析与「为什么是这个办法」见 ./marks.ts。
import type { ReactNode } from "react";
import { splitMarks } from "./marks.ts";

export function rich(text: string): ReactNode {
  if (!text.includes("**")) return text;
  return (
    <>
      {splitMarks(text).map((seg, i) =>
        seg.bold ? <b key={i}>{seg.text}</b> : <span key={i}>{seg.text}</span>)}
    </>
  );
}
