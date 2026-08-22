---
schema: codex-development-work-package-v1
id: sec-static-convergence-v1
tracking: issue-311
base: f513d6fe022951662ce64520e5a9d0ccfbf56192
manifestState: frozen
requiredProfile: full
ciRevision: ci-verification-v19
authorityRefs:
  - architecture
  - development-governance
  - verification-governance
tasks:
  - id: static-convergence-and-trust-closure
    owner: sec-convergence-owner
    ownedPaths:
      - .agents/
      - .dependency-cruiser.json
      - .github/workflows/sec-merge-gate.yml
      - AGENTS.md
      - docs/work-packages/sec-static-convergence-v1.md
      - package.json
      - platform/
      - scripts/
      - tests/
      - tooling/
  - id: selected-work-completion-projection
    owner: roadmap-owner
    ownedPaths:
      - docs/development-governance.md
      - docs/roadmap.md
      - docs/work/active-work-package.md
      - docs/work/README.md
      - docs/work/rolling-plan.md
      - docs/work-packages/delegation-consumer-zero-retirement-v1.md
forbiddenPaths:
  - .github/workflows/compiler-pr-validation.yml
  - .github/workflows/compiler-release-validation.yml
  - .github/workflows/sec-trusted-bootstrap.yml
  - bun.lock
  - docs/authority.json
  - docs/evidence/
  - docs/goals/
  - public-docs/
  - README.md
  - source/
acceptance:
  - the final candidate is rederived from exact main 2bdd3526d6f42993bfab3db87b66683afa06323a and preserves the already-merged public documentation projection without replaying the retired 540-commit integration ancestry
  - the candidate retires the merged predecessor Work Package manifest and repoints the active pointer and rolling plan to this package so the exact candidate tree resolves the document control plane census without stale Work Package errors
  - every candidate change is contained by this frozen ownership surface and no forbidden path is changed
  - no static audit local reasoning or manifest statement is represented as physical Verification Review MainHealth Gate or bootstrap PASS
  - changed TCB runtime modules are accepted only through the existing trusted bootstrap protocol and the generated TCB closure lock is never hand-edited
  - Git reads used by trusted and development control paths are isolated from ambient repository object config prompt askpass and SSH influence where this package owns the call site
  - compiler verification provenance policy report acceptance baseline and resolver projections remain deterministic canonical and fail closed on malformed duplicate partial or stale artifact sets
  - workspace creation opaque module publication release materialization Workbench mutation override application and Engineering Operation changes preserve explicit ownership transaction recovery and preimage boundaries rather than adding parallel write authorities; override planning binds canonical portable target identity plus complete source and target preimages before the first publication and every commit fence revalidates its source
  - core MergeGate accepts either one exact observable platform-enforcement projection or one stable provider-level feature-unavailable projection admitted by the canonical integration-platform policy; unknown or transport-ambiguous observations remain blockers and an unavailable projection is carried into authorization without claiming no-bypass enforcement
  - the current private repository plan does not expose GitHub rulesets or branch protection; the maintainer-rooted profile therefore binds exact-head compare-and-swap squash merge, no admin-enforcement override, exact terminal status and physical new-main readback while explicitly setting claimsNoBypassEnforcement false
  - richer GitHub ruleset or dedicated Integration-principal enforcement remains an additive provider capability when physically available and must never be fabricated as a prerequisite that makes a supported private/free repository impossible to integrate
  - GitHub Actions is an optional compatibility execution adapter rather than the unique Verification or integration authority; the canonical local trusted runtime uses an immutable Docker/Bun toolchain, binds one local npipe or unix Docker endpoint identity plus the canonical isolated host Git environment into its receipts and cache keys, rejects remote or drifting daemons, and never registers a self-hosted Actions runner or consumes Actions minutes
  - the canonical Verification provider registry represents independent trusted runtime execution explicitly and never converts a static positive availability claim into execution authority without a durable physical receipt
  - GitHub Actions and independent trusted runtime provenance are validated by separate adapters but both call one semantic MergeGate authorization reducer with no second candidate scope review Evidence or platform truth
  - local trusted MainHealth executes at most once for one exact main and immutable runtime plan, stores its canonical receipt in repository-scoped SEC Runtime State, and a full verified candidate carries the same four-gate health proof across exact tree-preserving squash readback so the next main does not repeat it
  - MainHealth uses one ledger compiler; the current Actions workflow and an exact dedicated GitHub App check are provider adapters, and duplicate wrong-principal wrong-head or workflow-masquerading direct-App checks remain locked
  - terminal sec/integration-authorization publication has one provider-neutral GitHub status publisher that accepts either canonical Gate transport, rereads exact PR/base before and after publication, and reads back one exact status id context description target and authenticated creator without deriving authorization from the status itself
  - trusted runtime container attempts hold one repository-scoped operation lease per ActionKey, use collision-free retained identities and reclaim only twice-observed same-host dead-owner resources; live foreign unknown or malformed resources block the same physical start rather than being bypassed, all closeout Git commands consume the canonical isolated Git environment, and Session Action Gate status recovery artifacts are repository-scoped rather than tied to one disposable worktree
  - immediately before merge the closeout path recompiles one canonical IssueDisposition plan from fresh candidate prose and provider closing references; ambiguous provider responses resume from exact merge markers plus durable canonical artifacts, and the existing post-merge Issue reconciliation runs before any next-main health publication
  - cross-session continuation does not create a second DevelopmentSession or execution state machine; existing VerificationSession remains the sole run stage journal and continuation is only a context-compression projection over one immutable upstream fact snapshot
  - the initial sec-local-continuation-checkpoint-v1 contains only irreducible upstream locator and exact Git identity facts, is digest-bound, and is admitted only after exact local branch base-tree head/tree one-parent clean-worktree manifest and rename/copy-aware Work Package ownership validation; candidate/self-generated or locally reconstructed checkpoints cannot establish remote freshness
  - after one admitted handoff the checkpoint is stored as a content-addressed object in canonical SEC Runtime State outside the repository tree, with a physical-workspace locator and active pointer so subsequent bun run dev:continue calls require no hand-managed JSON or repeated GitHub orientation
  - repository semantic state runtime durable state external platform state and cache are separate domains; Windows Linux and macOS resolve deterministic state/cache roots, SEC_STATE_HOME and SEC_CACHE_HOME may explicitly override them, any configured durable state/cache root inside the repository worktree is rejected, and durable state/cache roots may not overlap each other
  - local candidate edits only invalidate local candidate identity and remain zero-remote; Review MainHealth authorization merge and closeout boundaries refresh exactly their canonical live owner, explicit external change stales the snapshot, and control drift requires repository orientation instead of silently rebuilding freshness
  - continuation snapshot active-pointer retirement and garbage collection are reachability based; active objects are retained, terminal work makes its pointer immediately retireable, and corrupt active pointers fail safe by retaining objects rather than deleting uncertain recovery state
  - VerificationSession and VerificationAction durable journals and physical claims use the same external physical-workspace Runtime State namespace instead of repository .tmp; the zero-consumer FreezeSession V1 persistence entrypoint and its persistence-only test are retired rather than migrated into a second owner
  - runtime path resolution is a minimal adapter over canonical runtime-state primitives; VerificationSession and VerificationAction journals cannot import continuation CAS locator or GC code, so continuation convenience cannot enlarge their trusted closure
  - Verification Action planning and repository inspection have one canonical tooling owner, while the physical child-process effect is isolated in one narrow dev-runner executor whose exact dispatcher identity and module digest are bound by the TCB; the deleted scripts/codex shims are not compatibility APIs
  - test architecture consumes the tracked module graph and structured document parsers rather than mirroring implementation sentences; raw TypeScript bytes are available only through purpose-bound hostile-mutation or transpile fixtures, and physical copy proof uses a byte-equality capability that never returns source text to the caller
  - rolling-plan selection and non-selection transitions use one digest-bound typed machine projection union and one whole-document renderer; committed replan binds sole-parent exact HEAD/tree plus source manifest pointer and rolling raw-byte digests without copying a nested projection digest or prior prose, repairs stale derived manifest digests without weakening package tracking path or base identity, and repairs a later main-side published control drift only when the pointer binds exactly one of rolling or live-default manifest, the historical exact main/tree/source generation is fully readable and ancestry-proven, and the first live-default generation after that base contains the exact same manifest/pointer/rolling publication bytes; candidate-authored alternate source or rolling bytes are rejected. It automatically refreshes projection identity when exact source-tree delta includes any non-projection path without replacing the independent Work Package scope owner, while WorkDecision replan or MainHealth may not mutate headings prose or digest fields independently
  - branch names are transport locators rather than authority; candidate admission binds one non-default branch to exact base head remote ref and optional worktree identity without granting or denying authority from a codex prefix
  - document-control projection and GitHub observation edits select fast pure projection tests; the full crash-recovery matrix remains a slow test owned only by transaction/effect changes instead of every roadmap manifest or WorkDecision edit
  - ordinary and repair MainHealth routing use distinct exported typed entrypoints over one private reducer, so product callers cannot select a lane by duplicating string policy and no repository-wide source scanner is required to police the boundary
  - continuation admission and Runtime State have context-compression-only authority and never substitute for trusted bootstrap Verification Review MainHealth IntegrationAuthorization status publication platform enforcement or merge
  - authorization evaluation terminal status publication and physical integration run in disjoint capability domains so no single execution principal can both mint terminal authority and mutate main without an independently validated authorization handoff
  - the terminal merge-facing authorization projection is isolated from sec/action status contexts and binds exact base head MergeGate result digest and semantic ruleset digest before any physical integration effect
  - the merge effect cannot mint its own terminal authorization and rereads live base head terminal status and the exact semantic ruleset digest immediately before mutation
  - GitHub platform enforcement is physically observed immediately before merge; drift and unknown observations are hard blockers, while a stable provider-level feature-unavailable result follows the explicit maintainer-rooted policy and cannot be reported as no-bypass protection
  - successful final integration requires content-addressed full Verification or independently readable reusable Action Evidence, exact-head independent Review, healthy cached MainHealth, MergeGate, terminal authorization publication, exact-head squash compare-and-swap and exact new-main tree readback regardless of which trusted execution provider performs the physical computation
  - old result branches and public-doc residue refs are retired only after the final main tree is verified to contain their valid result; branch names or ancestry alone never justify merge or deletion
tests:
  - tests/contract/agent-skills.test.ts
  - tests/contract/sec-merge-gate.test.ts
  - tests/contract/test-architecture.test.ts
  - tests/contract/test-impact.test.ts
  - tests/contract/ci-contract.test.ts
  - tests/contract/ci-trust-closure-contract.test.ts
  - tests/contract/tcb-closure-lock.test.ts
  - tests/contract/compiler-internal-import-boundary.test.ts
  - tests/contract/local-continuation-boundary.test.ts
  - tests/contract/verification-action-tooling-boundary.test.ts
  - tests/unit/continuation-invalidation.test.ts
  - tests/unit/branch-lifecycle-contract.test.ts
  - tests/unit/document-control-plane-github-observation.test.ts
  - tests/unit/document-control-plane-projection.test.ts
  - tests/unit/integration-authorization-publication.test.ts
  - tests/unit/integration-authorization-status-github.test.ts
  - tests/unit/integration-platform-policy.test.ts
  - tests/unit/local-continuation-managed.test.ts
  - tests/unit/local-continuation.test.ts
  - tests/unit/main-authority-ruleset-contract.test.ts
  - tests/unit/main-authority-ruleset-github.test.ts
  - tests/unit/main-authority-provider-neutral.test.ts
  - tests/unit/main-health-provider-neutral.test.ts
  - tests/unit/runtime-state.test.ts
  - tests/unit/sec-runtime-state-contract.test.ts
  - tests/unit/trusted-runtime-provider-capability.test.ts
  - tests/unit/trusted-runtime-merge-gate-adapter.test.ts
  - tests/unit/trusted-runtime-container.test.ts
  - tests/unit/verification-action-journal.test.ts
  - tests/unit/verification-action-runner.test.ts
  - tests/unit/verification-session-journal.test.ts
  - tests/unit/verification-session-runtime.test.ts
  - tests/unit/git-read-environment.test.ts
  - tests/unit/project-baseline-authority.test.ts
  - tests/unit/release-artifact.test.ts
  - tests/unit/work-selection-live.test.ts
---

# SEC 静态收敛与信任闭包

本 Work Package 只承载当前单一正式收口候选的最终结果，不继承历史 integration 分支中 540 个过程提交的工程权威。候选必须始终从本清单绑定的精确 `main` 重新导出最终树；历史提交只保留追溯价值。

本包覆盖当前已经完成的静态架构收敛，以及为其进入 `main` 所必需的 TCB、MergeGate 与 GitHub 平台强制边界闭包。任何测试、Review、MainHealth、Gate、bootstrap 或 merge 结论都必须来自真实物理执行，不能由本文档或静态分析自证。

GitHub Actions 只是一种可选 trusted execution adapter，不是 Verification、IntegrationAuthorization 或 main authority 的唯一语义 owner。Canonical local trusted runtime 直接复用固定 OCI image、Bun 与现有 VerificationSession/ActionKey/MergeGate contracts；依赖安装完成后断网执行，Evidence、MainHealth、Gate 与 status receipt 全部写入仓库外 SEC Runtime State。它不注册 self-hosted Actions runner，也不消耗 Actions minutes 或 artifact quota。

跨会话续跑不再拥有独立状态机。第一次接力只消费上游真实 Git/GitHub snapshot 形成的 `sec-local-continuation-checkpoint-v1`，运行 `bun run dev:continue -- --handoff <external.json> --json` 完成一次精确 admission，并把 immutable snapshot 写入仓库外 SEC Runtime State CAS；之后同一物理工作区只运行 `bun run dev:continue -- --json`。本地 candidate 变化不机械触发 GitHub census，只有外部 authority boundary 或明确 external change 才由 invalidation compiler 指向相应 live owner。任务终态自动退役 active pointer，并按 reachability/retention 回收不可达 snapshot。

Runtime State 与 Git repository tree、GitHub platform state、cache 明确分层。Continuation snapshot、VerificationSession journal、VerificationAction journal/claim 都属于 durable runtime state，不再长期散落于 repository `.tmp`；transaction-local scratch/recovery 是否位于工作树仍由其自身 owner 和生命周期决定，不能把“清理缓存”简化成机械移动所有 `.tmp`。journal 所需的路径解析保持为最小 adapter，不依赖 continuation CAS/locator/GC store。

当前 private/free provider 不提供 ruleset/branch-protection API，这一能力事实不能再伪装成永久等待条件。当前 maintainer-rooted integration profile 只声称它实际拥有的保证：one exact authenticated principal、terminal status readback、PR head SHA compare-and-swap、squash tree equality与remote `main`物理读回；`claimsNoBypassEnforcement=false` 是正式合同字段。若未来 provider 暴露 ruleset 或 dedicated Integration principal，直接把新的可观察 enforcement receipt 加入同一 policy owner，不建立第二套 Gate。

TCB 的网络出口只有一个 canonical GitHub API dispatcher。其 origin/redirect contract 在 Effect 前验证，TypeScript symbol-aware closure census区分局部同名值与全局网络能力，并把 direct-call owner identity、ordinal、live census 写入 generated lock；禁止裸 `fetch`、别名、computed/optional access、第二 network owner或手工修改 generated region。

```mermaid
flowchart LR
  A[exact live main] --> B[cached MainHealth receipt]
  C[exact PR head] --> D[ActionKey closure]
  D --> E[pinned Docker + Bun]
  E --> F[network-disconnected Verification]
  B --> G[one semantic MergeGate]
  F --> G
  H[independent exact-head Review] --> G
  G --> I[exact terminal GitHub status]
  I --> J[head-SHA CAS squash merge]
  J --> K[remote main SHA/tree readback]
  K --> L[next-main MainHealth carry-forward]
```

`bun run sec:closeout -- --pr <number>` 是 candidate closeout entrypoint；`bun run sec:main-health` 是同一 owner 的显式 clean exact-main entrypoint。两者复用同一个固定 image、Docker endpoint、runtime workspace 和 receipt publisher，不形成第二条实现。相同 exact main 的 immutable MainHealth receipt 与相同 Session/ActionKey 的 Action Evidence 均按内容寻址复用；observation freshness 不使底层证明过期，只有 exact main、candidate tree、dependency closure、review authority 或 toolchain identity 真正变化时才重新执行相应最小缺口。

冻结顺序固定为 source normalization → generated TCB lock → read-only checks/Evidence。Import transform 等 normalizer 仍有 delta 时禁止生成内容寻址锁，避免同一候选因命令顺序自我失效并重复验证。
