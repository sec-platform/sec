---
title: Verification、Evidence 与 CI 治理
status: stable
domain: verification-governance
last-reviewed: 2026-07-29
---

# Verification、Evidence 与 CI 治理

本文拥有不同验证层证明什么、Verification Result语义、Gate/Evidence身份、Impact选择、复用和merge authority。具体测试文件、suite、command、timeout、并发和selector由机器合同、runner和workflow拥有。

## 验证层

- Unit：pure builder、selector、index、formatter和安全边界。
- Contract：公共schema、CLI、package、CI、error和IR shape。
- Integration：Workspace pipeline、artifact flow和跨owner集成。
- E2E/slow：真实Git、filesystem durability、server、browser、native host和发布路径。
- Property/Model：输入空间、幂等、round-trip、状态机、fixed-point与反特化。
- Fault/Mutation：crash boundary、恢复、测试断言有效性与flake治理。

测试层由实际副作用、状态冲突和证明对象决定，不由文件名或一次duration决定。

## Verification Result

唯一结果状态为：

```text
passed | failed | not-run | unsupported | invalidated
```

结果还必须区分`executed`和`reused`。Skipped、timeout、平台不匹配、scope mismatch、stale、candidate自证或影响未知都不是passed。

Execution ledger绑定Gate owner、exact input/revision、runtime/OS/arch/filesystem/capability、command/env、dependency/toolchain/provider authority、artifact与结果。CLI、PR summary、Check和artifact只投影同一ledger。

## Impact与Applicability

已证明无影响的Gate可以`not-run`；可信key未变化的结果可以`reused`；存在影响时运行最小充分闭包；unknown/unresolved形成frontier并阻止成功。

Impact Graph至少覆盖：source/import/export、public contract、state writer、generator/artifact、Target Profile、Provider capability、platform、Gate/test与release surface。手工声明只保留机器无法推导的physical/invariant边，禁止长期V1/V2双写。

Full/Release是selector校准backstop。若Full发现affected漏选，必须登记selector failure、补图边并失效依赖旧selector的Evidence，而不是只修产品测试。

## Epoch与Failure

```text
Authoring → Candidate → Frozen
```

只有Frozen可签发merge Evidence。Failure record至少包含：code、phase、gate、owner、invariant、exact revision、minimal reproduction、invalidated Evidence、next action和retry policy。

输入与failure tail未变时复用失败并停止。Transient retry必须绑定锁owner结束、cache修复、network恢复等具体因果输入变化。昂贵proof只在candidate稳定后运行。

## Hermetic Runtime

测试资源遵循：

```text
prepare → allocate → execute → terminate → cleanup → readback → receipt
```

Fixture分类为immutable-copyable、rebuildable、identity-bound、process-bound、non-copyable-control-state或external-capability。Unknown默认拒绝复制/并行复用。

Workspace、`.sec`、temp/cache、port、process group/Job Object、browser、database、env、logs和residue都有owner。Cleanup/readback失败使Gate failed/invalidated，即使产品断言已通过。

## Gate与反馈

```text
focused edit sentinel
→ affected local closure
→ Candidate pre-freeze
→ Frozen hosted Quick / selected Risk
→ virtual merge / Release Full backstop
```

这不是每次都全跑的固定流水。Browser、native、durable和release Gate不进入普通编辑循环。开发反馈服务只消费Result、Impact、Compiler Graph、Epoch、Hermetic Runtime和Evidence，不建立第二语义。

## Evidence DAG与Run Journal

Evidence node key只绑定真实input closure、environment、contract/toolchain/provider revision。Branch名、PR编号、聊天和wall-clock不能成为语义key。

相同未失效节点复用；失败可复用为diagnostic但不能变PASS。Local cache不是merge authority，共享写入必须来自trusted producer。Run Journal保存epoch、base/head/tree/manifest、Gate状态、failure fingerprint、已验证事实、禁止重查项、next action和resume preconditions。

Context压缩、Agent切换和进程重启从Journal恢复，不从聊天猜测。

## Trusted Bootstrap

Candidate verifier不能自证trust-root修改。Trusted base-side runner把candidate Git tree当不可信输入，在无凭据、只读source、隔离writable root中执行回归。Evidence绑定trusted verifier SHA、candidate tree、runner image、lock、platform、plan和output digest。

Workflow YAML只保留permissions、checkout、最小调度和artifact；计划/校验下沉到可单测模块。Aggregate merge gate只聚合独立Checks。

## Property、Fault与Flake

Pure property优先覆盖identity/revision/normalization/serialization、Delta/Impact、state machine、fixed-point和clean/incremental parity。失败必须shrink并保存最小反例与seed。

Physical fault遍历transaction/journal/publication/recovery每个持久化边界。Windows与Linux物理Evidence互不替代。Retry只收集flake证据，不能把失败改写为PASS；长期quarantine不是解决方案。

Mutation testing只用于pure kernel、validator、authorization、fail-closed和result/selector解释的校准，不进入普通save循环。

## Evidence与Provenance

- Artifact Provenance：文件/产物从哪里来。
- Fact Provenance：语义claim为什么成立。
- CI Evidence：某个exact execution证明了什么。
- Runtime Observation：某一环境发生了什么。
- AI Inference：带来源和不确定性的候选解释。

旧Evidence只有在baseline、intervening diff、coverage和invalidation rule全部成立时复用。Predicted Impact、planned selection、actual Delta和Verification safety是不同对象。

## Merge Authority

Merge前独立重算scope、required Evidence、Review、thread resolution、ruleset和default-branch组合。满足时及时合并；不为表现仍在开发继续修改正确candidate。

Merge后读取新`main`的实现、合同和产物，关闭absorbed/superseded结构并清理branch/worktree。PR body、历史branch或原commit ancestry不能替代readback。
