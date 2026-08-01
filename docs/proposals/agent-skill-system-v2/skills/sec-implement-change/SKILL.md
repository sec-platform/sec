---
name: sec-implement-change
description: 在 exact typed operation envelope 和 frozen scope 内实现一个 SEC 产品能力、修复、重构或已设计治理变化，产生可审查 candidate delta；不选择新任务、扩大 scope、触发 hosted Gate或合并。
compatibility: SEC Agent Skill System v2 proposal
metadata:
  sec-schema: sec-agent-skill-v2
  sec-version: '2'
  sec-operation: implement-change
  sec-risk: branch-write
---

# sec-implement-change

## 目标

把已冻结的设计/缺陷闭包实现为一个范围完整、可验证、可回退的 branch candidate，并输出 `SecImplementationReconciliationV2`。Skill 拥有局部实现策略，不拥有 scope、permission、Impact算法、Verification真值或merge authority。

## 触发

- operation envelope明确 `implement-change`；
- exact base、Role、owned/read/write paths、authority refs、acceptance、tests和trust class均已解析；
- root cause或change design已冻结，且当前 task没有 unresolved owner。

## 不触发

- active facts/target已漂移：先 `sec-orient-work`。
- owner、contract、migration或root assumption仍需设计：转 `sec-design-change`。
- 目标只是Review、Gate、merge或closeout。
- write grant不覆盖所需路径。

## 必需输入

- valid `SecAgentOperationEnvelopeV2`；
- frozen Work Package/Task Capsule/Change Design或Failure Diagnosis reference；
- exact base/head/worktree identity；
- granted read/write sets与capabilities；
- Change Closure plan、Impact plan、acceptance和focused sentinel；
- applicable canonical authority/types/tests。

## 权限边界

- trust class 为 `branch-write` 或显式 `trust-root-write`。
- 只能写 `pathWrites`；permitted/read paths不获得ownership。
- 不写其他Agent worktree、不stash/reset/clean未知状态、不force push。
- 不触发 hosted Gate、不提交Review、不merge、不删除远端branch。
- trust-root write只产生candidate；候选不能用自身规则授权自身。

## 执行

1. 重新验证 envelope、base、dirty state和path grants；任一漂移返回 `reconcile-required`。
2. 只读取当前owner seam、direct consumers、contract tests和Change Closure要求；禁止为安心默认重扫全仓。
3. 先建立/确认最小失败或positive acceptance，避免从实现反向发明oracle。
4. 实现最小完整纵切片：同步producer、consumer、state/error、migration、negative tests和retirement；“最小”不等于只改最后抛错行。
5. 每次写动作由permission evaluator检查；发现必须触及未授权owner立即停止，不在当前branch顺手改。
6. 开发中只运行当前focused sentinel。Impact/selection由machine service生成；unresolved不得被解释为无需测试。
7. candidate稳定后运行一次local closure：imports/typecheck/docs/affected/focused中实际适用项；Skill不复制selector算法。
8. 生成candidate delta，确认无probe、临时日志、意外生成物、scope drift和弱化断言。
9. commit/push时绑定exact base/head/tree；多提交authoring history不等于frozen candidate，是否squash由integration决定。
10. 输出Reconciliation：changed symbols、tests、未执行Gate、Evidence invalidation、blocker和next operation。

## 输出合同

```yaml
schema: sec-implementation-reconciliation-v2
operationId:
base:
head:
tree:
changedRecords: []
changedSymbols: []
contractChanges: []
migrations: []
retirements: []
focusedResults: []
localClosureResults: []
deferredVerification: []
invalidatedEvidence: []
scopeCheck:
  grantedPaths: []
  actualPaths: []
  violations: []
remainingUnknowns: []
nextOperation: review-change | diagnose-failure | design-change | orient
outcome: completed | blocked | reconcile-required | design-required
```

## 失败与转移

- focused deterministic fail → 返回 `diagnose-failure`，不重复运行。
- root assumption/owner/contract失效 → `design-change`。
- 用户目标或base改变 → `orient`/`reconcile-required`。
- write set不足 → blocked，要求新envelope；不得自扩。
- implementation完整且local closure resolved → `review-change`。

## 示例

修复validator shape drift：只改validator、focused regression和已授权manifest；不顺手修aggregate算法，因为它属于另一个owner。

实现共享cache时发现缺失content identity：停止当前叶节点patch，转design；不能用mtime和清cache测试临时绕过。

## 资源

- `../../registry.yaml`
- `../../README.md`
- operation envelope / Change Closure / Impact selector / verification runner
- target domain authority、types、tests和migration contract

## 禁止

- 不扩大timeout、无限retry、skip→pass、删除覆盖或硬编码当前例子。
- 不越过未授权路径、owner、capability或external boundary。
- 不把单个focused test通过称为candidate完成。
- 不主动运行重复Risk/Full。
- 不把未提交、未push或旧head结果写成exact candidate Evidence。
