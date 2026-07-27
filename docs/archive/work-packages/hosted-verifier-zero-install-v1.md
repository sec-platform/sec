---
schema: codex-development-work-package-v1
id: hosted-verifier-zero-install-v1
tracking: issue-132
base: da95ed90232f50621e8008f5b565b428e03d0627
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v17
tasks:
  - id: eliminate-trusted-job-root-installs
    owner: a0
    ownedPaths:
      - .github/workflows/compiler-pr-validation.yml
      - .github/workflows/compiler-release-validation.yml
      - .github/workflows/sec-merge-gate.yml
      - docs/04-AI自主实现执行蓝图.md
      - docs/test-feedback-and-ci-lanes.md
      - docs/work-packages/hosted-verifier-zero-install-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - platform/shared/ci-verification-plan.ts
      - platform/shared/collections.ts
      - platform/shared/test-impact-contract.ts
      - scripts/codex/work-package-contract.ts
      - tests/contract/ci-contract.test.ts
      - tests/contract/ci-lanes.test.ts
      - tests/contract/sec-merge-gate.test.ts
      - tests/contract/test-impact.test.ts
      - tests/unit/collections.test.ts
      - tests/unit/ci-evidence-composition-policy-registry.test.ts
      - tests/unit/ci-pr-risk-execution.test.ts
      - tests/unit/ci-verification-execution.test.ts
      - tests/unit/codex-work-package-contract.test.ts
forbiddenPaths:
  - .codex/
  - .githooks/
  - AGENTS.md
  - README.md
  - bun.lock
  - bunfig.toml
  - docs/00-文档索引与一致性规则.md
  - docs/03-MVP实施计划与路线图.md
  - docs/archive/
  - docs/evidence/
  - docs/goals/
  - docs/governance/
  - package.json
  - platform/compiler/
  - platform/dev-runner/
  - platform/orchestrator/
  - platform/shared/ci-evidence-reuse-contract.ts
  - scripts/ci-pr-risk.ts
  - scripts/ci-verification.ts
  - scripts/ci-workspace-fast.ts
  - source/
  - tests/e2e/
  - tests/integration/
  - tests/testkit/
  - tsconfig.json
acceptance:
  - "The Work Package parser uses the Bun 1.3.14 built-in YAML authority and its accepted values are identical to the existing strict parser for every tracked historical manifest."
  - "The parser rejects duplicate mapping keys in root, task, and evidence-composition contexts, plus anchors, aliases, merge keys, explicit tags, flow collections, tabs, and block scalars before Bun value parsing."
  - "Test import discovery uses pinned Bun Transpiler syntax scanning, and the shared collection authority preserves its canonical value semantics without loading lodash-es."
  - "The merge-gate entrypoint transitive runtime closure contains no non-built-in package import and therefore cannot resolve through node_modules."
  - "attest-scope and merge-gate retain pinned Bun setup but contain zero dependency-install step; exact PR verification and release verification each retain one frozen root install."
  - "Normal hosted delivery structurally performs one root dependency install total instead of three, while scope still precedes verification and default-branch merge validation remains independent."
  - "V1 verification revision and every active artifact producer/lookup advance atomically from V16 to V17; V2 composition remains V7 and historical manifests remain byte-identical."
  - "Candidate changes verifier trust-root bytes and therefore uses independent exact-head review plus manual bootstrap rather than candidate-hosted self-authorization."
tests:
  - "parser-contract: bun test tests/unit/codex-work-package-contract.test.ts --timeout 180000"
  - "selector-runtime-contract: bun test tests/unit/collections.test.ts tests/contract/test-impact.test.ts --timeout 180000"
  - "trust-root-contract: bun test tests/contract/sec-merge-gate.test.ts --timeout 180000"
  - "v17-contract: bun test tests/contract/ci-contract.test.ts tests/contract/ci-lanes.test.ts tests/contract/sec-merge-gate.test.ts tests/unit/codex-work-package-contract.test.ts tests/unit/ci-evidence-composition-policy-registry.test.ts tests/unit/ci-pr-risk-execution.test.ts tests/unit/ci-verification-execution.test.ts --timeout 180000"
  - "historical-differential: all tracked Work Package frontmatter values match the legacy strict parser before replacement"
  - "runtime-closure: merge-gate transitive runtime imports contain zero package specifiers outside node: and bun:"
  - "workflow-install-census: trusted scope and merge jobs have zero install steps; PR/release verification each have exactly one"
  - "typecheck: bun run typecheck once after source stabilizes"
  - "imports/changed-only: SEC_IMPORTS_CHANGED_ONLY=1 and SEC_CHANGED_BASE=da95ed90232f50621e8008f5b565b428e03d0627 with bun run imports:check once"
  - "docs-doctor: bun run docs:doctor once"
  - "manual-bootstrap: independent exact-head scope, architecture, parser-differential, workflow and evidence review for V17"
  - "manifest-scope: every base-to-head path has exactly one task owner and no forbidden path changes"
  - "patch-whitespace: git diff --check da95ed90232f50621e8008f5b565b428e03d0627 HEAD --"
---

# Hosted Verifier Zero Install V1

## 唯一结果

把正常交付中 scope、Quick 与 merge-gate 三次完整根依赖安装收敛为只有 Quick 的一次。Scope attestation 与 merge-gate 只解析受控 Work Package、读取Git/Evidence并计算签名；它们不执行产品、TypeScript、Playwright、Next或测试，因此不应安装整个工程依赖图。

```text
trusted base checkout + pinned Bun
→ built-in strict Work Package YAML
→ scope attestation
→ one candidate verification install
→ zero-install base-side merge gate
```

## Context Capsule

- Branch：`codex/hosted-verifier-zero-install-v1`
- Base：`main@da95ed90232f50621e8008f5b565b428e03d0627`
- Failing reproduction：PR #153 的一个有效交付样本中，scope、Quick、merge-gate分别为42、62、48秒，其中三次`bun install --frozen-lockfile`分别占26、24、20秒。单次duration只定位phase，不建立wall-clock hard baseline。
- Structural waste：最初样本定位到`work-package-contract.ts`的`yaml`；静态闭包sentinel随后证明merge-gate selector还会加载`lodash-es`、`ts-morph`和`globby`。只有同时移除这四条package runtime边，两个trusted job才真正具备zero-install前提。
- Compatibility proof：当前tracked历史Work Package用既有strict parser与Bun 1.3.14 `Bun.YAML.parse`得到完全相同的值；test import scanner保持static import、re-export与literal dynamic import语义且不把字符串当import；原生集合primitives保持既有过滤、去重、排序与计数值语义。
- Hard invariant：正常scope→Quick→merge交付只有Quick包含一个root install；scope/merge job为0。性能结论按结构性安装次数，不依赖一次runner wall-clock。
- Trust boundary：Work Package parser、三个workflow与V1 revision均属verifier trust root，候选原子升级V17并走manual bootstrap；V2 composition保持V7。
- Gate owner：A0；只在单一exact candidate上运行focused contract、typecheck/imports/docs与独立Review，不发送必然`manual-bootstrap-required`的hosted Quick/Risk。

## Reload if

- live `origin/main`不再是`da95ed90232f50621e8008f5b565b428e03d0627`。
- Bun runtime不再是1.3.14，任一历史manifest产生value delta，strict negative语义不能保持fail closed，或Bun import scanner不能保持现有selector语义。
- 需要修改package/bun lock、产品、dev runner、V2 composition、Evidence schema或剩余任一forbidden path。
- exact candidate第一次freeze后继续修改实现。

## Stop

- 通过缓存偶然命中、非冻结网络下载、vendored generated bundle、第二YAML/parser/selector authority或跳过manifest验证宣称变快。
- Scope不再先于verification，merge-gate执行candidate verifier，或任一job扩大权限。
- duplicate key、anchor/alias/merge、tag、flow/block YAML或历史manifest兼容无法由可执行合同证明。
- V17 producer/lookup不能原子同步，V2 composition变化，或candidate发生第二次invalidation。
