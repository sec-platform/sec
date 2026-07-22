---
title: SEC 滚动近期计划
status: active
last-reviewed: 2026-07-22
---

# SEC 滚动近期计划

本计划基于 `sec-platform/sec@eb48eb35d1cdb0c647154385f0c938bf1066f7d4`、开放 Draft PR #133 / #134、Issue #132、CI run `29900753057` / `29900819819` / `29905050862`、零 Review/Thread blocker、exact-main dependency/GitNexus evidence，以及 `QzCrane/nexus@e75caa28dcbc1ffa6e893b5539f85c8177346cd3` 重算。它只覆盖当前包与四个候选，不证明完成，也不取代 `docs/03-MVP实施计划与路线图.md` 的里程碑 authority。

```text
B3 active-documentation v8 bootstrap (active)
└─→ Phase 0 Current Reality Rebase
    ├─→ IR canonical primitives import-cycle removal
    │   └─→ SM-4A Workbench/CLI minimum product loop
    └─→ Nexus Phase 0A exact-tree census (read-only auxiliary lane)
```

## 当前唯一 Work Package

### b3-active-documentation-bootstrap-v1

- 工程结果：在 V1 CI changed-file / active-documentation selector domain 内建立唯一 canonical path owner 与共享 active-documentation 分类，让 test-impact、PR-risk 与 Quick plan 对 `README.md`、全部 Markdown、`docs/work` / `docs/governance` YAML 得出相同的 resolved 结论，并在匹配前拒绝非 NFC、NUL、绝对、反斜杠、drive/URI/ADS 冒号与非法 segment；不取代其他输入域的 validator。
- 根因：PR #133 Quick 在任何 Gate 运行前因三个治理路径未被旧 `docs/**/*.md` 规则拥有而失败；三个 consumer 分别复制了同一不完整正则。B3 Review 又证实 regex-only contract 接纳非 canonical path、通用 manifest/contract YAML 规则抢占 active-documentation ownership、首个 canonical predicate 仍接纳 Windows drive/URI-like/ADS 路径，Git reader在 validation前把原始反斜杠洗成 `/`，text-mode process capture会破坏跨 chunk UTF-8且默认 decoder会吞首 BOM；exact-main closure sentinel 同时证实既有 trust snapshot 漏掉两个真实 transitive runtime leaf，而任何 dev-runner helper / WHATWG URL 专用解释器都会与 JavaScript 可变语义竞争，不能证明完整 code-loading closure。后续 exact-head architecture review又定位到 dot-prefix误接纳、restricted module整模块批准、复合 import binding遗漏，以及 global alias与 loader-value/member acquisition可绕过精确 dispatcher审查的共同 fail-open根因。
- 信任边界：改动触及 verifier trust root，因此升级 V1 revision 与 artifact namespace 到 v8，由 focused local evidence 和人工 integration 合并；候选 v8 不运行 hosted Scope/Quick 自证。V2 composition policy revision 保持 v7。
- Owner：Git byte→fatal UTF-8/BOM-preserving decoded path custody、保持默认 text行为的 additive shared process byte-output seam、V1/V7 changed-path canonicality与 active-documentation contract、三个 consumer、两类 trusted workflow snapshot（含两个既存 runtime leaf）、dev-runner 首个 executable immutable bootstrap path与三个 direct literal runner imports、只追踪精确 `./` / `../` ESM static/literal边、把 generic external allowlist与 restricted-module正向 binding分类分离、对 Bun/globalThis/process/module/import.meta namespace、`global` / `self` 等价入口、loader-value/member acquisition、process精确 13-member least-authority普通能力集与全部 process loader正向分类或 fail closed的 closure walker，以及由 repository path、完整具名 lexical-owner chain及声明 kind、loader与 chain内 call ordinal组成且无 literal-git豁免的精确 reviewed dispatcher registry、独立自重入 process-edge sentinel、base-side merge gate identity、合同测试、三个近期控制面与本 frozen manifest。
- 退出：完整 acceptance、forbidden surface、测试与 stop/reload 条件只以 active selector 指向的 B3 manifest 为准。
- 架构候选事实：relative-ESM/process-loader capability-total fail-closed实现已进入候选；仍等待 A0 的独立 exact-head architecture closeout，B3 继续是唯一 active package，不据此宣称架构、Gate或包完成。
- 下一 reconciliation：manifest digest与最终 single-parent exact head冻结后，由 A0 先完成独立 architecture closeout；只有通过后才能一次执行 B3 Gate batch并绑定 evidence。此前任一 head/base/authority/owned-path变化都使该 seam失效并要求重算。

## 候选 Work Package

### 1. phase-0-current-reality-rebase-v1

- 工程结果：把 PR #133 的长期 Goal 投影、路线图 reconciliation、SEC-TS / Workspace / Brownfield / Nexus 规划 owner 与三个控制面闭包落入 `main`。
- 依赖：B3 已进入 `main`；PR #133 必须 rebase/refreeze 为新 base、`ci-verification-v8` 和新 manifest digest。
- 退出：新的 exact head 各取得一次 scope attestation 与 Quick，Review/threads clear，base-side merge gate通过；旧 run `29900753057` / `29900819819` 不复用。
- 重算：B3 merge SHA、PR #133 diff/manifest、Review/CI 或 live `main` 变化即重算。

### 2. ir-canonical-primitives-cycle-removal-v1

- 工程结果：消除 `ir-identity.ts → ir-revision.ts → ir-identity.ts` 依赖环，所有 canonical identity/revision/digest vectors byte-identical。
- 依赖：Phase 0 合并；现有 Engineering IR、Fact Delta、Impact 与 Mutation schema/revision保持冻结。
- 风险：`digest` 为 CRITICAL（96 upstream、11 processes），只能串行迁移 pure primitive owner，不得同时改 schema、产品 adapter 或 CI trust root。
- 退出：dependency-cruiser 零环、byte parity、focused Contract Freeze、typecheck、changed-only imports 与 GitNexus compare通过。

### 3. sm4a-workbench-cli-minimum-v2

- 产品结果：CLI 与 Workbench 通过同一 trusted adapter plan/apply/query/recover `add-state-transition`，消费现有 SM-3 transaction，不复制 authorization、path、revision、Delta、Impact 或 Verification authority。
- 依赖：IR cycle removal 合并；Mutation-owned additive authorization ingress 与 HTTP trust boundary先冻结。
- 退出：CLI/Workbench plan revision一致、apply 强制 expected plan、真实 accepted vertical 与四类 terminal lifecycle可区分；SM-4B Task Envelope v2 / SM-4C AI 不进入本包。

### 4. nexus-phase-0a-exact-tree-census

- 工程结果：对 Nexus committed tree 完成 1,439/1,439 path、29/29 EPR 与 11/11 Project Skill 的确定性 inventory/decision。
- 依赖：Phase 0 先落地 canonical ledger/report；采集可只读辅助，但不能成为第二正式 active package。
- 退出：unclassified/undecided 为 0；只证明 Census/decision，不宣称 parity 或 retirement完成。

## 并行与重算

- 正式 active package 始终只有一个；canonical revision、artifact identity、shared selector 与 workflow trust snapshot保持单写者。
- Nexus 只读采集可作为辅助证据；任何 ledger写入与机制决策由 A0 串行 reconcile。
- 合并/关闭 PR、相关 `main` 变化、新 CI/Review blocker、架构假设反证、实现 supersede、Nexus Census 新前置条件或长期 Goal 更新后，按 `docs/04-AI自主实现执行蓝图.md` 第 1.2 节整体重算，不追加永久 backlog。
