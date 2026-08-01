---
title: Evidence DAG、Action Key 与 Integration Queue
status: draft
domain: proposal
last-reviewed: 2026-08-01
---

# Evidence DAG、Action Key 与 Integration Queue

## 1. 总体边界

吞吐系统需要回答两个不同问题：

1. **这个动作是否已经对相同有效输入执行过，可以复用？**
2. **这个候选是否可以与其他候选并行开发、验证或按某顺序进入main？**

第一个问题由#179 Evidence DAG和各领域owner回答；第二个问题由#191/#207 Integration Queue回答。它们共享exact identity和changed records，但不能共用一个状态机。

## 2. Action定义

```ts
interface ActionDefinitionV1 {
  schema: 'sec-action-definition-v1';
  actionType: string;
  contractRevision: string;
  command?: readonly string[];
  implementationDigest: Digest;
  declaredInputs: InputSelector[];
  declaredOutputs: OutputSelector[];
  environmentSelector: EnvironmentSelector;
  resourceClass: ResourceClass;
  cancellationPolicy: CancellationPolicy;
  trustPolicy: TrustPolicy;
}
```

Action不是任意shell字符串。相同命令但implementation、environment或resource contract不同是不同Action。

## 3. Action Key

```text
Action Key = hash(
  action definition digest,
  exact input closure digests,
  environment digest,
  toolchain/provider digest,
  contract/selector revision,
  resource identity class
)
```

### 3.1 必须进入key

-Action implementation；
-所有实际读取的Git blobs/config/schema；
-transitive declared dependency outputs；
-toolchain/runtime/compiler/test runner版本；
-平台、架构和必要系统能力；
-env allowlist值；
-Impact/selector revision；
-fixture seed和immutable resource identity；
-安全/permission profile；
-输出contract revision。

### 3.2 禁止进入key

-branch名；
-PR号；
-workflow run ID；
-聊天；
-绝对临时路径；
-非语义时间戳；
-Agent身份；
-日志格式噪声；
-未声明ambient PATH。

### 3.3 不可缓存或特殊缓存

以下动作默认不可跨执行复用positive结果，除非owner明确提供identity：

-需要独占live port/process owner；
-依赖当前凭据或权限状态；
-发布、merge、branch删除等mutation；
-browser/process readiness；
-identity-bound workspace lease；
-外部服务实时状态；
-安全扫描依赖动态数据库且未绑定revision；
-人工Review。

可缓存其诊断或receipt，但不能错误复用物理能力。

## 4. Action Result

```ts
interface ActionResultV1 {
  schema: 'sec-action-result-v1';
  actionKey: Digest;
  actionDefinition: Digest;
  status: 'passed' | 'failed' | 'blocked' | 'not-run' | 'unsupported' | 'cancelled';
  disposition: string;
  applicability: string;
  inputs: InputClosureRef;
  environment: EnvironmentRef;
  outputs: OutputRef[];
  cleanup?: CleanupReceiptRef;
  failure?: FailureRef;
  producer: ProducerIdentity;
  trust: 'local-untrusted' | 'local-trusted' | 'hosted-trusted';
  resultDigest: Digest;
}
```

Result status语义必须消费#176，不在#179中复制。

## 5. Evidence DAG

节点类型初始只覆盖高重复成本动作：

```text
dependency-install
repository-census
import-plan
TypeScript-diagnostics
typecheck
test-inventory
affected-plan
focused-test
fast-suite
build
package-smoke
platform-smoke
scope-attestation
frozen-verification
```

后续再加入browser/fixture/process等物理节点。

边类型：

```text
requires-output
requires-trust
requires-resource
invalidates-on
aggregates
```

### 5.1 Reuse判定

```text
same Action Key
+ producer trust satisfies consumer
+ output blobs available and valid
+ no cleanup failure
+ no explicit revocation
+ consumer accepts result status
= reusable
```

“source看起来差不多”“只改文档”“旧PR已通过”不是reuse证明。

### 5.2 Partial reuse

新head到来时：

-aggregate和head-bound Review失效；
-input closure未变的install、inventory、部分typecheck/test节点可复用；
-依赖candidate tree的节点重算；
-running旧节点按cancellation policy处理；
-cleanup未完成的节点不能复用。

### 5.3 Failure reuse

失败不是positive Evidence，但可以避免重复执行：

```ts
interface FailureFingerprintV1 {
  actionKey: Digest;
  normalizedFailureClass: string;
  exitOrSignal: string;
  normalizedTailDigest: Digest;
  failedOutputDigest?: Digest;
  resourceStateDigest?: Digest;
  fingerprint: Digest;
}
```

输入和fingerprint未变时：

-不重新运行同一确定性动作；
-直接返回failure、owner、reproduction和next action；
-只有代码、环境、资源或failure假设发生变化时允许重试；
-infra/transient由#177定义受限重试。

## 6. CAS与物理存储

### 6.1 先key，后store

V1可先使用本地文件目录或现有GitHub artifact。只有Action Key、trust和invalidation稳定后才引入`cacache`或remote store。

### 6.2 两层结构

```text
Action Cache:
  actionKey → result metadata digest

Content Addressable Store:
  content digest → immutable bytes
```

采用Bazel机制但不采用Bazel语义：Bazel官方remote cache同样区分action cache与CAS，并要求action显式声明输入、输出、命令和环境。SEC保留自己的Action定义、Verification Truth和resource contract。

### 6.3 写权限

-本地开发可写local-untrusted namespace；
-hosted trusted producer可写trusted namespace；
-low-trust PR不得污染default trusted cache；
-merge authority只消费满足trust policy的结果；
-remote cache写入初期只允许CI；
-缓存污染可按producer/revision/action family撤销。

### 6.4 GitHub Actions cache

GitHub Actions cache适合dependency和derived build cache，不应直接存SEC merge-authoritative Evidence：

-缓存是可变生命周期服务；
-branch/default scope有访问规则；
-partial restore key可能得到非精确内容；
-已有cache不能原地修改，只能生成新key；
-容量和7日未访问淘汰可能造成thrashing。

SEC在使用restore key时必须把恢复内容视为加速hint，并由工具自身校验identity；不能把partial cache hit当PASS。

## 7. Hermetic Resource组合

#190拥有resource语义。Evidence节点只引用：

```text
fixture seed
workspace allocation
port allocation
process group/job object
browser executable/profile/context
database/container
network capability
cleanup receipt
```

规则：

-资源allocation是节点输入；
-cleanup/readback是positive结果的一部分；
-cancelled/superseded必须cleanup；
-identity-bound资源不能因bytes相同跨run复用；
-immutable seed/cache与mutable run namespace分离；
-unknown residue使结果failed/invalidated。

## 8. Integration Epoch

### 8.1 结构

```ts
interface IntegrationEpochV1 {
  schema: 'sec-integration-epoch-v1';
  id: string;
  exactBase: CommitSha;
  packages: IntegrationPackageBinding[];
  pairwise: PairwiseConflictResult[];
  globalWriters: GlobalWriterRegistry;
  orderedGraph: DirectedAcyclicGraph;
  state: 'proposed' | 'active' | 'invalidated' | 'completed';
  epochDigest: Digest;
}
```

### 8.2 Package binding

每个包绑定：

- manifest path/digest；
- base；
-authority read/write；
-owned/permitted/forbidden paths；
-global exclusive/shared resources；
-session/worktree/branch；
-verification policy；
-requires/ordered/conflicts；
-current candidate identity。

### 8.3 分类

```text
parallel-safe
ordered
write-conflict
authority-conflict
resource-conflict
unresolved
```

`unresolved`永不授权并行。

### 8.4 语义冲突

即使路径不同，以下也冲突或有序：

-同一canonical type/schema/revision owner；
-同一state writer；
-producer/consumer contract revision；
-artifact writer；
-package/lock；
-workflow trust root；
-docs/work control plane；
-Agent/Skill registry；
-repository worktree cleanup；
-host/browser/database/global cache writer；
-release publisher。

## 9. #207正确性前置

正式并行前必须关闭：

-`requires`方向；
-`orderedAfter`实际控制流；
-`conflictsWith`任一侧声明；
-self/missing/cycle/矛盾relation；
-authority prefix overlap；
-permitted不授予ownership；
-rename/copy/case canonical path；
-verification definition与physical resource独立性；
-2/3/5包全matrix；
-base/manifest/cancel/supersede重算。

在resolver验证自己之前，它不能授权自身并行开发。

## 10. Virtual Merge

### 10.1 目的

在实际merge前验证组合状态：

```text
current main tree
+ ordered candidate trees
→ virtual merge tree
→ combined changed records
→ combined Impact/Closure
→ reusable/invalidated Evidence plan
→ integration result
```

### 10.2 身份

```ts
interface VirtualMergeIdentityV1 {
  baseTree: TreeSha;
  orderedCandidates: Array<{
    pullRequest: number;
    head: CommitSha;
    tree: TreeSha;
    manifestDigest: Digest;
  }>;
  mergeAlgorithmRevision: string;
  virtualTree: TreeSha;
}
```

顺序是identity的一部分。A→B和B→A即使文本都能合并，也可能语义不同。

### 10.3 不依赖长期integration branch

virtual merge可以使用临时Git tree/index/object，不需要长期远端`integration/*`。只有两条大型真实产品线需要系统拼装和独立Evidence时才使用临时integration branch，并在完成后清理。

### 10.4 组合验证

-先复用每候选仍有效节点；
-运行组合changed scope的新增closure；
-检查producer/consumer版本；
-检查迁移顺序与旧adapter退役；
-检查global resource/publication冲突；
-任何unknown阻断queue promotion。

## 11. Queue算法

V1无需复杂优化器：

1. 读取最新main；
2.过滤非Ready、stale、missing Evidence和blocked候选；
3.按requires/ordered graph生成可行顺序；
4.对同优先级使用价值、风险、age和失效成本排序；
5.构造第一个virtual merge；
6.执行组合closure；
7.通过后expected-head merge；
8.读取新main；
9.重算剩余候选的base、Impact和Evidence；
10.只重跑真正失效节点。

不承诺GitHub concurrency FIFO作为工程顺序；SEC queue order必须有自己的identity和receipt。

## 12. GitHub Merge Queue关系

GitHub Merge Queue可以管理branch protection下的合并排队和临时组合验证，但不能替代SEC：

- authority/path/resource冲突；
-Work Package requires/conflicts；
-Verification Result Truth；
-Evidence reuse；
-new-main semantic readback；
-control-plane settlement。

未来可把GitHub Merge Queue作为publication provider，前提是SEC Integration Queue先签发可执行queue entry。

## 13. 取消、失败与重排

### 13.1 候选新head

-移出ready queue；
-失效其Review/aggregate；
-重算pairwise和virtual merge；
-保留仍有效Action结果。

### 13.2 前一候选merge

-epoch base变化，旧epoch invalidated；
-从新main重建；
-剩余候选不自动全部失败；
-计算哪些Evidence因base或consumer变化失效。

### 13.3 候选失败

-该候选进入blocked/diagnose；
-无依赖候选继续；
-依赖候选保持ordered blocked；
-不因一个失败取消全部安全候选。

### 13.4 Supersede

被main吸收或新实现替代的候选关闭，不进入queue；按tree/behavior结果判断，不按commit ancestry机械判断。

## 14. Metrics

Evidence：

- action executions / reuse；
- exact/partial cache hit；
- invalidation reason；
- failed action rerun without input change；
- trusted/untrusted producer分布；
- cache bytes、eviction和poison incidents；
- cleanup invalidations。

Integration：

- parallel-safe packages；
- pre-authoring conflicts found；
- queue wait；
- virtual merge failures；
- Evidence retained after main advance；
- integration reorder count；
- candidate supersede rate；
- merge-to-readback latency。

## 15. 必须评测

1. 相同Action Key精确复用；
2. env/toolchain变化失效；
3. partial restore cache内容被工具校验而非信任；
4.低信任producer结果不进入merge authority；
5. failed result相同输入不重复运行；
6. cleanup失败失效positive result；
7.新head保留独立install但失效aggregate；
8. A/B路径无冲突但authority双写→conflict；
9. B.requires(A)→A先B后；
10. wrong-direction requires→unresolved；
11. cycle/missing relation→unresolved witness；
12. A||B safe、A||C safe、B||C conflict不能全体safe；
13.前一PR merge后仅失效受影响节点；
14. A→B与B→A virtual tree/closure分别计算；
15. candidate被main吸收后supersede而非重复merge；
16. queue进程重启后顺序和receipts一致；
17. GitHub cache eviction不改变正确性；
18. remote store不可用时可本地/clean重建；
19. cache poison可按producer/revision撤销；
20. virtual merge不创建长期远端branch。

## 16. 实施顺序

1. Action Definition/Key/Result纯合同；
2.本地read-only Evidence planner；
3. trusted producer和local/untrusted namespace；
4.通用install/typecheck/test节点；
5. Run Journal；
6. #207 Integration Epoch correctness；
7. virtual merge pure tree builder；
8.组合Impact/Evidence planning；
9. queue shadow；
10. publication provider。

remote CAS、GitHub Merge Queue和remote execution均后置。