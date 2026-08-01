---
name: sec-orient-work
description: 在开始、继续、恢复或重新绑定任何 SEC 工作时，解析 latest main、目标对象、权限、外部事实和唯一下一 operation；不执行产品修改、全仓审计或失败根因分析。
compatibility: SEC Agent Skill System v2 proposal
metadata:
  sec-schema: sec-agent-skill-v2
  sec-version: '2'
  sec-operation: orient,resume
  sec-risk: read-only
---

# sec-orient-work

## 目标

把自然语言目标和当前外部事实转换为一个 resolved `SecAgentOperationEnvelopeV2` 或明确的 `blocked/unresolved/no-change`。本 Skill 是所有新工作与恢复工作的唯一事实入口；resume 只是输入模式，不建立第二 snapshot 或 phase owner。

## 触发

- 新任务、用户说“继续”、切换仓库/分支/worktree/session。
- main、PR、Issue、Review、CI、active pointer、manifest、authority 或用户目标可能变化。
- 上一 operation 返回 `restart-required`、`reconcile-required` 或外部 checkpoint 需要重新验证。

## 不触发

- 已有未失效的 operation envelope，且没有任何 `reloadIf` 事件。
- 用户明确要求 exact revision 全仓审计：转 `sec-audit-repository`。
- 已有可重复 failure observation 且目标是找根因：转 `sec-diagnose-failure`。

## 必需输入

- repository identity 与用户目标；
- intended target（repository、Issue、Work Package、PR、candidate 或 failure）；
- resume 模式下的外部 checkpoint/run reference；
- Role identity；
- repository snapshot resolver、authority registry 和 live GitHub read capability。

缺少 repository、target 或 Role 时返回 `unresolved`，不得自行猜测另一个仓库、分支或身份。

## 权限边界

- trust class 固定为 `read-only`。
- 可读取 Git/GitHub、canonical authority、控制面、manifest、diff metadata 和 Evidence references。
- 不创建 branch/PR/Issue，不修改文件，不触发 Gate，不清理 worktree。
- Skill 只声明事实需求；最终读取能力由 Role ∩ Envelope ∩ repository policy 授权。

## 执行

1. 通过 trusted snapshot resolver绑定 repository、latest default SHA、target base/head/tree、worktree/index/dirty state和live GitHub identity。
2. 读取 `docs/authority.json` 和与目标直接相关的唯一 domain owner；不得默认扫描全部 source/docs。
3. 解析 active pointer、manifest、开放 PR/Issue、Review/Checks和当前 lifecycle。无法证明 freshness 时保持 `unresolved`。
4. resume 模式重新计算所有外部绑定；旧聊天摘要、未提交进度和模型自述不作为恢复输入。
5. 调用 work selector/transition validator，得到唯一 next operation；Skill 不自行排序全部 backlog或维护 rolling policy。
6. 构造 operation envelope：Role、Primary Skill、read/write grants、trust class、typed inputs、expected outputs、stop/reload条件。
7. 若当前目标已被 main 包含、候选已 superseded 或无需动作，返回 `no-change` 并附 main readback witness。

## 输出合同

```yaml
outcome: completed | blocked | unresolved | no-change
resolvedContext:
  exactMain:
  target:
  authorityRefs: []
  liveFactsDigest:
nextOperation:
  operation:
  primarySkill:
  role:
  trustClass:
  envelopeRef:
reloadIf: []
blockingFacts: []
```

只有 resolver/validator 证明的字段可进入输出；自由文本不能覆盖 `nextOperation`。

## 失败与转移

- default/target/manifest/authority 不可解析 → `unresolved`。
- 发现广泛未知或权威漂移 → `audit-repository`。
- 发现具体 failure observation → `diagnose-failure`。
- 发现设计/owner冲突 → `design-change`。
- candidate满足 Review/Integration 前置 → 对应 operation。
- trust epoch已改变 → `restart-required`，由新的 orient operation重新绑定。

## 示例

用户说“继续开发”，live facts 显示当前唯一 PR 已合并但 manifest尚未归档：输出 `integrate-change` 的 closeout envelope，而不是创建新 branch。

用户在新 session 说“继续 #217”，若 main、PR head和Review已变化，resume 模式废弃旧 checkpoint，按新事实重新选择 operation。

## 资源

- `../../registry.yaml`
- `../../README.md`
- current authority: `AGENTS.md`、`docs/authority.json`、`docs/development-governance.md`
- future service: repository snapshot resolver、work selector

## 禁止

- 不从聊天猜当前 phase、完成状态或权限。
- 不把 PR body、Issue、branch名或 ahead/behind 当成 main readback。
- 不为“更全面”默认全仓扫描。
- 不在一个输出中选择多个 Primary Skill。
- 不把未实现 Run Kernel 的目标状态伪装成当前可恢复事实。
