---
schema: codex-development-work-package-v1
id: sm3-isolated-verification-artifact-read-diagnosis-v1
tracking: issue-106
base: f29ecb73ac64aaae23b7989688c4a3ca79593d43
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v5
tasks:
  - id: diagnose-isolated-artifact-read
    owner: a0
    ownedPaths:
      - docs/work-packages/sm3-isolated-verification-artifact-read-diagnosis-v1.md
      - docs/evidence/v0-4-semantic-mutation-isolated-verification-artifact-read-diagnosis.json
forbiddenPaths:
  - .github/
  - AGENTS.md
  - package.json
  - bun.lock
  - platform/
  - scripts/
  - tests/
  - docs/03-MVP实施计划与路线图.md
  - docs/04-AI自主实现执行蓝图.md
  - docs/14-Engineering IR与语义事实规范.md
  - docs/test-feedback-and-ci-lanes.md
  - docs/evidence/v0-4-semantic-mutation-add-state-transition-vertical-v2-verification.json
acceptance:
  - "The terminal vertical-v2 failure remains exact and is never rerun under its manifest: sha256:876a3663a57f4e3b81419fcfd50b73b7a6864267522e0d3994339867cbcc8f2c."
  - "The diagnosis uses only live source and exact hashes; it runs no test, AppContainer, profile/registry probe, cleanup, old Gate or network operation."
  - "The diagnosis distinguishes the observable protocol collapse from the still-unknown isolated child root cause."
  - "It preserves nonzero child plus complete canonical failed Verification artifacts as a valid failed outcome and rejects an early exit-code shortcut."
  - "It authorizes only a separately frozen failure-only transient child-outcome repair; no retry, timeout increase, commit, push, Actions or merge is authorized."
tests:
  - "git diff --check -- docs/work-packages/sm3-isolated-verification-artifact-read-diagnosis-v1.md docs/evidence/v0-4-semantic-mutation-isolated-verification-artifact-read-diagnosis.json"
---

# SM3 Isolated Verification Artifact Read Diagnosis V1

真实纵切面已把旧的无类型 blocked 收敛为 `isolatedVerification.stage = artifact-read`，但该 stage 同时覆盖 post-supervisor fence、staging-tree、四个 report 的 missing/read/JSON parse，仍不是 child 根因。

本包只冻结 live-source 因果链。下一步必须新增 failure-only、脱敏、原子发布的 transient child outcome receipt；它只能把失败分类得更精确，不能加入 canonical Verification artifact set 或使任何结果升级为 PASS。
