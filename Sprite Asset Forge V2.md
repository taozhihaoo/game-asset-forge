
# Sprite Asset Forge V2 开发提示词

> **修订记录（Approved Amendments — 2026-10-02）**
>
> 本文档经评审采纳为 V2 开发指导。以下修正案与正文冲突时以本节为准。
> 同时记录路线重排（V1 文档修订记录 A8）：V2 由原章程的
> Character Cutout/Rigging 重排为 Asset Quality Assistant；
> Rigging 顺延为 V3，生成式辅助为 V4；Spine 维持 Backlog
> （依赖 Rigging 存在，跳过成本为零；公开发布前需 Esoteric 书面确认）。
>
> **B1 命名统一**：项目名 GameAsset Forge，CLI 命令为 `gameassetforge`
> （正文中所有 `forge analyze` 按 `gameassetforge analyze` 执行）。
>
> **B2 目录结构以实际代码为准**：core 为扁平纯函数模块
> （detect/trim/resize/bleed/pivot/atlas/manifest/preset），exporters 位于
> `packages/cli/src/exporters`（章程 §20 的分层设计，core 保持引擎盲）。
> Phase 0 审计输出实际结构。
>
> **B3 analyze() 输入契约**：分析器以文件集合为一等输入
> `AssetFile { name, raster, byteSize? }`；manifest/pivot 元数据可选注入。
> 不引入名为 SpriteAsset 的未知类型。
>
> **B4 规则依赖序**：naming/grouping 解析先于 size-consistency 检查
> （"同一动画"的分组依据就是命名解析结果）。
>
> **B5 Duplicate 语义**：exact = trim 后归一化光栅的字节 hash 全等；
> near = dHash 8×8 + Hamming 距离 ≤ 5（阈值可配置）。
> "Potential saving" 是编码后字节概念，由 CLI 层用真实文件尺寸补全，
> core 不知道文件大小。
>
> **B6 Pivot 规则**：角色识别不得靠猜——preset 可配置
> `quality.characterPatterns`（默认空 = 对所有 sprite 只给 info 级提示
> "pivot 偏离 bottom-center"）。建议坐标输出归一化 pivot
> （相对 trimmed rect），不输出绝对像素。
>
> **B7 preset 集成**：新增可选 `quality` 节 → schemaVersion 升 2 +
> v1→v2 迁移（Phase 1 预留的迁移注册表的第一个真实用例）。
>
> **B8 分层**：报告数据（AssetReport / quality_report）在 core；
> HTML 渲染在 CLI 层（core 保持展示盲）。
>
> **B9 确定性**：报告内规则排序必须稳定（固定规则序 + 稳定 tie-break），
> 禁止 hash-map 遍历顺序影响输出（与 V1 §12 同规）。

```
你现在负责开发 Sprite Asset Forge V2。

这是一个已经完成 V1 的项目。

（V1 状态备注：11 阶段全部完成，25 条 DoD 24 条 CONFIRMED；唯一未决项
[16] Godot 运行时播放因环境无 Godot 标记 BLOCKED，未伪造——见
docs/final-audit.md。开工 V2 前建议先安装 Godot 补验，
步骤见 samples/godot-smoke/README.md。）

不要重新设计架构。
不要重写 V1。
先审计现有代码，然后在现有架构上增量开发。

项目定位：

Sprite Asset Forge 是一个面向独立游戏开发者的资源处理工具。

V1 已完成：

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
Atlas Packing
    ↓
Godot / Unity Export


V2 目标：

从 Asset Pipeline 升级为 Asset Quality Assistant。

核心理念：

帮助游戏开发者发现、美术资源中的隐藏问题，并给出可操作建议。

不是自动修改所有东西。

原则：

Detection first.
Suggestion second.
Modification optional.

```

---

# 开发前必须执行

## Phase 0：代码审计

不要修改任何代码。

输出：

```
A. 当前目录结构

B. Core / CLI / GUI 分层

C. Pipeline 数据流

D. Preset Schema 当前版本

E. 已存在测试

F. V2 最佳插入位置

G. 风险点
```

确认后再开发。

---

# V2 架构目标

保持（实际结构，Phase 0 审计复核，见修订记录 B2）：

```
packages/

 core/     扁平纯函数模块：detect / trim / resize / bleed / pivot /
           atlas / manifest / preset
           + V2 新增 quality/（见下）

 cli/      命令层：PNG 编解码、批处理、exporters（godot/unity）
           + V2 新增 analyze 命令与 HTML 报告渲染

 gui/      Electron 三进程壳（main / preload / renderer）
```

新增：

```
core/

 quality/

    analyzer.ts

    rules/

        transparency.ts
        duplicate.ts
        size.ts
        pivot.ts
        naming.ts

    models.ts
```

依赖方向：

必须：

```
quality
    |
    v
core image model
```

禁止：

```
quality
    |
    v
GUI
```

---

# V2 Feature 1：Asset Analyzer

新增：

```
analyze()
```

输入：

```
SpriteAsset[]
```

输出：

```typescript
AssetReport
{
 assetId,

 warnings:[
    {
       rule,
       severity,
       message,
       suggestion
    }
 ]
}
```

例如：

```json
{
 "asset":"hero_idle_01.png",

 "warnings":[

 {
 "rule":"transparent_border",
 "severity":"medium",
 "message":
 "42% pixels are transparent",

 "suggestion":
 "Consider trimming or reducing canvas size"
 }

 ]
}
```

---

# V2 Feature 2：透明区域检测

实现：

检测：

## 1. 空白比例

例如：

图片：

```
256x256
```

实际内容：

```
80x100
```

报告：

```
Unused canvas:
73%
```

规则：

可配置：

```json
{
 "maxTransparentRatio":0.6
}
```

---

## 2. 不一致尺寸检测

例如：

同一动画：

```
walk_01 128x128

walk_02 128x128

walk_03 256x256
```

报告：

```
Frame size mismatch
```

---

# V2 Feature 3：Duplicate Detection

目标：

发现重复帧。

实现：

不要使用 AI。

使用：

* hash
* perceptual hash

流程：

```
image

↓

normalize

↓

hash

↓

compare

↓

duplicate group
```

输出：

例如：

```
Duplicate frames:

idle_01.png
idle_copy.png

Similarity:
100%

Potential saving:
42KB
```

要求：

支持：

* 完全相同
* 接近相同

---

# V2 Feature 4：Pivot 检查

检查：

```
sprite pivot
```

例如：

角色：

正常：

```
bottom-center
```

异常：

```
center
```

输出：

```
Warning:

Character sprite pivot is not near feet.

Suggested:
(64,128)
```

注意：

这里只检测。

不要自动修改。

---

# V2 Feature 5：Naming Convention Checker

检查：

例如：

推荐：

```
hero_idle_01.png
hero_idle_02.png
hero_run_01.png
```

发现：

```
final.png
aaa.png
test2.png
```

报告：

```
Non descriptive filename
```

---

# V2 Feature 6：CLI

新增：

命令：

```bash
gameassetforge analyze \
 --input assets/
```

输出：

```
Sprite Asset Report

==================

Assets:
124


Warnings:

High:
3

Medium:
12

Low:
24


Potential cleanup:
18MB

Report:

report.json
report.html
```

---

# V2 Feature 7：JSON Report

新增：

```
quality_report.json
```

格式：

```json
{
 "version":2,

 "summary":{

 "assets":120,

 "warnings":39

 },

 "issues":[]
}
```

必须：

schemaVersion。

---

# V2 Feature 8：HTML Report

生成：

```
report.html
```

简单即可。

要求：

打开浏览器：

看到：

```
Asset Quality Report


Hero

⚠ Large transparent area

⚠ Duplicate frames


Monster

✓ Good
```

---

# GUI V2（限制）

只增加：

新的 Tab：

```
Pipeline | Quality
```

Quality 页面：

显示：

```
Assets

Warnings

Severity


[Export Report]
```

禁止：

❌ Photoshop式编辑

❌ 复杂画布

❌ 时间轴

---

# 测试要求

新增测试：

至少：

```
30+
```

覆盖：

## Transparency

* empty image
* large transparent area
* normal sprite

## Duplicate

* exact duplicate
* similar image
* different image

## Size

* consistent
* mismatch

## Naming

* valid
* invalid

## Report

* JSON schema
* HTML generation

---

# 验收标准

V2 完成必须满足：

## Scenario 1

输入：

```
assets/
|
|- hero_idle_01.png
|- hero_idle_copy.png
|- hero_walk_01.png
|- bad_name.png
```

运行：

```
gameassetforge analyze assets/
```

输出：

发现：

```
duplicate

naming issue

size issue

transparent issue
```

---

## Scenario 2

完整游戏资源目录：

```
characters/
monsters/
items/
ui/
```

运行：

生成：

```
quality_report.html
```

开发者可以快速发现资源问题。

---

# 明确禁止

本阶段不要实现：

```
AI image recognition

SAM

automatic layer separation

animation generation

Spine

rigging

inpainting

model download

cloud API
```

这些属于 V3+。

---

# 最终输出要求

开发完成后输出：

```
1. 修改文件列表

2. 新增功能列表

3. 架构变化

4. 测试数量

5. Demo运行结果

6. 截图建议

7. README更新建议

8. 是否达到V2 release标准
```

开始前先执行 Phase 0 审计。

```

---

我建议 V2 做完后，这个项目会出现一个很有意思的定位：

不是：

> "又一个 AI 工具"

而是：

> **Game Asset Engineering Tool**

这个定位更稀缺。

而且它和你现有背景（Godot/C#/卡牌 roguelite）形成闭环，比继续做第 10 个 Python SaaS demo 更有辨识度。
```

---

# 实施阶段（补充骨架 — 2026-10-02，修订记录配套）

严格按序执行；每完成一个阶段提交一笔（Git 政策见 V1 文档修订记录 A7）。

Phase 0 — 代码审计（本文档 Phase 0 节：输出 A–G，不改任何代码）
Phase 1 — core/quality：models + 五条规则 + analyzer + 单元测试
Phase 2 — preset schemaVersion 2：quality 节 + v1→v2 迁移 + 迁移测试
Phase 3 — CLI analyze 命令 + quality_report.json + KB 代价补全（B5）
Phase 4 — HTML 报告渲染（CLI 层，B8）
Phase 5 — GUI Quality 页（Pipeline | Quality Tab + 列表 + 导出按钮）
Phase 6 — golden 测试 + 验收 Scenario 1/2 实测
Phase 7 — README 增补 + 最终审计

# V2 Definition of Done（补充骨架）

必须同时满足：

[1] Phase 0 审计报告完成且未修改任何代码
[2] 五条规则全部实现且有单元测试
[3] preset v1→v2 迁移可用，旧 v1 preset 文件无损加载
[4] gameassetforge analyze 单目录一条命令输出 JSON + HTML 报告
[5] 验收 Scenario 1：duplicate / naming / size / transparent 四类问题全部命中
[6] 验收 Scenario 2：多目录树生成可读 HTML 报告
[7] 报告确定性：同输入双跑 JSON 全等
[8] 新增测试 ≥ 30 条且全部通过
[9] 原有 129 条测试无回归
[10] lint / typecheck / build / format 全绿
[11] README 增补 Quality 章节
[12] 每个子任务一笔提交

# 停止条款（补充骨架）

满足 DoD 即停止开发并发布 V2。

不要因为：

“以后可以加 AI 分析”
“以后可以自动修复”
“以后可以加更多规则”

而继续扩 V2——规则数量冻结在五条，新规则进 backlog。
