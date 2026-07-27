---
schema: codex-development-work-package-v1
id: docs-document-authority-v5-reconciliation-v2
tracking: issue-132
base: 8aa2d2db8dd7541ddc05d9367a4070a73fa3f8a2
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v9
tasks:
  - id: docs-v5-authority-reconciliation
    owner: a0
    ownedPaths:
      - AGENTS.md
      - README.md
      - docs/00-文档索引与一致性规则.md
      - docs/02-工程编译器-MVP-PRD与架构稿.md
      - docs/03-MVP实施计划与路线图.md
      - docs/04-AI自主实现执行蓝图.md
      - docs/architecture/brownfield-import.md
      - docs/archive/2026-07-23-document-system-v4-migration-note.md
      - docs/goals/SEC-Engineering-Workspace-Compiler.md
      - docs/governance/external-capability-and-provider-policy.md
      - docs/governance/external-capability-ledger.yaml
      - docs/governance/nexus-absorption-and-conformance.md
      - docs/governance/nexus-absorption-ledger.yaml
      - docs/governance/nexus-absorption-report.md
      - docs/work/README.md
      - docs/work/active-work-package.md
      - docs/work/current-state.yaml
      - docs/work/rolling-plan.md
      - docs/work-packages/docs-document-authority-v5-reconciliation-v1.md
      - docs/work-packages/docs-document-authority-v5-reconciliation-v2.md
      - docs/代码库可视化流程图工具与编译原理综合指南.md
      - tests/integration/project-runtime.test.ts
forbiddenPaths:
  - .githooks/
  - .github/
  - .gitignore
  - .gitmodules
  - bun.lock
  - bunfig.toml
  - package.json
  - tsconfig.json
  - docs/05-编译器核心实现规格.md
  - docs/06-Registry与Block协议规范.md
  - docs/07-Pass状态机、错误码与恢复机制.md
  - docs/08-Verification、Provenance与Graph规范.md
  - docs/09-AI Runtime、任务信封与治理规范.md
  - docs/10-升级迁移与Override规范.md
  - docs/11-Workbench与可视化规范.md
  - docs/12-编译管道与行为流图示.md
  - docs/13-独立工具分发与打包规划.md
  - docs/14-Engineering IR与语义事实规范.md
  - docs/architecture/engineering-workspace-ir.md
  - docs/architecture/sec-ts-ir-layers.md
  - docs/evidence/
  - docs/scripts/
  - docs/test-and-package-architecture.md
  - docs/test-architecture.md
  - docs/test-feedback-and-ci-lanes.md
  - docs/slow-suite-registry.md
  - platform/
  - scripts/
  - source/
  - project/
  - control/
acceptance:
  - "The nine Markdown inputs under the user-provided docs/goals V4 tree are traceably bound by combined revision sha256:555a187dc8a1a8ed8d52e76c23a2e2e752c2a77073664fde5f286d274cbbf676; their durable product intent is assigned to one existing canonical owner per topic, while the duplicate V4 tree and Combined Reference do not enter the candidate."
  - "The original replacement manifest sha256:dfebcd615422f7d70fea68537cf4e9c82cd0d81e4ac401fd1c8aaf333890e9c2 is recorded as an audited input, not a trusted executable identity; path corruption, leading backslashes, self-deleting source placement, preserve-overlay loss, linked-worktree shell rejection, doctor propagation, and manifest drift are not represented as passing package invariants."
  - "Latest-main authority is not regressed: docs/09, docs/11, docs/14, both untouched SEC-TS/Engineering Workspace architecture owners, docs/test-feedback-and-ci-lanes.md, docs/scripts/docs-doctor.ts, and docs/scripts/add-frontmatter.ts remain byte-identical to origin/main@8aa2d2d."
  - "Docs 00, 02, 03, Goal, and the architecture owners describe one final product flow and one migration order: current Engineering IR can feed provisional target lowering, and later Workspace-domain expansion reconciles through one validated snapshot builder without a second loader, writer, revision algorithm, or target-program authority."
  - "SM-3 remains implemented; SM-4A authorization ingress then shared adapter and CLI/Workbench transport remain ahead of SM-4B Task Envelope v2 and SM-4C AI. No goal or roadmap text turns a planned layer into a current capability."
  - "The repository operating contract in docs/04 remains a projection of AGENTS.md and retains Context Capsule, branch/dependency ownership, gate_owner, evidence reuse, structured reconciliation, stop, and reload_if requirements; Provider routing only references its governance owner."
  - "AGENTS.md, README.md, docs/04, docs/03 and docs/work/** consistently separate stable stage/completion authority from live current-state, rolling-plan and active-manifest authority; no navigation surface repeats a stale current task, PR, SHA or blocker."
  - "The external capability policy and ledger distinguish observed tool availability from preferred/default authority. No provider with missing repository-specific benchmark and decision evidence is promoted to a canonical SEC owner or an evidence-backed default."
  - "The Nexus conformance document is explicitly a Corpus/Policy Pack, not a second SEC Core owner. Its ledger and report preserve commit e75caa28dcbc1ffa6e893b5539f85c8177346cd3, tree 3a8ad6bedd56fd92db141c45ec687b75263364c2, 1439 tracked paths, 29 EPR definitions, 11 Skills, incomplete coverage, and all existing seed/evidence facts."
  - "The migration note maps every V4 source topic to its canonical destination and does not claim completion merely from installation. The historical code-graph guide cannot override active architecture or provider policy."
  - "The three control planes are recomputed from origin/main@8aa2d2d, open PR 137, open Issue 132, current CI/review evidence, the new Goal revision, and the suspended runtime candidate. Exactly this manifest is active; rolling-plan contains only this package plus two to five bounded candidates."
  - "The roadmap executable consumer asserts the stable P0–P12 DAG, delegation to the three work control planes, the single snapshot/target authority boundary and Work Package/MVP completion semantics; it no longer treats retired v0.3 history headings as the current docs/03 contract."
  - "The exact candidate has 21 changed records, all owned by this V2 manifest: the original 17-path V1 documentation closure plus AGENTS.md, README.md, tests/integration/project-runtime.test.ts, and this V2 manifest. V1 remains byte-identical as failed historical evidence. The candidate contains no verifier trust-root, workflow, production, package, generated, probe, replacement-source, or unrelated user-root drift, and passes the selected focused documentation/roadmap contracts, docs doctor, manifest ownership, YAML parsing, imports, patch hygiene, and GitNexus compare."
tests:
  - "roadmap-consumer-focused: bun test tests/integration/project-runtime.test.ts -t \"roadmap documents the stable stage DAG and authority boundaries\" --timeout 180000"
  - "active-documentation-focused: bun test tests/unit/active-documentation-contract.test.ts tests/contract/test-impact.test.ts tests/contract/ci-lanes.test.ts --timeout 180000"
  - "docs-doctor: bun run docs:doctor"
  - "manifest-contract: parse the frozen manifest with scripts/codex/work-package-contract.ts and assert every changed record has exactly one owner and no forbidden path"
  - "yaml-parse: parse docs/work/current-state.yaml, both governance ledgers, and the manifest frontmatter with the repository YAML dependency"
  - "latest-main-byte-preservation: compare every acceptance-listed untouched authority/trust-root path to origin/main@8aa2d2d"
  - "patch-whitespace: git diff --check 8aa2d2db8dd7541ddc05d9367a4070a73fa3f8a2 --"
  - "gitnexus-compare: detect_changes scope compare against main after the final candidate is frozen"
---

# Docs Document Authority V5 Reconciliation V2

## Architectural goal

把用户提供的 V4 综合审计与 V5 replacement payload 转化为最新 `main` 上的一次文档 authority 迁移，而不是机械覆盖。最终结果必须保留 V5 中真正新增的长期 Goal、稳定阶段 DAG、外部 Provider 治理、Nexus Conformance、迁移记录与动态控制面说明，同时逐字保全 `8aa2d2d` 已进入 `main` 的 Engineering Workspace、SEC-TS、SM-3/SM-4A/B/C、Workbench trust boundary 与 `ci-verification-v9` 权威。

## Prerequisite and Context Capsule

- Base/head：`origin/main@8aa2d2db8dd7541ddc05d9367a4070a73fa3f8a2` / V2 candidate head 未冻结；branch `codex/docs-document-authority-v5`。
- Goal source：用户根工作树 `docs/goals/**` 的九份 Markdown 已完整读取；ordinal POSIX path + TAB + raw SHA-256 + LF 的 combined revision 为 `sha256:555a187dc8a1a8ed8d52e76c23a2e2e752c2a77073664fde5f286d274cbbf676`。
- Replacement source：原包 manifest raw SHA-256 为 `dfebcd615422f7d70fea68537cf4e9c82cd0d81e4ac401fd1c8aaf333890e9c2`。原包不满足自证完整性，只能作为审计输入；一次修复后的临时 Windows overlay 已在隔离 worktree 执行并验证 preserve/payload output，不能倒推原包通过。
- GitHub：开放 PR #137 为 Draft，head `cf0183d495fbc8223fb8e216393f7f20867e653a`；PR #138 已转 Ready，V1 head `897250bcd6e48802f24c58adfb0c843dac497735` 的 Scope run `30012100577` 成功，但唯一 Quick run `30012238172` 在 roadmap executable consumer 上失败，最终 merge-gate保持失败。开放 Issue #132 仅作路线导航。#137 的 runtime/V10 候选保持 suspended，不与本包共享 formal execution closure。
- GitNexus：`sec` 索引落后当前 `main`，只作调用图和 diff radar；源码、Git object、canonical docs 与 focused tests是裁决证据。
- `gate_owner`：A0 独占本包全部 Gate。未失效的 `main` 产品/full/slow/workspace/reference evidence 复用，不重复执行。

## Dependency and ownership

本包是当前唯一 formal Work Package。Canonical 文档、导航与 roadmap executable consumer 由 A0 串行修改；并行 reviewer 只读。`docs/scripts/docs-doctor.ts` 属于 verifier trust root，其 semantic-superset 实现与 differential fixtures明确后置为独立候选，必须与 #137/V10 revision seam重新协调；本包恢复并保持该脚本的 latest-main bytes。

V5 中的 Nexus EPR/Skill/Toolchain/CI/Release 内容只能作为 Corpus/Policy Pack requirement并链接现有 SEC Core owners。外部工具 ledger记录 observation、benchmark、decision 与 lifecycle；Provider输出永远不能拥有 Engineering IR、canonical Impact、actual Delta、publish或 source writer。

## Reconciliation, stop, and reload

以下任一条件触发停止并从最新事实重算：`origin/main`、Goal九文件集合或 raw bytes变化；PR #137/#138 merge/close/head/base或 Review/CI blocker改变依赖；Nexus exact baseline变化；必须修改 forbidden/trust-root/production path；V5 文案无法在不建立第二 owner的情况下吸收；最终 changed records超出 ownership。V1 Quick failure作为永久 failed evidence保留，不得对同一 exact head/profile重复 dispatch。

Stop delta 必须返回 tested head/base、changed files、public/authority/acceptance delta、focused results、可复用/失效 evidence、blocker、next ready seam，以及 `inspect_ms`、`implement_ms`、`focused_validation_ms`、`wait_ms`、`reconcile_ms`、`context_reload_count`、`duplicate_gate_count`。完成只能由进入 `main` 的最终实现与适用证据证明；本 manifest、安装输出、计划或 PR 均不能证明完成。
