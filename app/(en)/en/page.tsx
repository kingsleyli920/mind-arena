// 英文落地页。与中文版共用 HomeView——两份页面会各自演化，而没有任何东西会报错。
import { HomeView } from "../../_shared/HomeView";


export default function HomeEn() {
  return <HomeView locale="en" />;
}
