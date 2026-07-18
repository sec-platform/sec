---
schema: codex-development-work-package-v1
id: ci-v7-run-name-bootstrap-v1
tracking: none
base: "e8f20b39525a87b8e6fb17b7d885239b4b1e17e7"
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v6
tasks:
  - id: ci-v7-run-name-bootstrap
    owner: a0
    ownedPaths:
      - .github/workflows/compiler-pr-validation.yml
      - .github/workflows/sec-merge-gate.yml
      - docs/work-packages/ci-v7-run-name-bootstrap-v1.md
      - tests/contract/sec-merge-gate.test.ts
forbiddenPaths:
  - .github/workflows/compiler-release-validation.yml
  - platform/
  - scripts/
  - tests/unit/
acceptance:
  - "compiler-pr-validation 与 sec-merge-gate 的 run-name 在 YAML 解析后保留完整 canonical 模板，不再被未引用的 # 截断。"
  - "verification producer title 与 workflow_run planner、artifact lookup 使用的 PR/profile/head/base regex 和 exact string 保持一致。"
  - "attestation producer title与 exact artifact discovery 使用的 event/PR/head/base/manifest identity 保持一致。"
  - "本包不改变任何 job logic、permissions、dispatch payload、Gate、artifact、title lookup shape 或 CI schema。"
tests:
  - "bun test tests/contract/sec-merge-gate.test.ts --timeout 180000"
  - "bun test tests/unit/codex-work-package-contract.test.ts --timeout 180000"
  - "bun run typecheck"
  - "bun run docs:doctor"
  - "git diff --check"
---

# CI V7 Run Name Bootstrap V1

GitHub Actions workflow 的 plain scalar 会把未引用的 `#` 解释为 YAML 注释起点。此前两个 producer 的 `run-name` 因此分别退化为 `verify frozen PR` 与 `sec-scope-attest-v1 PR`，而 base-side consumer 仍按完整 canonical title 查找 exact verification/attestation run，导致真实 artifact discovery 无法命中。

本 bootstrap 只给两个既有 `run-name` 标量增加 YAML-safe 引用，并以合同测试同时绑定解析后的 producer 模板、workflow-run regex 与 exact lookup strings。其余 trusted workflow 行为保持逐字节不变；作为 verifier trust-root 修复，本包由 A0 审查后集成，不由候选 workflow 自证。
