---
schema: codex-development-work-package-v1
id: b3-active-documentation-bootstrap-v1
tracking: issue-132
base: eb48eb35d1cdb0c647154385f0c938bf1066f7d4
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v8
tasks:
  - id: b3-active-documentation-control-plane
    owner: a0
    ownedPaths:
      - .github/workflows/compiler-pr-validation.yml
      - .github/workflows/compiler-release-validation.yml
      - .github/workflows/sec-merge-gate.yml
      - docs/04-AI自主实现执行蓝图.md
      - docs/test-feedback-and-ci-lanes.md
      - docs/work/active-work-package.md
      - docs/work/current-state.yaml
      - docs/work/rolling-plan.md
      - docs/work-packages/b3-active-documentation-bootstrap-v1.md
      - platform/dev-runner.ts
      - platform/dev-runner/test-runner.ts
      - platform/shared/active-documentation-contract.ts
      - platform/shared/ci-git-changed-files.ts
      - platform/shared/ci-pr-risk-selection.ts
      - platform/shared/ci-verification-plan.ts
      - platform/shared/process.ts
      - platform/shared/repository-path-contract.ts
      - platform/shared/test-ownership-contract.ts
      - scripts/ci-pr-risk.ts
      - scripts/ci-verification.ts
      - scripts/codex/merge-gate.ts
      - tests/contract/ci-contract.test.ts
      - tests/contract/ci-lanes.test.ts
      - tests/contract/sec-merge-gate.test.ts
      - tests/contract/test-impact.test.ts
      - tests/unit/active-documentation-contract.test.ts
      - tests/unit/ci-git-changed-files.test.ts
      - tests/unit/ci-evidence-composition-policy-registry.test.ts
      - tests/unit/ci-pr-risk-execution.test.ts
      - tests/unit/ci-pr-risk-selection.test.ts
      - tests/unit/ci-verification-execution.test.ts
      - tests/unit/codex-work-package-contract.test.ts
      - tests/unit/process-output.test.ts
      - tests/unit/test-runner.test.ts
forbiddenPaths:
  - .githooks/
  - AGENTS.md
  - README.md
  - bun.lock
  - bunfig.toml
  - package.json
  - tsconfig.json
  - docs/03-MVP实施计划与路线图.md
  - docs/14-Engineering IR与语义事实规范.md
  - platform/cli/
  - platform/compiler/
  - platform/orchestrator/
  - platform/policies/
  - platform/registry/
  - platform/upgrade/
  - source/
  - project/
  - control/
acceptance:
  - "B3 is manually integrated as a verifier trust-root bootstrap; candidate v8 code never certifies its own merge authority and does not dispatch hosted Scope, Quick, Full, or release verification."
  - "The frozen integration head is one commit whose only parent is the live target-main base."
  - "Within the V1 CI changed-file and active-documentation selector domain, one shared canonical path owner rejects empty, non-NFC, NUL-bearing, absolute, backslash, colon-bearing drive/URI/ADS, empty-segment, dot-segment, and parent-segment inputs before any active-documentation pattern is evaluated."
  - "Git name-status, untracked-path, and exact-tree readers use fatal UTF-8 decoding with BOM preservation, retain literal U+FFFD and each decoded raw path identity without separator normalization, and fail closed on invalid bytes; a backslash-bearing record reaches both V1 and V7 canonical selection unchanged and fails before planning or ownership classification."
  - "The shared runCommand process seam keeps its default textual stdout contract and adds an explicit byte-output mode that joins the complete stdout byte stream before Git path decoding; affected-test discovery uses that seam for tracked and untracked reads instead of introducing a second process executor."
  - "One shared active-documentation contract classifies exact README.md, docs/**/*.md, and docs/{work,governance}/**/*.yaml|yml paths; other YAML, JSON, binary, absolute, backslash, and non-canonical paths remain fail closed."
  - "Test-impact source classification gives the active-documentation domain precedence over generic manifest/contract YAML, while PR-risk resolution and Quick verification planning consume the same contracts and resolve the complete 19-path PR #133 documentation diff without selecting impact-risk."
  - "Work Package V1 and Evidence V2 identities advance from ci-verification-v6 to ci-verification-v8; v6 manifest, attestation, evidence, and status cannot satisfy the current gate."
  - "Verification artifact identity advances from sec-verification-v7-* to sec-verification-v8-* in both producers and every base-side lookup."
  - "The registered Work Package V2 evidence-composition revision remains ci-verification-v7, and the fixed SM-3 P0 policy plan, scope, reuse, and capabilityComplete:false semantics do not drift."
  - "The new path contract and the previously omitted bun-runtime-version/install-git-hooks runtime leaves are part of the canonical verifier trust root; PR/release workflow trust arrays exactly match the base-side declaration, while dev-runner captures its bootstrap path once as the first executable top-level const and uses direct string-literal dynamic imports for all three runners. The asserted closure is limited to relative ESM static/literal import edges: only exact ./ and ../ prefixes enter recursive closure, while bare dot-prefixed names such as .hidden, every nonliteral dynamic import, and every absolute, URL, import-map, or non-approved package specifier fail closed. Generic external approval excludes bun, node:child_process, node:module, and node:worker_threads. One positive restricted-module classifier allows only bun Glob plus named spawn/spawnSync aliases mapped to Bun.spawn/Bun.spawnSync, and the classified node:child_process loaders, registering both default and namespace bindings when both exist; every other runtime binding, side-effect/default/namespace import where not explicitly modeled, runtime re-export, and dynamic restricted import fails closed, while type-only imports remain inert. Direct Bun/globalThis.Bun allows only version and reviewed spawn/spawnSync calls; both namespaces, globalThis, process, module, and import.meta are non-escapable, the equivalent Bun globals global/self are rejected entirely, loader globals/import bindings/require members may only appear as direct classified invocations, and import.meta positively allows only the direct ordinary url/dir/main members. Computed/reflective access fails closed, while process permits only the exact 13-member direct ordinary capability set used by the current TCB and no module-acquisition member. Every Bun and Node process loader, including every literal-git invocation, must match one exact registry identity formed from repository path, the complete named lexical-owner chain with declaration kinds, loader, and chain-scoped call ordinal; anonymous inline callbacks inherit the surrounding chain, every named nested function/method/variable-initialized arrow or function extends it, and duplicate same-kind/name owner chains fail closed. The dev-runner self-reentry edge remains separately AST-reviewed."
  - "The repository has separate current-state, rolling-plan, and active-work-package control planes; the selector points to this frozen B3 manifest and copies none of its envelope. current-state contains observed facts plus exactly one minimal root-level nextReconciliationPoint, never future acceptance or Gate prerequisites. Exact main is observed there, while candidate headSha remains null because a candidate cannot embed its own final commit SHA; the external Context Capsule and evidence bind the exact candidate head."
  - "B3 changes no existing/default product runtime behavior, compiler semantic schema, Engineering IR identity/revision algorithm, dependency, import organizer, hook, SM-3 product evidence, AppContainer capability claim, or PR #133 implementation branch. The shared process API delta is additive: byte stdout is opt-in, default text behavior is preserved, and only the new CI path-ingress caller selects byte mode."
  - "One focused local batch, typecheck, changed-only imports, documentation health, exact diff hygiene, strict YAML, actual manifest ownership, and GitNexus compare provide the complete candidate evidence."
tests:
  - "bun test tests/unit/active-documentation-contract.test.ts tests/unit/ci-git-changed-files.test.ts tests/unit/codex-work-package-contract.test.ts tests/unit/ci-pr-risk-execution.test.ts tests/unit/ci-pr-risk-selection.test.ts tests/unit/ci-verification-execution.test.ts tests/unit/ci-evidence-composition-policy-registry.test.ts tests/unit/process-output.test.ts tests/unit/test-runner.test.ts tests/contract/ci-contract.test.ts tests/contract/ci-lanes.test.ts tests/contract/sec-merge-gate.test.ts tests/contract/test-impact.test.ts --timeout 180000"
  - "bun run typecheck"
  - "SEC_IMPORTS_CHANGED_ONLY=1 SEC_CHANGED_BASE=eb48eb35d1cdb0c647154385f0c938bf1066f7d4 bun run imports:check"
  - "bun run docs:doctor"
  - "b3/yaml-strict: strict YAML parse of docs/work/current-state.yaml"
  - "b3/manifest-scope: actual Work Package parser plus exact base-to-candidate changed-record ownership"
  - "git diff --check eb48eb35d1cdb0c647154385f0c938bf1066f7d4 HEAD --"
  - "node .gitnexus/run.cjs detect-changes --repo sec --branch codex/b3-active-documentation-v8-bootstrap --scope compare --base-ref eb48eb35d1cdb0c647154385f0c938bf1066f7d4"
---

# B3 Active Documentation Bootstrap V1

## Architectural goal

PR #133 的 exact-head Quick 在任何 Gate 运行前，以 `changed-files-unresolved + ownership-impact` fail closed。真实 changed-file reader 已返回完整 19 路径；缺口来自 test-impact、PR-risk 与 Quick plan 三处各自只承认 `docs/**/*.md`，因而把 `README.md`、`docs/work/current-state.yaml` 与 `docs/governance/nexus-absorption-ledger.yaml` 错判为未拥有路径。

B3 在 V1 CI changed-file / active-documentation selector domain 内，把 Git raw changed-path custody、repository-relative POSIX canonicality 与 active-documentation 分类分成单向合同：Git reader保留 decoded path identity、不改写 separator；canonical path owner唯一拥有非空、NFC、NUL、slash、colon 与 segment 约束；active-documentation owner只在 canonical path 上匹配 README、Markdown 与受治理 YAML；test-impact 必须先判定 active-documentation，再判定通用 manifest/contract YAML。它不取代 Work Package、evidence、gate runtime、import organizer 等具有不同输入语义的 validator。这些 contract、consumer、workflow trust snapshot 与 artifact lookup 均属 verifier trust root，所以 B3 升级 V1 revision 与 artifact namespace 到 v8，使用旧 base 加 focused local evidence与人工 diff review集成；candidate v8 不能运行其自身 Scope/Quick 来证明 merge authority。

## Prerequisite and inputs

- SEC live base：`eb48eb35d1cdb0c647154385f0c938bf1066f7d4`；
- PR #133：Draft、mergeable、head `1b392c252a471bd03b40b03332ad6cb39b87be5d`，0 review、0 unresolved thread、0 REQUEST_CHANGES；
- Scope run `29900753057` 只对旧 Phase 0 identity有效；Quick run `29900819819` 在 changed-file preflight失败，四个 Gate 全部 `not-run`；最新 scheduled plan-revalidation run `29905050862` 成功，并因 Draft 为同一 head 刷新预期 failure status而不分配 runner；
- `classifyTestImpactSource` 为 CRITICAL（14 upstream / 3 direct / 2 processes）；`selectCiPrRiskSlowSuites` 与 active documentation plan均位于 CI critical path；
- exact-main trust-root closure sentinel 还确定性失败于 `platform/shared/bun-runtime-version.ts` 与 `scripts/install-git-hooks.ts` 未进入 canonical/workflow snapshots；两个文件已由现有 TCB runtime相对导入，不是 B3 新增依赖；
- B3 Review 进一步证伪“canonical validator能够看到 Git 原始 path identity”的假设：`parseGitChangedRecordsOutput` 与 untracked parser原先先调用 `posixPath()`，会把 Linux 上合法文件名中的反斜杠洗成 `/`；最终 reader删除该 normalization，单元与 parser→V1 plan sentinel证明反斜杠原样到达 canonical validator并 fail closed；
- 后续 Review 进一步反证 text-mode process capture能够保留 Git path identity：分块解码会损坏跨 chunk 的 UTF-8，默认 `TextDecoder` 还会吞掉首个 BOM code point。最终 Git ingress统一取得完整 bytes，使用 `fatal:true + ignoreBOM:true` 一次解码；shared `runCommand` 仅增加显式 byte mode，默认 text语义不变；
- B3 exact-head Review 先反证 static-import-only closure walker，再证明任何 `devRunnerModuleUrl` / WHATWG `URL` 专用解释器都会与 JavaScript 可变 binding、prototype 与 `import.meta.url` 真实语义竞争，无法通过枚举语法形成完整 code-loading 闭包；最终 dev-runner删除该 helper，把 `fileURLToPath(import.meta.url)` 作为 imports 后第一个 executable top-level `const` 只捕获一次，并把三个 runner加载改为 direct string-literal imports。B3 只断言 relative ESM closure：walker递归真实 `./` / `../` static/export 与 literal dynamic-import边，`.hidden`、absolute/drive/file/data/http/import-map/未批准 package specifier全部拒绝。Generic external allowlist不再整模块批准 restricted modules；positive classifier只允许当前 TCB的安全 binding与映射到既有 identity的 process loader，并完整登记同一 import中的 default/namespace binding；其他 runtime acquisition全部拒绝，type-only import保持 inert。Direct Bun namespace只允许显式安全 member与 reviewed calls；Bun/globalThis/process/module/import.meta namespace不得逸出，`global` / `self` 等价入口整体拒绝，所有 loader global/import binding/require member只能直接进入分类 invocation，`import.meta`只正向允许直接普通成员 `url` / `dir` / `main`，process只允许当前 TCB实际使用的精确 13-member普通能力集，computed/reflective acquisition与其他 process member均 fail closed。所有 Bun/Node动态 process dispatcher（包括 literal `git`）都须命中由 repository path、完整具名 lexical-owner chain及声明 kind、loader与 chain内 call ordinal组成的精确 registry identity；匿名 inline callback继承外层 chain，具名嵌套 function/method/variable-initialized arrow或function扩展 chain，同 kind/name重复 owner fail closed；dev-runner自重入 edge另由独立 AST sentinel审查；
- Work Package V2 composition revision仍为 `ci-verification-v7`，B3 不修改 policy registry、reuse plan或 SM-3 product evidence；
- 根 worktree 的用户 `AGENTS.md`、`.claude/settings.json` 与 `docs/goals/**` 不属于本包。

## Gate ownership, reconciliation, and stop

A0 是全部 B3 local Gate 的唯一 `gate_owner`。TCB relative-ESM/process-loader候选实现完成后，必须先由 A0 对最终 single-parent exact head完成独立 architecture review并给出 closeout；只有该 closeout成立，A0 才能一次性执行 manifest列出的 B3 Gate batch。所有结果绑定该 head与 base；manifest、head、base、revision、trust-root closure或 owned-path变化后，对应结果失效。B3 禁止 dispatch/rerun hosted Scope、Quick、Full或 release workflow，也不把预期 `manual-bootstrap-required` / Draft status当成实现失败或成功证据。

每次 stop 返回 tested head/base、changed paths/symbols、authority/public delta、acceptance delta、focused results、reusable/invalidated evidence、new blocker、next ready seam，以及 `inspect_ms`、`implement_ms`、`focused_validation_ms`、`wait_ms`、`reconcile_ms`、`context_reload_count` 与 `duplicate_gate_count`。稳定的下一 reconciliation point是 A0 对最终 single-parent exact head完成独立 architecture closeout；通过后才进入一次 B3 Gate batch并绑定 evidence。若其前 manifest/head/base/authority/ownership变化则该 point失效并重算。若 live `main`、PR #133、CI/Review或 V7 composition plan发生变化，停止扩写并重算；若 acceptance 与人工 integration evidence满足，立即合并 B3，重读新 `main`，再 refreeze PR #133。
