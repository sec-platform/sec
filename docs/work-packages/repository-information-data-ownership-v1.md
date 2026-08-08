---
schema: codex-development-work-package-v1
id: repository-information-data-ownership-v1
tracking: issue-327
base: 49fdb7cd3be991742061621e3add982107e50367
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: repository-information-data-ownership
    owner: repository-structural-convergence-maintainer
    ownedPaths:
      - docs/work-packages/repository-information-data-ownership-v1.md
      - docs/work-packages/trusted-verifier-causal-closure-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - platform/dev-runner/test-runner.ts
      - platform/compiler/ir/validate-engineering-ir.ts
      - platform/compiler/projection/semantic-view-utils.ts
      - platform/compiler/semantic-impact/build-impact-propagation.ts
      - platform/compiler/semantic-impact/propagation-rules.ts
      - platform/compiler/semantic-mutation/canonical.ts
      - platform/compiler/semantic-plan.ts
      - platform/compiler/verify/run-semantic-mutation-isolated-child.ts
      - platform/compiler/verify/semantic-mutation-isolated-runtime-plan.ts
      - platform/compiler/verify/semantic-mutation-isolated-verification-evidence.ts
      - platform/orchestrator/pipeline-orchestrator.ts
      - platform/shared/ci-evidence-composition-policy-registry.ts
      - platform/shared/ci-evidence-contract.ts
      - platform/shared/ci-evidence-reuse-contract.ts
      - platform/shared/tcb-closure-lock.ts
      - platform/shared/windows-appcontainer-executor.ts
      - scripts/codex/repository-audit.ts
      - scripts/sec-dev/repository-analysis/repository-information-lifecycle.json
      - scripts/sec-dev/repository-analysis/repository-information-lifecycle.ts
      - platform/shared/test-impact-rules/governance.ts
      - tests/fixtures/work-package-gate-retained-recovery/records/000001-prepared.json
      - tests/fixtures/work-package-gate-retained-recovery/records/000002-authoring-committed.json
      - tests/fixtures/work-package-gate-retained-recovery/records/000003-verified.json
      - tests/fixtures/work-package-gate-retained-recovery/terminal-order/000000000002.json
      - tests/contract/documentation-authority.test.ts
      - tests/contract/dev-runner-contract.test.ts
      - tests/helpers/dev-runner-authority-proof.ts
      - tests/contract/repository-audit.test.ts
      - tests/contract/test-impact.test.ts
      - tests/unit/ci-evidence-reuse-contract.test.ts
      - tests/e2e/semantic-runtime-contract.test.ts
      - tests/unit/work-package-gate-execution.test.ts
      - tests/unit/windows-appcontainer-hardening-static.test.ts
forbiddenPaths:
  - .agents/
  - .github/workflows/
  - AGENTS.md
  - README.md
  - bun.lock
  - bunfig.toml
  - package.json
  - tsconfig.json
  - docs/archive/
  - docs/evidence/
  - docs/governance/nexus-absorption-ledger.yaml
  - docs/scripts/docs-doctor-ledgers.ts
  - platform/shared/ci-trust-root-registry.json
  - platform/shared/tcb-trust-root-contract.ts
  - scripts/codex/merge-gate.ts
acceptance:
  - '`scripts/codex/repository-audit.ts` remains the single repository-audit entrypoint/orchestrator but no longer owns the 146-row #282 deleted-blob table or the 16 durable claim-family records.'
  - 'The #282 deleted-blob transition, exact old-path/blob/raw-digest/bytes/line-count facts and durable claim-family records move byte-semantically unchanged into an explicit provider-neutral SEC development data/contract owner.'
  - 'The new data contract validates schema, Git identities, SHA-256 identities, tuple shape, rename target shape, disposition vocabulary and unique claim IDs before exporting frozen records.'
  - 'Repository audit consumes the validated records and preserves deleted-blob cross-check, disposition/claim closure, public report schema, failure semantics, current-tree classification, pollution detectors and existing CLI behavior.'
  - 'The rolling-plan relational contract is updated to the newly frozen candidate sequence; contract tests consume the current pointer/plan projection rather than retaining superseded candidate IDs.'
  - 'The data-only JSON is explicitly behavior-irrelevant to heuristic instruction extraction; moving prose-shaped machine records out of executable TypeScript must not create a second Agent instruction surface.'
  - 'The canonical repository-wide import organizer is clean; the 14 pre-existing import-order drifts discovered by the required gate are normalized mechanically without semantic changes.'
  - 'Suite-specific slow-test execution binds the registered suite timeout by default, while an explicit Bun timeout remains an intentional caller override; the runner contract and focused regression cover this boundary.'
  - 'The SM-3 terminal-retention acceptance uses the registered 300-second semantic-runtime suite budget; the test remains bounded and does not rely on Bun default or an undersized per-test timeout.'
  - 'The finite dev-runner authority Program proof has an explicit 600-second contract-test budget because it builds the complete 41-scenario TypeScript proof; it remains a bounded deterministic contract, not an unbounded test.'
  - 'Tracked static JSON under platform/ and scripts/ is admitted as bounded data input, never as an executable module; other repository roots remain excluded.'
  - 'Retained Work Package gate fixtures remain self-contained after the canonical hash migration: retired SM-3 manifests resolve through their frozen fixture copies, and recovery/terminal records bind the current canonical request, plan, verification and record revisions.'
  - 'No #282 historical semantic re-audit, archive restoration, package/lock change, product semantic change, broad scripts/codex namespace migration or generic repository-manager abstraction is included.'
  - 'Nexus 29 EPR detailed-record migration is intentionally deferred: its only canonical machine-state owner is docs/governance/nexus-absorption-ledger.yaml, while that ledger schema is enforced by causal-TCB module docs/scripts/docs-doctor-ledgers.ts. Moving those records requires a separate trusted-bootstrap-aware focused slice rather than silently expanding this ordinary-SUT refactor.'
  - 'The change intentionally updates the test-impact trust-root declaration and regenerates the derived TCB closure lock from the trusted revision; the TCB registry, workflows, merge-gate and docs-doctor-ledgers remain unchanged. Standard merge verification must report manual-bootstrap-required, and trusted-base bootstrap evidence is required before integration.'
  - 'Exact data parity checks, linked Bun transpilation, focused repository-audit contracts, docs doctor, strict typecheck, repository audit, affected plan/tests, independent Review, merge and new-main readback pass before completion.'
tests:
  - tests/contract/repository-audit.test.ts
  - tests/contract/documentation-authority.test.ts
  - tests/contract/test-impact.test.ts
---

# repository-information-data-ownership-v1

本包从 `main@49fdb7cd3be991742061621e3add982107e50367` 启动，是 Issue #327 的首个正式聚焦切片。
前驱 `trusted-verifier-causal-closure-v1`（Issue #178）已经完成 old-trusted candidate-as-SUT、
独立 Review、squash merge 与 new-main readback；其 active manifest 由本 candidate 原子接管后退役。

## 根问题

当前 `scripts/codex/repository-audit.ts` 把通用 audit 算法与 Issue #282 的大量历史 machine data
放在同一个 3,570 行模块中：146 条 deleted/renamed blob exact records 与 16 个 durable claim
families 都是静态事实，不是通用 audit algorithm。任何修改都因此扩大 review/context/change amplification。

## 本切片的唯一目标

```text
#282 deleted-blob + claim-family machine records
  → scripts/sec-dev/repository-analysis/repository-information-lifecycle.json
  → strict provider-neutral data contract

repository-audit
  → consume validated records
  → retain disposition / Git cross-check / report / detectors / CLI
```

保持所有 record 的原始值、顺序和现有 audit 结果，不在首包同时重命名全部 `scripts/codex/**`、
抽象通用 Git runner、重写 information lifecycle 或重新审计历史 47,287 行。

## 新发现后的边界回退

原始 Phase 1 还希望把 Nexus 29 EPR detailed records 迁回其 canonical ledger。当前 main 的物理
causal-TCB census 证明 `docs/scripts/docs-doctor-ledgers.ts` 属于 78-module TCB，而该 validator
对 `sec-nexus-corpus-ledger-v2` 使用 strict exact-key schema。把 `eprRecords` 真正写回 ledger 必须同步
修改该 TCB validator/lock并走 trusted bootstrap；不能为了“一次做完”把普通 #327 refactor 偷偷升级成
trust migration。因此本包明确停在 #282 records，Nexus 迁移作为后继独立 focused slice。

## 迁移不变量

1. 146 个 deleted/renamed records 和 16 个 claim families 必须逐对象语义相等；不能重新概括。
2. old/new Git blob、raw SHA-256、bytes、lineCount、rename target 全部保持。
3. 新 data contract fail closed：malformed schema/tuple/digest/disposition/claim ID 不能被 audit 消费。
4. `repository-audit.ts` 保持唯一 CLI/orchestrator；不得另建第二 audit executable。
5. `scripts/sec-dev/**` 是 provider-neutral development tooling，不取得产品语义 authority。
6. static machine prose 不成为 Agent instruction authority；data JSON 从 heuristic behavior extraction 排除。
7. unknown、unresolved、Git transition mismatch、blob/digest drift 的现有 failure semantics 不放宽。
8. 迁移完成后旧内嵌 static tables 必须物理退出 `repository-audit.ts`。
9. `repository-information-lifecycle.json` 必须由唯一 declared-only test-impact contract owner 映射到
   `repository-audit.test.ts` 与 `test-impact.test.ts`；未知 `scripts/sec-dev/**.json` 不得因通配 fallback
   被静默放行。
10. required `imports:check` 必须在完整 candidate tree 上通过；仅由 canonical import organizer 修复的
    既有排序漂移也必须进入同一 candidate 的 ownedPaths，不能借“base 已有”绕过门禁。
11. test-impact trust-root 变更不得由 candidate 自证；必须用 base-side closure/parser、独立 Review、
    trusted-bootstrap Evidence 和新 main readback 完成 epoch 切换。

## 非目标

- 不以 LOC 下降本身作为成功；
- 不迁 Nexus EPR records；
- 不修改 docs-doctor / TCB；
- 不做全仓 `CodexDevelopment*` rename；
- 不重构 branch lifecycle / Verification Session / merge authority；
- 不引入新依赖；
- 不恢复 archive；
- 不修改产品 Compiler / IR / Workbench；
- 不开始 #314、#312 或 #325 的正式 writer。
