---
title: SEC 滚动近期计划
status: active
last-reviewed: 2026-07-22
---

# SEC 滚动近期计划

本计划在 Phase 0 / PR #133 squash merge 后，依据 `sec-platform/sec@313e2391d7017c23a510d56d28eaa82bba6614dd`、当前无开放 PR、Issue #132、Phase 0 exact CI/Review/merge closeout、exact-main dependency-cruiser、fresh GitNexus impact，以及仍未变化的 `QzCrane/nexus@e75caa28dcbc1ffa6e893b5539f85c8177346cd3` 重新计算。Phase 0 已由 `main` 与其成功 evidence证明进入仓库；其分支、PR和计划不再作为 active。本窗口只覆盖当前包和四个候选，不证明当前包或候选完成，也不取代 `docs/03-MVP实施计划与路线图.md` 的里程碑 authority。

```text
IR canonical primitives import-cycle removal (active)
├─→ SM-4A Workbench/CLI minimum product loop
│   └─→ Blockless Source Ownership
│       └─→ TS Target Profile
└─→ Nexus Phase 0A exact-tree census (read-only auxiliary lane)
```

## 当前唯一 Work Package

### ir-canonical-primitives-cycle-removal-v1

- 产品结果：消除 `ir-identity.ts → ir-revision.ts → ir-identity.ts` 唯一依赖环，同时保持全部 Engineering IR、Fact Delta、Impact 与 Semantic Mutation identity/revision/digest vectors byte-identical。
- 根因：`ir-revision.ts` 为 generator revision调用 `normalizedArtifactTarget()`，`ir-identity.ts` 又为 semantic contract owner identity反向调用 `digest()`；exact `main@313e2391` dependency Gate只因该 `no-circular` error失败。
- 依赖：Phase 0已合并；`docs/14` payload、diagnostic、canonical ordering、public facade与Contract Freeze registry保持不变。旧 revision producer evidence失效，但full-fast、slow、workspace/reference与SM-3 runtime evidence可复用。
- Canonical seam：把 digest与artifact-target normalization下沉到不依赖 identity/revision builder的内部 pure leaf；两个旧模块直接单向消费leaf并从原路径无逻辑re-export。任何现有外部consumer都不迁移。
- Owner：A0串行单写者；新 leaf、`ir-identity.ts`、`ir-revision.ts`、一个既有 known-answer test owner，以及本包manifest/路线图/三个控制面共9个exact paths。
- 风险：production图中 `digest` CRITICAL（96 upstream、11 direct、11 processes），`normalizedArtifactTarget` HIGH（8 upstream、4 direct、1 process）；禁止顺手统一其他SHA/path domain或修改payload/schema/order/diagnostic。
- 退出/验证：base-derived固定digest/path/artifact/revision/full-IR bytes parity；dependency-cruiser零环；一次canonical affected与完整Contract Freeze；typecheck、changed-only imports、docs/scope/patch和exact GitNexus compare通过；再以frozen exact head执行一次hosted Quick并完成Review/merge-gate。
- 重算：任何vector drift、public contract变化、第二依赖环、外部consumer迁移、selector/Freeze/CI revision变化或非owned path漂移都立即停止并重冻。

## 候选 Work Package

### 1. sm4a-workbench-cli-minimum-v2

- 产品结果：本地用户通过同一个 trusted adapter在CLI与Workbench中 plan/apply/query/recover唯一的 `add-state-transition`，并获得 canonical source owner、actual Delta、Impact、Verification与terminal result。
- 根因：SM-3 transaction已进入 `main`，但Workbench仍写legacy opaque graph-action，CLI仍进入legacy View Mutation链；产品层缺少不复制authorization/path/revision算法的public ingress。
- 依赖：IR cycle removal合并；先由Mutation/Compiler owner冻结 additive trusted-policy-draft → normalized authorization ingress，再接薄产品adapter。
- Owner：Mutation ingress独占normalized allowed sets/authorization revision；SM-1独占request/plan/result revision；SM-2独占owner token/path policy；product adapter只拥有transport DTO、trusted local policy draft和错误/结果投影；CLI/HTTP只是薄壳。
- 风险：复制canonical allowlist、path或revision；当前mutating HTTP wildcard CORS；形成Workbench → Pipeline → legacy Workbench环；把SM-4B Task Envelope v2或SM-4C AI塞入本包。
- 退出/验证：同proposal/policy的CLI与Workbench plan revision一致；plan不写live source；apply强制expected plan；accepted vertical与四类terminal lifecycle可区分；HTTP正负/安全、CLI全生命周期、existing Mutation/Workbench、Contract Freeze、affected/typecheck/imports通过。
- 重算：若authorization ingress需要改变 `docs/14` §18、SM-2 owner/path semantics、全局server authority或Pipeline/Verification/writer lease，则停止扩写。

### 2. nexus-phase-0a-exact-tree-census

- 产品结果：对 exact Nexus committed tree形成1,439/1,439 path inventory、entrypoint/authority/public surface inventory、EPR 29/29、Skills 11/11和每个mechanism的唯一决策。
- 根因：当前只有Goal清单和seed ledger，Census/Parity/retirement均未完成；变化中的Nexus worktree不能作为authority。
- 依赖：Phase 0先落地 canonical ledger/report owner；采集可只读辅助，任何ledger写入与机制裁决由A0串行reconcile，不能成为第二正式active package。
- Owner：`docs/governance/nexus-absorption-*`；输入固定为 `e75caa28...` / tree `3a8ad6be...`，覆盖根目录34 paths与 `nexus/` 1,405 paths。
- 风险：抽样冒充全量、漏root/remote-site、使用working tree、把project特例写入SEC Core或把decision当parity。
- 退出/验证：tracked path、entrypoint、generated owner、EPR、Skill决策覆盖100%，unclassified/undecided为0；deterministic manifest digest与ledger schema/static checks通过；仍明确不宣称Parity/Retirement完成。
- 重算：Nexus `main`变化时只做exact-tree delta census；任何新前置条件反馈到下一次rolling-plan重算。

### 3. blockless-semantic-source-ownership-v1

- 产品结果：App-owned或source-module-owned Semantic Contract不依赖Block许可证即可进入Frontend → IR → Projection，并保持唯一 writable owner。
- 根因：当前source owner/index仍把Block provenance当成语义存在前提。
- 依赖：SM-4A合并后的真实consumer；先冻结兼容migration contract。
- Canonical seam/Owner：一个 `SemanticSourceOwner` type/normalizer/revision owner串行迁移loaded-source provenance、IR input/builder identity与Mutation resolver；Registry保持read-only。不得只给loader加union而保留第二identity authority。
- 风险：破坏source identity/revision、CAS/Registry provenance或允许unlisted mirror获得authority。
- 退出/验证：standalone identity稳定、Block bytes兼容、unlisted mirror仍拒绝、old block-derived owner不再是存在前提；loader/provenance negative、IR revision freeze、source-adapter CAS与Mutation plan/apply通过。
- 重算：identity或semantic revision无法兼容时先停止并冻结迁移，不并行实现loader与builder两个owner。

### 4. ts-target-profile-kernel-v1

- 产品结果：以结构化Target Profile替代单字符串stack，固定language/runtime/module/delivery/persistence/database/UI/verification/deployment的validated identity与revision。
- 根因：目标能力散落于manifest/template/runtime分支，后续IR没有唯一canonical target boundary。
- 依赖：Blockless Source Ownership合并后，从新 `main` inventory现有Plan/Lock `app.stack`、Registry `stackProfiles`、`SUPPORTED_STACK`及所有consumer。
- Owner：Target Profile types、validator、compatibility registry、revision builder与public facade；旧stack string只允许有界import/migration projection。
- 风险：与Plan/Lock/Registry形成第二authority，或把Nexus/Bun/SPECTRA业务值写进Core。
- 退出/验证：deterministic validated profile、invalid-combination diagnostics、deep freeze/digest；现有producer/consumer都有migrate/retain/retire决策；主链只剩一个target revision；unit/property/negative、compatibility、compile boundary与Contract Freeze通过。
- 重算：只有该包合并并重新审计Engineering semantic type serialization/revision seam后，Type Algebra/Application IR才进入下一滚动窗口。

## 并行、单写者与重算

- 正式 active package始终只有一个；canonical revision、identity、source owner、operation registry、authorization、IR validator和lowering registry保持单写者。
- Nexus exact-tree数据采集可以只读辅助；ledger落盘和owner裁决串行。
- 合并/关闭PR、相关 `main` 变化、新CI/Review blocker、架构假设反证、实现supersede、Nexus Census新前置条件或长期Goal更新后，按 `docs/04-AI自主实现执行蓝图.md` 第1.2节整体重算；删除失效项，不追加永久backlog。
