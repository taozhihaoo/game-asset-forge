# V3 Phase 0 — Code Audit (AI Assisted Asset Understanding)

Date: 2026-10-02 · Read-only audit per the V3 guidance doc (amendments C1–C9); no code modified.

## A. 当前版本架构

npm workspaces, TypeScript strict, ESM:

```
packages/core  (zero runtime deps; pure pipeline + quality analyzer)
packages/cli   (pngjs + commander; exporters godot/unity + reporting/html)
packages/gui   (Electron 38 + PixiJS 8; main.mts ESM / preload CJS /
               renderer bundled by esbuild)
```

V1: process pipeline (done, final audit 25/25). V2: quality assistant (done,
12/12 DoD, released). 167 tests green across 15 files.

## B. Core API（本阶段消费者视角）

- `parsePreset / serializePreset / DEFAULT_PIPELINE`（schemaVersion 2, quality 节）
- `runPipeline(image, pipeline, {sourcePath})`
- `analyze(assets: AssetFile[], config: QualityConfig)` → QualityReport
- `rasterHash64(raster)` — 64-bit FNV（quality 规则已导出，AI 缓存键直接复用）
- typed errors: ForgeError hierarchy（stage 无 'ai'——AI 错误类型放 packages/ai）

## C. Asset 数据模型

- `RasterImage`（RGBA8 + hasAlpha，来自 IHDR）— AI 层的图像输入
- `AssetFile {name, raster, byteSize?, pivot?}` — V2 质量分析输入
- `Sprite / SpriteSet / Atlas / ExportManifest` — 引擎导出数据
- **无任何 AI 相关类型** —— V3 新类型全部放 packages/ai（C2：core 零改动可选）

## D. Pipeline 生命周期

bytes → decode → parsePreset(v2) → runPipeline → pages/manifest → encode。
不变量："同 preset 同输出"（有专门一致性测试）。**AI 结果是旁路工件**
（ai_report/classification/asset_metadata），永不进入该生命周期（C3）。

## E. Quality Analyzer 插入点（AI 建议的升级基座）

- V2 naming/grouping 解析（parseAssetName）→ AI naming 建议的格式基座
- V2 pivot_check（characterPatterns + bottom-center 基准）→ AI pivot 建议
  升级为"建议任意锚点 + 置信度"
- 质量报告与 AI 报告并存：quality_report.json / ai_report.json 各自独立

## F. Export 系统

generic manifest → godot (.tres) / unity (.cs importer) / html (reporting)，
全部在 CLI 层消费纯数据。V3 的三份 AI 工件（ai_report/classification/
asset_metadata）按同一模式由 CLI 写出；core 不参与。

## G. 测试覆盖

167 tests / 15 files：core 单测（preset v2、quality 五规则、golden 7+1、
pipeline、atlas）、CLI 集成（spawn 真进程 + 退出码）、一致性、真实样本
（5 CC0，缺目录自动跳过）、GUI state 单测、GUI e2e（playwright 驱动）。
V3 要求新增 ≥50 条——**全部基于 mock provider，CI 零网络**。

## H. AI 插件最佳位置

**独立包 `packages/ai`**（修订记录 C2 硬性要求）：

- 只依赖 `@gameasset-forge/core` 的公开类型（RasterImage 等）——不进 core
  （core 零网络是章程 §1.12 + lint 硬规则，原稿把 openai.ts 放 core 已被否）
- 结构：providers/（mock + openai(fetch 可注入) + local 预留）、schemas/
  （响应 JSON 校验，手写零依赖、与 core preset 校验器同风格）、prompts.ts
  （版本化模板；**以 TS 常量而非 .md 文件承载**——renderer/CLI 双端复用，
  读文件会破坏浏览器兼容；promptVersion 常量随模板发布）、understand()、
  cache（键 = 图像 hash + promptVersion + provider + model；存储接口 +
  内存实现，文件存储在 CLI 层）、errors、suggestions（确定性派生）
- 消费者：CLI（`gameassetforge ai analyze`，ai.config.json + 环境变量，
  默认关闭）、GUI（第三 Tab，仅 mock + 隐私告知）
- 依赖方向：ai → core types；core/cli-core/gui 均不知 AI 存在，除非显式
  import ai 包

## 结论

前置满足（V2 发布、Godot [16] 已补验）。审计通过——进入 Phase 3.1。
