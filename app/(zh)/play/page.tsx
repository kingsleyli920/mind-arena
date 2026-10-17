import { PlayClient } from "./PlayClient";
import { DICTS } from "@/lib/i18n";
import "./play.css";

export const metadata = { title: DICTS.zh["play.title"] };

export default function PlayPage() {
  return <PlayClient />;
}
