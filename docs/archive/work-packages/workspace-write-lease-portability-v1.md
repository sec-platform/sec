---
schema: codex-development-work-package-v1
id: workspace-write-lease-portability-v1
tracking: issue-167
base: 9b1111441a92b64888323c79f359b52cd039994a
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v18
tasks:
  - id: freeze-portable-lease-authority
    owner: a0
    ownedPaths:
      - docs/13-独立工具分发与打包规划.md
      - docs/14-Engineering IR与语义事实规范.md
      - docs/archive/work-packages/development-feedback-loop-hardening-v1.md
      - docs/archive/work-packages/runtime-authority-and-package-layout-v1.md
      - docs/archive/work-packages/verification-fast-runner-resource-isolation-v1.md
      - docs/work-packages/development-feedback-loop-hardening-v1.md
      - docs/work-packages/runtime-authority-and-package-layout-v1.md
      - docs/work-packages/verification-fast-runner-resource-isolation-v1.md
      - docs/work-packages/workspace-write-lease-portability-v1.md
      - docs/work/active-work-package.md
      - docs/work/current-state.yaml
      - docs/work/rolling-plan.md
  - id: implement-portable-generation-lease
    owner: a0
    ownedPaths:
      - platform/shared/workspace-write-lease.ts
      - platform/compiler/verify/assert-isolated-staging-tree.ts
      - scripts/run-work-package-gate.ts
      - tests/contract/repository-runtime.test.ts
      - tests/contract/semantic-mutation-apply-contract.test.ts
      - tests/integration/pipeline-workspace-write-lease.test.ts
      - tests/integration/semantic-mutation-recovery-lifecycle.test.ts
      - tests/integration/semantic-projections.test.ts
      - tests/integration/ticket-pipeline.test.ts
      - tests/testkit/workspace.ts
      - tests/unit/assert-isolated-staging-tree-race.test.ts
      - tests/unit/semantic-mutation-isolated-child-fence.test.ts
      - tests/unit/work-package-gate-execution.test.ts
      - tests/unit/workspace-write-lease.test.ts
forbiddenPaths:
  - .agents/skills/
  - .github/workflows/
  - bun.lock
  - docs/scripts/docs-doctor.ts
  - package.json
  - platform/cli/
  - platform/compiler/semantic-mutation/windows-file-attributes.ts
  - platform/dev-runner.ts
  - platform/orchestrator/workbench-server-v2.ts
  - platform/shared/heavy-verification-gate-lease.ts
  - platform/shared/paths.ts
  - platform/shared/process.ts
  - platform/shared/runtime-layout.ts
  - platform/shared/test-impact-contract.ts
  - platform/shared/test-impact-rules/
  - scripts/publish-public.ts
acceptance:
  - "platform/shared/workspace-write-lease.ts remains the only common workspace write owner and uses no import from bun, bun:ffi, Bun namespace API, native addon, shell command, or exists-then-rename publication fallback."
  - "A valid protocol.json marker normally has one durable name. The only automatically repairable publication-crash residue is exactly one canonical protocol candidate directly under holders whose regular-file bigint dev and ino equal the marker and whose shared link count is exactly two; recovery re-reads both identities before unlink, fsyncs holders and the protocol root, and proves the unchanged marker is valid with link count one."
  - "Missing, multiple, external, noncanonical, symlink, identity-mismatched, link-count-mismatched, or concurrently changed marker aliases fail closed before owner publication. Marker convergence never deletes or mutates a generation owner, terminal, holder directory, heartbeat, active generation, or successor generation, and never selects an alias by contents, timestamp, size, or guessed name."
  - "A complete fsynced immutable owner is atomically hard-linked without replacement into one append-only generation ledger; the highest owner generation without a terminal record is the only active lease."
  - "Immutable publication has exactly three outcomes: not-published, published, or durability-unknown. A prepared holder is removed only after target absence is re-proven following link failure; observed link success or target identity equal to the prepared owner preserves the complete holder and returns a typed retry/recovery failure even when root-directory fsync fails."
  - "WorkspaceWriteLeaseToken and every commit fence bind the exact workspace identity, generation, owner-file identity, process nonce, and lease id; an older or terminalized generation can never regain ownership."
  - "Heartbeat state is exact-owner-bound; only a same-host owner past the stale window with process liveness proven dead can receive a recovery terminal. Live, foreign, unknown, malformed, and legacy-v1 states fail closed with stable path-free error codes."
  - "Release and recovery publish complete exact-owner terminal records and never rename, unlink, replace, or reuse an active or successor generation. Concurrent delayed recovery actors cannot remove the successor writer."
  - "Crash before marker publication leaves no protocol marker; crash after marker link and before exact candidate cleanup converges automatically under the unique-alias proof; crash before owner publication leaves no authoritative lease; crash after owner publication is recoverable from owner and heartbeat; crash after terminal publication leaves a complete terminal state from which the next generation can be acquired."
  - "platform/shared/workspace-write-lease.ts exports the only read-only v2 inspection contract. Gate and recovery census consume its stable state digest and authority-path summary, never duplicate owner/token/generation/holder/link/legacy parsing, and treat the lease root as one atomic inspected subgraph rather than recursively rejecting its intentional owner hard link."
  - "The permanent v2 protocol root blocks legacy v1 acquisition. A residual v1 owner.json is not auto-migrated and returns one deterministic fail-closed migration diagnostic until an operator separately proves quiescence."
  - "Focused contracts use real fs.link state to cover exact marker alias convergence, external/noncanonical/multiple/identity-mismatched alias rejection without owner publication, complete owner and terminal publication, cross-process contention, exact reentrancy, heartbeat, live/foreign/unknown rejection, concurrent recovery, terminal crash continuation, legacy migration failure, commit-fence invalidation, and path-free errors."
  - "Gate census focused contracts cover active, released, recovered, malformed and legacy-v1 lease states through the shared inspector, including a complete holder retained after owner publication durability becomes unknown."
  - "The canonical tests/testkit/workspace.ts fixture helper excludes every case-equivalent .sec root from generic recursive copy, rejects case collisions, symlinks, junctions and special objects at the local-state boundary, and explicitly rematerializes only physical regular-file snapshots for .sec/cache composition/project baselines and .sec/pipeline-journal.json under canonical destination names. Workspace-owned lease, Semantic Mutation and unknown local state are never traversed or cloned, so fixtures preserve one read-only snapshot boundary without inheriting protocol, generation, holder, heartbeat, terminal or mutation recovery identity."
  - "Full-Pipeline integration fixtures retain their product assertions and use the dev-runner's canonical bounded timeout instead of a second per-test 15-second wall-clock gate; deterministic main/candidate baseline evidence, not a single timing sample, is required before changing this boundary."
  - "The isolated staging tree boundary rejects every ordinary hard-linked file. While the exact active lease token is quiesced, it may accept a hard-linked path only when the shared v2 inspector validates that exact current file as part of the canonical lease authority subgraph and the file identity remains unchanged across that proof; arbitrary, external, stale, replaced or malformed hard links still fail closed."
  - "The production authority runs a real cross-process owner-crash/recovery sentinel under native Windows Node 24 and WSL2/ext4 Node 22; exact-head PR Evidence records both results, while Bun focused tests remain repository Toolchain evidence and do not substitute for either Node result."
  - "Only bun:ffi in the common workspace lease graph is removed. Bun 1.3.14 repository Toolchain, explicit Bun/native adapters, Bun Target surfaces, and development/verification Gate Bun APIs remain unchanged and legal."
  - "This Work Package makes no Node CLI support claim; common Node Host, independent Bun executable authority, generated target profiles, optional native adapters, clean package smoke, and cross-host determinism remain deferred."
  - "All base-to-candidate changed records have exactly one owner and no forbidden intersection; exact-head PR Evidence records base/head, physical host/runtime/filesystem results, and the remaining Issue 167 dependency packages."
tests:
  - "bun test tests/unit/workspace-write-lease.test.ts tests/integration/pipeline-workspace-write-lease.test.ts tests/contract/repository-runtime.test.ts tests/contract/semantic-mutation-apply-contract.test.ts --timeout 180000"
  - "bun test tests/unit/work-package-gate-execution.test.ts --test-name-pattern 'workspace lease' --timeout 180000"
  - "bun test tests/unit/semantic-mutation-isolated-child-fence.test.ts --test-name-pattern 'workspace write commit-fence production identity' --timeout 180000"
  - "bun test tests/integration/semantic-mutation-recovery-lifecycle.test.ts --timeout 600000"
  - "bun test tests/unit/assert-isolated-staging-tree-race.test.ts --timeout 180000"
  - "bun test tests/contract/document-control-plane-lifecycle.test.ts --test-name-pattern 'shared resolver fails closed|real Git lifecycle resolves' --timeout 180000"
  - "bun test tests/unit/codex-work-package-contract.test.ts --test-name-pattern 'frozen Work Package V1|Work Package ownership' --timeout 180000"
  - "bun run typecheck"
  - "bun run docs:doctor"
  - "bun run audit:repository"
  - "bun run check:affected --plan"
  - "bun run imports:freeze"
---

# Portable Workspace Write Lease V1

本包只闭合 Issue #167 的第二个严格前置：把 common write authority 从 Linux `bun:ffi` directory publish迁移到Node标准能力的append-only generation ledger。Protocol marker只收敛一个经bigint file identity、canonical candidate名称和exact link count共同证明的publication-crash alias；其他拓扑在owner publication前fail closed。Owner与terminal都先完整持久化再以hard link原子发布；恢复只terminalize exact stale/dead generation，不删除active或successor path。

本包不修改公共CLI/Workbench host、Bun Toolchain executable、生成目标、optional native capability或发布矩阵，也不声明Node受支持。Bun 1.3.14继续是repository install/test/build的唯一Toolchain Provider；合法Bun/native adapter保持原边界。
