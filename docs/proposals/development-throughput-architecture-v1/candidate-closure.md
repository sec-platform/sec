---
title: Candidate Closure Engine
status: draft
domain: proposal
last-reviewed: 2026-08-01
---

# Candidate Closure Engine

## 1. 责任

Candidate Closure Engine负责把一个已完成authoring的候选推进到：

```text
exact frozen candidate
→ trusted Scope
→ trusted Verification
→ independent Review
→ merge authorization
→ expected-head merge
→ new-main readback
→ cleanup / replan
```

它是**编排器**，不拥有：

- Verification Result语义；
- Test Impact和profile选择算法；
- Review结论语义；
- failure fingerprint；
- trust registry；
- resource cleanup语义；
- Integration Queue冲突语义；
-产品acceptance。

这些均由既有owner提供typed输入。

## 2. 为什么必须独立提炼

当前物理primitive已经存在：

- `compiler-pr-validation.yml`：trusted frozen verification producer；
- `sec-merge-gate.yml`：exact-head merge authority revalidation；
- `sec-merge-bootstrap.ts`：本地dispatch、poll、squash、merge、patch和cleanup；
- GitHub PR、status、workflow、Review与branch API。

但完整状态仍主要由本地CLI过程拥有。若CLI中断、会话压缩、凭据缺失或操作者切换，需要重新检查并决定下一步。该状态必须外化为可验证transition chain。

## 3. 输入合同

```ts
interface CandidateClosureRequestV1 {
  schema: 'sec-candidate-closure-request-v1';
  repository: RepositoryIdentity;
  pullRequest: number;
  expectedBase: CommitSha;
  expectedHead: CommitSha;
  expectedTree: TreeSha;
  workPackage: {
    path: RepositoryPath;
    digest: Sha256Digest;
    schema: string;
  };
  closureReceipt: EvidenceRef;
  verificationPolicy: VerificationPolicyRef;
  reviewPolicy: ReviewPolicyRef;
  publicationPolicy: PublicationPolicyRef;
  requestedTransition: CandidateClosureTransition;
}
```

任何expected identity缺失时不允许从branch名、PR body或本地HEAD猜测。

## 4. 状态模型

```text
authoring
→ prepared
→ single-parent-ready
→ scope-requested
→ scope-passed
→ verification-requested
→ verification-passed
→ review-requested
→ review-approved
→ merge-authorized
→ merged
→ main-readback
→ cleanup-completed
```

正交结果：

```text
blocked
invalidated
cancelled
superseded
manual-bootstrap-required
```

`blocked`不是终态；只有blocker dependency/input改变后才可继续。`invalidated`要求从最近仍合法的状态重新计算。

## 5. Candidate identity

```ts
interface CandidateIdentityV1 {
  repositoryId: string;
  pullRequest: number;
  base: CommitSha;
  head: CommitSha;
  tree: TreeSha;
  parent: CommitSha;
  manifestPath: RepositoryPath;
  manifestDigest: Sha256Digest;
  toolchainDigest: Sha256Digest;
  trustDigest: Sha256Digest;
}
```

不得使用以下内容作为candidate identity：

- branch名；
-PR标题；
-PR更新时间；
-workflow run ID；
-聊天或Completion Report；
-本地dirty tree；
-墙钟日期。

## 6. Single-parent preparation

当前frozen workflow要求：

```text
head.parents.length = 1
head.parent = current default base
```

Candidate Closure应把single-parent preparation建模为一个显式transition，而不是在dispatch失败后再补救。

### 6.1 输入

- authoring tree；
- current base；
- original commit list；
- manifest bytes；
- local/remote branch protection；
- expected tree equality。

### 6.2 输出

```ts
interface SingleParentPreparationReceiptV1 {
  beforeHead: CommitSha;
  beforeTree: TreeSha;
  base: CommitSha;
  afterHead: CommitSha;
  afterTree: TreeSha;
  parent: CommitSha;
  treePreserved: boolean;
  method: 'squash-rebuild';
  publicationReadback: boolean;
}
```

必须证明beforeTree与afterTree完全相同。若tree改变，旧authoring Evidence失效并回到candidate构建，不得继续dispatch。

## 7. Scope transition

### 7.1 Scope request

Scope request只引用Work Package owner输出：

```ts
interface ScopeDispatchRequestV1 {
  pullRequest: number;
  expectedBase: CommitSha;
  expectedHead: CommitSha;
  manifestDigest: Sha256Digest;
}
```

### 7.2 Scope result

Scope PASS至少证明：

- same repository；
-唯一open PR绑定head；
-base/head当前；
-manifest path/digest当前；
-changed paths有且只有一个owner；
-forbidden paths未命中；
-trust route正确；
-Scope artifact来自受信workflow。

Scope artifact不得隐含Verification PASS。

## 8. Verification transition

### 8.1 Request

```ts
interface FrozenVerificationRequestV1 {
  schema: 'codex-development-frozen-verification-request-v1';
  pullRequest: number;
  expectedBase: CommitSha;
  expectedHead: CommitSha;
  manifestPath: RepositoryPath;
  manifestDigest: Sha256Digest;
  profile: 'quick' | 'full';
}
```

profile来自Verification policy/Impact，不由Candidate Closure自由选择。

### 8.2 Dispatch trust

现有workflow要求maintain/admin actor和triggering actor。正式服务应使用：

-明确的GitHub App/service identity；
-最小`actions:write`/`contents:read`/`pull-requests:read`权限；
-仓库内typed request validation；
-审计receipt。

不应依赖任意Agent拥有个人`gh`凭据。

### 8.3 Stale cancellation

新的head到来时：

1. old aggregate和merge authority立即invalidated；
2. old workflow通过candidate concurrency group取消；
3.未完成的workspace/process/browser资源进入cleanup；
4.仍满足Action Key的独立节点可保留；
5.新head重新计算Scope、Impact和Verification plan。

不能通过简单删除全部cache恢复正确性，也不能让旧head继续消耗Actions。

## 9. Review transition

Review必须在exact candidate稳定后启动。

```ts
interface ReviewRequestV1 {
  repository: RepositoryIdentity;
  pullRequest: number;
  base: CommitSha;
  head: CommitSha;
  tree: TreeSha;
  manifestDigest: Sha256Digest;
  closurePlanDigest: Sha256Digest;
  requiredReviewClass: 'ordinary' | 'trust-root' | 'architecture';
}
```

Review结果必须区分：

```text
approved
commented
changes-requested
not-run
unsupported
stale
```

约束：

-作者自评不替代independent Review；
-head变化立即STALE；
-Review finding返回path/symbol/invariant和severity；
-Reviewer不修改candidate；
-未解决thread和有效REQUEST_CHANGES阻断merge authorization；
-review工具不可用时是not-run，不是PASS。

## 10. Merge authorization

```ts
interface MergeAuthorizationV1 {
  schema: 'sec-merge-authorization-v1';
  repositoryId: string;
  pullRequest: number;
  base: CommitSha;
  head: CommitSha;
  tree: TreeSha;
  manifestDigest: Sha256Digest;
  scopeEvidence: EvidenceRef;
  verificationEvidence: EvidenceRef[];
  reviewEvidence: EvidenceRef[];
  integrationEpoch?: IntegrationEpochRef;
  issuedBy: TrustedProducerIdentity;
  authorizationDigest: Sha256Digest;
}
```

签发前重新读取：

- live default base；
-PR open/non-Draft；
-exact head/tree/parent；
-manifest；
-required status/checks；
-Review/thread；
-trust route；
-Integration Queue order；
-resource cleanup state。

授权不应有长TTL；任何identity变化自动失效。

## 11. Publication actions

### 11.1 Merge

-只允许expected-head merge；
-方法由repository policy决定；
-大型实验历史不进入main；
-响应必须明确`merged: true`；
-网络错误后先readback，禁止直接重复merge。

### 11.2 Main readback

必须验证产品结果，而不只是commit ancestry：

-新main包含候选tree结果；
-所需types/contracts/tests存在；
-旧路径是否按migration退役；
-merge commit/squash result与PR对应；
-开放PR/Issue没有错误保留完成状态。

### 11.3 Control-plane settlement

当前流程在merge后另做pointer patch。目标应减少两阶段窗口：

优先顺序：

1. 能在候选中预先表达的新pointer/manifest切换，和产品结果原子进入main；
2.若必须依赖merge SHA，使用受信post-merge reconciler产生typed settlement receipt；
3. settlement失败时产品merge事实保持，但control plane标记`reconciliation-required`；
4.不得因post-merge patch失败错误声称产品未合并，也不得把pointer陈旧当正常完成。

### 11.4 Cleanup

清理分为独立owner：

-PR/Issue关闭；
-remote branch deletion；
-local branch/worktree cleanup；
-workflow/diagnostic artifact retention；
-manifest archive；
-rolling replan。

每项都有receipt。工具不能执行delete-ref或物理worktree删除时准确记录`not-performed`和后续owner。

## 12. Transition receipt

```ts
interface CandidateClosureTransitionReceiptV1 {
  schema: 'sec-candidate-closure-transition-receipt-v1';
  transitionId: string;
  from: CandidateClosureState;
  to: CandidateClosureState;
  candidate: CandidateIdentityV1;
  inputDigests: Sha256Digest[];
  action?: TypedRepositoryAction;
  result: 'completed' | 'blocked' | 'invalidated' | 'failed';
  evidence: EvidenceRef[];
  failure?: FailureRef;
  nextTransition?: CandidateClosureTransition;
  producedAt: string;
  producer: TrustedProducerIdentity;
  receiptDigest: Sha256Digest;
}
```

`producedAt`只作审计，不进入语义identity。

## 13. 幂等与恢复

每个transition必须满足：

-调用前先read current state；
-目标状态已完成时返回existing receipt；
-网络/进程中断后readback；
-相同request不会创建第二dispatch、第二merge或第二cleanup；
-不同request但相同candidate/action identity要么复用，要么显式supersede；
-不通过轮询次数判断成功。

恢复算法：

```text
load candidate identity
→ load latest valid receipt chain
→ read live GitHub/Git facts
→ validate evidence freshness
→ compute one legal transition
→ execute or return blocker
```

## 14. GitHub触发策略

### 14.1 PR事件

- `opened/synchronize/reopened/edited`：只重算状态和失效，不自动运行昂贵Gate；
- `converted_to_draft`：取消/阻断closure；
- `ready_for_review`：若authoring closure满足，进入prepare；
- `closed`：取消未完成资源并按merged/unmerged分类cleanup。

### 14.2 Workflow事件

- `requested/in_progress`：更新状态，不重复dispatch；
- `completed`：验证title/head/artifact/producer并推进或diagnose。

### 14.3 Main push

-使所有基于旧base的candidate和Integration Epoch重算；
-不是无条件重跑全部Gate；
-只失效真正依赖base/tree的节点。

### 14.4 Schedule

定时任务只用于reconcile漏事件和stale cleanup，不是主推进路径。正常流程必须事件驱动且幂等。

## 15. 最小正式实现切片

### Slice A — Pure state and receipt contracts

-状态、transition、request、receipt parser/validator；
-无GitHub写入；
-历史PR状态回放；
-非法跳转和stale identity测试。

### Slice B — Read-only reconciler

-从GitHub/Git/Evidence解析current closure state；
-输出唯一next transition；
-对PR #227做shadow comparison；
-不dispatch、不merge。

### Slice C — Trusted dispatch adapter

-只实现Scope/Verification dispatch与run readback；
-最小GitHub App权限；
-stale cancellation；
-不自动merge。

### Slice D — Review / authorization

-Review request/readback；
-merge authorization；
-保持merge manual。

### Slice E — Publication

-expected-head merge；
-main readback；
-control-plane settlement；
-cleanup receipts。

每个Slice独立进入main并由下一个普通非trust-root候选证明。

## 16. 必须回归

1. multi-commit tree经single-parent preparation后tree不变；
2. preparation后head变化使旧Scope/Review/Evidence失效；
3. duplicate dispatch被幂等拒绝；
4.旧head workflow继续运行时新head优先并取消旧aggregate；
5. verification PASS但Review missing不能authorize；
6. Review approve后新push立即stale；
7. trust-root变化返回manual-bootstrap-required；
8. merge API超时但实际上已merged时readback避免第二次；
9. product merge成功、pointer settlement失败时状态为reconciliation-required；
10. branch deletion unsupported不能声称cleanup完成；
11. PR关闭unmerged取消资源但不关闭仍有效Issue；
12.两PR共享head时fail closed；
13. base前进后旧authorization失效；
14. artifact缺失、损坏或producer不受信不能PASS；
15.重启后从receipt继续而不重复昂贵Gate。

## 17. 成功指标

- `candidate_ready_to_gate_start`；
- `candidate_ready_to_merge_authorized`；
- `merge_authorized_to_main_readback`；
- manual transition count；
- duplicate dispatch count；
- stale workflow minutes；
- closure resume count与重复action数；
- post-merge reconciliation failures；
- cleanup completion latency。

V1首要目标是manual transition趋近0和重复action为0，不设牺牲正确性的绝对秒数硬门槛。