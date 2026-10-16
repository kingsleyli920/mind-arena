"use client";
// 规则速览。
//
// 新玩家进来看到的是「缺口 4 对可防守 3→破城」「取下即升乙档」这类
// 高度压缩的判词，全靠候选标签自解释——而那些标签是为**已经懂规则的人**
// 写的。这一页补上前置知识。
//
// **所有数字从 EngineParams 取，不在这里抄第二份，也不进文案目录。**
// 内容包一改，这一页跟着变；抄一份就会有一天说的是三个月前的规则。
// 文案目录里留的是 `{carry}` `{base}` 这样的洞，数字在渲染时填进去——
// 于是译者改不动规则，而改规则的人也不必碰两种语言的文案。
import { DEFAULT_RULES } from "@/lib/game/engine/actions.ts";
import type { EngineParams } from "@/lib/game/engine/params.ts";
import { makeT, type Locale } from "@/lib/i18n";
import { rich } from "@/lib/i18n/rich";

export function Primer({ P, locale = "zh" }: { P: EngineParams; locale?: Locale }) {
  const t = makeT(locale);
  // 令数同样不许在这里抄第二份——它们在 DEFAULT_RULES 里
  const R = DEFAULT_RULES;
  // 阶梯的分隔符跟着语言走：中文分号，英文分号后带空格
  const ladder = P.breachLadder
    .map(([r, n]) => t("primer.siege.rung", { ratio: r, n }))
    .join(locale === "zh" ? "；" : "; ");
  return (
    <div className="primer">
      <section>
        <h3>{t("primer.win.h")}</h3>
        <p>{rich(t("primer.win.lead"))}</p>
        <ul>
          <li><b>{t("grade.jia")}</b>{"　"}{t("primer.win.jia")}</li>
          <li><b>{t("grade.yi")}</b>{"　"}{t("primer.win.yi")}</li>
          <li><b>{t("grade.bing")}</b>{"　"}{t("primer.win.bing")}</li>
          <li><b>{t("grade.ding")}</b>{"　"}{t("primer.win.ding")}</li>
        </ul>
        <p>{t("primer.win.note")}</p>
      </section>

      <section>
        <h3>{t("primer.ap.h")}</h3>
        <p>{t("primer.ap.lead", { carry: P.carryCap, per: R.perCommanderyOrders })}</p>
        <ul>
          <li>{t("primer.ap.campaign")}{"　"}{rich(t("primer.ap.unit", { n: R.campaignAp }))}</li>
          <li>{t("primer.ap.normal")}{"　"}{rich(t("primer.ap.unit", { n: R.normalAp }))}</li>
          <li>{t("primer.ap.scout")}{"　"}{rich(t("primer.ap.scout.v", { n: R.freeUses.scout }))}</li>
          <li>{t("primer.ap.appoint")}{"　"}
            {rich(t("primer.ap.appoint.v", { n: R.freeUses.appoint, ap: R.normalAp }))}</li>
        </ul>
      </section>

      <section>
        <h3>{t("primer.siege.h")}</h3>
        <p>{rich(t("primer.siege.lead"))}</p>
        <p className="mono">{ladder}</p>
        <p>{t("primer.siege.hold", { base: P.holdBase, per: P.defensePerHold })}</p>
        <p>{t("primer.siege.gear", { might: P.mightBreachThreshold })}</p>
        <p>{rich(t("primer.siege.floor"))}</p>
      </section>

      <section>
        <h3>{t("primer.form.h")}</h3>
        <p>{rich(t("primer.form.lead", { n: P.formationBreach }))}</p>
        <p>{rich(t("primer.form.why"))}</p>
        <p>{rich(t("primer.form.fog"))}</p>
      </section>

      <section>
        <h3>{t("primer.fog.h")}</h3>
        <ul>
          <li><b>{t("primer.fog.own")}</b>{"　"}{t("primer.fog.own.v")}</li>
          <li><b>{t("primer.fog.scouted")}</b>{"　"}
            {t("primer.fog.scouted.v", {
              pct: Math.round(P.intelErrorRatio * 100), seasons: P.intelValidSeasons,
            })}</li>
          <li><b>{t("primer.fog.unseen")}</b>{"　"}
            {t("primer.fog.unseen.v", { tiers: P.intelTiers, ratio: P.intelTierRatio })}</li>
          <li><b>{t("primer.fog.ally")}</b>{"　"}{t("primer.fog.ally.v")}</li>
        </ul>
        <p>{t("primer.fog.note")}</p>
      </section>

      <section>
        <h3>{t("primer.officer.h")}</h3>
        <p>{t("primer.officer.lead", { cap: P.retinueCap, weight: P.deputyWeight })}</p>
        <p>{rich(t("primer.officer.cap", { per: P.troopsPerOfficer }))}</p>
        <p>{rich(t("primer.officer.captive"))}</p>
      </section>

      <section>
        <h3>{t("primer.suade.h")}</h3>
        <p>{rich(t("primer.suade.captive"))}</p>
        <p>{rich(t("primer.suade.rate", {
          window: P.suadeWindow, base: P.suadeBase,
          per: P.suadePerStat, home: P.suadeHomeBonus,
        }))}</p>
        <p>{rich(t("primer.suade.fail", { per: P.troopsPerOfficer }))}</p>
      </section>

      <section>
        <h3>{t("primer.supply.h")}</h3>
        <p>{rich(t("primer.supply.lead"))}</p>
        <p>{rich(t("primer.supply.ally", {
          morale: P.betrayMoralePenalty, ban: P.betrayBanSeasons,
        }))}</p>
      </section>

      <section>
        <h3>{t("primer.sim.h")}</h3>
        <p>{t("primer.sim.lead")}</p>
      </section>
    </div>
  );
}
