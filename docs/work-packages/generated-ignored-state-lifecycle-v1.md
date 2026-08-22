---
schema: codex-development-work-package-v1
id: generated-ignored-state-lifecycle-v1
tracking: issue-271
base: cf59ef7b1e166fa184592ab870fa5788466e2df9
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
authorityRefs:
  - architecture
  - development-governance
  - verification-governance
tasks:
  - id: generated-state-semantic-owner
    owner: generated-state-contract-owner
    ownedPaths:
      - platform/shared/generated-state-contract.ts
      - platform/shared/generated-state-registry.json
      - tests/unit/generated-state-contract.test.ts
  - id: generated-state-physical-transaction
    owner: generated-state-lifecycle-owner
    ownedPaths:
      - tooling/sec-dev/generated-state-lifecycle.ts
      - scripts/codex/generated-state.ts
      - scripts/codex/environment-settlement.ts
      - tests/unit/generated-state-lifecycle.test.ts
  - id: producer-birth-and-settlement
    owner: generated-state-integration-owner
    ownedPaths:
      - platform/dev-runner.ts
      - platform/dev-runner/dependency-bootstrap.ts
      - platform/dev-runner/typecheck-runner.ts
      - platform/cli/register-commands.ts
      - platform/shared/dependency-environment.ts
      - platform/shared/project-runtime.ts
      - tests/integration/compiler-dependency-installation.test.ts
  - id: generated-state-verification-and-control-projection
    owner: generated-state-control-owner
    ownedPaths:
      - docs/development-governance.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - docs/work-packages/generated-ignored-state-lifecycle-v1.md
      - docs/work-packages/sec-static-convergence-v1.md
      - package.json
      - platform/shared/tcb-closure-lock.ts
      - platform/shared/test-impact-contract.ts
      - platform/shared/test-impact-rules/verification.ts
      - platform/shared/test-ownership-contract.ts
      - tests/contract/dev-runner-contract.test.ts
      - tests/contract/docs-doctor.test.ts
      - tests/contract/tcb-closure-lock.test.ts
      - tests/contract/test-impact.test.ts
  - id: dev-runner-authority-impact-boundary-repair
    owner: dev-runner-authority-proof-owner
    ownedPaths:
      - platform/dev-runner/fast-test-policy.ts
      - platform/dev-runner/test-runner.ts
      - platform/shared/test-budget-contract.ts
      - tests/contract/ci-lanes.test.ts
      - tests/contract/dev-runner-authority-program.test.ts
      - tests/contract/dev-runner-live-authority.test.ts
      - tests/helpers/dev-runner-authority-proof.ts
      - tests/unit/test-runner.test.ts
forbiddenPaths:
  - .agents/
  - .github/
  - AGENTS.md
  - bun.lock
  - bunfig.toml
  - docs/authority.json
  - docs/product.md
  - docs/roadmap.md
  - docs/system-architecture.md
  - platform/compiler/
  - platform/orchestrator/
  - platform/registry/
  - public-docs/
  - source/
  - tsconfig.json
acceptance:
  - one versioned generated-state semantic owner records stable producer roots and policies rather than every ephemeral file; path name, ignored status, age, size, branch name and arbitrary count thresholds never manufacture deletion authority
  - the first production migration is the dependency-generation family only; compiler staging, physical compiler node_modules and shared dependency cache bind repository, physical workspace/root identity, owner operation and lifecycle phase at creation or first verified reuse
  - already registered unchanged generations use exact readback with zero writes; producer terminal cleanup targets only its registered root and never scans unrelated tmp siblings, while explicit inspect remains the separate reconciliation and unknown-detection surface
  - inventory is deterministic and no-follow; unregistered, replaced, active, malformed, reparse or unknown objects remain protected, and active state may be healthy without becoming cleanup eligible
  - cleanup executes exact inventory, retired-owner authorization, identity revalidation, same-filesystem quarantine, bounded no-follow deletion and physical readback; completed, partial-residue and no-op are distinct receipts
  - automatic, safe and all-rebuildable profiles select only already classified retired objects; identity-bound control state, recovery authority, active owners and unknown objects are never selected
  - branch/ref recovery, registered worktree mutation, test resource cleanup and provider cache semantics remain owned by issues 313, 186, 190 and 193; this slice does not scan or reinterpret those owners
  - CLI and package entrypoints expose separate inspect, plan, cleanup and environment-settlement operations; inspect is zero-write, timestamps and receipt identities are owner-generated, and callers cannot hand-fill them
  - focused tests cover ignored unknown, active versus retired generation, reparse root, changed-after-inventory replacement, foreign sibling preservation, bounded physical cleanup and dependency producer birth/disposal; no browser or unrelated business tests are required
  - sufficient exploration is derived from authority, dependency, causal, consumer and Impact closure; explicit reconciliation census is not equivalent to reading every object body
  - dev-runner route behavior, exact live-host authority closure and the finite adversarial proof catalog are separate evidence units; route edits remain millisecond-fast, affected host-closure edits run only the live proof, and proof implementation changes run the full finite Program
  - bounded-owner process census is module-scoped, so one owner cannot alias or expose its process capability while independent transitive modules remain free to consume the canonical shared process owner under their own contracts
  - a frozen Work Package manifest exists only for the selected work or one byte-proven delayed predecessor; future roadmap identity remains in the roadmap and is refrozen from its actual exact main when selected rather than retaining a stale execution manifest
  - generated-state machine data uses explicit owner-only Impact evidence instead of generic reverse-import fanout; executable sources retain module-graph propagation and ownerless machine data remains unresolved
tests:
  - tests/unit/generated-state-contract.test.ts
  - tests/unit/generated-state-lifecycle.test.ts
  - tests/contract/dev-runner-contract.test.ts
  - tests/contract/dev-runner-live-authority.test.ts
  - tests/contract/dev-runner-authority-program.test.ts
  - tests/contract/ci-lanes.test.ts
  - tests/contract/test-impact.test.ts
  - tests/contract/tcb-closure-lock.test.ts
  - tests/contract/docs-doctor.test.ts
  - tests/unit/test-runner.test.ts
---

# Generated / Ignored State Lifecycle V1

本包实现 Issue #271/#430 当前规范的第一个完整纵切片，迁移 dependency-generation family，而不是一次重写所有 cache 和临时目录。它不把 `.gitignore`、`.tmp`、目录年龄或数量当删除权限，而是从 producer birth registration 派生 owner、物理身份、生命周期与可执行 settlement。

```text
producer birth
  -> stable root registry
  -> exact physical inventory and owner resolution
  -> explicit cleanup profile and domain retirement authority
  -> pre-state identity revalidation
  -> same-filesystem quarantine
  -> bounded delete
  -> registry, physical root and owner-state readback
  -> typed settlement receipt
```

本包只拥有 repository/workspace-local generated state 的分类、通用安全事务与 settlement projection。正常 producer 只观察自己的 exact registered root；全量 unknown census 仅由显式 reconciliation 调用。Git branch/ref recovery、registered worktree effect、Test Action resource 和 Provider cache semantics继续由各自 owner 授权；它们只能向本 owner登记稳定 root或消费其 receipt，不能靠路径命名反向取得删除权限。

## 本轮真实校准证据

- `git worktree remove` 已注销 candidate registry，但因 ignored/control state 返回 `Directory not empty` 并留下完整物理目录；registry absence 不是物理 completion。
- orphan 中 `.tmp/codex/tcb-closure-lock-v2` 是 identity-bound control/recovery state，不能和 `node_modules`、`.shared-deps`、TypeScript/test-impact cache一起递归删除。
- local annotated recovery tags被 `fetch --prune --prune-tags`作为远端镜像残留删除，证明 recovery identity不能放进 provider拥有 prune语义的 branch/tag namespace。
- superseded closed-unmerged PR remote ref 与 unmerged local source缺少 provider-neutral closeout terminal，证明 #271 receipt、#186 physical closeout和#313 ref closeout必须有清晰接缝而不能互相冒充。

这些事实用于验证通用不变量，不把具体路径、SHA或本次临时目录硬编码进长期算法。
