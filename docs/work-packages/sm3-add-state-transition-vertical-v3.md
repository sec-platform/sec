---
schema: codex-development-work-package-v1
id: sm3-add-state-transition-vertical-v3
tracking: issue-106
base: f29ecb73ac64aaae23b7989688c4a3ca79593d43
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v5
tasks:
  - id: prove-child-outcome-repaired-add-state-transition-apply
    owner: a0
    ownedPaths:
      - docs/work-packages/sm3-add-state-transition-vertical-v3.md
      - docs/evidence/v0-4-semantic-mutation-add-state-transition-vertical-v3-verification.json
forbiddenPaths:
  - .github/
  - AGENTS.md
  - package.json
  - bun.lock
  - platform/
  - tests/
  - scripts/
  - docs/03-MVP实施计划与路线图.md
  - docs/04-AI自主实现执行蓝图.md
  - docs/14-Engineering IR与语义事实规范.md
  - docs/test-feedback-and-ci-lanes.md
  - docs/evidence/v0-4-semantic-mutation-add-state-transition-vertical-v2-verification.json
  - docs/evidence/v0-4-semantic-mutation-isolated-verification-child-outcome-repair.json
  - docs/evidence/v0-4-semantic-mutation-isolated-verification-child-outcome-contract-fixture.json
  - docs/work-packages/sm3-add-state-transition-vertical-v2.md
  - docs/work-packages/sm3-isolated-verification-child-outcome-repair-v1.md
  - docs/work-packages/sm3-isolated-verification-child-outcome-contract-fixture-v1.md
acceptance:
  - "The terminal vertical-v2 failure remains immutable authority and is never rerun under its manifest: docs/evidence/v0-4-semantic-mutation-add-state-transition-vertical-v2-verification.json sha256:876a3663a57f4e3b81419fcfd50b73b7a6864267522e0d3994339867cbcc8f2c."
  - "The composed child-outcome focused chain terminates in an exact PASS: docs/evidence/v0-4-semantic-mutation-isolated-verification-child-outcome-contract-fixture.json sha256:8fca6f6614aabbf908ac28e601290ae605193bbd3ecabf10df345e4546ab0af3."
  - "The production orchestrator, child-outcome module, isolated host and runner are exact: sha256:26c1bc4204aa028838b3fb20c2f1f1381e5e24f4640d0101625dba89b4d386af, sha256:1e9a650a84b5f20dac99eced505d79cd86cd7e6cf58031ed71fe0ba117e7aabc, sha256:12167894b77f625d9ca2a39294ea44873c33173c8346709329421211da897a6a and sha256:8baddc3bcbd59738639a342270fbce3ac444044b62ba0c0e96f90593f074eeb5."
  - "The focused sentinels are exact: isolated child sha256:e1328952c9f4909c26b792f0e3faf68a833fb446b28ce21ee81418e8c017201e, Verification adapter sha256:443d21659436a87301ebbdb81c74559de39f807468dbdc5781ea6313f2d43dd9 and test-impact sha256:7f9a03eb2d9e8a51a6eb3ef18853087dfb68c2544600c7672fc7046e7f6ae0c8."
  - "The selected vertical inputs are exact: tests/contract/semantic-mutation-apply-contract.test.ts sha256:3e072afc71c91de47ce0924a9fc98f747e5a10be4fd609a75eba5e2fd738fd15 and tests/integration/semantic-mutation-apply.test.ts sha256:eb557a8cb6b70cb4d32282c94ce572abb467508018c7323412d792b54ecf16f1."
  - "Exactly one combined Bun child runs the two frozen files. No old owner selection, test-name filter, reporter retry, timeout increase, cleanup probe or second attempt is permitted."
  - "PASS requires every contract and integration test in both files to pass, including real isolated Verification, atomic publish, live rebuild, exact replay, collision rejection and all failure lifecycles."
  - "Any failure, timeout, missing summary or unexpected residue terminates this package. A typed child preflight, verify-all or postcondition stage, or a concrete first artifact missing/parse/read classification, determines a separately frozen successor."
  - "The run must not read, recover, rewrite or delete retained R2/R3 namespaces, snapshots, owner sidecars or external recovery workspaces."
  - "A PASS authorizes only separately frozen SM3 required-evidence selection. It does not authorize typecheck, imports, affected, Contract Freeze, Quick/Risk/Full, slow, workspace/reference, GitHub Actions, commit, push or merge."
tests:
  - "bun test tests/contract/semantic-mutation-apply-contract.test.ts tests/integration/semantic-mutation-apply.test.ts --timeout 600000"
  - "git diff --check -- docs/work-packages/sm3-add-state-transition-vertical-v3.md docs/evidence/v0-4-semantic-mutation-add-state-transition-vertical-v3-verification.json"
---

# SM3 Add State Transition Vertical V3

Vertical-v2 已把真实母例收敛到 host `artifact-read`，但四份 canonical reports 的独立发布让 child failure phase 丢失。随后 repair 引入 failure-only transient receipt，并以 composed `51/51 PASS` 证明 exact parser、atomic writer、host failure algebra、typed redaction 与 selector ownership。

本包不再修改实现，只对 exact current tree 运行一次真实 add-state-transition 母例。若仍失败，新 typed outcome 必须把边界收敛到 child `preflight|verify-all|postcondition` 或具体首个 artifact 的 missing/parse/read；禁止回到 timeout、profile cleanup 或无依据推测。
