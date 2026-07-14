---
schema: codex-development-work-package-v1
id: sm3-profile-census-repair-v1
tracking: issue-106
base: f29ecb73ac64aaae23b7989688c4a3ca79593d43
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v5
tasks:
  - id: repair-profile-census-native-hop
    owner: a0
    ownedPaths:
      - docs/work-packages/sm3-profile-census-repair-v1.md
      - scripts/run-work-package-gate.ts
      - tests/unit/work-package-profile-census-repair.test.ts
      - docs/evidence/v0-4-semantic-mutation-profile-census-repair-verification.json
forbiddenPaths:
  - .github/
  - AGENTS.md
  - package.json
  - bun.lock
  - docs/03-MVP实施计划与路线图.md
  - docs/04-AI自主实现执行蓝图.md
  - docs/14-Engineering IR与语义事实规范.md
  - docs/test-feedback-and-ci-lanes.md
  - docs/evidence/v0-4-semantic-mutation-apply-repair-verification.json
  - docs/evidence/v0-4-semantic-mutation-apply-r2-verification.json
  - docs/evidence/v0-4-semantic-mutation-apply-r3-v4-verification.json
  - docs/evidence/v0-4-semantic-mutation-profile-probe-r4-diagnosis.json
  - docs/work-packages/sm3-r1-focused-blocker-repair-v1.md
  - docs/work-packages/sm3-r2-bounded-runtime-gate-v1.md
  - docs/work-packages/sm3-r3-actionable-runtime-gate-v1.md
  - docs/work-packages/sm3-r3-actionable-runtime-gate-v2.md
  - docs/work-packages/sm3-r3-actionable-runtime-gate-v3.md
  - docs/work-packages/sm3-r3-actionable-runtime-gate-v4.md
  - docs/work-packages/sm3-r4-profile-probe-diagnosis-v1.md
  - platform/
  - scripts/work-package-gate-contract.ts
  - scripts/work-package-profile-probe.ts
  - scripts/diagnose-work-package-profile-probe.ts
  - tests/contract/
  - tests/integration/
  - tests/unit/work-package-gate-contract.test.ts
  - tests/unit/work-package-gate-execution.test.ts
  - tests/unit/work-package-profile-probe-diagnostic.test.ts
acceptance:
  - "The consumed R4 evidence remains immutable and exact: file sha256:67c603aaa5df4257ef80db4c6aa7006990eaf25d04fcc34cf14cd9c718b65178, evidence digest sha256:8e5b4f8bac2b8203e8727ea0a0b2a625f2984fc2d030cf7eb90a606ea460c332, classification reg-query-nonzero, PowerShell exit 7."
  - "The Gate profile census removes only the redundant inner reg.exe query after Registry.CurrentUser.OpenSubKey succeeded; it does not change product AppContainer creation, deletion, ACL, recovery, cleanup, owner, snapshot, transaction, or journal code."
  - "The replacement recursively reads the existing HKCU AppContainer Mappings key with Microsoft.Win32.RegistryKey read-only handles, matches only sec.sm3.* from key names, value names, and string value data, disposes every opened key, and preserves registry-root-absent versus observed output."
  - "Registry access exceptions, PowerShell failure, deadline, output limit, lifecycle failure, malformed JSON, or invalid values remain fail-closed and cannot authorize an owner child."
  - "The existing 30-second outer budget, bounded observed-process lifecycle, 1-MiB output limit, replaced environment, deterministic sorting, count/digest redaction, and complete/unknown projection remain unchanged."
  - "One focused test proves the command no longer references reg.exe and one Windows-only invocation proves the repaired census reaches observed or registry-root-absent without exposing raw profile names."
  - "This package never runs the R3/R4 Gate, any selected owner test, old Gate execution test, typecheck, imports, affected, Contract Freeze, docs doctor, Quick/Risk/Full, slow, workspace/reference, recovery, cleanup, or GitHub Actions."
tests:
  - "bun test tests/unit/work-package-profile-census-repair.test.ts --timeout 180000"
  - "git diff --check -- scripts/run-work-package-gate.ts tests/unit/work-package-profile-census-repair.test.ts docs/work-packages/sm3-profile-census-repair-v1.md docs/evidence/v0-4-semantic-mutation-profile-census-repair-verification.json"
---

# SM3 Profile Census Repair V1

R4 已证明 Gate 的 PowerShell profile probe 正常启动、`OpenSubKey` 未报告 absent 或 exception，但冗余的内层 `reg.exe query` 返回非零。该 native hop 是当前唯一已证明的 pre-child blocker。

本包直接删除这个不必要边界：同一个受限 PowerShell 进程使用已经成功的只读 `.NET RegistryKey` 句柄枚举 Mappings。focused sentinel 成功后无条件停止，由 A0 从新证据决定是否需要任何 owner execution；本包本身不获得 owner batch、恢复、清理或 merge authority。
