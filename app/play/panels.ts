/**
 * 候选面板的分组：顺序与中文名。
 *
 * 两张表都以**候选 key 的前缀**为准，而不是动作类型——relief 与 withdraw
 * 不是动作类型，是引擎派生出来的键。漏一项的后果是界面上直接露出内部 id：
 * 加阵型时「改阵」那一栏就显示成了 `array`，而当时全部测试是绿的。
 *
 * 单独成文件是为了让测试能读到它（PlayClient.tsx 带 JSX，测试里 import 不进来）。
 * tests/engine.test.mjs「界面的候选分组两张表都要覆盖」钉住这件事
 */

/** 面板顺序：按「这一季最该先看什么」排，不按引擎的枚举顺序。
 *  免费的刺探若排在第五个面板，玩家得先滚过二十条「因为没探所以全是未知」
 *  的候选，才找得到那件最该先做的事 */
export const PANEL_ORDER = ["relief", "withdraw", "campaign", "muster", "govern", "build",
                            "submit", "suade", "array", "relocate", "appoint", "scout", "ally", "passage", "retire"];

export const TYPE_CN: Record<string, string> = {
  campaign: "征伐", relief: "赴援", withdraw: "撤围", muster: "集结",
  govern: "内政", build: "兴建", submit: "劝降", suade: "招降", array: "改阵", relocate: "迁治", appoint: "调任", scout: "刺探", ally: "外交",
  passage: "借道", retire: "归隐",
};
