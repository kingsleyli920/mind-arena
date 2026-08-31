import type { Metadata } from "next";
import { StrategyGame } from "./StrategyGame";
import "./game.css";

export const metadata: Metadata = {
  title: "群雄沙盘 · Mind Arena",
  description: "在一张原创沙盘地图上与本地策略 AI 或 OpenRouter 模型争夺天下。",
};

export default function GamePage() {
  return <StrategyGame />;
}
