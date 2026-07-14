---
schema: codex-development-work-package-v1
id: sm3-r3-actionable-runtime-gate-v3
tracking: issue-106
base: f29ecb73ac64aaae23b7989688c4a3ca79593d43
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v5
tasks:
  - id: sm3-r3-v3-cumulative-pr-custody
    owner: a0
    ownedPaths:
      - docs/evidence/v0-4-semantic-mutation-apply-r2-verification.json
      - docs/evidence/v0-4-semantic-mutation-apply-repair-verification.json
      - docs/work-packages/sm3-r1-focused-blocker-repair-v1.md
      - docs/work-packages/sm3-r2-bounded-runtime-gate-v1.md
      - docs/work-packages/sm3-r3-actionable-runtime-gate-v1.md
      - docs/work-packages/sm3-r3-actionable-runtime-gate-v2.md
      - platform/compiler/compose/template-engine.ts
      - platform/compiler/emit/write-local-views.ts
      - platform/compiler/semantic-mutation/mutation-recovery-record.ts
      - platform/compiler/semantic-mutation/mutation-terminal-record.ts
      - platform/compiler/verify/semantic-mutation-isolated-runtime-plan.ts
      - platform/orchestrator/workspace-orchestrator.ts
      - platform/shared/observed-process.ts
      - platform/shared/windows-appcontainer-executor.ts
      - platform/shared/windows-appcontainer-native-helper.ts
      - platform/shared/workspace-write-lease.ts
      - tests/contract/semantic-mutation-apply-contract.test.ts
      - tests/integration/pipeline-workspace-write-lease.test.ts
      - tests/unit/semantic-mutation-apply.test.ts
      - tests/unit/semantic-mutation-isolated-child-fence.test.ts
      - tests/unit/semantic-mutation-runtime-materialization.test.ts
      - tests/unit/windows-appcontainer-executor.test.ts
      - tests/unit/windows-appcontainer-host-tool-lifecycle.test.ts
      - tests/unit/workspace-write-lease.test.ts
  - id: sm3-r3-v3-mutable-gate-surface
    owner: a0
    ownedPaths:
      - docs/test-feedback-and-ci-lanes.md
      - scripts/run-work-package-gate.ts
      - scripts/work-package-gate-contract.ts
      - tests/unit/work-package-gate-contract.test.ts
      - tests/unit/work-package-gate-execution.test.ts
  - id: sm3-r3-v3-manifest-and-stop-evidence
    owner: a0
    ownedPaths:
      - docs/work-packages/sm3-r3-actionable-runtime-gate-v3.md
      - docs/evidence/v0-4-semantic-mutation-apply-r3-v3-verification.json
forbiddenPaths:
  - .agents/skills/sec-architecture-change/SKILL.md
  - .agents/skills/sec-ci-triage/SKILL.md
  - .agents/skills/sec-pr-closeout/SKILL.md
  - .agents/skills/sec-repo-audit/SKILL.md
  - .agents/skills/sec-verification-evidence/SKILL.md
  - .agents/skills/sec-work-package-plan/SKILL.md
  - .gitignore
  - AGENTS.md
  - PLANS.md
  - README.md
  - bun.lock
  - bunfig.toml
  - docs/03-MVP实施计划与路线图.md
  - docs/04-AI自主实现执行蓝图.md
  - docs/14-Engineering IR与语义事实规范.md
  - docs/scripts/docs-doctor.ts
  - docs/work-packages/_template.md
  - package.json
  - platform/cli/
  - platform/compiler/ir/
  - platform/compiler/projection/
  - platform/compiler/semantic-impact/
  - platform/compiler/workbench/
  - platform/orchestrator/pipeline-orchestrator.ts
  - platform/orchestrator/semantic-mutation-orchestrator.ts
  - platform/policies/
  - platform/registry/
  - platform/shared/ci-evidence-contract.ts
  - platform/shared/ci-verification-plan.ts
  - platform/shared/process.ts
  - platform/shared/engineering-ir/
  - platform/shared/semantic-impact-types.ts
  - platform/shared/semantic-mutation-transaction-types.ts
  - platform/shared/semantic-mutation-types.ts
  - scripts/ci-pr-risk.ts
  - scripts/ci-verification.ts
  - scripts/codex/
  - source/
  - tsconfig.json
acceptance:
  - "Cumulative PR custody is not R3-v3 mutation authority: all 24 custody paths remain byte-for-byte equal to the manifest body ledger; v1 and v2 remain unexecuted historical contract-rejection records."
  - "The custody ledger, four R2 local artifacts, R2 run directory, retained snapshot sidecar, snapshot, namespace, and every owner-derived external recovery path remain outside R3-v3 recovery and cleanup authority; missing, changed, aliased, or ambiguous input stops before child launch."
  - "R3-v3 may modify only its seven-file mutable surface: two Gate scripts, two Gate tests, this manifest, the CI evidence ledger, and the R3-v3 stop or pass evidence."
  - "The only R3-v3 run directory is .tmp/sm3-r3-v3-work-package-gate; its canonical run-directory, namespace, snapshot, and namespace-root identities are digest-bound and distinct from all R1/R2/v1/v2 protected identities by segment-aware canonical and physical checks."
  - "The original 39-file selection and 600000 ms per-test timeout come only from sm3-r1-focused-blocker-repair-v1 tests[0]; R3-v3 adds no reporter, split child, reordered file, selected-test retry, timeout increase, or second owner-batch attempt."
  - "Evidence, event, state, checkpoint, parser, finalizer, validator, and bundle APIs for V1 and V3 are explicit and mutually rejecting; the frozen R2 V1 bundle validates without auto-upgrade or union dispatch."
  - "The diagnostic observer is bounded to 1 MiB total and 8 KiB per logical line, uses fatal streaming UTF-8 decoding, accepts only complete ANSI SGR, keeps independent stream state, never throws into the child observer, and persists no text, title, stack, path, PID, SID, environment, argv, or Error."
  - "Diagnostic evidence contains only status, sorted unique selection indexes, failure-marker, unmapped, malformed, oversized-line counts, UTF-8, ANSI, observer-truncation flags, and parserFailure. Actionable requires nonzero exit, at least one unambiguous mapped marker, and every fail-closed count or flag zero."
  - "Every lexical test-header candidate clears the current stream header first. Only an exact selected repo-relative path, optionally followed by a colon, sets it; absolute, backslash, traversal, malformed, and unselected candidates leave it unset."
  - "Structure, AppContainer profile, and ACL probes use independent typed dispositions and identity count/digest evidence. Registry root absence is authoritative only when fixed HKCU Mappings OpenSubKey returns null without access, security, lifecycle, or IO exception; reg.exe status or stderr never proves absence."
  - "Only four canonical identity classes authorize the single owned recovery: recovery owner, recovery-owner pending publication, provisional owner, and provisional-owner pending publication. Native-result, writer-lease, workspace-root, profile, ACL, and every other record never authorize recovery."
  - "Native-result, writer-lease, workspace-root, incomplete structure, profile drift or unknown, unresolved recovery/provisional owner, and either pending publication prevent namespace deletion. ACL presence or unknown never blocks authorized recovery and is proved empty only by successful namespace removal plus final namespace-absent census."
  - "Before child, recovery, namespace removal, snapshot removal, terminal event, and evidence publication, V3 persists and validates its attempt bit, exact authority or terminal projection, protected ledger digest, path identities, and journal prefix. Attempted side effects with no result are never repeated."
  - "Passed requires clean exit zero, clean diagnostic, closed tree and streams, stable repository, verified and removed execution snapshot, complete recovery or authoritative not-needed, exact profile-baseline equality, namespace removal, and final authoritative empty residue."
  - "Failed requires the same clean completion plus nonzero exit and actionable diagnostic. Timed-out requires the existing clean-completion timeout proof. Every other state is unknown and preserves unresolved R3-v3 authority."
  - "Focused synthetic tests and concentrated read-only review must pass before the one owner batch is consumed. Passed permits only listed downstream delta Gates; every other result or proof gap writes R3-v3 evidence and stops."
  - "No Full, all-slow, workspace/reference chain, GitHub Actions, selected-test rerun, additional owner-batch child, or R2/v1/v2 checkpoint adoption occurs under this Work Package."
tests:
  - "bun test tests/unit/work-package-gate-contract.test.ts tests/unit/work-package-gate-execution.test.ts --timeout 180000"
  - "bun scripts/run-work-package-gate.ts --manifest docs/work-packages/sm3-r3-actionable-runtime-gate-v3.md --selection-manifest docs/work-packages/sm3-r1-focused-blocker-repair-v1.md --selection-index 0 --watchdog-ms 1800000 --cleanup-ms 120000 --run-dir .tmp/sm3-r3-v3-work-package-gate"
  - "bun run typecheck"
  - "SEC_IMPORTS_CHANGED_ONLY=1 SEC_CHANGED_BASE=f29ecb73ac64aaae23b7989688c4a3ca79593d43 bun run imports:check"
  - "SEC_AFFECTED_TESTS_BASE=f29ecb73ac64aaae23b7989688c4a3ca79593d43 bun run test:affected"
  - "bun run test:contract-freeze"
  - "bun run docs:doctor"
  - "git diff --check"
---

# SM3-R3 Actionable Runtime Gate V3

R2 的唯一 owner batch 以 digest-valid `unknown` 停止。R3-v1 在执行前因 recovery/custody/registry 合同矛盾被拒绝；R3-v2 又因一条错误 ledger digest、header reset 孔洞、缺失 parser-failure flag 与 owner-kind歧义在执行前被拒绝。两者都没有创建 run directory、checkpoint、snapshot、namespace 或 child。V3 是唯一 execution authority，只修复本地 supervisor 的 observation、recovery 与 replay boundary，不修改 Semantic Mutation 产品合同。

## 固定 DAG

```text
verify immutable custody + R2 artifacts + path separation
  → isolate V1/V3 evidence, event, state, checkpoint, journal
  → bounded diagnostic + typed structure/profile/ACL census
  → four-owner-kind recovery + deletion/status/replay algebra
  → focused fake-child tests + concentrated read-only audit
  → exactly one original 39-file owner batch
      passed → typecheck → changed-only imports → affected → Contract Freeze → docs → patch
      otherwise → write R3-v3 evidence → preserve unresolved authority → stop
```

Canonical types、parser、builder、replay reducer 与 cleanup stage order 由 A0 串行实现；subagent 只读审计。若需要进入 hosted Evidence V2、`scripts/codex/`、`platform/shared/process.ts`、Semantic Mutation canonical types 或产品 runtime，立即停止并重新冻结。

## Immutable custody ledger

```text
docs/evidence/v0-4-semantic-mutation-apply-r2-verification.json sha256:6acd57b02a319268b2ce2b0e81508894addd71b9d20d37d6d463c286a90fe8a3
docs/evidence/v0-4-semantic-mutation-apply-repair-verification.json sha256:205ce268f49596d4b289f555f71a88d5012b805d53941b9f729a4a29d6625e34
docs/work-packages/sm3-r1-focused-blocker-repair-v1.md sha256:a19487b18cdcb23c2c85c189253a0aa8bfd1229e5f9fd4a6a62c919687367af6
docs/work-packages/sm3-r2-bounded-runtime-gate-v1.md sha256:158e813f64b958510357d86240d85ee3bb084b81e9f95033806ee48360815951
docs/work-packages/sm3-r3-actionable-runtime-gate-v1.md sha256:9f22ea4bab729864adb2a570338b6fb4f9fd9991cda8c1281a7ede101e6923ca
docs/work-packages/sm3-r3-actionable-runtime-gate-v2.md sha256:c52948a492cdd90b55b5716b250f1756daa84547265c1f5520b2e2e2c5bddb04
platform/compiler/compose/template-engine.ts sha256:1485379683babb72597e15a0a53ce28aa9347050a2cebf1c0098e971cb99c81a
platform/compiler/emit/write-local-views.ts sha256:c9856aa93ab74f9e622ab14b5a092169df8ab503f7345d97e1e33c55d7b8b3e6
platform/compiler/semantic-mutation/mutation-recovery-record.ts sha256:80954f8c1d2d4faa7efbb412e8780baedb87a29b98c984ca91a5924dfd604e4a
platform/compiler/semantic-mutation/mutation-terminal-record.ts sha256:971c078126272dce908c0f65c04c6a878df86b8406eaae131699f3271f98513a
platform/compiler/verify/semantic-mutation-isolated-runtime-plan.ts sha256:1dc9260b8db3eb7261a8a7a45e24bdc9756a0050eeef887dc203ef3d3fae250f
platform/orchestrator/workspace-orchestrator.ts sha256:bfa6843cbe8ed09afc9352926717e0eae784822ee56f65d7507ec2b6d7861e18
platform/shared/observed-process.ts sha256:3bd94b7d245505aea7ede73535e63491893dc6038aa19d057e3d76db2265257c
platform/shared/windows-appcontainer-executor.ts sha256:0a719e7793cb91e165fe0de0233803f92c5e5782d745aba3766df126159d34a5
platform/shared/windows-appcontainer-native-helper.ts sha256:b6f9111c45f067e2e6d8225f794ff5b2de37187e1f6a5550533d27a2509b702a
platform/shared/workspace-write-lease.ts sha256:5389eb74697d216f6c7db159719de49ed24a8985bd14ecbaf43a654129d1a3ef
tests/contract/semantic-mutation-apply-contract.test.ts sha256:331360c825c9f065342e864fa1d7dbe60a79bd99cf3730c4f86562507cfc744a
tests/integration/pipeline-workspace-write-lease.test.ts sha256:5208d9adbc9c41b2109a518d7435db324660240d1be0527a15d82d39200f8c2f
tests/unit/semantic-mutation-apply.test.ts sha256:dd3ee92fb6fc6d30399384b63cabc392e73de8f06acb30ba2dd1928e7c4f0460
tests/unit/semantic-mutation-isolated-child-fence.test.ts sha256:b87e62485e35d60719d417fd36814b4477f61a17417abaa652972f12bfc75eae
tests/unit/semantic-mutation-runtime-materialization.test.ts sha256:1130696744da3e5042473100c5a908edf142843abb715bbea1c399746286fc49
tests/unit/windows-appcontainer-executor.test.ts sha256:41e351b982b2957709e710b435e98101ad301dff6cab130a890e5f09c468e0ae
tests/unit/windows-appcontainer-host-tool-lifecycle.test.ts sha256:852898e6877abf6170427027641f8a2994e51eacd60337e2ed8e2cbeb2258fe9
tests/unit/workspace-write-lease.test.ts sha256:1abf1c68a5484546badd428c6695edcdd64717ac6efabf9c62b1f56ff9a809b3
```

```text
.tmp/sm3-r2-work-package-gate/evidence.json sha256:17c86874b0370a19c1171ed28c275f6cb5315f96e5b7512fb89135b4e04143be
.tmp/sm3-r2-work-package-gate/events.jsonl sha256:cd0adb9c928b82dbd184d755b95e8199a6e03ef03373067a0a0cc9c6466585e4
.tmp/sm3-r2-work-package-gate/checkpoint.json sha256:3d1954c975b19c441d01ac46c2504fc2f20b32f27f84087b39364a0084b0f92a
.tmp/sm3-r2-work-package-gate/state.json sha256:d7406514c1035c03f0d11cffce32154efc75bf08f1aeb6f68a23fb908e81c52a
```

## Identity and denylist

```text
runDir .tmp/sm3-r3-v3-work-package-gate
runDir canonical sha256:1e866d059fd98d7d28c625434004b2315a08fedf0d3ec9920611e599f51c4daf
namespace gate-1e866d059fd98d7d28c625434004b231-owned
namespace sha256:d80972d59481aebc6159cde8cd2074e697f3ac06a51ab35854f30bf6808a2813
snapshot .tmp/gate-execution-snapshots/gate-1e866d059fd98d7d28c625434004b231-owned
snapshot canonical sha256:d99f35c6b8ab3580c7557ee43b9a96d0ab9fc56f18c312fac6984857aa8debde
namespaceRoot .tmp/gate-execution-snapshots/gate-1e866d059fd98d7d28c625434004b231-owned/.tmp/test-workspaces/gate-1e866d059fd98d7d28c625434004b231-owned
namespaceRoot canonical sha256:6ac945f1fb19a027adb9c17d0f090310d80609fdec7d9e83d41d2a6ce8da148d
```

Static denylist 包含 `.tmp/sm3-r2-work-package-gate`、R2 snapshot/sidecar、`.tmp/sm3-r3-work-package-gate`、`.tmp/sm3-r3-v2-work-package-gate` 与 `engineering-compiler-sm3-terminal-retention-fSCj2d`。Owner、pending-owner、native-result、writer-lease 或 terminal record 解析出的任何 R1/R2 path 动态加入 denylist。Canonical equality、任一方向 segment containment、Windows case-fold equality、reparse/junction/symlink、file-identity alias或 identity unknown 均停止；禁止普通 `startsWith`。

## Diagnostic contract

每个 stream 独立维护 fatal UTF-8、raw-byte line、header 与 ANSI SGR 状态。任何 lexical test-header candidate 都先清空 current header；只有 exact selected repo-relative path（可带单个 `:`）重新设置它。Absolute、backslash、traversal、malformed、unselected header 均保持 unset，后续 marker 计为 unmapped。Failure marker 只接受行首可选水平空白后的 exact `(fail)` token；cross-stream 不继承，indexes sort+dedupe，重复 marker 只增加 count。

Observer 永不抛入 `onOutput`。超过 observation/line bound、invalid UTF-8、unknown ANSI、malformed/unmapped marker 或内部异常分别设置 `observerTruncated`、`oversizedLineCount`、`utf8Invalid`、`ansiInvalid`、`malformedMarkerCount` 或 `parserFailure`。任何非零 count/true flag使 diagnostic non-actionable；exit zero 也必须 parser clean且 marker count为零。

## Probe, recovery, deletion

Structure、profile、ACL 为独立 typed disposition。固定 HKCU Mappings 的 .NET `OpenSubKey(..., false) === null` 是唯一 `registry-root-absent` proof；access/security/IO/lifecycle异常为 unknown，`reg.exe` nonzero/stderr不能证明 absent。`registry-root-absent` 与 `observed empty` 是不同 baseline。

Child tree closed 后，先持久化 complete structure census。只有 recovery owner、recovery-owner pending、provisional owner、provisional-owner pending 这四类 canonical identity 非空时，才能在同一 atomic checkpoint 持久化 authorization 与 `recoveryAttempted=true`，然后调用一次 owned recovery。Native-result、writer-lease、workspace-root、profile、ACL 或任何其他记录不授权 recovery；ACL未知或存在不阻止已授权 recovery。

Recovery complete 或 authoritative not-needed 后，仅当 structure complete且 workspace/四类owner/native-result/writer-lease全零、profile与preflight baseline disposition/count/digest完全相同、namespace canonical/physical/reparse-free，才持久化 removal attempt并删除。Final census必须为 structure/ACL `namespace-absent`、profile baseline unchanged。否则保留 namespace/snapshot并 `unknown`。

## Replay, result, stop

V3 checkpoint绑定 runId、execution/selection/argv digests、四个path identity digests、protected ledger digest、preflight profile baseline、child/recovery/removal attempt bits与结果、diagnostic、typed census、terminal projection、journal prefix和checkpoint digest。V3 journal不复用V1 schema；started/deadline/termination/recovery/residue/completed subjects分别绑定 execution authority、child summary、termination、authorization/result、census/removal和terminal projection。

恢复先 reduce/validate journal。Attempt bit无结果时不重复对应 child/recovery/delete；child结果未知时不得cleanup。Terminal projection在completed event前durable；crash发生在completed与evidence之间时只能从同一projection补写evidence。

`passed`、`failed`、`timed-out` 都要求完整 clean completion；`failed` 额外要求 actionable diagnostic，`passed` 要求 exit zero与clean zero-marker diagnostic。其余为 `unknown`。

唯一 owner batch 的授权在 durable `childAttempted` 时消费，任何 crash/unknown不能恢复第二次授权。Focused tests与静态审计无 blocker后才能消费。只有 `passed` 进入列出的delta Gates；其他结果写 `docs/evidence/v0-4-semantic-mutation-apply-r3-v3-verification.json` 并停止。禁止追跑indexes、增timeout、拆batch、第二个child、Full/all-slow/workspace/reference或GitHub Actions。
