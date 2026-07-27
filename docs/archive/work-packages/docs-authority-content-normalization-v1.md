---
schema: codex-development-work-package-v1
id: docs-authority-content-normalization-v1
tracking: none
base: 2065492f55bab75f65cf124c048fc6b849be73f9
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v9
tasks:
  - id: normalize-document-authority-content
    owner: a0
    ownedPaths:
      - AGENTS.md
      - docs/00-文档索引与一致性规则.md
      - docs/04-AI自主实现执行蓝图.md
      - docs/archive/2026-07-23-test-feedback-and-ci-evidence-history.md
      - docs/goals/SEC-Engineering-Workspace-Compiler.md
      - docs/governance/external-capability-and-provider-policy.md
      - docs/governance/external-capability-ledger.yaml
      - docs/governance/nexus-absorption-ledger.yaml
      - docs/governance/nexus-absorption-report.md
      - docs/test-feedback-and-ci-lanes.md
      - docs/work/active-work-package.md
      - docs/work/current-state.yaml
      - docs/work/rolling-plan.md
      - docs/work-packages/docs-authority-content-normalization-v1.md
      - tests/contract/document-control-plane-lifecycle.test.ts
forbiddenPaths:
  - .github/
  - .githooks/
  - README.md
  - bun.lock
  - bunfig.toml
  - package.json
  - tsconfig.json
  - docs/01-用户能力模块化开发-主题整理稿.md
  - docs/02-工程编译器-MVP-PRD与架构稿.md
  - docs/03-MVP实施计划与路线图.md
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
  - docs/architecture/
  - docs/evidence/
  - docs/scripts/
  - docs/superpowers/
  - platform/
  - project/
  - source/
  - control/
  - scripts/
acceptance:
  - "The package is based on live origin/main@2065492f55bab75f65cf124c048fc6b849be73f9 after the previous active manifest resolves to none, and its external exact-head capsule binds open PR #137 plus this package's PR #141, Issue #132, CI/review state and the nine-file Goal revision."
  - "AGENTS is a short repository projection that retains executable resolver, A0/single-writer, GitNexus impact/detect-changes, import-freeze, gate-custody, merge and hygiene obligations without embedding generated GitNexus context or duplicating docs/04 and CI internals."
  - "The product chain is canonical only in docs/02; docs/00 and the Goal mirror identify ownership without copying the chain or stable roadmap."
  - "The active CI authority contains stable lane/evidence semantics and code-owner links but no append-only SHA, PR or workflow-run ledger; the archive is a lossless quoted snapshot of the base blob, cannot be parsed as active headings, and reconstructs the complete prior text."
  - "External and Nexus ledger provenance names untracked source inputs, raw digests and the migration record without referring to nonexistent repository template paths; the external ledger policy revision matches the candidate policy blob."
  - "Nexus revision 3 remains an incomplete historical record and is explicitly invalidated by live QzCrane/nexus main bc2c3b3cf31e41813b2e18be53aab1c154704f92/tree 7139fd11d6c0b911b765c5b76adc7ad241a86ec1, with no current coverage or completion claim."
  - "current-state contains resolver configuration and stable facts only; rolling-plan contains this package and four dependency-ordered candidates; the pointer selects exactly this frozen manifest by Git blob SHA-256."
  - "The lifecycle contract resolves the repository manifest from the active pointer, enforces one active package plus a consecutive unique 2-5 candidate window, and no longer requires test edits for every package identity or bounded plan recomputation."
  - "The archive is an added record rather than a Git copy record under the canonical --find-renames --find-copies diff, so GitHub API records and exact Git records agree at the base-side merge gate without changing verifier trust."
  - "The exact candidate owns only the fifteen listed paths, preserves all product/verifier/source and unrelated test bytes, introduces no second authority or user-root input, and passes focused document/control/CI-path contracts, docs doctor, YAML, typecheck, patch, GitNexus and Review."
tests:
  - "focused-contracts: bun test tests/contract/document-control-plane-lifecycle.test.ts tests/contract/ci-lanes.test.ts tests/unit/active-documentation-contract.test.ts tests/contract/test-impact.test.ts tests/unit/ci-pr-risk-selection.test.ts tests/unit/ci-verification-execution.test.ts --timeout 180000"
  - "docs-doctor: bun run docs:doctor; zero errors and no warnings beyond the eight exact pre-existing historical/future-output diagnostics"
  - "typecheck: bun run typecheck"
  - "yaml-parse: parse current-state plus both governance ledgers with the repository YAML dependency"
  - "authority-audit: active docs contain one product-chain owner, no historical SHA/PR/run ledger and no nonexistent template provenance path"
  - "archive-fidelity: decode the historical quote prefix to the exact base docs/test-feedback-and-ci-lanes.md blob and require canonical Git diff status added rather than copied"
  - "manifest-contract: parse this frozen manifest and attest all base-to-candidate changed records have exactly one owner and no forbidden path"
  - "live-control-plane: bun scripts/codex/document-control-plane.ts status --json"
  - "patch-whitespace: git diff --check 2065492f55bab75f65cf124c048fc6b849be73f9 --"
  - "gitnexus-compare: detect_changes compare against main after the final candidate is frozen"
---

# Docs Authority Content Normalization V1

## Architectural goal

把已选择性落地的V5文档从“内容仍混合”收敛为可执行的单owner体系，而不机械运行原replacement。原包132/132 bytes自洽但installer会删除自身、含损坏首行/Unicode path并回退latest-main事实，已由PR #138–#140取代；本包只处理仍存在的authority、history、provenance与freshness根因。审计还发现 lifecycle contract 把上一 manifest 与五个候选名称写死，导致每次正规重算都必须修改测试；该文件不在 verifier trust root，GitNexus 对文件与两个辅助函数的 upstream impact 均为 LOW、仅本测试文件直接依赖，因此将其纳入同一控制面闭包并改为动态合同。

## Context Capsule

- SEC base/tree：`origin/main@2065492f55bab75f65cf124c048fc6b849be73f9` / `547d0c81795fa7fb750cb4603d2c7ca475431dd5`；branch `codex/docs-authority-content-normalization-v1`。
- Goal：九份Markdown完整读取，combined revision `sha256:555a187dc8a1a8ed8d52e76c23a2e2e752c2a77073664fde5f286d274cbbf676`。
- GitHub：开放PR identity为本包#141与既有#137，唯一Issue #132为导航面；两者的Draft/merge/head/Review/CI只由live resolver与外部exact-head capsule绑定，不持久化进manifest。创建#141触发的重算未改变DAG或候选顺序。
- Docs baseline：resolver返回`none`；docs doctor为0 errors/8 warnings；原V5 manifest自洽但executable NO-GO；active CI文档含旧SHA/PR/run ledger；两个template provenance path不存在。首次exact-head Quick成功后，base-side Gate发现Git `--find-copies`的`C099`与GitHub API `added`不一致；archive现改为可逆引用快照，保留完整base blob内容且不再形成copy record。
- Nexus freshness：本地/remote main clean 0/0 at `bc2c3b3cf31e41813b2e18be53aab1c154704f92`, tree `7139fd11d6c0b911b765c5b76adc7ad241a86ec1`；相对ledger source `e75caa28…`有117 changed paths与1,443 current tracked paths，故旧Census identity失效。
- GitNexus：latest SEC worktree已用`--index-only`建立8,065 nodes/23,270 edges/300 flows索引；FTS不可用只影响BM25，不能把图结果当最终证据。
- `gate_owner`：A0独占全部Gate。产品、full/slow/workspace/reference证据因本包无代码/producer交集而复用；文档/active-path/focused/Quick evidence必须绑定最终exact head。

## Ownership and migration

`02`继续是产品主链唯一owner，`03`继续是稳定路线owner，`04`拥有Agent执行语义，CI文档只拥有lane/Evidence组合语义，代码合同拥有当前revision与argv。旧CI全文移动到historical archive以保留审计，不再参与active authority。Goal mirror只绑定上游revision和永久意图。

Provider/Nexus template只来自用户未跟踪输入；canonical ledger必须以input name、raw digest、tracked=false与migration record表达provenance，禁止伪造仓库path。Nexus旧baseline保留历史bytes但显式invalidated；刷新Census是后继独立包，不能把本次117-path diff冒充inventory。

## Stop, reload and reconciliation

以下任一条件触发停止并重算：SEC/Nexus default main变化；Goal bytes/revision变化；PR #137或#141的state/head/base/Review/CI变化；出现除当前两项以外的新开放PR或新Issue；需要修改任何forbidden path或docs-doctor trust root；archive move丢失旧内容；ledger provenance无法无第二authority闭合；changed records超出唯一task ownership。

完成前返回tested base/head、changed paths、authority/acceptance delta、focused结果、复用/失效evidence、blocker、next ready seam及规定的时间/重载/重复Gate指标。只有合并后的新`main`与适用测试、CI、Review证明本包完成。
