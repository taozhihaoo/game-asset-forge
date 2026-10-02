
# Sprite Asset Forge V3 开发提示词

> **修订记录（Approved Amendments — 2026-10-02）**
>
> 本文档经评审采纳为 V3 开发指导。以下修正案与正文冲突时以本节为准。
> 路线记录（A8 之后第二次重排，用户知情接受）：V3 = AI Assisted Asset
> Understanding（建议型 AI，不碰生成）；Character Cutout/Rigging 顺延至
> V4/V5——本 V3 的 assetType 分类（humanoid/animal/item）正是将来
> Rigging 模板选择的前置数据，是为 Rigging 铺路。V3 前置条件 =
> V2（Quality Assistant）完成 + V1 的 Godot [16] 尾巴补验。
>
> **C1 命名统一**：项目名 GameAsset Forge；命令为
> `gameassetforge ai analyze`（正文 `analyze-ai` / `forge ai analyze`
> 均按此执行）；AI 侧函数命名 understand()/assist()，避免与 V2
> quality 的 analyze() 撞名。
>
> **C2 AI 层独立成包（取代正文“core/ 内新增 ai/”）**：新建
> packages/ai，只依赖 core 公开类型，含 VisionProvider 接口、
> mock/cloud providers、prompts、响应 schema 校验。core 禁止
> network/cloud 的章程条款（§1.12）与 lint 硬规则原样生效；core
> 最多增加 AI 结果的纯类型定义。依赖方向不变：AI → Core Models，
> 禁止 Core → AI。
>
> **C3 AI 配置与 pipeline preset 分离**：AI 设置放独立
> ai.config.json / 环境变量，不进流水线 preset——“同 preset 同输出”
> 不变量不被稀释。AI 建议是旁路工件：ai_report.json /
> classification.json / asset_metadata.json 永不进入确定性流水线输出。
>
> **C4 结果缓存**：按 (图像 hash + promptVersion + model) 缓存 AI 结果，
> 重跑不重复计费——这是比“默认关闭”更实际的成本控制。
>
> **C5 隐私告知**：云端 provider 会上传用户素材。GUI 首次启用云端
> provider 必须明示同意，README 必须写明数据流向。CI 只跑 mock
> provider，永不触网。
>
> **C6 确定性**：AI 关闭/失败时，export 与 quality check 的输出必须与
> 无 AI 时逐字节一致（升级为 DoD 验收项）。
>
> **C7 Pivot 建议坐标**：归一化、相对 trimmed rect（延续 V2 修正 B6），
> 不输出绝对像素；正文示例已按此修正。
>
> **C8 Local provider**：V3 仅预留接口（sidecar 进程形态），不实现；
> 离线时 AI 功能明确显示不可用，“完全离线可用基础功能”的承诺不受影响。
>
> **C9 分层落点**：AI 响应的 JSON Schema 校验放 packages/ai；校验失败
> 返回结构化错误且不影响主流程——正文 Feature 9 语义保留，落点改为新包。

```text
你现在负责开发 Sprite Asset Forge V3。

这是一个已经完成 V1 和 V2 的项目。

（状态备注：V1 = PARTIAL 24/25，唯一未决项 [16] Godot 运行时播放因环境
无 Godot 标记 BLOCKED，见 docs/final-audit.md，开工前建议补验；
V2（Quality Assistant）尚未开工——它是本阶段前置，其命名解析器与
pivot checker 是本阶段 Feature 4/5 的升级基座。）

禁止重构已有架构。

必须先审计当前代码，然后增量开发。

项目定位：

Sprite Asset Forge 是一个面向独立游戏开发者的 Game Asset Engineering Tool。

目标：

帮助开发者把 AI 生成、美术制作、素材包中的图片资源快速转换成游戏可用资产。


当前版本：

V1:
Sprite Processing Pipeline

功能:

PNG Sprite Sheet
↓
Detection
↓
Trim
↓
Padding
↓
Pivot
↓
Atlas
↓
Godot/Unity Export


V2:
Asset Quality Assistant

功能:

Transparency detection

Duplicate detection

Size consistency

Naming validation

Quality report


V3目标：

AI Assisted Asset Understanding

增加 AI 辅助能力：

- 自动理解资源内容
- 提供结构化建议
- 辅助人工完成资源准备

AI 是助手，不是替代。
```

---

# Phase 0：现状审计

不要修改代码。

输出：

```
A. 当前版本架构

B. Core API

C. Asset 数据模型

D. Pipeline 生命周期

E. Quality Analyzer 插入点

F. Export 系统

G. 测试覆盖

H. AI 插件最佳位置
```

确认后开发。

---

# V3 总体架构

新增（修订记录 C2：AI 层独立成包，不放 core——core 禁止 network/cloud
的章程条款与 lint 硬规则原样生效）：

```
packages/

 ai/                  ← 独立新包，只依赖 core 公开类型

    analyzer/

    providers/

        mock.ts       ← 测试与 CI 专用，永不触网
        openai.ts     ← 云端实现，默认关闭
        local.ts      ← 预留（sidecar 进程形态，V3 不实现）

    prompts/          ← 版本化 prompt 模板

    schemas/          ← AI 响应的 JSON Schema 校验

core/                 ← 不新增 ai/；最多增加 AI 结果的纯类型定义

cli/                  ← 可选消费 packages/ai（ai analyze 命令）

gui/                  ← 可选消费（AI Assistant 页 + 隐私告知）
```

依赖：

必须：

```
AI Layer
     |
     v
Core Models
```

禁止：

```
Core
 |
 v
AI
```

核心必须：

无 AI 也能运行。

---

# Feature 1：Asset Understanding

目标：

让工具理解：

“这是什么资源？”

输入：

```
hero.png
```

输出：

```json
{
 "assetType":"character",

 "category":"humanoid",

 "description":
 "pixel art warrior character",

 "confidence":0.87
}
```

支持：

assetType:

```
character

monster

item

weapon

environment

ui

unknown
```

---

# Feature 2：AI Asset Metadata

生成：

asset_metadata.json

例如：

```json
{
"name":"hero",

"type":"character",

"style":

{
"genre":"pixel-art",

"perspective":"side-view",

"palette":"warm"
},


"animationSuggestions":[

"idle",

"walk",

"attack"

]


}
```

用途：

后续：

* 自动命名
* 自动分类
* 自动生成动画模板

---

# Feature 3：自动资源分类

输入：

目录：

```
assets/

001.png

002.png

003.png

```

AI 分析：

输出：

```
classified/


characters/

 hero.png


items/

 sword.png


environment/

 tree.png

```

注意：

V3 不直接移动文件。

只生成：

```
classification.json
```

用户确认后执行。

---

# Feature 4：AI Naming Assistant

目标：

解决：

```
IMG_001.png

final2.png

new.png
```

问题。

输入：

```
warrior sword image
```

建议：

```
weapon_sword_01.png
```

输出：

```json
{
"old":

"IMG_001.png",

"suggestion":

"weapon_sword_01.png",

"reason":

"Detected sword weapon"
}
```

必须：

人工确认。

---

# Feature 5：AI Pivot Suggestion

升级 V2 pivot checker。

现在：

V2:

检测错误。

V3:

建议。

例如：

角色：

输入：

```
knight.png
```

输出：

```json
{
  "pivot": { "x": 0.5, "y": 1.0 },
  "confidence": 0.82,
  "anchorPoints": {
    "weapon": { "x": 0.74, "y": 0.54 }
  }
}
```

坐标语义（修订记录 C7）：归一化、相对 trimmed rect、origin top-left——
与 pipeline 的 Pivot 定义一致，不输出绝对像素。

注意：

AI 只提供 suggestion。

最终：

用户确认。

---

# Feature 6：AI Animation Suggestion

不是生成动画。

只是：

根据图片理解：

推荐模板。

例如：

输入：

```
slime.png
```

输出：

```json
{

"recommended":

[

"idle_bounce",

"move_jump"

]

}
```

角色：

```
human:

idle

walk

attack


animal:

idle

run

bite


item:

rotate

float

```

---

# Feature 7：Vision Provider 抽象

必须：

支持：

## Mock

测试使用。

## Cloud

例如：

OpenAI Vision API。

## Local

预留：

```
llama.cpp

local vision model

```

接口：

```typescript
interface VisionProvider {


analyze(
image,
prompt
):Promise<Result>


}

```

---

# Feature 8：Prompt 管理

禁止：

prompt 写死。

新增：

```
prompts/

asset-analysis.md

pivot-detection.md

naming.md

```

支持：

版本：

```json
{
"promptVersion":"1.0"
}
```

---

# Feature 9：AI Response Schema

禁止：

直接相信 AI。

必须：

JSON Schema validation。

例如：

```json
{
"type":

"object",


"properties":

{

"assetType":

{

"enum":

[

"character",

"item",

"monster"

]

}

}

}
```

失败：

返回：

```
AI analysis failed
```

不影响主流程。

---

# Feature 10：CLI

新增：

## ai analyze

例如：

```bash
gameassetforge ai analyze assets/
```

输出：

```
AI Asset Analysis


Files:

120


Detected:

Characters:
35

Items:
42

UI:
20


Suggestions:

Rename:
18

Pivot:
25

Animation:
31


Export:

ai_report.json
```

---

# Feature 11：GUI

增加：

Tab:

```
Pipeline

Quality

AI Assistant
```

AI 页面：

显示：

```
Asset:

hero.png


Detected:

Character


Suggestions:


✓ Rename

✓ Pivot

✓ Animation


[Apply]

[Ignore]

```

---

# Feature 12：成本控制

必须设计：

```
AI enabled:
false
```

默认：

关闭。

配置：

```
AI_PROVIDER=mock

AI_MODEL=

```

避免用户意外消耗 API。

---

# 测试要求

新增：

50+ tests

覆盖：

## Schema

* valid response
* invalid response

## Provider

* mock provider
* failure

## Classification

* character
* item
* unknown

## Naming

* suggestion generation

## Pipeline

AI失败：

不能影响：

```
export
quality check
```

---

# Demo要求

准备：

真实素材：

至少：

```
character/

monster/

item/

ui/

```

运行：

```bash
gameassetforge ai analyze demo-assets/
```

生成：

```
ai_report.json

classification.json

metadata.json
```

---

# 明确禁止

本版本不要：

```
❌ 自动生成图片

❌ Stable Diffusion

❌ ControlNet

❌ SAM segmentation

❌ 自动拆身体

❌ 自动骨骼

❌ Spine

❌ Animation rendering

❌ Cloud mandatory

```

原因：

这些属于 V4/V5。

---

# V3 Release 验收标准

完成：

## 用户流程

```
下载工具

↓

导入一批PNG

↓

点击AI Analysis

↓

获得:

分类

命名建议

pivot建议

动画建议

↓

确认

↓

导出游戏资产

```

---

# 最终输出报告

开发完成后输出：

```
1. 架构变化

2. 新增模块

3. AI Provider设计

4. Schema设计

5. 测试数量

6. Demo截图

7. API成本说明

8. README更新

9. Release判断

10. 下一阶段建议
```

开始前先执行 Phase 0 审计。

```

---

## V3 完成后，这个项目的定位会明显变化

从：

> 一个 Sprite 工具

变成：

> **AI-assisted Game Asset Pipeline**

它会同时覆盖：

|能力|证明|
|-|-|
|图像处理|算法能力|
|工具开发|工程能力|
|AI集成|未来方向|
|游戏开发|领域经验|
|桌面软件|产品能力|

---

但是我建议：

**V3 做完不要马上 V4。**

因为 V4（自动拆层 + Rig + 动画）会进入真正的商业软件领域。

V1-V3 已经足够形成一个非常有辨识度的开源项目。你现在 GitHub 里缺的不是更多 CRUD，而是这种“有个人标签”的作品。

---

# 实施阶段（补充骨架 — 2026-10-02，修订记录配套）

严格按序执行；每完成一个阶段提交一笔。前置条件：V2 完成、V1 Godot [16] 补验。

Phase 0 — 代码审计（本文档 Phase 0 节：输出 A–H，不改任何代码）
Phase 1 — packages/ai 骨架：VisionProvider 接口 + mock provider +
          响应 schema 校验 + 版本化 prompts 目录
Phase 2 — understand()：Asset Understanding + asset_metadata（C3 分离配置）
Phase 3 — 分类建议 classification.json（只生成，不移动文件）
Phase 4 — naming / pivot / animation 三类建议（升级 V2 的对应检查器）
Phase 5 — CLI：gameassetforge ai analyze + ai_report.json + 结果缓存（C4）
Phase 6 — GUI 第三 Tab（AI Assistant：建议列表 + Apply/Ignore + 隐私告知）
Phase 7 — 测试（50+，全部走 mock）+ README 增补 + 最终审计

# V3 Definition of Done（补充骨架）

必须同时满足：

[1] Phase 0 审计报告完成且未修改任何代码
[2] packages/ai 独立成包；core 零网络 lint 规则原样通过（C2）
[3] VisionProvider 三实现：mock 可用、cloud 完整但默认关闭、local 预留
[4] 响应 schema 校验生效：畸形 AI 响应被拒绝且主流程不受影响
[5] AI 关闭/失败时，export 与 quality 输出与无 AI 时逐字节一致（C6）
[6] gameassetforge ai analyze 一条命令出
    ai_report.json / classification.json / asset_metadata.json
[7] 结果缓存生效：同输入重跑零 API 调用（C4）
[8] GUI AI 页：建议列表 + Apply/Ignore，Apply 需人工确认
[9] 隐私告知：GUI 首次启用云端 provider 明示同意（C5）
[10] 新增测试 ≥ 50 条（全部 mock，不触网）且全部通过
[11] 原有测试无回归（以 V2 完成时的数量为基数）
[12] lint / typecheck / build / format 全绿
[13] README 增补 AI 章节（含数据流向说明）
[14] 每个子任务一笔提交

# 停止条款（补充骨架）

满足 DoD 即停止开发并发布 V3。

不要因为：

“以后可以自动拆层”
“以后可以自动骨骼”
“以后可以生成动画”

而继续扩 V3——这些属于 V4/V5（Rigging 阶段）。
AI 建议能力冻结在本文档列出的四类，新建议类型进 backlog。
```
