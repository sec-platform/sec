---
schema: codex-development-work-package-v1
id: ci-v7-evidence-composition-bootstrap-v1
tracking: none
base: "01d5c45a573337bee484d6a9d2effb2a76787b86"
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v6
tasks:
  - id: ci-v7-bootstrap
    owner: ci-v7-writer
    ownedPaths:
      - .github/workflows/
      - docs/test-feedback-and-ci-lanes.md
      - docs/work-packages/ci-v7-evidence-composition-bootstrap-v1.md
      - platform/dev-runner/test-runner.ts
      - platform/shared/
      - scripts/ci-verification.ts
      - scripts/codex/
      - tests/contract/ci-contract.test.ts
      - tests/contract/sec-merge-gate.test.ts
      - tests/fixtures/ci-evidence-reuse/
      - tests/unit/
forbiddenPaths:
  - frontend/
  - platform/compiler/
  - platform/orchestrator/
  - source/
acceptance:
  - Work Package V2 只能选择 base 注册的 evidence composition policy
  - 受保护 P0 transition 在 runner 与 merge gate 中都强制使用真实 V2 policy
  - Evidence V3 完整绑定 selection coverage reuse delta argv 与 child environment
  - merge gate 从 exact Git objects 独立重算 changed records inventory policy 与 expected plan
  - verifier trust root 使用 mode type blob identity 且 artifact identity 升级为 V7
  - scope attestation 在 trusted checkout 后持久化 exact request 与 manifest bytes
  - P0 composition plan 不包含 Playwright 并保持 capabilityComplete false
tests:
  - bun run typecheck
  - bun test focused CI V7 contract batch
  - bun run docs:doctor
  - changed-only imports check
  - git diff --check
---

# CI V7 Evidence Composition Bootstrap

本 Work Package 只冻结 CI V7 evidence composition、真实 P0 policy、hosted runner、base-side merge reconciliation、workflow trust root 与相应合同测试。它不执行 P0 production sentinel，不改变 AppContainer capability 结论，也不宣告 SM-3 完成。

该提交修改 verifier trust root，因此现有 hosted gate 必须报告 `manual-bootstrap-required`；由 A0 按 bootstrap 审查与本地证据完成合并，不能让候选 verifier 自证。
