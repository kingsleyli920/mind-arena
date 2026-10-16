[中文](OFFICER-RENOWN.md) · [English](OFFICER-RENOWN.en.md)

# Renown tiers: `historicalWeight` and `renown`

Generated: 2026-08-31
Companion data: `lib/game/data/officer-renown.json`
Applies to: the 578 people in `lib/game/data/officers.json`
Field being superseded: `prominence` in `officers.json` (this document does not modify that file; it only supplies a replacement standard)
Adjacent document: `docs/OFFICER-ANCHORS.en.md` (five-stat numeric anchors)

---

## 0. Why split the field

The single `prominence` field in `officers.json` was carrying two jobs at once: how prominent someone is in the historical sources, and "how important is this person in the game".
For most people the two happen to point the same way, which hid the problem. Where they point different ways, the field falls apart:

- Among the Five Tiger Generals (五虎将), Guan Yu (关羽), Zhang Fei (张飞), Zhao Yun (赵云) and Ma Chao (马超) are tier 1, but **Huang Zhong (黄忠) drops to tier 2**. The reason is that his own biography is short.
  But "the Five Tiger Generals" is a fixed folk grouping of thirty years' standing; four at tier 1 plus one at tier 2 makes no sense on any officer-selection screen.
- Dian Wei (典韦) and Xu Chu (许褚) are tier 2, yet **Xu Huang (徐晃) and Zhang He (张郃) are tier 1**. The two paragons of the bodyguard (宿卫双璧) ranked below the Five Elite Generals (五子良将) — by length of biography that is indeed the case,
  by player perception it is exactly backwards.
- Xiahou Dun (夏侯惇), Xiahou Yuan (夏侯渊) and Cao Ren (曹仁) are **all three at tier 2**. The three pillars of the Cao-Wei clan, and not one of them makes tier 1.
- Gan Ning (甘宁), Taishi Ci (太史慈) and Zhou Tai (周泰) are **all tier 2**; the famous Wu generals are wiped out more or less wholesale.
- Meanwhile tier 1 seats Liu Shan (刘禅), Liu Xie (刘协), Chen Qun (陈群) and Gu Yong (顾雍). Their historical standing really is enough, but putting them in the same box as Guan Yu
  amounts to declaring that the box means "important" — important in which sense, exactly?

One field cannot answer two questions. Split it in two:

| Field | Chinese | What it measures | Who consumes it |
| --- | --- | --- | --- |
| `historicalWeight` | 历史地位 | Length of treatment in the histories, presence of a standalone biography, impact on the course of history and on institutions | Source lookup, scholarly display, credibility tiering for scenario copy |
| `renown` | 大众知名度与游戏重要度 | Weight in the *Romance* (演义), standing across generations of Three Kingdoms works, how widely the signature deeds have spread | **Map zoom display tier, UI sort weight, prior strength for deriving the five stats** |

The two axes are scored independently and **are not convertible into one another**. Hua Xiong (华雄) is `historicalWeight=4 / renown=1`; Zheng Xuan (郑玄) is `historicalWeight=1 / renown=2`;
both directions are legitimate. The reason the old `prominence` was awkward is precisely that it was forced to pick a compromise value between these two numbers.

### Definitions of the tiers

**historicalWeight (1–4)**

| Tier | Meaning | Count |
| --- | --- | --- |
| 1 | Standalone biography of substantial length, or decisive impact on the course of history / on institutions | 43 |
| 2 | Has a standalone biography or a substantial appended biography; influence reaching a region or an era | 104 |
| 3 | Appended biography, scattered mentions; deeds coherent and verifiable but did not change the course of events | 174 |
| 4 | Only a name, or one or two sentences; *Romance*-invented characters all land here (no source basis) | 257 |

Evidence is drawn from the histories only: whether there is a biography of one's own and how long it is, whether one heads a scroll, whether the events one decided changed a dynastic transition or an institutional trajectory,
and long-term scholarly or technical influence. **Screen time in the *Romance* is not considered, nor popular fame, nor combat power.**

**renown (1–4)**

| Tier | Meaning | Count |
| --- | --- | --- |
| 1 | Household name; front-line in every generation of Three Kingdoms works | **120** |
| 2 | Well known to Three Kingdoms enthusiasts; a named mainstay in the works | 114 |
| 3 | Name is recognised but the impression is vague; usually one person, one deed | 163 |
| 4 | Obscure; known only to people who read the sources | 181 |

Evidence sources: screen time and set pieces in the *Romance*; idioms, xiehouyu (歇后语, two-part allegorical sayings), proverbs, primer stories, secondary-school textbook pieces, opera and temple cult;
membership in a fixed folk grouping; whether the person appears consistently in Three Kingdoms works. **Length in the histories is not considered, nor official rank, nor whether the person is a military officer.**

renown tier 1 is set at 120 people, the top of the 80–120 range the task specified.
The old `prominence` tier 1 held only 39 people, whereas the Five Tiger Generals + Five Elite Generals + the Xiahou-and-Cao group (诸夏侯曹) + the Twelve Tiger Officers (十二虎臣) + the Four Great Commanders (四英杰) +
the Five Great Strategists + the Four Chancellors of Shu Han (蜀汉四相) + the Hebei strategists and the Four Pillars (四庭柱) already come to more than 60 on their own; add the various warlords,
the Dong Zhuo (董卓) / Lü Bu (吕布) line, the late-period generals, and the occultists and physicians, and 39 simply cannot hold them.

### Three hard rules

1. **Within a fixed folk grouping, renown must be level.** The Five Tiger Generals, the Five Elite Generals, the Twelve Tiger Officers of Jiangdong (江东十二虎臣), the Four Great Commanders of Jiangdong (江东四英杰),
   Cao Cao's Five Great Strategists (曹操五大谋士), the Four Chancellors of Shu Han, the Four Pillars of Hebei (河北四庭柱) — for these seven groups, membership is itself the source of the fame,
   so a break inside the group means the tiering is wrong. Levelness **constrains renown only**: Yue Jin's (乐进) biography is the shortest of the Five Elite Generals,
   so `historicalWeight` stays 3 and `renown` stays 1; the two numbers each say their own thing and do not conflict.
2. **A joint chapter is not a fixed grouping.** Scroll 9 of the Wei book of 《三国志》 (*Records of the Three Kingdoms*), "诸夏侯曹", is Chen Shou's (陈寿) editorial unit, not a folk catchphrase.
   Xiahou Shang (夏侯尚) and Cao Shuang (曹爽) really are a notch lower in popular perception, so renown is 2; the reasoning is in the self-check table below.
   Treating an editorial unit as a catchphrase and forcing it level is just another kind of fabrication.
3. **renown is not conditioned on "is this person a military officer".** Liu Shan, Liu Xie, Chen Qun and Gu Yong stay at tier 1,
   on grounds of game importance (ruler, Son of Heaven, head of civil administration) and popular fame, not combat power.
   The problem with the old field was never "it let civil officials into tier 1", it was "it failed to let in the officers who belonged there".

---

## 1. Group-by-group self-check

The nine groups named in the task, each listed with members and the two values. The "old prominence" column is the original value in `officers.json`,
there so you can see what changed this round.

#### Five Tiger Generals (五虎将)

| Person | Old prominence | historicalWeight | renown | Basis |
| --- | --- | --- | --- | --- |
| Guan Yu (关羽) | 1 | 1 | 1 | Flooding the seven armies and shaking all China; the loss of Jingzhou changed the three-way balance. Later canonised as an emperor and given state cult, the God of War — top-tier fame, uncontested. |
| Ma Chao (马超) | 1 | 2 | 1 | Nearly killed Cao Cao at the Wei River; held no real power after entering Shu, so his biography is middling. Fame and game standing sit solidly front-line. |
| Zhang Fei (张飞) | 1 | 2 | 1 | Shouted the Cao army back at Dangyang Bridge, released Yan Yan (严颜) in honour; Cheng Yu (程昱) and others called him a match for ten thousand men. Short biography, maximal fame. |
| Zhao Yun (赵云) | 1 | 2 | 1 | Rode alone to save the heir at Changban; the empty-camp ruse at the Han River. His biography is brief (Pei Songzhi's commentary supplements it by quoting 《赵云别传》, the *Separate Biography of Zhao Yun*) — historical weight tier 2, fame tier 1, the model case of the two axes coming apart. |
| Huang Zhong (黄忠) | 2 | 2 | 1 | Slew Xiahou Yuan at Dingjun Mountain, settling Hanzhong in one battle. Short biography, which is why the old `prominence` pushed him to tier 2 while the other four sat at tier 1 — the Five Tiger Generals are a fixed folk grouping of thirty years' standing and must be level, so on this axis he moves to tier 1. |

**Parity check**: renown is 1 across the group, **level**.

#### Five Elite Generals (五子良将)

| Person | Old prominence | historicalWeight | renown | Basis |
| --- | --- | --- | --- | --- |
| Xu Huang (徐晃) | 1 | 2 | 1 | Drove straight through to relieve the siege of Fancheng; Cao Cao compared him to Zhou Yafu. Level within the group. |
| Zhang He (张郃) | 1 | 2 | 1 | Defected from Yuan Shao (袁绍) to Cao Cao (曹操), broke Ma Su (马谡) at Jieting, took an arrow at Mumen. Also one of the Four Pillars of Hebei; level in both groups. |
| Zhang Liao (张辽) | 1 | 2 | 1 | Eight hundred men broke a hundred thousand at Xiaoyao Ford, and stopped Jiangdong children crying at night; first of the Five Elite Generals. |
| Yue Jin (乐进) | 2 | 3 | 1 | First up the wall in every battle; his biography is the shortest of the five — tier 3 by length in the histories and tier 1 by fame, exactly the two axes coming apart. The Five Elite Generals are a fixed grouping, so the group is level. |
| Yu Jin (于禁) | 2 | 2 | 1 | The only non-kin general under Cao Cao granted the imperial tally and axe; drowned out at Fancheng and surrendered, destroying his reputation in old age. Level within the group. |

**Parity check**: renown is 1 across the group, **level**.

#### The two bodyguard paragons (宿卫双璧)

| Person | Old prominence | historicalWeight | renown | Basis |
| --- | --- | --- | --- | --- |
| Dian Wei (典韦) | 2 | 3 | 1 | Died shielding Cao Cao at Wancheng; twin halberds weighing eighty jin. Extremely short biography, but paired with Xu Chu as the two bodyguard paragons, near the top of the *Romance*'s combat rankings, and always a top-tier Wei strength stat in games — the old tiering pinned him at tier 2 while the Five Elite Generals sat at tier 1, which does not add up. |
| Xu Chu (许褚) | 2 | 3 | 1 | The "Tiger Fool"; guarded Cao Cao in a single boat at the Wei River and glared Ma Chao into not moving. Level with Dian Wei; always a top-tier Wei strength stat in games. |

**Parity check**: renown is 1 across the group, **level**.

#### The Xiahou and Cao clans (诸夏侯曹, the joint chapter in scroll 9 of the Wei book of 《三国志》)

| Person | Old prominence | historicalWeight | renown | Basis |
| --- | --- | --- | --- | --- |
| Cao Hong (曹洪) | 2 | 2 | 1 | Gave up his horse at Xingyang — 「天下可无洪，不可无君」 (the world can do without me, but not without you). A member of the joint chapter; level within the group. |
| Cao Ren (曹仁) | 2 | 1 | 1 | Held Nan Commandery against Zhou Yu (周瑜) for over a year and Fancheng against Guan Yu; the first field commander of Cao-Wei, with the longest biography in the joint chapter. |
| Cao Xiu (曹休) | 2 | 2 | 1 | Cao Cao called him 「吾家千里驹」 (the thousand-li colt of my house); commanded Yangzhou for over a decade; defeated at Shiting. Level within the group. |
| Cao Zhen (曹真) | 2 | 2 | 1 | The Wei commander-in-chief against Zhuge Liang's (诸葛亮) first northern campaign, rising to Grand Marshal. Disparaged in the *Romance* but still a front-line Wei commander in games; level within the group. |
| Xiahou Dun (夏侯惇) | 2 | 2 | 1 | Commanded twenty-six armies and was received by Cao Cao with the courtesy due a guest; heads the Xiahou-and-Cao chapter. The old `prominence` pinning him at tier 2 was plainly wrong; on this axis he moves to tier 1. |
| Xiahou Yuan (夏侯渊) | 2 | 2 | 1 | Strode the Guanyou region; 「三日五百六日一千」 (five hundred li in three days, a thousand in six); killed at Dingjun Mountain. Level within the Xiahou-and-Cao group. |
| Cao Chun (曹纯) | 3 | 3 | 1 | Commanded the Tiger and Leopard Cavalry; pursued Liu Bei (刘备) at Changban and beheaded Yuan Tan (袁谭) at Nanpi. His biography is only a few lines appended to Cao Ren's, but the name of the Tiger and Leopard Cavalry makes him familiar to players; level within the group. |
| Cao Shuang (曹爽) | 3 | 2 | 2 | Ten years as regent, all of it lost in the single day of the Gaoping Tombs incident, opening the door for the Sima clan to replace Wei. Heavy historical weight, but a negative and blurry image, so fame stops at tier 2. |
| Xiahou Ba (夏侯霸) | 3 | 3 | 1 | Fled to Shu after the Gaoping Tombs incident and guided Jiang Wei's (姜维) northern campaigns; a well-known figure straddling Wei and Shu, front-line in every generation of games. |
| Xiahou Shang (夏侯尚) | 3 | 3 | 2 | General Who Conquers the South; the Jiangling campaign. The least famous member of the Xiahou-and-Cao joint chapter; this axis does not force him level. |

**Parity check**: renown takes values 1/2, **stratified**.

This group is **not level, and that is deliberate**. Xiahou Dun, Xiahou Yuan, Cao Ren, Cao Hong, Cao Chun, Cao Xiu and Cao Zhen — seven people — plus Xiahou Ba from outside the chapter are listed at tier 1:
the first three are the three pillars of Cao-Wei (the old `prominence` pinning all three at tier 2 was one of the main targets of this revision),
Cao Chun's fame among players stands on its own through the Tiger and Leopard Cavalry, Cao Xiu and Cao Zhen were field commanders against Shu and Wu and appear repeatedly in the *Romance*,
and Xiahou Ba became a well-known Wei-and-Shu figure by defecting to Shu. Xiahou Shang and Cao Shuang get 2:
Cao Shuang's **historical weight** is not low (the Gaoping Tombs affair handed over the whole Wei house, so `historicalWeight` is 2), but his image is negative and blurry;
Xiahou Shang has almost no recognisability in the *Romance* or in later works. A joint chapter is Chen Shou's editorial unit, not a folk catchphrase, so it is not forced level.

#### Cao Cao's Five Great Strategists (曹操五大谋士)

| Person | Old prominence | historicalWeight | renown | Basis |
| --- | --- | --- | --- | --- |
| Guo Jia (郭嘉) | 1 | 2 | 1 | The ten victories and ten defeats; a posthumous plan that settled Liaodong; died at thirty-eight, so his biography is short. The saying 「郭嘉不死卧龙不出」 (had Guo Jia not died, the Sleeping Dragon would not have come out) pushes his popular fame to the ceiling. |
| Jia Xu (贾诩) | 1 | 1 | 1 | Urged Li Jue (李傕) to counter-attack Chang'an, rewriting the course of the late Han; later Grand Commandant of Wei. His name as the "venomous strategist" is deeply fixed in the public mind. |
| Xun You (荀攸) | 1 | 2 | 1 | Cao Cao's chief strategist; twelve stratagems at Guandu. Shares a chapter with Xun Yu and Jia Xu; level within the Five Great Strategists. |
| Xun Yu (荀彧) | 1 | 1 | 1 | A talent fit to assist a king; laid out the grand strategy for Cao Cao and recommended talent for twenty years. His death over the empty food box is a major hinge in Wei-Jin history. |
| Cheng Yu (程昱) | 2 | 2 | 1 | Holding the three cities of Yanzhou preserved Cao Cao's base; held Dong'e against Lü Bu to the end. Level within the group. |

**Parity check**: renown is 1 across the group, **level**.

#### The Four Chancellors of Shu Han (蜀汉四相)

| Person | Old prominence | historicalWeight | renown | Basis |
| --- | --- | --- | --- | --- |
| Zhuge Liang (诸葛亮) | 1 | 1 | 1 | 《诸葛亮传》 (his biography) is the only one in 《三国志》 given a scroll to itself among subjects; the 《出师表》 (Memorial on Dispatching the Troops) is in the secondary-school curriculum. The symbol of Chinese wisdom. |
| Fei Yi (费祎) | 2 | 2 | 1 | Kept relations with Wu good during his administration and reined in Jiang Wei's campaigning. Level within the Four Chancellors. |
| Jiang Wan (蒋琬) | 2 | 2 | 1 | The successor Zhuge Liang designated; 「社稷之器」 (a vessel fit for the state). Level within the Four Chancellors. |
| Dong Yun (董允) | 3 | 3 | 1 | Corrected Liu Shan and curbed Huang Hao (黄皓); named in the 《出师表》. His biography is not long, but the Four Chancellors of Shu Han are a fixed grouping and the 《出师表》 is a school text; level within the group. |

**Parity check**: renown is 1 across the group, **level**.

#### The Four Great Commanders of Jiangdong (江东四英杰)

| Person | Old prominence | historicalWeight | renown | Basis |
| --- | --- | --- | --- | --- |
| Lu Su (鲁肃) | 1 | 1 | 1 | The "couch-side plan" that set Wu's national strategy; the leading advocate of allying with Liu against Cao. Level within the Four Great Commanders. |
| Lu Xun (陆逊) | 1 | 1 | 1 | Broke Liu Bei by fire at Yiling and Cao Xiu at Shiting; rose to Chancellor of Wu. Level within the Four Great Commanders. |
| Lü Meng (吕蒙) | 1 | 1 | 1 | Crossed the river in white to take Jingzhou; 「士别三日刮目相看」 (after three days apart, look at a man with fresh eyes). Level within the Four Great Commanders. |
| Zhou Yu (周瑜) | 1 | 1 | 1 | Broke Cao at Red Cliffs and laid the ground for the three-way split; a standalone biography in 《三国志》. First of the Four Great Commanders. |

**Parity check**: renown is 1 across the group, **level**.

#### The Twelve Tiger Officers of Jiangdong (江东十二虎臣, the joint chapter in scroll 10 of the Wu book of 《三国志》)

| Person | Old prominence | historicalWeight | renown | Basis |
| --- | --- | --- | --- | --- |
| Cheng Pu (程普) | 2 | 2 | 1 | A veteran who served three generations; co-commander with Zhou Yu at Red Cliffs. Heads the Twelve Tiger Officers chapter; level within the group. |
| Chen Wu (陈武) | 2 | 3 | 1 | Commander of the Lujiang elite; killed at Hefei. Extremely short biography, but a formal member of the Twelve Tiger Officers; level within the group. |
| Ding Feng (丁奉) | 2 | 2 | 1 | Charged with short blades in the snow to break Wei at Dongxing; served four rulers. Level within the Twelve Tiger Officers, and also a late-period general. |
| Gan Ning (甘宁) | 2 | 2 | 1 | Started out as a "brocade-sail" river bandit; raided the Wei camp with a hundred horsemen; Sun Quan (孙权) said 「孟德有张辽，孤有兴霸」 (Cao Cao has Zhang Liao, I have Xingba). One of the best-known of the Twelve Tiger Officers. |
| Han Dang (韩当) | 2 | 3 | 1 | A veteran of three generations who rose with Sun Jian (孙坚). Level within the Twelve Tiger Officers. |
| Huang Gai (黄盖) | 2 | 3 | 1 | The self-inflicted-wound ruse and the fire-ship false surrender at Red Cliffs; 「周瑜打黄盖」 (Zhou Yu beats Huang Gai) became a xiehouyu. Extremely short biography and top-tier fame; level within the group. |
| Jiang Qin (蒋钦) | 2 | 3 | 1 | Campaigned with Sun Ce (孙策), later changed his ways and took to study. Level within the Twelve Tiger Officers. |
| Ling Tong (凌统) | 2 | 3 | 1 | Fought hard as rearguard at Hefei; carried a blood feud with Gan Ning over his father. Level within the Twelve Tiger Officers. |
| Pan Zhang (潘璋) | 2 | 3 | 1 | The man who actually captured Guan Yu. Level within the Twelve Tiger Officers. |
| Xu Sheng (徐盛) | 2 | 3 | 1 | Repelled Cao Pi (曹丕) with a decoy wall; held Ruxu against Wei. Level within the Twelve Tiger Officers. |
| Zhou Tai (周泰) | 2 | 3 | 1 | Repeatedly saved Sun Quan from the thick of battle, his body covered with dozens of wounds, which Sun Quan pointed to one by one while pouring wine. Level within the Twelve Tiger Officers — the old tiering pinned him and Gan Ning together at tier 2, out of all proportion to the Five Elite Generals sitting at tier 1. |
| Dong Xi (董袭) | 3 | 3 | 1 | Refused to abandon his capsizing ship in a storm at Ruxu and drowned. Extremely short biography; a formal member of the Twelve Tiger Officers; level within the group. |

**Parity check**: renown is 1 across the group, **level**.

#### Under Yuan Shao: the Hebei notables and the Four Pillars

| Person | Old prominence | historicalWeight | renown | Basis |
| --- | --- | --- | --- | --- |
| Chen Lin (陈琳) | 2 | 2 | 2 | One of the Seven Masters of Jian'an; his proclamation denouncing Cao — 「矢在弦上」 (the arrow is on the string) — cured Cao Cao's headache. Known more as a writer than a strategist; positioned as a civil official in the game. |
| Ju Shou (沮授) | 2 | 2 | 1 | Urged Yuan Shao to take the Son of Heaven in hand and warned against advancing rashly; ignored, and defeat followed; captured and refused to submit. Core of the Hebei strategists; the highest intelligence stat in Yuan Shao's faction in the game. |
| Shen Pei (审配) | 2 | 2 | 1 | Held Ye until the walls fell, unbending, and died facing north. Core of the Hebei strategists; level within the group. |
| Tian Feng (田丰) | 2 | 2 | 1 | Blunt to the point of offending his lord; warned Yuan Shao not to rush into Guandu; killed after the defeat. Core of the Hebei strategists; level within the group. |
| Xin Pi (辛毗) | 2 | 2 | 2 | Served the Yuan clan first, then went over to Cao; stood at the camp gate with the imperial staff to stop Sima Yi (司马懿) from giving battle. Clear in the record, shallow in public impression. |
| Xu You (许攸) | 2 | 3 | 1 | His plan to burn Wuchao directly decided Guandu; later killed for insolence. No standalone biography, hence historical tier 3, fame tier 1. |
| Feng Ji (逢纪) | 3 | 3 | 2 | The scheme that urged Yuan Shao to seize Jizhou; later helped Yuan Shang push out Tian Feng. Second rank of the Hebei strategists, less famous than the five above. |
| Guo Tu (郭图) | 3 | 3 | 1 | Argued for battle at Guandu and slandered Zhang He into defecting to Cao. In the *Romance*, the man who drove Yuan Shao's ruin; level within the Hebei strategists. |
| Xin Ping (辛评) | 3 | 4 | 3 | Yuan Tan's adviser, Xin Pi's elder brother; died after Ye fell. |
| Xun Chen (荀谌) | 3 | 4 | 2 | Talked Han Fu (韩馥) into ceding Jizhou — a province taken with one speech; Xun Yu's elder brother. |
| Wen Chou (文丑) | 3 | 4 | 1 | Broken and killed by the Cao army at Yanjin. Only a few lines in the histories; paired by name with Yan Liang; level within the Four Pillars. |
| Yan Liang (颜良) | 3 | 4 | 1 | Run through by Guan Yu at Baima; Kong Rong (孔融) called him 「万人之敌」 (a match for ten thousand men). Only a few lines in the histories, yet always Yuan Shao's representative fighter in the *Romance* and in games; level within the Four Pillars. |
| Gao Lan (高览) | 4 | 4 | 1 | Surrendered to Cao Cao at Guandu along with Zhang He. Only a few lines in the histories, but the "Four Pillars of Hebei" is a fixed folk grouping and every generation of games includes him; level with Yan Liang, Wen Chou and Zhang He — all four at tier 1, the clearest case in this table of "fame resting on the grouping, not on the sources". |

**Parity check**: renown takes values 1/2/3, **stratified**.

Look at the two sub-groups separately.

**The Four Pillars** (Yan Liang, Wen Chou, Zhang He, Gao Lan) are all tier 1, **level**. This is the purest case of "fame resting on the grouping, not on the sources":
Yan Liang, Wen Chou and Gao Lan have only a few lines each in the histories (`historicalWeight` 4),
but the Four Pillars is a fixed folk grouping that every generation of works includes, and leaving one out would mean the tiering is wrong. Zhang He is also one of the Five Elite Generals; both groups are level.

**The Hebei strategists** split into two layers, and this layer is **deliberately stratified**: Tian Feng, Ju Shou, Shen Pei, Xu You and Guo Tu are tier 1 —
the first three were the core strategists of Yuan Shao's camp and each has a famous end, Xu You's Wuchao plan directly decided Guandu,
and Guo Tu is the man who drives Yuan Shao's ruin in the *Romance*. Feng Ji, Xin Ping, Xun Chen, Xin Pi and Chen Lin get 2:
Xun Chen's "a province taken with one speech" and Chen Lin's proclamation against Cao are both well known, but all four are visibly a notch lower in presence in the *Romance*.
Unlike the Four Pillars, "the Hebei notables" is not a catchphrase with a fixed roster, so there is no constraint forcing it level.

#### Late-period Three Kingdoms generals

| Person | Old prominence | historicalWeight | renown | Basis |
| --- | --- | --- | --- | --- |
| Deng Ai (邓艾) | 1 | 1 | 1 | Crossed Yinping by stealth and destroyed Shu; an extremely long biography. His stammer, his tuntian military farms (屯田) and his conquest of a state are all widely known; together with Jiang Wei the number-one late-period general. |
| Jiang Wei (姜维) | 1 | 1 | 1 | Carried on Zhuge Liang's northern campaigns nine times; the last pillar of Shu Han; a long biography. The protagonist of the second half of the *Romance* and the core of late-period game scenarios; level with Deng Ai within the late-period generals. |
| Zhong Hui (钟会) | 2 | 1 | 1 | Split the advance with Deng Ai to destroy Shu, then held Chengdu in revolt and was killed. The executor of Shu Han's endgame; level within the late-period generals. |
| Guo Huai (郭淮) | 2 | 2 | 1 | Commanded Yong and Liang for thirty years; Jiang Wei's standing opponent in the northern campaigns. On a par with Deng Ai and Chen Tai among the late-period generals. |
| Sima Shi (司马师) | 2 | 2 | 1 | Deposed Cao Fang the Prince of Qi and put down Guanqiu Jian (毌丘俭), steadying the Sima clan's hold on power. One of the rulers in late-period game scenarios. |
| Sima Zhao (司马昭) | 2 | 1 | 1 | 「司马昭之心」 (Sima Zhao's intent) became an idiom; sent Zhong Hui and Deng Ai to destroy Shu. |
| Yang Hu (羊祜) | 2 | 1 | 1 | Commanded Jingzhou for ten years; the Yang-Lu friendship with Lu Kang; recommended Du Yu, which led to the conquest of Wu. A long biography in 《晋书》 (*Book of Jin*); level within the late-period generals. |
| Du Yu (杜预) | 2 | 1 | 1 | Commander of the conquest of Wu; 「势如破竹」 (like splitting bamboo) originates with him. Also annotated the 《左传》 (*Zuo Commentary*) and is enshrined in both the civil and the martial temples; level within the late-period generals. |
| Lu Kang (陆抗) | 2 | 1 | 1 | Broke Bu Chan at Xiling; the Yang-Lu friendship with Yang Hu; the last pillar of Wu. Level with Yang Hu and Du Yu within the late-period generals. |
| Ding Feng (丁奉) | 2 | 2 | 1 | Charged with short blades in the snow to break Wei at Dongxing; served four rulers. Level within the Twelve Tiger Officers, and also a late-period general. |
| Zhuge Ke (诸葛恪) | 2 | 2 | 1 | Pacified the Shanyue and gained forty thousand armoured troops; after the victory at Dongxing came the disaster at Xincheng, and his clan was exterminated. The foremost late-period power-holder in Wu. |
| Xiahou Ba (夏侯霸) | 3 | 3 | 1 | Fled to Shu after the Gaoping Tombs incident and guided Jiang Wei's northern campaigns; a well-known figure straddling Wei and Shu, front-line in every generation of games. |
| Liao Hua (廖化) | 3 | 3 | 1 | Rose from Guan Yu's clerk to General of Chariots of the Right, serving three reigns. 「蜀中无大将，廖化作先锋」 (with no great general left in Shu, Liao Hua takes the vanguard) is one of the most widely circulated Three Kingdoms proverbs; his fame far exceeds his weight in the sources. |
| Chen Tai (陈泰) | 3 | 2 | 2 | Guo Huai's successor as commander in Yong and Liang; lifted the siege of Didao and checked Jiang Wei. A substance-over-fame figure among the late-period generals. |
| Wang Ji (王基) | 3 | 3 | 2 | Put down Zhuge Dan and held off Wu at Jiangling; a late-Wei general and scholar both. |
| Guanqiu Jian (毌丘俭) | 3 | 2 | 2 | Campaigned east against Goguryeo and cut an inscription recording the feat; later rose against Sima Shi and failed. One of the three Huainan rebellions. |
| Wen Qin (文钦) | 3 | 3 | 2 | Rebelled alongside Guanqiu Jian and fled to Wu; later killed by Zhuge Dan. One of the three Huainan rebellions. |
| Wang Ling (王凌) | 3 | 3 | 2 | Plotted to enthrone Cao Biao the Prince of Chu; first of the three Huainan rebellions. |
| Zhuge Dan (诸葛诞) | 3 | 3 | 2 | Held Shouchun in alliance with Wu and failed; third of the three Huainan rebellions. Subject of the verdict 「蜀得其龙，吴得其虎，魏得其狗」 (Shu got the dragon, Wu got the tiger, Wei got the dog). |
| Wang Jun (王濬) | 3 | 2 | 2 | Built tower ships to attack Wu; 「王濬楼船下益州」 (Wang Jun's tower ships come down from Yizhou) entered Tang poetry. First merit in the conquest of Wu. |
| Jia Chong (贾充) | 3 | 2 | 2 | Had Cheng Ji assassinate Cao Mao; oversaw the 《晋律》 (*Jin Code*) and the debate on conquering Wu. The foremost power-holder of early Jin; heavy historical weight, negative image. |
| Wei Guan (卫瓘) | 3 | 3 | 2 | As supervising officer he arrested Deng Ai and crushed Zhong Hui's revolt; the man who cleaned up Shu's endgame. |
| Zhang Yi (张翼) | 3 | 3 | 2 | Repeatedly argued that Jiang Wei should not exhaust the army, and campaigned with him anyway. One of the four late-period Shu Han generals. |
| Huo Yi (霍弋) | 3 | 3 | 3 | Son of Huo Jun; commander of Nanzhong; surrendered his whole commandery after Shu fell. |
| Luo Xian (罗宪) | 3 | 3 | 2 | After Shu fell, held Yong'an against the Wu army for six months, then went over to Jin. The defensive-commander representative among the late-period generals. |

**Parity check**: renown takes values 1/2/3, **stratified**.

This is not a fixed roster from the histories or from folk tradition; it is a check set drawn up ad hoc along the lines of "the people who militarily held things together in the late Three Kingdoms (roughly from Zhuge Liang's death in 234 to the conquest of Wu in 280)",
used to verify that late-period figures have not been systematically underrated — under the old `prominence`, nearly every late-period general sat at tier 2 or below.

13 at tier 1: Deng Ai, Jiang Wei (the two protagonists of the late-period narrative), Zhong Hui, Guo Huai, Sima Shi, Sima Zhao, Yang Hu, Du Yu, Lu Kang,
Ding Feng, Zhuge Ke, Xiahou Ba, Liao Hua. Yang Hu, Du Yu and Lu Kang are level because the two allusions "the Yang-Lu friendship" and 「势如破竹」
carried all three into public memory as a set; Liao Hua rides on the proverb 「蜀中无大将」, which has nothing to do with his weight in the sources.

12 at tier 2: Chen Tai, Wang Ji, Guanqiu Jian, Wen Qin, Wang Ling, Zhuge Dan (the substance-over-fame figures of the three Huainan rebellions and the Yong-Liang theatre, hard records and thin reputations),
Wang Jun, Jia Chong, Wei Guan, Zhang Yi, Huo Yi, Luo Xian. This layer carries no levelness constraint; the stratification reflects real differences in how widely they spread.

---

## 2. Evidence that the two axes are separate: the gap table

If the two axes were really one axis, everyone's `historicalWeight` and `renown` should be roughly equal. Measured, they are not.

#### A. Fame far exceeds weight in the sources (historicalWeight − renown ≥ 2, 44 people)

| Person | historicalWeight | renown | Gap | Basis |
| --- | --- | --- | --- | --- |
| Diaochan (貂蝉) | 4 | 1 | +3 | A *Romance* figure. The core of the chain-of-stratagems plot and one of the four great beauties of folk tradition; the histories give only one unnamed line, 「布与卓侍婢私通」 (Lü Bu had an affair with one of Zhuo's maidservants) — essentially no source basis and top-tier fame. |
| Lady Sun (孙夫人) | 4 | 1 | +3 | Sun Quan's sister, married to Liu Bei; quick and fierce, with over a hundred maidservants standing attendance with blades drawn. Only a few lines in the histories, while the *Romance*'s two set pieces — the Ganlu Temple and the river interception to seize Ah Dou — plus fixed appearances in every generation of games put her fame at tier 1. |
| Wen Chou (文丑) | 4 | 1 | +3 | Broken and killed by the Cao army at Yanjin. Only a few lines in the histories; paired by name with Yan Liang; level within the Four Pillars. |
| Yan Liang (颜良) | 4 | 1 | +3 | Run through by Guan Yu at Baima; Kong Rong called him 「万人之敌」 (a match for ten thousand men). Only a few lines in the histories, yet always Yuan Shao's representative fighter in the *Romance* and in games; level within the Four Pillars. |
| Zhang Ren (张任) | 4 | 1 | +3 | A general under Liu Zhang (刘璋); captured and refusing to submit, he said 「老臣终不复事二主」 (this old servant will not serve a second lord). The histories give only a few lines in 《益部耆旧杂记》 (*Miscellaneous Records of the Elders of Yizhou*); in the *Romance* he shoots Pang Tong dead, and in every generation of games he is the first general of western Shu — historical tier 4, fame tier 1, a gap sample. |
| Gao Lan (高览) | 4 | 1 | +3 | Surrendered to Cao Cao at Guandu along with Zhang He. Only a few lines in the histories, but the "Four Pillars of Hebei" is a fixed folk grouping and every generation of games includes him; level with Yan Liang, Wen Chou and Zhang He — all four at tier 1, the clearest case in this table of "fame resting on the grouping, not on the sources". |
| Hua Xiong (华雄) | 4 | 1 | +3 | The histories give only the one line 「为孙坚所枭」 (beheaded by Sun Jian); the *Romance*'s "slaying Hua Xiong while the wine was still warm" is one of the most famous passages in the whole book, and every generation of games includes him — historical tier 4, fame tier 1, the widest gap in this table. |
| Chen Wu (陈武) | 3 | 1 | +2 | Commander of the Lujiang elite; killed at Hefei. Extremely short biography, but a formal member of the Twelve Tiger Officers; level within the group. |
| Dian Wei (典韦) | 3 | 1 | +2 | Died shielding Cao Cao at Wancheng; twin halberds weighing eighty jin. Extremely short biography, but paired with Xu Chu as the two bodyguard paragons, near the top of the *Romance*'s combat rankings, and always a top-tier Wei strength stat in games — the old tiering pinned him at tier 2 while the Five Elite Generals sat at tier 1, which does not add up. |
| Gao Shun (高顺) | 3 | 1 | +2 | His seven hundred Camp-Breakers were irresistible, beating Xiahou Dun and defeating Liu Bei. His biography is only a few lines appended to Lü Bu's, yet the name of the Camp-Breakers gives him very high fame among players. |
| Han Dang (韩当) | 3 | 1 | +2 | A veteran of three generations who rose with Sun Jian. Level within the Twelve Tiger Officers. |
| Huang Gai (黄盖) | 3 | 1 | +2 | The self-inflicted-wound ruse and the fire-ship false surrender at Red Cliffs; 「周瑜打黄盖」 became a xiehouyu. Extremely short biography and top-tier fame; level within the group. |
| Jiang Qin (蒋钦) | 3 | 1 | +2 | Campaigned with Sun Ce, later changed his ways and took to study. Level within the Twelve Tiger Officers. |
| Yue Jin (乐进) | 3 | 1 | +2 | First up the wall in every battle; his biography is the shortest of the five — tier 3 by length in the histories and tier 1 by fame, exactly the two axes coming apart. The Five Elite Generals are a fixed grouping, so the group is level. |
| Ling Tong (凌统) | 3 | 1 | +2 | Fought hard as rearguard at Hefei; carried a blood feud with Gan Ning over his father. Level within the Twelve Tiger Officers. |
| Ma Su (马谡) | 3 | 1 | +2 | Lost Jieting and was executed; 「挥泪斩马谡」 (beheading Ma Su in tears) became a stock allusion. His biography, appended to Ma Liang's, is extremely short; fame is top-tier. |
| Pan Zhang (潘璋) | 3 | 1 | +2 | The man who actually captured Guan Yu. Level within the Twelve Tiger Officers. |
| Xu Chu (许褚) | 3 | 1 | +2 | The "Tiger Fool"; guarded Cao Cao in a single boat at the Wei River and glared Ma Chao into not moving. Level with Dian Wei; always a top-tier Wei strength stat in games. |
| Xu Sheng (徐盛) | 3 | 1 | +2 | Repelled Cao Pi with a decoy wall; held Ruxu against Wei. Level within the Twelve Tiger Officers. |
| Xu Shu (徐庶) | 3 | 1 | +2 | Recommended Zhuge Liang as he rode away; went over to Cao's camp because his mother was seized; 「徐庶进曹营——一言不发」 (Xu Shu enters Cao's camp — and says not a word) became a xiehouyu. His biography is only a few lines appended to Zhuge Liang's; fame is top-tier. |
| Xu You (许攸) | 3 | 1 | +2 | His plan to burn Wuchao directly decided Guandu; later killed for insolence. No standalone biography, hence historical tier 3, fame tier 1. |
| Zhang Song (张松) | 3 | 1 | +2 | Presented the map of western Shu and brought Liu Bei into Shu. His biography is appended to Fa Zheng's; the *Romance*'s photographic-memory episode keeps his fame high. |
| Zhou Tai (周泰) | 3 | 1 | +2 | Repeatedly saved Sun Quan from the thick of battle, his body covered with dozens of wounds, which Sun Quan pointed to one by one while pouring wine. Level within the Twelve Tiger Officers — the old tiering pinned him and Gan Ning together at tier 2, out of all proportion to the Five Elite Generals sitting at tier 1. |
| Cao Chun (曹纯) | 3 | 1 | +2 | Commanded the Tiger and Leopard Cavalry; pursued Liu Bei at Changban and beheaded Yuan Tan at Nanpi. His biography is only a few lines appended to Cao Ren's, but the name of the Tiger and Leopard Cavalry makes him familiar to players; level within the group. |
| Cao Zhang (曹彰) | 3 | 1 | +2 | The "yellow-bearded boy"; campaigned north against the Wuhuan and killed wild beasts bare-handed. Short biography, but his screen time in the *Romance* and his fixed positioning in games as "the fierce general of the imperial clan" keep his fame high. |
| Dong Xi (董袭) | 3 | 1 | +2 | Refused to abandon his capsizing ship in a storm at Ruxu and drowned. Extremely short biography; a formal member of the Twelve Tiger Officers; level within the group. |
| Dong Yun (董允) | 3 | 1 | +2 | Corrected Liu Shan and curbed Huang Hao; named in the 《出师表》. His biography is not long, but the Four Chancellors of Shu Han are a fixed grouping and the 《出师表》 is a school text; level within the group. |
| Guan Ping (关平) | 4 | 2 | +2 | Guan Yu's son; died with his father at Linju. The *Romance* makes him an adopted son and greatly expands his part; a standing presence in games. |
| Guan Suo (关索) | 4 | 2 | +2 | A *Romance* figure. Has a part in the southern campaign; no such person in the histories. Not unknown in folk ballads and regional opera, and most generations of games include him too. |
| Guan Xing (关兴) | 4 | 2 | +2 | Guan Yu's son; died young. In the *Romance*, paired with Zhang Bao as vanguards in the early northern campaigns; a fixed appearance in games. |
| Guo Si (郭汜) | 3 | 1 | +2 | Threw Chang'an into chaos together with Li Jue, the two then attacking each other until the Son of Heaven was driven into flight. The central antagonists of the 194–196 scenarios; level with Li Jue. |
| Guo Tu (郭图) | 3 | 1 | +2 | Argued for battle at Guandu and slandered Zhang He into defecting to Cao. In the *Romance*, the man who drove Yuan Shao's ruin; level within the Hebei strategists. |
| Liao Hua (廖化) | 3 | 1 | +2 | Rose from Guan Yu's clerk to General of Chariots of the Right, serving three reigns. 「蜀中无大将，廖化作先锋」 is one of the most widely circulated Three Kingdoms proverbs; his fame far exceeds his weight in the sources. |
| Ma Dai (马岱) | 3 | 1 | +2 | Ma Chao's younger cousin; cut down Wei Yan. A fixed member of the Xiliang generals in the *Romance* and in games; fame sits solidly front-line. |
| Meng Huo (孟获) | 3 | 1 | +2 | Captured and released seven times (《汉晋春秋》, *Spring and Autumn of Han and Jin*; 《华阳国志》, *Chronicles of Huayang*), bringing both the Yi peoples and the Han of Nanzhong to submission. The protagonist of the *Romance*'s southern campaign and the ruler of the Nanman faction in the game; fame tier 1. |
| Xiahou Ba (夏侯霸) | 3 | 1 | +2 | Fled to Shu after the Gaoping Tombs incident and guided Jiang Wei's northern campaigns; a well-known figure straddling Wei and Shu, front-line in every generation of games. |
| Xun Chen (荀谌) | 4 | 2 | +2 | Talked Han Fu into ceding Jizhou — a province taken with one speech; Xun Yu's elder brother. |
| Yan Yan (严颜) | 4 | 2 | +2 | 「但有断头将军，无有降将军」 (there are only beheaded generals here, no surrendering ones); released in honour by Zhang Fei. One passage in the histories, greatly embellished in the *Romance*. |
| Zhou Cang (周仓) | 4 | 2 | +2 | A *Romance* figure. Guan Yu's blade-bearer, who held Maicheng with him and died there; no such person in the histories. High fame through the Guandi temple cult and opera; a standing presence in games. |
| Li Ru (李儒) | 4 | 2 | +2 | Dong Zhuo's Prefect of the Palace Gentlemen; poisoned the Prince of Hongnong. In the *Romance* he is Dong Zhuo's chief strategist, with a part far beyond the histories; a fixed appearance in games. |
| Pan Feng (潘凤) | 4 | 2 | +2 | A *Romance* figure. Han Fu's senior general, cut down by Hua Xiong; the line 「吾有上将潘凤」 (I have my senior general Pan Feng) is extremely well known in contemporary Chinese internet culture, entirely decoupled from his weight in the sources. |
| Da Qiao (大桥) | 4 | 2 | +2 | Sun Ce's wife, elder of the two Qiao sisters; 「铜雀春深锁二乔」 (deep in spring the Bronze Bird Terrace would have locked away the two Qiaos) makes her fame very high, while the sources give one line. |
| Xiao Qiao (小桥) | 4 | 2 | +2 | Zhou Yu's wife, named together with her elder sister as the two Qiaos; as above. |
| Zhang Bao (张苞) | 4 | 2 | +2 | Zhang Fei's son; died young. In the *Romance*, paired with Guan Xing as a vanguard in the northern campaigns; a fixed appearance in games. |

#### B. Weight in the sources exceeds fame (renown − historicalWeight ≥ 1, 27 people)

| Person | historicalWeight | renown | Gap | Basis |
| --- | --- | --- | --- | --- |
| Cai Yong (蔡邕) | 1 | 2 | -1 | The foremost man of letters of the late Han; continued the 《汉记》 (*Records of Han*) and fixed the Xiping Stone Classics. A long biography in 《后汉书》 (*Book of the Later Han*), hence historical tier 1, while the public mostly knows his name only as "Cai Wenji's father" and from his weeping over Dong Zhuo. |
| Huangfu Song (皇甫嵩) | 1 | 2 | -1 | The man who actually commanded the suppression of the Yellow Turbans; a long biography in 《后汉书》; the last great general of the late Han. Indispensable to Yellow Turban scenarios, but his popular fame falls short of the *Romance* characters, hence historical tier 1, fame tier 2. |
| Liu Yan (刘焉) | 1 | 2 | -1 | First proposed abolishing inspectors in favour of governors, which directly produced the warlord provinces — the institutional starting point of the late-Han break-up; set himself up in Yizhou. Historical influence far exceeds fame, hence historical tier 1, fame tier 2. |
| Xu Jing (许靖) | 2 | 3 | -1 | Valued for his reputation; fled to Jiaozhou and then entered Shu as Minister over the Masses. His own biography records the verdict 「名过其实」 (his name exceeded the substance). |
| Zhang Ji (张既) | 2 | 3 | -1 | Inspector of Liangzhou; kept the lands west of the Yellow River settled for over a decade. A detailed biography with no famous set piece. |
| Zheng Xuan (郑玄) | 1 | 2 | -1 | Annotated the classics across the board; Zheng scholarship dominated the next millennium of classical studies. A long biography in 《后汉书》. Nothing to do with military or civil governance; usually a special character in games. |
| Budugen (步度根) | 3 | 4 | -1 | A Xianbei chieftain; fought Kebineng, later rebelled against Wei and was beheaded. |
| Du Qiong (杜琼) | 3 | 4 | -1 | A master of numerology in Shu; used prophetic texts to argue 「代汉者当涂高」 (the one who replaces Han will be "high on the road"). |
| Du Wei (杜微) | 3 | 4 | -1 | Deaf and unwilling to serve; Zhuge Liang conversed with him by writing board. |
| Fu Xun (傅巽) | 3 | 4 | -1 | The scheme that persuaded Liu Cong to surrender to Cao. |
| Han Song (韩嵩) | 3 | 4 | -1 | Returned from a mission to Xu praising Cao Cao; Liu Biao (刘表) nearly had him killed. |
| He Yong (何颙) | 3 | 4 | -1 | A notable of Runan; recognised Xun Yu as a talent fit to assist a king. |
| He Yan (何晏) | 2 | 3 | -1 | Founder of Zhengshi-era Xuanxue; the powdered dandy He; executed along with Cao Shuang. Heavy weight in intellectual history, shallow public impression. |
| Huang Wan (黄琬) | 3 | 4 | -1 | Plotted with Wang Yun (王允) to kill Dong Zhuo; later killed by Li Jue. |
| Huchuquan (呼厨泉) | 3 | 4 | -1 | Chanyu of the Southern Xiongnu; surrendered to Cao Cao and was kept at Ye, his people divided into five divisions. |
| Hu Zhao (胡昭) | 3 | 4 | -1 | Lived in seclusion and never served; a fine calligrapher; once Sima Yi's teacher. |
| Lü Yi (吕乂) | 3 | 4 | -1 | Prefect of the Masters of Writing in Shu Han; plain and austere by nature; the histories judge him 「当官宽济」 (lenient and effective in office). |
| Pang Xi (庞羲) | 3 | 4 | -1 | Grand Administrator of Baxi; Liu Zhang's in-law; held troops and stood on his own weight. |
| Peng Yang (彭羕) | 3 | 4 | -1 | Rose suddenly and turned arrogant and unruly; died in prison. |
| Shisun Rui (士孙瑞) | 3 | 4 | -1 | Plotted with Wang Yun to kill Dong Zhuo; took no credit for the deed. |
| Tanshihuai (檀石槐) | 2 | 3 | -1 | Unified the Xianbei and split them into three divisions; the greatest threat on the Eastern Han's northern frontier. Died before the Three Kingdoms narrative begins, hence low fame. |
| Xiang Lang (向朗) | 3 | 4 | -1 | Dismissed for not reporting Ma Su's flight; devoted his later years to the classics. |
| Xun Yue (荀悦) | 3 | 4 | -1 | Author of the 《汉纪》 (*Chronicle of Han*); a noted practitioner of annalistic historiography. |
| Zao Zhi (枣祗) | 2 | 3 | -1 | Pushed hard for the land-division method; the actual designer of the tuntian military farm system. Decisive for Cao-Wei's national strength, with essentially no fame; historical tier 2, fame tier 3. |
| Ze Rong (笮融) | 2 | 3 | -1 | Built great Buddhist shrines and held bathing-the-Buddha ceremonies with public feasts — one of the earliest explicit records of Buddhist activity in China; also massacred several grand administrators. Heavy weight in religious history, unknown to the public. |
| Zhang Wen (张温) | 3 | 4 | -1 | Grand Commandant; campaigned in Liangzhou; Sun Jian once asked him to behead Dong Zhuo in his camp. |
| Beigong Boyu (北宫伯玉) | 3 | 4 | -1 | Chieftain of the Huangzhong auxiliary Hu; the trigger of the Liangzhou revolt. |

### The gap runs one way

The maximum of `historicalWeight − renown` is **+3** (Diaochan, Hua Xiong, Yan Liang, Wen Chou, Gao Lan, Zhang Ren, Lady Sun),
and the minimum is only **−1**. In other words: **the *Romance* and folk transmission only ever push people up; they almost never push down someone the histories treat as important.**

The 27 people who differ by one tier the other way (Zheng Xuan, Cai Yong, Liu Yan, Huangfu Song, Zao Zhi, Tanshihuai, Ze Rong, He Yan, Zhang Ji …)
form a list of "important people the *Romance* ignored" — Liu Yan first proposed abolishing inspectors in favour of governors, Zao Zhi designed the tuntian system,
Ze Rong left the earliest explicit record of Buddhist activity in China; all of them carry enough historical weight for tier 1 or 2, and all of them barely exist in the *Romance*.
That list is useful for scenario copy and encyclopedia display, and useless for map display tiers — which is exactly why the two numbers have to be stored separately.

---

## 3. Composition of the 120 people at renown tier 1

| Group | Count |
| --- | --- |
| 东吴·江东十二虎臣 | 12 |
| 曹魏·诸夏侯曹 | 8 |
| 司马氏与西晋 | 6 |
| 曹魏·将领 | 5 |
| 蜀汉·五虎将 | 5 |
| 曹操·五大谋士 | 5 |
| 曹魏·五子良将 | 5 |
| 袁绍集团·河北谋士 | 5 |
| 曹魏·君主与宗室 | 4 |
| 董卓集团与凉州军 | 4 |
| 蜀汉·谋臣 | 4 |
| 蜀汉·将领 | 4 |
| 吕布集团 | 4 |
| 东吴·四英杰 | 4 |
| 蜀汉·四相 | 4 |
| 东吴·将领 | 4 |
| 东吴·文臣 | 3 |
| 东吴·孙氏宗室 | 3 |
| 益州刘焉刘璋集团 | 3 |
| 袁绍集团·四庭柱 | 3 |
| 曹魏·文臣 | 2 |
| 蜀汉·君主与宗室 | 2 |
| 汉室宗亲与朝臣 | 2 |
| 曹魏·宿卫 | 2 |
| 西凉马腾集团 | 2 |
| 公孙瓒集团 | 1 |
| 荆州刘表集团 | 1 |
| 袁绍集团·其他 | 1 |
| 袁术集团 | 1 |
| 西凉韩遂集团 | 1 |
| 方术与医术 | 1 |
| 北海孔融集团 | 1 |
| 名士与学者 | 1 |
| 割据群雄 | 1 |
| 会稽王朗集团 | 1 |
| 黄巾与太平道 | 1 |
| 汉中张鲁集团 | 1 |
| 张济集团 | 1 |
| 南中夷帅 | 1 |
| 女性 | 1 |

(The `group` values are data identifiers and stay in Chinese; in order: Wu · Twelve Tiger Officers of Jiangdong; Wei · Xiahou and Cao; the Sima clan and Western Jin; Wei · generals; Shu Han · Five Tiger Generals; Cao Cao · Five Great Strategists; Wei · Five Elite Generals; Yuan Shao's camp · Hebei strategists; Wei · rulers and imperial kin; Dong Zhuo's camp and the Liangzhou army; Shu Han · strategists; Shu Han · generals; Lü Bu's camp; Wu · Four Great Commanders; Shu Han · Four Chancellors; Wu · generals; Wu · civil officials; Wu · the Sun clan; Liu Yan and Liu Zhang's camp in Yizhou; Yuan Shao's camp · Four Pillars; Wei · civil officials; Shu Han · rulers and imperial kin; Han imperial kin and court officials; Wei · bodyguards; Ma Teng's camp in Xiliang; Gongsun Zan's camp; Liu Biao's camp in Jingzhou; Yuan Shao's camp · other; Yuan Shu's camp; Han Sui's camp in Xiliang; occultists and physicians; Kong Rong's camp in Beihai; notables and scholars; independent warlords; Wang Lang's camp in Kuaiji; Yellow Turbans and the Way of Great Peace; Zhang Lu's camp in Hanzhong; Zhang Ji's camp; the Yi chieftains of Nanzhong; women.)

Counted by faction: the Cao-Wei line 31 (曹魏·* 26 + the Five Great Strategists 5), the Sima clan and Western Jin 6, the Shu Han line 19, the Wu line 26,
the Yuan Shao line 9, the Dong Zhuo and Lü Bu line 8; the remaining 21 are spread across Gongsun Zan, Jingzhou, Yizhou, Xiliang, Hanzhong, the Yellow Turbans, Nanzhong,
the Han court officials, the notables, the occultists and the women.

**Tier 1 under the old `prominence` and still tier 1 under the new `renown`**: all 39 retained, not one demoted.
Splitting the field was not about kicking anyone out; it was about bringing in the people who belonged.

**Among the newcomers to tier 1, the 16 who were at old `prominence` 3–4**:
Cao Chun, Cao Zhang, Dong Xi, Dong Yun, Guo Si, Guo Tu, Liao Hua, Ma Dai, Meng Huo, Lady Sun, Wen Chou, Xiahou Ba, Yan Liang, Zhang Ren, Gao Lan, Hua Xiong.
These 16 are the substance of this revision — their source material really is thin,
but on fixed folk groupings, *Romance* set pieces or proverbs they occupy a tier-1 position.

---

## 4. How to use the fields

### Map zoom display

Use `renown` directly as the tier: far zoom draws tier 1 only, mid zoom adds tier 2, near zoom adds tier 3, and tier 4 appears only at maximum zoom.
120 / 234 / 397 / 578 are the cumulative counts of the four tiers — a smooth gradient, with no tier suddenly taking on two hundred people.

### UI sorting

Lists sort by `renown` ascending by default, ties broken by `historicalWeight` ascending.
That gives "Guan Yu before Zhang He, Zhang He before Zhang Ji", which matches intuition;
a scholarly-oriented view sorts the other way, by `historicalWeight`, and Xun Yu, Zhong Yao (钟繇), Zheng Xuan and Cai Yong float to the top.

### Prior strength for deriving stats

The anchor method in `docs/OFFICER-ANCHORS.en.md` needs to know "how much deviation can this person's numbers tolerate".
`renown` is that tolerance:

| renown | Anchor constraint | Meaning |
| --- | --- | --- |
| 1 | Hard constraint | Players have a definite expectation; the numbers must land in the anchor's neighbourhood, and any deviation must be defended separately in the document |
| 2 | Medium constraint | There is a rough expectation; floating within the same band is allowed |
| 3 | Soft constraint | Only internal consistency is required |
| 4 | No constraint | Derive mechanically from the source evidence |

Note the direction: **`renown` determines how closely the numbers will be scrutinised, not the numbers themselves.**
Hua Xiong at renown 1 means his strength stat has to hold up under player scrutiny; it does not mean his strength ought to be high.
Converting fame directly into combat power is just another way of stirring the two axes back together.

---

## 5. Boundaries of the standard

- There are only two kinds of evidence for the tiering: **the weight of the record in public-domain historical sources**, and **public-domain facts of transmission —
  the 《三国演义》 (*Romance of the Three Kingdoms*), idioms and proverbs, primer stories, fixed folk groupings and so on**.
- **No commercial game's character rating table is referenced or re-derived.** Where the text says "appears consistently in Three Kingdoms works", that is a statement about a publicly observable fact
  (whether a person exists as a character); it involves no protected stat or rating data.
- *Romance*-invented characters (`fictional=true`) all get `historicalWeight` 4, with `renown` assigned as usual and
  `basis` beginning with "演义形象" (a *Romance* figure); 28 people in total.
- This document and its companion JSON **do not modify `officers.json`**. The `prominence` field is kept as it is,
  and consumers decide for themselves which of the new fields to switch to.

## 6. File structure

`lib/game/data/officer-renown.json` is an object at the top level (consistent with `officers.json`), with the person array under the `officers` key:

```json
{
  "$schema": "https://mind-arena.local/schema/officer-renown-v1",
  "meta": { "...": "两维定义、取证来源、三条硬规则、口径边界" },
  "officers": [
    {
      "id": "huangzhong",
      "name": "黄忠",
      "historicalWeight": 2,
      "renown": 1,
      "group": "蜀汉·五虎将",
      "basis": "定军山斩夏侯渊，一战定汉中；本传短，旧 prominence 因此把他压到二级而其余四人在一级——五虎将是三十年民间固定组合，必须齐平，此维改列一级。"
    }
  ]
}
```

`group` has 58 distinct values, cut by faction and by fixed grouping, used for the group-by-group self-check above and for later batch proofreading.
Every `basis` is in Chinese and states both the source evidence and the fame evidence; **not one tier assignment is unexplainable**.

<!-- translated-from: OFFICER-RENOWN.md@2bd5aed409f3 -->
