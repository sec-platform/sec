---
title: Verification、Evidence 与 CI 治理
status: stable
domain: verification-governance
last-reviewed: 2026-07-29
---

# Verification、Evidence 与 CI 治理

本文拥有不同验证层证明什么、Result/Gate/Evidence 的稳定身份边界、Impact 选择、失败复用、trust bootstrap 和 merge authority。具体测试文件、suite、command、timeout、并发、selector、当前 schema revision 与已实现 result states 由机器合同、runner、workflow 和最新 `main` 拥有。

## 状态层级

本文同时记录两类内容，必须显式区分：

- **当前强制不变量**：现有系统已经或必须立即遵守的禁止假绿、exact candidate、Gate owner、Evidence freshness、cleanup/readback 和 trust-root边界。
- **目标 Verification 架构**：Result truth、Execution Ledger、Evidence DAG、Run Journal、Hermetic Runtime、property/fault/flake 等独立能力；只有对应 TypeScript contract、producer、consumer、migration、tests 和 Work Package 进入 `main` 后才是已实现能力。

稳定设计被接受不等于实现完成。CLI、PR summary 或文档不得把目标状态名投影成当前 PASS。

## 验证层

- **Unit**：pure builder、selector、index、normalizer、formatter 和安全边界。
- **Contract**：公共 schema、CLI、package、CI、error、IR 和 inter-owner shape。
- **Integration**：Workspace pipeline、artifact flow、transaction 与跨 owner 集成。
- **E2E / slow**：真实 Git、filesystem durability、server、browser、native host、package 和发布路径。
- **Property / Model**：输入空间、幂等、round-trip、状态机、fixed-point、排序与反特化。
- **Fault / Recovery**：crash/persistence boundary、TOCTOU、rollback/recovery 和资源收口。
- **Mutation / Test-quality**：校准关键 validator、authorization、fail-closed 和 selector 解释是否真正被断言覆盖。

测试层由要证明的性质、真实副作用、状态冲突、资源和环境决定，不由目录名、一次 duration 或“看起来像集成”决定。真实 browser/server/native/durable acceptance 即使偶尔很快也仍属于相应 physical layer。

## 当前不可违反的不变量

- 未运行、缺失、skipped、超时、取消、平台不匹配、scope mismatch、stale、损坏或 candidate self-proof 都不是 PASS。
- 一项 Check 只证明它绑定的 exact candidate、profile、environment 和 input closure。
- 测试主体通过但 cleanup/readback/receipt 失败，整个 Gate 仍未通过。
- changed path、owner、required Gate 或 Evidence unresolved 时 fail closed。
- 失败不能通过删除测试、弱化 assertion、无边界增加 timeout、重复运行直到绿或把 unsupported 当 skipped 消除。
- verifier、selector、Evidence validator 或 merge authority 的 candidate 不能只用自身新实现授权自身。
- CI workflow 是 executor/adapter，不拥有第二套 Gate 定义、result truth 或 test inventory。
- Local cache、聊天、PR body、branch、commit ancestry 和人工 checkbox 不是 merge Evidence。

## Verification Result 目标合同

完整 Result truth 的目标状态为：

```text
passed | failed | not-run | unsupported | invalidated
```

并独立记录 `executed` 或 `reused`。该状态集合在目标 contract 的 builder、validator、ledger、CLI/Check projection 和迁移闭合前，不得被描述为当前已统一实现。

目标语义：

- `passed`：required execution或合法 reuse 对 exact input closure 证明成立；
- `failed`：已执行但断言、运行、cleanup 或证据完整性不满足；
- `not-run`：根据可信 applicability/Impact 证明无需执行，或尚未执行但不伪装结果；
- `unsupported`：执行环境/Provider缺少声明能力；是否阻断由上层 support/Gate contract决定；
- `invalidated`：过去结果因输入、环境、规则、coverage 或信任发生变化而失效。

Result 不能只保留一个 status string；必须携带 scope、basis、producer、execution/reuse、failure/unsupported reason、artifacts、cleanup 和 invalidation lineage。

## Gate identity 与 Execution Ledger

Gate 定义和一次运行实例分离：

- **Gate contract**：identity、revision、owner、applicability、inputs、capabilities、dependencies、command/runner、timeout policy、Evidence output 与 invalidation rules；
- **Execution record**：exact candidate/input revisions、runtime/OS/arch/filesystem、toolchain/provider/dependency authority、环境、开始/结束/cleanup、result、artifacts 和 receipt。

一次执行的唯一 key 只包含会改变证明语义的 input closure；branch 名、PR 编号、聊天、显示标题和 wall-clock 不能成为语义 key。CLI、PR summary、Checks、artifact manifest 和 dashboard 只投影同一 Result/Execution record。

目标 Execution Ledger 是机器真值；在它实现前，现有 CI evidence/contracts 继续保持唯一当前 authority，迁移必须逐 consumer 切换，禁止长期双写两个结果源。

## Impact 与 Applicability

选择最小充分验证的输入不只包括文件 import graph，还包括：

- canonical Entity/Fact、public contract 和 state writer；
- Generator/Artifact 与 source ownership；
- Target Profile、Type/Behavior/Program IR 与 Backend；
- Host/Toolchain/Provider/platform capability；
- configuration/resource、Gate/test 和 release surface；
- Documentation/Agent/Workflow trust root；
- unknown/dynamic/opaque frontier。

已证明无影响的 Gate 可以合法 not-run；可信 key 未变化且 invalidation 条件未触发的结果可以 reused；存在影响时运行最小充分闭包；unknown/unresolved 阻止成功。

Semantic Impact、repository changed-path test impact、physical platform applicability 和 release impact 是不同 producer。它们可以组合，但不能互相冒充。手工 impact 规则只保留机器无法从 import/ownership/contract推导的跨域或 physical invariant 边，并有 owner、tests 和 retirement plan。

Full/Release 是 selector 校准 backstop。若 Full 发现 affected 漏选，缺陷属于 selector/ownership graph：必须登记漏边、补 permanent regression，并失效依赖旧 selector 的 Evidence，而不是只把漏掉的产品测试加入 Full。

## Candidate、Epoch 与 Failure

```text
Authoring → Candidate → Frozen → Published/Merged → Readback
```

只有 Frozen candidate 可以签发最终 Evidence。任何 source/base/head/tree/manifest/profile、required Gate 或 trust input 变化都产生新 epoch 或使原 Evidence invalidated。

Failure record 至少包含：code、phase、Gate、owner、invariant、exact input、minimal reproduction、failure fingerprint、invalidated Evidence、cleanup state、next action 与 retry policy。

输入与 failure fingerprint 未变化时应复用失败并停止；重复运行同一确定性失败不是进展。Transient retry 必须绑定可观察因果变化，例如锁 owner退出、网络恢复、外部服务恢复、cache按权威重建或 runner incident 结束。

一次 candidate invalidation 后先收窄根因并 refreeze；重复同类失效应 proof reset，返回 reproduction、owner、contract 或 test architecture，而不是继续补丁循环。

## Hermetic Runtime 目标

每个 physical Gate 的资源生命周期目标为：

```text
prepare → allocate → execute → terminate
→ cleanup → readback → receipt
```

资源先分类：immutable-copyable、rebuildable、identity-bound、process-bound、non-copyable-control-state、external-capability 或 unknown。Unknown 默认拒绝复制、共享或并行。

Workspace、`.sec` 子域、temp/cache、port、process group/Job Object、browser、database、environment、network、logs 和 residue 都有唯一 owner。复制 workspace 时 identity-bound lease/journal/control state不能当普通目录复制；rebuildable cache也不能被发布成 Evidence。

Hermetic Runtime、resource allocator 和 cleanup receipt 需要独立实现包。现有 tests 有隔离行为不代表统一 runtime 已完成。

## 反馈与 Gate 层级

```text
focused failing sentinel
→ affected local closure
→ candidate pre-freeze
→ frozen hosted Quick / selected Risk
→ virtual merge / Release Full backstop
```

这不是每次都全跑的固定流水。普通编辑循环只运行会被后续修改自然失效的 focused proof；browser、native、durable、package 和 release Gate 等 candidate稳定后由 selector运行一次。

性能目标与正确性 Gate 分离。单次 wall-clock 只提供诊断；结构性工作量、固定环境的多样本基线和可重复回归才可形成性能裁决。不能通过扩大 timeout 或缓存偶然命中改变测试层级。

## Evidence DAG 与 Run Journal 目标

Evidence 可以形成 DAG：一个 node 引用 inputs、Gate contract、environment、producer、result、artifacts 和 predecessors。相同未失效 node可复用；失败 node可复用为诊断但不能变 PASS；组合旧 baseline Evidence 必须同时证明 intervening diff coverage 和 delta validation。

Run Journal 目标记录 candidate epoch、base/head/tree/manifest、Gate状态、failure fingerprint、已验证事实、禁止重查项、next action 和 resume preconditions。Context压缩、Agent切换和进程重启从外部 journal/repository事实重算，不从聊天恢复隐藏状态。

Evidence DAG/Run Journal尚未完整实现时，不能把分散日志或计划文档称为统一 ledger。

## Trusted Bootstrap

Verifier、selector、docs-doctor、Evidence validator、merge gate 等 trust-root candidate不能用自身新增规则自证。Trusted base-side runner把 candidate Git tree 当不可信输入，在无凭据、只读 source、独立 writable root中运行旧 authority下的回归与 adversarial vectors。

Bootstrap Evidence 绑定 trusted verifier revision、candidate tree、runner image、lock/dependency、platform、plan、output/cleanup digest。Candidate自带测试只能作为补充，不能授予自身合并权。

Workflow YAML只保留 permissions、checkout、最小调度和 artifact传递；计划、验证和聚合下沉为可单测模块。Aggregate merge gate只读取独立 Checks/Evidence，不重跑并重新解释所有 Gate。

## Property、Fault 与 Flake

- Pure property优先覆盖 identity/revision/normalization/serialization、Delta/Impact、state machine、fixed-point、deterministic ordering 和 clean/incremental parity。
- Property失败要 shrink并保存最小反例、seed、producer revision 与 replay入口。
- Physical fault遍历 prepare/write/fsync/publication/terminal/cleanup/recovery 等持久化边界。
- Windows、Linux、macOS、WSL和不同filesystem capability的Evidence不互相替代。
- Retry只收集flake Evidence；多次中一次绿不能改写失败。
- Quarantine必须有owner、expiry、替代coverage和退出条件，不能成为永久绿灯。
- Mutation testing只用于高价值 pure kernel/validator/authorization/fail-closed/selector校准，不进入普通 save loop。

## Evidence 与 Provenance

- Artifact Provenance：文件或产物从哪里来；
- Fact Provenance：semantic claim 为什么成立；
- Verification Evidence：某个 exact execution 证明了什么；
- Runtime Observation：某个环境实际发生了什么；
- Provider/AI Evidence：带coverage、freshness和不确定性的候选解释；
- Decision Evidence：为何选择、拒绝或推迟一个能力。

Predicted Impact、planned selection、actual Delta、executed Result 和 Verification safety conclusion 是不同对象。它们之间必须有显式 references，不能复制字段后当作同一事实。

## Merge Authority

Merge前由独立 owner重新计算：current base/head/tree/manifest/profile、changed scope、required Evidence、Review、unresolved threads、REQUEST_CHANGES、ruleset、dependency和default-branch组合。所有门禁闭合时及时合并，不为表现“仍在开发”继续修改正确 candidate。

Merge后必须从新 `main` 读取实际类型、行为、artifacts和支持面，关闭 absorbed/superseded结构，归档 Work Package，并完成可证明安全的 branch/worktree/temporary workflow cleanup。PR body、历史 branch、commit ancestry 或旧 Evidence 不能替代 readback。
