---
schema: codex-development-work-package-v1
id: sm3-owned-profile-authority-repair-v1
tracking: issue-106
base: f29ecb73ac64aaae23b7989688c4a3ca79593d43
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v5
tasks:
  - id: remove-global-profile-census
    owner: a0
    ownedPaths:
      - docs/work-packages/sm3-owned-profile-authority-repair-v1.md
      - scripts/run-work-package-gate.ts
      - scripts/work-package-gate-contract.ts
      - tests/unit/work-package-gate-contract.test.ts
      - tests/unit/work-package-gate-execution.test.ts
      - tests/unit/work-package-profile-census-repair.test.ts
      - docs/evidence/v0-4-semantic-mutation-owned-profile-authority-verification.json
forbiddenPaths:
  - .github/
  - AGENTS.md
  - package.json
  - bun.lock
  - platform/
  - docs/03-MVP实施计划与路线图.md
  - docs/04-AI自主实现执行蓝图.md
  - docs/14-Engineering IR与语义事实规范.md
  - docs/test-feedback-and-ci-lanes.md
  - docs/evidence/v0-4-semantic-mutation-profile-probe-r4-diagnosis.json
  - docs/evidence/v0-4-semantic-mutation-profile-census-repair-verification.json
  - scripts/work-package-profile-probe.ts
  - scripts/diagnose-work-package-profile-probe.ts
acceptance:
  - "The consumed failed census evidence remains exact and is never retried: file sha256:ae7f10c990d05b345a7ac64bf3c7294e77ccb6d837fd340c42ca4bdc2329762c, classification profile-census-incomplete-unreported-reason."
  - "The unmerged V4 Gate residue contract removes appContainerProfiles. Namespace structure, durable recoveryAuthorities, ACL ownership, child lifecycle, repository identity and snapshot custody remain unchanged."
  - "The runner contains no HKCU AppContainer Mappings scan, RegistryKey traversal, profile PowerShell script, boundedProfileIdentities or profileSetMatches path."
  - "The Gate never deletes or recovers a product resource from global discovery. Recovery remains authorized only by exact physical provisional/recovery owner records under its namespace."
  - "Product AppContainer code remains unchanged: it persists an owner before profile creation and removes that owner only after exact profile cleanup succeeds."
  - "The historical census test becomes a pure sentinel: it launches no PowerShell, reg.exe, AppContainer helper, owner child, recovery or cleanup."
  - "No old Gate, selected owner batch, Gate execution test, typecheck, imports, affected, Contract Freeze, docs doctor, slow/full, workspace/reference or GitHub Actions runs in this package."
tests:
  - "bun test tests/unit/work-package-profile-census-repair.test.ts --timeout 180000"
  - "git diff --check -- scripts/run-work-package-gate.ts scripts/work-package-gate-contract.ts tests/unit/work-package-gate-contract.test.ts tests/unit/work-package-gate-execution.test.ts tests/unit/work-package-profile-census-repair.test.ts docs/work-packages/sm3-owned-profile-authority-repair-v1.md docs/evidence/v0-4-semantic-mutation-owned-profile-authority-verification.json"
---

# SM3 Owned Profile Authority Repair V1

唯一真实 `.NET` census 已按前包执行并终止为 `complete=false`；其 reason 未被测试输出，不得推测或重跑。源码审计表明全局 HKCU profile set 不是 Gate 的删除或恢复 authority：产品在 create 前先持久化 namespace-owned owner，cleanup 成功后才移除 owner。当前未合并的 V4 Gate 因此删除这条跨 workspace、不可稳定证明完整性的旁路，只保留物理 namespace owner、ACL、process lifecycle 与 repository/snapshot custody。

本包只运行纯 sentinel。完成后无条件停止，不获得旧 owner batch、recovery、cleanup、hosted verification 或 merge authority。
