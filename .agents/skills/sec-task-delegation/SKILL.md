---
name: sec-task-delegation
description: 当机器已证明多个 seam 权限/路径/资源真正独立后，判断并行收益是否大于协调与上下文成本；不负责 scope 切分、Agent 启动或递归分派。
---

# sec-task-delegation

本 Skill 仅在 trusted applicability 选中后加载；只消费 Operation Read Plan 已准入事实，`effectAuthority=none`。

## 适用边界
- 适用：frozen work 已由 deterministic owner 证明有两个以上权限/write surface/resource/dependency 均独立的候选 seam，但是否值得并行仍需判断；或需要判断独立 Reviewer 的额外成本/收益。
- 不适用：seam 共享 canonical writer/authority/前置结果/external Effect，或 disjointness 尚未由机器证明。

## 已准入输入
- 仅使用 Read Plan 给出的 exact work identity、machine-proven seam/owner/path/resource/dependency facts、bounded outcomes、当前 executor/provider 条件和 independence 要求。
- 不自行读源码重新发明 seam，也不从 prose 重建 Task Capsule。

## 判断职责
1. 比较可并行 wall-clock 收益与上下文复制、协调、集成、复核和失败恢复成本。
2. 优先保持单 writer；只有净收益明确且隔离降低风险时选择 delegate。
3. delegate 时给出最少角色数、每个 bounded outcome 与 integration order，不扩大权限。
4. Reviewer independence 是独立机器约束，不能用“另一个 Agent”自动证明。

## 判断输出
- `delegationJudgement`：`delegate | no-delegation`、seam refs、收益/成本因素、role outcomes、integration order 与反转条件。

## 停止与回退
- 判断可交给 deterministic launcher/capsule owner时停止。
- owner重叠、依赖/provider能力变化使原收益假设失效时重新判断。

## 禁止
- 不同一文件/authority多写者，不递归分派，不为 finding 创建 successor worktree。
- 不通过轮询维持“并行正在进行”的虚假进度。
- 不把 Agent 输出当自动 merge/Review/Gate authority。

## 语义权威（非自动读取）
以下只声明优先级；是否读取仍由当前 Read Plan 决定：
- `docs/development-governance.md`
- 当前 Task Capsule / conflict / resource machine owner
- 当前 Review independence owner（若适用）
