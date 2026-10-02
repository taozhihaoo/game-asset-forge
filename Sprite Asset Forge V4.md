
# Sprite Asset Forge V4 开发提示词

> **修订记录（Approved Amendments — 2026-10-02）**
>
> 本文档经评审采纳为 V4 开发指导底稿。以下修正案与正文冲突时以本节为准。
> 路线定位：V4 = AI Assisted Transformation，即前两次重排顺延而来的
> Character Cutout/Rigging 阶段（**原型级**）。前置条件 = V1–V3 全部
> 完成 + V1 Godot [16] 补验。继承全部既有修正案（V2 B 系、V3 C 系），
> 以下为 D 系新增与覆盖：
>
> **D1 命名统一**：项目名 GameAsset Forge；命令 `gameassetforge transform`
> （正文 `forge transform` 按此执行）。
>
> **D2 包放置（取代正文架构图）**：`transformation/` 的确定性部分
> （layer/mask/skeleton/mesh/weights 的数据与算法）进 core——纯函数、
> 零网络、typed 数据；`completion/` 的"OpenCV"不存在于本栈：
> Level 2 = 纯 TS 手写 patch-based fill，或降级仅 Level 1（Phase 0 定夺）；
> AI provider（vision/generation/inpainting）一律放 packages/ai
> （继承 V3 C2）；Editor Mode 属 gui 包，`editor/tools` 不进 core。
>
> **D3 产品边界（写进正文）**：V4 层用于 limited deformation（±5–15°）；
> 大角度旋转明确不支持。这是 cutout 原型级工具，不是 Spine 竞品。
>
> **D4 遮挡选级策略**：三级方案规则化——膨胀 ≤ N px（默认 8，可配）
> 走 Level 1；空洞 ≤ 层面积 X%（默认 15%，可配）走 Level 2；
> Level 3 每次显式授权。任何级别失败自动降级到下一级并记录。
>
> **D5 .forge 项目文件**：使用独立版本序列 `forgeVersion: 1`（不与
> preset schemaVersion 混用）；路径一律项目相对；内容清单补全：
> layers/masks/bones/mesh/weights/animationTemplates；示例改为合法
> JSON；版本迁移走既有注册表模式。
>
> **D6 坐标语义**：骨骼/锚点全部归一化、相对层内容空间（B6/C7 延续）；
> parent 引用必须存在且无环（校验入 DoD）。
>
> **D7 分段能力现实**：聊天式云端 Vision API 只能给出粗框/标签建议，
> 不产出像素级 mask；像素级分割依赖 local SAM2（预留）或手动
> Mask Editor。**Mask Editor 是实践中的主路径**，不是 fallback。
>
> **D8 动画预览范围**：模板冻结为 idle + breathing（sin 驱动）；
> walk 需双关节相位振荡，列为 stretch。
>
> **D9 Mesh 算法**：沿轮廓的约束 Delaunay（朴素 Delaunay 会把凹形
> 填实）+ 确定性 tie-break；权重 sum=1 校验保留。
>
> **D10 重建不变量（新增正确性标准）**：所有层按 z-order 合成必须
> ≈ 原图（遮挡补全区除外）——分层的可测正确性属性，进 DoD；
> masks 为源空间单通道 PNG、与原图同尺寸；层带显式 z 序。
> 继承 V3 的 C3/C4/C5/C6（AI 配置分离、缓存、隐私、失败不影响主流程）。

```text
你现在负责开发 Sprite Asset Forge V4。

这是一个已经完成 V1/V2/V3 的成熟项目。

（状态备注：V1 = PARTIAL 24/25，唯一未决项 [16] Godot 运行时播放因环境
无 Godot 标记 BLOCKED（见 docs/final-audit.md）；V2/V3 按 A8 重排尚未
开工。V4 的前置 = V1–V3 全部完成——本文档现阶段是"抽屉里的指导
文档"，先执行 V2/V3。）

禁止推倒重构。

必须先审计当前代码。

必须保持：

Core Pipeline
Quality System
AI Assistant

三个系统稳定。


项目定位：

Sprite Asset Forge

AI-assisted Game Asset Pipeline


目标：

帮助独立游戏开发者：

从单张图片或低质量资源，

快速生成更接近游戏生产要求的资产。


当前版本：

V1:
Asset Processing

V2:
Asset Quality

V3:
AI Understanding


V4:

AI Assisted Transformation


核心原则：

AI负责：

理解
建议
辅助生成中间数据


传统算法负责：

确定性处理
导出
格式转换


任何AI结果必须：

可验证
可撤销
可人工修改

```

---

# Phase 0：完整架构审计

不要修改代码。

输出：

```
A. 当前monorepo结构

B. Core API

C. Asset Model

D. AI Provider架构

E. Pipeline执行流程

F. GUI状态管理

G. Export系统

H. V4插入位置

I. 风险分析
```

确认后开发。

---

# V4 总体架构

新增：

```
packages/

 core/                ← transformation 的确定性部分进 core（D2）

     transformation/

        layer/        层模型（显式 z 序）
        mask/         mask 运算（源空间单通道）
        skeleton/     骨骼数据 + 模板（human/animal/monster）
        mesh/         约束 Delaunay + 距离权重（D9）
        completion/   Level 1 膨胀（core）；Level 2 纯 TS patch fill
                      （Phase 0 定夺；Level 3 AI 在 packages/ai）

 ai/                  ← 既有包扩展（继承 V3 C2）

    vision/           分段建议（粗框/标签，D7）
    generation/       AI inpainting provider（Level 3，可选）

 gui/                 ← Editor Mode 在这里（D2：editor/tools 不进 core）

    tools/
```

依赖：

必须：

```
Transformation

        |
        v

Core Asset Model

        |
        v

Exporter
```

禁止：

```
AI

直接生成最终游戏文件
```

---

# Feature 1：Smart Layer Extraction（核心）

目标：

从：

```
character.png
```

尝试生成：

```
layers/


body.png

head.png

arm_front.png

arm_back.png

weapon.png

```

---

## 注意

这是 V4 最大风险。

不要承诺：

100%自动。

采用：

AI + 用户确认。

流程：

```
Image

↓

Vision Analysis

↓

Layer Proposal

↓

User Review

↓

Generate Layers

```

输出：

```json
{
"layers":[

{
"name":"head",

"confidence":0.92,

"mask":

"head_mask.png"

}

]

}
```

---

# Feature 2：Segmentation System

设计：

Provider 抽象：

```
SegmentationProvider
```

支持：

## Mock

测试。

## Local

预留：

```
SAM2

ONNX Runtime

```

## Cloud

Vision API。

（现实约束 D7：聊天式云端视觉 API 只能输出粗框/标签建议，
不产出像素级 mask；像素级分割依赖 local SAM2（预留）或手动
Mask Editor——它是实践中的主路径。）

接口：

```typescript
interface SegmentationProvider{


segment(
image
):Promise<MaskResult>


}

```

---

# Feature 3：Mask Editor

不要做 Photoshop。

只做：

必要编辑。

定位（修订记录 D7）：Mask Editor 是实践中的主路径，不是 fallback——
AI 只给区域建议，像素级 mask 由本编辑器完成。

功能：

## 显示：

```
Original

Mask

Layer Preview

```

## 操作：

```
Brush +

Brush -

Fill

Undo

Reset

```

限制：

不要：

滤镜

绘画系统

图层混合

---

# Feature 4：Layer Expansion / Occlusion Handling

解决：

最大技术问题：

遮挡。

例如：

手臂移动：

后面的身体不存在。

V4策略：

三级方案。

---

## Level 1

传统扩展：

```
edge padding

pixel dilation

```

默认。

---

## Level 2

Patch completion

例如：

OpenCV inpainting。

用于：

小区域。

---

## Level 3

AI inpainting

可选。

接口：

```
InpaintingProvider
```

失败：

必须降级。

选级策略（修订记录 D4，规则化而非自动猜测）：

膨胀 ≤ N px（默认 8，可配）→ Level 1

空洞 ≤ 层面积 X%（默认 15%，可配）→ Level 2

Level 3 每次显式授权

任何级别失败自动降级到下一级并记录。

产品边界（修订记录 D3，写进正文）：

V4 层用于 limited deformation（±5–15°）。

大角度旋转明确不支持。

这是 cutout 原型级工具，不是 Spine 竞品。

---

# Feature 5：Auto Rig Proposal

不是完整骨骼动画。

只生成：

骨架建议。

输入：

character layer

输出：

```json
{
  "bones": [
    { "name": "root", "position": [0.5, 1.0] },
    { "name": "body", "parent": "root" },
    { "name": "head", "parent": "body" }
  ]
}
```

坐标语义（修订记录 D6）：归一化、相对层内容空间——不输出绝对像素。

parent 引用必须存在且无环（校验入 DoD）。

支持：

基础模板：

```
human

animal

monster

```

---

# Feature 6：Mesh Generation

用于：

未来变形。

实现：

简单即可。

流程：

```
Layer

↓

Contour

↓

Polygon

↓

Triangulation

↓

Mesh
```

算法：

使用：

沿轮廓的约束 Delaunay

（修订记录 D9：朴素 Delaunay 会把凹形填实；三角化必须有
确定性 tie-break——同权重三角形取稳定序。）

输出：

```
vertices

triangles

weights

```

---

# Feature 7：Weight Painting

V4只做：

自动初始权重。

例如：

距离骨骼：

```
close = strong

far = weak

```

算法：

distance based weighting。

输出：

```json
{
vertex:23,

weights:

{

arm:0.8,

body:0.2

}

}
```

不要做：

复杂手绘权重。

---

# Feature 8：Animation Preview

不是动画编辑器。

只是验证。

支持：

模板：

```
idle

breathing

```

walk 为 stretch（需双关节相位振荡，修订记录 D8）。

V4 预览模板冻结为 idle + breathing。

例如：

idle:

```
sin(rotation)

```

显示：

```
Before

After
```

---

# Feature 9：Godot Export Upgrade

新增：

输出：

```
Godot Skeleton2D

Polygon2D

SpriteFrames

AnimationPlayer

```

目标：

用户：

拖入 Godot

即可继续。

---

# Feature 10：Project File

V4正式引入：

`.forge`

例如：

```json
{
  "forgeVersion": 1,
  "asset": { "source": "assets/hero.png" },
  "layers": [],
  "masks": [],
  "bones": [],
  "mesh": [],
  "weights": [],
  "animationTemplates": []
}
```

语义（修订记录 D5）：

独立版本序列 forgeVersion（不与 preset schemaVersion 混用）。

路径一律项目相对。

内容清单补全：layers / masks / bones / mesh / weights /
animationTemplates。

版本迁移走既有注册表模式。

# Feature 11：GUI升级

新增：

Editor Mode

布局：

```
--------------------------------

Layers


        Canvas


              Inspector


--------------------------------


Timeline(optional)

```

必须支持：

Undo/Redo。

---

# Feature 12：AI Workflow

完整流程：

```
Import Image


↓

AI Analyze


↓

Suggest Layers


↓

User Confirm


↓

Generate Masks


↓

Create Rig


↓

Preview


↓

Export

```

---

# CLI支持

新增：

```bash
gameassetforge transform hero.png
```

输出：

```
hero.forge

layers/

godot-export/

preview/
```

---

# 测试要求

新增：

100+ tests

覆盖：

## Segmentation

mock result

failure

invalid mask

## Layer

create

merge

delete

## Mesh

valid topology

invalid topology

## Weight

sum = 1

## Export

Godot files valid

## AI Failure

AI unavailable:

pipeline continues

---

# Demo要求

准备：

真实素材：

至少：

```
character

monster

animal

```

展示：

输入：

```
orc.png
```

输出：

```
orc.forge


layers:

head

body

arm


bones:

root

body

head


Godot export ready

```

---

# 明确禁止

V4不要：

```
❌ 完整Spine替代

❌ 自动生成角色

❌ AI训练

❌ 大模型部署

❌ 云端强依赖

❌ 自动完成复杂动画

❌ 游戏引擎
```

---

# Release验收标准

V4完成标准：

一个独立开发者：

拿一张PNG角色图：

可以：

```
导入

↓

获得建议分层

↓

人工修正

↓

生成基础骨架

↓

预览简单动画

↓

导出Godot资源

```

整个过程：

30分钟以内。

---

# 最终报告格式

完成后输出：

```
1. 架构变化

2. 新增模块

3. AI Provider设计

4. Layer系统设计

5. Mask方案

6. Rig方案

7. Export结果

8. 测试数量

9. Demo截图

10. V4 Release判断

11. V5建议
```

开始开发前先执行 Phase 0 审计。

```

---

## V4 完成后的项目定位

这时它已经不是“小工具”：

```

Sprite Asset Forge

```
   AI
    |
    |
```

Image → Asset Pipeline → Game Engine

```

对应市场：

|用户|痛点|
|-|-|
|独立游戏开发者|缺美术|
|素材包作者|资源整理|
|AI游戏开发者|AI图转游戏资产|
|Godot开发者|缺少Unity级工具|

---

不过我建议你**不要急着做 V4**。

原因：

V1-V3 已经足够形成 GitHub 招牌项目。

V4 最大的问题不是技术，而是：

> 它开始接近 Aseprite + Spine + Unity 2D Animation 的交叉区域。

如果未来做商业化，V4/V5 才值得投入。

个人开发路线建议：

```

V1  ✅ 必做
V2  ✅ 必做
V3  ✅ 强烈推荐

V4  做原型即可

V5  再决定是否商业化

```

V4 是“梦想版”，V1-V3 是“能真正发布和积累用户的版本”。
```

---

# 实施阶段（补充骨架 — 2026-10-02，修订记录配套）

严格按序执行；每完成一个阶段提交一笔。前置条件：V1–V3 全部完成
（含 V1 Godot [16] 补验）。本阶段是四个版本中最重的一个——编辑器
交互占大头，按原型级标准控制投入。

Phase 0 — 完整架构审计（本文档 Phase 0 节：输出 A–I，不改任何代码；
          含 D2 的 Level 2 实现方式定夺）
Phase 1 — core transformation 数据模型：Layer/Mask/Bone/Mesh/Weights
          + 显式 z 序
Phase 2 — SegmentationProvider（mock + cloud 粗建议 + local 预留）
          + Mask Editor
Phase 3 — 层生成 + 遮挡三级方案（D4 选级 + D10 重建不变量测试）
Phase 4 — Rig proposal（模板 + 归一化坐标）+ 约束 Delaunay mesh
          + 距离权重
Phase 5 — 动画预览（idle/breathing）+ Godot Skeleton2D 导出升级
Phase 6 — .forge 项目文件（forgeVersion 1 + 迁移注册表）
Phase 7 — GUI Editor Mode（Layers/Canvas/Inspector + Undo/Redo）
Phase 8 — 测试（100+）+ Demo（character/monster/animal）+ 最终审计

# V4 Definition of Done（补充骨架）

定位声明：**V4 = 原型级（prototype-grade）cutout/rig 编辑器**，不是
产品级 Spine 竞品——本条是验收基调，不是免责声明。

必须同时满足：

[1] Phase 0 审计报告完成且未修改任何代码
[2] core 零网络 lint 规则原样通过；AI provider 全部在 packages/ai（D2）
[3] SegmentationProvider 三实现：mock 可用、cloud 粗建议、local 预留
[4] Mask Editor：显示 Original/Mask/Layer Preview
    + Brush±/Fill/Undo/Reset（D7 主路径）
[5] 遮挡三级方案生效且可配置（D4），失败自动降级并记录
[6] 重建不变量测试通过：层合成 ≈ 原图（D10）
[7] Rig proposal：human/animal/monster 模板 + 归一化坐标
    + 父引用存在且无环
[8] 约束 Delaunay mesh + 权重 sum=1，全部确定性（D9）
[9] 动画预览：idle/breathing 模板，Before/After 切换（D8）
[10] Godot Skeleton2D 导出生成且静态校验通过；运行时验证若无 Godot
     如实标 BLOCKED（继承诚实条款）
[11] .forge v1 读写 + 迁移注册表可用（D5）
[12] GUI Editor Mode：Layers/Canvas/Inspector + Undo/Redo
[13] AI 关闭/失败时全流程可走 Level 1 传统方案（继承 C6）
[14] 新增测试 ≥ 100 条且全部通过；既有测试无回归
[15] lint / typecheck / build / format 全绿
[16] Demo：orc.png → .forge + layers + bones + Godot export
     （30 分钟流程为 stretch 目标）
[17] 每个子任务一笔提交

# 停止条款（补充骨架）

满足 DoD 即停止开发并发布 V4 原型。

不要因为：

“以后可以做完整骨骼动画编辑”
“以后可以做时间轴曲线”
“以后可以自动生成角色”

而继续扩 V4——这些属于 V5/商业化阶段。

以本文档结尾的判断为准：V1–V3 是能真正发布和积累用户的版本，
V4 保持原型级，V5 再决定商业化。
