---
schema: codex-development-work-package-v1
id: sm3-add-state-transition-vertical-v5
tracking: issue-106
base: f29ecb73ac64aaae23b7989688c4a3ca79593d43
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v5
tasks:
  - id: verify-real-add-state-transition-after-staged-loader-repair
    owner: a0
    ownedPaths:
      - docs/work-packages/sm3-add-state-transition-vertical-v5.md
      - docs/evidence/v0-4-semantic-mutation-add-state-transition-vertical-v5-verification.json
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
  - docs/evidence/v0-4-semantic-mutation-add-state-transition-vertical-v4-verification.json
  - docs/evidence/v0-4-semantic-mutation-isolated-verification-staged-loader-repair.json
  - docs/evidence/v0-4-semantic-mutation-isolated-verification-staged-loader-failure-fixture.json
  - docs/work-packages/sm3-add-state-transition-vertical-v4.md
  - docs/work-packages/sm3-isolated-verification-staged-loader-repair-v1.md
  - docs/work-packages/sm3-isolated-verification-staged-loader-failure-fixture-v1.md
acceptance:
  - "The combined staged-loader focused authority remains exact and passed: docs/evidence/v0-4-semantic-mutation-isolated-verification-staged-loader-failure-fixture.json sha256:b54ce5b48afb3995c8cee8cc718d40ca0494afd272478c2fcf07444dd6a87573 with combined 27/27 PASS."
  - "The terminal vertical-v4 evidence remains exact and is not retried: docs/evidence/v0-4-semantic-mutation-add-state-transition-vertical-v4-verification.json sha256:ac04b179c88b4aea3588e3293c972265ab65f49cfc88052aff4d99edb181aa0f."
  - "The exact orchestrator, child progress, child outcome, runtime plan, isolated child host and heavyweight runner inputs are sha256:26c1bc4204aa028838b3fb20c2f1f1381e5e24f4640d0101625dba89b4d386af, sha256:cc6b6ab681e61310d4a777a9f230014fa793505cb52f5a601c221cea12bf6e90, sha256:1e9a650a84b5f20dac99eced505d79cd86cd7e6cf58031ed71fe0ba117e7aabc, sha256:5111020c3b65ef5fa404d7e4cc8da01e017b9667cd12e0a0c6be3de64910ee09, sha256:8c147484261e37ce6e19475f473c7245f8c66680f2d296a9d0aff1fa66e6bcae and sha256:9c00a0aaa25fae1b17fbb98cf3a7761e7785d50744e18c027631fdb1a5784fdb."
  - "The exact contract and integration tests are sha256:2c22879dc8e88334c1860b77820721623c864d23a4d0ab38ab98eb8232683d26 and sha256:eb557a8cb6b70cb4d32282c94ce572abb467508018c7323412d792b54ecf16f1."
  - "Exactly one real contract-plus-add-state-transition command runs. The command timeout remains 600000 and the integration test's existing explicit 300000 timeout is not changed."
  - "The run may launch exactly the product-owned Windows AppContainer path already required by the test. It adds no profile/registry probe, cleanup pass, retry, stdout/stderr persistence or fallback execution."
  - "PASS requires the existing contract tests plus the real dry-run/apply/replay vertical, atomic publish and live derivative rebuild. A late result after the test timeout cannot be promoted to PASS."
  - "If isolated import still fails, evidence records only the allowlisted termination class and last durable staged-loader checkpoint: bootstrap-entered, loader-entered, typescript-imported, ts-morph-imported, core-import-started or module-entered."
  - "The run does not infer raw exit code, caught Error, path, message, stdout/stderr, profile state or root cause beyond the exact checkpoint interval."
  - "This package is terminal after its one command. No second attempt, timeout expansion, old Gate, typecheck, imports, affected, Contract Freeze, Quick/Risk/Full, slow matrix or Actions runs."
  - "Only a PASS may authorize integration closeout. A failure must freeze evidence and recompute the next structural repair from the newly typed interval."
tests:
  - "bun test tests/contract/semantic-mutation-apply-contract.test.ts tests/integration/semantic-mutation-apply.test.ts --timeout 600000"
  - "git diff --check -- docs/work-packages/sm3-add-state-transition-vertical-v5.md docs/evidence/v0-4-semantic-mutation-add-state-transition-vertical-v5-verification.json"
---

# SM3 Add State Transition Vertical V5

Staged-loader repair 已用组合 focused evidence 证明 bootstrap、TypeScript、ts-morph 与 heavyweight core 的有限检查点、plan/manifest 绑定、host coherence 与 failure redaction。Vertical-v4 仍是 terminal failure，不重跑也不改 timeout。

V5 只运行一次真实母例。若通过，它必须完成 dry-run、apply、isolated Verification、atomic publish、live derivative rebuild 与 exact replay；若失败，新的最后检查点就是下一轮唯一可用的结构事实。
