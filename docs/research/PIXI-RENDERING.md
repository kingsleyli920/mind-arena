# PixiJS v8 渲染方案调研（mind-arena 专用）

调研日期 2026-08-31。针对本项目场景：React 19 + vinext（Vite / Cloudflare Workers 上的
Next.js），嵌一个可拖拽缩放的虚拟画布约 8000×7000 的水墨大地图；内容为宣纸底 +
沿地形轮廓填充的皴法纹理（31 枚 256×256 单通道墨迹图章）+ 河流路径描边 +
105 个郡国标记 + 势力染色。

**已锁定版本：`pixi.js` 8.20.1**（已在 package.json，无需新增依赖）。

## 查证方法与来源可信度

本文所有结论按以下优先级查证，**没有一条来自记忆**：

| 级别 | 来源 | 说明 |
| --- | --- | --- |
| A（最高） | `node_modules/pixi.js/lib/**` 的 `.d.ts` 与 `.mjs` 源码 | 与本项目锁定的 8.20.1 完全一致，可当场复核 |
| B | `node_modules/pixi.js/skills/*/SKILL.md` | PixiJS 官方随包发布的技能文档，随版本号一起发布 |
| C | npm registry / 官方站点 | 用于第三方库版本与兼容性 |
| D | 本机实测 | 用 Node 22 + 已装的 sharp 直接跑，见下文标注「实测」处 |

正文中每条结论都标了来源。**凡是查不实的地方，我明确写「不确定」，没有编。**

---

## 0. 结论速查

| 问题 | v8 中的答案 | 详见 |
| --- | --- | --- |
| 初始化 | `new Application()` 无参 + `await app.init({...})`；`app.canvas` 取代 `app.view` | §1 |
| StrictMode 双挂载 | 必须用 `disposed` 标志 + `app.destroy({ removeView: true, releaseGlobalResources: true })` | §1.2 |
| 官方 viewport | **没有**。pixi-viewport 6.0.3 支持 v8，但本项目禁止新增依赖 → 自己实现 | §2 |
| 滚轮缩放 | **Pixi 的 `wheel` 监听是 passive，`preventDefault()` 无效**，必须自己挂原生非 passive 监听 | §2.1 |
| 灰度图当 alpha | 本项目图章「灰度值＝alpha」，而 Pixi AlphaMask **默认就读 red 通道**，天然吻合，零预处理 | §3 |
| 多边形填充纹理并平铺 | `fill({ texture, textureSpace: 'global', matrix })`；v8 会**自动把 addressMode 改成 repeat** | §4 |
| 预烘焙 | `renderer.generateTexture()` / `renderer.render({ target })`；8000×7000 **超过 GPU 上限，必须分块烘焙** | §5 |
| 缓存 | v7 `cacheAsBitmap = true` → v8 `cacheAsTexture(true)`（方法，不是属性） | §5.2 |
| Culling | v8 手动开启：`extensions.add(CullerPlugin)` + `cullable = true` | §5.3 |
| SSR 规避 | 实测 `import 'pixi.js'` 在无 DOM 环境**不报错**，但仍建议 `await import()` 动态引入 | §6 |

---

## 1. 初始化 API 与 React 19 挂载

### 1.1 v8 的初始化是异步的

v7 的 `new Application({ ... })` 同步构造在 v8 中被拆成两步。构造函数**不接受配置**，
传进去会被忽略并打 deprecation 警告。

> 来源 A：`lib/app/Application.d.ts`；来源 B：`skills/pixijs-application/SKILL.md`
> 「`new Application()` allocates the instance but creates nothing. Options passed here
> are ignored with a v8 deprecation warning.」

```ts
import { Application } from "pixi.js";

const app = new Application();          // 无参
await app.init({                        // 异步，必须 await
  resizeTo: host,                       // 跟随某个 DOM 元素尺寸
  background: "#e9e2cd",                // 宣纸底色
  antialias: true,
  resolution: Math.min(2, window.devicePixelRatio || 1),
  autoDensity: true,                    // 配合 resolution，自动改 canvas 的 CSS 尺寸
  preference: "webgl",                  // 见下方说明
});
host.appendChild(app.canvas);           // v8 是 app.canvas，不是 app.view
```

关于 `preference`：v8 默认优先 WebGPU，回退 WebGL。本项目建议**显式写 `"webgl"`**，
理由有二：

1. §4 的纹理填充与 §3 的 alpha 遮罩在 WebGL 路径上验证充分；WebGPU 路径本项目未实测。
2. §5 需要读 `app.renderer.gl.getParameter(gl.MAX_TEXTURE_SIZE)` 来判断分块尺寸，
   这是 WebGL 专有的（`WebGLRenderer.gl: GlRenderingContext`，来源 A：
   `lib/rendering/renderers/gl/WebGLRenderer.d.ts:110`）。WebGPU 下取上限的等价写法**我没查到，
   标为不确定**。

### 1.2 React 19 useEffect 中的挂载与卸载（StrictMode 安全）

StrictMode 在开发模式下会 mount → unmount → mount。因为 `app.init()` 是异步的，
cleanup 很可能在 `init()` resolve **之前**就跑完了。如果不处理，第二次挂载会留下
第一个已初始化但无人引用的 WebGL context —— 这就是泄漏。

关键是两点：**一个 `disposed` 标志**，以及 **init 完成后立刻复查该标志**。

```tsx
"use client";

import { useEffect, useRef } from "react";

export function MapCanvas() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    // app 提到闭包外层，cleanup 才能拿到它
    let app: import("pixi.js").Application | null = null;

    (async () => {
      // 动态引入：把 pixi 挡在服务端之外，也不进 SSR bundle（见 §6）
      const { Application } = await import("pixi.js");
      const host = hostRef.current;
      if (disposed || !host) return;

      const created = new Application();
      await created.init({ resizeTo: host, background: "#e9e2cd" });

      // ★ 关键：init 是异步的，await 期间组件可能已经卸载了。
      //   此时必须就地销毁，否则这个 app 永远没人回收。
      if (disposed) {
        created.destroy({ removeView: true, releaseGlobalResources: true });
        return;
      }

      app = created;
      host.appendChild(created.canvas);
      // …在这里搭场景…
    })();

    return () => {
      disposed = true;
      // 第一个参数是 renderer 的销毁选项，第二个是 stage 的
      app?.destroy(
        { removeView: true, releaseGlobalResources: true },
        { children: true, texture: false, textureSource: false },
      );
      app = null;
    };
  }, []);

  return <div ref={hostRef} style={{ width: "100%", height: "100%" }} />;
}
```

两个容易漏的点：

- **`releaseGlobalResources: true` 不能省。** 官方文档原文：不带这个标志，旧 app 的
  池化对象（批次、纹理）会泄漏进新 app，造成闪烁和画面损坏 —— 这正是 StrictMode
  双挂载会触发的场景。（来源 B：`skills/pixijs-performance/SKILL.md`，标记为 `[CRITICAL]`）
- **`texture: false`**：本项目 31 枚墨迹图章是跨实例复用的共享资源。如果传
  `texture: true, textureSource: true`，卸载会把共享纹理一起销毁，第二次挂载就拿到
  已销毁的纹理。只在确认纹理是这个 app 独占时才传 true。
  （来源 B：`skills/pixijs-performance/SKILL.md` 的 destroy 小节）

---

## 2. 拖拽平移 + 滚轮缩放

### 2.0 有没有官方 viewport？

**没有。** PixiJS v8 核心不提供 viewport / 2D 相机。

社区方案 `pixi-viewport` **已经支持 v8**：最新版 **6.0.3**，`peerDependencies` 为
`"pixi.js": ">=8"`（来源 C：npm registry `https://registry.npmjs.org/pixi-viewport/latest`，
实际拉取确认）。

但本项目纪律明确「不要引入新的 npm 依赖」，且我们只需要 drag + wheel-zoom 两种交互，
pixi-viewport 的插件体系（惯性、吸附、弹跳、捏合）用不上。**结论：自己实现。**

自己实现的本质很简单：一个 `world` Container，平移改 `world.position`，缩放改
`world.scale`。所有地图内容都挂在 `world` 下。

### 2.1 滚轮：必须自己挂原生监听（重要坑）

Pixi 的事件系统**支持 `wheel` 事件**，但它的 DOM 监听器是以 `passive: true` 注册的：

```js
// node_modules/pixi.js/lib/events/EventSystem.mjs:340
this.domElement.addEventListener("wheel", this.onWheel, {
  passive: true,
  capture: true
});
```

> 来源 A：源码直接读取，行号如上。文档里也写着「**Passive** handler for `wheel` events」
> （`lib/events/EventSystem.d.ts:472`）。

**后果：在 Pixi 的 `wheel` 事件里调 `preventDefault()` 是无效的**，浏览器会忽略并可能
告警，页面照样滚动。地图缩放必须阻止页面滚动，所以**只能自己在 canvas 上挂一个
`{ passive: false }` 的原生监听**。这一条不查源码几乎必踩。

### 2.2 完整实现

缩放要「以光标为锚点」，即缩放前后光标下的世界坐标不变。推导：

```
世界坐标 wp = (屏幕坐标 sp - world.position) / world.scale
缩放后要求 wp 不变  =>  world.position = sp - wp * newScale
```

```ts
import { Application, Container, Point } from "pixi.js";

/**
 * 给 world 容器装上拖拽平移 + 光标锚定滚轮缩放。
 * 返回 dispose()，务必在 React cleanup 里调用。
 */
export function attachViewport(
  app: Application,
  world: Container,
  opts: { minScale: number; maxScale: number },
) {
  const canvas = app.canvas;

  // ── 滚轮缩放：原生非 passive 监听，Pixi 自己的 wheel 是 passive 的 ──
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();                       // 必须；passive 监听里这行会被忽略

    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;         // 屏幕坐标（CSS 像素）
    const sy = e.clientY - rect.top;

    const old = world.scale.x;
    // deltaY 的单位随 deltaMode 变化，这里只取符号，避免跨浏览器/触控板差异
    const factor = Math.exp(-Math.sign(e.deltaY) * 0.15);
    const next = Math.min(opts.maxScale, Math.max(opts.minScale, old * factor));
    if (next === old) return;

    // 光标下的世界坐标，缩放前后保持不动
    const wx = (sx - world.position.x) / old;
    const wy = (sy - world.position.y) / old;

    world.scale.set(next);
    world.position.set(sx - wx * next, sy - wy * next);
  };
  canvas.addEventListener("wheel", onWheel, { passive: false });

  // ── 拖拽平移：用原生 pointer 事件，绕开 105 个标记的命中测试 ──
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let moved = 0;                              // 累计位移，用来区分「点击」与「拖拽」

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    dragging = true;
    moved = 0;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);    // 拖出画布也不丢事件
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    world.position.set(world.position.x + dx, world.position.y + dy);
  };
  const onUp = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    canvas.releasePointerCapture(e.pointerId);
  };

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);

  return {
    /** 标记的 click 回调里先问一句，避免「拖完地图顺手选中一个郡」 */
    wasDrag: () => moved > 4,
    dispose() {
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
    },
  };
}
```

### 2.3 为什么平移用原生事件而不用 Pixi 事件

Pixi 的 `globalpointermove` 是官方推荐的拖拽做法（来源 B：`skills/pixijs-events/SKILL.md`），
但它会走 Pixi 的命中测试：本项目 stage 下挂着 105 个可交互标记，每次 move 都要遍历。
平移是纯屏幕空间操作，不需要知道拖的是哪个对象，用原生事件更省。

**分工建议：平移/缩放用原生 DOM 事件，郡国标记的 hover/click 用 Pixi 事件**
（`marker.eventMode = "static"`，v8 里默认是 `"passive"`＝不响应，必须显式设置 ——
见 §7）。两者互不干扰。

标记层若不需要交互，记得 `markerLayer.interactiveChildren = false` 直接跳过整棵子树。

---

## 3. 把单通道灰度 PNG 当 alpha 用

### 3.0 先确认素材的实际形态（实测）

这一节的前提必须先坐实，否则三条路径全是空谈。

**实测 1 —— 图章是几通道？** 用已装的 sharp 读 `public/game/ink/`：

```
fupi-0.png    { channels: 1, space: 'b-w', hasAlpha: false, 256×256, uchar }
juanyun-0.png { channels: 1, space: 'b-w', hasAlpha: false, 256×256, uchar }
```

即**单通道灰度，没有 alpha 通道**。浏览器解码后上传 GPU 会变成 RGBA，且
**R = G = B = 灰度值，A = 255**。

**实测 2 —— 灰度值是「墨的浓度」还是「墨的亮度」？** 这个方向搞反，整张图就是负片。
从生成脚本 `tools/extract-cun.mjs:119-129` 读到确定答案：

```js
const v = (paperTone - region[k]) / span;               // 纸白 → 0，浓墨 → 1
alpha[k] = Math.max(0, Math.min(255, Math.round(v * 235)));
```

变量名就叫 `alpha`。**结论：存的灰度值 = 墨的不透明度。灰度越高＝墨越浓＝越不透明。**
与 `public/game/ink/manifest.json` 的自述「灰度值即墨密度，用作 alpha 通道」一致。
所以正确映射是 `alpha = gray`，**不是** `alpha = 255 - gray`。

这个结论很关键，因为它让下面的路径 B 变成零成本。

### 3.1 路径 A：Sprite tint —— 单独用**不能**解决问题

`sprite.tint` 在 v8 里是**逐通道相乘**（`finalRGB = textureRGB × tint`），它**不碰 alpha**。

图章的 A 恒等于 255，所以直接 `new Sprite(inkTexture)` 得到的是一个**不透明的灰色方块**，
tint 只能把这个方块染成不透明的彩色方块。宣纸底会被整块盖住。

**tint 的正确用武之地是配合路径 B / C**：当 alpha 已经由遮罩或 shader 正确产生后，
用 tint 一键切换墨色（焦墨 / 淡墨 / 势力色染色），不必为每种颜色单独出图。
势力染色就该这么做。

### 3.2 路径 B：当 Alpha 遮罩 —— 本项目零预处理即可用

v8 的遮罩类型是**根据你赋给 `mask` 的对象自动选的**
（来源 A：`lib/rendering/mask/MaskEffectManager.js` 的 `getMaskEffect` 逐个 `test`）：

| 赋给 mask 的对象 | 选中的类型 | 开销 |
| --- | --- | --- |
| `Sprite` | **AlphaMask** | 最贵（走 filter 管线） |
| `Graphics` / `Container` | StencilMask | 中（模板缓冲，二值） |
| 数字（如 `0xF`） | ColorMask | 最便宜 |

> 来源 A：`AlphaMask.test = (mask) => mask instanceof Sprite`
> （`lib/rendering/mask/alpha/AlphaMask.js`）。**注意：只有 Sprite 会走 AlphaMask。**
> 把一个装满图章的 Container 赋给 `mask`，拿到的是 StencilMask —— 二值裁剪，
> 墨的浓淡层次全丢。这是本节最容易踩的坑，办法见 §3.2.2。

**AlphaMask 默认读 red 通道**，源码写死：

```js
class AlphaMask {
  constructor(options) { /* … */ this.channel = "red"; /* … */ }
```

遮罩 shader 里对应的分支（来源 A：`lib/filters/mask/mask.frag.js`）：

```glsl
if (uChannel == 1.0) {          // channel: 'alpha'
    a = masky.a * npmAlpha * clip;
} else {                        // channel: 'red'（默认）
    float alphaMul = 1.0 - npmAlpha * (1.0 - masky.a);
    a = alphaMul * masky.r * npmAlpha * clip;
}
```

对我们的图章：`masky.a` 恒为 1 → `alphaMul` 恒为 1 → **`a = masky.r = 灰度值 = 墨浓度`**。
类型定义里也明说 `'red'` 通道「Suitable for grayscale mask textures」
（来源 A：`lib/scene/container/container-mixins/effectsMixin.d.ts`）。

**也就是说：本项目的单通道灰度图章，不做任何转换，直接当 Pixi 的 alpha 遮罩用，
浓淡层次是正确的。** 素材当初就是照这个用法做的。

```ts
import { Container, Graphics, Sprite, Assets } from "pixi.js";

const stamp = await Assets.load("/game/ink/fupi-0.png");

const region = new Container();
// 被遮罩的内容：一块纯墨色（之后可以用 tint 改成势力色）
region.addChild(new Graphics().poly(outlinePoints, true).fill(0x1c1a17));

const maskSprite = new Sprite(stamp);
maskSprite.width = regionWidth;
maskSprite.height = regionHeight;

region.mask = maskSprite;      // Sprite → 自动选中 AlphaMask，默认读 red 通道
region.addChild(maskSprite);   // 遮罩必须在场景图里，否则 transform 不跟随
```

要显式指定通道或反向遮罩，用 `setMask`：

```ts
region.setMask({ mask: maskSprite, channel: "red", inverse: false });
```

**清除遮罩只能用 `region.mask = null`。** 官方明确说 `setMask({ mask: null })`
因为内部的 falsy 判断而无效（来源 B：`skills/pixijs-scene-core-concepts/references/masking.md`）。

#### 3.2.1 AlphaMask 的代价

AlphaMask 走完整 filter 管线，是三种遮罩里最贵的。官方原文的开销排序：
`Scissor（近乎零） < Stencil（多一次绘制） < Alpha（一整个 filter pass）`，
并警告「同时用很多 sprite 遮罩会显著拖慢」。

本项目有大量地形区域。**每个区域一个 AlphaMask ＝ 每帧几十个 filter pass，会炸。**

#### 3.2.2 因此：把「一堆图章」先烘焙成一张 Sprite

解决 §3.2 开头那个「Container 会退化成 StencilMask」的问题，同时也解决开销问题 ——
把散布在区域内的多枚图章**先烘焙进一张 RenderTexture**，再用这张 RenderTexture 的
Sprite 当遮罩。这样既拿回了 AlphaMask 的灰度层次，一个区域也只剩一次 filter pass。

```ts
import { Container, Sprite, RenderTexture, Matrix } from "pixi.js";

// 1) 在离屏容器里按轮廓散布图章（随机旋转/缩放，避免机械重复）
const stampField = new Container();
for (const p of scatterPointsInsideRegion) {
  const s = new Sprite(pickStamp(p));   // 从 31 枚里挑
  s.anchor.set(0.5);
  s.position.set(p.x - bounds.x, p.y - bounds.y);  // 平移到区域局部坐标
  s.rotation = p.rot;
  s.scale.set(p.scale);
  stampField.addChild(s);
}

// 2) 烘焙成一张纹理。注意烘焙尺寸别超 GPU 上限，见 §5.1
const rt = RenderTexture.create({
  width: bounds.width,
  height: bounds.height,
  resolution: 1,
});
app.renderer.render({ container: stampField, target: rt, clear: true });
stampField.destroy({ children: true });   // 烘完就拆，图章纹理是共享的，别传 texture:true

// 3) 用它当遮罩 —— 一个区域只剩一次 filter pass
const maskSprite = new Sprite(rt);
maskSprite.position.set(bounds.x, bounds.y);
region.mask = maskSprite;
region.addChild(maskSprite);
```

**注意**：烘焙时图章 Sprite 的 RGB 会一并写进 RenderTexture。因为遮罩只读 red 通道，
而灰度图 R=G=B=灰度，所以烘焙结果的 red 通道仍然等于墨浓度，语义不变。
但若你在烘焙前给图章 `tint` 上色，red 通道就被改了 —— **遮罩用途的烘焙不要 tint。**

### 3.3 路径 C：Mesh + 自定义 shader

最大自由度、最低开销：一次 draw call 同时完成「灰度转 alpha」+「墨色着色」，
不走 filter 管线，也不需要预处理素材。

v8 的 shader API 与 v7 完全不同，三个硬性要求（来源 B：`skills/pixijs-custom-rendering/SKILL.md`）：

1. `Shader.from({ gl, resources })` 选项对象形式，**位置参数形式已删除**；
2. **每个 uniform 必须写 `{ value, type }`**，漏了 type 会运行时报错
   `Uniform type undefined is not supported`；
3. **纹理是 resource，不是 uniform** —— 传 `texture.source` 和 `texture.source.style`
   两个顶层键，不能塞进 `UniformGroup`。

```ts
import { Shader, UniformGroup, Mesh, MeshGeometry, Assets } from "pixi.js";

const ink = await Assets.load("/game/ink/fupi-0.png");

const vertex = `#version 300 es
in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
}`;

const fragment = `#version 300 es
precision mediump float;
in vec2 vUV;
out vec4 finalColor;
uniform sampler2D uInk;
uniform vec3 uInkColor;      // 墨色 / 势力色
uniform float uDensity;      // 整体浓淡
void main() {
  // 单通道灰度上传后 R=G=B=灰度；取 .r 即墨浓度（见 §3.0 实测）
  float a = texture(uInk, vUV).r * uDensity;
  finalColor = vec4(uInkColor * a, a);   // premultiplied alpha
}`;

const shader = Shader.from({
  gl: { vertex, fragment },
  resources: {
    uInk: ink.source,                 // ★ 纹理作为 resource
    uInkSampler: ink.source.style,    // ★ sampler 也是 resource
    inkUniforms: new UniformGroup({
      uInkColor: { value: new Float32Array([0.11, 0.10, 0.09]), type: "vec3<f32>" },
      uDensity:  { value: 0.85, type: "f32" },
    }),
  },
});

// 把地形区域三角化后的顶点喂进来
const geometry = new MeshGeometry({
  positions: new Float32Array(triangulatedPositions),
  uvs: new Float32Array(triangulatedUVs),
  indices: new Uint32Array(triangleIndices),
});

const mesh = new Mesh({ geometry, shader });

// 运行时改势力色
shader.resources.inkUniforms.uniforms.uDensity = 0.6;
```

**不确定项**：上面 vertex shader 里 `uProjectionMatrix` / `uWorldTransformMatrix` /
`uTransformMatrix` 这三个矩阵 uniform 的名字，是我依据 Pixi 内置 mesh shader 的惯例写的，
**我没有在 8.20.1 源码里逐字核对过**。落地时请先跑通一个最小 Mesh，
或直接参考 `node_modules/pixi.js/lib/scene/mesh/shared/` 下的内置 shader 源码确认。
其余部分（`Shader.from` 结构、uniform 必须带 type、纹理作为 resource）已按来源 B 核实。

另外：`textureSpace` / 三角化需要你自己做多边形剖分。Pixi 内部用的是
`lib/scene/graphics/shared/utils/triangulateWithHoles`，但**它不是公开导出的 API**，
不要依赖。多边形三角化建议在 `tools/` 的构建期完成，把结果存成数据。

### 3.4 三条路径怎么选

| 路径 | 灰度→alpha | 每区域开销 | 适合 |
| --- | --- | --- | --- |
| A. Sprite tint | ✗ 做不到 | 最低 | 只作为 B/C 的配色手段 |
| B. AlphaMask | ✓ 零预处理，默认 red 通道 | 一次 filter pass | 区域数少；先做出效果 |
| C. Mesh + shader | ✓ 完全可控 | 一次 draw call | 区域数多；最终形态 |
| D. Graphics 纹理填充（§4） | 需预处理成 RGBA | 可批处理 | 平铺底纹 |

**对「用墨迹纹理填充任意多边形区域」这个具体需求，我的建议是：**

先用 **B（烘焙版，§3.2.2）** 把美术效果调出来 —— 它零预处理、代码量小、
浓淡层次天然正确。等区域数量涨上去、profile 显示 filter pass 成为瓶颈时，
再迁到 **C**。B 和 C 共用同一套「轮廓 → 散布点」的数据，迁移代价不大。

### 3.5 一个可选的预处理：把灰度图转成 RGBA

如果想让图章能被**当普通 Sprite 直接用**（可批处理、无遮罩开销、也能被 §4 的
`fill({ texture })` 正确使用），可以在构建期用已装的 sharp 转一次。
**已实测跑通**（Node 22 + sharp 0.34.5）：

```js
// 灰度 → RGBA：alpha 取灰度值本身（依据 §3.0 实测：灰度即墨浓度）
const gray = await sharp(src).raw().toBuffer();          // 256*256*1
const N = 256 * 256;
const rgba = Buffer.alloc(N * 4);
for (let i = 0; i < N; i += 1) {
  rgba[i * 4 + 0] = 0x1c;      // 墨色 R（之后可用 sprite.tint 改）
  rgba[i * 4 + 1] = 0x1a;      // 墨色 G
  rgba[i * 4 + 2] = 0x17;      // 墨色 B
  rgba[i * 4 + 3] = gray[i];   // ★ alpha = 灰度 = 墨浓度，不是 255 - gray
}
await sharp(rgba, { raw: { width: 256, height: 256, channels: 4 } })
  .png({ compressionLevel: 9 })
  .toFile(dst);
```

实测输出：`{ channels: 4, hasAlpha: true }`，alpha 均值 84（与源图灰度均值一致），
RGB 恒为 (28,26,23)。

代价是文件变大（单通道 → 四通道）。**这一步是可选的**，因为路径 B 和 C 都不需要它。
只有当你想走路径 D、或想把 31 枚图章打成一张图集用 Sprite 批渲染时才做。

---

## 4. 多边形填充纹理 + 平铺

### 4.1 v8 的 Graphics 是「先画形状，再上样式」

v7 的 `beginFill → drawXxx → endFill` 在 v8 中**整个删掉了**，改为形状方法在前、
`fill()` / `stroke()` 在后的链式调用。所有 `drawXxx` 都改了名。

> 来源 B：`skills/pixijs-migration-v8/SKILL.md`，标记 `[CRITICAL]`

| v7 | v8 | | v7 | v8 |
| --- | --- | --- | --- | --- |
| `drawRect` | `rect` | | `drawPolygon` | `poly` |
| `drawCircle` | `circle` | | `drawRoundedRect` | `roundRect` |
| `drawEllipse` | `ellipse` | | `drawStar` | `star` |
| `beginFill(c)` | `fill(c)`（在形状之后） | | `lineStyle(w,c)` | `stroke({width,color})` |
| `beginHole/endHole` | `cut()` | | `GraphicsGeometry` | `GraphicsContext` |

### 4.2 从 SVG path 建多边形

v8 的 Graphics **原生支持 SVG**，两个入口（来源 A：`lib/scene/graphics/shared/Graphics.d.ts:1194`
与 `lib/scene/graphics/shared/path/GraphicsPath.d.ts:55`）：

```ts
import { Graphics, GraphicsPath } from "pixi.js";

// 入口 1：整段 SVG 字符串
const g = new Graphics().svg(`<svg><path d="M0 0 L100 0 L50 80 Z"/></svg>`);

// 入口 2：GraphicsPath 直接吃 SVG path 的 d 属性（更适合我们：轮廓数据就是一串 d）
const path = new GraphicsPath("M0 0 L100 0 L50 80 Z");
const g2 = new Graphics().path(path).fill(0x1c1a17);
```

河流描边就用 `GraphicsPath` + `stroke()`：

```ts
new Graphics()
  .path(new GraphicsPath(riverPathD))
  .stroke({ width: 3, color: 0x3a4a55, cap: "round", join: "round", alpha: 0.7 });
```

如果轮廓是点数组而不是 SVG，用 `poly()`：

```ts
new Graphics().poly([x0, y0, x1, y1, /* … */], true).fill(inkPattern);
```

### 4.3 填充纹理并平铺 —— 关键在 `textureSpace`

`fill()` 接受 `FillInput`：颜色、`Texture`、`FillGradient`、`FillPattern`，
或一个 `FillStyle` 对象 `{ color, alpha, texture, matrix, textureSpace, fill }`
（来源 A：`lib/scene/graphics/shared/FillTypes.d.ts`）。

**`textureSpace` 决定纹理坐标怎么算，这是平铺与否的分水岭：**

| 值 | 语义 | 效果 |
| --- | --- | --- |
| `'local'`（texture 填充的默认） | UV 相对于**每个形状自己的包围盒**归一化 | 一张图**拉伸铺满**整个多边形，**不平铺** |
| `'global'` | UV 在 Graphics 的局部坐标系里按**纹理原始像素尺寸**算 | 按 256×256 原始尺寸**连续平铺**，相邻形状共用同一张「墙纸」 |

我从源码里核对了这个行为（来源 A：
`lib/scene/graphics/shared/utils/generateTextureFillMatrix.mjs`）：

```js
if (style.textureSpace === "local") {
    const bounds = shape.getBounds(tempRect);
    const sx = 1 / bounds.width;          // ← 按包围盒归一化：拉伸，不平铺
    const sy = 1 / bounds.height;
    // …
} else {
    textureMatrix.translate(style.texture.frame.x, style.texture.frame.y);
    textureMatrix.scale(1 / style.texture.source.width,     // ← 按纹理原始尺寸：平铺
                        1 / style.texture.source.height);
}
```

**所以「用墨迹纹理平铺填充任意多边形」的正确写法是显式指定 `textureSpace: 'global'`：**

```ts
import { Graphics, Matrix, Assets } from "pixi.js";

const ink = await Assets.load("/game/ink/fupi-0.rgba.png");   // 需带 alpha，见 §3.5

const region = new Graphics()
  .poly(outlinePoints, true)
  .fill({
    texture: ink,
    textureSpace: "global",                  // ★ 平铺，而不是拉伸铺满
    matrix: new Matrix().scale(0.5, 0.5),    // 图章缩到 128px 一格；可加 .rotate()
    alpha: 0.9,
  });
```

`matrix` 会被**求逆**后作用到纹理坐标上（源码：`out.copyFrom(style.matrix).invert()`），
所以直觉是对的：`scale(0.5)` 让**图案变小**（一格 128px），`scale(2)` 让图案变大。

### 4.4 一个重要且隐蔽的副作用：v8 会偷偷改你的纹理 addressMode

同一个文件末尾：

```js
const sourceStyle = style.texture.source.style;
if (!(style.fill instanceof FillGradient) && sourceStyle.addressMode === "clamp-to-edge") {
    sourceStyle.addressMode = "repeat";
    sourceStyle.update();
}
```

> 来源 A：`lib/scene/graphics/shared/utils/generateTextureFillMatrix.mjs`

两层含义：

1. **好消息**：纹理填充**默认就能平铺**，你不必手动设 `addressMode`。
2. **坑**：它改的是 `texture.source.style`，而 `TextureSource` 是**跨所有使用者共享的**。
   一旦某张图章被用作 Graphics 填充，它的 wrap mode 就**全局**变成了 `repeat`。
   如果同一张纹理在别处被当普通 Sprite 用，且依赖 `clamp-to-edge` 的边缘行为
   （比如缩放时边缘不要绕回来），就会出现难查的边缘瑕疵。
   **对策**：给「用于填充」和「用于 Sprite」的图章各自 `Assets.load` 成独立纹理，
   或接受全局 repeat（对本项目的无缝皴法纹理，repeat 本来就是想要的）。

### 4.5 FillPattern：另一种写法

`FillPattern` 是同一件事的显式封装，可以指定平铺方向。注意它的
**`textureSpace` 默认值是 `'global'`**，与裸 texture 填充的 `'local'` 相反
（来源 A：`FillPattern.js` 构造函数 `this.textureSpace = options.textureSpace ?? "global"`）。

```ts
import { FillPattern, Matrix } from "pixi.js";

const pattern = new FillPattern({
  texture: ink,
  repetition: "repeat",        // 'repeat' | 'repeat-x' | 'repeat-y' | 'no-repeat'
  textureSpace: "global",      // 其实是默认值
});
pattern.setTransform(new Matrix().scale(0.5, 0.5).rotate(0.3));

new Graphics().poly(outlinePoints, true).fill(pattern);
```

`repetition` 直接映射到纹理的 `addressModeU/V`（源码里的 `repetitionMap`），
`'repeat-x'` ＝ U 方向 repeat、V 方向 clamp。同样会写进共享的 `source.style`，
§4.4 的注意事项照旧。

### 4.6 别每帧重建 Graphics

官方明确警告：Graphics **不是**为逐帧重绘设计的。`clear()` + 重画会重新三角化并
重建 GPU 几何。「把 Graphics 当 SVG 元素看，而不是当 canvas 绘制调用看。」
（来源 B：`skills/pixijs-scene-graphics/SKILL.md`，标记 `[HIGH]`）

对本项目：地形轮廓、河流是**静态**的，构建一次即可。势力染色变化时，
**改 `tint` / `alpha`，不要重画** —— transform、alpha、tint 的改动都是廉价的。

多个区域若共用同一套绘制指令，用 `GraphicsContext` 共享几何：

```ts
const ctx = new GraphicsContext().poly(pts, true).fill(pattern);
const a = new Graphics(ctx);
const b = new Graphics(ctx);   // 复用已三角化的几何，不重复 GPU 开销
```

⚠ 共享的 context 别被误销毁：`a.destroy({ context: true })` 会把 `b` 的 context 引用也置空。
默认 `destroy()`（构造时传入的 context）不销毁它，安全。

---

## 5. 大量静态内容的性能

### 5.1 8000×7000 不能整幅烘焙进一张纹理

这是本项目最硬的约束。GPU 单张纹理有尺寸上限，常见 4096～16384。
8000×7000 **在很多设备上直接超限**，`cacheAsTexture()` 或整幅 RenderTexture 都会失败。

查上限（WebGL 路径）：

```ts
const gl = (app.renderer as import("pixi.js").WebGLRenderer).gl;
const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);   // 典型 4096 / 8192 / 16384
```

> **勘误 + 不确定项**：官方 `skills/pixijs-performance/SKILL.md` 里写着
> 「check `renderer.texture.maxTextureSize`」。我在 8.20.1 里**全量搜索了
> `lib/**` 的 `.d.ts` 和 `.mjs`，`maxTextureSize` 一个都没有** —— 这个属性不存在，
> 官方技能文档这一句是错的。请用上面的 `gl.getParameter`。
> **WebGPU 下的等价写法我没查到，标为不确定**（这也是 §1.1 建议锁 WebGL 的原因之一）。

**正确做法：分块烘焙。** 把世界切成 2048×2048 的格子，逐格烘焙成 RenderTexture，
再作为 Sprite 拼回世界。`renderer.render()` 的选项支持 `target` 和 `transform`
（来源 A：`lib/rendering/renderers/shared/system/AbstractRenderer.d.ts` 的
`RenderOptions` / `ClearOptions`）：

```ts
import { RenderTexture, Sprite, Matrix, Container } from "pixi.js";

const TILE = 2048;                      // 别超过上面查到的 maxTex
const baked = new Container();

for (let ty = 0; ty < Math.ceil(WORLD_H / TILE); ty += 1) {
  for (let tx = 0; tx < Math.ceil(WORLD_W / TILE); tx += 1) {
    const rt = RenderTexture.create({ width: TILE, height: TILE, resolution: 1 });

    app.renderer.render({
      container: staticTerrainLayer,               // 宣纸底 + 皴法 + 河流
      target: rt,
      transform: new Matrix().translate(-tx * TILE, -ty * TILE),  // 平移取这一格
      clear: true,
    });

    const s = new Sprite(rt);
    s.position.set(tx * TILE, ty * TILE);
    s.cullable = true;                             // 见 §5.3
    baked.addChild(s);
  }
}
world.addChild(baked);
```

烘焙完，**成千上万个皴法图章、几十条河流路径塌缩成十几个 Sprite**，
平移缩放时只有这十几个 Sprite 参与渲染。这是本项目最重要的一步优化。

烘焙时机：初次加载时一次性做完。注意它会占一帧较长时间，建议配合加载态。
若要更平滑，可以每帧烘一格（`app.ticker.add`），进度可视化。

### 5.2 cacheAsTexture —— v8 改名了，且是**方法**

v7 的 `container.cacheAsBitmap = true`（属性赋值）在 v8 中变成
`container.cacheAsTexture(true)`（**方法调用**）。旧名还在，但会打 deprecation 警告。

> 来源 A：`lib/scene/container/container-mixins/cacheAsTextureMixin.d.ts`
> `cacheAsTexture: (val: boolean | CacheAsTextureOptions) => void;`

```ts
labelLayer.cacheAsTexture(true);
labelLayer.cacheAsTexture({ resolution: 2, antialias: true });  // 带选项
labelLayer.updateCacheTexture();        // 改了子节点后必须手动刷新
labelLayer.cacheAsTexture(false);       // ★ 销毁前必须先关掉
labelLayer.destroy({ children: true });
console.log(labelLayer.isCachedAsTexture);
```

对本项目的适用性：

- ✓ 适合：郡国标记层、图例、UI 面板等**中等尺寸的静态子树**。
- ✗ **不适合整个世界层** —— 尺寸超限（§5.1），用分块烘焙代替。
- ⚠ **不要和遮罩一起用。** 官方明确警告二者组合「很脆弱」：Firefox 上可能需要在
  设遮罩和开缓存之间加 timeout，其他情况下会静默失效
  （来源 B：`skills/pixijs-scene-core-concepts/references/masking.md`，标记 `[HIGH]`）。
  §3.2 的 AlphaMask 区域**不要**再套 `cacheAsTexture`，直接走 §5.1 的分块烘焙。

### 5.3 Culling：v8 默认不开，必须手动启用

v7 有自动裁剪，**v8 改成完全手动**。不注册插件的话，`cullable = true` 毫无作用。

> 来源 B：`skills/pixijs-migration-v8/SKILL.md`「Culling is manual」；
> 来源 A：`lib/culling/Culler.d.ts` 的 `cull(container, view, skipUpdateTransform?)`

```ts
import { extensions, CullerPlugin, Culler, Rectangle } from "pixi.js";

extensions.add(CullerPlugin);          // ★ 必须在 app.init() 之前

// 逐个开启（只对可能移出屏幕的对象开）
for (const tile of baked.children) tile.cullable = true;

// 预先给定裁剪矩形，省掉每帧算 bounds
tile.cullArea = new Rectangle(0, 0, TILE, TILE);

// 静态 UI 子树整体跳过递归，省 CPU
uiRoot.cullableChildren = false;

// 不用插件时手动跑（自定义渲染循环）
Culler.shared.cull(app.stage, app.renderer.screen);
```

判断要不要开：**culling 是拿 CPU（逐对象 bounds 检测）换 GPU。**
GPU 瓶颈时开，CPU 瓶颈时反而更慢。本项目烘焙后只剩十几个 Sprite，
culling 收益有限；**105 个郡国标记层收益更明显**，建议给标记开、给烘焙层也开
（反正只有十几个，检测成本可忽略）。

### 5.4 其他适用于本项目的点

- **批处理顺序**：v8 在「对象类型切换」「纹理源超过每批上限（约 16）」「混合模式切换」
  时打断批次。所以**同类对象要挨着放**：`sprite/sprite/graphics/graphics` = 2 次
  draw call，而 `sprite/graphics/sprite/graphics` = 4 次。
  本项目应把标记 Sprite 归一层、Graphics 归一层，别交错。
  （来源 B：`skills/pixijs-performance/SKILL.md`，标记 `[HIGH]`）
- **图集**：31 枚图章分散加载会各占一个纹理槽。打成一张 spritesheet 可显著改善批处理。
  （若走 §5.1 的分块烘焙，这点重要性下降 —— 烘完就没图章了。）
- **文字**：`Text` 每次改内容都要重绘 canvas 并重传 GPU。郡国名是静态的，用 `Text` 没问题；
  但**任何逐帧变化的数字（回合数、兵力）必须用 `BitmapText`**。
- **`resolution: 2` 会让像素数变成 4 倍**，移动端可能直接掉一半帧率。
  §1.1 里我写了 `Math.min(2, dpr)`，移动端建议进一步降到 1。
- **`filterArea`**：若给容器加了滤镜，显式设 `container.filterArea = new Rectangle(...)`，
  否则 Pixi 每帧都要量一次 bounds。

---

## 6. Vite + RSC / Cloudflare Workers 下的引入与 SSR 规避

### 6.1 实测：pixi.js 在无 DOM 环境**不会**在导入时崩

我在本机 Node 22（无 DOM）里实测：

```
import('pixi.js')        → OK，209ms
typeof PIXI.Application  → 'function'
new PIXI.Application()   → OK（不碰 DOM，只建了个 stage Container）
new PIXI.Graphics().rect(0,0,10,10).fill(0xff0000)  → OK
```

**结论：模块顶层导入 pixi.js 本身是安全的，只有 `app.init()` 才会碰 DOM。**
这与 §1.1 的官方说法一致（「`new Application()` allocates the instance but creates nothing」）。

⚠ **但这个实测是在 Node 上做的，不是 workerd。** Cloudflare Workers 运行时与 Node 不同
（本项目 vite.config.ts 里 `viteEnvironment: { name: "rsc" }`，RSC 跑在 Workers 里）。
我**没有**在 workerd 里实测过，标为不确定。

### 6.2 推荐做法：`"use client"` + 动态 `import()`

即便顶层导入安全，仍建议动态引入，理由是**体积**：`dist/pixi.min.mjs` 有 **820 KB**
（实测 `ls -la node_modules/pixi.js/dist/`）。静态导入会把它带进 SSR / RSC 的模块图，
在 Workers 上白白增加 bundle 体积和冷启动时间。

本项目 `app/game/InkMapViewer.tsx` 已经是这个模式，是对的：

```tsx
"use client";

import { useEffect, useRef } from "react";
import type { Sprite, Application } from "pixi.js";   // ★ 仅类型，编译期擦除

export function InkMapViewer() {
  useEffect(() => {
    let disposed = false;
    (async () => {
      const PIXI = await import("pixi.js");            // ★ 运行时才真正加载
      if (disposed) return;
      // …
    })();
    return () => { disposed = true; /* … */ };
  }, []);
  // …
}
```

三条规则：

1. **`import type { ... } from "pixi.js"`** —— 类型导入会被 TypeScript 完全擦除，
   不产生运行时依赖，可以放心写在顶层。
2. **值导入一律放进 `useEffect` 里的 `await import("pixi.js")`。**
3. **`"use client"` 只是保证组件在客户端 hydrate，不保证不在服务端执行。**
   RSC 里 client component 仍会被 SSR 渲染出 HTML。所以真正的护栏是
   「所有 Pixi 调用都在 `useEffect` 内」—— `useEffect` 在服务端从不执行。

### 6.3 需要注意的其他点

- **不要在 server component 里 import Pixi 的任何值**，包括常量。
  `app/game/map/page.tsx` 目前只 import 了 `InkMapViewer`，是对的。
- **资源路径**：`public/game/ink/*.png` 在 Workers 上由静态资源服务，
  `Assets.load("/game/ink/fupi-0.png")` 用绝对路径即可。
- **v8 的 `Texture.from` 不再加载 URL**（v7 会）。必须先
  `await Assets.load(url)`，再 `Texture.from(url)`，或直接用 `Assets.load` 的返回值。
  这是 v7→v8 的破坏性变更，见 §7。
- **CSP**：Pixi 内部用 `new Function()` 做 shader / uniform 同步。若部署环境的 CSP
  禁止 `unsafe-eval`，需在任何渲染器初始化**之前** `import "pixi.js/unsafe-eval";`。
  （这个 import 的名字是反直觉的：它**不是**启用 eval，而是用静态 polyfill 消除对 eval 的需要。）
  Cloudflare Workers 默认不给前端页面设这种 CSP，**当前项目应该用不到**，先记着。
  （来源 B：`skills/pixijs-environments/SKILL.md`）

---

## 7. v7 → v8 破坏性变更中最容易踩的几处

按「本项目实际会碰到」的概率排序。完整清单见
`node_modules/pixi.js/skills/pixijs-migration-v8/SKILL.md`。

### 7.1 初始化是异步的
`new Application({...})` 的配置被静默忽略。必须 `await app.init({...})`。
**症状**：canvas 尺寸不对、`app.screen` 是 undefined、拿不到 renderer。

### 7.2 `app.view` → `app.canvas`
旧名还在但打 deprecation 警告。

### 7.3 Graphics 全套改写
`beginFill/drawRect/endFill` → `rect().fill()`；`lineStyle` → `stroke()`；
`beginHole/endHole` → `cut()`；`GraphicsGeometry` → `GraphicsContext`。
**这是改动面最大的一块**，见 §4.1 的对照表。

### 7.4 `eventMode` 默认是 `'passive'`，即不响应事件
v7 里 `interactive = true`；v8 必须 `container.eventMode = 'static'`（或 `'dynamic'`）。
**症状**：郡国标记点不动、hover 没反应，且**不报任何错**。极易误判成命中区域算错了。
（`interactive = true` 仍作为别名可用，但 `eventMode` 才是 v8 的正式写法。）

### 7.5 Ticker 回调的第一个参数变成了 Ticker 对象 —— **静默数值污染**
```ts
// v7 写法，在 v8 里能编译、能跑，但结果是 NaN
app.ticker.add((dt) => { sprite.rotation += dt; });      // dt 是 Ticker，不是数字
// v8 正确写法
app.ticker.add((ticker) => { sprite.rotation += ticker.deltaTime; });
```
官方原文形容为「compiles but silently corrupting rotation」。**这条最阴**：
不报错、不告警，只是数值悄悄变成 NaN，对象凭空消失。

### 7.6 `Texture.from()` 不再加载 URL
必须先 `await Assets.load(url)`。**症状**：纹理是空白/白块，无错误。

### 7.7 叶子节点不能有子节点
`Sprite`、`Graphics`、`Mesh`、`Text` 都设了 `allowChildren = false`。
往 Graphics 里 `addChild` 会打 deprecation 警告，未来版本会硬报错。要分组就套一层 `Container`。
**对本项目**：`marker = new Sprite(); marker.addChild(labelText)` 这种写法要改成
`markerGroup = new Container(); markerGroup.addChild(sprite, labelText)`。

### 7.8 Culling 默认关闭
见 §5.3。v7 的习惯（以为自动裁剪）会让人误以为已经优化过了。

### 7.9 `cacheAsBitmap` → `cacheAsTexture()`：属性变方法
`container.cacheAsTexture = true` 在 TypeScript 里会直接报类型错（因为它是函数），
但如果是 JS 就会静默失效。见 §5.2。

### 7.10 枚举常量全部改成字符串
`SCALE_MODES.NEAREST` → `'nearest'`；`WRAP_MODES.REPEAT` → `'repeat'`；
`DRAW_MODES.TRIANGLES` → `'triangle-list'`。旧枚举可能作为 deprecated 别名还在。

### 7.11 `settings` 和 `utils` 命名空间被删
`settings.ADAPTER` → `DOMAdapter.set()`；`utils.isMobile` → `import { isMobile } from 'pixi.js'`。

### 7.12 `getBounds()` 返回 `Bounds` 而不是 `Rectangle`
`.x/.y/.width/.height` 照常能用，但要调 `.contains()` 得先取 `.rectangle`。
**症状**：`bounds.contains(...)  is not a function`。

### 7.13 `DisplayObject` 被删除
基类是 `Container`。

### 7.14 Shader / Filter 构造签名全改
`Shader.from(vert, frag, uniforms)` → `Shader.from({ gl, resources })`；
uniform 必须写 `{ value, type }`；纹理是 resource 不是 uniform。见 §3.3。

---

## 附：本项目落地建议的顺序

1. **先把 §1 的挂载/卸载骨架搭对**（StrictMode 双挂载 + `releaseGlobalResources`），
   这是后面一切的地基，出问题最难查。
2. **§2 的 viewport 自己写**，别引 pixi-viewport（纪律 + 用不上）。
   重点是 §2.1 的 passive wheel 坑。
3. **地形填充先走 §3.2.2（烘焙版 AlphaMask）**把美术效果调出来 ——
   零预处理，本项目图章的灰度语义与 Pixi 的 red 通道默认值天然吻合。
4. **性能一旦不够，第一刀砍 §5.1 的分块烘焙**，收益最大（成千上万图章 → 十几个 Sprite）。
5. **§3.3 的 Mesh + shader 是终局形态**，等 profile 指明 filter pass 是瓶颈再上。

## 附：本文的不确定项汇总

我不确定、需要落地时实测的地方，集中列在这里，避免散落正文被忽略：

1. **§3.3 Mesh vertex shader 的三个矩阵 uniform 名**（`uProjectionMatrix` /
   `uWorldTransformMatrix` / `uTransformMatrix`）—— 按 Pixi 惯例写的，未逐字核对源码。
2. **§5.1 WebGPU 下如何查纹理尺寸上限** —— 没查到等价 API。
   （这是建议 §1.1 锁 `preference: "webgl"` 的原因之一。）
3. **§6.1 workerd（Cloudflare Workers）运行时能否安全导入 pixi.js** ——
   只在 Node 22 上实测过，workerd 未测。动态 import 的推荐做法不受此影响。
4. **官方文档已知错误**：`skills/pixijs-performance/SKILL.md` 提到的
   `renderer.texture.maxTextureSize` 在 8.20.1 中**不存在**（已全量搜索确认）。
   用 `app.renderer.gl.getParameter(gl.MAX_TEXTURE_SIZE)` 代替。
