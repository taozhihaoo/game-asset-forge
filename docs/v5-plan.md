# V5 Plan — Backlog 兑现（约束 Delaunay / patch-match / AnimationPlayer / 商业化）

Date: 2026-10-02 · V4 停止条款解冻后的第一个迭代。基调不变：**原型级演进，
不是产品级重写**——每一项都是替换 V4 的降级实现，API 兼容优先。

## 范围与顺序

| # | 项 | 替代的 V4 降级 | 选型 |
| --- | --- | --- | --- |
| 5.1 | 约束 Delaunay | grid mesh（不贴轮廓） | 轮廓提取（边界跟踪）→ RDP 简化 → Bowyer-Watson Delaunay + 约束边恢复（翻转法）→ 外部三角形剔除 |
| 5.2 | patch-match 补全 | diffusion fill（模糊） | 经典 PatchMatch（Barnes 2009）：传播 + 搜索，**mulberry32 seeded** 保确定性；diffusion 保留为快速模式 |
| 5.3 | AnimationPlayer 轨道 | sway 预览脚本 | Godot 4 Animation .tres（value 轨道驱动 Bone2D:rotation），idle/breathing 两轨 |
| 5.4 | 商业化决策 | — | 决策文档（选项×利弊×建议），决策权在用户 |

## 确定性策略（延续章程 §12 纪律）

- CDT：点按 (y, x) 稳定排序；Bowyer-Watson 空腔边按插入序；约束恢复翻转按
  最小索引序。禁止 Math.random。
- PatchMatch：mulberry32 seeded PRNG（V4 golden 已有先例）；固定迭代数；
  扫描序固定。
- 输出不变量：同输入双跑逐字节一致，golden 可再生。

## 集成点（API 兼容）

- `gridMeshFromMask` 保留并标注 deprecated，新增 `contourMeshFromMask`
  （CDT 路径）；`ForgeMesh` 结构不变（vertices + triangles）。
- `extractLayer` 新增可选 `completion: 'diffusion' | 'patchmatch'`，
  默认 patchmatch；diffusion 保留（大孔快速回退）。
- Godot cutout 导出新增可选 `animations`（生成 AnimationPlayer + .tres 轨道），
  预览脚本保留为无 AnimationPlayer 时的 fallback。

## 测试目标

CDT 正确性（约束边存在于结果、凹形不填实、空圆性质抽查、确定性双跑）、
patch-match（确定性双跑、孔洞被填充、色彩向邻域收敛）、Animation 导出
（.tres 结构字段级断言 + Godot 无头冒烟）。预估 +45 测试。

## 商业化分析框架（5.4）

选项：A 纯 MIT 开源 / B 开源核心 + 付费 Pro（.forge 云同步、批处理上限等）
/ C 双许可（GPL/商业）/ D 一次性付费独立软件。评估维度：目标用户
（独立开发者/Godot 生态）、竞品（Aseprite $20、Spine $69+、TexturePacker
$40）、维护成本、Spine 授权边界（Esoteric 确认仍是前置）。**产出 = 分析 +
建议；决策权在用户。**
