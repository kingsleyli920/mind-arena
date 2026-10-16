[中文](OFFICER-ANCHORS-FEMALE.md) · [English](OFFICER-ANCHORS-FEMALE.en.md)

# Five-Dimension Anchor Ladders for Female Figures

Generated: 2026-08-31
Companion data: `lib/game/data/officer-anchors-female.json`
Parent system: `docs/OFFICER-ANCHORS.en.md` + `lib/game/data/officer-anchors.json`
Applies to: the 15 women among the 578 people in `officers.json`

---

## 0. Why this needs a document of its own

The five anchor ladders in `docs/OFFICER-ANCHORS.en.md` hold 40 people in all, **zero of them
female**.

That is not an oversight, it is a structural consequence of the evidence standards. The evidence
standards for the male anchors are written hard: leadership requires "commanded as
commander-in-chief and won" (C13), might requires "killed or captured an enemy general with his own
hands", intellect requires "a plan adopted and borne out", politics requires "a stock phrase for
administrative achievement / production works / institutional achievement". Behind all four
standards lies the same premise — **this person held office, had private retainers (部曲), and
submitted memorials**. Women at the end of Han systematically had none of those three, not because
they were incapable, but because the institutions kept them out of the positions that produce such
records.

Applying the male standards unchanged to women has only two possible outcomes:

- **Everyone bottoms out.** All five dimensions of all 15 land below 40, and they look like 15 Hua
  Tuos.
- **Scoring by impression.** Once the evidence standards stop working, all that is left is "she was
  pretty impressive, surely", which is exactly what section 1 of this system expressly forbids.

So this document does one thing and one thing only: **it redefines where the evidence for the five
dimensions comes from in the sources about women, while leaving the orthogonality principle, the
anchor values, the cross-constraints and the target distribution all untouched.**

What changes is "where to go looking for evidence", not "how to set a score once the evidence is
found".

### The standing of this table

The five dimensions, aptitudes and loyalty of the 15 people in the `calibrationSet` of
`officer-anchors-female.json` are **on the same level as the parent file's `calibrationSet`: they
are assertion values**. The 15 are scattered across the 7 batches of `_partition.json` (weiwu 1,
yuan 1, shu 1, north-a 3, north-b 2, free2-a 3, free2-c 4); when a batch reaches one of them it
**takes the values straight from this table and does not derive them again**.

| Batch | People covered by this table |
| --- | --- |
| weiwu | Lady Bian (卞氏) |
| yuan | Lady Wu (吴夫人) |
| shu | Lady Gan (甘夫人) |
| north-a | Diaochan (貂蝉), Lady Yan (严氏), Wang Yi (王异) |
| north-b | Lady Zou (邹氏), Lady Zhurong (祝融夫人) |
| free2-a | Cai Yan (蔡琰), Fu Shou (伏寿), Lady Sun (孙夫人) |
| free2-c | Empress Dowager He (何太后), Da Qiao (大桥), Xiao Qiao (小桥), Wu Guotai (吴国太) |

---

## 1. The same-scale contract

> **The same number must mean the same ability in both sets of anchors.**
> "A woman's 80 is really worth a man's 60" is not allowed, and neither is the reverse.

That sentence cannot be honoured by a promise, only by verifiable machinery. This table uses three
layers:

**Layer one: every `statBasis` must name at least one male anchor.**
Not "Wang Yi was good at defending cities", but "Wang Yi leadership 52, clearly above Xun Yu(48),
文臣临难持重而位不在军中 (a civil official keeping his head in a crisis, with his place not in the
army) — Xun Yu took no part in a city's defense and Wang Yi did so in person; slightly below Han
Dang(62) — never once in her life did she lead troops into battle as commander-in-chief".
**There is not one female anchor in the female anchor table. Every anchor is a male anchor; the
women are merely placed against them.**

**Layer two: the `sameScaleCheck` section gives 15 line-by-line comparisons.**
Each row states the female value, the matching male anchor value, the evidence class the two share,
and which specific fact the gap comes from. Four rows:

| Dimension | Female | Matching male | Shared evidence class | Where the gap comes from |
| --- | --- | --- | --- | --- |
| Intellect | Xin Xianying (辛宪英) 86 | Ju Shou (沮授) 86 | foresight / remonstrance borne out, three instances each | no gap — **same evidence class, same number of instances, so the same number** |
| Intellect | Cai Yan (蔡琰) 72 | Wang Can (王粲) 70 | prodigious memory, and neither has a single plan offered | +2 because Cai Yan also has 妙于音律 (consummate in music and the pitch-pipes), which falls on the writings-and-arts effect surface |
| Might | Lady Gan (甘夫人) 14 / Lady Yan (严氏) 14 | Kan Ze (阚泽) 14 | no record of bearing a weapon, and all have lived through war at first hand | no gap |
| Politics | Lady Gan 56 | Cai Mao (蔡瑁) 52 | the text of an actual duty, 摄内事 (took charge of internal affairs), versus the position of 掌荆州水军 (commanded the Jingzhou navy) | +4 is the difference between "text of an actual duty" and "position only" |

**Layer three: the empirical distribution.** See section 8. If women are being systematically
discounted, all five dimensions should come out low together; if the evidence surface is merely
narrow, only the dimensions with no evidence should come out low. **This can be settled with
numbers, so there is nothing to argue about.**

---

## 2. Evidence sources redefined

Not a word of the orthogonality principle changes: **the evidence sets of the five dimensions are
disjoint. Leadership draws evidence only from records of organising and commanding troops, might
only from records of fighting in person, intellect only from foresight and plans offered, politics
only from administrative achievement and participation in government, charisma only from attachment
and literati appraisal. Mixing the evidence first and adjusting the scores afterwards is papering
over collinearity.**

All that changes is what each set looks like in the sources about women.

| Dimension | Only from here (the female form) | Never from here |
| --- | --- | --- |
| **Leadership** | organising a defense in a crisis (a plan to rely on the walls, 婴城固守 holding a walled city); keeping private retainers in hand (having armed dependants and keeping them from scattering); deciding in the moment (a decision made and carried out when the commander's fate is unknown or the city is about to fall); the organisational effect of supplying an army to steady the men | her husband or brothers could fight; the rank of Empress / Empress Dowager / Mother of the State; decisions in court politics (goes to politics); an appraisal of her personal boldness (goes to might) |
| **Might** | explicit text of taking part in battle in person (亲犯矢石 braving arrows and stones, 亲执兵刃 taking up a weapon herself); a stock appraisal of valor (the words 勇 or 猛 must appear in the appraisal and must refer to her own person) | maidservants holding blades (the one holding the blade is the maid, not she); being seized, captured or coerced (a victim is not a combatant); poisoning (not combat); being inside a besieged city (presence is not participation) |
| **Intellect** | a prediction borne out; a remonstrance borne out; seeing through an enemy's plan; writings, mastery of the classics, calendrical arts, music, prodigious memory | wide learning with no record of judgment (caps at the 65–72 band); political effects produced by beauty (goes to charisma); the reputation for talent of her husband or son |
| **Politics** | records of an actual duty in running a household (管家事 managing household affairs, 常摄内事 regularly taking charge of internal affairs, 后宫法度自其始 the rules of the inner palace began with her); managing finances to supply an army; remonstrating on domestic administration and being heeded; a stock phrase for the practical effect of taking part in decisions; the office rank of a regency or acting authority | great fame (goes to charisma); wide reading (goes to intellect); position with not one administrative achievement (stops around Cai Mao's 52) |
| **Charisma** | family standing; appraisal by a famous literatus (including an entry of her own in a 《列女传》 (*Biographies of Exemplary Women*), and a lord's stock appraisal of her); being courted by several sides (ransomed home at a heavy price, married as a pledge of alliance); her words being able to change the decision of whoever holds power | **beauty**; a posthumous title (honour that flows from a son's rank is not renown in her lifetime); her husband's renown |

### Three boundaries that are easiest to confuse

**"Rank" is not evidence of leadership.** Empress Dowager He (何太后) held court and exercised
imperial authority, yet her leadership is 24, because the one who commanded the palace guards was
He Jin (何进), not her. This is the same rule as "high office does not mean he can lead troops" on
the male side.

**侍婢百余人皆亲执刀侍立 (over a hundred maidservants, all standing in attendance with blades in
hand) is not evidence of might, it is evidence of leadership.**
The ones holding blades are the maids, not she. The sentence shows that she had an armed
following — which belongs under "keeping private retainers in hand". Hence Lady Sun (孙夫人) gets
leadership 50 and might 46: **one piece of source material enters one dimension only.**

**Beauty does not score, but an attestable political consequence produced by beauty does.**
The basis for Diaochan's (貂蝉) charisma of 85 is the political consequence of the chain stratagem,
not her looks; Da Qiao (大桥) and Xiao Qiao (小桥) produced no political consequence at all, so the
line 皆国色也 (both were beauties of the realm) does not score. The same rule also explains why
Diaochan is 85 and Da Qiao 62 — **it is not that the *Romance* outranks the official history, it is
that having a consequence outranks having none.**

---

## 3. Five female ladders

**Every rung hangs directly off a male anchor; that is how "the same scale" is implemented.**

### Leadership

| Value | Woman | Matching male anchor | Basis |
| --- | --- | --- | --- |
| **52** | Wang Yi (王异) | Xun Yu 48 / Han Dang 62 | the plan to rely on the walls at Mount Qi, giving away the family's wealth to reward the soldiers, taking part in the city's defense in person — three female evidence clauses matched at once; never once led troops as commander-in-chief, so she cannot reach Han Dang. **The summit of female leadership** |
| **52** | Lady Bian (卞氏) | Xun Yu 48 | when the report of the commander's death arrived she stopped the rout, and it happened in the army; but those she steadied were a few dozen attendant officials, not private retainers |
| **50** | Lady Sun (孙夫人) | Xun Yu 48 | had over a hundred armed retainers, but 《云别传》's 纵横不法 (ran riot, outside the law) is the opposite of disciplining an army, and the two cancel out |
| **34** | Lady Wu (吴夫人) | below Xun Yu 48 | the 军 in 助治军国 (helped govern the army and the state) points at no specific military action, so by evidence discipline it goes to politics; what remains in this dimension is one consultation, 引见张昭董袭问江东可保 (she summoned Zhang Zhao and Dong Xi to ask whether the Jiangdong could be held) |
| **24** | Empress Dowager He (何太后) / Lady Yan (严氏) | Kan Ze 22 | they had position, and were inside a besieged city, but there is not one record of organising anything |
| **14** | Da Qiao (大桥) / Xiao Qiao (小桥) / Lady Zou (邹氏) | Hua Tuo 12 | not one character in the histories touches on war |

### Might

| Value | Woman | Matching male anchor | Basis |
| --- | --- | --- | --- |
| **68** | Lady Zhurong (祝融夫人) (*Romance*) | Li Dian 64 / Yu Jin 74 | in the *Romance* she captures Zhang Ni and Ma Zhong with flying blades; **held down by C15's ceiling of 72, whereas *Romance* consensus would place her higher — the divergence is recorded as it stands** |
| **60** | Wang Yi (王异) | Li Dian 64 | **亲犯矢石 (braved arrows and stones in person) — the only exception channel for a historical woman**; one engagement only, not a career in the ranks |
| **46** | Lady Sun (孙夫人) | Cheng Yu 48 | 刚猛 (bold and fierce) is an appraisal, not a deed; Cheng Yu actually cut down a county officer, so he is slightly higher |
| **30** | Lady Bian (卞氏) | Jia Xu 34 | long in the army without ever crossing blades; her standing was that of a family member, not a staff adviser |
| **14** | Lady Gan (甘夫人) / Lady Yan (严氏) | Kan Ze 14 | lived through war at first hand with no record of bearing a weapon — **the common slot for a woman is the common slot for a male civil official** |
| **10** | Da Qiao / Xiao Qiao / Lady Zou | Hua Tuo 8 | the actual lowest slot; +2 because they really were seized when their cities fell, rather than sitting purely in a study |

### Intellect

| Value | Woman | Matching male anchor | Basis |
| --- | --- | --- | --- |
| **86** | Xin Xianying (辛宪英) (not in the pool) | Ju Shou 86 | three predictions, all correct, two of them remonstrances — the same number of instances and the same evidence class as Ju Shou's three remonstrances all borne out |
| **74** | Lady Wu (吴夫人) | Zhang Zhao 76 / Kuai Yue 78 | the stock appraisal 有智略 (had wits and stratagem) in her own biography + the remonstrance at the well that stopped Sun Ce from killing a man + repeatedly setting Sun Quan right with plain speech |
| **72** | Cai Yan (蔡琰) | Wang Can 70 | prodigious memory + music; **zero plans offered, zero predictions, zero ruses seen through**, so she cannot reach 86 |
| **66** | Lady Bian / Wang Yi | Kan Ze 65 | Lady Bian has one judgment borne out; Wang Yi has two or three successful stratagems, but all of them matters of one city or one household |
| **52** | Lady Sun / Lady Yan | Han Dang 50 | the appraisal 才捷 (quick-witted) / one remonstrance that was heeded but not borne out |
| **40** | Empress Dowager He | below Han Dang 50 | **negative evidence**: a remonstrance she refused, borne out in reverse (refusing to execute the eunuchs got He Jin killed) |
| **34** | Lady Zou (邹氏) | —— | not one sentence in the record is something she said |

### Politics

| Value | Woman | Matching male anchor | Basis |
| --- | --- | --- | --- |
| **74** | Lady Wu (吴夫人) | Kan Ze 68 / Liu Biao 80 | 助治军国 is a stock phrase for the practical effect of taking part in government; no record of governing the people, no institutions, no works. **The summit of female politics** |
| **66** | Lady Bian (卞氏) | Kan Ze 68 | the ceiling of household-management evidence: frugality, refusing favours for her own family, and the rules of the Wei inner palace beginning with her |
| **56** | Lady Gan (甘夫人) | Cai Mao 52 | 管家事 and 常摄内事 are the only sample of household management carrying the text of an actual duty |
| **48** | Wang Yi / Fu Shou (伏寿) | Cai Mao 52 | one instance of managing finances to supply an army / twenty years as Empress with not one administrative achievement |
| **44** | Empress Dowager He | Cai Mao 52 | **held power and governed badly**, which is below "held power with no administrative achievement" |
| **34** | Lady Sun (孙夫人) | Han Dang 34 | 纵横不法 is counter-evidence on running a household |
| **26** | Da Qiao / Xiao Qiao / Lady Zou | Lü Bu 22 | not one character in the histories touches on government |

### Charisma

| Value | Woman | Matching male anchor | Basis |
| --- | --- | --- | --- |
| **85** | Diaochan (貂蝉) (*Romance*, assertion value) | Guan Ning 86 | the political consequence of the chain stratagem. **The ceiling for a *Romance* figure** |
| **78** | Lady Wu (吴夫人) | Lu Xun 76 / Zheng Xuan 90 | commanding not one soldier and holding not one office, she could stop her lord from killing — a rung-lower form of the Zheng Xuan type of evidence. **The summit for a woman in the official history** |
| **76** | Cai Yan (蔡琰) | Lu Xun 76 | the family standing of Cai Yong's daughter + Cao Cao ransoming her home with gold and jade (the hardest instance of "being courted") |
| **68** | Fu Shou (伏寿) | Yan Yan 62 | the family standing of the Fu clan, who transmitted the classics for nine generations, + the title of Empress; no attachment, no literati appraisal |
| **62** | Da Qiao / Xiao Qiao | Yan Yan 62 | an attestable name whose fame does not travel beyond the single commandery of Lujiang; **皆国色也 does not score** |
| **54** | Empress Dowager He / Wang Yi | Yan Yan 62 / Cai Mao 44 | a butcher's daughter, and hated by the realm / an entry of her own in the 《列女传》, but a name that does not travel beyond Liangzhou |
| **40** | Lady Zou (邹氏) | Cai Mao 44 | **the floor of this table**: no family standing, no literati appraisal, no attachment, and her story appears only in the form of someone else's blunder |

---

## 4. Three questions that must be answered

### Q1 · What should female might generally be? The floor, and the reason for it

> **No female-specific floor is set. The theoretical floor is still the 8 of Hua Tuo / Guan Ning;
> the actual lowest slot in this table is 10 (Da Qiao, Xiao Qiao, Lady Zou); and the median might
> of the 12 historical women is 14, exactly equal to the 14 of the male civil-official anchor Kan
> Ze.**

**First, a female-specific floor would be a double standard, not a correction.**
This dimension has exactly one evidence source: records of personal combat. Women having no such
records is the same fact as Hua Tuo(8), Guan Ning(8), Zheng Xuan(10), Kan Ze(14) and Xun Yu(22)
having no such records. Propping up a floor for women but not for those five men amounts to
declaring that this dimension does not apply to women — **and that is what would really shut them
out of military situations.**

**Second, "completely useless in a military situation" is the correct result, not a defect.**
When the engine resolves charging a formation, keeping order, or breaking out of an encirclement
using might, Cai Yan(16) is useless — and so is Hua Tuo(8). To make a person useful, use the
dimension where she has evidence: Lady Bian's intellect 66, Lady Wu's politics 74 and charisma 78,
Lady Gan's politics 56. **The whole point of a stat system is that "different people are useful on
different fronts", and propping up might is exactly what would destroy that.**

**Third, why the floor is 10 and not 8.**
8 is the slot for a purely technical figure with "no military experience of any kind in his life"
(Hua Tuo practised medicine all his life; Guan Ning lectured in Liaodong for thirty-seven years).
Da Qiao, Xiao Qiao and Lady Zou have not one record of bearing a weapon, but all of them lived
through a city falling and being seized, and through changing hands inside an army — they were
among soldiers, not in a study. **Those 2 points have to be explainable; if they cannot be
explained, it is propping up a floor.**

**Fourth, there is exactly one exception channel: explicit text of fighting in person.**
Wang Yi's 60 (亲犯矢石, from Huangfu Mi's (皇甫谧) 《列女传》 quoted in Pei's commentary to
《杨阜传》 (*Biography of Yang Fu*)) is the only exception among historical women; Lady Zhurong's 68
is the only exception among *Romance* figures.
**The channel is narrow, but it exists, and it was opened by the sources, not by a rule exemption.**

Actual distribution (the 12 historical women): `10, 10, 10, 12, 12, 14, 14, 16, 20, 30, 46, 60`.

### Q2 · For those known for talent and wit, like Cai Yan and Xin Xianying, can intellect enter the echelon of Xun You(92) and Cheng Yu?

> **Two answers, because "learning" and "foresight" are not synonyms in this system.
> Cai Yan stops at 72 and does not get in; Xin Xianying at 86 does get into the Ju Shou / Tian Feng
> band, but still does not reach Xun You's 92.**

**Cai Yan does not get in, and the reason is not her sex, it is the evidence.**
All the evidence there is: 博学有才辩 (widely learned, eloquent in debate), 妙于音律, and
默诵父书四百余篇文无遗误 (recited from memory over four hundred of her father's pieces without a
single error). That is learning and memory — **zero plans offered, zero predictions, zero ruses
seen through**. Section 1 of the parent document settles it: "wide reading with no record of
judgment (caps at the 65 band)". The same rule holds Kan Ze at 65 and Wang Can at 70 — Cai Yan
takes 72 on the strength of one extra item, 妙于音律 (which falls on this dimension's "writings and
arts" effect surface), 2 points apart from Wang Can.
**Giving her 90 would mean declaring that learning equals judgment, which would push all thirty-odd
scholars in the pool up with her and collapse the whole intellect ladder.**

**Xin Xianying does reach 86, because the evidence type and the number of instances are exactly the
same as Ju Shou's.**
Ju Shou's 86 rests on "first to propose receiving the Emperor, remonstrated against advancing
rashly, asked to split the army for a long war, warned to guard Wuchao — all three remonstrances
ignored and everything came out as he said". Xin Xianying predicted correctly three times, two of
them remonstrances:

1. 《辛毗传》 (*Biography of Xin Pi*), Pei's commentary citing 《世语》 (*Shiyu*): when Emperor Wen
   was made Heir Apparent he threw his arms round Xin Pi's neck and said 辛君知我喜不 (Master Xin,
   do you know how glad I am?); Xin Pi told his daughter, and Xianying sighed
   太子代君主宗庙社稷者也……而喜，何以能久！魏其不昌乎 (the Heir stands in for his lord over the
   ancestral altars; yet he is merely delighted — how can that last? Wei will not flourish)
2. At the Gaoping Tombs incident, her younger brother Xin Chang (辛敞), an army adviser to Cao
   Shuang (曹爽), asked his sister what to do; Xianying judged 司马公事不得已耳 (Lord Sima acted
   only because he had no choice) and 爽必不免 (Cao Shuang will not escape), and instructed him
   职守，人之大义也，唯宜如众人之为耳 (duty at one's post is a man's great obligation; simply do as
   everyone else does). Xin Chang went out, escaped the disaster, and was praised for it
3. Her son Yang Xiu (羊琇) became an army adviser to Zhong Hui (钟会) for the campaign against Shu,
   and Xianying said 会在事纵恣，非持久处下之道，吾畏其有他志 (Zhong Hui is unrestrained in office,
   which is no way to stay long in a subordinate place — I fear he has other designs), and Zhong
   Hui did indeed revolt

**Same class of evidence, the same three instances, the same vindication, so the same number — not
giving it would be the double standard.**

**But she does not reach Xun You's 92.**
The five-plus items behind Xun You's 92 (the twelve extraordinary stratagems, taking Lü Bu at
Xiapi, the plan at Baima that killed Yan Liang, the bait at Yanjin that killed Wen Chou, urging the
acceptance of Xu You which broke Wuchao) are all military stratagems that directly decided the
outcome of battles; Xianying's three predictions all concern the fortunes of individuals and do not
bear on the core of the "success or failure of stratagems" effect surface.
**The gap between 92 and 86 is "deciding a battle" versus "predicting what people will do", not
degree of cleverness.**

**Cheng Yu's 84 is also worth comparing.** Two of Cheng Yu's three items are predictions and one is
actually holding a city; Xin Xianying has three predictions and zero city defenses. The 2 points
between 86 and 84 is that Cheng Yu actually held a city and Xianying did not.
**That those 2 points can be stated clearly is what shows the ruler is the same one.**

> Xin Xianying is not among the 578 in `officers.json`. This table lists her as a **ladder
> yardstick** (`offRosterAnchors`) and writes her into no data file. The reason: if the female
> intellect dimension stops at Cai Yan's 72, a gap opens above 72, and that gap is caused by the
> roster, not by the sources. The suggestion to add her is P3 in section 9.

### Q3 · For figures like Da Qiao and Xiao Qiao, with almost no sources and mainly fame, how are the dimensions other than charisma set?

> **Charisma 62 (not raised on account of beauty); the other four are taken straight from the role
> baseline (后妃, consort) + the prominence 4 band + sparse, with no bonus of any kind: leadership
> 14 / might 10 / intellect 36 / politics 26. And the two have identical values across all five.**

**First, 皆国色也 does not score.** The charisma effect surface is three things — recruitment,
diplomacy, morale — and beauty has no attestable path of action on any of them. What scores is a
political consequence produced by beauty and recorded in the sources — which is exactly where
Diaochan's 85 comes from, while the two Qiao daughters produced no political consequence at all.

**Second, they still score on charisma, and it comes from family standing and from being courted.**
Daughters of Lord Qiao of Wan County, they appear in the main text of 《周瑜传》 (*Biography of Zhou
Yu*) — named in the official history; in 《江表传》 (*Record of the Jiang Region*) Sun Ce says to
Zhou Yu 桥公二女虽流离，得吾二人作婿，亦足为欢 (Lord Qiao's two daughters are refugees, but with the
two of us as their husbands they have reason enough to be glad), and being taken by the first and
second men of Jiangdong is a weak form of "being courted by several sides". Same band as Yan
Yan(62), "integrity, but a name that does not travel beyond one commandery" — the Qiao name
likewise does not travel beyond the single commandery of Lujiang.

**Third, why the other four may be taken mechanically.**
The track-B condition in 4.1 of the parent document is "the `historicalNote` really does equal all
the attestable evidence there is". That holds for them (the main text of 《周瑜传》 plus one line of
《江表传》 is the whole of it) and does not hold for Wang Yi or Lady Sun (Pei's commentary gives them
whole passages). **So running the pipeline on them is not laziness, it is the rule's own
applicability test.**

**Fourth, the two have identical values across all five dimensions, and that is a conclusion, not a
compromise.**
The sources treat them symmetrically — 两女 (the two daughters) in one and the same sentence,
吾二人作婿 in one and the same line of 《江表传》; apart from the sentence
策自纳大桥、瑜纳小桥 (Sun Ce took Da Qiao himself, Zhou Yu took Xiao Qiao) assigning who went to
whom, there is not one piece of evidence belonging to only one of them. Any distinction (say, "Xiao
Qiao was the cleverer, because of Zhou Yu") is reasoning backwards from the husband, which is
cross-contamination of evidence sources. **Giving them the same numbers is admitting that the
sources said only this much.**

**Fifth, the consequence on the engine side is the right one.**
On any panel they show as one bright point (charisma 62) and four dim ones.
**Someone whose sources hold nothing but fame should have only the fame dimension lit up.**
Raising their intellect to 60 as well would make players think the sources said they were clever —
the sources do not say one word of it.

---

## 5. The 15 at a glance

The values are the full five dimensions as 0–100 integers. Compressing them into tiers is the
engine's business; **the data layer does not pay for the observation layer's token budget.** The
per-person `statBasis` is in the `calibrationSet` of `officer-anchors-female.json`.

| id | Name | Ldr | Mgt | Int | Pol | Cha | Sum | p | Loyalty | Aptitude |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `bianshi` | Lady Bian (卞氏) | 52 | 30 | 66 | 66 | 74 | 288 | 3 | 100 Secure 安 | —— |
| `wufuren` | Lady Wu (吴夫人) | 34 | 20 | 74 | 74 | 78 | 280 | 3 | 30 At-risk 危 | —— |
| `wangyi_nv` | Wang Yi (王异) | 52 | 60 | 66 | 48 | 54 | 280 | 4 | 30 At-risk 危 | siege defense 守城 |
| `sunshi_nv` | Lady Sun (孙夫人) | 50 | 46 | 52 | 34 | 66 | 248 | 3 | null | —— |
| `caiyan` | Cai Yan (蔡琰) | 20 | 16 | 72 | 46 | 76 | 230 | 3 | null | —— |
| `zhurongfuren` | Lady Zhurong (祝融夫人) ▲ | 54 | 68 | 30 | 22 | 54 | 228 | 4 | 85 Wavering 疑 | mountain 山地 |
| `wuguotai` | Wu Guotai (吴国太) ▲ | 20 | 12 | 52 | 46 | 68 | 198 | 4 | null | —— |
| `fushou` | Fu Shou (伏寿) | 18 | 12 | 48 | 48 | 68 | 194 | 3 | null | —— |
| `liubei_gan` | Lady Gan (甘夫人) | 26 | 14 | 36 | 56 | 56 | 188 | 4 | 85 Wavering 疑 | —— |
| `diaochan` | Diaochan (貂蝉) ▲◆ | 5 | 8 | 62 | 20 | 85 | 180 | 2 | 80 Wavering 疑 | —— |
| `yanshi` | Lady Yan (严氏) | 24 | 14 | 52 | 42 | 46 | 178 | 4 | 85 Wavering 疑 | —— |
| `hetaihou` | Empress Dowager He (何太后) | 24 | 12 | 40 | 44 | 54 | 174 | 4 | null | —— |
| `qiaoshi_da` | Da Qiao (大桥) | 14 | 10 | 36 | 26 | 62 | 148 | 4 | null | —— |
| `qiaoshi_xiao` | Xiao Qiao (小桥) | 14 | 10 | 36 | 26 | 62 | 148 | 4 | null | —— |
| `zoushi` | Lady Zou (邹氏) | 14 | 10 | 34 | 26 | 40 | 124 | 4 | 85 Wavering 疑 | —— |
| —— | Xin Xianying (辛宪英) ★ | 30 | 14 | 86 | 62 | 70 | 262 | (3) | null | —— |

▲ `fictional: true`; `statBasis` begins with 演义形象：, and C14 applies
◆ the five dimensions are taken from the parent file's `calibrationSet`, **not a character changed**
★ not in `officers.json`; a ladder yardstick only, written into no data file

### A few worth singling out

**Lady Wu is the double summit of charisma and politics in this table (78 / 74), highest in the
whole table on both dimensions.**
(The highest five-dimension sum in this table is Bian Shi (卞氏) at 288, not Lady Wu — she is at
280, tied with Wang Yi (王异). The original text read "the highest sum in this table (280)", which
directly contradicted the table immediately above it; corrected.)
Her charisma of 78 rests on "commanding not one soldier and holding not one office, she could stop
her lord from killing": Sun Ce wanted to execute the Merit Evaluator Wei Teng (魏腾), and the Lady
leaned over the great well and said 若杀魏腾，明日皆叛。我今日先投此井中耳 (kill Wei Teng and
tomorrow they will all revolt; I shall throw myself into this well first, today), and Sun Ce
released him at once. **This is a rung-lower form of the same evidence class as Zheng Xuan(90) —
"commanding not one soldier and not one commandery, and the Yellow Turbans agreed not to enter his
county": Zheng Xuan stopped tens of thousands of Yellow Turbans, Lady Wu stopped one killing.**

**Wang Yi is the double summit of female leadership and might, and the only person in this table
held down by a total-sum constraint.** See section 6.

**Lady Sun demonstrates how negative evidence is used.** She had over a hundred armed retainers
(《法正传》), so leadership is 50; but 《云别传》 writes plainly 多将吴吏兵，纵横不法 (she brought
many Wu officers and soldiers with her, and they ran riot outside the law), and the First Lord
specially appointed Zhao Yun to take charge of internal affairs as a guard against it — in the
politics dimension the same fact is **counter-evidence** on running a household, pressing it down
to 34. **What this system recognises is whether the retainers existed (leadership), not whether
they were well governed (politics); the two dimensions take different facts out of the same passage
of source material, and that is exactly what orthogonality should look like.**

**Lady Bian is the one place in this table where evidence is allowed to cross two dimensions.**
The sentence she spoke when the report of Cao Cao's death arrived contains two **separable** facts
at once: 使从者不去 (she kept the followers from leaving — an organisational result → leadership 52)
and 吉凶未可知 (whether the news is good or ill cannot yet be known — a judgment → intellect 66).
This exception is already marked in her `note`, and `FV7` records it on file as the only one.

**Empress Dowager He is the only person in this table with negative intellect evidence.**
The 《皇后纪》 (*Annals of the Empresses*) records only two things: poisoning Lady Wang (王美人),
and He Jin asking to execute all the eunuchs while 太后不听 (the Empress Dowager would not listen),
after which He Jin was killed, the capital fell into chaos, and Dong Zhuo entered Luoyang.
**A remonstrance refused and borne out in reverse** — the parent document says "a remonstrance
ignored and then borne out" is the strongest class of intellect signal, and the reverse is just as
strong, only with the opposite sign. Her politics of 44 is below Cai Mao's 52, and the gap is
exactly "held power with no administrative achievement" versus "held power and governed badly".

---

## 6. Two criterion mismatches: what `certainty` and `prominence` mean when applied to women

This section is the most important methodological finding of this round of work.

### For women, `certainty: sparse` does not mean "the evidence is scarce"

9 of the 15 women in `officers.json` are marked `sparse`. But look at their `historicalNote`:

> Lady Sun: ……**史不载其名**，尚香之名出后世戏曲小说。 (the histories do not record her name; the
> name Shangxiang comes from later opera and fiction)
> Lady Wu: ……**名不详**。 (her name is unknown)
> Lady Gan: ……**名与字皆不详**。 (neither her name nor her courtesy name is known)
> Lady Yan: ……**姓氏见裴注，名不详**。 (her surname appears in Pei's commentary; her given name is
> unknown)
> Lady Zou: ……**姓氏见裴注，名不详**。 (her surname appears in Pei's commentary; her given name is
> unknown)

**For this group, `sparse` marks "the name was not recorded", not "the evidence is scarce".**
Lady Sun has whole passages in 《法正传》, 《先主传》 (*Biography of the First Lord*) and 《云别传》,
a stock appraisal of her character, and specific actions; she is marked `sparse` only because the
histories did not write down what she was called. That is a product of late-Han writing convention
and has nothing to do with evidence density.

**The consequence is concrete:** 4.1 of the parent document routes `prominence ∈ {3,4}` with
`certainty == sparse` onto the track-B mechanical pipeline, and track B presupposes "the
`historicalNote` really does equal all the attestable evidence there is". That premise **does not
hold** for Lady Sun, Wang Yi or Lady Yan. Run through track B, Lady Sun's might would fall below 29
(the +18 cap on keyword adjustment binds) and Wang Yi's leadership would fall to around 30 — **and
anyone who has read Pei's commentary to 《杨阜传》 would see at a glance that those two numbers are
wrong.**

**Handling: all 15 people in this table go on track A (`statTrack: "anchor"`), with the reason
written here.** The `certainty` field in `officers.json` is not changed — that is someone else's
file, and changing it would affect other rules.

### `prominence: 4` is a mislabel on Wang Yi

`prominence 4` is defined as "name only", 223 people pool-wide. Wang Yi has an entry of her own in
Huangfu Mi's 《列女传》, quoted in full in Pei's commentary, with her name (Yi), her husband (Zhao
Ang 赵昂), her sons, her actual words and two separate incidents all set out in detail — **she is
not a name only.**

The consequence is that both of C15's ceilings bind hard on her:

- every dimension ≤ 72: does not bind (her highest is 66)
- **sum of the five ≤ 280: binds exactly.** Four of her five dimensions have explicit textual
  evidence, yet the total pushes her back down to 280.

**This table's handling is to obey the rule.** Until `prominence` is changed, take legal values
under C15 (52/60/66/48/54, sum 280), **request no named exemption in `ceilingOverrides`**, and
record the dispute in `proposals.P1`. The reasons:

> Guan Ning's exemption is legitimate because the blind spot "making a name by not acting" cannot
> be fixed by changing the data — by the length criterion his `prominence` really ought to be 3.
> Wang Yi is different: her `prominence` is simply mislabelled, and fixing the data is cleaner than
> opening an exemption. **Keeping the "exception permitted" list short is itself worth something.**

If `prominence` is changed to 3, Wang Yi should instead take **58/64/68/54/62 (sum 306)**, and the
other 14 are unaffected.

### The 后妃 role baseline does not change

The 后妃 (consort) row in `derivation.steps[0].table` is `[24, 16, 46, 34, 60]`, often suspected of
being the source of women being held down. After checking item by item, this table holds that it
**is right**: it accurately encodes the default state of "no military action, no administrative
achievement, a recognised title", and charisma 60 really is the highest default dimension for this
group. **The real cause of the bottoming out is the two criterion mismatches above, not the
baseline. Changing the baseline would lift the people with no evidence along with everyone else,
and that is padding.**

---

## 7. A gap in the loyalty formula

The `loyalty.modifiers` in `officer-anchors.json` have 13 entries, and L+1's condition is:

> Same clan as the lord (same surname and `roles` containing 宗室/外戚, or `historicalNote`
> explicitly saying 子/弟/兄/从弟/从子/族弟 — son / younger brother / elder brother / cousin /
> nephew / clan brother)

**Every one of them is an agnatic male relative; there is not a single entry for a spouse or a
mother-son relationship.**
Lady Bian to Cao Cao, Lady Gan to Liu Bei, Lady Yan to Lü Bu, Lady Zou to Zhang Ji (张济) — under
the current clauses not one modifier matches them, so they can only take the base 60 (Wavering).
That is a coverage gap in the formula, not these people really being only 60.

**Proposal P2: add L+1F — a spousal or mother-son relationship with the lord, +25.**

This table already computes with L+1F:

| Person | Calculation | Tier |
| --- | --- | --- |
| Lady Bian (卞氏) | 60 + 25(L+1F) + 20(L+2: followed Cao Cao east when the Dong Zhuo troubles broke out — with him from the time of hardship) = 105 → clamp **100** | Secure 安 |
| Lady Gan (甘夫人) | 60 + 25(L+1F) = **85** (no L+2: she was taken in at Xiaopei, not from the first raising of troops) | Wavering 疑 |
| Lady Yan / Lady Zou / Lady Zhurong | 60 + 25(L+1F) = **85** | Wavering 疑 |
| Diaochan (貂蝉) | 60 + 20(L+2: in the *Romance* they swore to die together) = **80** | Wavering 疑 |

**If P2 is not adopted, the first five each lose 25 → 75/60/60/60/60**, their tiers go from
"Secure / Wavering" to all "Wavering", and everyone else is unaffected. Before adopting it,
enumerate how many on the male side the clause would match (those who married a princess, the
lord's sons-in-law) and recheck the three-tier shares in V8.

### Two women who land in the "at-risk" tier

**Lady Wu 30 (at-risk):** 60 − 30 (L−2: she actually follows Sun Ce and the Sun house, while
`affiliation194` lists her under Yuan Shu).
**She has the same value as Cheng Pu, Huang Gai, Han Dang and Zhu Zhi**, and falls with them into
the "at-risk" cluster on the Yuan Shu seat. The parent document says "the Yuan Shu seat has drama
built into it" — **and with Lady Wu added it has more: the model taking over Yuan Shu holds not
only an elite force that is not its own, but that elite force's mother.**

**Wang Yi 30 (at-risk):** 60 − 30 (L−2: her husband Zhao Ang was a subordinate official in the
Liangzhou Inspector's office, of the same party as Yang Fu (杨阜) and Jiang Xu (姜叙), while
`affiliation194` lists her under Ma Teng). She is a person on the Ma Teng seat who does not belong
to Ma Teng, the same type as Sun Jian's old officers.

**Neither of these was designed; both are what the rules produce when they land on historical
fact.**

---

## 8. Empirical distribution: are women being systematically discounted

> If women are being systematically discounted, all five dimensions should come out low together;
> if the evidence surface is merely narrow, only the dimensions with no evidence should come out
> low. **This can be settled with numbers.**

15 people × 5 dimensions = 75 values.

| Dimension | Female mean | Female median | Range | Against the whole pool |
| --- | ---: | ---: | --- | --- |
| Leadership | 28.1 | 24 | 5–54 | **Clearly below the pool.** Only 1 of the 12 historical women has explicit text of organising a city's defense |
| Might | 22.8 | 14 | 8–68 | **Clearly below the pool.** Only 1 explicit text of fighting in person. Median 14 = Kan Ze(14) |
| Intellect | 50.4 | 52 | 30–74 | **Level with the pool.** 70+ share 13.3% vs the pool's 11.7% — slightly higher, even |
| Politics | 41.6 | 44 | 20–74 | **Slightly below the pool.** 60+ share 13.4% vs 33.4%, because most of them have no administrative achievement |
| Charisma | 62.9 | 62 | 40–85 | **Above the pool.** 70+ share 26.7% vs 13.7%, nearly double |

The key number: **15 of the 75 values fall in the 0–19 band (20.0%, against a pool target of 1.8%).
All 15 come from leadership (5) and might (10); intellect, politics and charisma have not one
between them.**

> **Conclusion: women are not being systematically discounted; their evidence surface is narrow.**
> On the three dimensions where evidence exists they are level with the pool (charisma is higher),
> and the bottoming out happens only on the two dimensions where the evidence really is zero. This
> is exactly what "the same scale" should look like: **lay the same ruler down, and more measured
> means a higher score, less measured means a lower one, regardless of who is being measured.**

The mean of the 15 people's five-dimension sums is 205.7, below the pool target mean of 240–265.
Almost all of the shortfall comes from leadership and might (the women's combined mean on those two
is 50.9, against roughly 110 pool-wide). **This shortfall is not corrected** — correcting it could
only be done by padding leadership and might.

---

## 9. Separate tracks for history and the *Romance*

The three with `fictional: true` (Diaochan, Wu Guotai, Lady Zhurong) have `statBasis` beginning
with 演义形象：, and C14 applies (every dimension ≤85, sum of the five ≤320). Their sums are
180 / 198 / 228, all far below the ceiling.

**The hard case is not those three, it is Lady Sun.** She is `fictional: false`, but later opera
and the *Romance* created a separate "Sun Shangxiang (孙尚香)", and the two are two different
figures:

| Item | Source | Counted in the values |
| --- | --- | --- |
| 才捷刚猛，有诸兄之风 (quick-witted, bold and fierce, with the manner of her brothers) | 《三国志·蜀书·法正传》 (*Records of the Three Kingdoms*, Book of Shu, *Biography of Fa Zheng*) | **Counted** (the sole basis for might 46) |
| 侍婢百余人，皆亲执刀侍立 (over a hundred maidservants, all standing in attendance with blades in hand) | same as above | **Counted** (leadership 50) |
| 多将吴吏兵，纵横不法；先主置赵云掌内事 (she brought many Wu officers and soldiers, who ran riot outside the law; the First Lord put Zhao Yun in charge of internal affairs) | 《云别传》 cited in Pei's commentary | **Counted** (the negative basis for politics 34) |
| 权稍畏之，进妹固好 (Sun Quan came to fear him somewhat, and offered his sister to cement relations) | 《先主传》 | **Counted** (charisma 66) |
| Weapons arrayed in her chamber, in a standoff with Liu Bei | *Romance* | **Not counted** |
| Intercepting the boat to seize Adou, rebuking the Wu generals into retreat | *Romance* | **Not counted** |
| On news of the defeat at Yiling, gazing west and drowning herself for her husband | later opera | **Not counted** |

**Counted by the *Romance*, her might would rise to 68–72, leadership 58, charisma 74. This table
adopts none of it.** The reason: in `officers.json` she is `fictional == false`, so her values must
draw their evidence from the official history; once two evidence sources are mixed on one record,
the discipline of "separate tracks for history and the *Romance*" ceases to exist.
**If the engine ever needs a *Romance* scenario, the correct move is to create a separate
`fictional: true` record for "Sun Shangxiang", not to raise this one.**

The same discipline explains a divergence in the other direction: **Lady Zhurong's might of 68 is
below *Romance* consensus.** She is `prominence 4`, and C15 holds every dimension below 72.
**The divergence is recorded as it stands in her `statBasis`, not nudged toward consensus.**

### Lady Wu vs Wu Guotai

One and the same *Romance* function (the senior female arbiter of the Sun house) splits into a
historical person and a fictional one: the historical one gets 280, the fictional one 198.
**The 82-point gap is the price of "has her own biography" versus "never existed".**

---

## 10. Cross-constraint self-check

Checking the 15 item by item against C1–C16 and V1–V11 of the parent document: **all pass, 0
exceptions.**

| Constraint | Result |
| --- | --- |
| C1 sum ≤441 | highest 288 ✓ |
| C2/C3 scarcity at the top | nobody ≥380 ✓ |
| C5 at most 2 dimensions ≥90 | nobody has any dimension ≥90 ✓ |
| C6 at least one dimension ≤72 | 15/15 ✓ |
| C7 might ≥88 and politics ≥78 | nobody has might ≥88 ✓ |
| C10 / C11 / C13 | nobody triggers them ✓ |
| C12 scholar-general / fierce-warrior | the largest leadership−might gaps are Lady Bian 22 and Wang Yi 8, **both short of the 25/20 trigger lines** ✓ |
| C14 *Romance* figures ≤85 / sum ≤320 | 180/85, 198/68, 228/68 ✓ |
| C15 p4 every dimension ≤72 / sum ≤280 | 9 people; highest dimension 66 (Wang Yi), highest sum 280 (Wang Yi, **exactly at the ceiling**) ✓ |
| prominence ceiling | p2 max 85≤93, p3 max 78≤83, p4 max 68≤72 ✓ |
| V1 forbidden words | 0 ✓ |
| V2 dimensions ≥85 and ≤25 have primary-text evidence | 15/15 ✓ |
| V5 Diaochan == parent `calibrationSet` | 5/8/62/20/85, exactly identical ✓ |
| **V11 values over a ceiling** | **0 of them; no named exemption needed** ✓ |

### How C12 was avoided is worth saying

Lady Wu could have been given leadership 52 (her biography's 助治军国 contains the character 军),
which would have made the leadership−might gap 32 and triggered C12, while her `roles` contain only
后妃, a role not on the whitelist (谋略/内政).

**The handling is to let the evidence fall where it belongs, not to amend the constraint.**
By evidence discipline 助治军国 goes to the **politics dimension** (74), leaving leadership with
only the single consultation 引见张昭董袭问江东可保, which gives 34.
**Reassigning the evidence fits the orthogonality principle better than amending a constraint, so
this table requests no change to C12.**

---

## 11. Stated plainly: where this is uncertain

1. **Layers one and two of "the same scale" are verifiable; layer three is statistics, not proof.**
   The empirical distribution can only show that women have not been pushed down as a group; it
   cannot prove that every individual value sits in the right place. **The real acceptance test is
   to interrogate the 15 gap rows of `sameScaleCheck` one by one — this table only stands if those
   15 rows hold up under questioning.**

2. **Xin Xianying's 86 is the largest single-point risk in this table.**
   It rests on the equivalence judgment "three predictions all correct == Ju Shou's three
   remonstrances all borne out". If one holds that "a remonstrance ignored and then borne out" is a
   stronger signal than "predicting without remonstrating", she should come down to around 82–84.
   This table adopts the equivalence, on the grounds that two of her three are also remonstrances
   (instructing Xin Chang to leave the city, warning Yang Xiu away from Zhong Hui) rather than pure
   bystander prophecy. **That reason can be rebutted, and if it is rebutted the number should
   change.**

3. **Lady Sun's might of 46 is the vaguest number in this table.**
   Whether 才捷刚猛，有诸兄之风 counts as a "stock appraisal of valor" has no objective
   adjudication. This table treats it as a weak form (not at the level of 勇冠 or 万人敌) and places
   it below Cheng Yu's 48. The reasonable range of dispute is 40–56.

4. **The `certainty` and `prominence` criterion mismatches were handled only on these 15; the whole
   pool was not swept.** The same kind of problem very likely exists for a group on the male side
   as well (figures in appended biographies, those who appear only in Pei's commentary).
   **This table does not reach beyond its scope to handle them, but records the finding here.**

5. **L+1F's +25 was copied from L+1 and has not been validated in play.**
   Whether the loyalty strength of a spousal relationship really equals that of agnatic kinship is
   design intent only. In particular, Lady Bian enters the "Secure" tier because of it (cannot be
   turned), which affects one card on the Cao Cao seat.

6. **This table sets up no aptitude tag specific to women.**
   Of the six tags (mountain / naval / siege attack / siege defense / governing the people /
   envoy), the 15 match only 2 (Wang Yi [siege defense], Lady Zhurong [mountain]), and 13 have no
   tag. Not one of the tier1 keywords of the "governing the people" tag is matched by any woman —
   **the words 屯田, 劝农, 水利 really do not appear in their biographies.** That is one more
   expression of the narrow evidence surface, and this table adds no tag clause on account of it.

7. **Two clauses were added to Diaochan's `statBasis`.**
   The parent document's example wrote only three dimensions — charisma, might, intellect — while
   V2/V4 require any dimension ≤25 to state its basis, and both her leadership 5 and her politics
   20 trigger that. **What was added is the basis; the five values were not altered by a
   character.**

---

## Appendix: what this document does not do

- **It does not change `officers.json`.** The two criterion mismatches on `prominence` and
  `certainty` are recorded as proposals (P1, P3).
- **It does not change `officer-anchors.json`.** The L+1F clause is recorded as a proposal (P2),
  and not one `ceilingOverrides` entry is requested.
- **It writes no data for Xin Xianying, Jiang Xu's mother, or Pang Eqin (庞娥亲).** Values should
  be set after they enter the pool; this table supplies a ladder-yardstick value for Xin Xianying
  only, because without her the female intellect ladder is missing a stretch of examples.
- **It touches nobody in the other 8 batches.** This table is responsible only for the 15 women.

<!-- translated-from: OFFICER-ANCHORS-FEMALE.md@1593851add96 -->
