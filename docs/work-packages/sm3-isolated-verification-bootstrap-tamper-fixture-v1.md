---
schema: codex-development-work-package-v1
id: sm3-isolated-verification-bootstrap-tamper-fixture-v1
tracking: issue-106
base: f29ecb73ac64aaae23b7989688c4a3ca79593d43
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v5
tasks:
  - id: align-bootstrap-tamper-sentinel-with-digest-gate
    owner: a0
    ownedPaths:
      - docs/work-packages/sm3-isolated-verification-bootstrap-tamper-fixture-v1.md
      - docs/evidence/v0-4-semantic-mutation-isolated-verification-bootstrap-tamper-fixture.json
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
  - tests/unit/semantic-mutation-verification-adapter.test.ts
  - docs/03-MVP实施计划与路线图.md
  - docs/04-AI自主实现执行蓝图.md
  - docs/14-Engineering IR与语义事实规范.md
  - docs/test-feedback-and-ci-lanes.md
  - docs/evidence/v0-4-semantic-mutation-isolated-verification-termination-trace-repair.json
  - docs/work-packages/sm3-isolated-verification-termination-trace-repair-v1.md
acceptance:
  - "The consumed terminal repair evidence remains exact: docs/evidence/v0-4-semantic-mutation-isolated-verification-termination-trace-repair.json sha256:fd04a419982e12ea270d028afa5a9875b1d0661bc48c2b81701f2739e1789fcc."
  - "The predecessor unit sentinel remains exact: tests/unit/semantic-mutation-isolated-child-fence.test.ts sha256:f20e8aeb9b6dfcaab662a53dbe5089c8b0cad2195369d3f945b9adf09e9c11a9."
  - "Only the bootstrap tamper construction changes. It copies the materialized bootstrap bytes, flips exactly one byte, preserves total size and then asserts the existing destination-manifest digest rejection."
  - "No expectation is widened to accept both structure and manifest errors. The sentinel continues proving that same-size bootstrap byte tamper cannot cross the exact runtime launch manifest."
  - "No production, contract, adapter, selector, authority, timeout, AppContainer, profile, registry or canonical Verification surface changes."
  - "Exactly one filtered unit invocation runs. Its PASS combines only with the 53 unaffected PASS results from the consumed evidence; the terminal predecessor batch is not rerun."
  - "A combined 54/54 PASS authorizes only a separately frozen real add-state-transition vertical-v4. It does not authorize typecheck, imports, affected, Contract Freeze, commit, push or merge."
tests:
  - "bun test tests/unit/semantic-mutation-isolated-child-fence.test.ts -t \"runtime plan rejects cloned bindings, stale sources, destination tamper, and extra empty directories\" --timeout 180000"
  - "git diff --check -- tests/unit/semantic-mutation-isolated-child-fence.test.ts docs/work-packages/sm3-isolated-verification-bootstrap-tamper-fixture-v1.md docs/evidence/v0-4-semantic-mutation-isolated-verification-bootstrap-tamper-fixture.json"
---

# SM3 Isolated Verification Bootstrap Tamper Fixture V1

前一 focused batch 的唯一失败来自 test fixture：它用不同长度字符串替换 bootstrap，因此 production 在更早的 exact structure-size gate 正确阻断，而断言只接受后续 digest gate 文案。

本包只把 tamper 改成 same-size 单字节翻转，使 sentinel 精确验证 bootstrap digest binding。前包 53 个有效 PASS 不重跑；production 与所有工程 authority 均保持不变。
