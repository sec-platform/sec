---
schema: codex-development-work-package-v1
id: sm3-isolated-verification-child-outcome-contract-fixture-v1
tracking: issue-106
base: f29ecb73ac64aaae23b7989688c4a3ca79593d43
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v5
tasks:
  - id: align-child-outcome-contract-source-sentinel
    owner: a0
    ownedPaths:
      - docs/work-packages/sm3-isolated-verification-child-outcome-contract-fixture-v1.md
      - docs/evidence/v0-4-semantic-mutation-isolated-verification-child-outcome-contract-fixture.json
      - tests/contract/semantic-mutation-apply-contract.test.ts
forbiddenPaths:
  - .github/
  - AGENTS.md
  - package.json
  - bun.lock
  - scripts/
  - platform/
  - tests/unit/
  - tests/integration/
  - tests/contract/test-impact.test.ts
  - docs/03-MVP实施计划与路线图.md
  - docs/04-AI自主实现执行蓝图.md
  - docs/14-Engineering IR与语义事实规范.md
  - docs/test-feedback-and-ci-lanes.md
  - docs/evidence/v0-4-semantic-mutation-isolated-verification-child-outcome-repair.json
  - docs/work-packages/sm3-isolated-verification-child-outcome-repair-v1.md
acceptance:
  - "The consumed terminal repair evidence remains exact: docs/evidence/v0-4-semantic-mutation-isolated-verification-child-outcome-repair.json sha256:e1fca68e72fffe6d03ec5e33defe249c0c1ee34a858eadf3ba895fb9437339b1."
  - "The predecessor contract test is exact: tests/contract/semantic-mutation-apply-contract.test.ts sha256:58e60b98019f7c4afcb40a3862785f1721709f65318eefe5c918724f9d4539c0."
  - "The production child outcome, host and runner remain byte-exact at sha256:1e9a650a84b5f20dac99eced505d79cd86cd7e6cf58031ed71fe0ba117e7aabc, sha256:12167894b77f625d9ca2a39294ea44873c33173c8346709329421211da897a6a and sha256:8baddc3bcbd59738639a342270fbce3ac444044b62ba0c0e96f90593f074eeb5."
  - "The failed literal stage: 'artifact-missing' sentinel is replaced by exact assertions for the exported failure-stage member and the artifactFailureStage missing mapping."
  - "No production source, runtime behavior, public type, selector, Verification artifact, unit test or other contract assertion changes."
  - "The predecessor 50 PASS results remain reusable because this successor changes only the one failed source-string assertion."
  - "Exactly one contract-file batch runs after independent static review. A failure is terminal and cannot be rerun under this manifest."
  - "A successor PASS composes with the predecessor 50 PASS results and authorizes only the separately frozen real add-state-transition vertical; it does not authorize typecheck, imports, affected, Contract Freeze, commit, push or merge."
tests:
  - "bun test tests/contract/semantic-mutation-apply-contract.test.ts --timeout 180000"
  - "git diff --check -- tests/contract/semantic-mutation-apply-contract.test.ts docs/work-packages/sm3-isolated-verification-child-outcome-contract-fixture-v1.md docs/evidence/v0-4-semantic-mutation-isolated-verification-child-outcome-contract-fixture.json"
---

# SM3 Isolated Verification Child Outcome Contract Fixture V1

前包的 15 个 host/writer unit、7 个 Verification adapter、21 个 test-impact 和 7 个其余 Semantic Mutation contract tests 均已通过；唯一失败是 source-text sentinel 把 ternary mapping 错写成 object-literal 形态。

本包只把该 sentinel 对齐到现有 production source：分别冻结 exported failure-stage member 与 `artifactFailureStage()` 的 missing mapping。Production、其它测试与已通过证据保持不变。
