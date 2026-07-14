---
schema: codex-development-work-package-v1
id: sm3-isolated-verification-staged-loader-failure-fixture-v1
tracking: issue-106
base: f29ecb73ac64aaae23b7989688c4a3ca79593d43
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v5
tasks:
  - id: make-loader-import-failure-fixture-deterministic
    owner: a0
    ownedPaths:
      - docs/work-packages/sm3-isolated-verification-staged-loader-failure-fixture-v1.md
      - docs/evidence/v0-4-semantic-mutation-isolated-verification-staged-loader-failure-fixture.json
      - tests/unit/semantic-mutation-isolated-child-fence.test.ts
forbiddenPaths:
  - .github/
  - AGENTS.md
  - package.json
  - bun.lock
  - platform/
  - scripts/
  - tests/contract/
  - tests/integration/
  - tests/unit/semantic-mutation-verification-adapter.test.ts
  - docs/03-MVP实施计划与路线图.md
  - docs/04-AI自主实现执行蓝图.md
  - docs/14-Engineering IR与语义事实规范.md
  - docs/test-feedback-and-ci-lanes.md
  - docs/evidence/v0-4-semantic-mutation-isolated-verification-staged-loader-repair.json
  - docs/work-packages/sm3-isolated-verification-staged-loader-repair-v1.md
acceptance:
  - "The terminal predecessor remains exact and is not rerun: docs/evidence/v0-4-semantic-mutation-isolated-verification-staged-loader-repair.json sha256:4940f6971f6cf60f0cbca94f8b463047dc77faa38fc9f4d9ef0fa1bd04488ab8 with 26 PASS and one fixture-only FAIL."
  - "The predecessor unit test is exact: tests/unit/semantic-mutation-isolated-child-fence.test.ts sha256:af816e2d8191aa9372f91ca15ecaa5cdc29acdf5a5e75906002e1c90179b06bf."
  - "The exact production progress, runtime plan and host sources remain sha256:cc6b6ab681e61310d4a777a9f230014fa793505cb52f5a601c221cea12bf6e90, sha256:5111020c3b65ef5fa404d7e4cc8da01e017b9667cd12e0a0c6be3de64910ee09 and sha256:8c147484261e37ce6e19475f473c7245f8c66680f2d296a9d0aff1fa66e6bcae."
  - "Only the failed test fixture changes: dependency failure cases keep a local package entry and replace its bytes with a deterministic top-level throw before capability capture."
  - "The fixture no longer relies on missing-entry resolution or ancestor lookup behavior. It still exercises the exact generated bootstrap, staged loader, materialized package tree and local Bun child."
  - "The TypeScript case must stop at loader-entered; the ts-morph case must stop at typescript-imported; the invalid core case must stop at core-import-started. All three exit as unclassified nonzero and expose no fixture path in stdout/stderr."
  - "No production, contract, external list, dependency closure, checkpoint graph, timeout, AppContainer, profile, registry or authority surface changes."
  - "Exactly one filtered invocation of the previously failed test runs. A PASS combines only with the 26 unaffected PASS results; the terminal predecessor batch is not rerun."
  - "Combined 27/27 PASS authorizes only a separately frozen real add-state-transition vertical-v5. It does not authorize typecheck, imports, affected, Contract Freeze, commit, push or merge."
tests:
  - "bun test tests/unit/semantic-mutation-isolated-child-fence.test.ts -t \"staged loader stops at the exact dependency or core import boundary without exposing errors\" --timeout 180000"
  - "git diff --check -- tests/unit/semantic-mutation-isolated-child-fence.test.ts docs/work-packages/sm3-isolated-verification-staged-loader-failure-fixture-v1.md docs/evidence/v0-4-semantic-mutation-isolated-verification-staged-loader-failure-fixture.json"
---

# SM3 Isolated Verification Staged Loader Failure Fixture V1

前包唯一失败来自新增 sentinel：删除本地 package entry 并没有在本地 Bun 环境中确定性制造 import rejection，实际 child exit 为 `0`。该观察不能推导 production 失败，也不能授权重跑完整 focused batch。

本包只把两个 dependency failure case 改为保留本地入口、让入口顶层确定性 throw。这样测试不再依赖 missing-entry resolution 语义；成功后与前包未失效的 26 个 PASS 组合为 27/27。
