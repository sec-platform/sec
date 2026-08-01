---
name: sec-review-change
description: 对一个已稳定的 exact candidate 做独立、只读、对抗式范围、架构、合同、权限、证据和遗漏审查；不边实现边Review、不修改candidate、不把静态审查替代物理Gate。
compatibility: SEC Agent Skill System v2 proposal
metadata:
  sec-schema: sec-agent-skill-v2
  sec-version: '2'
  sec-operation: review-change
  sec-risk: read-only
---

# sec-review-change

## 目标

判断 exact candidate 是否真实满足其冻结的change design、scope、contracts、migration和completion claims，并产出绑定head/tree的 `SecExactCandidateReviewV2`。Review的价值是攻击最强解释，不是重复作者报告。

## 触发

- operation envelope明确 `review-change`；
- candidate base/head/tree、manifest/design和diff已冻结；
- Reviewer Role与实现写者独立；
- trust-root、public contract、architecture或普通候选需要正式Review。

## 不触发

- HEAD仍在authoring变化；
- 只需运行tests/Gates；
- Reviewer同时拥有candidate写权限；
- 没有真实diff，只存在PR body或计划。

## 必需输入

- exact base/head/tree和完整changed records；
- operation envelope、design/failure diagnosis、manifest、acceptance和Change Closure plan；
- canonical authority、direct/transitive consumers、tests、migration/retirement；
- local/hosted Evidence references及其identity；
- existing Review submissions、threads和REQUEST_CHANGES。

## 权限边界

- trust class固定为 `read-only`。
- 可读exact candidate、base、authority、Evidence和GitHub Review面。
- 只能写Review comment/submission/thread，不修改branch或产品文件。
- 不触发merge、重新dispatch Gate、关闭Issue或resolve自己未验证的thread。

## 执行

1. 证明Review target与operation envelope完全一致；head/base/tree/manifest任一变化立即返回 `stale`。
2. 从真实diff重建change claims，不使用PR body作为事实。核对每个changed path的owner、permission、scope和generated provenance。
3. 对照design/diagnosis检查root cause是否被修复、sibling class是否闭合、旧writer/adapter是否迁移或退役。
4. 使用Change Closure plan攻击遗漏：producer/consumer、state transitions、identity/revision、cache/invalidation、environment、trust、concurrency/cancellation、migration、post-merge。
5. 寻找反向因果、共同原因、顺序依赖、默认/optional误判、unknown→safe、错误success projection、自证路径、弱化assertion、timeout/retry/fallback和临时probe。
6. 核对Verification Evidence只支持其owning claims；未运行、stale、unsupported或cleanup unknown不能被作者文字提升为PASS。
7. 对finding分级并绑定exact path/symbol/invariant/counterexample。P0/P1/P2名称不代替具体影响与可复现机制。
8. 检查无finding结论的覆盖边界，列出Review无法证明的物理、平台或外部事实。
9. 输出 `approve`、`comment`、`request-changes` 或 `blocked` 建议；实际GitHub action仍受Role/Envelope授权。

## 输出合同

```yaml
schema: sec-exact-candidate-review-v2
base:
head:
tree:
reviewerRole:
scopeAssessment:
contractAssessment:
migrationAssessment:
evidenceAssessment:
findings:
  - severity:
    path:
    symbol:
    invariant:
    mechanism:
    counterexample:
    requiredResolution:
unknowns: []
threads: []
reviewDisposition: approve | comment | request-changes | blocked | stale
nextOperation: implement-change | integrate-change | diagnose-failure | orient
outcome: completed | blocked | unresolved
```

## 失败与转移

- head/base/tree变化 → `orient`，旧Review标记stale。
- implementation finding → `implement-change`。
- root architecture/owner失效 → `design-change`，通过integrator重新签发。
- Evidence或Gate自相矛盾 → `diagnose-failure`。
- 无阻塞finding且required evidence独立满足 → `integrate-change`。

## 示例

PR声称“无policy时not-applicable”，但required claim仍无条件包含policy：Review以aggregate counterexample request changes，不接受PR文字。

候选只有格式变化，diff却包含package lock漂移：finding是scope violation，即使tests全绿也不能approve。

## 资源

- `../../registry.yaml`
- `../../README.md`
- exact diff reader、Change Closure、authority registry、Review/thread status
- Verification/Evidence contracts

## 禁止

- 不把作者自评、旧Review、旧head Evidence或PR body当当前通过。
- 不修改candidate来“顺手修好”。
- 不用静态Review替代平台、runtime、browser、fault或release Gate。
- 不要求无关重构来表现严格。
- 不在finding未闭合时建议merge。
