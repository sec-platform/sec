---
name: sec-context-resume
description: 用于 Codex 自动/手动压缩、进程退出、会话迁移或 worktree切换后，以 V19 可验证确定性续跑恢复同一合法下一步；不声称恢复模型隐藏思维。
compatibility: SEC 仓库；按本 Skill 的权威、权限和验证边界执行。
---

# sec-context-resume

## 触发
- `/compact`、自动压缩、resume、进程重启、新session、worktree切换。

## 不触发
- 同一有效session且没有状态事件、prompt或repository漂移。

## 输入
- stable runId、session/worktree binding、prompt intake、capsule generation、repository fingerprint、Evidence、nextTransition。

## 权限与路径
- 只读/写未来Kernel管理的git-common-dir运行态；不以聊天摘要写工程事实。

## 允许工具与操作
- run status/resume、capsule/event验证、repository fingerprint、Hook dispatcher。

## 前置门禁
- stable runId与repository identity存在；Kernel未落地时仅manual-shadow。

## 执行
1. 目标是 validated deterministic resume，不是“隐藏状态无损”。
2. 状态根位于 Git common dir；runId独立于sessionId和worktree。
3. 每个状态事件提交不可变capsule/event；PreCompact只增加recoveryRequired。
4. resume重算HEAD/tree/index/worktree、manifest、AGENTS/Skill/Hook/trust digests。
5. 优先处理 integrity、recovery、pending prompt、instruction fence、proof reset、Evidence revalidation，再执行phase transition。
6. Kernel未落地前仅执行manual-shadow恢复并fail closed，不宣称问题已解决。

## 完成证据
- validated bindings、capsule digest、prompt epoch、Evidence identity、唯一nextTransition。

## 停止与恢复
- 新执行者仅依赖外部权威可得出同一个nextTransition；绑定不一致则阻塞。
- integrity/recovery/prompt/instruction/proof锁按优先级处理；不一致fail closed。

## 禁止捷径
- 不从聊天摘要猜phase/授权。
- 不把Hook描述为完整Codex沙箱。

## 权威
- `docs/development-governance.md`
- `docs/proposals/development-run-kernel.md`
