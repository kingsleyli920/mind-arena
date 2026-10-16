// 中文排行榜。页面本体在 app/_shared/BoardView.tsx，中英共用。
import { BoardView } from "../../_shared/BoardView";

export default function Board() {
  return <BoardView locale="zh" />;
}
