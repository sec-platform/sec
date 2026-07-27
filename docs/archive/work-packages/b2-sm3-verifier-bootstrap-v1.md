---
schema: codex-development-work-package-v1
id: b2-sm3-verifier-bootstrap-v1
tracking: issue-106
base: e07a295b5a8499c2c55c78a783e5419911aae584
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v6
tasks:
  - id: b2-control-plane
    owner: a0
    ownedPaths:
      - docs/04-AI自主实现执行蓝图.md
      - docs/test-feedback-and-ci-lanes.md
      - docs/work-packages/b2-sm3-verifier-bootstrap-v1.md
      - platform/shared/ci-verification-plan.ts
      - platform/shared/test-impact-contract.ts
      - platform/shared/test-impact-rules/governance.ts
      - platform/shared/test-impact-rules/pipeline.ts
      - platform/shared/test-impact-rules/semantic.ts
      - platform/shared/test-ownership-contract.ts
      - scripts/run-work-package-gate.ts
      - tests/contract/ci-contract.test.ts
      - tests/contract/ci-lanes.test.ts
      - tests/contract/sec-merge-gate.test.ts
      - tests/contract/test-impact.test.ts
      - tests/unit/ci-pr-risk-execution.test.ts
      - tests/unit/ci-pr-risk-selection.test.ts
      - tests/unit/ci-verification-execution.test.ts
      - tests/unit/codex-work-package-contract.test.ts
      - tests/unit/observed-process-lifecycle.test.ts
      - tests/unit/windows-appcontainer-hardening-static.test.ts
      - tests/unit/work-package-gate-contract.test.ts
      - tests/unit/work-package-gate-execution.test.ts
forbiddenPaths:
  - AGENTS.md
  - PLANS.md
  - README.md
  - bun.lock
  - bunfig.toml
  - package.json
  - tsconfig.json
  - .github/workflows/
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
  - "B2 is manually integrated as a verifier trust-root bootstrap; candidate v6 code never certifies its own merge authority."
  - "The frozen integration head is one commit whose only parent is the live target-main base."
  - "The local Work Package execution snapshot binds and copies every tracked checkout regular file by its actual bytes, including clean CRLF or smudge drift hidden by Git diff."
  - "Hosted Work Package manifest identity remains the exact commit ordinary-blob raw digest and byte length; local EOL normalization is limited to the two manifest parsing call sites, while checkpoint and journal reads remain byte-exact."
  - "Shared observed-process lifecycle and optional AppContainer hardening have separate affected-test owners; declared-only ownership suppresses supplementary auto-reference when it would select AppContainer execution tests for generic Semantic Mutation changes."
  - "The seven retained SM-3 stop records and the reserved production PASS record have explicit work-package-gate ownership; unrelated evidence remains fail-closed."
  - "Selector rule files resolve only to verification/test-impact infrastructure and never self-select product owners or product slow suites."
  - "All current verifier identities advance to ci-verification-v6; v5 evidence, attestation and status cannot satisfy a v6 gate."
  - "B2 changes no compiler, product runtime, runtime dependency, Engineering IR authority, roadmap order, AppContainer capability claim, or repository-level Agent contract."
  - "No AppContainer execution, Playwright, exact production seam, Full, all-slow, workspace or reference Gate runs under B2."
tests:
  - "bun test tests/unit/codex-work-package-contract.test.ts tests/unit/ci-pr-risk-execution.test.ts tests/unit/ci-pr-risk-selection.test.ts tests/unit/ci-verification-execution.test.ts tests/unit/observed-process-lifecycle.test.ts tests/unit/windows-appcontainer-hardening-static.test.ts tests/unit/work-package-gate-contract.test.ts tests/unit/work-package-gate-execution.test.ts tests/contract/ci-contract.test.ts tests/contract/ci-lanes.test.ts tests/contract/sec-merge-gate.test.ts tests/contract/test-impact.test.ts --timeout 180000"
  - "bun run typecheck"
  - "bun run docs:doctor"
  - "git diff --check"
---

# B2 SM-3 Verifier Bootstrap V1

B2 修复两个在真实 Windows production seam 中暴露的 control-plane 缺口：clean checkout 的 CRLF/smudge 字节可能不出现在 `git diff`，旧 execution snapshot 因而不能证明复制的是被执行的 exact bytes；Semantic Mutation、shared observed-process 与 optional AppContainer hardening 的 affected ownership 互相耦合，又会在普通本地 child 变更时误选 AppContainer execution tests。

本包把实际 checkout bytes 纳入本地 snapshot identity、保持 hosted raw-blob identity 不变，并把 affected ownership 分离。它同时为已冻结的 SM-3 stop/PASS evidence 提供 exact ownership。由于 selector 与 verification revision 属 verifier trust root，B2 必须像 B0/B1 一样人工审查、单提交集成，不能由候选 v6 自证。B2 合并后，纯产品 P0 分支再从新 `main` 以普通 frozen Work Package 进入 v6 gate。
