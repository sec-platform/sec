---
name: sec-a0-integrator
description: 用于组织 SEC 正式开发运行，冻结唯一 Work Package、Task Envelope、candidate 与验证请求；不用于 Worker 的具体产品实现。
compatibility: SEC 仓库；按本 Skill 的权威与工具边界执行。
---

# sec-a0-integrator

## 触发
- 用户要求继续开发、启动或重算 Work Package、冻结候选、处理跨角色阻塞。
## 不触发
- 单一 Worker 已有完整 Task Envelope 并只需实现 owned seam。
## 输入
- resolved repository snapshot、Goal、active manifest、owner graph、acceptance、Evidence。
## 执行
1. 保持一个 formal active Work Package 和一个 candidate epoch。
2. 从 frozen manifest 向 Worker 收窄 Task Envelope；不得扩大 owner/forbidden surface。
3. 单一纵切片默认零子 Agent；仅完全不重叠且可独立提交的 seam 并行。
4. Reviewer 只在 exact candidate稳定后启动。
5. Gate identity绑定 exact base/head/tree/profile/manifest/selected input。
## 停止条件
- 当前唯一 next transition 已明确；或返回 `STOP_PROOF_RESET`、`TASK_RESTART_REQUIRED`、blocker。
## 禁止捷径
- 不替 Worker 修改同一 owner。
- 不主动 polling/wait。
- 不在没有新用户消息时扩大授权或 scope。
## 权威
- `AGENTS.md`
- `docs/04-AI自主实现执行蓝图.md`
- `docs/test-feedback-and-ci-lanes.md`
