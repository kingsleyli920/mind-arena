[中文](OFFICER-ANCHORS.md) · [English](OFFICER-ANCHORS.en.md)

# The Five-Dimension Anchor System

Generated: 2026-08-31
Companion data: `lib/game/data/officer-anchors.json`
Applies to: the 578 people in `lib/game/data/officers.json`
Methodology prerequisite: `docs/research/OFFICER-STATS-DESIGN.md`
Engine interface: `docs/GAMEPLAY-DESIGN-V2-DELTA.en.md` R29–R32

---

## 0. What problem this document solves

The 578 people in `officers.json` have only historical fields, not a single game stat. To fill
in the numbers, three roads are open:

**Copy Koei's stat tables wholesale.** Thirty years of player consensus really is encoded in
those tables, but transcribing them entry by entry amounts to copying someone else's compiled
database, which is a risk for a commercial project. Section 3 E of `docs/RESEARCH-2026-08-31.en.md`
already lists the stat tables under "explicitly off limits".

**Build a fully automatic evidence-counting pipeline from scratch.** `OFFICER-STATS-DESIGN.md`
designed this road: tag the primary text of *Records of the Three Kingdoms* (三国志) against an
evidence coding table, then weight, shrink and map to quantiles. Its reproducibility is the best
of the three, but the evidence database (`officer-evidence.jsonl`) has to be built first, the cost
is counted in person-days, and the first round of criteria is certain to need rework.

**Anchor comparison.** First establish, for each dimension, anchor figures everyone knows, with
fixed values and source citations; then position everyone else by "stronger than whom, weaker than
whom, and on what evidence in which dimension".

This document takes the third road. It is not a replacement for the second, it is a prerequisite
for it — **the anchor table is simultaneously the acceptance assertion for the fully automatic
pipeline** (the "anchor regression test" in `OFFICER-STATS-DESIGN.md` 4.9). If the pipeline is ever
run, the anchor values are the target it must hit, not its input.

The numbers produced must satisfy two conditions at once: someone familiar with the Three Kingdoms
finds them broadly reasonable; and every value can state its basis.
**No unexplainable number is allowed.**

---

## 1. The five dimensions defined

The dimension names follow industry convention; their meanings are defined by the effect surfaces
in Koei's official manuals (recorded in section 4 of `RESEARCH-2026-08-31.en.md`). Note:
**reusing the definition of an effect surface is not the same as reusing its numbers** — the former
is common industry vocabulary, the latter is the protected product.

| Dimension | Field | Effect surface | Evidence only from here | Never from here |
| --- | --- | --- | --- | --- |
| Leadership 统率 | `leadership` | troop attack and defense, marching, keeping supply | authority to command troops and its scale; wins and losses in battles fought as commander-in-chief; records of disciplining an army; stock appraisals of generalship (将才定型评) | personal combat (goes to might), offering stratagems (goes to intellect), civil office rank (goes to politics) |
| Might 武力 | `might` | individual combat power, charging through a formation, keeping public order | killing or capturing an enemy general with one's own hands; 先登陷阵 (first over the wall, breaking the enemy line); stock appraisals of valor; physique and weapon specialty | "his troops won the fight", height of office |
| Intellect 智力 | `intellect` | success or failure of stratagems, seeing through deception, technology | a proposed plan borne out; a remonstrance ignored and then borne out; seeing through a double agent; mechanical and engineering skill; writings and calendrical arts | wide reading with no record of judgment (caps at the 65 band) |
| Politics 政治 | `politics` | land reclamation, commerce, efficiency of domestic administration | stock phrases for administrative achievement (治绩定型语); production works; rank of civil office; laws and institutional achievements | great fame (goes to charisma), wide reading (goes to intellect) |
| Charisma 魅力 | `charisma` | recruitment, diplomacy, morale | explicit text of gentry and commoners attaching themselves; appraisal by a famous literatus; family standing; recommendation and summoning to office (察举征辟); being courted by several sides | being good at fighting, holding high office |

The two right-hand columns are the skeleton of the system. **Orthogonality is guaranteed first by
"the evidence sources do not overlap", and only secondly by a correlation check after the fact.**
Leadership draws evidence only from records of commanding troops, might only from records of
personal combat; the two evidence sets are disjoint, so the correlation coefficient comes down by
itself. Mixing the evidence first and adjusting the scores afterwards is papering over collinearity.

### Naming differences from OFFICER-STATS-DESIGN.md

That document uses 统率 / 武勇 / 谋略 / 政务 / 名望 (leadership / valor / stratagem / administration /
renown). The effect surfaces are broadly the same, the cuts slightly different (its 谋略 excludes
technology, which is folded into special skills). **The naming in this document governs**, because
the engine side R29–R32 and the follow-up batches all wire up to these names, and keeping two sets
of names alive only creates translation cost.

### Division of labour between the data layer and the observation layer

The data layer stores the **full five dimensions as 0–100 integers**. At observation time the
engine compresses them per R29 into three dimensions × 5 tiers, then attaches the R30 aptitude tags
and the R31 three loyalty tiers.

**The data layer does not pay for the observation layer's token budget.** Compression is the
engine's business. Two reasons: first, once a value is squeezed into 5 tiers it can never be
recovered, and any downstream task needing fine comparison (battle-report attribution, balance
regression, name-swap control tests) becomes impossible; second, the thresholds of the tier mapping
will certainly be retuned later, and retuning thresholds should change one constant table in the
engine, not require rerunning the data for 578 people.

---

## 2. Five anchor ladders

Eight rungs per dimension, covering the full range from top to bottom. **Anchor values are
assertions, not suggestions** — later batches may not change them, and CI should run them as a
regression test.

### Discipline for assigning the summits

The ceiling of 100 goes only to the historically first-ranked person in that dimension, and at most
one person per dimension reaches 97+. What this works out to:

| Dimension | Summit | Value | Why this number |
| --- | --- | --- | --- |
| Might | Lü Bu (吕布) | **100** | The only "first in a dimension" in the whole Three Kingdoms uncontested both in the stock appraisals of the sources and in thirty years of player consensus. 《吕布传》 (*Biography of Lü Bu*): 便弓马，膂力过人，号为飞将 (skilled with bow and horse, strength beyond other men, styled the Flying General), plus 辕门射戟 (the arrow shot at the halberd by the camp gate), plus the contemporary saying 人中有吕布 (among men there is Lü Bu). **The only dimension where a 100 is given** |
| Leadership | Cao Cao (曹操) | 97 | 《武帝纪》 (*Annals of Emperor Wu*) appraises him as 该韩、白之奇策 (combining the extraordinary stratagems of Han Xin and Bai Qi). **No 100**: the three major defeats he commanded in person — Chibi, Hanzhong, Wancheng — are right there, and "first at commanding troops" has no unique answer in the Three Kingdoms |
| Politics | Zhuge Liang (诸葛亮) | 98 | The appraisal in his own biography is the longest and most specific passage on governance in all of *Records of the Three Kingdoms*, closing with 管、萧之亚匹 (second only to Guan Zhong and Xiao He) |
| Charisma | Liu Bei (刘备) | 97 | 盖有高祖之风，英雄之器焉 (he had something of the manner of Gaozu, the stature of a hero) — the only appraisal of winning men's hearts in the whole book that likens its subject to Gaozu of Han |
| Intellect | Zhuge Liang | 96 | **No 97+ in this dimension, and the ceiling is nailed shut.** Reasons below |

Why the intellect dimension has no 97+ is worth a separate note. Zhuge Liang has three
non-overlapping pieces of hard evidence here: the primary text of his biography,
性长于巧思，损益连弩、木牛流马，皆出其意 (by nature given to ingenious craft; the repeating crossbow
and the wooden ox and gliding horse all came from his ideas) — technology is one of this
dimension's official effect surfaces, and he is the only top-tier figure in the whole Three
Kingdoms with an explicit record of inventing devices; the strategic foresight of the Longzhong
Plan (隆中对); and the judgment of 识治之良才 (a fine talent who understood government). But Chen
Shou (陈寿) also writes plainly in the same chapter 应变将略非其所长 (adapting to circumstance and the
arts of generalship were not his strong suit) — and that sentence bears directly on the effect
surface "success or failure of stratagems". For a man who is first in two of the three effect
surfaces of one dimension while the author of his own biography names the third as a weakness,
giving 96 and sealing the ceiling stands up to questioning better than giving 100.

**Cao Cao is the only person in the whole pool with three dimensions ≥90** (leadership 97 /
intellect 92 / charisma 92). This is not special treatment, it is a fact the data has to admit —
the Three Kingdoms really did have one such man. For everyone else the cap on dimensions ≥90 is 2.

---

### Leadership `leadership`

| Value | Anchor | Basis | Same band |
| --- | --- | --- | --- |
| **97** | Cao Cao (曹操) | Commanded in person for over thirty years: Guandu, where the few broke the many; Mount Bailang; Weinan, where he broke the ten Guanzhong factions by sowing discord. 《武帝纪》: 该韩、白之奇策 | —— |
| **92** | Zhou Yu (周瑜) | At Chibi he met Cao Cao's nominally vast host with thirty thousand and won outright; then drove Cao Ren out of Nan Commandery; one battle settled a state's fate. 5 points below Cao Cao: far fewer battles under independent command, and only four years of theater command | Sima Yi (司马懿) 93, Lu Xun (陆逊) 92, Guan Yu (关羽) 90 |
| **88** | Zhang Liao (张辽) | Eight hundred broke a hundred thousand at Xiaoyao Ford; at Mount Bailang he cut down Tadun in the field. On single-battle achievement he reaches the 90 band, but he was always under unified Cao-Wei command | Zhuge Liang (诸葛亮) 88, Deng Ai (邓艾) 88, Lu Kang (陆抗) 88 |
| **83** | Cao Ren (曹仁) | Held Fancheng unmoved through Guan Yu's siege after the flooding of the seven armies; also lost Nan Commandery. **The positioning value for a "first-rate army commander"**: held independent theater command, with both victories and defeats on record | Zhang He (张郃) 83, Xu Huang (徐晃) 83, Xiahou Yuan (夏侯渊) 82 |
| **74** | Gao Shun (高顺) | The Xianzhen Camp (陷陈营) of just over seven hundred men: 攻无不破 (attacked nothing it did not break), 清白有威严 (upright and commanding respect) — Pei Songzhi's commentary citing 《英雄记》 (*Record of Heroes*). His discipline and his results reach the 83 band, but **he never had a thousand men and never held theater command**. **The ceiling for an "elite small-unit commander"** | Xu Rong (徐荣) 76, Yue Jin (乐进) 76 |
| **62** | Han Dang (韩当) | A veteran through three generations of the Sun house, meritorious on campaign under his commanders, **with no explicit text of any battle he commanded independently**. The median for a "competent subordinate officer" — has troops to lead, will not lead them off a cliff, and has never led anything worth recording | Zhu Zhi (朱治) 60, Huang Zu (黄祖) 60 |
| **48** | Xun Yu (荀彧) | Holding Juancheng was a civil official keeping his head in a crisis, not commanding troops. Cao Cao left Xun Yu at the centre on every campaign, which is precisely the point: his place was not with the army | Zhang Zhao (张昭) 46, Chen Qun (陈群) 40 |
| **12** | Hua Tuo (华佗) | A purely technical figure, with no military record of any kind in his life. **The floor of the leadership dimension** | Guan Ning (管宁) 12, Zheng Xuan (郑玄) 15 |

The decisive cut is at the 74 rung. By consensus Gao Shun rates high; by the sources he has seven
hundred men and two victories. **The rule is "no evidence of theater command, no theater-command
number"** — and this is directly why the system visibly diverges from commercial games on a group
of people (Gao Shun, Zhao Yun (赵云), Huang Zhong (黄忠), Taishi Ci (太史慈)). That is intentional,
not a bug.

### Might `might`

| Value | Anchor | Basis | Same band |
| --- | --- | --- | --- |
| **100** | Lü Bu (吕布) | 便弓马，膂力过人，号为飞将; 辕门射戟; 人中有吕布，马中有赤兔 (among men there is Lü Bu, among horses Red Hare) | —— |
| **96** | Guan Yu (关羽) | 策马刺良于万众之中，斩其首还，绍诸将莫能当者 (he rode into the host, stabbed Yan Liang, took his head and returned; none of Yuan Shao's generals could stand against him) — **the only explicit text in the whole book of killing an enemy commander-in-chief in the midst of a host**; Cheng Yu (程昱) said 关羽张飞皆万人敌 (Guan Yu and Zhang Fei are each a match for ten thousand) | Zhang Fei (张飞) 95, Ma Chao (马超) 93, Dian Wei (典韦) 93, Xu Chu (许褚) 92 |
| **88** | Zhao Yun (赵云) | 身抱弱子，保护甘夫人 (carrying the infant in his arms, protecting Lady Gan) and the empty camp on the Han River that drove the enemy off **both come from 《云别传》 (*Separate Biography of Zhao Yun*) cited in Pei's commentary, not from the primary text of his own biography**. One rung lower in evidence class, and the thousand-odd characters of his biography hold no text of him personally killing a general | Huang Zhong (黄忠) 89, Gan Ning (甘宁) 88, Zhang Liao (张辽) 87, Taishi Ci (太史慈) 86, Wei Yan (魏延) 86 |
| **80** | Cao Ren (曹仁) | Fond of bow and horse in youth; led a few dozen riders out through an encirclement and back in again to rescue the rest. **The coordinate for "an army commander who can fight in person"** | Xiahou Yuan (夏侯渊) 84, Zhang He (张郃) 82, Xu Huang (徐晃) 80, Ma Teng (马腾) 80 |
| **74** | Yu Jin (于禁) | 最号毅重 (reckoned the most resolute and steady); took part in person in suppressing the Qingzhou troops and in the execution of Chang Xi; no explicit text of personal combat. **An ordinary general who can fight**: has been in the line, can take it, with no personal feat worth recording | Han Dang (韩当) 76, Wen Pin (文聘) 74, Yan Yan (严颜) 74, Guo Si (郭汜) 72 |
| **62** | Huang Zu (黄祖) | Led troops for a long time with no record whatever of personal valor or of fighting in person. **The coordinate for someone with military experience but no evidence of personal prowess** | Li Dian (李典) 64, Liu Bei (刘备) 70, **Cao Cao (曹操) 72** |
| **34** | Jia Xu (贾诩) | Changed masters repeatedly in a chaotic age and came through whole; accompanied armies but has not one record of crossing blades | Chen Gong (陈宫) 34, Liu Biao (刘表) 38, Zhuge Liang (诸葛亮) 40, Xun Yu (荀彧) 22 |
| **8** | Hua Tuo (华佗) | **The floor of the might dimension.** Civil officials really do have zero records of personal combat, and the floor should not be propped up artificially | Guan Ning (管宁) 8, Zheng Xuan (郑玄) 10 |

**Cao Cao's 72 is the practical ceiling in this dimension for someone equally gifted in civil and
military matters.** He has 才力绝人，手射飞鸟，躬禽猛兽 (talent and strength beyond other men; shot
birds on the wing with his own hand, took fierce beasts himself) — Pei's commentary citing
《魏书》 (*Book of Wei*) — and the ride out through the fire at Puyang, but in thirty years not one
line of him cutting down an enemy general himself. This number also forms half of cross-constraint
C7 — see section 5.

### Intellect `intellect`

| Value | Anchor | Basis | Same band |
| --- | --- | --- | --- |
| **96** | Zhuge Liang (诸葛亮) | Technology (性长于巧思，损益连弩、木牛流马) + strategic foresight (the Longzhong Plan) + understanding of government. **Capped here** | —— |
| **95** | Jia Xu (贾诩) | Chen Shou's appraisal 庶乎算无遗策，经达权变，其良、平之亚欤 (near enough to never miscalculating, versed in expedient change — second only to Zhang Liang and Chen Ping) — **a comparison to Zhang Liang and Chen Ping, the highest comparison *Records of the Three Kingdoms* makes for talent at stratagem** | Guo Jia (郭嘉) 95 |
| **91** | Xun Yu (荀彧) | He Yong (何颙) called him 王佐才也 (talent fit to assist a king) at first sight; his argument for deep roots and a firm base, his plan to receive the Emperor and make Xu the capital, and his Guandu argument 以至弱当至强 (meeting the utmost strong with the utmost weak) were all borne out | Sima Yi (司马懿) 93, Xun You (荀攸) 92, Zhou Yu (周瑜) 90, Lu Xun (陆逊) 90 |
| **86** | Ju Shou (沮授) | First to propose receiving the Emperor; remonstrated against advancing rashly, asked to split the army for a long war, warned to guard Wuchao — **all three remonstrances ignored, and all three came out as he said**. A remonstrance ignored and then borne out is the strongest class of signal in this dimension | Fa Zheng (法正) 88, Tian Feng (田丰) 86, Lu Su (鲁肃) 84, Cheng Yu (程昱) 84 |
| **78** | Kuai Yue (蒯越) | Lured and executed fifty-five chiefs of the clan-bandits and absorbed their men; Cao Cao: 不喜得荆州，喜得异度 (not glad to have gained Jingzhou, glad to have gained Yidu). **Someone with several clearly successful stratagems but nothing at the strategic level** | Liu Ye (刘晔) 82, Chen Gong (陈宫) 76, Zhang Zhao (张昭) 76 |
| **65** | Kan Ze (阚泽) | Read widely across the classics; petitioned to establish academic officials and fix institutions. **The "default slot for a man of books"**: well read, discerning, but with no record of any military or political stratagem succeeding or failing | Wang Can (王粲) 70, Qin Mi (秦宓) 68 |
| **50** | Han Dang (韩当) | A veteran through three generations, with battle experience and not one record of a stratagem. **The "default slot for a military man"** | Xu Chu (许褚) 30, Dian Wei (典韦) 22 |
| **20** | Guo Si (郭汜) | A horse thief in youth; shared power with Li Jue (李傕) and then fought him, carried off the high ministers to keep them at his side, acted with no calculation at all and destroyed himself. **Near the floor** | —— |

The two "default slots" (65 and 50) are the most useful thing on this ladder. More than half of the
578 get their intellect from them rather than from case-by-case judgment. The rule is hard: `roles`
containing only 学者/文学 (scholar / literary) with no record of offering a plan in his own
biography → the 65 band; `roles` containing only 军事/骑将/水军 (military / cavalry officer / navy)
with no record of offering a plan, of seeing through a ruse, or of technology → the 50 band.

### Politics `politics`

| Value | Anchor | Basis | Same band |
| --- | --- | --- | --- |
| **98** | Zhuge Liang (诸葛亮) | 科教严明，赏罚必信……刑政虽峻而无怨者……识治之良才，管、萧之亚匹矣 (his ordinances and instruction were strict and clear, rewards and punishments always honoured… his penal government was severe yet none resented it… a fine talent who understood government, second only to Guan Zhong and Xiao He); plus the 《蜀科》 (*Shu Code*) legislation and the appointment of weir officers at Dujiangyan | —— |
| **93** | Xun Yu (荀彧) | Twenty years holding the centre steady: moving grain, recommending the worthy, setting institutions. 5 points below Zhuge Liang: his merit lies in personnel and in keeping the central government running, with no direct record of legislation or economic works | Gu Yong (顾雍) 90, Jiang Wan (蒋琬) 88 |
| **88** | Chen Qun (陈群) | Created the Nine-Rank system for officials (九品官人法) — **an institutional achievement in use for three hundred years**. Institutional achievement outranks office rank | Zhang Zhao (张昭) 89, Zhong Yao (钟繇) 88, Du Ji (杜畿) 88 |
| **80** | Liu Biao (刘表) | Rode alone into Yicheng and settled Jingzhou; cherished the people and supported scholars, founded schools; his territory saw no fighting for more than ten years. **A good administrative record for a regional lord, with no institutional achievement and no economic works** | Lu Xun (陆逊) 82, Tao Qian (陶谦) 78, Zhang Lu (张鲁) 78 |
| **68** | Kan Ze (阚泽) | Director of the Secretariat and Grand Tutor to the Heir; petitioned to establish academic officials; holds central office plus one institutional proposal, with no local administrative record | Mi Zhu (糜竺) 66, Liu Zhang (刘璋) 62 |
| **52** | Cai Mao (蔡瑁) | Commanded the Jingzhou navy; held position and power but **not one record of administrative achievement**. The coordinate for "holds power, does not govern the people" | Xu Huang (徐晃) 52, Yu Jin (于禁) 50 |
| **34** | Yue Jin (乐进) | From clerk in the tent to General of the Right; his whole biography has nothing but battle merits, **not one character touching civil administration** | Zhang Fei (张飞) 40, Ma Chao (马超) 30 |
| **14** | Guo Si (郭汜) | A horse thief by origin; held the Three Adjuncts (三辅) while fighting and plundering, carried off the high ministers to keep them at his side — **the opposite of government** | Lü Bu (吕布) 22, Dian Wei (典韦) 18 |

Kong Rong (孔融) is the best test of this ladder. He was Chancellor of Beihai with a commandery in
his charge, of very high family and very high fame — but his biography says
所任用好奇取异 (in his appointments he favoured the odd and the unusual) and 兵势不振 (his military
strength never rose), and the one commandery in his hands could not be held. So his politics is
only 66, while his charisma is 86. **High office does not mean competence at government, and the
criterion is clearest on him.**

### Charisma `charisma`

| Value | Anchor | Basis | Same band |
| --- | --- | --- | --- |
| **97** | Liu Bei (刘备) | 弘毅宽厚，知人待士，盖有高祖之风，英雄之器焉 (magnanimous and firm, he knew men and treated his officers well; he had something of Gaozu's manner, the stature of a hero); Guan Yu and Zhang Fei were 恩若兄弟 (bound to him as brothers) and never defected in their lives; at Dangyang he kept more than a hundred thousand civilians with him rather than abandon them | —— |
| **93** | Yuan Shao (袁绍) | Four generations of the Three Excellencies, disciples and former subordinates across the realm; he raised troops and Shandong answered. 4 points below Liu Bei: 内多忌害 (inwardly much given to jealousy and harm), and men attached themselves because of the family, not because of the man | Cao Cao (曹操) 92, Sun Ce (孙策) 88 |
| **90** | Zheng Xuan (郑玄) | Thousands of disciples; Kong Rong created a 郑公乡 (Lord Zheng's Village) especially for him; tens of thousands of Yellow Turbans passing by agreed among themselves not to enter his county. **Stopping an army while commanding not one soldier and not one commandery is the purest evidence of the charisma effect surface** | Sun Quan (孙权) 90 |
| **86** | Guan Ning (管宁) | Thirty-seven years lecturing in Liaodong, 民化其德 (the people were transformed by his virtue), and he declined repeated summonses from Wei. **The coordinate for moral standing untouched by power** | Zhuge Liang (诸葛亮) 89, Liu Biao (刘表) 86, Kong Rong (孔融) 86 |
| **76** | Lu Xun (陆逊) | The standing of a great clan of Wu Commandery, and he rose to Chancellor. **Fame enough to command obedience, not enough to summon the realm** | Li Dian (李典) 74, Zhang Liao (张辽) 74, Zhao Yun (赵云) 74, Ma Chao (马超) 74 |
| **62** | Yan Yan (严颜) | 但有断头将军，无有降将军 (there are generals who lose their heads, there are no generals who surrender) — integrity, but **a name that does not travel beyond one commandery** | Wen Pin (文聘) 68, Yuan Shu (袁术) 62 |
| **44** | Cai Mao (蔡瑁) | Held military power as a consort relative and urged his lord to surrender to the enemy: power, but **the scholar-gentry would not count him among them** | Wei Yan (魏延) 48 |
| **26** | Guo Si (郭汜) | Plundered on the strength of his troops, carried off the high ministers, hated by the realm. **The practical floor of this dimension** | Zhang Rang (张让) and other eunuchs 14 |

This dimension's floor of 26 is far above the might dimension's 8. The reason is that "getting into
the histories at all is itself a kind of renown" — there is nobody in the pool with zero renown.
The one exception is anyone whose `roles` include 宦官 (eunuch) — a hard −20, the only
across-the-board deduction by role in the whole table.

---

## 3. Target distribution: a long tail, not a normal curve

578 people × 5 dimensions = 2890 values. Target shape:

| Range | Leadership | Might | Intellect | Politics | Charisma |
| --- | ---: | ---: | ---: | ---: | ---: |
| 95–100 | 1 | 3 | 3 | 1 | 1 |
| 90–94 | 6 | 7 | 7 | 5 | 6 |
| 85–89 | 12 | 12 | 11 | 10 | 12 |
| 80–84 | 22 | 22 | 18 | 20 | 18 |
| 70–79 | 68 | 58 | 52 | 55 | 60 |
| 60–69 | 118 | 88 | 90 | 102 | 128 |
| 50–59 | 150 | 96 | 128 | 138 | 168 |
| 40–49 | 120 | 96 | 130 | 122 | 112 |
| 30–39 | 62 | 100 | 92 | 82 | 56 |
| 20–29 | 15 | 71 | 37 | 32 | 15 |
| 0–19 | 4 | 25 | 10 | 11 | 2 |
| **Total** | **578** | **578** | **578** | **578** | **578** |

**How to read it: across 578 people, values of 90+ in a single dimension come to only 42 over all
five dimensions (1.45% of all values).** A 90 is a scarce resource — which is exactly what makes
"which front do I put my one 90 on" a real question. If 90s were everywhere, appointment would
degenerate into sorting and the stat system would have no reason to exist.

The dimensions have different shapes, for these reasons:

- **Might has the widest spread and the lowest floor** (25 people <20): civil officials really do
  have zero records of personal combat, and the floor should not be propped up artificially
- **Charisma has the highest floor** (only 2 people <20, and they can only be eunuchs): getting into
  the histories is itself a kind of renown
- **Intellect's median is on the low side**: most figures with a biography have no record of
  offering a plan, and the median should not be inflated
- **Leadership is the most even**: commanding troops was the commonest experience at the end of Han
- **Politics is bimodal**: the civil group clusters at 60–80, the military group at 30–50

Acceptance tolerance: the gap between the actual count in each band and the target ≤ 25% of the
target; **for every band ≥85 the error ≤ 2 people** — zero tolerance at the top.

Order of handling when the distribution does not match: first check whether the role baseline was
chosen wrongly → then check whether a keyword matched by mistake → only last consider changing the
distribution table. **No case-by-case exceptions for individuals.**

---

## 4. Derivation rules

### 4.1 Two tracks, because evidence density differs by three orders of magnitude

`historicalNote` is a 30–45 character summary; **it is an index, not the complete evidence set**.
For someone like Guan Yu, the evidence not in the summary far outweighs what is in it; for a Black
Mountain bandit chief like 黄龙 (Huanglong), the summary (黑山诸帅之一。籍贯姓名俱不详。 — one of
the Black Mountain chiefs; native place and personal name both unknown) is essentially all the
evidence there is. Running both kinds through the same pipeline must badly underrate the first.

Hence the two tracks:

| Track | Applies to | Count | Method |
| --- | --- | --- | --- |
| **A, anchor comparison** | prominence ∈ {1,2}, or certainty == `attested` | about 150 | **Must consult the primary text of the biography `sources` points to**, and position dimension by dimension against the anchor table: first decide which two anchors the value falls between, then take a value inside the band. statBasis must name at least one anchor in the same dimension and state the reason for the gap. The mechanical pipeline's result serves only as a lower-bound reference |
| **B, mechanical pipeline** | prominence ∈ {3,4} and certainty == `sparse` | about 300 | Execute the five steps below mechanically; the result is the final value. For this group the `historicalNote` really does equal all the attestable evidence there is |

The `statTrack` field written into the data records which track a person went through, to make
later auditing easy.

### 4.2 The five-step pipeline

**Step 1 · Role baseline vector.**
`baseline[d] = max over r in roles of roleBaseline[r][d]` — **take the maximum per dimension, do
not average**. Maximum rather than average, because someone who is "military + civil
administration" should get the military leadership and the civil politics at the same time;
averaging flattens both ends and makes everyone with multiple roles converge.

The full 20 roles × 5 dimensions baseline table is in `derivation.steps[0].table` in the JSON. A
few rows:

| Role | Ldr | Mgt | Int | Pol | Cha |
| --- | ---: | ---: | ---: | ---: | ---: |
| 军事 military | 62 | 64 | 44 | 40 | 50 |
| 骑将 cavalry officer | 58 | 70 | 40 | 34 | 48 |
| 谋略 stratagem | 48 | 34 | 70 | 56 | 54 |
| 内政 civil administration | 42 | 30 | 56 | 66 | 56 |
| 名士 famous literatus | 38 | 26 | 64 | 58 | 72 |
| 学者 scholar | 30 | 18 | 66 | 52 | 60 |
| 盗寇 bandit | 48 | 58 | 34 | 22 | 36 |
| 宦官 eunuch | 30 | 22 | 52 | 46 | 14 |

**Step 2 · Prominence band.** Add the shift to all five dimensions at once, then cap at the ceiling.

| prominence | Count | shift | **ceiling** | Reason |
| --- | ---: | ---: | ---: | --- |
| 1 top | 39 | +8 | 100 | Has an independent biography and shaped the pattern of an age — to reach this tier a man must have had something beyond other men |
| 2 important | 111 | +3 | **93** | 93 exactly accommodates the might of Dian Wei and Xu Chu and the leadership of Xiahou Yuan |
| 3 ordinary | 205 | −2 | **83** | **The sources gave him two hundred characters, so there is no basis for saying he was first in the realm** |
| 4 name only | 223 | −7 | **72** | Not one 80 will appear among these 223 |

`certainty` then adjusts: `attested` +0 / `sparse` −3 / `romance` +0.

**The ceiling is a hard constraint; no later step may break it.**
This is the mechanical guarantee that makes the long tail hold — prominence 3–4, 74% of the whole
pool, have their ceilings at 83 and 72.

The only exceptions go through a **named list** (`derivation.steps[1].ceilingOverrides` in the
JSON); blanket exemptions of the form "he is an anchor, so he may exceed it" are not accepted. The
list currently holds one person:

> **Guan Ning (管宁)**, prominence 3, charisma 86 (3 points over the ceiling of 83, in this one
> dimension only).
> prominence is set by "the format of the biography and the length of the record", and Guan Ning's
> renown is precisely not a matter of length — he did nothing his whole life, and his renown comes
> entirely from not doing: 割席分坐 (cutting the mat to sit apart), thirty-seven years lecturing in
> Liaodong without meddling in affairs, declining the repeated summonses of Emperors Wen and Ming
> of Wei, and being named with Hua Xin (华歆) and Bing Yuan (邴原) as 一龙 (the one dragon).
> **The length criterion systematically underrates charisma for figures who made their name by not
> acting** — a known blind spot of the rules, hence a named exemption, rather than quietly changing
> his number or going back and changing prominence in `officers.json`.

V11 checks exactly this: every value over the ceiling must belong to someone on the list, with a
matching dimension. **It turns "an exception is allowed" from a verbal agreement into an enumerable
list.**

**Step 3 · Deed keyword adjustment.** Match the keyword table entry by entry against
`historicalNote` (track B) or the primary text of the biography (track A). Each entry counts once
per person; repeated occurrences do not accumulate. **The total per dimension is limited to
[−18, +18]**, truncated beyond that — exceeding that range means the person should be positioned
against anchors on track A rather than stacked up by keywords.

The table is in `derivation.steps[2].table` in the JSON, 49 entries in all. An example of the
weight gradient (intellect):

| Weight | Evidence class | Example terms |
| ---: | --- | --- |
| +10 | stock appraisal of cunning | 算无遗策、奇策、权略、王佐、良平 |
| +8 | **remonstrance ignored, borne out afterwards** | 谏…不听、不用其言、而果 |
| +7 | plan adopted and borne out | 之计、之策、从之、果如其言 |
| +7 | seeing through, and foresight | 识变、料事、料…必、屡中 |
| +6 | military technology / devices / writings | 火攻、断粮、离间；巧思、连弩、八阵；著、注、律历 |
| +5 | learning | 遍览、博学、强记、弟子数千 |
| −6 | falling for a ruse / negative appraisal of judgment | 中计、见欺；轻狡、好谋无决、促狭 |

"Remonstrance ignored, borne out afterwards" weighs more than "plan adopted", because the former
rules out the confound "the outcome was good because the lord was right anyway" — it is the
strongest class of signal in this dimension. Learning gets only +5, because reading widely is not
the same as judging well, and this rule holds a large group of scholars firmly around 65.

**Step 4 · Anchor clamping.**

1. Find the two rungs on that dimension's anchor ladder that bracket the current value, and write
   into statBasis "slightly below X(v)" or "slightly above Y(v)"
2. **For anyone who is not an anchor and not in the calibration set, no dimension may exceed their
   prominence ceiling, nor exceed the same-band anchor value +2**
3. **Anyone with a dimension ≥85 must give in statBasis one piece of primary-text-level evidence
   for that dimension**; if none can be given, fall back to 84
4. **Anyone with a dimension ≤25 must likewise give a basis** ("biography X contains no record of Y
   anywhere" is an acceptable basis, but it must say which biography was checked)
5. Round to the nearest integer

**Step 5 · Cross-constraint validation.** See the next section.

### 4.3 A worked example end to end: Yan Liang

Yan Liang (颜良) is a good sample for testing track B — prominence 3, certainty sparse, native place
and courtesy name both unknown, yet the consensus rating of him is high.

```
roles = [军事, 骑将]
baseline = max(军事, 骑将) = 62 / 70 / 44 / 40 / 50
p3 shift −2                → 60 / 68 / 42 / 38 / 48
sparse    −3               → 57 / 65 / 39 / 35 / 45
keywords:
  "勇冠三军"  valor first in the three armies (Kong Rong, in 《荀彧传》)   mgt +12
  "袁绍名将"  a famous general of Yuan Shao                               ldr +5   mgt +6
  "性促狭，不可独任"  narrow-tempered, not to be given sole charge (Ju Shou)  ldr −8   cha −6
  "为关羽所斩"  cut down by Guan Yu                                       ldr −4   mgt −3
                             → 50 / 80 / 39 / 35 / 39
clamp (p3 ceiling 83) + fine-tune → 54 / 83 / 38 / 34 / 44
```

Two things are worth noting.

First, 勇冠三军 is not in `historicalNote`; it is in Kong Rong's words in 《荀彧传》 (*Biography of
Xun Yu*). **The rules require the executor to read the biography `sources` points to, not just the
summary** — which is exactly why track B still requires reading the biography for anyone who is
`attested`. Reading only the summary would drop Yan Liang's might to 67, and anyone who knows the
Three Kingdoms would see at a glance that the number is wrong.

Second, his leadership is only 54. Ju Shou says plainly
颜良性促狭，虽骁勇不可独任 (Yan Liang is narrow-tempered; brave though he is, he cannot be given sole
charge). The number comes out lower than the usual value in commercial games, but it has a primary
text behind it, and it is **two sentences about the same man in the same source** — valor up at 83,
capacity for sole command down at 54. **Five-dimension orthogonality shows most cleanly on him.**

---

## 5. Cross-constraints

This section answers "how do we keep a superman with 90s everywhere from appearing". The JSON has
C1–C16, 16 in all, every one of which can be written as a script assertion.

### On totals

| # | Constraint | Reason |
| --- | --- | --- |
| C1 | Sum of the five dimensions ≤ **441** | 441 is Cao Cao's value and the ceiling for the whole pool. He is the closest thing the Three Kingdoms has to an all-rounder, and nobody should exceed him |
| C2 | At most 3 people with a sum ≥ 410 | 2 already used: Cao Cao 441, Zhuge Liang 411. One slot left |
| C3 | At most 12 people with a sum ≥ 380 | The top must stay scarce |
| C4 | Pool-wide mean of the sums 240–265, standard deviation 45–60 | Too high a mean means across-the-board inflation; too small a standard deviation means the factions' rosters converge |

### On supermen

| # | Constraint | Reason |
| --- | --- | --- |
| **C5** | **At most 2 dimensions ≥90 for any one person. The only exception in the pool is Cao Cao (3 dimensions)** | This is the main anti-superman constraint |
| **C6** | **Everyone must have at least one dimension ≤ 72** | Everybody has a weakness. A character profile that cannot name one means the sources were not read |
| C15 | For prominence 4, every dimension ≤ 72 and the sum of the five ≤ 280 | The 223-person name-only tier should produce no 80 at all. This is what keeps the long tail long |

C5 is the direct reason for the two cuts to Zhuge Liang (leadership 88, charisma 89). His intellect
96 and politics 98 already use up both slots, so leadership and charisma have to be pressed below
90 by explicit appraisal in the sources — and as it happens Chen Shou supplies exactly those two
lines (应变将略非其所长, and his winning of men being confined within one state). **Here the
constraint and the sources agree of themselves; we did not force it down.**

### On dimension combinations that are rare in history

| # | Constraint | Pool-wide slots | Basis |
| --- | --- | ---: | --- |
| **C7** | **might ≥ 88 and politics ≥ 78** | **0 people** | The most robust negative correlation in the Three Kingdoms. Lü Bu's politics 22, Xu Chu 30, Zhang Fei 40, Ma Chao 30; in the other direction Cao Cao's might of 72 is already the ceiling |
| C8 | might ≥ 90 and intellect ≥ 85 | ≤ 1 person | Top personal might and top stratagem do not coexist in the sources. Guan Yu 96/76, Zhang Fei 95/58, Sun Ce 90/68 all fail to trigger it. The one slot is kept in case a later batch finds a counterexample with nowhere to put it |
| C9 | intellect ≥ 90 and leadership ≥ 90 | ≤ 4 people | "Can plan and can command" is the scarcest combination in the Three Kingdoms, and is exactly why Cao Cao, Zhou Yu, Sima Yi and Lu Xun are top tier. 4/578 = 0.7% |
| C16 | Correlation between any two dimensions \|r\| < 0.6 | —— | If "strong people are strong at everything", the assignment problem over five dimensions is as hard as one over a single dimension. **Might × politics should be clearly negative (−0.3 ~ −0.5)** |

C7 is the constraint with the most gameplay value in the system. It guarantees that **nobody can
both charge through a formation and govern a commandery**, so "who holds this commandery, who leads
this army" is always a two-person question, never a one-person question.

### On evidence being mandatory

| # | Constraint |
| --- | --- |
| C10 | charisma ≥ 90 → `roles` must contain one of 君主/宗室/名士/外交 (ruler / imperial clan / famous literatus / diplomacy), **or** the biography must have explicit text of gentry and commoners attaching themselves |
| C11 | politics ≥ 85 → there must be primary text in one of four classes: stock phrase for administrative achievement / production works / institutional achievement / highest central office |
| C12 | leadership − might ≥ 25 (scholar-general type) → `roles` must contain 谋略 or 内政; might − leadership ≥ 20 (fierce-warrior type) → `roles` must contain one of 军事/骑将/盗寇/异族 |
| **C13** | **leadership ≥ 85 must have one primary text of "commanded as commander-in-chief and won"; "campaigned under so-and-so with merit" does not constitute a basis** |
| C14 | For `fictional == true`, every dimension ≤ 85 and the sum of the five ≤ 320 |

C13 is the most visible source of divergence between this system and commercial games, and the one
that most deserves to be stated openly: it holds Gao Shun at 74 and Zhao Yun at 78. **That is an
inevitable result of "counting by the sources", not an error.** If anyone questions it later, the
correct response is "《云别传》 belongs to Pei's commentary, and the biography proper shows no
independent theater command", not nudging the number toward consensus.

---

## 6. Aptitude tags

Six tags: **mountain 山地 · naval 水战 · siege attack 攻城 · siege defense 守城 · governing the
people 治民 · envoy 说客**.
They correspond to R30; inside the engine they multiply with R21 terrain and R13 objectives,
producing the orthogonal difference "whom you take depends on where you fight, not on who is
stronger".

### Three tiers of determination

Each tag is determined at three tiers, **in descending priority**:

1. **tier1 deeds** — `historicalNote` or the primary text of the biography matches that tag's
   keyword table
2. **tier2 role** — `roles` matches, or a dimension value meets the bar
3. **tier3 geography** — the province of `commandery` combined with `roles`

When more than 2 match, take the first two by **deeds > role > geography**. A tag matched only
through the geography clause is still granted, but statBasis must note "by native place" — the
weakest class of evidence.

| Tag | tier1 deeds (examples) | tier2 role | tier3 geography | Target count |
| --- | --- | --- | --- | ---: |
| **mountain 山地** | 山越、南中、汉中、巴、栈道、阁道、羌、氐、越巂、牂牁、阴平、祁山、武都、上党、白波、黑山 | `异族` and native place in Yi / Liang / Bing / You | province ∈ {益州, 凉州, 并州} and `roles` contains 军事/骑将/盗寇 | 70–85 |
| **naval 水战** | 水军、舟、船、楼船、渡江、浮海、锦帆、漕运、濡须、赤壁 | `roles` contains `水军` (all 22 match directly) | province ∈ {扬州, 交州} and contains 军事; or the four Jiangnan commanderies of Jingzhou plus Nan Commandery and Jiangxia, and contains 军事 | 45–60 |
| **siege attack 攻城** | 先登、陷阵、陷陈、攻无不破、拔…城、土山、地道、冲车、长驱 | **none** | **none** | 25–40 |
| **siege defense 守城** | 城不下、围…不动、婴城、坚壁、拒守、扞、独全其众、筑…城、不肯降 | **none** | **none** | 30–45 |
| **governing the people 治民** | 屯田、劝农、水利、漕运、兴学、安民、宽惠、殷实、民夷、路不拾遗、流民归、义舍、堰 | `politics ≥ 78` and `roles` contains 内政 | **none** | 70–90 |
| **envoy 说客** | 出使、使吴、说降、招降、游说、通好、复通盟好、应答如响、口舌、连和 | `roles` contains `外交` (all 32 match directly) | **none** | 40–55 |

Siege attack and siege defense **recognise deeds only, neither role nor geography**. The reason:
these two are the scarcest abilities in the Three Kingdoms, and the moment the role clause is
opened up, all 287 people with the 军事 role match and the tag loses its discriminating power
instantly. Only those with a primary text get them.

### Two quantity disciplines

- **Each tag should be held by 25–90 people pool-wide (4%–15%).** Over 15% means the geography
  clause was set too wide, under 4% means it was set too narrow. **In both cases go back and change
  the clause, not the individual.**
- **At least 45% of the pool (≥260 people) should have no tag at all.** If everybody has a tag, it
  turns from a discriminating signal into background noise, and eats tokens every turn for nothing.

---

## 7. Three loyalty tiers

Corresponding to R31: **Secure 安 (≥90, cannot be turned) · Wavering 疑 (40–89) · At-risk 危 (<40,
can be persuaded to defect)**.
The 271 people with `affiliation194 == null` → `loyalty = null`; for an unaffiliated figure,
"loyalty" has no object.

Base 60, adjusted as follows:

| No. | Delta | Condition | Example |
| --- | ---: | --- | --- |
| L+1 | +25 | Same clan as the lord (same surname and `roles` containing 宗室/外戚, or the note explicitly says 子/弟/从弟/从子 — son / younger brother / cousin / nephew) | Cao Ren (曹仁), Xiahou Dun (夏侯惇) |
| L+2 | +20 | Followed from the first raising of troops, or explicit text of a personal bond (初从、恩若兄弟、誓以共死、推道南大宅) | Guan Yu and Zhang Fei to Liu Bei; Zhou Yu to Sun Ce |
| L+3 | **+30** | **Recorded as dying for his loyalty** (不降、死节、就戮、终不复事二主、断头将军、城破不降) | Gao Shun, Chen Gong, Ju Shou, Zhang Ren (张任), Yan Yan |
| L+4 | +10 | The current lord was the one who recommended him for office, or was his former lord | Sun Qian (孙乾) — recommended by Zheng Xuan, then appointed Attendant Officer by Liu Bei |
| L+5 | +8 | Same commandery as the lord | |
| L+6 | +4 | Same province as the lord (does not stack with L+5) | |
| L−1 | **−30** | **`roles` contains 君主 (ruler), but `affiliation194` is not himself** (an independent warlord living under someone else's roof) | Sun Ce to Yuan Shu; Zhang Xiu (张绣) to Zhang Ji (张济) |
| L−2 | **−30** | **The person actually followed in the note ≠ the lord in `affiliation194`** | Cheng Pu (程普), Huang Gai (黄盖), Han Dang, Zhu Zhi: 孙坚旧将……本年在袁术麾下随孙策 (old officers of Sun Jian… this year under Yuan Shu's banner, following Sun Ce) |
| L−3 | −25 | The 194 affiliation is coerced or a temporary lodging (依、避难、寄、被拘、不得志、不见重、不用为将、负约、所胁) | Taishi Ci to Liu Yao (刘繇) |
| L−4 | −20 | A record of betraying a lord **before 194**, counted once per occurrence | Lü Bu killed Ding Yuan (丁原), then killed Dong Zhuo (董卓) (−40) |
| L−5 | **−8** | A record of betraying a lord that happens only **after 194**, counted once per occurrence | Zhang Liao, Zhang He |
| L−6 | −12 | Explicit personal enmity with the lord, or the two once fought each other | |
| L−7 | −15 | The lord has explicit text of suspicion and this person falls within its scope | Yuan Shao's 内多忌害; Liu Biao's 不甚见重 (not much esteemed) |

### The L−4 / L−5 distinction is the key discipline in this section

For the same "betrayal", one that happened before 194 costs 20 and one that happens only afterwards
costs 8. At the end of 194 Zhang Liao is still Lü Bu's cavalry officer; the fall of Xiapi is five
years away — **that has not happened yet at this moment**. It can serve only as evidence of
disposition (this man is not the die-hard type), not as an accomplished fact.

Without that split, the whole table turns into a "god's-eye loyalty table", and what the model sees
is a spoiler rather than a situation.

### A few worked examples

| Person | Calculation | Tier |
| --- | --- | --- |
| Gao Shun (高顺) | 60 + 30 (died rather than surrender when the city fell) = **90** | Secure 安 |
| Guan Yu (关羽) | 60 + 20 (恩若兄弟) + 20 (fled as an outlaw to Zhuo Commandery to join Liu Bei) = **100** | Secure 安 |
| Zhang Liao (张辽) | 60 − 8 (went over to Cao Cao after 194) = **52** | Wavering 疑 |
| Ju Shou (沮授) | 60 + 30 (captured at Guandu and would not surrender) − 15 (Yuan Shao 内多忌害, and Ju Shou was stripped of his command) = **75** | Wavering 疑 |
| Taishi Ci (太史慈) | 60 + 8 (he and Liu Yao were both men of Donglai) − 25 (Liu Yao would not use him as a general, employing him only to scout) = **43** | Wavering 疑 |
| Cheng Pu (程普) | 60 − 30 (listed under Yuan Shu but actually following Sun Ce) = **30** | At-risk 危 |
| Sun Ce (孙策) | 60 − 30 (a ruler, yet affiliated to Yuan Shu) − 25 (Yuan Shu broke his promise) = **5** | At-risk 危 |

### The Yuan Shu seat has drama built into it

Sun Ce 5, Cheng Pu 30, Huang Gai 30, Han Dang 30, Zhu Zhi 30, Zhou Yu — all six land in the
"at-risk" tier, and they are exactly the hardest-hitting group Yuan Shu has. The first question for
a model taking over Yuan Shu is "how do I use this elite force that is not mine, and when must I
give it up".

**This is not a plot a designer wrote, it is what falls out of the sources once the rules are
applied.** No rule anywhere says "make Yuan Shu hard to play"; the difficulty is derived from the
historical fact that "Sun Jian's old officers are listed under Yuan Shu while actually following
Sun Ce".

Target distribution: among the 307 with an affiliation, Secure 20–30% · Wavering 55–70% · At-risk
8–15%.

---

## 8. How to write statBasis

Everyone must have a `statBasis`. Format:

```
<dimension name> <value>：<source-deed basis>，<comparison word><anchor name>(<anchor value>)
```

Dimensions are separated by "；". The comparison word is one of {略逊 slightly below, 明显低于
clearly below, 略胜 slightly above, 明显高于 clearly above, 同带于 in the same band as}.

### Dimensions that must be written

- the person's **highest** dimension
- the person's **lowest** dimension
- any dimension **≥80** (and it must contain primary-text-level evidence)
- any dimension **≤25** ("biography X contains no record of Y anywhere" is an acceptable basis, but
  it must say which biography was checked)

The remaining dimensions may be omitted, or merged into a single clause "the rest follow the role
baseline (military type) + the prominence 1 band". **Omission is not the absence of a basis — the
role baseline table and the prominence band table are themselves the basis for those dimensions;
the rule is the basis.** This brings the workload for 578 people back into feasible range without
sacrificing verifiability.

### Words that may not appear

`感觉` `大概` `应该差不多` `一般来说` `众所周知` `游戏里通常`
(roughly: "I feel", "probably", "should be about right", "generally speaking", "as everyone knows",
"in games it's usually")

**And using any commercial game's numbers as a basis or as a cross-check is forbidden.**
If someone's derived result differs greatly from a commercial game, the correct response is to go
back to the sources and the rules, not to lean the result that way.

### Three examples

> 统率 (leadership) 90: 《关羽传》 (*Biography of Guan Yu*) 董督荆州事 (placed in overall charge of
> Jingzhou), and 威震华夏 (his might shook the realm) after the flooding of the seven armies — in
> the same band as Zhou Yu(92), but slightly below;
> 武力 (might) 96: '策马刺良于万众之中，斩其首还' is the only explicit text in the whole book of
> "killing an enemy commander-in-chief in the midst of a host", slightly below Lü Bu(100);
> 政治 (politics) 58: held the post of Administrator of Xiangyang with no record of administrative
> achievement, slightly above Cai Mao(52); the rest follow the role baseline (军事+骑将) + the
> prominence 1 band.

> 统率 (leadership) 74: the Xianzhen Camp of just over seven hundred men, 攻无不破 (Pei's commentary
> citing 《英雄记》), but never a thousand men and no theater command; he is the "elite small-unit
> commander" anchor itself; 武力 (might) 80: has text of assault and battle but no text of
> personally killing a general, in the same band as Cao Ren(80); 政治 (politics) 40: the Biography
> of Lü Bu contains no record of civil administration anywhere.

> 演义形象：(Romance figure:) 魅力 (charisma) 85: the chain stratagem that set Dong Zhuo and Lü Bu
> against each other makes her the central pivot of the *Romance*, slightly below Guan Ning(86);
> 武力 (might) 8: no military activity whatsoever, same band as Hua Tuo(8); 智力 (intellect) 62: she
> carried out the plan rather than devising it — the plan came from Wang Yun (王允). The official
> history records only that Lü Bu had an affair with one of Dong Zhuo's maidservants and feared
> discovery, with no name given, so the sum of the five dimensions is held below 320.

### Special groups

| Group | Count | Treatment |
| --- | ---: | --- |
| Fictional, from the *Romance* (`fictional: true`) | 28 | Give values as usual. **statBasis must begin with the characters 演义形象：**; every dimension ≤ 85, sum of the five ≤ 320. Reason: there is no source counting to rely on, and high values would pollute the explainability of the whole distribution |
| Not yet born, or still a child, in 194 | Zhuge Liang 14, Sima Yi 16, Lu Xun 12, Sun Quan 13… | **Give the adult ability baseline as usual.** `stats` expresses "the attestable capacity of this person's whole life", not "his record as of 194". Whether he is usable is decided by the engine from `birthYear`; **no discount is applied at the data layer** |
| Already dead before 194 | Cai Yong (蔡邕), Wang Yun (王允), Lu Zhi (卢植), Xu Rong (徐荣)… | Give values as usual, for reuse in other scenario years |
| Unaffiliated in 194 | 271 | Give all five dimensions as usual; `loyalty = null` |

---

## 9. Fields written into officers.json

```jsonc
{
  "stats": { "leadership": 90, "might": 96, "intellect": 76, "politics": 58, "charisma": 82 },
  "statBasis": "统率 90：……；武力 96：……",
  "aptitudes": ["攻城", "守城"],          // 0–2 of them, may be none
  "loyalty": 100,                          // write null when affiliation194 is null
  "loyaltyBasis": "60 + 20(L+2 恩若兄弟) + 20(L+2 起兵即从) = 100",
  "statTrack": "anchor"                    // "anchor" | "pipeline"
}
```

The `calibrationSet` in `officer-anchors.json` already gives the full five dimensions and the key
points of the basis for 57 people, among them all 40 anchor figures. **The values for these 57 may
not be changed**; later batches take them as given.

---

## 10. Acceptance checklist

Can be written as `tools/audit-officer-stats.mjs` and run in CI:

| # | Check | Pass criterion |
| --- | --- | --- |
| V1 | Everyone has a `statBasis`, and it contains no forbidden words | 100% |
| V2 | Every dimension ≥85 has primary-text-level evidence in `statBasis` | 100% |
| V3 | Actual distribution against the target table in section 3 | error per band ≤25%; **error ≤2 people for each band ≥85** |
| V4 | C1–C16 all pass | 100% |
| V5 | The actual value of every person in the anchor table == the anchor value | 100%. **Anchor values are assertions, not suggestions** |
| V6 | Number of holders of each aptitude tag | all 6 tags fall within 25–90 |
| V7 | Proportion holding no tag | ≥45% (≥260 people) |
| V8 | Share of the three loyalty tiers among the 307 with an affiliation | Secure 20–30% · Wavering 55–70% · At-risk 8–15% |
| V9 | Correlation between any two dimensions | \|r\| < 0.6; might × politics clearly negative |
| V10 | None of the 223 people at prominence 4 has any dimension ≥73 | 0 exceptions |
| V11 | Every value over its prominence ceiling belongs to someone named in `ceilingOverrides`, with a matching dimension | 0 unnamed exceptions |

**The order of handling a violation is fixed:** check whether a keyword matched by mistake → check
whether the role baseline was chosen wrongly → check whether the person belongs in the anchor
table. **Under no circumstances make an exception for an individual.**

---

## 11. Stated plainly: where this is uncertain

1. **The anchor values are themselves judgments, not computed results.** There is no objective
   basis that can decide between 97 and 96 for Cao Cao's leadership. The reproducibility of this
   system comes from "the rules for positioning the other 538 relative to the anchors are fixed",
   not from the anchors being uncontroversial. That has to be admitted, or the whole argument is
   hollow.

2. **The 20×5 numbers in the role baseline table are estimates.** They set the central position of
   the 428 people at prominence 3–4, so their reach is large. They should be recalibrated once
   after the first batch of 100 is finished — only then is there an actual distribution to compare
   against.

3. **The weight gradient of the keyword table is debatable; the absolute values are not.** The
   ordering "remonstrance ignored then borne out (+8) should outrank plan adopted (+7)" has a
   rationale; "8 or 9?" does not. Fortunately the anchor clamping in step 4 absorbs most of the
   effect of the absolute values — what actually does the work is the relative ordering.

4. **The target counts for the aptitude tags (25–90) are a guess.** They come from the qualitative
   judgment that "a tag must discriminate, but must not be too rare", with no measurement behind
   them. Once the engine runs they should be calibrated against "the win-rate difference between
   carrying a given tag and not carrying it".

5. **The four magnitudes in the loyalty formula — −30 / −25 / −20 / −8 — have not been validated in
   play.** In particular, whether L−2 (listed under A but actually following B) at −30 pushes the
   Sun officers exactly into the "at-risk" tier and not below it is design intent, not measurement.

6. **C4's "mean 240–265, standard deviation 45–60" is a target, not a prediction.** After all 578
   are done it will most likely not match, and what should be tuned then is the role baseline table
   (item 2), not this range.

7. **The negative correlation between might and politics (−0.3 ~ −0.5) is an expectation, not a
   guarantee.** If it comes out near 0, the keyword table does not discriminate sharply enough
   between civil and military, and structural constraints of the C7 kind need strengthening.

---

## Appendix: what this document does not do

- It does not give concrete values for the 578. That is the work of the follow-up batches; this
  document supplies only the anchors and the rules.
- It does not design the special-skill system. The 24-entry special-skill table in section 6 of
  `OFFICER-STATS-DESIGN.md` is a separate matter, and not at the same layer as the aptitude tags
  here — there are only 6 aptitude tags, they serve R30, and they are an interface the engine has
  already committed to.
- It does not touch growth and death rules. See section 8 of `OFFICER-STATS-DESIGN.md`.
- It introduces no new dependency and modifies no existing field of `officers.json`.

<!-- translated-from: OFFICER-ANCHORS.md@7c087245f03e -->
