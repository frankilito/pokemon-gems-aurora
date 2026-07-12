# ⚠️ 多会话协作声明 (2026-07-12)

本仓库当前有**两个 Claude 会话并行工作**。为避免互相覆盖：

## 会话 B（VRM 主角/场景贴图线）正在处理：
- `js/player/vrmRig.js`、`js/player/characterModel.js`（新增，VRM 动漫高清主角）
- `js/player/player.js`（仅 model 接线 2 行）
- `js/world/terrainDetail.js`（新增）+ `js/world/terrain.js`（splat 注入）
- `js/world/buildingKit.js`（新增）+ `js/world/landmarks.js`（建筑贴图化）
- `index.html`（importmap 增加 three-vrm）
- `assets/models/chars/*.vrm`、`assets/textures/*`、`vendor/three-vrm.module.min.js`

## 请另一会话（RPM/战斗/测试线）继续保留：
- `js/battle/*`、`js/core/*`、`js/main.js`、`js/ui/*`、`js/mon/*`
- `js/player/humanModel.js`（NPC 继续用 RPM 真人，主角切 VRM）
- `assets/models/human/*`、测试体系

## 约定
- 提交前 `git status` 检查对方未提交改动，勿 checkout/revert 非自己的文件
- 小批次提交；发现本文件有更新请先读
- 完成后本文件可删除

分工理由：主角 = VRoid VRM（最高精度+发丝物理+表情，玩家全程视角中心）；
NPC = RPM+Mixamo 剪辑（体积小、有 talk/idle 变奏，适合批量）。互补不冲突。
