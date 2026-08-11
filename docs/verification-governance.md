---
title: Verification、Evidence 与 CI 治理
status: stable
domain: verification-governance
last-reviewed: 2026-08-11
---

# Verification、Evidence 与 CI 治理

本文拥有不同验证层证明什么、Requirement/Gate/Result/Claim/Aggregate/Evidence的稳定身份边界、Implementation conformance、Impact选择、失败复用、trusted bootstrap和merge authority。具体测试文件、suite、command、timeout、并发、selector、当前schema revision和physical Gate结果由机器合同、runner、workflow和最新 `main` 拥有。

Verification可以为Implementation Resolution、Binding Delta、Compatibility和Migration提供Evidence，但不拥有Resolver、Delta comparator或Compatibility evaluator。

## 当前合同与后继平台

必须区分两层：

### Verification Truth Kernel

统一合同族使用：

```text
passed | failed | not-run | unsupported | invalidated
```

并独立表达：

- executed / reused / not-executed；
- applicable / not-applicable / unsupported / unresolved；
- Gate identity、Claim definition、owning environment和proof identity；
- order-independent aggregate；
- exact input/revision/environment/artifact/command/cleanup binding；
- duplicate、missing、unknown、stale和self-proof fail closed。

该语义是当前canonical contract方向。某个writer、adapter、artifact或CI consumer是否已经完整迁移，仍必须从最新代码和Evidence验证；稳定文档不把局部实现扩大成全系统完成。

### 后继 Verification Platform

以下能力只有对应contract、producer、consumer、migration、tests和Work Package进入 `main` 后才是现实能力：

- 完整Execution Ledger；
- Evidence DAG/CAS；
- Development Run Journal；
- 统一Hermetic Runtime和resource allocator；
- 自动persistent reuse/resume/flake governance；
- 跨Host/Target/Implementation/Release的完整Observation catalog；
- 机器化Review finding/merge decision平台。

目标设计被接受不等于实现完成。CLI、PR summary、文档或Skill不得把未来状态名投影成当前PASS。
T2 trusted-cutover epoch只有在 integrated candidate 与 new `main` 完成 exact commit/tree/
merged-tree readback，并由 ordinary candidate canary 证明新路径后，才把 Action、Session、
Review和merge authorization从目标变为active capability。轮换中的Work Package identity只由
Document Control Plane拥有；候选分支中的manifest、类型、测试或workflow不构成激活证明。

## 验证对象与层级

- **Requirement / Claim**：要证明的exact性质、owner、subject、inputs和applicability；
- **Gate Definition**：如何在声明环境和capability下观察或执行该Requirement；
- **Observation / Execution**：一次physical执行、合法reuse或明确not-executed事实；
- **Result**：该Observation的五态结果、reason、cleanup和artifacts；
- **Aggregate**：按Claim、owning environment和proof identity组合多个Results；
- **Decision**：Mutation、Implementation Resolution、Compatibility、merge、release、support等上层consumer对Aggregate和其他事实作出的决定；
- **Evidence**：支撑Result/Claim/Decision的exact记录。

一个绿色命令不是完整Verification对象；一个Aggregate PASS也不能自动证明Implementation eligibility、Binding Delta、Compatibility、packaged/deployed或product-supported。

## 测试层

- **Unit**：pure builder、selector、resolver、comparator、index、normalizer、formatter和安全边界；
- **Contract**：公共schema、CLI、package、CI、error、IR、Requirement/Candidate/Decision/Binding/Delta和inter-owner shape；
- **Integration**：Workspace pipeline、Implementation Resolution、Binding Delta/Impact、artifact flow、transaction和跨owner集成；
- **E2E / slow**：真实Git、filesystem durability、server、browser、native host、package、Provider和发布路径；
- **Property / Model**：输入空间、幂等、round-trip、状态机、fixed-point、排序、tie-break、Delta direction和反特化；
- **Fault / Recovery**：crash/persistence boundary、TOCTOU、cache invalidation、rollback/recovery和资源收口；
- **Mutation / Test-quality**：校准关键validator、authorization、eligibility、Delta/Impact fail-closed和selector是否真正被断言覆盖。

测试层由要证明的性质、真实副作用、状态冲突、资源和环境决定，不由目录名、一次duration或“看起来像集成”决定。

真实browser/server/native/durable acceptance即使偶尔很快仍属于physical layer；反之，位于acceptance目录但不请求browser capability的contract test不应被迫启动无关browser。Gate definition和fixture实际需求共同决定capability。

## 不可违反的不变量

- 未运行、缺失、skipped、超时、取消、平台不匹配、scope mismatch、stale、损坏或candidate self-proof都不是PASS。
- `not-applicable`必须有可信applicability proof；它不等于required但没有执行。
- zero-test/empty selection只有在Target/Gate contract证明不适用时才能not-run；否则invalidated/unresolved，不能passed。
- executed/reused result只有在Claim owning environment满足时才能支持该Claim。
- Aggregate状态与Claim输入顺序无关；duplicate/missing/unknown identity fail closed。
- 一项Check只证明它绑定的exact candidate、Binding、Delta/Compatibility subject、profile、environment和input closure。
- 测试主体通过但cleanup/readback/receipt失败，整个Gate仍未通过。
- changed path、owner、required Gate、ImplementationBinding、Delta或Evidence unresolved时fail closed。
- 失败不能通过删除测试、弱化assertion、无边界增加timeout、重复运行直到绿、自动换Provider或把unsupported当skipped消除。
- Provider manifest、类型声明、文档、下载量、单次示例和AI生成测试都不是conformance PASS。
- verifier、selector、Resolver、Delta comparator、Compatibility evaluator、Evidence validator或merge authority的candidate不能只用自身新实现授权自身。
- CI workflow是executor/adapter，不拥有第二套Gate定义、result truth、Eligibility、Delta、Compatibility或test inventory。
- Local cache、聊天、PR body、branch、commit ancestry和人工checkbox不是merge或Implementation Evidence。

## Result 与 Claim 真值

### 五态

- **passed**：required execution或合法reuse对exact input closure证明成立；
- **failed**：已执行但断言、运行、cleanup或Evidence完整性不满足；
- **not-run**：可信applicability/Impact证明无需执行，或尚未执行但如实保留；
- **unsupported**：执行环境/Provider缺少声明能力；是否阻断由上层Requirement/Implementation/Compatibility/Support contract决定；
- **invalidated**：过去结果或当前selection因输入、环境、规则、coverage、identity、Binding、Delta subject或信任变化而失效。

状态和execution disposition正交。`not-run`可以是not-executed，`passed`可以来自合法reuse；但reuse必须保留原execution/environment/input Evidence并满足当前invalidation rules。

### Claim definition

Claim至少绑定：

- claim identity/revision和owner；
- subject/requirement/input digest；
- required/optional Gates；
- owning environment集合或matcher；
- applicability与not-applicable proof；
- invalidation rules；
- supported/required contribution semantics。

Gate的passed状态不能越过Claim environment、identity或applicability。Non-owning observation可以保留为Evidence，但不能poison或支持owning Claim。

### Aggregate

Aggregate固定使用声明的status lattice和deterministic reason selection。Order、Map insertion、duplicate overwrite和first-non-pass都不能改变结果。

Empty Claims、empty required Gates、zero physical observations、cleared supportedClaims、mixed proof identity或unknown contribution默认不能passed。

Aggregate只计算Verification truth，不拥有Mutation terminal、Implementation Resolution、Binding Delta、Compatibility、merge、release或Support decision。

## Gate identity 与 Execution Ledger

Gate definition和一次运行实例分离：

- **Gate contract**：identity、revision、owner、applicability、inputs、capabilities、dependencies、command/runner、timeout policy、Evidence output和invalidation rules；
- **Execution record**：exact candidate/input/Binding/Delta-subject revisions、runtime/OS/arch/filesystem、toolchain/provider/dependency authority、环境、开始/结束/cleanup、result、artifacts和receipt。

一次执行的唯一 ActionKey 只包含会改变证明语义的 producer、normalized operation、
input closure、environment/tool/provider/contract revision、result schema和dependency topology；
branch名、PR编号、聊天、显示标题、session ID、wall-clock、pid、临时路径和scheduler lane
不能成为语义key。

`input closure` 必须是该 Action 实际读取的 subject closure，不得无条件加入整个 candidate
tree、manifest raw bytes或所有依赖拓扑。只有 Gate contract 真实观察全树时，whole-tree digest
才属于该 ActionKey。等价 commit 重新 materialize 而 `CandidateContentId` 与 subject closure 未变时，
ActionKey 保持不变；exact-head Review、Session revision 与 Promotion 仍重绑新的 Git head。

所有正式 producer 必须从同一个 canonical builder 生成 ActionKey。Selector 只拥有“哪些
scope required”；producer 把 scope 规范化为 Action；runner 只消费经过验证的 ActionPlan。
CI gate ID、raw argv、scopeId、evidenceIdentity、journal path或workflow run ID不能与
ActionKey并列成为第二套执行真值。

同一 ActionKey 的正式 hosted 请求必须进入由 trusted resolver 重算 key 的全局 producer
临界区：只有该 hosted owner 可以物理执行，其他 Agent、CLI 和 workflow 请求只能 dispatch、
join 或复用同一个 immutable terminal origin。client payload、完整 ActionPlan digest、本机
workspace lease 与进程内 map 都不能成为全局 owner；本地 dev-runner 只能产生显式不同
execution-environment revision 的反馈 Action，不能满足 formal hosted Evidence。全局 producer
在临界区内先完整查找并验证既有 terminal origin，零条时才执行；冲突、重复或未知 provenance
一律 fail closed。claim/journal/lease 只是可恢复 machine state，不是 Evidence；丢失它们
最多失去 resume 能力，不能制造或改写 Verification Result。Hosted owner在执行前必须先发布并
readback immutable ActionKey start marker；marker存在而terminal origin缺失表示physical outcome
unknown，必须BLOCKED并通过新的显式producer/environment epoch形成新ActionKey，不能对同key
自动重跑。start marker同样只是machine state，不能被解释为PASS或terminal Evidence。

正式解析对每个 required ActionKey 只能得到一个结果：fresh PASS `reuse`、fresh FAIL
`reuse-failure`、authenticated in-flight `join`、missing/stale `execute`、start-without-terminal
`blocked-unknown-outcome`。`not-applicable` 在 Requirement 层由 proof 决定，不制造 Action；Impact
`unresolved` 必须扩大 closure 或 BLOCK。全局 hard invariant 是
`physicalStartsPerActionKey <= 1`；fresh terminal、in-flight 或 unknown outcome 的物理执行次数都
必须为零，不能用 retry、new session 或不同临时路径绕过。

Hosted provider machine state只有一个pure contract和一个窄GitHub transport owner。trusted
resolver从base重算ActionKey；job concurrency只能由该输出投影，并必须保留pending请求而不
cancel/replace。provider对exact candidate SHA的status history做完整分页，`pending`只表示
start tombstone，一个neutral terminal status只锚定已认证terminal artifact；status不能复制
五态Result，也不能成为required Check、Evidence或merge authority。每次POST至多一次，网络、
分页、creator、context、run/App或artifact origin存在任何歧义都只能BLOCK。start已存在而
terminal artifact缺失时永久禁止同key再次physical spawn；exact terminal artifact已存在而
terminal status缺失时只允许repair status，executor调用次数仍为零。artifact过期或删除后，
status仍阻止重放，但不能凭digest恢复或复用原Result；需要跨retention复用时必须另行冻结带
conditional insert和长期bytes的provider，不能把status提升为永久Evidence。

Provider availability不是effect authority，也不是Session准备阶段可缓存到结束的布尔值。Review
request、hosted verification dispatch、GitHub publication、merge和closeout的authority只来自各自的
operation-specific authorization、idempotency、recovery和exact readback contract。effect owner紧邻
physical provider effect只重新读取canonical availability epoch，且仅当当前epoch明确标记对应
capability为unavailable时作为negative circuit breaker阻止重复尝试；availability ledger不得产生
positive claim、role或effect permit。expired、unknown、unverifiable和degraded既不能支持正向
authority，也不自行否定已经由该operation contract授权的一次调用；其provider attempt/readback成为
新的availability evidence。较早的prepare、selector或Review观察不能授权较晚effect；已存在的
authenticated in-flight exact ActionKey只能join或readback，不能再次physical spawn。这样provider
状态既不会被Session复制成第二真值，也不会在检查与实际副作用之间形成TOCTOU窗口。

一次external Session协调多个Action时，协调者必须先在受信workflow内发布并精确读回一个
canonical parent dispatch-plan artifact；它绑定repository、external parent run/attempt、trusted
workflow ref/SHA、当前maintain/admin human principal以及按ActionKey排序且无重复的proposal集合。
每个internal Action event只携带proposal和该parent artifact的provider locator/provenance，属于
at-least-once wake-up而不是authority。child run必须先验证当前GitHub Actions App/Bot身份，再从
provider独立读取parent run、job/step、artifact metadata、archive bytes与payload，确认external
Session事件、trusted base、human权限、plan digest和唯一member全部一致；payload自陈的parent
字段、同一App的其他workflow或`repository_dispatch`发送者身份都不能单独授权执行。合法event
重放只能join同一ActionKey，不能产生第二producer或扩大parent plan。

trusted resolution、credential-free candidate execution和fresh trusted terminal assembly必须是
三个隔离hosted job。candidate只接收normalized physical target与精确input，环境中不含GitHub、
Actions、OIDC、status、artifact-finalization或merge capability；它只能产生untrusted raw output。
fresh assembler从trusted base验证subject/plan/argv/environment/process settlement与raw transport，
然后生成唯一canonical terminal artifact/Result。candidate-owned脚本或同一runner残留不能发布
terminal Evidence。

其中candidate physical operation必须位于独立OS sandbox：private root与writable tmpfs、只读且
已认证的input/tool closure、不同uid/gid、独立mount/PID/network namespace与新`/proc`、空
capability set、`no-new-privileges`、受限CPU/memory/process/file资源，以及关闭除受控
stdout/stderr外的继承descriptor。host workspace、runner temp、GitHub command file、provider
socket、credential和parent process state不得在sandbox root中可见；仅把input复制进private
workspace后执行一个normalized operation。trusted facade必须在start marker前验证sandbox
capability，并在实际SUT host再次验证；terminate后强制杀死并readback全部descendant与residue，
随后才可在sandbox外生成raw Result和cleanup receipt。任一隔离能力不可证、超时、资源越界或
cleanup不完整时，不执行或不重放同一ActionKey，并只产生`unsupported | invalidated | cleanup-failed`
等非PASS事实；环境denylist、同用户子进程、只读host root或普通temp目录都不能替代这条边界。
未经验证的archive不得先在host workspace展开；trusted facade先验证raw bytes、entry type/path、
link target、重复与大小边界，再在private root内展开。候选不能用自己的package/registry配置在
provider job中物化依赖；当Work Package禁止package/toolchain变化时，只能从exact trusted-base
package/lock物化并绑定dependency closure，package变化则需要单独授权的install sandbox与新的
environment epoch。candidate stdout/stderr也只是untrusted bytes，必须bounded capture并转义或
编码，不能直接进入GitHub workflow command channel、`GITHUB_OUTPUT`、env/path或artifact控制面。

CI Evidence 必须记录 canonical Action closure、五态 Result、execution disposition、exact
environment/input、cleanup与artifact reference。合法 reuse 保留原始 proof identity；已知
failure可以复用为失败事实，但 `not-run`、`unsupported`、`invalidated`、stale、cleanup失败
或旧schema记录不能被包装或重解释为PASS。迁移期间的 legacy scope/evidence identity
必须明确只读且有consumer-zero删除门槛，不能长期双写两个结果源。

## VerificationSession、Scope 与 MainHealth

VerificationSession 是一次 frozen candidate 从定向到合并/readback 的唯一运行状态机，
不是第二个Task Capsule、Result、Review或Integration owner，也不是 general Run Kernel。稳定
`sessionRevision` 与 `sessionId`、candidate generation、event ID和时间戳分离，至少绑定：

- exact repository/default base commit与tree、`CandidateContentId` 与
  `CandidateGenerationRef`；
- `taskCapsuleRef/digest/revision`、manifest semantic/raw digest、ScopeGrant 与 exact
  CandidateScopeAttestation；
- canonical Action plan/key closure、profile、environment和trust revision；
- Review policy、MainHealth revision以及所消费Evidence/authorization references。

Manifest是scope proposal，不是自授权。`ScopeGrantId` 固定 trust epoch、manifest semantic
revision、exact authorized/forbidden write set、capability/resource bounds 与 base authority；trusted
resolver 为每个 exact base/head/tree 产生 `CandidateScopeAttestation`，证明 candidate diff/effects
仍是 grant 子集。manifest semantics、write set、authority 或 capability变化必须产生新 grant；
仅 transport/head 变化时产生新 generation、attestation 与 sessionRevision，不能扩大 scope。
PR body、pointer或候选自己修改的manifest不能给自己扩权。

`CandidateContentId` 绑定 base semantic/tree dependency、candidate tree、ScopeGrantId 与 manifest
semantic revision；`CandidateGenerationRef` 绑定 run/session、单调 generation、content ID 与 exact
head commit。相同 content 被不同 commit metadata 重新 materialize 时 content ID 不变。旧 exact-head
Review、CandidateScopeAttestation、Session revision与Promotion stale；Action/Evidence仅在其 subject
closure、contract、environment或trust input变化时失效，不能因 transport churn global invalidate。

identity contract至少等价于：

```text
CandidateContentId = H(
  identitySchemaRevision,
  baseDependencyClosureDigest,
  candidateTree,
  ScopeGrantId,
  manifestSemanticRevision
)

CandidateGenerationRef = {
  runId, sessionId, generation,
  contentId, baseCommit, exactHeadCommit, candidateTree,
  candidateScopeAttestationDigest
}

ReviewSubjectId = H(
  baseCommit, exactHeadCommit, candidateTree,
  candidateScopeAttestationDigest,
  reviewPolicyRevision, reviewFactsSnapshotDigest
)

PromotionId = H(
  CandidateGenerationRef, evidenceAggregateDigest,
  ReviewReceiptDigest, trustRevision, expectedLiveMain
)
```

`baseDependencyClosureDigest` 由trusted-base dependency/Impact owner计算，不能由candidate缩小；
`manifestSemanticRevision` 由canonical Work Package parser产生，不能用raw formatting或路径别名替代。
consumer边界固定为：Impact/Action builder消费content与subject closure，Session/PR transport消费
generation ref，Review只消费ReviewSubject，merge gate只消费Promotion。任一consumer不得用上游较弱
identity替代自己要求的exact identity。

Work selection先由trusted ScopeGrant、Task Capsule 与 Session外部记录授权；candidate tracked
pointer不是运行期授权源。Document Control Plane只纯编译manifest、prospective pointer与rolling-plan
bytes。candidate稳定后，显式Candidate Materializer在isolated temporary Git index中把这些bytes与
implementation blobs应用到trusted base，`write-tree`、`commit-tree -p <base>`、验证exact
one-parent/content binding，再以expected-old ref CAS发布并readback。任何 object/tree/commit/ref
阶段失败都从immutable inputs恢复或保持旧ref，不创建successor worktree。

Candidate 中的 pointer/rolling/manifest 是 `ProspectiveControlProjection`；只有 live default/main
commit 中的byte-exact control facts才能成为 `ActiveMainControlState`。worktree projection只是可丢弃
视图，projection失败只能产生 `CANDIDATE_PROJECTION_FAILED`，不能让 live main进入
`activation-in-progress`。pure check/freeze不得写source、index、mtime或Git object database；只有
显式 materialize/transform operation可写。Session只消费已经进入immutable commit/PR head/tree并
通过ref readback的generation。

`prepare`在hosted dispatch前从同一selector生成local quick-only feedback closure，并用独立
`local-dev-runner` environment revision交给canonical Action runner。local Action只在exact clean
PR-head worktree执行，journal可join/reuse但不是Evidence；complete local PASS才允许进入Review/
hosted transition，running为WAITING，失败或ambiguous expired claim为BLOCKED。local OS/toolchain/
ActionKey和aggregate digest不得进入formal hosted Session revision或伪装成hosted PASS。

MainHealth是对exact default commit/tree的live ledger，状态仅为
`healthy | degraded | locked`，并绑定failure fingerprints、owner、repair Work Package、expiry、
allowed lane和trust revision。无法完整读取、过期或revision不匹配一律视为`locked`；普通
candidate不得吸收unrelated baseline/verifier/selector defect。`allowedLanes`只表达exact
ledger的语义路由限制，不是physical executor、frozen Work Package、Scope、Evidence、Review、
IntegrationAuthorization或merge authority。当前repair locator仍为proposal-only/not-frozen，
因此known exact-main failure可以被保存为degraded repair-only事实，但所有production consumer
仍是ordinary-only：degraded阻断ordinary且不授权任何repair或integration effect。只有后继
独立冻结的repair Work Package把exact manifest/write set接入Scope、Session、Evidence、Review、
authorization、merge authority与hosted effect ownership后，production才能选择repair lane。

## Implementation Conformance 与 Resolution Evidence

Implementation Resolution可以消费Verification Evidence，但不能自己制造或改写Result。至少区分：

```text
Provider declaration
→ Conformance Requirement
→ physical Gate / Observation
→ Verification Result / Aggregate
→ Eligibility input
→ Resolution Decision
```

### Conformance Claim

一个Provider/Adapter/Reference/Custom candidate的conformance Claim至少绑定：

- exact Provider/package/version/integrity/Adapter/config revision；
- Semantic Contract/capability subset和Type Algebra references；
- Target/Host/Toolchain/Runtime owning environments；
- input/output/error/cancellation/timeout/retry/idempotency/serialization semantics；
- Effect、Permission、resource、network、process、filesystem、secret和telemetry边界；
- dependency/peer/native/install/build closure；
- positive、negative、boundary、failure和cleanup cases；
- coverage、unsupported/opaque和invalidation rules。

通过一个API示例、typecheck、unit test或单一happy path不能支持完整conformance Claim。

### Eligibility 与 Verification 的边界

- Verification owner只回答exact Claim在exact环境下的五态Result/Aggregate；
- External Provider policy决定Evidence是否足以注册正式candidate；
- Compiler Implementation Resolution把Result、Support、Target和Policy作为hard eligibility/optimization输入；
- Resolver不能把`not-run`、`unsupported`、`unknown`或stale Evidence解释为eligible；
- Result passed也不自动选择candidate，不能越过用户/组织constraints或其他hard conditions；
- candidate未被选择不使其conformance Result失效；Binding或环境变化则必须按invalidation rule失效。

### Benchmark Evidence

性能、内存、bundle、启动、构建、延迟或成本只有绑定：

```text
candidate / Binding revision
Target / Host / Toolchain / hardware
workload / dataset / corpus
warm-cold / cache / concurrency mode
sample count / distribution / outlier policy
measurement tool / method / uncertainty
expiry / invalidation
```

后才能参与`performance`等ResolutionPolicy。单次wall-clock、作者benchmark、不同机器对比或只选有利样本不能成为排名truth。

### Reference 与第三方 parity

Reference Provider和第三方Provider宣称满足同一Contract时，必须消费同一Target-independent conformance suite，再分别执行Target physical acceptance。Reference实现是oracle/fallback候选，不因由SEC维护而自动更可信；第三方实现也不因生态成熟而免除负向和供应链验证。

## Binding Delta 与 Compatibility Evidence

Verification不比较old/new Binding，也不签发Compatibility。固定关系是：

```text
validated old/new Binding
→ Delta/Impact owner produces ImplementationBindingDelta and Impact
→ Verification executes required conformance / behavior / package / runtime Claims
→ Change Management consumes Delta + Impact + Results
→ Compatibility Decision / Migration
```

Verification Claim可以绑定old Binding、new Binding或exact Delta item，证明：

- old/new Contract conformance；
- Adapter是否恢复旧timeout/retry/error/serialization/Effect语义；
- Target、dependency、native、install/build和package surface；
- consumer/runtime/behavior parity或明确差异；
- migration/rollback/compensation前置条件。

但Verification Result只证明该Claim，不得：

- 重新生成或修改`ImplementationBindingDelta`；
- 把测试绿解释为Delta为空或Behavior兼容；
- 把未运行/unsupported/partial结果解释为Compatibility；
- 选择Provider、Adapter或Migration路线；
- 用new implementation的自带tests单独授权自身Compatibility。

## Impact、Applicability 与选择

选择最小充分Verification的输入包括：

- canonical Entity/Fact/Responsibility、public contract和state writer；
- Source Program Model coverage和opaque/unknown frontier；
- Implementation Requirement、Candidate、Decision、Binding、`ImplementationBindingDelta`和Implementation Impact；
- Compatibility Decision/Migration obligations（已存在时）；
- Generator/Artifact和source ownership；
- Target Profile、Type/Behavior/Program IR和Backend；
- Host/Toolchain/Provider/platform capability；
- configuration/resource、Gate/test和release surface；
- Documentation/Agent/Workflow trust root；
- Support obligations。

已证明无影响的Gate可以合法not-run；可信key未变化且invalidation条件未触发的result可以reused；存在影响时运行最小充分闭包；unknown/unresolved阻止成功。

相对于当前 dependency/Impact model revision，执行集合固定为：

```text
Execute   = RequiredClosure ∩ MissingOrStale
Satisfied = RequiredClosure ∩ FreshPass
Failed    = RequiredClosure ∩ FreshFailure
Join      = RequiredClosure ∩ AuthenticatedInFlight
Blocked   = Unresolved ∪ UnknownPhysicalOutcome ∪ InvalidAuthority
```

Known unnecessary、fresh proof、same failure 与 authenticated in-flight 可以保证不重复；opaque/
dynamic frontier 无法证明无影响时只能扩大或阻塞，不能承诺超出当前 model 能力的“全知最小集”。

Semantic Impact、Implementation impact、repository/test impact、physical platform applicability、Compatibility和release impact是不同producer。它们可以组合，但不能互相冒充。

Full/Release是selector校准backstop。若Full发现affected漏选，缺陷属于relation/ownership/selector：必须登记漏边、补permanent regression并失效依赖旧selector的Evidence，而不是只把漏掉的测试永久塞进Full。

## Candidate、Epoch 与 Failure

```text
Authoring → Candidate → Frozen → Published/Merged → Readback
```

只有Frozen candidate content和冻结Binding可以签发最终Evidence。source/manifest semantics/profile、
Requirement/Candidate catalog/ResolutionPolicy/Binding/BindingDelta subject、required Gate、Claim
definition、Action subject closure或trust input变化，会产生新content/epoch或只失效其依赖
descendants。仅 exact Git head/transport变化总会失效CandidateScopeAttestation、Review、Session
revision和Promotion，但不得自动失效 ActionKey 未变的Evidence；最终 Aggregate仍必须重新绑定新的
exact generation。

Failure record至少包含：code、phase、Gate、owner、invariant、exact input、minimal reproduction、failure fingerprint、invalidated Evidence、cleanup state、next action和retry policy。

输入与failure fingerprint未变化时复用失败并停止；重复运行同一确定性失败不是进展。Transient retry必须绑定可观察因果变化，例如锁owner退出、网络/外部服务恢复、cache按authority重建或runner incident结束。

重复同类frozen invalidation要求proof reset，回到reproduction、owner、contract、fixture、Resolver、Delta comparator、Compatibility evaluator或test architecture；再次出现说明需要redesign，不能继续补丁循环。

## Hermetic Runtime

每个physical Gate的资源生命周期目标为：

```text
prepare → allocate → execute → terminate
→ cleanup → readback → receipt
```

资源先分类：immutable-copyable、rebuildable、identity-bound、process-bound、non-copyable-control-state、external-capability或unknown。Unknown默认拒绝复制、共享或并行。

Workspace、`.sec`子域、temp/cache、port、process group/Job Object、browser、database、environment、network、logs和residue都有唯一owner。复制workspace时identity-bound lease/journal/control state不能当普通目录复制；rebuildable cache也不能被发布成Evidence。

执行不受信Provider/package/install/build/test/runtime代码时，需要独立credential-free sandbox、bounded filesystem/network/process/resource和cleanup Evidence。普通临时目录、Node VM、browser context或静态lint不构成恶意代码sandbox。

Hermetic Runtime、resource allocator和cleanup receipt需要独立真实consumer驱动。现有测试有隔离行为不代表统一runtime已完成。

## 反馈与 Gate 层级

```text
focused failing sentinel
→ affected local closure
→ candidate pre-freeze
→ frozen hosted Quick / selected Risk
→ virtual merge / Release Full backstop
```

这不是每次都全跑的固定流水。普通编辑循环只运行会被后续修改自然失效的focused proof；browser、native、durable、package、Provider conformance和release Gate等candidate稳定后由selector运行一次。

不同变化类型使用最小充分门禁：pure validator、docs owner、trust root、Resolver、Delta/Impact、Compatibility、Provider、runtime/package和formatter的Evidence要求不同。统一重门禁会拖慢开发且不增加证明；统一轻门禁会假绿。

性能目标与正确性Gate分离。单次wall-clock只提供诊断；结构性工作量、固定环境的多样本基线和可重复回归才可形成性能裁决。

编排性能使用分离指标，不能把worktree和ref混成一个比率：

```text
MutableWorktreeAmplification = mutable worktrees / active logical runs
ActiveRefAmplification = active candidate refs / active logical runs
FindingSuccessorWorktreeCount
ActionExecutionAmplification = physical Action starts / unique required missing ActionKeys
```

前两项正常目标均为 `1.0`，finding successor worktree目标为 `0`，Action execution目标为
`1.0`。candidate generation数量只作诊断；同root cause反复frozen invalidation触发proof reset/
redesign，而不是禁止合法 finding generation。

## Evidence DAG 与 Run State

Evidence可以形成DAG：node引用inputs、Requirement/Gate contract、environment、producer、Result、artifacts和predecessors。相同未失效node可复用；failure node可复用为诊断但不能变PASS；组合旧baseline Evidence必须同时证明intervening diff coverage和delta validation。

Independent Review 不建立并列顶层 lifecycle state machine。Review request 是具有
`ReviewRequestActionKey`、provider effect、start/terminal observation 与 immutable receipt 的
external Verification Action；provider selection/availability与receipt freshness由各自pure resolver
计算。Review Action可以消费previous receipt、unchanged-byte proof、finding-fix delta 与
cross-boundary Impact以减少重复读取，但每个新 `ReviewSubjectId` 必须由独立principal签发新的
full-candidate exact-head ReviewReceipt。旧approved hunks与新delta不得由机器拼装成新批准。

Development Run State记录run/capsule/event/transition/resume；Verification Evidence记录proof。二者必须通过typed references连接，不能把Run Journal变成第二Verification Result，也不能把Evidence文件当作当前执行状态。

Session journal使用append-only hash chain和单调transition记录可恢复进度；所有外部副作用
必须有stable operation identity和provider readback receipt。journal与本机`wx` claim只能
帮助同一runner恢复，不能授予跨host mutation authority。普通resume只查询、join或重新
dispatch下一合法hosted transition；同一Action不重复spawn，同一Review head不重复请求，
同一hosted Gate不重复dispatch，同一authorization不重复merge，同一closeout operation不重复发布。

这些平台未完整实现时，分散日志、计划文档和聊天摘要不能被称为统一Ledger。

## Trusted Bootstrap

Verifier、selector、Resolver、Delta comparator、Compatibility evaluator、docs-doctor、Skill/Agent contract、Evidence validator、workflow和merge gate等trust-root candidate不能用自身新增规则自证。

Trusted base-side runner把candidate Git tree当不可信输入，在无凭据、只读source、独立writable root中运行旧authority下的回归和adversarial vectors。Bootstrap Evidence绑定trusted verifier revision、candidate tree、runner image、lock/dependency、platform、plan、output/cleanup digest。

Candidate自带测试只能作为补充，不能授予自身合并权或把自己的Resolution、Delta、Compatibility结果标为正确。Trust migration成功后必须从新main重新加载trust root；旧会话/Review/Evidence不能继续授权新epoch。

长期 trust root 分三层，且不建立第二 Verification pipeline：

- **Tier 0 Transition Root**：只拥有Git object/ref exact identity、CAS/readback、principal
  verification、canonical digest/schema primitives、old→new TCB closure comparison 与 transition
  receipt；
- **Tier 1 Evolvable Verification TCB**：selector、ActionKey/Evidence、Review validator、merge gate、
  docs/toolchain/provider policies；
- **Tier 2 Product**：普通产品与工程实现。

Tier 1变化由旧trusted owner计算affected trust closure，candidate nodes只作untrusted SUT，Tier 0
验证node receipts与完整new-TCB aggregate后签发`TrustEpochTransitionReceipt`；未受影响node可以
内容寻址复用。只有Tier 0自身变化才进入manual break-glass。selector、docs-doctor、Provider逻辑、
test-impact或merge policy不得逐步回流Tier 0形成bootstrap monster。

如果old-main generated closure lock已经落后于同一Git tree，base-first checker仍不得把它升级为
PASS，也不得因自身lock失配而形成不可恢复死锁。它只可在failure集合严格由每个既有module的
`blob + content digest`成对substitution以及唯一closure-digest差异构成时继续收集candidate SUT，
并固定输出`manual-bootstrap-required`；module增删、edge、loader、dispatcher、registry或任意未知
差异仍是hard failure。manual transition必须绑定exact base/head/tree、通过candidate lock纯检查、
独立exact-head Review与远端tree parity，且不得伪造ordinary Session/Review/Authorization receipt。

Git hook是执行上下文，不是hook安装生命周期入口。所有managed hook必须显式设置同一个active
marker；dependency bootstrap在该marker下即使首次物化依赖也不得递归安装hook。pre-push只执行
零写imports seal与TCB closure check；generated lock仍只能由显式apply writer更新。这样普通push
在进入provider前拦截causal-runtime/lock漂移，而break-glass仍保持独立、稀有且可审计。

## Property、Fault 与 Flake

- Pure property优先覆盖identity/revision/normalization/serialization、Fact/Binding Delta、Impact、Requirement/Candidate/Decision/Binding、Compatibility rule、state machine、fixed-point、deterministic ordering、tie-break和clean/incremental parity；
- Property失败要shrink并保存最小反例、seed、producer revision和replay入口；
- Physical fault遍历prepare/write/fsync/publication/terminal/cleanup/recovery等持久化边界；
- Windows、Linux、macOS、WSL和不同filesystem capability的Evidence不互相替代；
- Retry只收集flake Evidence；多次中一次绿不能改写失败；
- Quarantine必须有owner、expiry、替代coverage和退出条件；
- Mutation testing只用于高价值pure kernel/validator/authorization/eligibility/delta/compatibility/fail-closed/selector校准，不进入普通save loop。

开发控制面cutover的contract/fault corpus至少覆盖：same content/different commit得到相同
CandidateContentId但不同GenerationRef；两个writer对同expected-old ref只有一个CAS成功；在object、
tree、commit、ref publication、readback与worktree projection每个边界crash后可确定恢复；scope扩张
无法沿用旧ScopeGrant；旧Review不能授权新generation；ActionKey未变时fresh PASS/FAIL不重新执行；
start-without-terminal永久阻止同key replay；candidate projection失败不改变ActiveMainControlState；
provider epoch在prepare后、effect-start前失效时physical provider调用为零；merge response丢失后只
readback且不第二次调用effect。历史v2-v6 run必须可replay成一个run、一个mutable worktree、一个
active ref与多个immutable generations。

## Evidence 与 Provenance

- Artifact Provenance：文件或产物从哪里来；
- Fact Provenance：semantic assertion为什么成立；
- Verification Evidence：某个exact execution证明了什么；
- Runtime Observation：某个环境实际发生了什么；
- Provider/AI Evidence：带coverage、freshness和不确定性的候选解释；
- Resolution Evidence：Requirement、candidate、Eligibility、policy、measurement和淘汰原因的引用；
- Delta references：old/new endpoint、Comparator revision、Delta item和Impact witness；
- Compatibility Decision Evidence：规则、Delta、Result、环境与用户decision references。

Predicted Impact、planned selection、Eligibility、Resolution Decision、actual Delta、Compatibility Decision、executed Result、Aggregate和上层Decision是不同对象。它们之间必须有显式references，不能复制字段后当作同一事实。

## Merge Authority

Review-Stable Barrier 在expensive hosted Gate前必须terminal-clear，并在签发merge authorization
前重新读取。Review receipt绑定exact head/tree/scope/policy、独立principal stable identity、
reviewed commit、完整分页快照和thread/request-change digest；head不变但review、thread、policy
或pagination状态变化同样会使receipt stale。可信GitHub App的稳定app/node identity或独立
human exact-head APPROVED可以成为principal，显示名、PR summary、self-review或未绑定commit
的COMMENTED状态不能单独授权。

`PromotionId` 绑定exact CandidateGenerationRef、candidate tree、ScopeGrant/attestation、Action
closure/Aggregate、fresh exact-head ReviewReceipt、trust revision与expected live main。content ID
相同不能复用旧Promotion；任何exact transport、Review facts、Evidence aggregate或live-main变化都
必须重算。Promotion/Integration transaction吸收remote merge、tree parity、remote closeout、
local-main readback与leased cleanup；branch/worktree closeout只作为该transaction的physical Actions，
不建立第二完成状态机。

Merge前由 trusted workflow 中的 canonical merge-gate 唯一重算：current base/head/tree/manifest/profile、trusted scope、Action
closure、required Claims/Evidence、Review、unresolved blocking threads、REQUEST_CHANGES、
MainHealth、ruleset/trust revision、dependency、Binding、Delta/Compatibility requirements和
default-branch组合。任一unknown、分页不完整、drift或过期都fail closed。

只有该merge-gate满足全部条件后才可签发provenance-bound、single-use、bounded-expiry的
IntegrationAuthorization receipt；commit status、Check、PR body、journal terminal或管理员
身份本身都不是该receipt。签发与消费必须位于同一个trusted hosted integration operation和
repository/default-branch全局临界区内；serialized authorization JSON不能离开该边界后再由
本地CLI解释为mutation capability。该operation在effect前重新读取live facts，验证trusted
workflow/ref/run/artifact provenance、receipt未消费且完全匹配，使用expected-head squash merge，
不改写candidate，不使用`--admin`或其他authorization bypass。普通CLI只可proposal、dispatch、
join、status或导出已有projection，不能持有raw merge/branch/comment mutation port。

Integration effect owner是provider创建的exact repository/workflow/run/attempt identity和在effect
前durably publish/readback的marker，不是本地JSON、claim、lease、issue comment或wall clock。
只有当前invocation新建并精确读回marker时可以发布authorization receipt并尝试merge；PR仍OPEN时，
任何existing、expired、reused、ambiguous或conflicting marker都永久BLOCK第二次effect。issue
comment只是带exact non-null App/source-run provenance的receipt/readback，不能提供唯一性CAS。
remote marker成功后到physical merge前不得访问本地journal/cache；public GitHub adapter也只能
暴露typed observe/ensure transaction，raw comment/review-request/dispatch/merge ports保持私有。

全局integration group必须保留多个pending operation而不是以新pending静默替换旧请求。OPEN
lane在任何effect前要求current default仍等于Session base；若merge请求后runner崩溃，fresh host
从original trusted-base workflow、merged PR、exact authorization comment ID与merge marker进入
MERGED recovery lane，此时不再要求current default等于旧base，但必须证明该merge commit/tree
仍属于live default history且绝不第二次调用merge endpoint。

合并成功必须证明merged tree与verified candidate tree相等，随后以stable closeout operation
复用既有branch lifecycle的纯inventory、preparation与recovery primitives；VerificationSession
仍是唯一physical closeout owner。`branch-lifecycle`不得暴露finalize命令、mutation barrel、raw
runner/context、effect-start issuer、permit consumer或remote/local ref mutation API。未合并的
orphan、closed-unmerged与superseded分支只能产生只读审计、准备或BLOCKED结果，不能发布
integration closeout receipt，也不能执行remote/local mutation。

authorization与closeout publication都必须从GitHub全分页、可信
App/source-run provenance和byte-exact provider receipt恢复；本地operation store只可作cache。
closeout在branch mutation/POST前同样必须durably publish/readback一个stable pre-effect marker和
跨fresh-host byte-stable recovery bundle；只有该marker当前owner可执行一次。lost response、空的
暂时inventory或local claim不能许可第二次POST/delete；exact receipt存在则reuse，否则ambiguous
attempt永久BLOCK。重复finalize同一receipt不得重复发布、删除或产生新的语义receipt；
already-absent只在exact merge/authorization/operation、PR-recorded head/tree和live history已证明时
表示既有effect，而不是一次新的closeout事实。

所有门禁闭合时及时合并，不为表现“仍在开发”继续修改正确candidate。

Merge后必须从新 `main` 读取实际类型、行为、Decision/Binding、Delta/Compatibility、artifacts和支持面，关闭absorbed/superseded结构，归档Work Package，并完成可证明安全的branch/worktree/temporary workflow cleanup。信任根切换还必须重载new-main TCB/trust revision、拒绝旧Session/Review/Evidence/authorization，并由ordinary candidate canary证明新路径。PR body、历史branch、commit ancestry或旧Evidence不能替代readback。
