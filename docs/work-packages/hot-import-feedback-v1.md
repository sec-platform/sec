---
schema: codex-development-work-package-v1
id: hot-import-feedback-v1
tracking: issue-132
base: a65dbef3e3666edf5030200ef66fe715dcb0ea95
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v14
tasks:
  - id: bound-import-program-and-elide-clean-candidate-snapshot-v14
    owner: a0
    ownedPaths:
      - .github/workflows/compiler-pr-validation.yml
      - .github/workflows/compiler-release-validation.yml
      - .github/workflows/sec-merge-gate.yml
      - docs/test-architecture.md
      - docs/test-feedback-and-ci-lanes.md
      - docs/work-packages/hot-import-feedback-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - platform/dev-runner.ts
      - platform/dev-runner/dependency-bootstrap.ts
      - platform/dev-runner/import-organizer.ts
      - platform/shared/ci-verification-plan.ts
      - tests/contract/ci-contract.test.ts
      - tests/contract/ci-lanes.test.ts
      - tests/contract/docs-doctor.test.ts
      - tests/contract/sec-merge-gate.test.ts
      - tests/unit/ci-evidence-composition-policy-registry.test.ts
      - tests/unit/ci-pr-risk-execution.test.ts
      - tests/unit/ci-verification-execution.test.ts
      - tests/unit/codex-work-package-contract.test.ts
      - tests/unit/dev-runner-dependency-bootstrap.test.ts
      - tests/unit/heavy-verification-gate-lease.test.ts
      - tests/unit/import-organizer-selection.test.ts
      - tests/unit/import-organizer-staged.test.ts
forbiddenPaths:
  - .codex/
  - .githooks/
  - .gitignore
  - AGENTS.md
  - docs/00-文档索引与一致性规则.md
  - docs/01-用户能力模块化开发-主题整理稿.md
  - docs/02-工程编译器-MVP-PRD与架构稿.md
  - docs/03-MVP实施计划与路线图.md
  - docs/04-AI自主实现执行蓝图.md
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
  - docs/archive/
  - docs/evidence/
  - docs/goals/
  - docs/governance/
  - docs/scripts/
  - package.json
  - platform/compiler/
  - platform/shared/ci-verification-revision.ts
  - platform/shared/test-budget-contract.ts
  - platform/shared/test-impact-contract.ts
  - scripts/
  - tests/e2e/
  - tests/fixtures/
  - tests/integration/
  - tsconfig.json
acceptance:
  - "The import Language Service roots contain only selected TypeScript targets plus project declaration roots; unrelated root programs are not rebuilt for a focused import check."
  - "Imported dependencies, configured lib/types, project declaration roots, compiler options, newline preservation and organizeImports semantics remain owned by TypeScript; SEC does not implement a second import parser or sorter."
  - "Candidate freeze reuses the physical working tree only when Git canonical clean-filter comparison reports no tracked working-tree delta and no untracked path exists. Any Git-visible divergence deterministically falls back to the existing isolated full-index snapshot; checkout representations such as CRLF may differ from index raw bytes, so selected targets remain overlaid from exact staged blobs and the physical context never owns candidate bytes."
  - "Candidate selection remains the complete base-to-index TypeScript diff. Index lock, staged blob identity, atomic alternate-index publication and working-tree byte preservation remain unchanged."
  - "A warmed command with an existing validated compiler generation does not rescan managed hook bytes. First installation and explicit deps:ensure still run the canonical hook lifecycle and repair any drift."
  - "On the current warmed development machine, no-target changed-only, focused changed-only and clean candidate freeze target the repository feedback SLO. A single wall-clock sample is diagnostic only and cannot establish a hard baseline, regression or candidate invalidation; structural work reduction is the hard proof, and any comparative performance claim follows the canonical repeated-sampling protocol."
  - "The V1 verifier revision and every active artifact producer/lookup advance atomically from V13 to V14. Historical frozen manifests remain unchanged and V2 composition stays ci-verification-v7."
  - "Because platform/dev-runner and V1 verifier files are trust root, the candidate never self-authorizes through hosted Quick/Risk/Full; integration uses independent exact-head review and manual bootstrap."
  - "No daemon, watcher, background process, persistent semantic cache, duplicate organizer, second dependency authority, weakened import check, timeout increase or broader test lane is introduced."
tests:
  - "import-focused: bun test tests/unit/import-organizer-selection.test.ts tests/unit/import-organizer-staged.test.ts --timeout 180000"
  - "bootstrap-focused: bun test tests/unit/dev-runner-dependency-bootstrap.test.ts tests/unit/heavy-verification-gate-lease.test.ts --timeout 180000"
  - "v14-contract: bun test tests/contract/ci-contract.test.ts tests/contract/ci-lanes.test.ts tests/contract/docs-doctor.test.ts tests/contract/sec-merge-gate.test.ts tests/unit/codex-work-package-contract.test.ts tests/unit/ci-evidence-composition-policy-registry.test.ts tests/unit/ci-pr-risk-execution.test.ts tests/unit/ci-verification-execution.test.ts --timeout 180000"
  - "no-target-performance-diagnostic: SEC_IMPORTS_CHANGED_ONLY=1 plus SEC_CHANGED_BASE equal to exact HEAD, then bun run imports:check once; this is a diagnostic sample, not a hard baseline"
  - "focused-performance-diagnostic: one representative changed TypeScript target against an exact base, then bun run imports:check once; this is a diagnostic sample, not a hard baseline"
  - "candidate-performance-diagnostic: explicit-path stage of the final candidate, then bun run imports:freeze once; this is a diagnostic sample, not a hard baseline"
  - "typecheck: bun run typecheck once after source stabilizes"
  - "imports/changed-only: SEC_IMPORTS_CHANGED_ONLY=1 and SEC_CHANGED_BASE=a65dbef3e3666edf5030200ef66fe715dcb0ea95 with bun run imports:check once on the frozen candidate"
  - "docs-doctor: bun run docs:doctor once"
  - "manual-bootstrap: independent exact-head architecture/evidence review plus base-side integration for the V14 trust-root transition"
  - "manifest-scope: every base-to-head path has exactly one task owner and no forbidden path changes"
  - "patch-whitespace: git diff --check a65dbef3e3666edf5030200ef66fe715dcb0ea95 HEAD --"
---

# Hot Import反馈与V14 Bootstrap

## 唯一结果

把import authoring/check/freeze的常用路径稳定压进几秒，同时保留TypeScript唯一语义实现和Git index唯一candidate事实。性能来自少做无关工作：focused target不再构造全部533个root；Git canonical clean-filter parity且无untracked path时不再复制872个tracked path，selected targets仍由exact staged blobs覆盖。

```text
selection → target roots + declaration roots → TypeScript organizeImports
Git clean-filter parity → physical resolution context + exact staged target overlay
                        → index-only atomic publish
any divergence    → isolated full-index snapshot → index-only atomic publish
```

## Context Capsule

- Branch：`codex/hot-import-feedback-v1`
- Base：`main@a65dbef3e3666edf5030200ef66fe715dcb0ea95`
- Goal：`sha256:555a187dc8a1a8ed8d52e76c23a2e2e752c2a77073664fde5f286d274cbbf676`
- Historical observations：no-target changed-only约2.22秒；此前final changed-only约5.77秒，candidate freeze约8.24秒。这些是单次诊断样本，不是hard baseline；硬证据是root/snapshot/process工作量减少，任何优化比例必须按`test-architecture.md`的同条件重复采样协议重新建立。
- Proof：root config当前枚举533个TypeScript文件、约5.22 MB；Git index含872个tracked path。两个GitNexus owner均为LOW。
- Authority：TypeScript拥有organizeImports、module resolution和unused判断；Git index拥有candidate bytes；organizer只拥有selection、context isolation和atomic publication。
- Trust boundary：`platform/dev-runner/`与V1 revision消费者均是verifier trust root，因此原子升级V14并走manual bootstrap；V2 composition保持V7。
- Gate owner：A0；开发中只运行两个import focused文件和性能micro-sentinel，最终只冻结一个candidate。

## Reload evidence

本轮曾观察到clean candidate freeze 5.91秒、parity变体6.07秒、batch staged-blob变体5.52秒、organizer phase约4.05秒、managed-hook约590ms与dependency ready约34ms；它们都只是单次phase诊断，不建立hard baseline，也不单独证明性能回归或收益。parity parser、shared registry与literal dynamic-import变体没有提供可确定的结构性减工，反而增加实现面，因此已撤销；保留的变更具有可重算的结构证据：Language Service不再构造无关root、staged blobs由单个strict batch读取、clean candidate不再复制完整tracked tree、validated warmed generation不再扫描hook bytes。任何wall-clock优化比例必须在另一个明确选择的benchmark证据中按canonical重复采样协议建立。

## Reload if

- live `origin/main`不再是`a65dbef3e3666edf5030200ef66fe715dcb0ea95`。
- TypeScript、Bun、root tsconfig、import organizer authority、Git index publication、V1/V2 revision或trust-root registry变化。
- 需要修改任一forbidden path，或需要daemon、持久semantic cache、第二parser/sorter。
- PR head/base/state、CI、Review、unresolved thread或`REQUEST_CHANGES`变化。

## Stop

- target-root输出与原完整root organizer产生任一byte差异。
- Git canonical comparison存在tracked delta或untracked path时仍选择physical context，selected target未由exact staged blob覆盖，或index-only/atomic/working-tree preservation失效。
- focused/freeze热路径不能进入预算且phase evidence表明收益不足。
- V14与artifact namespace不能原子同步，或V2 composition意外变化。
- 同一candidate epoch发生第二次失效。
