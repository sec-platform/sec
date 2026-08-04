---
name: sec-context-resume
description: 在压缩、重启、会话或 worktree 切换后从外部事实重算合法下一步；不声称恢复隐藏思维。
compatibility: SEC 仓库；仅在 `sec-skill-applicability-decision-v1` 对 trusted Skill blob 返回 `applicable` 时加载。
---

# sec-context-resume

## 触发
- operation=`resume`，且 session/process/worktree 或 instruction binding 已变化。

## 不触发
- 同一有效会话且所有 reload 条件均未变化。

## 输入
- latest main、candidate/worktree、manifest、Review/CI、failure Evidence、用户新指令。

## 权限与路径
- 当前只做 manual-shadow 事实重算；不从聊天摘要授予写权限。

## 允许工具与操作
- repository orientation、binding/digest 校验、next-transition 重算。

## 前置门禁
- trusted revision 和 target workspace 可解析；未来 Kernel 未落地时不得写成自动恢复。

## 执行
- 重读 repository/PR/manifest/dirty state/Skill applicability。
- 优先处理用户修正、instruction fence、integrity、recovery 和 proof reset。
- 只保留外部可验证的 completed Evidence；其余为 unknown。

## 完成证据
- validated bindings、失效项、唯一 next transition 和 reload 条件。

## 停止与恢复
- 新执行者能从同一外部状态得到同一结论；不一致则 fail closed。

## 禁止捷径
- 不从聊天猜 phase，不让旧 Skill decision 跨 Goal/base/operation 继续有效。

## 权威
- `docs/development-governance.md`
- `docs/work/current-state.yaml`
