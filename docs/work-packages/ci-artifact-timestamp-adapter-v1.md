---
schema: codex-development-work-package-v1
id: ci-artifact-timestamp-adapter-v1
tracking: issue-106
base: "a80c78ba336bd91ec92bd2e2a197e388f44096ca"
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v6
tasks:
  - id: ci-artifact-timestamp-adapter
    owner: a0
    ownedPaths:
      - .github/workflows/sec-merge-gate.yml
      - docs/work-packages/ci-artifact-timestamp-adapter-v1.md
      - scripts/codex/github-artifact-metadata.cjs
      - tests/contract/sec-merge-gate.test.ts
      - tests/unit/github-artifact-metadata-contract.test.ts
forbiddenPaths:
  - bun.lock
  - package.json
  - docs/work-packages/ci-linux-reference-sentinels-v1.md
  - docs/work-packages/ci-sm3-p0-contract-transition-v1.md
  - platform/
  - scripts/ci-pr-risk.ts
  - scripts/ci-verification.ts
  - scripts/codex/merge-gate.ts
  - tests/e2e/
acceptance:
  - "GitHub whole-second RFC3339 artifact expiry is strictly accepted at the API boundary and canonicalized to the internal millisecond UTC representation."
  - "Initial artifact resolution and final live revalidation share one adapter for expiry, digest, expired state, safety lifetime, and archive-size validation."
  - "Malformed, normalized-invalid, non-UTC, expired, unsafe-lifetime, invalid-digest, non-positive, fractional, and oversized metadata fail closed."
  - "The internal merge-gate artifact contract remains strict and unchanged; no evidence schema, selector, Gate plan, product path, runtime version, Playwright surface, or AppContainer capability changes."
  - "This trust-root repair is manually bootstrapped and does not self-authorize, complete PR #118, or declare SM-3 complete."
tests:
  - "bun test tests/unit/github-artifact-metadata-contract.test.ts --timeout 180000"
  - "bun test tests/contract/sec-merge-gate.test.ts --test-name-pattern 'trusted workflows pin actions' --timeout 180000"
  - "bun test tests/unit/codex-work-package-contract.test.ts --timeout 180000"
  - "bun run typecheck"
  - "bun run docs:doctor"
  - "SEC_IMPORTS_CHANGED_ONLY=1 SEC_CHANGED_BASE=a80c78ba336bd91ec92bd2e2a197e388f44096ca bun run imports:check"
  - "git diff --check"
---

# CI Artifact Timestamp Adapter V1

Base-side merge-gate run `29654519134` 在 artifact resolution 阶段拒绝了有效 scope artifact。GitHub REST metadata 为 artifact `8432436673`、ZIP `677` bytes、`expired=false`、digest `sha256:bf2e2922dd0d74da8d6db8854df5eacad1f657fb4f7e2f79ff59f259a2a7e9e4`、expiry `2026-10-16T17:42:35Z`；对应 verification artifact `8432453201` 为 `1393` bytes、digest `sha256:32e2f4c2f94b9b7e0c295a2f7748eea839162386a8672489d3a282bca2bf0354`、expiry `2026-10-16T17:43:52Z`。两者内容、digest、archive size 与剩余 lifetime 均有效。

失败来自把外部秒精度 RFC3339 与内部 canonical ISO 当成同一文本：`new Date("...35Z").toISOString()` 返回 `...35.000Z`。本包在 GitHub API ingress 对已审核的 whole-second 或 canonical millisecond UTC 表示进行严格验证并统一成内部格式；resolution 与 final reread 复用同一 adapter，内部 merge-gate schema 保持不变。

本包修改 default-branch verifier trust root，必须由旧 base 的本地证据和人工审查 bootstrap，候选 workflow 不得自证。合入后 #118 需基于新 base 重新冻结 exact-key attestation/verification；本包本身不完成 #118、AppContainer 或 SM-3。
