---
schema: codex-development-work-package-v1
id: b0-bootstrap-v1
tracking: issue-106
base: 12126f808aec14ee2e4475cc59c74bf76bdb5fe0
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v4
tasks:
  - id: b0-control-plane
    owner: a0
    ownedPaths:
      - .github/workflows/compiler-pr-validation.yml
      - .github/workflows/compiler-release-validation.yml
      - .github/workflows/sec-merge-gate.yml
      - docs/04-AI自主实现执行蓝图.md
      - docs/test-feedback-and-ci-lanes.md
      - docs/work-packages/b0-bootstrap-v1.md
      - platform/dev-runner/test-runner.ts
      - platform/shared/ci-contract.ts
      - platform/shared/ci-evidence-contract.ts
      - platform/shared/ci-git-changed-files.ts
      - platform/shared/ci-pr-risk-selection.ts
      - platform/shared/ci-verification-plan.ts
      - scripts/ci-pr-risk.ts
      - scripts/ci-verification.ts
      - scripts/codex/
      - tests/contract/ci-contract.test.ts
      - tests/contract/ci-lanes.test.ts
      - tests/contract/sec-merge-gate.test.ts
      - tests/testkit/contracts.ts
      - tests/unit/ci-git-changed-files.test.ts
      - tests/unit/ci-pr-risk-execution.test.ts
      - tests/unit/ci-pr-risk-selection.test.ts
      - tests/unit/ci-verification-execution.test.ts
      - tests/unit/codex-work-package-contract.test.ts
forbiddenPaths:
  - AGENTS.md
  - PLANS.md
  - README.md
  - bun.lock
  - bunfig.toml
  - package.json
  - tsconfig.json
  - docs/03-MVP实施计划与路线图.md
  - docs/14-Engineering IR与语义事实规范.md
  - platform/cli/
  - platform/compiler/
  - platform/orchestrator/
  - platform/policies/
  - platform/registry/
  - platform/upgrade/
  - source/
acceptance:
  - "Frozen head is one commit whose only parent is the live target-main base."
  - "Default-branch trusted scope attestation binds the PR, base, head, manifest bytes, profile, revision, run, attempt, and authorized actor."
  - "Every manifest read resolves the exact commit tree entry as an ordinary blob and binds its blob identity, raw digest, and byte length without Contents API symlink dereferencing."
  - "Hosted verification writes canonical Evidence V2 for every capturable pass or failure and cannot publish merge authority."
  - "The base-side merge gate recomputes changed records and the canonical required gate plan, then requires exact non-empty passed evidence."
  - "A newer attestation, verification, or revalidation attempt invalidates prior merge authority before evaluation; head-keyed cancellation and cancellation-safe finalization prevent an older run from publishing late success."
  - "Immediately before success, the gate re-reads the live open non-draft PR, exact head/base and locator, same-head uniqueness, manifest blob identity, newest exact-key run attempts, actor permissions, and artifact TTL."
  - "Candidate changes to the verifier trust-root closure fail closed and require a later bootstrap path instead of self-verification."
  - "The only required status is sec/merge-gate; privileged jobs execute only default-branch trusted code and never execute PR-head code."
  - "Evidence artifacts are immutable for the run attempt, retained for 90 days, and have at least 24 hours of remaining lifetime at success."
  - "B0 changes no compiler, product runtime, Engineering IR, dependency, or repository-level Agent contract."
tests:
  - "bun test tests/unit/ci-git-changed-files.test.ts tests/unit/ci-pr-risk-selection.test.ts tests/unit/ci-pr-risk-execution.test.ts tests/unit/ci-verification-execution.test.ts tests/unit/codex-work-package-contract.test.ts tests/contract/ci-contract.test.ts tests/contract/ci-lanes.test.ts tests/contract/sec-merge-gate.test.ts --timeout 180000"
  - "bun run typecheck"
  - "bun run docs:doctor"
  - "git diff --check"
---

# B0 Bootstrap V1

B0 是 `ci-verification-v4` 的一次性人工 bootstrap：它把 frozen Work Package、scope attestation、exact-head Evidence V2 和 base-side merge gate 同时引入 `main`。由于这些验证器在 B0 base 中尚不存在，本 Work Package 不得以候选分支中的新 gate 自证；A0 必须依据本文件冻结的 scope、focused 本地证据和人工 diff 审查完成集成。

进入 `main` 后，普通 Work Package 必须经过 default-branch trusted 的 `scope attestation → hosted verification → merge gate` 链路。任何 verifier trust-root 变更都必须升级 contract revision，并继续使用旧 base harness、专门 bootstrap 或人工 integration，不能在普通 PR 中修改验证器后自证通过。
