---
schema: codex-development-work-package-v1
id: sm3-r3-actionable-runtime-gate-v4
tracking: issue-106
base: f29ecb73ac64aaae23b7989688c4a3ca79593d43
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v5
tasks:
  - id: sm3-r3-v4-cumulative-pr-custody
    owner: a0
    ownedPaths:
      - docs/evidence/v0-4-semantic-mutation-apply-r2-verification.json
      - docs/evidence/v0-4-semantic-mutation-apply-repair-verification.json
      - docs/work-packages/sm3-r1-focused-blocker-repair-v1.md
      - docs/work-packages/sm3-r2-bounded-runtime-gate-v1.md
      - docs/work-packages/sm3-r3-actionable-runtime-gate-v1.md
      - docs/work-packages/sm3-r3-actionable-runtime-gate-v2.md
      - docs/work-packages/sm3-r3-actionable-runtime-gate-v3.md
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
  - id: sm3-r3-v4-mutable-gate-surface
    owner: a0
    ownedPaths:
      - docs/test-feedback-and-ci-lanes.md
      - scripts/run-work-package-gate.ts
      - scripts/work-package-gate-contract.ts
      - tests/unit/work-package-gate-contract.test.ts
      - tests/unit/work-package-gate-execution.test.ts
  - id: sm3-r3-v4-manifest-and-stop-evidence
    owner: a0
    ownedPaths:
      - docs/work-packages/sm3-r3-actionable-runtime-gate-v4.md
      - docs/evidence/v0-4-semantic-mutation-apply-r3-v4-verification.json
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
  - "Cumulative PR custody is not R3-v4 mutation authority: all 25 custody paths remain byte-for-byte equal to the body ledger; v1/v2/v3 remain unexecuted historical contract-rejection records."
  - "The custody ledger, four R2 local artifacts, R2 run directory, retained snapshot sidecar, snapshot, namespace, and every owner-derived external recovery path stay outside R3-v4 recovery and cleanup authority; any missing, changed, aliased, or ambiguous input stops before child launch."
  - "R3-v4 may modify only seven files: two Gate scripts, two Gate tests, this manifest, the CI evidence ledger, and the R3-v4 stop or pass evidence."
  - "The only run directory is .tmp/sm3-r3-v4-work-package-gate; its run-directory, namespace, snapshot, and namespace-root identities are digest-bound and distinct from all R1/R2/v1/v2/v3 protected identities by segment-aware canonical and physical checks."
  - "The 39-file selection and 600000 ms per-test timeout come only from R1 tests[0]; R3-v4 adds no reporter, split child, reordered file, selected-test retry, timeout increase, or second owner-batch attempt."
  - "Evidence, event, state, checkpoint, parser, finalizer, validator, and bundle APIs for V1 and V4 are explicit and mutually rejecting; the frozen R2 V1 bundle validates without auto-upgrade or union dispatch."
  - "The diagnostic observer is bounded to 1 MiB total and 8 KiB per logical line, uses fatal streaming UTF-8, accepts only complete ANSI SGR, keeps independent stream state, never throws into the child observer, and persists no text, title, stack, path, PID, SID, environment, argv, or Error."
  - "Diagnostic evidence contains only status, sorted unique selection indexes, failure-marker, unmapped, malformed, oversized-line counts, UTF-8, ANSI, observer-truncation flags, and parserFailure. Actionable requires nonzero exit, at least one unambiguous mapped marker, and every fail-closed count or flag zero."
  - "Every lexical test-header candidate clears the current stream header first. Only an exact selected repo-relative path, optionally followed by a colon, sets it; absolute, backslash, traversal, malformed, and unselected candidates leave it unset."
  - "Structure, AppContainer profile, and ACL probes use independent typed dispositions and identity count/digest evidence. Registry root absence is authoritative only when fixed HKCU Mappings OpenSubKey returns null without access, security, lifecycle, or IO exception; reg.exe status or stderr never proves absence."
  - "Only four canonical identity classes authorize the single owned recovery: recovery owner, recovery-owner pending publication, provisional owner, and provisional-owner pending publication. Native-result, writer-lease, workspace-root, profile, ACL, and every other record never authorize recovery."
  - "Native-result, writer-lease, workspace-root, incomplete structure, profile drift/unknown, unresolved recovery/provisional owner, and either pending publication prevent namespace deletion. ACL presence/unknown never blocks authorized recovery and is proved empty only by namespace removal plus final namespace-absent census."
  - "Before child, recovery, namespace removal, and snapshot removal, V4 persists and validates the attempt bit, authority, protected ledger, path identities, and journal prefix. Unknown-result external side effects are never re-executed."
  - "A digest-bound journal event or evidence publication may complete the same pre-persisted publication attempt only after journal or file inspection proves the exact bytes absent; it never recomputes terminal projection or performs any external side effect."
  - "Passed requires clean exit zero, clean diagnostic, closed tree/streams, stable repository, verified and removed snapshot, complete recovery or authoritative not-needed, exact profile-baseline equality, namespace removal, and final authoritative empty residue."
  - "Failed requires the same clean completion plus nonzero exit and actionable diagnostic. Timed-out requires the existing clean-completion timeout proof. Every other state is unknown and preserves unresolved R3-v4 authority."
  - "Focused synthetic tests and concentrated read-only review must pass before the one owner batch is consumed. Passed permits only listed downstream delta Gates; every other result or proof gap writes R3-v4 evidence and stops."
  - "No Full, all-slow, workspace/reference chain, GitHub Actions, selected-test rerun, additional owner-batch child, or R2/v1/v2/v3 checkpoint adoption occurs."
tests:
  - "bun test tests/unit/work-package-gate-contract.test.ts tests/unit/work-package-gate-execution.test.ts --timeout 180000"
  - "bun scripts/run-work-package-gate.ts --manifest docs/work-packages/sm3-r3-actionable-runtime-gate-v4.md --selection-manifest docs/work-packages/sm3-r1-focused-blocker-repair-v1.md --selection-index 0 --watchdog-ms 1800000 --cleanup-ms 120000 --run-dir .tmp/sm3-r3-v4-work-package-gate"
  - "bun run typecheck"
  - "SEC_IMPORTS_CHANGED_ONLY=1 SEC_CHANGED_BASE=f29ecb73ac64aaae23b7989688c4a3ca79593d43 bun run imports:check"
  - "SEC_AFFECTED_TESTS_BASE=f29ecb73ac64aaae23b7989688c4a3ca79593d43 bun run test:affected"
  - "bun run test:contract-freeze"
  - "bun run docs:doctor"
  - "git diff --check"
---

# SM3-R3 Actionable Runtime Gate V4

R2 的唯一 owner batch 以 digest-valid `unknown` 停止。R3-v1/v2/v3 都在执行前被只读审计拒绝，没有创建 run directory、checkpoint、snapshot、namespace 或 child。V4 是唯一 execution authority，只修复本地 supervisor 的 observation、recovery、cleanup 与 replay boundary，不修改 Semantic Mutation 产品合同。

## 固定 DAG

```text
verify custody + R2 artifacts + path separation
  → isolate V1/V4 evidence/event/state/checkpoint/journal
  → bounded diagnostic + typed structure/profile/ACL census
  → four-owner-kind recovery + deletion/status/replay algebra
  → focused fake-child tests + concentrated read-only audit
  → exactly one original owner batch
      passed → typecheck → changed-only imports → affected → Contract Freeze → docs → patch
      otherwise → write R3-v4 evidence → preserve unresolved authority → stop
```

Canonical types、parser、builder、replay reducer 与 cleanup stage order 由 A0 串行实现；subagent 只读审计。若需要进入 hosted Evidence V2、`scripts/codex/`、`platform/shared/process.ts`、Semantic Mutation canonical types 或产品 runtime，停止并重新冻结。

## Immutable custody ledger

```text
docs/evidence/v0-4-semantic-mutation-apply-r2-verification.json sha256:6acd57b02a319268b2ce2b0e81508894addd71b9d20d37d6d463c286a90fe8a3
docs/evidence/v0-4-semantic-mutation-apply-repair-verification.json sha256:205ce268f49596d4b289f555f71a88d5012b805d53941b9f729a4a29d6625e34
docs/work-packages/sm3-r1-focused-blocker-repair-v1.md sha256:a19487b18cdcb23c2c85c189253a0aa8bfd1229e5f9fd4a6a62c919687367af6
docs/work-packages/sm3-r2-bounded-runtime-gate-v1.md sha256:158e813f64b958510357d86240d85ee3bb084b81e9f95033806ee48360815951
docs/work-packages/sm3-r3-actionable-runtime-gate-v1.md sha256:9f22ea4bab729864adb2a570338b6fb4f9fd9991cda8c1281a7ede101e6923ca
docs/work-packages/sm3-r3-actionable-runtime-gate-v2.md sha256:c52948a492cdd90b55b5716b250f1756daa84547265c1f5520b2e2e2c5bddb04
docs/work-packages/sm3-r3-actionable-runtime-gate-v3.md sha256:40ca3a7a81ee630100001786c45daf50584df86c09bbb29b16a1a864d08122c3
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
runDir .tmp/sm3-r3-v4-work-package-gate
runDir canonical sha256:460b94157868151fac54fdc20a7e362afc485a59cc15ef578b49c3e7f44b53d7
namespace gate-460b94157868151fac54fdc20a7e362a-owned
namespace sha256:f27ef9263db647480c16092911eb1a1c75f1bf4b4878477e9f8e558942310cf2
snapshot .tmp/gate-execution-snapshots/gate-460b94157868151fac54fdc20a7e362a-owned
snapshot canonical sha256:79ed001223508de924f5f173aaaabc443af17fdb87a29a5ee29d4f944b56fd77
namespaceRoot .tmp/gate-execution-snapshots/gate-460b94157868151fac54fdc20a7e362a-owned/.tmp/test-workspaces/gate-460b94157868151fac54fdc20a7e362a-owned
namespaceRoot canonical sha256:421ddb30ba1977e8fff3bba2cad54de7e9c5fb547519d4d79587ca2cd3f75c81
```

Static denylist 包含 R2 run dir/snapshot/sidecar/retained namespace 与 v1/v2/v3 run dirs。Owner、pending-owner、native-result、writer-lease 或 terminal record 解析出的 R1/R2 path 动态加入 denylist。Canonical equality、双向 segment containment、Windows case-fold equality、reparse/junction/symlink、file-identity alias 或 identity unknown 均停止；禁止普通 `startsWith`。

## Diagnostic contract

每个 stream 独立维护 fatal UTF-8、raw-byte line、header 与 ANSI SGR。任何 lexical test-header candidate先清空header；只有exact selected repo-relative path（可带一个冒号）重新设置。Absolute、backslash、traversal、malformed、unselected header保持unset。Failure marker只接受行首可选水平空白后的exact `(fail)` token；cross-stream不继承，indexes sort+dedupe，重复marker只增加count。

Observer永不抛入`onOutput`。Observation/line bound、invalid UTF-8、unknown ANSI、malformed/unmapped marker、内部异常分别设置对应count/flag；任何非零/true使diagnostic non-actionable。Exit zero也必须parser clean且marker count为零。

## Probe, recovery, deletion

Structure、profile、ACL为独立typed disposition。固定HKCU Mappings的.NET `OpenSubKey(..., false) === null`是唯一`registry-root-absent` proof；access/security/IO/lifecycle异常为unknown，`reg.exe`状态或stderr不能证明absence。Absent与present-empty是不同baseline。

Child tree closed后先持久化complete structure census。仅 recovery owner、recovery-owner pending、provisional owner、provisional-owner pending 四类identity授权一次recovery；native-result、writer-lease、workspace-root、profile、ACL及其他记录不授权。ACL未知/存在不阻止已授权recovery。

Recovery complete或authoritative not-needed后，仅structure complete且workspace/四类owner/native-result/writer-lease全零、profile baseline disposition/count/digest相同、namespace canonical/physical/reparse-free时，才持久化removal attempt并删除。Final census必须structure/ACL namespace-absent且profile unchanged；否则保留namespace/snapshot并unknown。

## Replay, result, stop

Checkpoint绑定runId、execution/selection/argv digests、四个path identity digests、protected ledger digest、preflight profile baseline、external side-effect attempt/result、publication attempt/bytes digest、diagnostic、typed census、terminal projection、journal prefix和checkpoint digest。V4 journal不用V1 schema；subjects绑定execution authority、child summary、termination、authorization/result、census/removal和terminal projection。

恢复先reduce/validate journal。Unknown-result child/recovery/namespace-removal/snapshot-removal绝不重执行。Journal event或evidence publication只有在对应attempt和exact bytes digest已durable、目标bytes被证明absent时才可完成同一publication；若目标存在则必须exact match，否则fail closed。Publication不能重算terminal projection或触发外部副作用。

`passed`、`failed`、`timed-out`都要求clean completion；failed额外要求actionable diagnostic，passed要求exit zero与clean zero-marker diagnostic。其余unknown。

唯一owner batch授权在durable childAttempted时消费，crash/unknown不能恢复第二次。Focused tests与静态审计无blocker后才能消费。只有passed进入delta Gates；其他结果写`docs/evidence/v0-4-semantic-mutation-apply-r3-v4-verification.json`并停止。禁止追跑indexes、增timeout、拆batch、第二child、Full/all-slow/workspace/reference或GitHub Actions。
