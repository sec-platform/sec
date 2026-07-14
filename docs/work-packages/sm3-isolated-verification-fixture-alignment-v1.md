---
schema: codex-development-work-package-v1
id: sm3-isolated-verification-fixture-alignment-v1
tracking: issue-106
base: f29ecb73ac64aaae23b7989688c4a3ca79593d43
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v5
tasks:
  - id: align-isolated-verification-fixtures
    owner: a0
    ownedPaths:
      - docs/work-packages/sm3-isolated-verification-fixture-alignment-v1.md
      - docs/evidence/v0-4-semantic-mutation-isolated-verification-fixture-alignment.json
      - tests/contract/semantic-mutation-apply-contract.test.ts
      - tests/unit/semantic-mutation-isolated-child-fence.test.ts
forbiddenPaths:
  - .github/
  - AGENTS.md
  - package.json
  - bun.lock
  - scripts/
  - platform/
  - docs/03-MVP实施计划与路线图.md
  - docs/04-AI自主实现执行蓝图.md
  - docs/14-Engineering IR与语义事实规范.md
  - docs/test-feedback-and-ci-lanes.md
  - docs/evidence/v0-4-semantic-mutation-add-state-transition-vertical-verification.json
  - docs/evidence/v0-4-semantic-mutation-isolated-verification-feedback-repair.json
  - docs/work-packages/sm3-isolated-verification-feedback-repair-v1.md
acceptance:
  - "The consumed failed focused evidence remains exact and is never rerun under its manifest: sha256:80343e56514b74400c3262d04129b1737a489ccc5de9f58f189e27296c85e83a."
  - "Production orchestrator and isolated child remain byte-exact: sha256:26c1bc4204aa028838b3fb20c2f1f1381e5e24f4640d0101625dba89b4d386af and sha256:62a5fcdc84d758151179a11d676da7e5a1a0d5d7515440ddf0983521521ccd98."
  - "The contract fixture freezes the current ten-space nativeRequest indentation and retains exact create-profile-before-execute ordering."
  - "The materialization sentinel reads the canonical platform/compiler/compose/templates destination already owned by the runtime plan."
  - "The extra-directory case freezes the earlier exact-structure diagnostic; the byte-tamper case continues to freeze the exact-manifest diagnostic."
  - "No production source, runtime algorithm, authority, timeout, AppContainer, profile cleanup, lease, journal, publish or recovery behavior changes."
  - "Exactly one focused batch runs. It launches no production AppContainer, registry query, recovery, cleanup, old Gate or product vertical."
  - "A PASS authorizes only a separately frozen real add-state-transition vertical. It does not authorize typecheck, imports, affected, Contract Freeze, Quick/Risk/Full, workspace/reference, Actions, commit, push or merge."
tests:
  - "bun test tests/unit/semantic-mutation-isolated-child-fence.test.ts tests/contract/semantic-mutation-apply-contract.test.ts --timeout 180000"
  - "git diff --check -- tests/contract/semantic-mutation-apply-contract.test.ts tests/unit/semantic-mutation-isolated-child-fence.test.ts docs/work-packages/sm3-isolated-verification-fixture-alignment-v1.md docs/evidence/v0-4-semantic-mutation-isolated-verification-fixture-alignment.json"
---

# SM3 Isolated Verification Fixture Alignment V1

前包的新 redaction 与 planning seam 已通过对应 sentinel，但同一批次随后暴露三个既有 fixture drift。当前包只把测试对齐到已经存在的 runtime/source truth；不修改任何 production 文件，也不把失败解释为产品回归。

本包成功后仍不重跑前包。下一步只能另冻真实 add-state-transition 纵切面，用 typed `SEMANTIC-MUTATION-010` details 判定实际 execution root cause。
