---
name: sec-integrate-change
description: 对已满足前置的 exact candidate 执行冲突解析、Gate custody、trust migration、merge、new-main readback和closeout；不实现产品、不修改验证语义、不把pending或manual-bootstrap-required当PASS。
compatibility: SEC Agent Skill System v2 proposal
metadata:
  sec-schema: sec-agent-skill-v2
  sec-version: '2'
  sec-operation: integrate-change,integrate-trust-migration
  sec-risk: repository-control
---

# sec-integrate-change

## 目标

把一个已Review、已验证、仍有效的candidate安全迁移到`main`，并以new-main tree/readback、Issue/PR/manifest/branch/worktree cleanup完成生命周期。trust-root bootstrap不是独立Skill，而是本Skill的`trust-migration`模式。

## 触发

- operation envelope明确 `integrate-change` 或 `integrate-trust-migration`；
- same-repository PR、exact base/head/tree/manifest/profile已冻结；
- required independent Review和local/hosted Evidence存在；
- integration resolver已给出合法order/conflict结果。

## 不触发

- candidate仍在authoring、Draft或HEAD会变化；
- required Review/Gate pending、missing、stale或unsupported；
- 产品实现/设计仍需修改；
- Role不是`sec-integrator`或未获得`repository-control`。

## 必需输入

- valid operation envelope、Role与repository-control grant；
- live PR、expected base/head/tree和changed records；
- manifest/design/acceptance、Review/threads/REQUEST_CHANGES；
- Verification Aggregate和Evidence identities；
- integration conflict/order result；
- closeout plan、Issue状态和cleanup capabilities；
- trust-migration模式下的trusted base verifier和base-side results。

## 权限边界

- 普通模式使用`repository-control`；外部发布另需`external-control`。
- 可执行typed PR/dispatch/merge/closeout/cleanup动作；每个写动作必须绑定target、expected identity、可逆性和readback。
- 不修改candidate source、不重写Gate结果、不批准Review、不force push。
- Skill不能自行授予admin bypass；manual/admin路径必须由repository policy和明确授权允许。

## 执行

1. 重读live main、PR base/head/tree、manifest、Review、threads、checks和integration状态。任何stale返回`reconcile-required`。
2. 调用integration resolver确认candidate仍有效、未被main包含或supersede，且当前merge order没有authority/path/resource/producer冲突。
3. 校验required claims：status、applicability、environment ownership、Evidence freshness和cleanup/readback。pending/missing/not-run/unsupported/invalidated均不解释为PASS。
4. 普通模式按profile触发或读取唯一Gate identity；相同未失效Evidence复用由Evidence service决定，不自行重复dispatch。
5. `trust-migration`模式：candidate不得运行自身新增parser/selector/verifier来授权自身；使用trusted base-side closure、独立Review和manual bootstrap contract。按设计返回`manual-bootstrap-required`的hosted Gate不重复刷绿。
6. merge前最后一次比较expected head/base、Review和status；使用expected-head保护的repository merge action，优先squash经过验证的最终状态。
7. 只有merge response明确成功，才读取新main commit/tree和产品结果。commit ancestry不能替代tree/behavior readback。
8. 执行closeout：归档/切换manifest、更新Issue/PR投影、关闭absorbed/superseded/probe/diagnostic对象、清理已完成branch/worktree/workflow入口。无法物理删除时准确记录未完成边界。
9. 重新运行orientation/selector，产生下一operation或`no-change`。
10. trust epoch改变时返回`restart-required`；不能在旧session继续假装使用新信任根。

## 输出合同

```yaml
schema: sec-integration-receipt-v2
operationId:
mode: normal | trust-migration
preMerge:
  main:
  base:
  head:
  tree:
  manifest:
  review:
  verification:
  conflictResolution:
merge:
  method:
  response:
  merged: true | false
postMerge:
  newMain:
  newTree:
  productReadback: []
closeout:
  issueActions: []
  prActions: []
  manifestActions: []
  branchActions: []
  worktreeActions: []
  unresolvedCleanup: []
nextOperation:
outcome: completed | blocked | reconcile-required | restart-required
```

## 失败与转移

- candidate stale、main变化或conflict重算 → `orient`/`reconcile-required`。
- Review finding或scope问题 → `implement-change`。
- Gate/cleanup/merge工具失败 → `diagnose-failure`。
- trust-root candidate缺base-side proof → `blocked`，不得降级普通模式。
- merge成功且trust epoch改变 → `restart-required`。
- main已包含有效结果 →不机械merge，执行closeout并返回`no-change`。

## 示例

PR经squash merge后ahead/behind仍显示旧ancestry未合并：读取new-main tree和行为证明结果已进入，关闭旧PR/branch，不重复合并。

trust-root PR的candidate gate返回`manual-bootstrap-required`：使用old-trusted runner和Review完成迁移，不重复dispatch直到碰巧green。

## 资源

- `../../registry.yaml`
- `../../README.md`
- integration/work-package resolver、merge gate、Verification Result、Evidence/Journal、branch/worktree hygiene
- GitHub PR/Review/Checks/merge APIs

## 禁止

- 不把Draft、mergeable、Review通过或单个check当merge授权。
- 不把skipped、pending、missing、unsupported、invalidated或cleanup unknown当PASS。
- 不force push frozen head、不修改candidate、不无条件关闭Issue。
- 不机械合并所有分支或保留过程噪声。
- 不声称工具未执行的branch/worktree删除已经完成。
