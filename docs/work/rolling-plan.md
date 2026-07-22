---
title: SEC 滚动近期计划
status: active
last-reviewed: 2026-07-23
---

# SEC 滚动近期计划

本计划依据 `main@8aa2d2db8dd7541ddc05d9367a4070a73fa3f8a2`、open PR 为零、陈旧导航 Issue #132、最新main revalidation success、SM-4A candidate `bca9102` 的exact local evidence，以及TEST-H2 V1 head `528a780` 的canonical affected timeout整体重算。V1已证明browser bootstrap本身的focused合同，却同时证伪“isolated runtime snapshot无需进入本包”的架构假设：同一完整authority被临时`sources`对象身份切成多个snapshot bucket。V2 working-tree的structural-cache focused合同与real-cache pre-child sentinel现已通过，但候选尚未冻结、canonical affected尚未在新head运行，因此V1仍只被吸收而不构成完成。实时PR、CI与Review事实只由 `docs/work/current-state.yaml` 拥有。

本窗口只保留一个 active package 与五个有界候选。它不取代路线图、Engineering IR或测试authority，也不把计划、branch或单次诊断当成完成证据。

```text
TEST-H2 runtime browser cache + structural snapshot reuse V10 bootstrap V2 (active prerequisite)
└─→ SM-4A trusted authorization ingress replay
    └─→ SM-4A shared product adapter
        └─→ SM-4A CLI + Workbench transport vertical
            └─→ Blockless Semantic Source Ownership
Nexus Phase 0A exact-tree census (read-only candidate; no second active package)
```

## 当前唯一 Work Package

### test-runtime-browser-cache-v10-bootstrap-v2

- 工程结果：保留V1已经独立复审为GO的external Node 22+、project-local Playwright registry、physical containment、browser lock与pre-fanout bootstrap；新增runtime-plan structural snapshot key，使不同对象但完整authority相同的production probes共享一个有界slot/single flight。
- 根因：exact title在首次publish前执行两次plan与一次apply replan；每次canonical source resolver都创建新冻结对象，而现有WeakMap按对象身份分桶。每次cold capture要读取并hash 675.0 MiB browser tree与370.73 MiB dependency tree，V1 canonical affected在`300039.56ms`超时。迟到`SEMANTIC-MUTATION-010`来自同一已超时body；具体failed lane随临时artifact清理而不可恢复。
- Canonical seam：`project-runtime.ts`继续独占dependency/browser materialization；`semantic-mutation-isolated-runtime-plan.ts`独占snapshot structural key、slot bounds、capture/revalidation/materialization与launch proof。V2只修改该cache owner及其既有unit owner，不修改orchestrator、isolated child、Mutation合同、timeout、selector或process lifecycle。
- 风险：GitNexus将`getRuntimeSourceSnapshot`、`issueSemanticMutationIsolatedRuntimeCapability`与canonical sources resolver均评为HIGH。结构化复用必须每次执行现有root/directory/file identity revalidation；capture raw hash、destination hash manifest、reparse/hardlink拒绝与launch proof不能减少。browser materializer的HIGH/CRITICAL seams仍按V1审查结果冻结。
- 信任：本包修改verifier trust root，V1 revision/artifact从main的v9推进到v10，使用冻结本地evidence、独立架构/证据审查与人工bootstrap；候选不dispatch hosted Scope/Quick/Risk/Full/release自证。
- 退出：新增focused test已确定性证明distinct-but-equivalent sources只capture一次、结构key变化不复用、failed flight可恢复且cache总量有界；real-cache sentinel已证明三个fresh canonical wrappers只产生1 capture + 2 revalidations，并完成materialize/launch且不进入child。V1三个exact-head focused batch只在输入未变时复用。下一步冻结新head并只运行一次完整canonical affected；V1失败aggregate与任何exact-title结果不能组合为PASS，affected通过后才运行唯一Risk与剩余静态/文档/ownership Gate。

## 候选 Work Package

### 1. sm4a-trusted-authorization-ingress-v1

- 状态：`bca9102` / base `8aa2d2d` 已冻结并暂停；不是`main`事实。
- 下一步：TEST-H2合并后从新`main`重放十路径产品/测试/文档delta，重新冻结base、v10 manifest与全部失效evidence；旧失败aggregate、污染sentinel与v9证据不改名复用。
- 退出：trusted-local policy draft只经现有authorization revision与SM-2 registry authority生成canonical authorization；不接transport或修改Mutation合同。

### 2. sm4a-shared-product-adapter-v1

- 产品结果：一个platform-owned adapter统一raw DTO validation、trusted policy、plan/apply/query/recover调用与产品结果投影。
- 依赖：trusted authorization ingress先进入`main`；request/plan/result、source resolver、Verification、lease与journal保持既有owner。
- 退出：同一workspace/request/policy生成稳定binding；plan无写入，apply强制expected plan，四类terminal lifecycle可区分。

### 3. sm4a-cli-workbench-transport-vertical-v1

- 产品结果：CLI与Workbench State View/API作为薄transport shell消费同一个shared adapter，闭合真实`add-state-transition` vertical。
- 依赖：shared adapter contract已冻结；HTTP mutating boundary先冻结loopback + strict Origin或等价capability。
- 风险：禁止wildcard CORS、path/source/stack泄露、第二DTO/revision owner或提前实现SM-4B/SM-4C。

### 4. nexus-phase-0a-exact-tree-census

- 产品结果：对已绑定Nexus tree形成全量path/EPR/Skills与机制决策inventory。
- 执行：只读采集可辅助；ledger写入、owner裁决与路线重算仍由A0串行，不能成为第二active package。
- 退出：unclassified/undecided为零且manifest digest确定；仍不宣称Parity或Retirement完成。

### 5. blockless-semantic-source-ownership-v1

- 产品结果：App/source-module-owned Semantic Contract不依赖Block许可证进入Frontend → IR → Projection，并保持唯一writable owner。
- 依赖：SM-4A真实consumer进入`main`后冻结migration contract。
- 风险：禁止loader临时union、第二identity authority、破坏CAS/Registry provenance或让unlisted mirror获得authority。

## 单写者、证据与重算

- 正式active package始终只有一个；runtime dependency、CI revision、authorization、source owner、adapter与transport boundary按DAG串行冻结。
- 每个Gate只有一个`gate_owner`；相同`gate_key + tested head + profile`的有效结果必须复用，失败aggregate不由精确重跑改名。
- Merge/close、相关`main`变化、新CI/Review blocker、architecture反证、candidate被替代、Nexus新前置或Goal变化后整体重算，并删除失效候选而非增长永久Backlog。
