// English leaderboard. The page itself is app/_shared/BoardView.tsx, shared with the Chinese one.
import { BoardView } from "../../../_shared/BoardView";

export default async function BoardEn(
  { searchParams }: { searchParams: Promise<{ scenario?: string }> },
) {
  const { scenario } = await searchParams;
  return <BoardView locale="en" scenario={scenario} />;
}
