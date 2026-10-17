// 中文排行榜。页面本体在 app/_shared/BoardView.tsx，中英共用。
// `?scenario=` 与 /play、/game 同一个口径
import { BoardView } from "../../_shared/BoardView";

export default async function Board(
  { searchParams }: { searchParams: Promise<{ scenario?: string }> },
) {
  const { scenario } = await searchParams;
  return <BoardView locale="zh" scenario={scenario} />;
}
