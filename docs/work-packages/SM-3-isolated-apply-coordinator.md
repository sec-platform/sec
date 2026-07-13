---
title: SM-3 隔离 Semantic Mutation Apply Coordinator 实施计划
status: active
last-reviewed: 2026-07-13
work-package: SM-3
tracking-issue: 106
---

# SM-3 隔离 Semantic Mutation Apply Coordinator 实施计划

本文是当前 SM-3 Work Package 的唯一执行编排文档，负责实现 DAG、代码所有权、并行边界、验证策略、故障矩阵、进度反馈和收口条件。

本文不重新定义产品阶段或 Semantic Mutation 协议：

- 当前阶段、进入/退出条件和唯一顺序以 `docs/03-MVP实施计划与路线图.md` 为准。
- Semantic Mutation 类型、digest、diagnostics、transaction、CAS、rollback 与 recovery 语义以 `docs/14-Engineering IR与语义事实规范.md` 第 18 节为准。
- Pipeline Pass 与恢复边界以 `docs/07-Pass状态机、错误码与恢复机制.md` 为准。
- Verification authority 以 `docs/08-验证、溯源与治理投影.md` 为准。
- 测试分层和证据复用以 `docs/test-feedback-and-ci-lanes.md` 为准。
- Issue #106 只跟踪状态和讨论，不复制或覆盖本文事实。

## 1. 当前事实与目标

SM-0、SM-1、SM-2 已完成。SM-2 已提供：

- Authoring Source 的真实 loaded provenance；
- 唯一 writable owner resolution；
- 固定 adapter 与 path boundary；
- deterministic source edit plan；
- before-byte CAS；
- rollback manifest metadata。

SM-2 没有提供：

- 跨进程 lease；
- controlled staging / backup；
- isolated canonical rebuild；
- actual Fact Delta / Impact；
- Verification execution；
- live Authoring Source publish；
- verified rollback；
- crash recovery journal；
- request replay / terminal query。

SM-3 的 architectural goal 是建立唯一 `applySemanticMutation()` 平台协调边界：

```text
acquire cross-process workspace mutation lease
→ reread trusted base and exact source bytes
→ re-preflight / re-prepare / re-plan under the lease
→ isolated edit and canonical rebuild
→ actual Fact Delta / Impact / Verification
→ final byte CAS and atomic publish
→ live canonical rebuild and exact staged/live reconciliation
→ accepted, CAS-safe rolled-back, or durable recovery-required
→ release lease
```

Planning 或 dry-run 永远不能写 live Authoring Source。AI、Workbench、CLI 等 consumer 在 SM-4 前不得接入 live apply。

## 2. 审计结论

### 2.1 Pipeline journal 不能承担 Mutation recovery

`platform/shared/pipeline-journal.ts` 记录编译 transaction 和 Pass 生命周期，具有进程内 mutation queue，并可在新 Pipeline transaction 开始时把旧 active transaction 标记为 interrupted。它不是：

- 跨进程 exclusive lease；
- durable single-writer request index；
- Authoring Source commit journal；
- rollback/replay authority；
- crash restart recovery state machine。

SM-3 不得把 Mutation lifecycle 塞入 Pipeline journal，也不得复制 Pipeline pass order。Mutation accepted 后必须读取现有 Pipeline registry，从 `resolve` 推导失效和 canonical rebuild。

### 2.2 通用 JSON 写入不构成 durable journal

普通 `writeJson()` 覆盖写不能证明：

- temp write 完成；
- file data 已 flush；
- atomic replace；
- containing directory durability；
- crash 后只出现 old 或 new 完整 record；
- unknown/corrupt record fail closed。

SM-3 应实现 mutation-specific durable IO substrate。除非独立架构审查证明出现真正共享合同，不扩张通用 `platform/shared/fs.ts`、`paths.ts` 或 `yaml.ts` 形成超出当前实现的承诺。

### 2.3 Storage、retention 与 replay 仍需具体冻结

`docs/14` 已冻结 lifecycle 语义，但 SM-3 开发前仍需冻结：

- `.sec` 下固定受控目录布局；
- lease、active transaction、backup、terminal index、quarantine/retention 的职责；
- journal format version 与 migration；
- terminal record retention；
- retained-result query contract；
- request ID replay 与 revision collision 行为。

这些具体值先进入 `docs/14`，再实现 IO；不得由代码路径偶然成为协议。

### 2.4 Verification planning 不等于 execution

现有 planning context 能表达 requirement/capability 和 isolated/runnable 状态，但 SM-3 仍缺 platform-owned execution adapter：

```text
VerificationRequirementV1
→ exact isolated runnable capability
→ execution
→ canonical report revision
→ SemanticMutationVerificationExecutionRefV2
```

Mutation 不拥有 selector 解释、Acceptance 执行、Pass 顺序或 Verification report schema。

### 2.5 当前缺少真实 apply/recovery slow vertical

SM-1/SM-2 的 focused、Contract Freeze 和既有 semantic vertical 证明 pure kernels/source adapter，但不能证明：

- 多进程 lease；
- live publish；
- crash restart；
- verified rollback；
- replay；
- 四种真实 terminal lifecycle。

SM-3 必须增加一个命名 slow vertical，而不是只扩充 pure unit tests。

### 2.6 开发过程必须可见

大型实现不得全部在本地完成和验证后才首次创建 PR。第一个可审查提交后建立 Draft PR，使 architecture、integration 和 evidence review 能在实现期间发现 blocker。Draft PR 不自动触发 hosted CI，也不改变 `main` 的工程事实。

## 3. 分支、所有权与禁止范围

正式实现分支：

```text
feat/semantic-mutation-apply-coordinator
```

当前只存在一条大型产品演进线，不创建 `integration/*`。

### 3.1 主实现线拥有

- mutation-specific lease；
- fixed transaction directory；
- atomic/durable record primitives；
- request replay index；
- isolated preparation/rebuild coordinator；
- Verification adapter 与 execution binding；
- publish、live rebuild、rollback、restart recovery；
- `applySemanticMutation()` public facade；
- focused、Contract Freeze、multi-process、crash/recovery 和 named slow vertical tests；
- `docs/14` 中仍未具体冻结的 storage/schema/retention/query contract；
- 本 Work Package 的 evidence 与退出审查记录。

### 3.2 默认禁止修改

- `platform/shared/pipeline-journal.ts`，不得让它拥有 Mutation lifecycle；
- 通用 `platform/shared/fs.ts`、`paths.ts`、`yaml.ts`，除非先证明共享合同；
- Fact Delta、Impact、Validated IR、Projection、Lock shape；
- semantic revision algorithm；
- Pipeline stage/pass order 或第二张 invalidation table；
- Workbench、CLI、API、AI、Repair、Upgrade 产品 consumer；
- official Registry contract；
- stable `engineering-ir.json` 或其他无关 stable artifact。

### 3.3 单写者与并行 reviewer

以下 canonical surface 保持单写者：

- public mutation types；
- journal state machine/schema；
- lease/replay contract；
- apply coordinator；
- digest/revision algorithm；
- `docs/14` 第 18 节；
- Contract Freeze registry。

可在同一 PR head 上并行只读：

- architecture reviewer：authority、state/data ownership、CAS、atomicity、recovery；
- verification-evidence reviewer：test ownership、selector、evidence freshness、rerun/invalidation；
- integration reviewer：assembled state、旁路、临时产物和退出条件。

只有 owned files、canonical symbols 和 authority 章节完全不重叠时，才把独立 docs/chore/test-infrastructure 修复提炼为单独正式 PR。

## 4. 优化后的实现 DAG

必须按 SM-3A → SM-3F 顺序推进。每个 reconciliation point 重新读取 latest `main`、PR head、authority、真实 diff 和有效 evidence。

### 4.1 SM-3A — Storage / lease / replay contract closure

先冻结、后实现：

- fixed controlled directory layout；
- lease token、owner identity、acquire/release protocol；
- owner liveness 与 definitely-stale 判定；
- ambiguous ownership 的 fail-closed 行为；
- heartbeat 是否存在及其 authority；
- journal format version、migration、unknown-version behavior；
- atomic replace / flush / directory durability boundary；
- terminal retention 与 query contract；
- transaction ID、request replay identity、request ID/revision collision。

不得只凭“锁文件超过固定时长”抢锁。实现必须能区分：

```text
active owner
| definitely stale owner
| ownership ambiguous
```

只有 definitely stale 且满足冻结 takeover contract 时才允许恢复接管；ambiguous 必须阻塞并产生稳定 diagnostic。

**退出条件**：上述值进入 canonical contract；没有 IO 实现先于合同；frozen review 无 ownership/replay blocker。

### 4.2 SM-3B — Mutation-specific durable substrate

实现：

- cross-process exclusive lease；
- controlled same-volume transaction directory；
- exact original byte/mode backup；
- atomic/durable recovery record transition；
- single-writer request index；
- restart scan 与 unresolved record blocking；
- corrupt/unknown state quarantine 或 fail-closed protocol。

最低 durable states：

```text
prepared
  → authoring-committed
      → verified
      → rolled-back
      → recovery-required
```

状态只能按冻结 transition 变化。任何 record transition 失败都不能在内存里假装成功。

**退出条件**：两个独立进程不能同时持有 lease；每个 durable write/crash point 后能确定读取 old 或 new 合法状态；未知、截断、冲突 record fail closed。

### 4.3 SM-3C — Isolated preparation and canonical evidence

取得 lease 后重新构造所有 trusted evidence：

```text
reread before semantic bundle and exact source bytes
→ preflightSemanticMutation()
→ source owner/path/edit plan
→ before-byte CAS
→ controlled isolated source edit
→ canonical resolve / Semantic Frontend / validated snapshot
→ buildFactDelta()
→ exact expectation and postconditions
→ buildImpactPropagation()
→ complete Verification requirement union
```

规则：

- 旧 preparation 或 plan 只能作为 caller CAS expectation，不能授权 live apply；
- apply 必须在 lease 内重新生成 preflight、preparation 和 plan；
- staging 不能写 live source；
- staged transaction ID 不能冒充 live apply transaction；
- earlier stage 失败后不调用 later producer；
- actual Delta/Impact 只能由 canonical producer 生成；
- isolated root 不能读取或写入 live control/artifact state形成旁路。

**退出条件**：相同 trusted input deterministic；stale base/source/plan fail closed；staged output 可被独立重建并与 plan exact 绑定。

### 4.4 SM-3D — Verification adapter and execution binding

建立 platform-owned adapter：

```text
complete canonical requirement union
→ resolve exact capabilities
→ require runnable && isolated
→ execute in staging
→ canonical Verification report
→ build execution ref
→ recompute execution revision
```

必须拒绝：

- missing capability；
- extra capability；
- duplicate target；
- non-runnable；
- non-isolated；
- partial requirement union；
- wrong planning/adapter revision；
- wrong plan revision；
- wrong attempted endpoint；
- wrong staged source digest；
- failed/blocked report；
- execution digest mismatch。

Verification policy 只能保守增加要求，不能删除 Impact、operation registry、Task Envelope 或 caller additional verification 的任一来源。

**退出条件**：publish 前已经获得 exact-bound `passed` execution ref；Mutation 未复制 Verification report schema或 pass order。

### 4.5 SM-3E — Publish / live rebuild / rollback / recovery

Publish 顺序：

```text
recheck live before-byte digest
→ persist authoring-commit intent
→ same-volume atomic single-file publish
→ persist authoring-committed state
→ canonical live rebuild from resolve
→ exact staged/live source digest + inputRevision + semanticRevision check
→ invalidate/rebuild downstream derivatives through existing Pipeline registry
→ persist verified terminal state
```

Rollback 顺序：

```text
recheck live digest == this transaction committed digest
→ restore exact original bytes/mode atomically
→ verify restored byte digest == before digest
→ canonical rebuild
→ verify base inputRevision + semanticRevision
→ persist rolled-back terminal state
```

进入 `recovery-required` 的最低条件：

- committed source 已被第三方改变；
- restore 写入失败；
- restored bytes/mode 不一致；
- restored canonical rebuild 不一致；
- live rebuild 无法完成；
- durable journal finalization 失败；
- ownership/replay 冲突无法安全裁决。

此时不得覆盖并发用户变化，不得返回普通 rejected，也不得开始下一 mutation。

**退出条件**：不存在 `partial-success`、`accepted-with-warning` 或 stale derivative 与新 source 同时 accepted 的状态。

### 4.6 SM-3F — Contract Freeze、纵切面与退出审查

新增 `semantic.mutation.apply` 或等价稳定 owner，覆盖真实生命周期；具体 contract ID 先冻结再注册。

新增一个命名 slow vertical，真实执行：

```text
Authoring Source
→ add-state-transition request
→ lease
→ isolated rebuild
→ actual Delta / Impact
→ isolated Verification
→ atomic publish
→ live rebuild
→ accepted result
```

同一纵切面或其专用故障 fixture 必须证明第二进程、replay、rollback 和 restart recovery。

**退出条件**：第 6 节 failure matrix 全部由 focused/contract/multi-process/slow vertical 的适当层级覆盖；frozen architecture、integration、evidence review 均无 blocker。

## 5. State、identity 与 atomicity 不变量

1. `(graphId, appId, requestId)` 是 retained record 范围内的 replay identity。
2. 同一 request ID 对应不同 request revision 必须 stable reject。
3. Exact replay 返回或恢复原 transaction/result，不重复执行 operation。
4. Lease owner、transaction ID、request identity 和 Pipeline compilation transaction 不得混为一个 ID。
5. Semantic revision CAS 不能替代 source byte CAS。
6. Publish 前所有不可安全隔离的 verifier都必须阻塞，而不是先写 source 再验证。
7. Rollback 只能在 live digest 仍等于本 transaction committed digest 时恢复。
8. Recovery record 是 governance state，不是 Engineering IR、Authoring Source 或第二 Pipeline journal。
9. Result、record 和 execution binding 的 canonical digest 不包含时间戳、absolute temp path、Error object 或 secret。
10. Terminal result 只有 `accepted`、`rejected`、`rolled-back`、`recovery-required`。

## 6. 最低故障矩阵

| Domain | 必须覆盖的情形 | 期望结果 |
| --- | --- | --- |
| Lease | concurrent acquire | 恰有一个 owner；另一方稳定 blocked/rejected |
| Lease | definitely stale owner | 按冻结 takeover/recovery contract 处理 |
| Lease | ambiguous owner | fail closed，不抢锁 |
| Journal | truncated/unknown version/corrupt record | fail closed 或进入冻结 quarantine/recovery 路径 |
| Replay | exact request replay | 返回/恢复原 transaction，不重复 mutation |
| Replay | same request ID, different revision | `SEMANTIC-MUTATION-001` |
| CAS | stale base/expected plan/before bytes | publish 前拒绝 |
| Staging | parse/resolve/frontend/validation failure | live source 未变化，rejected |
| Delta | producer failure | 保留 allowed evidence shape，rejected at fact-delta |
| Expectation | extra/missing Entity/Fact/Assertion drift | `SEMANTIC-MUTATION-009` |
| Impact | producer failure | nested Impact diagnostic，live source 未变化 |
| Verification | missing/extra/non-runnable/non-isolated/failed/blocked | publish 前 `SEMANTIC-MUTATION-010` |
| Publish | atomic replace failure | `SEMANTIC-MUTATION-011`，按实际 commit point裁决 rollback/recovery |
| Rebuild | staged/live mismatch | rollback 或 recovery-required，不 accepted |
| Rollback | committed-byte CAS still exact | exact restore + base rebuild → rolled-back |
| Rollback | concurrent third-party write | 不覆盖用户修改 → recovery-required |
| Rollback | restore/rebuild/finalization failure | `SEMANTIC-MUTATION-012` + recovery-required |
| Crash | each durable state boundary | restart 后确定继续 verify、rollback 或 recovery-required |
| Cleanup | terminal success/failure | 无临时 probe、staging、backup、fixture 或未解释 residue |

## 7. 验证与证据策略

### 7.1 每个 reconciliation point

按真实 diff 运行最小集合：

```text
focused unit / contract tests
changed-only imports
TypeScript typecheck
git diff --check / patch hygiene
```

测试结论必须记录：

- tested head/base；
- command/profile；
- scope；
- result；
- duration/raw evidence；
- invalidation rule。

### 7.2 Durable substrate 完成后

增加：

- independent-process lease tests；
- crash-safe record transition tests；
- request replay/index tests；
- corrupt/unknown state tests；
- cleanup/residue tests。

### 7.3 Verification adapter 完成后

增加：

- complete requirement union；
- capability exactness；
- isolated execution；
- report/execution binding；
- wrong plan/endpoint/source digest；
- failed/blocked/non-runnable cases。

### 7.4 Publish/recovery 完成后

集中执行同一 failure cluster：

- final CAS；
- atomic publish；
- live rebuild reconciliation；
- rollback；
- concurrent write；
- restart recovery；
- all terminal result invariants。

### 7.5 退出审查

根据 exact diff 至少运行：

```text
canonical test:affected
complete impacted Contract Freeze
named SM-3 apply/recovery slow vertical
selector-required slow suites
```

只有 producer、workspace/reference 或 CI contract 的真实 diff 失效相应证据时，才重跑 full-fast、其他 slow suites、ordered workspace/reference 或 hosted Actions。旧 baseline 只能作为“validated baseline + intervening diff impact + delta validation”组合证据，不能伪装成 exact-head success。

Draft PR 不自动触发 Actions。Root A0 仅在本地不能证明 required contract 或缺少必要平台证据时，显式使用 `run-quick` / `run-full` 一次。

## 8. PR 与进度反馈合同

第一个可审查提交后立即创建 Draft PR。PR body 持续维护：

```text
Current base/head
Active phase: contract | substrate | isolated evidence | verification | publish-recovery | exit review
Owned files / forbidden files
Acceptance completed / remaining
Latest tested head and valid evidence
Known blockers / invalidated evidence
Next reconciliation point
```

规则：

- PR body 是状态投影，不是 canonical architecture authority；
- reviewer 尽早报告具体 file/symbol/contract blocker；
- 不为“显示仍在开发”继续修改已经正确的代码；
- 不把一次测试失败直接变成局部补丁循环；重复问题升级检查 shared abstraction、state ownership、contract 和 test gate；
- 不机械合并并行分支；共享 seam 回到 Root 串行裁决。

## 9. Merge acceptance

只有同时满足以下条件才考虑进入 `main`：

1. 能力仍是有效正式产品变化，未被更新实现取代。
2. `docs/14`、实现、测试和结果状态机一致。
3. Exact base/head、merge-base、diff、冲突关系已理解。
4. 跨进程 lease、replay、crash recovery 和四种 terminal lifecycle Contract Freeze 通过。
5. Named slow vertical 通过。
6. Required focused/affected/risk evidence 有效；复用边界明确。
7. 无 unresolved review thread 或有效 `REQUEST_CHANGES`。
8. 无临时 probe、debug workflow、staging、backup、journal fixture、generated artifact drift 或 unexplained residue。
9. Workbench、CLI、AI 等 SM-4 consumer 未被提前接入。
10. Large noisy implementation history 经验证后优先 squash 为一个清晰主干变化。

## 10. 完成与文档生命周期

SM-3 合并后必须：

1. 重新读取新 `main`，确认产品结果真实进入主干。
2. 在 `docs/03` 记录 SM-3 退出审查并激活真实下一 Work Package。
3. 把仍属于长期协议的 storage/replay/recovery 事实保留在 `docs/14`。
4. 把测试/证据事实归位到测试文档和 evidence ledger。
5. 关闭 Issue/PR，清理已完成分支和临时工程入口。
6. 本文改为 `historical` 并移入 archive，或在全部长期事实已归位后删除；不得长期以 active 状态与新阶段竞争。
