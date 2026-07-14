---
schema: codex-development-work-package-v1
id: sm3-isolated-verification-typescript-resolution-fixture-repair-v1
tracking: issue-106
base: f29ecb73ac64aaae23b7989688c4a3ca79593d43
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v5
tasks:
  - id: replace-ambiguous-resolution-fixture
    owner: a0
    ownedPaths:
      - docs/work-packages/sm3-isolated-verification-typescript-resolution-fixture-repair-v1.md
      - docs/evidence/v0-4-semantic-mutation-isolated-verification-typescript-resolution-fixture-repair.json
      - tests/unit/semantic-mutation-isolated-child-fence.test.ts
forbiddenPaths:
  - .github/
  - AGENTS.md
  - package.json
  - bun.lock
  - platform/
  - scripts/
  - tests/contract/
  - tests/integration/
  - tests/testkit/
  - docs/03-MVP实施计划与路线图.md
  - docs/04-AI自主实现执行蓝图.md
  - docs/14-Engineering IR与语义事实规范.md
  - docs/test-feedback-and-ci-lanes.md
  - docs/evidence/v0-4-semantic-mutation-add-state-transition-vertical-v6-verification.json
  - docs/evidence/v0-4-semantic-mutation-isolated-verification-typescript-entry-diagnosis.json
  - docs/evidence/v0-4-semantic-mutation-isolated-verification-typescript-entry-focused-reconciliation.json
  - docs/work-packages/sm3-isolated-verification-typescript-entry-focused-reconciliation-v1.md
acceptance:
  - "The failed focused reconciliation is terminal and never rerun: docs/evidence/v0-4-semantic-mutation-isolated-verification-typescript-entry-focused-reconciliation.json sha256:f7771a333c03dc6f3e8a9745865eebeb3b14fc954836c1e546c57b18dbefc650."
  - "The exit-76 physical case keeps the staged TypeScript entry present and replaces only its nearest package manifest with a valid exports map whose root export is null. The same generated loader and real parent must classify the resolver rejection as 76 at loader-entered."
  - "A separate absolute-fallback case creates a fixture-owned ancestor node_modules/typescript inside caseRoot, removes the staged package and requires the same generated loader to classify the resulting absolute wrong identity as 77 at typescript-specifier-resolved. It never records the resolved path."
  - "The existing staged alternate-main case remains a second 77 witness. Entry-own/transitive 78, runtime 79, later ts-morph/core 75, module-cache identity, host behavior, runtime plan and public redaction remain byte-for-byte unchanged."
  - "No OS-temp root, repo-root node_modules, symlink, junction, Bun monkeypatch, preload, host resolution probe, second loader, product test mode or global runtime state is introduced. All fixture files remain under withTempWorkspace caseRoot and use its existing finally cleanup."
  - "The named delta test asserts exact exit and durable trace for 76 and both 77 forms, plus path-free stdout/stderr. No concrete resolved value, Error or output is persisted."
  - "Only one named unit command runs. A PASS, the still-valid 27/28 predecessor PASS evidence and two independent NO BLOCKER reviews may authorize one separately frozen real vertical-v7. This package does not rerun the contract file, production AppContainer, vertical-v6, old Gates, typecheck, imports, affected, Contract Freeze, slow matrix or Actions."
tests:
  - "bun test tests/unit/semantic-mutation-isolated-child-fence.test.ts --test-name-pattern 'staged loader classifies the manifest-bound TypeScript entry without exposing errors or paths' --timeout 180000"
  - "git diff --check -- docs/work-packages/sm3-isolated-verification-typescript-resolution-fixture-repair-v1.md docs/evidence/v0-4-semantic-mutation-isolated-verification-typescript-resolution-fixture-repair.json tests/unit/semantic-mutation-isolated-child-fence.test.ts"
---

# SM3 Isolated Verification TypeScript Resolution Fixture Repair V1

上一包的唯一失败不是产品 v2 分类错误，而是“删除 staged 包必然造成 resolution failure”的 fixture 假设错误：当前 Bun 找到了绝对 ancestor fallback，因此 77 才是正确结果。

本包只把这个歧义 fixture 拆成两个受控物理事实：最近合法 package 的 exports deny 用于 76，fixture-owned ancestor fallback 用于 77。production、binding、algebra、host、runtime plan 和 contract 全部冻结。
