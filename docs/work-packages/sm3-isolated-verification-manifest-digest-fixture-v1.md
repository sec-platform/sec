---
schema: codex-development-work-package-v1
id: sm3-isolated-verification-manifest-digest-fixture-v1
tracking: issue-106
base: f29ecb73ac64aaae23b7989688c4a3ca79593d43
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v5
tasks:
  - id: align-manifest-digest-fixture
    owner: a0
    ownedPaths:
      - docs/work-packages/sm3-isolated-verification-manifest-digest-fixture-v1.md
      - docs/evidence/v0-4-semantic-mutation-isolated-verification-manifest-digest-fixture.json
      - tests/unit/semantic-mutation-isolated-child-fence.test.ts
forbiddenPaths:
  - .github/
  - AGENTS.md
  - package.json
  - bun.lock
  - scripts/
  - platform/
  - tests/contract/
  - tests/integration/
  - docs/03-MVP实施计划与路线图.md
  - docs/04-AI自主实现执行蓝图.md
  - docs/14-Engineering IR与语义事实规范.md
  - docs/test-feedback-and-ci-lanes.md
  - docs/evidence/v0-4-semantic-mutation-isolated-verification-feedback-repair.json
  - docs/evidence/v0-4-semantic-mutation-isolated-verification-fixture-alignment.json
  - docs/work-packages/sm3-isolated-verification-feedback-repair-v1.md
  - docs/work-packages/sm3-isolated-verification-fixture-alignment-v1.md
acceptance:
  - "The consumed failed fixture-alignment evidence remains exact and is never rerun under its manifest: sha256:df6ef86b1955f707e4921a86c63e57441f204149a2c4dae80ca3ca31ae5816e4."
  - "Production orchestrator and isolated child remain byte-exact: sha256:26c1bc4204aa028838b3fb20c2f1f1381e5e24f4640d0101625dba89b4d386af and sha256:62a5fcdc84d758151179a11d676da7e5a1a0d5d7515440ddf0983521521ccd98."
  - "The runner tamper changes console.log(\"runner\") to console.log(\"tamper\"); both UTF-8 payloads are exactly 21 bytes."
  - "The same-length tamper crosses the exact destination structure/size boundary and freezes destination manifest is not exact at the digest boundary."
  - "The final readback remains exact and expects console.log(\"tamper\")."
  - "No production source, contract test, runtime algorithm, authority, timeout, AppContainer, profile cleanup, lease, journal, publish or recovery behavior changes."
  - "Exactly one focused batch runs. It launches no production AppContainer, registry query, recovery, cleanup, old Gate or product vertical."
  - "A PASS authorizes only a separately frozen real add-state-transition vertical. It does not authorize typecheck, imports, affected, Contract Freeze, Quick/Risk/Full, workspace/reference, Actions, commit, push or merge."
tests:
  - "bun test tests/unit/semantic-mutation-isolated-child-fence.test.ts tests/contract/semantic-mutation-apply-contract.test.ts --timeout 180000"
  - "git diff --check -- tests/unit/semantic-mutation-isolated-child-fence.test.ts docs/work-packages/sm3-isolated-verification-manifest-digest-fixture-v1.md docs/evidence/v0-4-semantic-mutation-isolated-verification-manifest-digest-fixture.json"
---

# SM3 Isolated Verification Manifest Digest Fixture V1

前包已证明十空格顺序合同、canonical compose-template destination 与 extra-directory structure 诊断都正确；唯一失败是 tamper payload 改变了字节长度，因此在 digest 之前被结构/size fence 拒绝。

本包只把 tamper 与 readback 改为同长度的 `console.log("tamper")`，精确抵达 manifest digest mismatch。成功后不重跑任何前包；下一步只能另冻真实 add-state-transition 纵切面。
