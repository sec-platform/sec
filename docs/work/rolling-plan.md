---
title: SEC 滚动近期计划
status: active
last-reviewed: 2026-07-23
---

# SEC 滚动近期计划

本计划依据最新正式工程事实重新计算：`sec-platform/sec@5f70db3c76d23a04361ba7d2ed689a17e3e14e21`、PR #135 的成功 Scope/Quick/merge/close evidence、当前 Draft PR #136 及其预期 draft-lifecycle merge-gate failure、只作导航的过期 Issue #132、SM-4A ingress candidate 的 focused/static evidence，以及其 canonical affected aggregate 暴露的共享 Bun 5 秒 timeout 根因。IR-H1 已由 `main` 证明完成；PR #136 尚未进入 `main`，ingress candidate 仍只在本地 branch，两者都不能计为产品完成。实时 PR、CI 与 Review 事实只由 `docs/work/current-state.yaml` 拥有，本计划只引用其当前快照来排序。

本窗口只保留一个 active package 与五个候选。它不证明任何 active/candidate 完成，也不取代 `docs/03-MVP实施计划与路线图.md`、`docs/14-Engineering IR与语义事实规范.md` 或 `docs/test-feedback-and-ci-lanes.md` 的 authority。

```text
Affected fast timeout V9 bootstrap (active prerequisite)
└─→ SM-4A trusted authorization ingress replay
    └─→ SM-4A shared product adapter
        └─→ SM-4A CLI + Workbench transport vertical
            └─→ Blockless Semantic Source Ownership
Nexus Phase 0A exact-tree census (read-only candidate; no second active package)
```

## 当前唯一 Work Package

### affected-fast-timeout-contract-v1

- 产品/工程结果：所有canonical fast invocations在caller未指定timeout时使用同一个180秒有界默认值，同时把V1 revision/artifact identity从v8最小推进到v9；显式timeout override、Evidence V2 schema、selector和Gate集合不变。
- 根因：`runAffectedTests → runFastTests → fastTestArgs` 未提供 timeout，十二个真实耗时超过 5 秒的 fast files 被 Bun 默认值终止；相同文件在 180 秒 sentinel 下 12/12、170 assertions 全部通过。
- Canonical seam：`fast-test-policy.ts` 独占命名默认值，`test-runner.ts` 的单一 argv builder 同时覆盖 concurrent shard 与 isolated serial file；不按测试硬编码、不改变 selector/shard/serial ownership。
- Ownership：根 `.gitattributes` 的单一 immutable-fixture LF pin、三个verification workflows、路线图/执行蓝图/测试authority、三个控制面、manifest、runner timeout owner、V1 revision owner、base-side artifact lookup及八个current/invalidation合同，共二十四个exact paths。
- 风险：GitNexus符号图为LOW，但 `platform/dev-runner/`、workflow、revision与merge gate共同属于verifier trust root；只能以exact local evidence、双审查和人工bootstrap集成，不能用candidate hosted Quick自证。
- 新前置：首轮focused batch为103/104，唯一失败是Windows checkout把immutable evidence fixture从index LF物化为CRLF；canonical blob/digest未漂移。当前包已重冻纳入exact `eol=lf` contract，只复跑该sentinel并与其余103项组合，不重复完整batch。
- 退出：一次v9 bootstrap focused组合证据与一次真正的base→candidate canonical affected aggregate通过；v9 producer/lookup/current fixtures完全一致，v8 current evidence确定性失效，composition v7不漂移；typecheck、depcruise、changed-only imports、docs/scope/patch、GitNexus compare通过。

## 候选 Work Package

### 1. sm4a-trusted-authorization-ingress-v1

- 状态：已有未 push的本地 candidate `b753b5578e24ef96d03c051c81e25bf81ffcd8c1`；因 active prerequisite暂停，不是 `main` 事实。
- 产品结果：Compiler/Mutation owner把不含 owner/path/task/envelope/revision的 trusted-local policy draft转换为既有 canonical authorization。
- Reconciliation：v9 bootstrap合并后，只把ingress production/test delta重放到新 `main`，重新冻结base、v9 manifest digest、三个控制面与失效Gates；不复制旧exact-head结论。
- 风险边界：既有 HIGH-risk authorization normalizer/revision只复用不修改；SM-2 registry继续独占 owner/path authority；不接 CLI/HTTP/Workbench。

### 2. sm4a-shared-product-adapter-v1

- 产品结果：一个 platform-owned adapter统一 raw DTO validation、trusted local policy draft、plan/apply/query/recover调用与产品结果投影。
- 依赖：trusted authorization ingress先进入 `main`；canonical request/plan/result、source resolver、Verification、lease与journal保持既有 owner。
- 边界：不拥有 authorization/source owner/path/revision算法，不接 transport，不修改 Pipeline order或 legacy View Mutation。
- 退出：同一 workspace/request/policy生成稳定 request/plan/result binding；plan无写入，apply强制 expected plan，四类 terminal lifecycle可区分。

### 3. sm4a-cli-workbench-transport-vertical-v1

- 产品结果：CLI 与 Workbench State View/API作为薄 transport shell消费同一个 shared adapter，闭合一个真实 `add-state-transition` vertical。
- 依赖：shared adapter contract已冻结；HTTP mutating boundary先冻结 loopback + strict Origin或等价 capability模型。
- 边界：禁止 wildcard CORS、内部 path/source/stack泄露、独立 `/api/compile` 重建、第二 DTO/revision owner，以及把 SM-4B/SM-4C塞入本包。
- 退出：CLI/Workbench plan binding byte-identical；accepted/rejected/rolled-back/recovery-required端到端可见；legacy mutation仍明确分离。

### 4. nexus-phase-0a-exact-tree-census

- 产品结果：对 `QzCrane/nexus@e75caa28dcbc1ffa6e893b5539f85c8177346cd3` / tree `3a8ad6be...` 形成 1,439/1,439 path、29/29 EPR、11/11 Skills与机制决策 inventory。
- 执行方式：只读采集可作为辅助；ledger写入、owner裁决与任何路线重算仍由A0串行，不能成为第二 active package。
- 风险：禁止抽样冒充全量、读取变化中的 worktree、把Nexus特例写入SEC Core或把decision冒充parity。
- 退出：unclassified/undecided为0，manifest digest确定；仍不宣称Parity或Retirement完成。任何新前置条件触发整体滚动计划重算。

### 5. blockless-semantic-source-ownership-v1

- 产品结果：App-owned或source-module-owned Semantic Contract不依赖Block许可证即可进入Frontend → IR → Projection，并保持唯一 writable owner。
- 依赖：SM-4A真实consumer进入 `main` 后，先冻结兼容migration contract；Target Profile不在本窗口，待本包合并后重算。
- Canonical seam：一个 `SemanticSourceOwner` type/normalizer/revision owner串行迁移 provenance、IR input/builder identity与Mutation resolver；Registry保持read-only。
- 风险：禁止loader临时union、第二identity authority、破坏CAS/Registry provenance或让unlisted mirror获得authority。
- 退出：standalone identity稳定、Block bytes兼容、unlisted mirror仍拒绝、old block-derived owner不再是存在前提。

## 单写者、证据与重算

- 正式 active package始终只有一个；canonical timeout、authorization、source owner、request/plan/result revision、transport DTO与HTTP trust boundary按依赖串行冻结。
- 每个 Gate只有一个 `gate_owner`；相同 `gate_key + tested head + profile` 的未失效结果必须复用，不重复运行 aggregate或完整矩阵。
- Merge/close、相关 `main` 变化、新 CI/Review blocker、architecture review反证、candidate被替代、Nexus Census新前置或长期Goal变化后，从最新事实整体重算并删除失效候选。
