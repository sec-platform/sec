---
schema: codex-development-work-package-v1
id: repository-audit-trust-root-closure-v2
tracking: issue-132
base: 9043b7f0e22f9437a85bae59726456eb57ceb874
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v17
tasks:
  - id: freeze-and-integrate-control-plane
    owner: a0
    ownedPaths:
      - docs/archive/work-packages/agent-skills-and-v19-alignment-v2.md
      - docs/archive/work-packages/project-runtime-owner-split-v1.md
      - docs/archive/work-packages/repository-audit-skill-v1.md
      - docs/work-packages/agent-skills-and-v19-alignment-v2.md
      - docs/work-packages/project-runtime-owner-split-v1.md
      - docs/work-packages/repository-audit-skill-v1.md
      - docs/work-packages/repository-audit-trust-root-closure-v2.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
  - id: repair-audit-and-risk-trust-root
    owner: repository-audit-worker
    ownedPaths:
      - .agents/skills/sec-architecture-evolution/SKILL.md
      - .agents/skills/sec-heuristic-governance/SKILL.md
      - .agents/skills/sec-repository-audit/SKILL.md
      - AGENTS.md
      - docs/00-文档索引与一致性规则.md
      - docs/04-AI自主实现执行蓝图.md
      - docs/05-编译器核心实现规格.md
      - docs/governance/agent-skills-and-development-run-kernel.md
      - package.json
      - platform/shared/agent-skill-contract.ts
      - platform/shared/test-impact-rules/governance.ts
      - platform/shared/test-impact-rules/verification.ts
      - scripts/ci-pr-risk.ts
      - scripts/ci-verification.ts
      - scripts/codex/exact-git-blob.ts
      - scripts/codex/repository-audit.ts
      - scripts/discover-all.ts
      - tests/contract/agent-skills.test.ts
      - tests/contract/ci-lanes.test.ts
      - tests/contract/discover-all.test.ts
      - tests/contract/docs-doctor.test.ts
      - tests/contract/repository-audit.test.ts
      - tests/contract/sandbox-architecture-contract.test.ts
      - tests/contract/sec-merge-gate.test.ts
      - tests/contract/test-impact.test.ts
      - tests/unit/ci-evidence-composition-policy-registry.test.ts
      - tests/unit/ci-pr-risk-execution.test.ts
      - tests/unit/ci-pr-risk-selection.test.ts
      - tests/unit/ci-verification-execution.test.ts
      - tests/unit/ci-verification-v7-execution.test.ts
      - tests/unit/exact-git-blob.test.ts
forbiddenPaths:
  - .github/workflows/
  - bun.lock
  - docs/scripts/docs-doctor.ts
  - docs/test-feedback-and-ci-lanes.md
  - platform/compiler/
  - platform/dev-runner/
  - platform/orchestrator/
  - platform/shared/ci-evidence-contract.ts
  - scripts/codex/document-control-plane-contract.ts
  - scripts/codex/merge-gate.ts
  - scripts/codex/work-package-contract.ts
  - tests/e2e/
acceptance:
  - "The repository contains exactly seventeen strict AgentOperation Skills and seventeen machine-registered repository behaviors with a one-to-one owner mapping."
  - "Full repository analysis remains a distinct sec-repository-audit Skill and repository orientation remains a minimal-context operation."
  - "Every tracked exact-tree entry has one explicit content-coverage ledger result; inaccessible, unsupported, invalid, oversized or otherwise unscanned content fails as an inspectable unknown unless deterministically proven irrelevant."
  - "Extensionless and template text, large text, operational Agent comments in tests, submodules, NUL or invalid text, and known binary boundaries have adversarial contract coverage without promoting test names or historical fixtures to authority."
  - "Chinese and English Agent directives are extracted from bounded logical comment, list and fence context while retaining the directive's exact path, line, text and Skill ledger."
  - "Risk and Quick/Full evidence producers share one exact-revision reader, read the selected manifest only from the captured HEAD ordinary Git blob and bind its raw bytes; checkout CRLF normalization cannot change manifestDigest or inputDigest."
  - "Manifest lookup, missing/non-ordinary-blob revisions, CRLF checkout behavior and end-of-run HEAD/tree drift are covered by focused executable tests, and trusted base-side parsing accepts only the exact raw manifest identity."
  - "The shared exact-blob helper is included in the TCB dispatcher closure and both Evidence producers select their direct execution contracts through the canonical test-impact owner."
  - "The prior audit, governance, documentation simplification, runtime dependency ownership and discover-all call-relation closures remain intact."
  - "All base-to-candidate changed records have exactly one owner and no forbidden intersection; the final candidate is one clean single-parent commit on current main."
  - "Because the candidate changes verifier and toolchain trust roots, it requires independent exact-head Review, one fresh selected Risk, trusted base-side manual bootstrap and TASK_RESTART_REQUIRED after merge."
tests:
  - "bun test tests/contract/repository-audit.test.ts tests/unit/exact-git-blob.test.ts tests/unit/ci-pr-risk-execution.test.ts tests/unit/ci-verification-execution.test.ts --timeout 180000"
  - "bun test tests/contract/agent-skills.test.ts tests/contract/ci-lanes.test.ts tests/contract/discover-all.test.ts tests/contract/docs-doctor.test.ts tests/contract/repository-audit.test.ts tests/contract/sandbox-architecture-contract.test.ts tests/contract/sec-merge-gate.test.ts tests/contract/test-impact.test.ts tests/unit/ci-evidence-composition-policy-registry.test.ts tests/unit/ci-pr-risk-selection.test.ts tests/unit/ci-pr-risk-execution.test.ts tests/unit/ci-verification-execution.test.ts tests/unit/ci-verification-v7-execution.test.ts tests/unit/exact-git-blob.test.ts --timeout 180000"
  - "bun run typecheck"
  - "bun run docs:doctor"
  - "bun run audit:repository"
  - "bun run imports:freeze"
---

# 全仓库审计与 Risk Evidence 信任根收口 V2

本包继承已验证的全仓审计、17 个行为 owner、三项独立 Skill、文档去重和 `discover-all` 闭包，只修复独立 exact-head Review 与 Risk Evidence Review 已证明的决定性缺口。

审计器必须对 exact tree 的每个 tracked entry 给出可检查的内容覆盖结果，并在任何未覆盖边界 fail closed；所有 Evidence producer 必须通过同一 reader 绑定 captured HEAD 的 exact Git ordinary blob 原始字节，不得让 checkout normalization 或运行期间 HEAD 漂移成为第二 manifest identity。候选改变验证信任根，不能自证。
