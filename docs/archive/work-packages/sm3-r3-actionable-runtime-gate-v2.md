---
schema: codex-development-work-package-v1
id: sm3-r3-actionable-runtime-gate-v2
tracking: issue-106
base: f29ecb73ac64aaae23b7989688c4a3ca79593d43
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v5
tasks:
  - id: sm3-r3-v2-cumulative-pr-custody
    owner: a0
    ownedPaths:
      - docs/evidence/v0-4-semantic-mutation-apply-r2-verification.json
      - docs/evidence/v0-4-semantic-mutation-apply-repair-verification.json
      - docs/work-packages/sm3-r1-focused-blocker-repair-v1.md
      - docs/work-packages/sm3-r2-bounded-runtime-gate-v1.md
      - docs/work-packages/sm3-r3-actionable-runtime-gate-v1.md
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
  - id: sm3-r3-v2-mutable-gate-surface
    owner: a0
    ownedPaths:
      - docs/test-feedback-and-ci-lanes.md
      - scripts/run-work-package-gate.ts
      - scripts/work-package-gate-contract.ts
      - tests/unit/work-package-gate-contract.test.ts
      - tests/unit/work-package-gate-execution.test.ts
  - id: sm3-r3-v2-manifest-and-stop-evidence
    owner: a0
    ownedPaths:
      - docs/work-packages/sm3-r3-actionable-runtime-gate-v2.md
      - docs/evidence/v0-4-semantic-mutation-apply-r3-v2-verification.json
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
  - "Cumulative PR custody is not R3-v2 mutation authority: every sm3-r3-v2-cumulative-pr-custody path remains byte-for-byte equal to pre-v2 HEAD 361fb753dd2ab445fdb0628ca37613f872e75dab and tree 41b2d0105165931e2620f7bdd36a677679bdbd3d."
  - "The frozen custody ledger, four R2 local supervisor artifacts, R2 run directory, retained snapshot sidecar, snapshot, namespace, and every owner-derived external recovery path remain outside R3-v2 recovery and cleanup authority; missing, changed, aliased, or ambiguous input stops before child launch."
  - "sm3-r3-actionable-runtime-gate-v1 remains byte-for-byte historical evidence of a pre-execution contract rejection and is never parsed as R3-v2 execution authority."
  - "R3-v2 may modify only its seven-file mutable surface: the two Gate scripts, two Gate tests, this manifest, the CI evidence ledger, and the R3-v2 stop or pass evidence."
  - "The only R3-v2 run directory is .tmp/sm3-r3-v2-work-package-gate; its canonical run-directory, namespace, snapshot, and namespace-root identities are digest-bound and are distinct from every R1/R2/v1 protected identity by segment-aware canonical and physical checks."
  - "The original 39-file selection and 600000 ms per-test timeout are derived only from sm3-r1-focused-blocker-repair-v1 tests[0]; R3-v2 adds no reporter, split child, reordered file, selected-test retry, timeout increase, or second owner-batch attempt."
  - "Evidence, event, state, checkpoint, parser, finalizer, validator, and bundle APIs for V1 and V2 are explicit and mutually rejecting; the frozen R2 V1 bundle continues to validate byte-for-byte without auto-upgrade or union dispatch."
  - "The V2 diagnostic observer is bounded to 1 MiB total and 8 KiB per logical line, uses fatal streaming UTF-8 decoding, accepts only complete ANSI SGR sequences, maintains independent stream state, never throws into the child observer, and persists no text, title, stack, path, PID, SID, environment, argv, or Error."
  - "The V2 diagnostic persists only status, sorted unique selection indexes, failure-marker, unmapped, malformed, oversized-line counts, and UTF-8, ANSI, and observer-truncation flags; a nonzero exit is actionable only when at least one marker maps unambiguously and every fail-closed count or flag is zero."
  - "Structure, AppContainer profile, and ACL probes use independent typed dispositions and identity count/digest evidence. Registry root absence is authoritative only when fixed HKCU Mappings OpenSubKey returns null without access, security, lifecycle, or IO exception; reg.exe exit code or stderr never proves absence."
  - "Only a complete canonical structure census with at least one recovery owner or pending-owner identity authorizes the single owner-aware recovery. Native-result, writer-lease, workspace-root, profile, and ACL observations never authorize recovery."
  - "Native-result, writer-lease, workspace-root, incomplete structure, profile drift or unknown, unresolved owner, and pending-owner residue prevent namespace deletion. ACL presence or unknown never blocks authorized recovery and is proved empty only by successful namespace removal plus a final namespace-absent census."
  - "Before every child, recovery, namespace removal, snapshot removal, terminal event, and evidence publication side effect, V2 persists and validates its attempt bit, exact authority or terminal projection, protected ledger digest, path identities, and journal prefix. childAttempted with no child never reruns or cleans; recoveryAttempted with no result never reruns recovery."
  - "Passed requires clean exit zero, clean diagnostic, closed tree and streams, stable repository, stable and removed execution snapshot, complete recovery or authoritative not-needed, exact profile-baseline equality, successful namespace removal, and final authoritative empty residue."
  - "Failed requires the same clean completion plus a nonzero exit and actionable diagnostic. Timed-out requires the existing clean-completion timeout proof. Every other state is unknown and preserves unresolved R3-v2 authority."
  - "Focused synthetic tests and concentrated read-only review must pass before the one owner batch is consumed. Passed permits only the listed downstream delta Gates; actionable failed, timed-out, unknown, incomplete, custody drift, identity ambiguity, unclosed tree, unresolved authority, recovery failure, or residue uncertainty writes the R3-v2 evidence and stops."
  - "No Full, all-slow, workspace/reference chain, GitHub Actions, selected-test rerun, additional owner-batch child, or R2/v1 checkpoint adoption occurs under this Work Package."
tests:
  - "bun test tests/unit/work-package-gate-contract.test.ts tests/unit/work-package-gate-execution.test.ts --timeout 180000"
  - "bun scripts/run-work-package-gate.ts --manifest docs/work-packages/sm3-r3-actionable-runtime-gate-v2.md --selection-manifest docs/work-packages/sm3-r1-focused-blocker-repair-v1.md --selection-index 0 --watchdog-ms 1800000 --cleanup-ms 120000 --run-dir .tmp/sm3-r3-v2-work-package-gate"
  - "bun run typecheck"
  - "SEC_IMPORTS_CHANGED_ONLY=1 SEC_CHANGED_BASE=f29ecb73ac64aaae23b7989688c4a3ca79593d43 bun run imports:check"
  - "SEC_AFFECTED_TESTS_BASE=f29ecb73ac64aaae23b7989688c4a3ca79593d43 bun run test:affected"
  - "bun run test:contract-freeze"
  - "bun run docs:doctor"
  - "git diff --check"
---

# SM3-R3 Actionable Runtime Gate V2

R2 的唯一 supervised owner batch 以 digest-valid `unknown` 停止：child exit `1`，tree closed，streams drained，但没有可行动的 failure selection index，post-run residue 也不可判定。R3-v1 在执行前的独立只读审计中又发现 recovery authority、自身 custody 与 registry absence proof 三处材料矛盾，因此它没有获得执行资格。R3-v2 不改变 Semantic Mutation 产品合同；它只建立一个可恢复、可审计、无文本泄漏的本地 supervisor，然后运行一次原 owner batch。

## 固定 DAG

```text
R3-v2-0 verify immutable custody, protected local artifacts, and path separation
  ↓
R3-v2-1 isolate V1 and V2 evidence/checkpoint/journal contracts
  ↓
R3-v2-2 bounded diagnostic + typed structure/profile/ACL census
  ↓
R3-v2-3 owner-only recovery + deletion/status/replay algebra
  ↓
R3-v2-4 deterministic fake-child tests + concentrated read-only audit
  ↓
R3-v2-5 exactly one original 39-file owner batch
  ├─ passed → typecheck → changed-only imports → affected → Contract Freeze → docs → patch
  ├─ actionable failed → write R3-v2 stop evidence → freeze a separate repair package
  └─ timed-out/unknown/incomplete → preserve R3-v2 authority → write stop evidence → stop
```

同一个 evidence/checkpoint canonical type、parser、builder、replay reducer、cleanup stage order 由 A0 串行实现。Subagent 只做只读审计。任何需要进入 hosted Evidence V2、`scripts/codex/`、`platform/shared/process.ts`、Semantic Mutation canonical types 或产品 runtime 的发现都必须停止并重新冻结。

## Custody ledger

以下 SHA-256 是 R3-v2 的 immutable carry-forward ledger；`ownedPaths` 只让现有累计 PR diff 可被 parser 托管，不赋予 R3-v2 修改权。

```text
docs/evidence/v0-4-semantic-mutation-apply-r2-verification.json sha256:6acd57b02a319268b2ce2b0e81508894addd71b9d20d37d6d463c286a90fe8a3
docs/evidence/v0-4-semantic-mutation-apply-repair-verification.json sha256:205ce268f49596d4b289f555f71a88d5012b805d53941b9f729a4a29d6625e34
docs/work-packages/sm3-r1-focused-blocker-repair-v1.md sha256:a19487b18cdcb23c2c85c189253a0aa8bfd1229e5f9fd4a6a62c919687367af6
docs/work-packages/sm3-r2-bounded-runtime-gate-v1.md sha256:158e813f64b958510357d86240d85ee3bb084b81e9f95033806ee48360815951
docs/work-packages/sm3-r3-actionable-runtime-gate-v1.md sha256:9f22ea4bab729864adb2a570338b6fb4f9fd9991cda8c1281a7ede101e6923ca
platform/compiler/compose/template-engine.ts sha256:1485379683babb72597e15a0a53ce28aa9347050a2cebf1c0098e971cb99c81a
platform/compiler/emit/write-local-views.ts sha256:c9856aa93ab74f9e622ab14b5a092169df8ab503f7345d97e1e33c55d7b8b3e6
platform/compiler/semantic-mutation/mutation-recovery-record.ts sha256:80954f8c1d2d4faa7efbb412e8780baedb87a29b98c984ca91a5924dfd604e4a
platform/compiler/semantic-mutation/mutation-terminal-record.ts sha256:971c078126272dce908c0f65c04c6a878df86b8406eaae131699f3271f98513a
platform/compiler/verify/semantic-mutation-isolated-runtime-plan.ts sha256:1dc9260b8db3eb7261a8a7a45e24bdc9756a0050eef887dc203ef3d3fae250f
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

R2 本地 supervisor artifact 继续由 stop record 绑定：

```text
.tmp/sm3-r2-work-package-gate/evidence.json sha256:17c86874b0370a19c1171ed28c275f6cb5315f96e5b7512fb89135b4e04143be
.tmp/sm3-r2-work-package-gate/events.jsonl sha256:cd0adb9c928b82dbd184d755b95e8199a6e03ef03373067a0a0cc9c6466585e4
.tmp/sm3-r2-work-package-gate/checkpoint.json sha256:3d1954c975b19c441d01ac46c2504fc2f20b32f27f84087b39364a0084b0f92a
.tmp/sm3-r2-work-package-gate/state.json sha256:d7406514c1035c03f0d11cffce32154efc75bf08f1aeb6f68a23fb908e81c52a
```

## Identity and denylist

R3-v2 唯一允许的 identity：

```text
runDir .tmp/sm3-r3-v2-work-package-gate
runDir canonical sha256:c61d4250f88c21b4581da4e16d0f19456e01fabb62174a8efea8119886dabb60
namespace gate-c61d4250f88c21b4581da4e16d0f1945-owned
namespace sha256:dfaffb9d07d6c0e8d5e69410a3c05234ab4d23d94eb62783a728f0f3a16a60b0
snapshot .tmp/gate-execution-snapshots/gate-c61d4250f88c21b4581da4e16d0f1945-owned
snapshot canonical sha256:3800689e6ed2c33cea9349e84f7b3be305c7ffe508ca3f1f00c6aa66d98981a4
namespaceRoot .tmp/gate-execution-snapshots/gate-c61d4250f88c21b4581da4e16d0f1945-owned/.tmp/test-workspaces/gate-c61d4250f88c21b4581da4e16d0f1945-owned
namespaceRoot canonical sha256:4fae9ce4bd4db2158dcd955a099e93e271c23c72e770d99de4f4b63caeb84a99
```

静态 denylist 至少包含：

```text
.tmp/sm3-r2-work-package-gate
.tmp/gate-execution-snapshots/gate-d4ecb7717e828f3111ae866fa084e957-owned
.tmp/gate-execution-snapshots/gate-d4ecb7717e828f3111ae866fa084e957-owned.owner-v1.json
.tmp/sm3-r3-work-package-gate
engineering-compiler-sm3-terminal-retention-fSCj2d
```

R2 evidence 没有保存 external recovery workspace 的原始路径；R3-v2 不得猜测它。任何从 owner、pending-owner、native-result、writer-lease 或 terminal record 解析出的 R1/R2 path 都动态进入 denylist。对任意 R3-v2 path `A` 与 protected path `B`，canonical equality、任一方向的 segment-boundary containment、Windows case-fold 等价、reparse/junction/symlink、file identity alias 或 identity unknown 均停止。禁止使用普通字符串 `startsWith` 证明 containment。

## Diagnostic contract

两个 stream 独立维护 fatal UTF-8、line、header 与 ANSI 状态。只允许完整 `ESC [ digits/semicolon m` SGR；非法或未闭合 ESC 使该次诊断 non-actionable。去除 SGR、规范 CRLF 后，header 必须等于 frozen selection 中的 exact repo-relative path 或该 path 加 `:`。遇到任意其他 canonical `.test.ts` header 时必须清空当前 header；跨 stream marker 不继承 header。Failure marker 只接受行首可选水平空白后的 exact `(fail)` token。Indexes 只能从 selection 映射，最终 sort + dedupe；重复 marker 增加 marker count，但不重复 index。

Observer 内部永不向 `onOutput` 抛异常。超过 1 MiB observation、8 KiB line、invalid UTF-8、unknown ANSI、malformed marker、unmapped marker 或 parser internal failure 均只设置有界 flag/count并 fail closed。Exit `0` 仍要求 parser clean 且 marker count 为零；不得通过清空 exit-zero diagnostics 隐藏 observer failure。

## Probe and recovery contract

Structure、profile、ACL 是三个独立 disposition。Profile 的 `registry-root-absent` 只能来自固定 `HKCU\\Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\CurrentVersion\\AppContainer\\Mappings` 的 .NET `OpenSubKey(..., false) === null`，且 access/security/IO/lifecycle exception 分别映射 unknown；generic host-tool nonzero、stderr 或文本匹配都不能证明 absent。`registry-root-absent` 与 `observed empty` 是不同 baseline，不能互换。

Child tree 被证明关闭后，先持久化完整 typed structure census。只有 canonical recovery/provisional owner 或其 pending publication identity 非空，才能在同一个 atomic checkpoint 中持久化 recovery authorization 与 `recoveryAttempted=true`，然后调用一次 owned recovery。Native-result、writer-lease、workspace-root、profile 与 ACL 均不授权 recovery；ACL unknown 或存在也不阻止已经被 owner authority 授权的 recovery。

Recovery complete 或 authoritative not-needed 后，只有 structure complete 且 workspace/owner/pending/native-result/writer-lease 全零、profile disposition 与 pre-run baseline 完全相同、namespace canonical/physical/reparse-free，才允许先持久化 namespace-removal attempt 再删除 R3-v2 namespace。删除成功后的 final census 必须返回 structure `namespace-absent`、ACL `namespace-absent`、profile baseline unchanged。任何未知 disposition、profile drift、orphan native-result/lease、workspace residue、identity drift、delete failure或 final census 缺失都保留 namespace 与 snapshot并产生 `unknown`。

## Replay and journal contract

V2 checkpoint 精确绑定 runId、execution/selection/argv digests、run-directory/namespace/snapshot/namespace-root identities、protected custody digest、pre-run profile baseline、child/recovery/removal attempt bits、diagnostic、typed census、terminal projection、journal sequence/digest 与 checkpoint digest。V2 journal 不复用 V1 schema；`started`、`deadline`、`termination`、`recovery`、`residue`、`completed` 的 subject分别绑定 execution authority、child summary、termination、recovery authorization/result、typed residue/removal和完整 terminal projection。

恢复时先 reduce/validate journal prefix，再允许任何副作用。`childAttempted=true && child=null` 永不重跑 child，也不得 recovery/cleanup；`recoveryAttempted=true && recovery=null` 永不重跑 recovery；namespace/snapshot removal attempt 无结果时也不得重复 destructive action。Terminal projection 必须在 completed event 前 durable；若 crash 发生在 completed event 与 evidence publication 之间，replay只能从相同 terminal projection完成 evidence，不能重新计算或再次执行任何副作用。

## Stop rule

R3-v2 只授权一次新的原始 39-file owner batch。该授权在 supervisor 持久化 `childAttempted` 时即被消费；spawn 未完成、进程中断、observer loss、checkpoint replay、证据不完整或结果为 unknown 均不能恢复为第二次授权。只有 synthetic/fake-child focused tests 与集中只读审查无 blocker时才能消费它。

唯一 batch 为 `passed` 时才进入 typecheck、changed-only imports、affected、Contract Freeze、docs 与 patch hygiene。`actionable failed`、`timed-out`、`unknown`、`incomplete`、custody/path drift、tree unclosed、authority/recovery/residue未证明时，写 `docs/evidence/v0-4-semantic-mutation-apply-r3-v2-verification.json` 并立即停止。不得追跑 diagnostic indexes、增加 timeout、拆分 batch、启动第二个 child、运行 Full/all-slow/workspace/reference chain或触发 GitHub Actions。
