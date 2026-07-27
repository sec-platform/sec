---
name: sec-repository-orientation
description: 用于开始任何 SEC 仓库任务、恢复中断任务或用户要求全面审计时，建立 latest main、PR/Issue、CI/Review、active Work Package、authority 与真实 diff 的最小充分事实；不用于直接修改产品代码。
compatibility: SEC 仓库；按本 Skill 的权威与工具边界执行。
---

# sec-repository-orientation

## 触发
- 新任务、继续开发、恢复中断或压缩后重新进入仓库。
- `main`、PR、Issue、CI、Review、Goal 或 active pointer 可能变化。
## 不触发
- 已有有效 Capsule 且没有 `reload_if`、用户修正或事实漂移。
- 仅解释稳定产品概念，不需要当前仓库事实。
## 输入
- latest default branch、当前 branch/HEAD/tree、open PR/Issue、Review、CI、active pointer。
## 执行
1. 一次运行 `bun scripts/codex/document-control-plane.ts status --json`。
2. 核对 live default ref、本地 ref、pointer、manifest、workspace 和 GitHub facts 全部 resolved。
3. 只读取当前任务相关 authority、types、tests 和 source；禁止默认全仓扫描。
4. 记录哪些事实可复用、哪些事件触发 `reload_if`。
## 停止条件
- 形成一个可引用的事实快照，或任何输入 unresolved/invalid 时 fail closed。
## 禁止捷径
- 不把聊天、PR body、旧计划、代码图或历史分支当作当前事实。
- 不重复轮询不变远程状态。
## 权威
- `AGENTS.md`
- `docs/04-AI自主实现执行蓝图.md`
- `docs/work/current-state.yaml`
