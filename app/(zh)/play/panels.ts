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
export const PANEL_ORDER = ["relief", "withdraw", "campaign", "seize", "muster", "transfer", "govern", "build",
                            "submit", "suade", "array", "relocate", "appoint", "scout", "ally", "invest", "passage", "retire"];

/*
 * 分组的中文名**不在这里**，在 lib/i18n 的 `action.<key>`。
 *
 * 原先这里有一张 TYPE_CN，而界面要说第二种语言时它就得再抄一份——
 * 而这张表的值本来就要随语言变，它不是 id。留在这里的 PANEL_ORDER 才是 id：
 * 顺序与语言无关。
 *
 * 「每一类动作都要有界面名」那条闸没有消失，只是挪了个位置：
 * 从「TYPE_CN 里有没有」变成「两份目录里有没有 action.<key>」。
 */
