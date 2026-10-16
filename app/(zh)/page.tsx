// 中文落地页。页面本体在 HomeView，中英共用同一个组件——
// 两份页面会各自演化，而没有任何东西会报错。英文版在 app/en/page.tsx
import { HomeView } from "../_shared/HomeView";

export default function Home() {
  return <HomeView locale="zh" />;
}
