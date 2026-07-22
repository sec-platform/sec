---
title: SEC 滚动近期计划
status: active
last-reviewed: 2026-07-22
---

# SEC 滚动近期计划

本计划基于 `sec-platform/sec@ea8d1287dd6d41ed84d198904a55906a345907ec`、开放 Draft PR #133、Issue #132、B3 merge/CI/Review closeout、exact-main dependency/GitNexus evidence，以及仍未变化的 `QzCrane/nexus@e75caa28dcbc1ffa6e893b5539f85c8177346cd3` 重算。PR #133 的旧 base/head、v6 manifest digest、Scope 与 Quick evidence全部失效。本窗口只覆盖当前包和五个候选，不证明任何候选完成，也不取代 `docs/03-MVP实施计划与路线图.md` 的里程碑 authority。

```text
Phase 0 Current Reality Rebase (active)
├─→ IR canonical primitives import-cycle removal
│   └─→ SM-4A Workbench/CLI minimum product loop
│       └─→ Blockless Source Ownership
│           └─→ TS Target Profile
└─→ Nexus Phase 0A exact-tree census (read-only auxiliary lane)
```

## 当前唯一 Work Package

### phase-0-current-reality-rebase-v1

- 产品结果：把长期 Goal 的仓库投影、产品/路线 authority reconciliation、SEC-TS / Engineering Workspace / Brownfield / Nexus canonical 规划 owner，以及切换到 Phase 0 的三个控制面作为一个 docs-only closure 落入 `main`。
- 根因：B3 已建立控制面和 v8 active-documentation contract，但 `main` 的 README/路线图仍把已完成的 Engineering IR、SM-0～SM-3 与未来 Workbench、Task Envelope、AI 混成一个 next；控制面仍指向已合并的 B3，长期 Goal mirror和四个规划 owner仍未进入 `main`。
- 依赖：B3 squash tree 已进入新 `main`；PR #133 必须在该 exact base 上重放为唯一 single-parent commit，并改绑 `ci-verification-v8`、新 manifest bytes/digest和 path ownership。
- Owner：A0；18 个 manifest-owned 文档/治理路径。`docs/04` lifecycle delta已由B3吸收，不再制造同内容修改；`current-state` 只记录 observed facts，`rolling-plan` 只记录本窗口，active selector只保存 Phase 0 manifest path + digest，完整 envelope仍由 frozen manifest独占。
- 风险：把计划当完成事实；把 Goal/Roadmap/Issue/current-state变成竞争 authority；误称 Nexus Census/Parity完成；或为解决旧 Quick selector问题重新修改已由 B3进入 `main` 的 CI trust root。
- 退出：candidate parent恰为 `ea8d1287...`，18/18 path ownership、strict YAML、docs doctor、patch whitespace和GitNexus compare通过；PR body locator唯一；各一次 hosted Scope和Quick绑定 exact head/base/digest/v8；Review/threads/REQUEST_CHANGES为零且 `sec/merge-gate`通过后立即合并。
- 预计验证：`phase0/yaml-strict`、`phase0/manifest-scope`、一次 `docs:doctor` local preflight、exact diff whitespace、GitNexus compare、一次 `sec-scope-attest-v1`、一次 `ci-v8/quick` 和 base-side merge gate。旧 run `29900753057` / `29900819819` 不复用。
- 重算：manifest/head/base/Goal revision、PR/Review/CI、SEC/Nexus main或18-path ownership任一变化即整体重算。

## 候选 Work Package

### 1. ir-canonical-primitives-cycle-removal-v1

- 产品结果：消除 `ir-identity.ts → ir-revision.ts → ir-identity.ts` 唯一依赖环，同时保持全部 Engineering IR、Fact Delta、Impact 与 Semantic Mutation identity/revision/digest vectors byte-identical。
- 根因：`ir-revision.ts` 为 generator revision调用 `normalizedArtifactTarget()`，`ir-identity.ts` 又为 semantic contract owner identity反向调用 `digest()`；exact `eb48eb35` dependency Gate以唯一 `no-circular` error失败。B3 的34-path diff不触及 `platform/compiler/ir/**`，所以该 blocker在 `ea8d1287` 上仍成立。
- 依赖：Phase 0合并；`docs/14` payload、diagnostic、canonical ordering和Contract Freeze不变。
- Canonical seam：把 digest与artifact-target normalization下沉到不依赖 identity/revision builder的低层 pure owner；`ir-identity` 与 `ir-revision` 单向消费它。旧 export只有在全部 consumer迁移并通过byte parity后才能退役或成为无逻辑re-export。
- Owner：一个 canonical primitive module、`ir-identity.ts`、`ir-revision.ts`及最小 identity/revision contract tests；禁止同时改schema、operation registry、Pipeline order、Workbench/CLI或CI trust root。
- 风险：`digest` CRITICAL（96 upstream、11 direct、11 processes），`normalizedArtifactTarget` HIGH（8 upstream、4 direct、1 process）；只能串行单写者迁移。
- 退出/验证：dependency-cruiser零环；既有vectors byte parity；Engineering IR/Fact Delta/Impact/Mutation focused Contract Freeze、typecheck、changed-only imports和exact GitNexus compare通过。
- 重算：任何 public payload/revision/digest变化、第二依赖环或超出primitive seam都停止并重冻迁移合同。

### 2. sm4a-workbench-cli-minimum-v2

- 产品结果：本地用户通过同一个 trusted adapter在CLI与Workbench中 plan/apply/query/recover唯一的 `add-state-transition`，并获得 canonical source owner、actual Delta、Impact、Verification与terminal result。
- 根因：SM-3 transaction已进入 `main`，但Workbench仍写legacy opaque graph-action，CLI仍进入legacy View Mutation链；产品层缺少不复制authorization/path/revision算法的public ingress。
- 依赖：IR cycle removal合并；先由Mutation/Compiler owner冻结 additive trusted-policy-draft → normalized authorization ingress，再接薄产品adapter。
- Owner：Mutation ingress独占normalized allowed sets/authorization revision；SM-1独占request/plan/result revision；SM-2独占owner token/path policy；product adapter只拥有transport DTO、trusted local policy draft和错误/结果投影；CLI/HTTP只是薄壳。
- 风险：复制canonical allowlist、path或revision；当前mutating HTTP wildcard CORS；形成Workbench → Pipeline → legacy Workbench环；把SM-4B Task Envelope v2或SM-4C AI塞入本包。
- 退出/验证：同proposal/policy的CLI与Workbench plan revision一致；plan不写live source；apply强制expected plan；accepted vertical与四类terminal lifecycle可区分；HTTP正负/安全、CLI全生命周期、existing Mutation/Workbench、Contract Freeze、affected/typecheck/imports通过。
- 重算：若authorization ingress需要改变 `docs/14` §18、SM-2 owner/path semantics、全局server authority或Pipeline/Verification/writer lease，则停止扩写。

### 3. nexus-phase-0a-exact-tree-census

- 产品结果：对 exact Nexus committed tree形成1,439/1,439 path inventory、entrypoint/authority/public surface inventory、EPR 29/29、Skills 11/11和每个mechanism的唯一决策。
- 根因：当前只有Goal清单和seed ledger，Census/Parity/retirement均未完成；变化中的Nexus worktree不能作为authority。
- 依赖：Phase 0先落地 canonical ledger/report owner；采集可只读辅助，任何ledger写入与机制裁决由A0串行reconcile，不能成为第二正式active package。
- Owner：`docs/governance/nexus-absorption-*`；输入固定为 `e75caa28...` / tree `3a8ad6be...`，覆盖根目录34 paths与 `nexus/` 1,405 paths。
- 风险：抽样冒充全量、漏root/remote-site、使用working tree、把project特例写入SEC Core或把decision当parity。
- 退出/验证：tracked path、entrypoint、generated owner、EPR、Skill决策覆盖100%，unclassified/undecided为0；deterministic manifest digest与ledger schema/static checks通过；仍明确不宣称Parity/Retirement完成。
- 重算：Nexus `main`变化时只做exact-tree delta census；任何新前置条件反馈到下一次rolling-plan重算。

### 4. blockless-semantic-source-ownership-v1

- 产品结果：App-owned或source-module-owned Semantic Contract不依赖Block许可证即可进入Frontend → IR → Projection，并保持唯一 writable owner。
- 根因：当前source owner/index仍把Block provenance当成语义存在前提。
- 依赖：SM-4A合并后的真实consumer；先冻结兼容migration contract。
- Canonical seam/Owner：一个 `SemanticSourceOwner` type/normalizer/revision owner串行迁移loaded-source provenance、IR input/builder identity与Mutation resolver；Registry保持read-only。不得只给loader加union而保留第二identity authority。
- 风险：破坏source identity/revision、CAS/Registry provenance或允许unlisted mirror获得authority。
- 退出/验证：standalone identity稳定、Block bytes兼容、unlisted mirror仍拒绝、old block-derived owner不再是存在前提；loader/provenance negative、IR revision freeze、source-adapter CAS与Mutation plan/apply通过。
- 重算：identity或semantic revision无法兼容时先停止并冻结迁移，不并行实现loader与builder两个owner。

### 5. ts-target-profile-kernel-v1

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
