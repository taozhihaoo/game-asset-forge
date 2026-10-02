# V4 Phase 0 — Full Architecture Audit (AI Assisted Transformation)

Date: 2026-10-02 · Read-only; no code modified. 基调（D3）：**V4 = 原型级
cutout/rig 编辑器**，limited deformation ±5–15°，不是 Spine 竞品。

## A. 当前 monorepo 结构

packages/core（pipeline + quality，零依赖）/ cli（pngjs+commander，exporters
godot/unity/html）/ gui（Electron+PixiJS）/ **ai**（providers+schemas+suggestions）
/ schemas / samples / scripts / tests。213 测试全绿（18 文件）。

## B. Core API

pipeline（runPipeline）、quality（analyze）、preset（v2 validate/migrate/
normalize/serialize）、image ops（create/crop/clone rasters）、detect
（alpha-CC/grid/manual）、errors（ForgeError hierarchy）。**V4 新增一律放
core/src/transformation/**，纯函数、零网络。

## C. Asset 数据模型

RasterImage / Mask（新）/ Layer / Bone / Mesh / Weights / ForgeProject
（forgeVersion 1 独立序列，D5）。masks = 源空间单通道，与原图同尺寸；
层带显式 z 序（D10）。

## D. AI Provider 架构

packages/ai：VisionProvider（mock/openai/local）+ understand + 缓存 +
建议派生。V4 追加两个接口（同样 mock-first）：**SegmentationProvider**
（mock = 包装 core detectSprites alpha-CC，真确定性分割；cloud/local 预留）
与 **InpaintingProvider**（Level 3，mock = 明确不可用 → 调用方降级）。

## E. Pipeline 执行流程

不变量（C3/C6）：AI 与 cutout 工件均为旁路；"同 preset 同输出"与
"AI 关闭/失败不影响 pipeline/quality" 继续成立并纳入 V4 测试。

## F. GUI 状态管理

app.ts 单向渲染 + AppStore（pipeline/manualRects/selection/view）；canvas
ResizeObserver 已有零尺寸防护。V4 Editor Mode = 第四个 Tab（Editor），
新增 mask/rig 状态同样归调用方持有，符合 §27 无隐藏状态。

## G. Export 系统

manifest → godot(SpriteFrames)/unity/importer(html) 于 CLI 层。V4 追加
godot-cutout 导出（Skeleton2D/Bone2D/Polygon2D/preview 脚本），文本生成 +
**Godot 4.7.2 无头运行时验证**（4.7.2 便携版已在 temp/godot，冒烟模式与
V1 DoD[16] 相同）。

## H. V4 插入位置

core/transformation/{types,mask,extract,compose,skeleton,mesh,weights,
project}.ts；packages/ai 增 segmentation/inpainting 接口与 mock；
cli/src/exporters/godot-cutout.ts + commands/transform.ts；gui 第四 Tab。

## I. 风险分析 与 Level 2 定夺

1. **Level 2 定夺**：纯 TS patch-match 成本高且难确定性化 → **降级为纯 TS
   "扩散补全"（onion-peel/diffusion fill：反复用已知邻域均值填充空洞边界，
   固定迭代次数，确定性）**。语义仍为"小区域补全"（B5/C 系），实现约
   80 行、可测。patch-match 记入 V5 backlog。
2. **Level 3**：InpaintingProvider 仅接口 + 恒拒 mock（同 local vision 模式），
   调用方必须自动降级 Level 2 并记录。
3. 遮挡语义：重建不变量为验收核心——层合成 ≈ 原图（无 mask 覆盖处像素级
   相等；mask 覆盖处允许补全差）。
4. Mesh：**D9 降级定夺**——原型用"mask 内网格 mesh"（不会填实凹形、确定性），
   约束 Delaunay 记 V5。权重 = 骨骼段距离反比，取最近 2 骨归一化。
5. Godot Skeleton2D 文本场景格式复杂：原型导出 Skeleton2D+Bone2D 链+
   Polygon2D（单骨归属、权重 1）+ 预览脚本（limited deformation 正弦摆动），
   无头运行时验证节点结构与播放；完整动画轨 V5。
6. 工作量：编辑器交互占大头——GUI Editor 按原型级冻结功能清单
   （Propose/Generate/Rig/Preview + Mask 笔刷 + Layers/Inspector + Undo）。

**Result: audit complete — Level 2 已定夺（纯 TS diffusion fill），进入 4.1。**
