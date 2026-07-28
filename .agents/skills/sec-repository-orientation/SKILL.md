---
name: sec-repository-orientation
description: 用于开始任何 SEC 仓库任务、恢复中断任务或用户要求全面审计时，建立 latest main、PR/Issue、CI/Review、active Work Package、authority 与真实 diff 的最小充分事实；不用于直接修改产品代码。
compatibility: SEC 仓库；按本 Skill 的权威、权限和验证边界执行。
---

# sec-repository-orientation

## 触发
- 新任务、继续开发、恢复中断或压缩后重新进入仓库。
- `main`、PR、Issue、CI、Review、Goal 或 active pointer 可能变化。

## 不触发
- 已有有效 Capsule 且没有 `reload_if`、用户修正或事实漂移。
- 仅解释稳定产品概念，不需要当前仓库事实。

## 输入
- latest default branch、intended workspace branch/HEAD/tree/diff target、resolver executable trust-root、open PR/Issue、Review、CI、active pointer。

## 权限与路径
- 只读仓库/GitHub事实、canonical docs和当前任务相关代码；不写产品路径。

## 允许工具与操作
- document-control-plane status、Git/GitHub read、精确文件/符号读取、必要impact索引。

## 前置门禁
- repository identity、remote/default branch和用户任务已知。
- resolver executable closure已绑定受信latest default/base；intended workspace仍是需要解析的candidate、index和dirty diff target/evidence。

## 执行
1. 先用Git-only preflight解析live default SHA并证明resolver executable closure受信；当前checkout的resolver stale时，从trusted default/base入口执行，但保持intended workspace作为resolver cwd或显式target，禁止执行旧resolver或把clean default workspace替换成candidate解析目标；当前launcher不能分离code authority与target workspace时fail closed。
2. 使用步骤1选定的trusted resolver entry对intended workspace运行一次；只有当前closure已证明受信时才使用canonical相对命令`bun scripts/codex/document-control-plane.ts status --json`。
3. 核对 live default ref、本地 ref、pointer、manifest、workspace 和 GitHub facts 全部 resolved。
4. 只读取当前任务相关 authority、types、tests 和 source；禁止默认全仓扫描。
5. 记录哪些事实可复用、哪些事件触发 `reload_if`。

## 完成证据
- resolved snapshot、authority refs、exact Git/GitHub identities、reload_if列表。

## 停止与恢复
- 形成一个可引用的事实快照，或任何输入 unresolved/invalid 时 fail closed。
- 命中reload_if后废弃旧snapshot并重新定向；不轮询。

## 禁止捷径
- 不把聊天、PR body、旧计划、代码图或历史分支当作当前事实。
- 不重复轮询不变远程状态。

## 权威
- `AGENTS.md`
- `docs/04-AI自主实现执行蓝图.md`
- `docs/work/current-state.yaml`
