---
schema: codex-development-work-package-v1
id: sm3-add-state-transition-vertical-v2
tracking: issue-106
base: f29ecb73ac64aaae23b7989688c4a3ca79593d43
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v5
tasks:
  - id: prove-repaired-add-state-transition-apply
    owner: a0
    ownedPaths:
      - docs/work-packages/sm3-add-state-transition-vertical-v2.md
      - docs/evidence/v0-4-semantic-mutation-add-state-transition-vertical-v2-verification.json
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
  - docs/evidence/v0-4-semantic-mutation-add-state-transition-vertical-verification.json
  - docs/evidence/v0-4-semantic-mutation-isolated-verification-feedback-repair.json
  - docs/evidence/v0-4-semantic-mutation-isolated-verification-fixture-alignment.json
  - docs/evidence/v0-4-semantic-mutation-isolated-verification-manifest-digest-fixture.json
  - docs/work-packages/sm3-add-state-transition-vertical-v1.md
  - docs/work-packages/sm3-isolated-verification-feedback-repair-v1.md
  - docs/work-packages/sm3-isolated-verification-fixture-alignment-v1.md
  - docs/work-packages/sm3-isolated-verification-manifest-digest-fixture-v1.md
acceptance:
  - "The terminal predecessor vertical remains immutable failed authority and is never rerun under its manifest: sha256:c8779b1854e2753ce266bd10be38fc9658042416364675e6836e70f8d989aea7."
  - "The focused isolated-verification repair chain terminates in an exact PASS: docs/evidence/v0-4-semantic-mutation-isolated-verification-manifest-digest-fixture.json sha256:2096927141b0dbf52d5b4d7bbbb978ff65104c3b4d3dfa181a7e7cb0f1c27378."
  - "The production orchestrator and isolated child are exact: sha256:26c1bc4204aa028838b3fb20c2f1f1381e5e24f4640d0101625dba89b4d386af and sha256:62a5fcdc84d758151179a11d676da7e5a1a0d5d7515440ddf0983521521ccd98."
  - "The selected inputs are exact: tests/contract/semantic-mutation-apply-contract.test.ts sha256:76a33b3a0fbd4e34f09e949d8e47da5039258e8514562825c0a87248a85a39c2 and tests/integration/semantic-mutation-apply.test.ts sha256:eb557a8cb6b70cb4d32282c94ce572abb467508018c7323412d792b54ecf16f1."
  - "Exactly one combined Bun child runs the two frozen files. No old 39-file selection, test-name filter, reporter retry, timeout increase, cleanup probe or second attempt is permitted."
  - "PASS requires every contract and integration test in both files to pass, including real isolated Verification, atomic publish, live rebuild, exact replay, collision rejection and failure lifecycle."
  - "Any failure, timeout, missing summary or unexpected residue terminates this package. Typed SEMANTIC-MUTATION-010 details determine a separately frozen successor; no repair or rerun occurs here."
  - "The run must not read, recover, rewrite or delete retained R2/R3 namespaces, snapshots, owner sidecars or external recovery workspaces."
  - "A PASS authorizes only separately frozen remaining evidence selection. It does not authorize typecheck, imports, affected, Contract Freeze, Quick/Risk/Full, slow, workspace/reference, GitHub Actions, commit, push or merge."
tests:
  - "bun test tests/contract/semantic-mutation-apply-contract.test.ts tests/integration/semantic-mutation-apply.test.ts --timeout 600000"
  - "git diff --check -- docs/work-packages/sm3-add-state-transition-vertical-v2.md docs/evidence/v0-4-semantic-mutation-add-state-transition-vertical-v2-verification.json"
---

# SM3 Add State Transition Vertical V2

前一真实纵切面在 EOL fixture 与无 typed internal failure 的 isolated Verification 上 terminal；后续 successor 已修复 source fixture、planning hot path 与 typed redaction，并用一次 focused PASS 冻结完整边界。

本包回到唯一产品母例，以当前 exact production 与未修改的 integration file 一次证明 add-state-transition 的 plan、真实 isolated Verification、atomic publish、live rebuild、exact replay、collision rejection 与失败生命周期。它不包含实现改动；PASS 或 FAIL 都立即终止，不在同包形成重试循环。
