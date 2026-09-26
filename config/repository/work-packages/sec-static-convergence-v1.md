---
schema: codex-development-work-package-v1
id: sec-static-convergence-v1
tracking: issue-311
base: 3e6e789faf5195b6a9ac848a2f1f6dc20d50eab5
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: converge-verification-architecture
    owner: verification-control-plane-owner
    ownedPaths:
      - config/repository/work-packages/sec-static-convergence-v1.md
      - docs/架构/总体设计.md
      - docs/运行/保证/要求证据与裁决.md
      - docs/运行/验收/方法与独立证据.md
      - docs/运行/验收/测试生成与形式方法.md
      - docs/演进/实施/安全构建发布与环境.md
      - .agents/skills/sec-test-design/SKILL.md
      - .documentation/source-manifest.json
forbiddenPaths:
  - .github/
  - AGENTS.md
  - package.json
  - bun.lock
  - config/repository/active-work-package.md
  - config/repository/current-state.yaml
  - config/repository/rolling-plan.md
  - config/repository/work-selection.md
  - src/
  - tests/
acceptance:
  - Claim identity binds owner requirement subject revision applicability lifecycle and consumer scope rather than relying on free claim or gate strings
  - Verification is defined as a cross-responsibility assurance vertical rather than an eleventh testing module
  - Requirement Claim ProofObligation VerificationMethod VerificationAction Evidence and Verdict have explicit non-substitutable ownership boundaries
  - Testing is one VerificationMethod and repository facts that can be checked directly are not required to be mirrored as test cases
  - TestCase responsibility retains stable identity owner obligation Failure Meaning observation boundary environment resource oracle independence and retirement semantics
  - Bun remains the adopted ordinary TypeScript test execution provider while Vitest requires exact-corpus adoption evidence and Playwright is browser-capability-only
  - ordinary provider scheduling mechanics are distinguished from SEC-owned semantic selection resource authority settlement and result truth
  - fast slow suite path title timeout and parallel-safe labels are execution or locator projections rather than semantic test identity
  - proof-economy dispositions distinguish keep rewrite merge delete and unknown without deleting required independent observations
  - Verification semantic logic is assigned to assurance compiler application execution adapters entry and bootstrap according to the canonical ten-responsibility architecture
  - existing WorkSelection active pointer rolling plan and current-state control files are unchanged by this documentation convergence
  - documentation source manifest is refreshed for every changed authoritative documentation source
tests:
  - docs:doctor
  - tests/contract/agent-skills.test.ts
---

# Verification architecture convergence

This package updates the current SEC verification and test architecture authority without creating a second roadmap, test registry, scheduler, or Verification result model.

It makes explicit that testing is a case-based Verification method rather than the whole verification system, assigns Requirement/Claim/Assurance/Execution/Provider/Evidence/Verdict responsibilities, constrains provider adoption, and records the retirement direction for hand-built runner mechanics and test-shaped repository invariants.

The package does not activate or reorder work-selection state. Implementation slices remain selected by the existing WorkSelection and Verification Control Plane owners after this design authority is merged and read back.
