---
schema: codex-development-work-package-v1
id: sm3-r4-profile-probe-diagnosis-v1
tracking: issue-106
base: f29ecb73ac64aaae23b7989688c4a3ca79593d43
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v5
tasks:
  - id: sm3-r4-read-only-profile-diagnosis
    owner: a0
    ownedPaths:
      - docs/work-packages/sm3-r4-profile-probe-diagnosis-v1.md
      - scripts/work-package-profile-probe.ts
      - scripts/diagnose-work-package-profile-probe.ts
      - tests/unit/work-package-profile-probe-diagnostic.test.ts
      - docs/evidence/v0-4-semantic-mutation-profile-probe-r4-diagnosis.json
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
  - docs/work-packages/sm3-r1-focused-blocker-repair-v1.md
  - docs/work-packages/sm3-r2-bounded-runtime-gate-v1.md
  - docs/work-packages/sm3-r3-actionable-runtime-gate-v1.md
  - docs/work-packages/sm3-r3-actionable-runtime-gate-v2.md
  - docs/work-packages/sm3-r3-actionable-runtime-gate-v3.md
  - docs/work-packages/sm3-r3-actionable-runtime-gate-v4.md
  - platform/
  - scripts/run-work-package-gate.ts
  - scripts/work-package-gate-contract.ts
  - scripts/codex/
  - tests/contract/
  - tests/integration/
  - tests/unit/work-package-gate-contract.test.ts
  - tests/unit/work-package-gate-execution.test.ts
acceptance:
  - "R4 is a new read-only diagnostic authority after the terminal R3-v4 unknown; it does not resume, adopt, rewrite, or rerun R3-v4."
  - "Exactly one real AppContainer profile-registry query may run, under the current user/session/HKCU and the same SystemRoot, PowerShell executable, registry root, reg.exe query, 30-second total child budget, 1-MiB observer limit, replaced environment, and bounded child lifecycle as the R3-v4 probe, preceded by a fail-closed authority fence whose time remains visible in outer duration evidence."
  - "The real query is read-only: it never creates, deletes, renames, or modifies a registry key, AppContainer profile, ACL, file, directory, process-external authority, namespace, snapshot, sidecar, owner, transaction, journal, or recovery record."
  - "The PowerShell/reg child has no path or argument that can read or write R1, R2, or R3-v4 artifacts. The Bun supervisor may only hash frozen control records and physical root identities; it never traverses payload trees or invokes recovery/cleanup."
  - "Before the real query, one synthetic unit file may validate only deterministic projection, redaction, validation, and single-attempt refusal with injected ObservedCommandOutcome values; it may not launch PowerShell, reg.exe, a Bun owner child, or any product AppContainer helper."
  - "The standalone R4 helper reproduces the frozen runner profile command, projection, child timeout/termination budget, and child lifecycle without modifying the runner; it adds only a pre-spawn authority fence, and no second diagnostic process may follow a failed probe."
  - "Diagnostic evidence binds current HEAD/tree, pre-probe dirty-worktree digest, manifest digest, R3-v4 stop-evidence digest, runner and observed-process source digests, executable identity digests, invocation digest, effective budget, complete ObservedCommandOutcome, outer-deadline flag, sanitized parse/inner disposition, value count/digest, and protected-authority pre/post ledger digest."
  - "Raw profile names, SID, registry output, stderr text, exception message, path, environment, argv, PID, stack, and Error object are never persisted; only allowlisted disposition, existing script exit code, counts, digests, timings, and lifecycle evidence may be written."
  - "The one real query must terminate in exactly one typed classification: powershell-spawn-failed, registry-open-failed, reg-query-nonzero, powershell-failed, unexpected-stderr, lifecycle-failed, output-limit, deadline, parse-failed, registry-root-absent, or observed."
  - "A durable attempt record is written before the real query, so crash or publication failure cannot authorize a retry. Final evidence replaces it only after the process tree is proved closed and the protected-authority pre/post ledger is identical."
  - "R4 never runs the R3-v4 Gate, its 39-file selection, any selected single test, typecheck, imports, affected, Contract Freeze, docs doctor, patch/Quick/Risk/Full, slow, workspace/reference, or GitHub Actions."
  - "After the evidence file is published the diagnostic authority is consumed. A repair or another executable action requires a separately frozen successor Work Package derived from the typed R4 result."
tests:
  - "bun test tests/unit/work-package-profile-probe-diagnostic.test.ts --timeout 180000"
  - "bun scripts/diagnose-work-package-profile-probe.ts --manifest docs/work-packages/sm3-r4-profile-probe-diagnosis-v1.md --evidence docs/evidence/v0-4-semantic-mutation-profile-probe-r4-diagnosis.json --timeout-ms 30000"
  - "git diff --check -- docs/work-packages/sm3-r4-profile-probe-diagnosis-v1.md scripts/work-package-profile-probe.ts scripts/diagnose-work-package-profile-probe.ts tests/unit/work-package-profile-probe-diagnostic.test.ts docs/evidence/v0-4-semantic-mutation-profile-probe-r4-diagnosis.json"
---

# SM3-R4 Profile Probe Diagnosis V1

R3-v4 已以 digest-valid `unknown` 终止，且 owner child 从未启动。其 structure 与 ACL preflight 均为 authoritative empty/absent，唯一 blocker 是独立 profile probe 的 `complete=false, reason=host-tool-failed`。R4 只补齐这一只读边界的 typed evidence，不获得任何 owner test、recovery、cleanup 或 merge authority。

## 固定 DAG

```text
verify immutable R1/R2/R3-v4 authority-control ledger
  → static equivalence review of the diagnostic query
  → injected synthetic projection/redaction test
  → exactly one bounded read-only profile query
  → verify closed tree + unchanged protected ledger
  → atomically publish typed R4 evidence
  → stop
```

无论结果是成功还是失败，本包都不继续执行第二次 probe 或任何 repair。A0 必须先从 evidence 的 typed classification 重新计算后继 DAG。

## Frozen input ledger

```text
HEAD d392479637fd3503c1f3b365580bce5d913ffe5e
HEAD tree 76b7984f73ae67205c560dc4f269df77a98f5631
starting scripts/run-work-package-gate.ts sha256:d9a96218ca671a6bcd6ef94d2b881361b040b6aca49e5156dd28b92df0cda6c0
scripts/run-work-package-gate.ts blob 89148de99abd1b09694b4f5502c8115e21269363
scripts/work-package-gate-contract.ts blob 903d0036c90a5426194c284162cb5a3499cb43a1
tests/unit/work-package-gate-contract.test.ts blob b609385f9a02d04e88715503c1560e9dbc347dcb
tests/unit/work-package-gate-execution.test.ts blob 379cddbed50786fb7766a61ee1ffaba953724685
platform/shared/observed-process.ts sha256:3bd94b7d245505aea7ede73535e63491893dc6038aa19d057e3d76db2265257c
docs/work-packages/sm3-r3-actionable-runtime-gate-v4.md sha256:752d8c32c01ecf67cda207a900953493d75ab1c949c97c44cb7f0eb8e0ab3d24
docs/evidence/v0-4-semantic-mutation-apply-r3-v4-verification.json sha256:a035318656987a61a8adcc703c40b53826c74c5c5512573359c7248067da6492
.tmp/sm3-r3-v4-work-package-gate/evidence.json sha256:008325046bcaf0c28ec3bb4b557c84db0caa16ee0688cc8be217cfebc725f9f3
.tmp/sm3-r3-v4-work-package-gate/events.jsonl sha256:4798fd2ef7b0a9d5aa8094dc6a28c1d461abc12d8d6119919d7f84419b3d258f
.tmp/sm3-r3-v4-work-package-gate/checkpoint.json sha256:296850dd02b47a5455aedc9882434315536e4409f83b9ee13a35fa55148390cd
.tmp/sm3-r3-v4-work-package-gate/state.json sha256:317acba04091bba3bc7ed61d75b62279f5469288e08cf23685658dacedd2ce3a
.tmp/gate-execution-snapshots/gate-460b94157868151fac54fdc20a7e362a-owned.owner-v1.json sha256:72e107d14e37d8c9b0f3030f3005b71ef63c813ed8ce4ad805d14cd0ff91c62e
```

R1/R2 authority continues to be protected by the exact control-record ledgers in R3-v4 and its stop evidence. R4 binds the R2/R3 run receipts, snapshot owner sidecars, and canonical/physical snapshot roots; it intentionally does not claim a recursive byte digest of the 1.3 GB retained payload because the child invocation has no filesystem path or argument to that payload. Missing, changed, aliased, or ambiguous control authority stops before the real query and does not authorize a retry.

## Diagnostic boundary

The PowerShell process performs only the existing fixed HKCU Mappings `OpenSubKey(..., false)`, fixed `reg.exe query ... /s`, allowlisted matching of `sec.sm3.*`, and JSON projection. The standalone diagnostic helper preserves the frozen invocation and returns the V4-compatible projected probe plus the same attempt's path-free `ObservedCommandOutcome` and parse disposition. Exit `11` remains the existing OpenSubKey exception bucket and exit `7` remains the existing reg-query bucket; no richer exception detail is invented. The evidence writer reduces raw values to count/digest before persistence.

`child.status=spawn-failed` in R3-v4 remains a synthetic unstarted-child sentinel and is not an input to this diagnosis.
