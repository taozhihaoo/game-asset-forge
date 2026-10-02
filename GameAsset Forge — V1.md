你现在开始开发一个全新的独立软件项目：

# GameAsset Forge

Project type:
Local-first 2D Game Asset Preparation Pipeline

Repository name:
gameasset-forge

核心定位：

将游戏开发者手里的 PNG / Sprite Sheet / 图片资源，
通过一个可重复执行的 Pipeline，
转换成结构化、可直接进入游戏开发流程的游戏 2D 资源。

核心目标：

Image
→ Detect / Split
→ Trim
→ Resize
→ Padding / Bleed
→ Pivot
→ Atlas Packing
→ Export
→ Godot / Unity / Generic JSON

这个项目不是 AI 绘画软件。
不是 Photoshop 替代品。
不是 Spine 替代品。
不是完整角色动画编辑器。

V1 的价值是：

“把一堆原始 PNG / Sprite Sheet 快速加工成 game-ready sprite assets。”

========================================
修订记录（Approved Amendments — 2026-10-02）
========================================

以下修正案已在 Phase 0/1 评审中批准并落地实现。
正文相关章节已同步更新；如有出入，以本节和实际实现为准。

A1 padding/bleed/spacing 关系（取代原 §10 的 bleed <= spacing 校验）

padding 与 bleed 都烘进每个 sprite 的 cell 光栅。

cell = content + 2*(padding + bleed)

atlas.spacing 只表示 cell 之间的最小透明间隙。

不存在 bleed <= spacing 约束。

两个 sprite 内容像素之间的有效透明距离：

bleed(A) + padding(A) + spacing + padding(B) + bleed(B)

A2 无 alpha 通道的 PNG 契约（补全 §7）

PNG-only 不保证有 alpha（RGB PNG 合法存在）。

解码器必须保留 IHDR color type 信息（core 的 RasterImage.hasAlpha）。

alpha-connected-components 遇无 alpha 源 → NoAlphaChannelError，提示改用 grid / manual。

grid 遇无 alpha 源 → 保留全部 cell（不丢弃空 cell）。

manual 遇无 alpha 源 → 正常执行。

注意：pngjs 解码后统一输出 RGBA 缓冲，有无 alpha 只能在 IHDR 层判断。

A3 Manifest 字段语义（补全 §13）

每个 sprite 必须同时输出：

rect = packed cell 在 page 上的位置（PAGE SPACE）

sourceRect = 检测矩形（SOURCE SPACE）

trimmedRect = trim 后内容边界（SOURCE SPACE）

pivot = 归一化坐标，相对 trimmed rect（CONTENT SPACE）

A4 Pivot 参照系钉死（补全 §11）

pivot 归一化坐标相对 trimmed（content）rect，

与 cell 光栅无关，与引擎约定无关。

默认模式名从 trimmed-bottom-center 简化为 bottom-center

（参照系已由本条钉死，前缀冗余）。

A5 API 名与 stage 列表微调（§17 / §28）

trimSprite / resizeSprite 实际落地为 trimRaster / resizeRaster。

margin 组合 = applyBleed + applyPadding + composeCellRaster。

装配入口 = buildSprites(image, pipeline, { sourcePath })。

ForgeError stage 列表增加 preset。

A6 V1 完成状态（2026-10-02 更新：V1 = DONE）

11 个阶段全部完成，129 测试全绿，CI 就绪。

最终审计见 docs/final-audit.md：25 条 DoD 全部 CONFIRMED。

原唯一未决项 [16] Godot 运行时播放已于同日补验：

安装 Godot 4.7.2-stable 便携版 → 无头运行时冒烟

（导入 OK / main.tscn 实例化 / 生成的 SpriteFrames 加载 /

autoplay 生效 / 动画帧真实翻转 frames_observed=[0,1]）。

冒烟脚本已转正：samples/godot-smoke/test_smoke.gd（可复现）。

按 §37，V1 = DONE。

A7 提交政策修订（取代 §1.20 原文）

每完成一个子任务提交一笔（英文 conventional commits）。

开发文档（docs/ 阶段报告、最终审计、章程/规划 md）可暂缓提交。

push 仍需明确要求。已回填 6 笔提交（scaffolding/core/cli/gui/测试/CI）。

A8 路线重排（2026-10-02 用户确认）

V2 = Asset Quality Assistant（见《Sprite Asset Forge V2.md》及其修订记录）。

原 V2 的 Character Cutout/Rigging 顺延为 V3（遮挡像素需生成式补全的

承重墙分析仍然适用）；生成式辅助为 V4。

Spine 维持 Backlog：跳过成本为零（依赖 Rigging 存在），公开发布前

需向 Esoteric Software 书面确认授权边界。

========================================
一、最高优先级原则
========================================

1. 这是一个全新的项目，目前仓库可能为空。
2. 开始编码前必须先进行环境审计和技术方案落地检查。
3. 必须基于当前真实工作区，不要依赖旧项目记忆。
4. 必须采用增量、可验证的阶段式开发。
5. 不允许第一阶段就开始开发复杂 GUI。
6. Core 必须先于 GUI 稳定。
7. CLI 必须先能完整跑通核心 Pipeline。
8. GUI 只是 Core 的壳。
9. CLI 与 GUI 必须使用同一份 Pipeline / Preset 数据模型。
10. Core 不允许依赖 Electron、PixiJS、DOM、Node filesystem、GUI 状态。
11. Core 不允许直接读文件或写文件。
12. Core 不允许包含任何 AI / ML / network / cloud API 调用。
13. V1 不允许依赖任何在线服务。
14. V1 必须完全可以脱离 AI 独立运行。
15. 不允许为了“技术含量”而加入无关基础设施。
16. 不允许提前实现 V2/V3 功能。
17. 不允许过度设计。
18. 不允许为了代码量而创造抽象层。
19. 所有 README、注释和最终报告必须以实际实现为准。
20. Git 提交政策（A7 修订）：每完成一个子任务提交一笔；开发文档可暂缓提交；push 需明确要求。

========================================
二、V1 的冻结范围
========================================

V1 必须实现：

INPUT
- PNG only
- single PNG
- folder of PNG files
- sprite sheet PNG

DETECTION
- alpha connected-components detection
- explicit grid detection
- manual rectangle fallback

IMAGE PROCESSING
- trim transparent pixels
- alpha threshold
- minimum component size
- padding
- edge bleed / extrusion
- resize
- nearest-neighbor interpolation
- linear interpolation
- pivot calculation
- manual pivot override

ATLAS
- deterministic atlas packing
- MaxRects 或同等级的成熟 2D bin packing algorithm
- configurable atlas size
- multi-page atlas
- configurable spacing
- deterministic output order

BATCH
- folder input
- recursive / non-recursive option
- include/exclude pattern
- preset-driven processing
- deterministic output directory

OUTPUT
- atlas PNG
- metadata JSON
- optional Godot resources
- optional Unity Editor importer script

CLI
- init
- inspect
- process
- batch
- validate

GUI
- file/folder import
- preview
- detected rectangles overlay
- zoom / pan
- asset list
- properties panel
- pivot editor
- preset load/save
- process button
- output preview
- manual rectangle fallback
- basic logs/errors

TESTING
- unit tests
- integration tests
- golden/snapshot tests
- real-world fixture validation
- deterministic output checks

DOCUMENTATION
- README
- architecture
- preset schema
- CLI usage
- export format
- limitations
- V1 scope
- examples

========================================
三、V1 明确禁止
========================================

本轮不要实现：

- AI image generation
- OpenAI
- Claude
- image-to-image generation
- Stable Diffusion
- SAM / SAM2
- automatic character segmentation
- body-part recognition
- auto-rig
- bones
- mesh deformation
- weights
- Spine export
- animation timeline
- onion skin
- animation editor
- JPG
- WebP
- video
- OCR
- cloud processing
- account system
- telemetry
- analytics
- cloud storage
- login
- SaaS backend
- database server
- PostgreSQL
- Redis
- Docker
- Kubernetes
- Electron main-process business logic
- React
- Redux
- complex UI framework
- plugin marketplace

尤其不要实现：

“把一张完整角色立绘自动变成完整可动画角色”。

这是 V3+（A8 路线重排后：V2 = Asset Quality Assistant，Rigging 顺延 V3）。

========================================
四、架构原则
========================================

最终采用 monorepo：

gameasset-forge/
├── packages/
│   ├── core/
│   ├── cli/
│   └── gui/
├── schemas/
├── tests/
├── presets/
├── samples/
├── docs/
├── package.json
├── tsconfig.base.json
├── README.md
└── .gitignore

使用 npm workspaces。

--------------------------------------------------
packages/core
--------------------------------------------------

核心业务逻辑。

Core 必须是 UI-independent、IO-independent。

Core 不允许 import：

- electron
- pixi.js
- fs
- path
- child_process
- process
- DOM
- window
- document

Core 只能接收：

- typed image data
- typed pipeline data
- typed asset metadata

核心原则：

pure functions first

核心类型至少包含：

RasterImage
ImageSize
Rect
Point
Pivot
Sprite
SpriteSet
Atlas
AtlasPage
AtlasPlacement
Pipeline
Preset
ExportManifest

--------------------------------------------------
packages/cli
--------------------------------------------------

负责：

- filesystem
- PNG decoding
- PNG encoding
- CLI argument parsing
- preset loading
- batch filesystem traversal
- report generation
- calling core functions

CLI 是 Core 的第一个真实消费者。

--------------------------------------------------
packages/gui
--------------------------------------------------

Electron desktop shell。

建议：

Electron
+
PixiJS
+
plain TypeScript
+
HTML/CSS

不要引入 React。

GUI 负责：

- file/folder selection
- drag & drop
- preview
- user interaction
- preset editing
- calling core
- showing results

Electron main / preload / renderer 应明确分离。

使用安全默认值：

contextIsolation = true
nodeIntegration = false

renderer 不直接访问 filesystem。

必要的 filesystem / IPC 操作经过 preload API。

PixiJS 只负责渲染和交互画布。

不要让 PixiJS API 污染 core。

========================================
五、Preset / Pipeline 数据模型
========================================

这是本项目最重要的跨层契约。

GUI 和 CLI 不直接互相通信。

两者唯一共享的业务配置方式：

Preset JSON

核心原则：

Pipeline 是内部数据结构。

Preset 是 Pipeline 的可保存实例。

Preset JSON 必须带：

schemaVersion

要求：

- serializer 输出时 schemaVersion 必须是顶层第一个字段
- parser 不得依赖 JSON 属性顺序
- schemaVersion 必须用于未来 migration
- 不允许直接修改旧 schema 语义
- migration 应该可测试

提供：

schemas/preset.schema.json

当前：

schemaVersion = 1

--------------------------------------------------
建议 Preset v1
--------------------------------------------------

示例：

{
  "schemaVersion": 1,
  "input": {
    "format": "png",
    "recursive": true,
    "include": ["**/*.png"],
    "exclude": ["**/output/**"]
  },
  "detect": {
    "mode": "alpha-connected-components",
    "alphaThreshold": 8,
    "minPixels": 4,
    "connectivity": 8
  },
  "trim": {
    "enabled": true
  },
  "resize": {
    "enabled": false,
    "mode": "scale",
    "scale": 1,
    "filter": "nearest"
  },
  "padding": {
    "pixels": 2
  },
  "bleed": {
    "pixels": 2
  },
  "pivot": {
    "mode": "bottom-center"
  },
  "atlas": {
    "maxWidth": 2048,
    "maxHeight": 2048,
    "algorithm": "maxrects",
    "spacing": 2
  },
  "output": {
    "format": ["png", "json"],
    "godot": {
      "enabled": false
    },
    "unity": {
      "enabled": false
    }
  }
}

具体 schema 可以根据实现微调，
但语义必须先定义清楚再编码。

========================================
六、Resize 语义
========================================

必须明确写入 schema/documentation：

Resize 发生在：

detect
→ trim
→ resize
→ bleed
→ atlas packing

Resize 作用对象：

“每一个最终 sprite raster”。

V1 支持：

mode = scale

例如：

scale = 2
表示：
width × 2
height × 2

V1 支持：

nearest
linear

默认：

nearest

原因：

游戏像素图默认不应产生模糊。

Resize 不允许：

- 改变 sprite 内容比例
- 自动裁剪
- 自动补边

除非显式启用其他 pipeline step。

必须测试：

1x
2x
0.5x
nearest
linear

========================================
七、PNG 输入契约
========================================

V1 只支持 PNG。

遇到：

.jpg
.jpeg
.webp
.gif
.bmp

必须输出明确错误：

Unsupported image format: PNG is the only supported V1 input format.

不能偷偷转换。

不能自动下载转换器。

不能失败时静默跳过。

PNG-only 不保证有 alpha（RGB PNG 合法存在，修正案 A2）。

解码器必须保留 IHDR color type 信息（core 的 RasterImage.hasAlpha）。

无 alpha 源的行为契约：

alpha-connected-components 检测 → NoAlphaChannelError，提示改用 grid / manual。

grid 模式 → 保留全部 cell（不丢弃空 cell）。

manual 模式 → 正常执行。

注意：pngjs 解码后统一输出 RGBA 缓冲，有无 alpha 只能在 IHDR 层判断。

批处理模式：

单个不支持文件应该：

- 显示 error
- 记录失败
- 继续处理其他合法 PNG

最终报告必须统计：

processed
succeeded
failed

========================================
八、Sprite Detection
========================================

至少实现三种模式：

1. alpha-connected-components
2. grid
3. manual

--------------------------------------------------
1. alpha-connected-components
--------------------------------------------------

默认使用 8-connectivity。

算法：

1. 遍历 alpha channel
2. alpha >= alphaThreshold 视为 foreground
3. connected component labeling
4. 得到 bounding rectangles
5. 删除面积小于 minPixels 的组件
6. 进行稳定排序

默认排序：

top-to-bottom
then left-to-right

相同坐标必须由稳定 tie-break 保证 deterministic。

必须避免：

- NaN
- 负尺寸
- 越界 rect
- 零面积 sprite

--------------------------------------------------
2. grid
--------------------------------------------------

支持：

rows / columns

或者：

cellWidth / cellHeight

必须明确 grid 单元坐标计算。

不需要 V1 自动猜测复杂 grid。

--------------------------------------------------
3. manual
--------------------------------------------------

允许用户传入 rect：

x
y
width
height

所有 rect 必须经过 bounds validation。

========================================
九、Trim
========================================

Trim：

删除 sprite 周围完全透明区域。

必须定义：

alpha threshold 使用 detection threshold 或独立 threshold？

V1 建议：

trim 使用独立：

trim.alphaThreshold

默认与 detect.alphaThreshold 相同。

Trim 输出：

originalRect
trimmedRect

必须保存这些 metadata。

如果一个 sprite 全透明：

直接报告 invalid/empty sprite，
不能生成 0x0 texture。

========================================
十、Padding / Bleed
========================================

明确区分：

padding
和
bleed/extrusion

padding：

sprites 之间的最小透明间距。

bleed：

复制 sprite 边缘像素到其外围，
减少 texture filtering bleeding。

约定（修正案 A1，取代原 bleed <= spacing 校验）：

padding 与 bleed 都烘进每个 sprite 的 cell 光栅。

cell = content + 2*(padding + bleed)

atlas.spacing 只表示 cell 之间的最小透明间隙。

不存在 bleed <= spacing 约束。

两个 sprite 内容像素之间的有效透明距离：

bleed(A) + padding(A) + spacing + padding(B) + bleed(B)

metadata 中 sprite 的 source region：

只记录真实 sprite region。

bleed/extrusion 与 padding 都不属于用户 sprite region。

管线顺序：

detect → trim → resize → applyBleed → applyPadding → pack

必须测试：

padding = 0
padding = 2
bleed = 0
bleed = 2
组合：cell = content + 2*(bleed + padding)

========================================
十一、Pivot
========================================

内部统一使用：

normalized coordinates

范围：

x ∈ [0,1]
y ∈ [0,1]

坐标系统：

origin = top-left

参照系（修正案 A4）：

相对 trimmed（content）rect

与 cell 光栅无关，与引擎约定无关

V1 支持：

center
bottom-center
manual

建议：

center = 0.5, 0.5
bottom-center = 0.5, 1.0

默认：

bottom-center（修正案 A4：原 trimmed-bottom-center 简化，参照系已钉死）

必须允许：

manual override

并在 output JSON 保存：

pivot:
{
  "x": 0.5,
  "y": 1.0
}

Exporter 再根据目标引擎坐标规则转换。

不要把 Unity / Godot 坐标差异污染 core。

========================================
十二、Atlas Packing
========================================

V1 使用：

MaxRects

或者同等级的成熟 deterministic bin packing algorithm。

不要实现多个算法。

不要加入 Skyline + Shelf + Guillotine 等一堆算法。

只实现一个稳定版本。

要求：

- maxWidth
- maxHeight
- spacing
- multi-page output
- deterministic placement
- stable ordering

排序优先：

input order
then sprite index

不能因为 hash map 遍历顺序改变结果。

同样输入 + 同样 preset：

必须得到：

完全一致的 metadata
完全一致的 sprite placement
完全一致的 page count

如果 encoder 能保证确定性：

输出 PNG 也应尽可能 deterministic。

如果 PNG encoder 在不同环境产生 metadata 差异，
测试比较 pixel data，而不是 byte-for-byte 文件内容。

========================================
十三、Atlas Manifest JSON
========================================

输出类似：

{
  "schemaVersion": 1,
  "source": "...",
  "pages": [
    {
      "file": "atlas-0.png",
      "width": 2048,
      "height": 2048
    }
  ],
  "sprites": [
    {
      "id": "character/frame_0001",
      "page": 0,
      "rect": {
        "x": 12,
        "y": 24,
        "width": 64,
        "height": 64
      },
      "sourceRect": {
        "x": 32,
        "y": 16,
        "width": 64,
        "height": 64
      },
      "trimmedRect": {
        "x": 32,
        "y": 16,
        "width": 64,
        "height": 64
      },
      "pivot": {
        "x": 0.5,
        "y": 1
      }
    }
  ]
}

字段语义（修正案 A3）：

rect = sprite 的 packed cell 在 page 上的位置（PAGE SPACE）

sourceRect = 检测矩形，源图中的位置（SOURCE SPACE）

trimmedRect = trim 后内容边界，源图中的位置（SOURCE SPACE）

pivot = 归一化坐标，相对 trimmed rect（CONTENT SPACE）

实际字段可调整，
但必须：

- deterministic
- documented
- versioned

========================================
十四、命名与稳定 ID
========================================

必须为每个 sprite 创建稳定 ID。

不要使用：

random UUID
timestamp
memory address

建议：

normalized source relative path
+
detection index

例如：

assets/player_sheet.png#sprite-0001

批处理时同样稳定。

输出 filename 必须 sanitize。

Windows 文件名非法字符：

\ / : * ? " < > |

必须得到安全文件名。

========================================
十五、Batch Processing
========================================

CLI 支持：

single file

以及：

directory

例如：

gameassetforge process assets/player.png --preset default.json

以及：

gameassetforge batch assets/ --preset default.json --output out/

支持：

--recursive
--include
--exclude

默认：

只处理 PNG。

批处理：

一个失败文件不能让所有文件立即崩溃。

最终输出：

summary.json

至少包含：

total
succeeded
failed
duration
outputs

错误必须包含：

source
stage
message

例如：

{
  "source": "foo.png",
  "stage": "detect",
  "error": "No foreground pixels found"
}

========================================
十六、CLI
========================================

CLI 命令建议：

gameassetforge init
gameassetforge inspect <file>
gameassetforge validate <preset>
gameassetforge process <file>
gameassetforge batch <directory>

--------------------------------------------------
init
--------------------------------------------------

生成：

preset.json

带：

schemaVersion = 1

并写入完整默认值。

--------------------------------------------------
inspect
--------------------------------------------------

不执行输出。

只分析输入：

- format
- dimensions
- alpha presence
- detected sprite count
- rectangles
- estimated output

--------------------------------------------------
validate
--------------------------------------------------

验证：

- JSON syntax
- schema
- enum
- numeric range
- incompatible options

不执行图片处理。

--------------------------------------------------
process
--------------------------------------------------

单文件完整 Pipeline。

--------------------------------------------------
batch
--------------------------------------------------

文件夹完整 Pipeline。

CLI stdout：

简洁。

详细错误进 stderr / log。

适当返回 exit code：

0 = success
1 = processing failure
2 = invalid input / invalid preset / usage error

========================================
十七、Core API
========================================

设计清晰的公共 API。

建议：

detectSprites()
trimSprite()
resizeSprite()
applyBleed()
calculatePivot()
packAtlas()
buildManifest()
runPipeline()

实际落地名（修正案 A5）：

trimSprite → trimRaster（返回 contentRect）

resizeSprite → resizeRaster

margin 组合 → applyBleed + applyPadding + composeCellRaster

装配入口 → buildSprites(image, pipeline, { sourcePath })

核心 Pipeline：

runPipeline(image, pipeline)

必须是纯逻辑。

不要：

runPipeline(filePath)

因为 filesystem 不属于 core。

应该：

filesystem
→ decode PNG
→ RasterImage
→ Core
→ result
→ filesystem

========================================
十八、GUI V1
========================================

GUI 不需要做完整 Photoshop。

目标：

“可视化 Pipeline 控制器”。

布局：

LEFT:
Assets

CENTER:
Canvas / Preview

RIGHT:
Properties

BOTTOM:
Log / Output

--------------------------------------------------
Assets panel
--------------------------------------------------

显示：

file
status
sprite count
errors

支持：

drag & drop

--------------------------------------------------
Canvas
--------------------------------------------------

PixiJS。

支持：

- zoom
- pan
- fit
- reset
- rectangle overlays
- selected sprite
- pivot marker

检测出的 sprite rect：

显示可视化边框。

点击 sprite：

右侧显示：

x
y
width
height
pivot
status

--------------------------------------------------
Properties
--------------------------------------------------

编辑：

Detection
Trim
Resize
Padding
Bleed
Pivot
Atlas

每次改变参数：

可以重新运行 preview。

但不要每次鼠标移动都重新处理全部资产。

可以 debounce。

--------------------------------------------------
Manual fallback
--------------------------------------------------

提供：

Create Rectangle

用户在 Canvas 上：

drag rectangle

生成一个 manual sprite。

必须支持：

select
move
resize
delete

V1 不需要：

freehand lasso
polygon selection
mask painting

--------------------------------------------------
Preset
--------------------------------------------------

GUI 支持：

New Preset
Open Preset
Save Preset
Save As

保存必须经过：

schema validation

GUI 不直接生成非法 preset。

========================================
十九、Preview
========================================

Preview 至少支持：

source image
detected sprites
trimmed sprite
atlas result

提供：

Before
After

切换。

如果有 atlas 多页：

支持 page switching。

========================================
二十、Godot Export
========================================

Godot 是 V1 主打导出目标。

必须优先支持：

atlas PNG
+
metadata JSON

然后做：

optional Godot resource generation

目标：

用户可以将生成结果用于 Godot 4.x 的 2D sprite workflow。

如果能够可靠生成：

SpriteFrames .tres

则实现。

但不要为了实现 .tres 而让 Core 依赖 Godot。

Godot exporter 必须是：

packages/cli/src/exporters/godot/

或者：

packages/core/src/export/

两者选一个合理的分层方案。

推荐：

Core 输出 generic ExportManifest

CLI/exporter 把 manifest 转成：

Godot resources

这样 Core 不知道 Godot。

必须提供一个明确的 Godot smoke-test sample：

例如：

samples/godot-smoke/

里面包含：

AnimatedSprite2D
SpriteFrames
generated atlas

目标：

在 Godot 中可以播放一个简单动画。

如果当前开发环境安装了 Godot：

实际打开并验证。

如果没有：

不要伪造“Godot 已验证”。

最终报告标记：

VERIFIED
或
BLOCKED BY MISSING GODOT RUNTIME

========================================
二十一、Unity Export
========================================

Unity V1 不生成：

.meta

也不尝试伪造 Unity 内部 metadata。

输出：

atlas PNG
metadata JSON
optional Unity Editor importer script

Importer script：

读取 JSON。

调用 Unity Editor API：

- TextureImporter
- Sprite import settings
- pivot
- rect / sprite data

要求：

脚本只是生成的 importer。

不要让 core 知道 Unity API。

如果环境没有 Unity：

不伪造 Unity runtime validation。

报告：

export generated
runtime validation unavailable

========================================
二十二、Preset migration
========================================

准备未来：

schemaVersion 2
schemaVersion 3

至少实现：

validatePreset()
migratePreset()

当前：

v1 → v1

只需建立 migration architecture。

不要实现不存在的 v2。

必须测试：

- current schema loads
- unsupported future schema rejected
- malformed schema rejected

========================================
二十三、测试策略
========================================

测试必须分三层。

--------------------------------------------------
A. Core Unit Tests
--------------------------------------------------

测试：

Rect
Point
Pivot
Trim
Detection
Resize
Bleed
Packing
Manifest
Pipeline

所有 core tests：

纯内存
无 filesystem
无 Electron
无 network

--------------------------------------------------
B. Integration Tests
--------------------------------------------------

测试：

PNG decode
→ Core
→ PNG export

Preset
→ Pipeline
→ output

CLI command
→ output directory

Batch processing

--------------------------------------------------
C. Golden / Snapshot Tests
--------------------------------------------------

必须采用确定性 fixture。

至少建立：

fixture 1:
简单 alpha sprites

fixture 2:
不规则 sprite sheet

fixture 3:
带透明边缘与小噪点

fixture 4:
多页 atlas

fixture 5:
resize

fixture 6:
bleed

fixture 7:
manual rectangles

golden data：

- detected rectangles
- trimmed rectangles
- pivots
- atlas placements
- manifest

优先比较结构化 JSON / pixel data。

不要依赖 PNG compressed bytes。

========================================
二十四、真实世界样本
========================================

必须准备至少 3 个真实世界的“乱 Sprite Sheet / 游戏资源样本”。

优先来源：

OpenGameArt
itch.io

原则：

必须确认许可证允许当前用途。

如果资源许可证不允许将原图提交 Git：

则：

- 存放于本地 fixtures 目录
- 不提交 Git
- 在 samples/README.md 记录来源 URL、作者、许可证
- 用环境变量指定 real fixture directory
- 本地执行 real-world snapshot tests
- GitHub CI 使用可公开的 synthetic fixtures

绝对不要：

下载一个不明许可证资源后直接提交仓库。

真实样本应该至少覆盖：

- 不规则透明边界
- 不同 sprite 大小
- 非整齐排列
- 噪点/小透明元素
- 真实游戏风格 sprite sheet

如果当前环境无法取得真实样本：

不要伪造。

明确报告：

REAL_FIXTURES_BLOCKED

========================================
二十五、测试验收的核心目标
========================================

必须证明：

真实 PNG
↓
detect
↓
trim
↓
resize
↓
bleed
↓
atlas
↓
manifest
↓
export

整个过程可重复。

同一个输入 + 同一个 preset：

必须：

完全一致的 sprite count
完全一致 rect
完全一致 pivot
完全一致 atlas placement
完全一致 manifest

========================================
二十六、GUI / CLI 共用契约
========================================

这是架构的关键。

必须保证：

CLI：

preset.json
↓
Core
↓
manifest

GUI：

preset.json
↓
Core
↓
manifest

两条路径必须产生一致结果。

建立一个 integration test：

CLI preset
vs
Core direct invocation

输出 manifest 必须一致。

GUI 不必在自动化测试中截图验证，
但它必须调用同一个 pipeline schema。

========================================
二十七、No hidden state
========================================

禁止 GUI 自己偷偷保存：

- undocumented settings
- hidden defaults
- local-only processing flags

所有 pipeline 参数：

必须存在于：

Preset

或者：

明确的 UI-only preference

UI-only preference 不得影响 core output，
除非转成 preset。

========================================
二十八、错误处理
========================================

所有错误必须带：

stage
message
optional source

阶段：

input
decode
preset
detect
trim
resize
bleed
pack
export

GUI 显示用户友好错误。

CLI 显示简洁错误。

Core 抛出 typed errors。

至少考虑：

InvalidImageError
UnsupportedFormatError
InvalidRectError
InvalidPresetError
NoSpritesFoundError
AtlasPackingError
ExportError

不要创建几十种异常。

========================================
二十九、日志
========================================

CLI：

INFO
WARN
ERROR

GUI：

底部 log panel。

不要把大量 debug 输出直接塞 GUI。

支持：

--verbose

详细日志。

禁止输出：

任何用户敏感信息
绝对本地路径到 README / snapshot
secret

========================================
三十、安全
========================================

完成后必须执行：

git status
git diff
git check-ignore

扫描：

API keys
tokens
passwords
private keys
personal paths
environment secrets

确保：

node_modules/
dist/
temp/
output/
local fixtures
private assets

按照实际需要进入 .gitignore。

不要提交：

.env
秘密文件
未授权的商业素材

========================================
三十一、代码质量
========================================

使用：

TypeScript strict mode

必须：

- noImplicitAny
- strictNullChecks
- noUnusedLocals
- noUnusedParameters

核心代码避免：

- any
- as any
- @ts-ignore

除非有明确且经过注释的第三方类型边界。

配置：

ESLint
Prettier
TypeScript

不要加入几十个 lint 插件。

========================================
三十二、依赖选择
========================================

依赖原则：

“每一个依赖都必须解决一个真实问题。”

建议：

GUI:
- Electron
- PixiJS

CLI:
- 一个可靠 PNG codec
- 一个可靠 CLI parser

Phase 0 已定：

PNG codec = pngjs

CLI parser = commander

测试 = vitest

lint = eslint 9 + typescript-eslint + prettier

Core 运行时依赖 = 零

Core:
尽可能零运行时依赖。

如果一个算法可以自己写成 100 行清晰 TypeScript：
可以自己实现。

如果一个标准图像编解码器明显应该依赖成熟库：
使用成熟库。

禁止：

AI SDK
cloud SDK
analytics SDK
large UI framework
ORM
database server
backend framework

========================================
三十三、Repository scripts
========================================

最终 root package.json 至少提供：

npm run build
npm run test
npm run lint
npm run typecheck

开发：

npm run dev:gui

CLI：

npm run cli -- ...

具体实现根据 monorepo 工具调整。

不要为了 workspace 引入 Nx / Turborepo，
除非项目实际需要。

========================================
三十四、CI
========================================

增加：

.github/workflows/ci.yml

至少：

- install
- typecheck
- lint
- test
- build

Node 版本使用当前项目选择的受支持 LTS，
不要随机混用多个版本。

CI 不要求：

- Godot
- Unity
- external assets
- AI model
- internet API

核心 CI 必须完全可重复。

========================================
三十五、README
========================================

README 必须把它写成真实开源软件。

结构：

# GameAsset Forge

One-line description

## Why

## Features

## V1 Scope

## Architecture

## Installation

## CLI

## GUI

## Presets

## Image Detection

## Atlas Packing

## Pivot

## Godot Export

## Unity Export

## Testing

## Real-world Fixtures

## Limitations

## Roadmap

## License

不要使用：

production-ready
enterprise-grade
AI-powered

除非未来真的实现。

明确写：

V1 does not use AI.

========================================
三十六、文档必须解释“为什么不用 AI”
========================================

README 增加一小节：

## AI Independence

明确：

Core asset processing is deterministic and offline.

AI is not required for:

- sprite detection
- trimming
- atlas packing
- pivot calculation
- resize
- export

Future AI-assisted features may be added later,
but they are not part of V1.

========================================
三十七、V1 Definition of Done
========================================

这个项目只有满足以下条件才能宣布 V1 complete。

必须同时满足：

[1]
能够导入真实 PNG sprite sheet。

[2]
能够自动检测 sprites。

[3]
能够处理不规则 sprite sheet。

[4]
检测失败可以手动框选作为 fallback。

[5]
能够 Trim。

[6]
能够 Resize。

[7]
能够 Padding / Bleed。

[8]
能够计算 Pivot。

[9]
能够生成 deterministic atlas。

[10]
atlas 超限能够自动多页输出。

[11]
能够输出 manifest JSON。

[12]
能够通过 CLI：
input folder + preset
→ 一条命令完成处理。

[13]
GUI 能载入同一个 preset。

[14]
GUI 和 CLI 的结果一致。

[15]
至少 3 个真实世界样本经过验证。

[16]
至少一个 Godot smoke-test 可以证明输出能够进入 Godot 工作流。

[17]
如果生成 Unity importer：
必须通过静态验证；
如果没有 Unity 环境，不得伪造 runtime 验证。

[18]
Core unit tests 全部通过。

[19]
Integration tests 全部通过。

[20]
Golden tests 全部通过。

[21]
lint 全部通过。

[22]
typecheck 全部通过。

[23]
build 全部通过。

[24]
README 完整。

[25]
git 安全扫描通过。

达到 [25]：

V1 DONE。

没有达到：

不要自行宣布完成。

========================================
三十八、V1 明确不因“看起来不够高级”而延期
========================================

如果已经满足：

sprite sheet
→ split
→ trim
→ resize
→ bleed
→ atlas
→ pivot
→ export
→ CLI
→ GUI preview
→ tests

就停止。

不要因为：

“以后可以加 AI”
“以后可以加 Spine”
“以后可以自动 rig”
“以后可以做角色动画”

而继续扩 V1。

这些进入 backlog。

========================================
三十九、实施顺序
========================================

严格按以下顺序开发。

----------------------------------------
Phase 0 — Environment / Architecture Audit
----------------------------------------

先不写业务代码。

检查：

- Node
- npm
- TypeScript
- available image tooling
- Electron compatibility
- Git
- environment

然后输出：

A. 环境
B. 技术选型
C. monorepo structure
D. dependency list
E. risk list

----------------------------------------
Phase 1 — Core Skeleton
----------------------------------------

创建：

packages/core

定义：

types
interfaces
Pipeline
Preset
schemaVersion
errors

先完成：

npm install
typecheck

----------------------------------------
Phase 2 — Core Image Operations
----------------------------------------

依次实现：

RasterImage
Detection
Trim
Resize
Bleed
Pivot

每个模块：

implementation
unit tests
documentation

----------------------------------------
Phase 3 — Atlas
----------------------------------------

实现：

MaxRects
multi-page
deterministic placement
manifest

完成后必须建立：

golden tests

----------------------------------------
Phase 4 — CLI
----------------------------------------

完成：

init
inspect
validate
process
batch

然后使用 synthetic fixtures 实际运行。

----------------------------------------
Phase 5 — Real Fixture Validation
----------------------------------------

导入至少 3 个真实世界 fixture。

如果合法：

进入 repo。

如果不能：

local-only。

执行真实 pipeline。

记录结果。

----------------------------------------
Phase 6 — Exporters
----------------------------------------

先：

Generic JSON

然后：

Godot

然后：

Unity importer

不要同时开发两套复杂 exporter。

----------------------------------------
Phase 7 — GUI Shell
----------------------------------------

先创建：

Electron

再：

PixiJS canvas

再：

Assets panel

再：

Properties

再：

Preview

再：

Preset

再：

Manual rectangle

不要一开始做全部 UI。

----------------------------------------
Phase 8 — GUI / Core Integration
----------------------------------------

确保：

GUI
→ Preset
→ Core
→ Output

运行结果与 CLI 一致。

----------------------------------------
Phase 9 — CI / Documentation
----------------------------------------

完成：

CI
README
architecture docs
CLI docs
preset schema docs
limitations

----------------------------------------
Phase 10 — Final Audit
----------------------------------------

执行完整：

test
lint
typecheck
build
CLI smoke test
GUI smoke test
security scan
git diff audit

========================================
四十、阶段执行纪律
========================================

每个 Phase 完成后必须输出：

## Phase X Report

### Changed
修改了什么

### Tests
实际执行了什么

### Result
PASS / PARTIAL / BLOCKED

### Regression
有没有破坏前面功能

### Scope
有没有越界

### Next
下一阶段是什么

如果发现问题：

FACT
↓
ROOT CAUSE
↓
MINIMAL FIX
↓
TEST

不要直接大重构。

========================================
四十一、最终报告
========================================

最终必须输出：

# GameAsset Forge V1 Final Audit

## A. Environment

## B. Architecture

## C. Packages

## D. Core Pipeline

## E. CLI

## F. GUI

## G. Preset Schema

## H. Detection

## I. Atlas

## J. Exporters

## K. Tests

## L. Real-world Fixture Results

## M. Godot Verification

## N. Unity Verification

## O. CI

## P. Security

## Q. Limitations

## R. Backlog

## S. V1 Definition of Done

每一项使用：

FACT
STATUS
EVIDENCE

状态只允许：

CONFIRMED
PARTIAL
BLOCKED
NOT IMPLEMENTED

不要给项目打分。

不要说：

“看起来没问题”。

必须给实际证据。

========================================
四十二、最终项目的用户体验
========================================

最终用户应该能够这样使用：

Scenario A — GUI

1. Open GameAsset Forge
2. Drop sprite sheet
3. Preview detected sprites
4. Adjust detection
5. Adjust trim / resize / padding / bleed
6. Set pivot
7. Preview atlas
8. Save preset
9. Export
10. Open output in Godot

Scenario B — CLI

gameassetforge batch assets/ \
  --preset presets/default.json \
  --output out/

得到：

out/
├── atlas-0.png
├── atlas-1.png
├── atlas.json
└── summary.json

Scenario C — Repeatability

以后新增：

assets/new_sprites.png

继续：

gameassetforge batch assets/ \
  --preset presets/default.json \
  --output out/

不需要重新手工操作。

这就是产品价值。

========================================
四十三、最终产品定位
========================================

完成 V1 后：

GameAsset Forge 不是：

AI art generator

不是：

character rigging editor

不是：

Spine clone

不是：

Photoshop clone

它是：

“a local-first, deterministic 2D game asset preparation pipeline.”

核心卖点：

- offline
- deterministic
- batchable
- preset-driven
- CLI + GUI
- engine-oriented export
- reproducible output

这才是 V1。

========================================
四十四、重要的架构底线
========================================

最终必须成立：

                    GUI
                     │
                     ↓
                  Preset
                     │
                     ↓
                  CORE
                     ↑
                     │
                    CLI

而不能成立：

GUI
 ↓
GUI-specific logic
 ↓
filesystem
 ↓
special processing

也不能：

CLI logic ≠ GUI logic

必须做到：

same preset
+
same input
=
same core output

========================================
四十五、现在立即开始
========================================

现在先执行：

Phase 0 — Environment / Architecture Audit

不要等待用户确认。

完成 Phase 0 后，
直接进入 Phase 1。

不要一次性写完所有功能。

每个 Phase：

实现
→ 测试
→ 验证
→ 报告

然后继续下一阶段。

最终如果所有 V1 Definition of Done 条件满足：

宣布：

V1 COMPLETE

否则：

明确：

PARTIAL / BLOCKED

不要伪造成功。