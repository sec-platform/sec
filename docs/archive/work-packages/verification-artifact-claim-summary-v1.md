---
schema: codex-development-work-package-v1
id: verification-artifact-claim-summary-v1
tracking: issue-217
base: 6cc3bf8a3b655bebf85dfca3f065c9842207c086
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: verification-result-and-artifact-contract
    owner: verification-contract-worker
    ownedPaths:
      - platform/shared/product-verification-claim-plan.ts
      - platform/shared/verification-result-contract.ts
      - platform/shared/verification-artifact-contract.ts
      - platform/compiler/verify/verify-project.ts
      - platform/compiler/verify/run-runtime-verification.ts
      - platform/compiler/verify/run-policy-gate.ts
      - platform/compiler/verify/run-semantic-mutation-isolated-child.ts
      - tests/contract/verification-result-contract.test.ts
      - tests/unit/verification-result-core.test.ts
      - tests/unit/verification-artifact-claim-summary.test.ts
      - tests/unit/verification-claim-migration.test.ts
      - tests/unit/semantic-mutation-verification-adapter.test.ts
  - id: mutable-workspace-fixture-isolation
    owner: verification-contract-worker
    ownedPaths:
      - tests/testkit/workspace.ts
      - tests/integration/semantic-mutation-recovery-lifecycle.test.ts
  - id: fast-runner-resource-and-failure-receipt
    owner: verification-contract-worker
    ownedPaths:
      - platform/dev-runner/fast-test-policy.ts
      - platform/dev-runner/test-concurrency-policy.ts
      - platform/dev-runner/command-runner.ts
      - platform/dev-runner/test-runner.ts
      - tests/helpers/dev-runner-authority-proof.ts
      - tests/contract/dev-runner-contract.test.ts
      - tests/unit/dev-runner-authority-proof.test.ts
      - tests/unit/fast-test-concurrency.test.ts
      - tests/unit/test-runner.test.ts
      - tests/unit/command-runner.test.ts
  - id: verification-artifact-control-plane
    owner: a0-integrator
    ownedPaths:
      - docs/work-packages/verification-artifact-claim-summary-v1.md
      - docs/work/active-work-package.md
      - docs/work/rolling-plan.md
      - docs/evidence/2026-08-03-constraint-thoughts-execution-plan.md
      - docs/work-packages/affected-selection-trust-boundary-v1.md
      - docs/archive/work-packages/affected-selection-trust-boundary-v1.md
forbiddenPaths:
  - bun.lock
  - bunfig.toml
  - package.json
  - tsconfig.json
  - AGENTS.md
  - README.md
  - platform/shared/verification-types.ts
  - platform/shared/ci-contract.ts
  - platform/shared/ci-verification-plan.ts
  - platform/orchestrator/
  - scripts/codex/
  - scripts/ci-verification.ts
  - scripts/ci-pr-risk.ts
  - .github/workflows/
  - docs/authority.json
  - docs/work/current-state.yaml
  - source/
  - project/
  - control/
  - tests/e2e/
acceptance:
  - "platform/shared/product-verification-claim-plan.ts is the only current product authority for the six product claim/gate identities, every gate-to-claim binding, the ordered lane-to-required-claim plan, and the byte-equivalent current normal/blocked report-to-gate projections. It exposes fresh typed projections from one private immutable registry; normal and blocked writers, fast/runtime/policy gate producers, and the artifact validator consume those projections, and no consumer re-pairs imported constants, copies a binding table, or independently maps a serialized lane status into gate truth."
  - "platform/shared/verification-result-contract.ts exports one canonical aggregate assertion that requires the trusted VerificationAggregateInputV1, reuses the existing result status, reason-code, exact-key, gate-result, aggregate writer, and overall reducer authority, and exact-compares the writer projection; the artifact parser defines no second status/reason table or claim truth algorithm."
  - "The canonical assertion rejects unknown nested keys; empty, control-character, missing, duplicate, or unknown claim/gate/contributing identities; invalid status/reason pairs; incomplete passed coverage; missing claim-plan linkage; unknown contributing gates; and any contradiction among the trusted required claim plan, overall, claim, and gate truth. Every present trusted claim has non-empty unique requiredGateIds and owningEnvironments; generic claims=[] remains valid, but no present claim can manufacture a vacuous passed closure."
  - "Result and artifact public unknown-value guards share one strict data-only boundary: ordinary own-data objects and dense ordinary arrays only, exact Reflect.ownKeys, no symbol/non-enumerable/accessor/toJSON/custom-prototype or overridden-array surface, and exact top-level aggregate-input keys. Validation snapshots trusted claims and gates before recomputation, and exact comparison uses structural data equality without invoking candidate-controlled serialization or collection methods."
  - "The current canonical all-lane artifact is validated against the compiled trusted all-lane product claim plan, never against self-declared claimResults or gate link fields. Removing a failed/not-run/invalidated/unsupported required claim, removing its gate, or replacing the aggregate with an empty passed result is blocked even when legacy lanes, summary.status, failedLanes, and child exit are forged green."
  - "A passed claim has coverageComplete=true and a non-empty unique contributing gate closure; every required contributing gate exists, is passed, and links the claim through both requiredForClaims and supportedClaims. Additional gates outside the trusted current required claim plan remain allowed and need not pass, including through the real current artifact classifier."
  - "One internal overall projection reducer is shared by the aggregate writer and assertion while current writer output remains byte-equivalent; owning environments, status-lattice precedence, policy applicability, and runtime no-test semantics remain owned by Issue #215."
  - "platform/shared/verification-artifact-contract.ts owns only exact report/envelope keys, cross-artifact equality, legacy projection, and delegation to the canonical Result assertion. For every current all-lane report, each canonical fast/runtime/policy gate must equal the corresponding gate produced by the shared normal writer projection from the serialized lane and policy reports, or by the shared blocked-writer projection when the exact blocked report envelope is present. Extra gates outside the trusted current plan remain allowed; a self-consistent aggregate cannot override a mismatch between a canonical gate and its serialized lane report."
  - "runSemanticMutationIsolatedVerificationChild preserves the current canonical report type after its artifact classifier has rejected blocked input, so merge-authoritative consumers cannot lose the required claimSummary guarantee at the producer boundary."
  - "CanonicalVerificationArtifactSet.verificationReport uses an exported current canonical report type whose summary.claimSummary is required; ordinary VerificationReport remains readable with optional claimSummary for historical diagnostics only."
  - "A report without claimSummary is non-canonical and cannot issue PASS through isCanonicalVerificationArtifactSet, staged proof, pipeline completion, or the Semantic Mutation classifier; it requires verification re-execution."
  - "Legacy summary.status is passed if and only if claimSummary.overall.overallStatus is passed; failed, invalidated, unsupported, and not-run all project to legacy failed. No serialized report, gate, aggregate, or claim keys are added."
  - "Property coverage proves every result produced by the current canonical aggregate writer with the same trusted plan is accepted, and real buildClaimSummary('all', ...) passed, failed, and blocked reports traverse the actual isolated Semantic Mutation classifier without validator/writer drift. Adversarial coverage rewrites each canonical gate and aggregate to a self-consistent value while leaving its serialized fast/runtime/policy report unchanged and proves the artifact is blocked; impossible gate-only non-passed fixtures are tested at the Result assertion boundary rather than admitted as canonical artifacts."
  - "copyWorkspaceFixture is the unique mutable-workspace clone authority and materializes every ordinary regular file with a distinct physical identity; source and destination both retain link count one, and writes through direct host filesystem APIs cannot mutate the template or another clone."
  - "Mutable fixture cloning uses a filesystem copy-on-write clone hint when supported and a regular independent copy fallback when unsupported; it never uses hard links. Symlink recreation and the existing classified .sec snapshot boundary remain unchanged."
  - "The Semantic Mutation source path authority continues to reject hard-linked authoring source. The SM-3 real lifecycle reaches a ready plan after fixture cloning without weakening the nlink=1 invariant or teaching the test to bypass the canonical path proof."
  - "The obsolete generic hard-link optimization and its writeText-dependent safety claim are removed. Any future read-only fixture sharing requires a separate explicit contract, usage boundary, mutation rejection, and focused Evidence rather than reusing the mutable API."
  - "platform/dev-runner/fast-test-policy.ts is the only owner of the default combined fast-test resource budget. For every supported availableParallelism input, the concurrent shard process allocation multiplied by the projected Bun max concurrency is positive and does not exceed the canonical bounded global budget."
  - "No absolute process-wave literal claims to bound every supported host. Any wave assertion is derived from the current selected inventory and the canonical per-resource limits across the complete supported availableParallelism domain; selection completeness, stale-isolation classification, and combined-budget checks remain fail closed."
  - "platform/dev-runner/test-concurrency-policy.ts is a pure argv projection and no longer reads or independently interprets availableParallelism. An explicit caller --max-concurrency value is preserved byte-for-byte; the managed fast plan adjusts its process allocation or rejects an over-budget combination rather than silently overriding it."
  - "The process-isolation plan preserves independent-process, shared-host-runtime, repository-worktree, and host-profile as distinct physical resource classes with explicit concurrency limits and deterministic class order. It never flattens different resource classes into one isolatedParallel queue, and every selected file appears exactly once in deterministic order."
  - "runDevCommand remains the one reviewed no-shell spawn dispatcher and preserves its canonical TCB dispatcher identity. Its observed execution result distinguishes normal exit, signal termination, and spawn failure, and binds the exact effective argv, duration, and bounded stdout/stderr failure tails without adding a second spawn pipeline."
  - "Each focused dev-runner proof invocation obtains one bounded Git-tracked live inventory from the exact platform/ and scripts/ roots using an exact supported-source-extension set, with no filename/path-substring semantic exclusions, adds the canonically sorted adversarial virtual modules, and builds exactly one immutable TypeScript Program, one TypeChecker, one NodeNext resolution cache, and one ProgramSymbolIndex. Lexical binding, shorthand value, canonical alias, callable declaration, SourceFile ModuleId, import/export slot, package surface, and scenario ownership identities come only from that Program; identifier text, source slices, regex, raw occurrence counts, display paths, and fixture-specific analyzers are not semantic authority."
  - "The suite Program host parses the pinned repository tsconfig and overlays every unique virtual source consistently through fileExists, readFile, getSourceFile, realpath, current-directory, canonical-filename, and NodeNext module-resolution operations. .ts/.mts/.cts and .js/.mjs/.cjs receive their TypeScript-implied Node format; syntactic diagnostics use public Program APIs and are attributed to the owning scenario; symbol object identity, not private Symbol.id, is canonical. Only the bounded live inventory and explicit virtual fixture modules enter proof reachability, while pinned TypeScript/Node/Bun declarations may be loaded for binding without becoming scenario facts."
  - "Static module-specifier evaluation is symbol- and scope-bound. It accepts immutable const string literals, no-substitution templates, template substitutions, and string concatenation through their exact lexical declarations; duplicate names in disjoint scopes remain independent, parameter/local shadowing cannot borrow an outer value, mutation or ambiguous writes fail closed, and runtime-computed specifiers produce one deterministic unknown executable frontier rather than enumerating modules."
  - "One canonical TypeScript NodeNext resolver normalizes ESM import/export, import-equals-require, require/module.require, dynamic import, named/default/namespace acquisition, .js-to-TypeScript and extensionless/index equivalence, package exports/main/module/runtime/browser targets, and cyclic multi-level barrels. Import and require usage modes select their correct conditional package targets while type-only branches create no runtime edge. Internal specifiers resolve to one exact Program ModuleId; ambiguous, escaping, or unresolved executable targets fail closed."
  - "tests/helpers/dev-runner-authority-proof.ts is the only analyzer-kernel owner. It separates a fixed-width HandleBit/ProtectedRoleBit value domain from non-flowing callable EffectBit summaries, owns one immutable capability registry, and contains no per-value Set of arbitrary Program callables or namespaces, no ambient-global-by-scenario cross seed, no acceptsMaterializedAuthority declassification switch, and no competing transfer table in validators, fixtures, or production code. Ordinary callable declarations and module identities remain sparse structural nodes, never propagating value facts."
  - "The proof topology has distinct typed constraints for alias/join, exact PropertyWrite and PropertyRead slots, spread, parameter, return, call site, module import/export slot, namespace selection, and capability derivation. Shorthand uses TypeChecker.getShorthandAssignmentValueSymbol and is field-equivalent to an explicit property initializer; a known property never receives sibling facts. Reflect.get, element access, object spread, Object.assign, Object.defineProperty, destructuring, CommonJS exports, and ESM exports lower to this same property/export-slot owner. Opaque getters, mutation, computed keys, specifiers, or executable targets inside a protected closure emit one stable fail-closed unknown frontier rather than widening to every field, callable, namespace, or module."
  - "Topology construction, module export-slot SCC construction, sparse direct-call/callable SCC construction, and scenario partitioning finish before one delta-only solve begins. Solver work items are exact newly inserted fixed facts; every (ValueId, proof bit), call-site/protected-role pair, export-slot/protected-role pair, and unknown frontier is processed at most once, and solve never creates a node, edge, rule, callable, namespace, or export slot. The compact frozen proof projection, not the Program or mutable graph, is the only validation input."
  - "The finite proof bound is derived structurally as Time O(P * (V + E + R) + F + C + X) and Memory O(words(P) * V + E + R + F + C + X), where P is the fixed proof-bit count and V/E/R/F/C/X are frozen topology counts. Counters prove inventoryReadCount == 1, programBuildCount == 1, typeCheckerBuildCount == 1, topologyFreezeCount == 1, graphSolveCount == 1, postSolveTopologyMutationCount == 0, arbitraryCallableFactCount == 0, arbitraryNamespaceFactCount == 0, ambientCrossProductSeedCount == 0, emittedFactCount == processedFactCount, and fact/edge/rule applications stay within their input-derived bounds. Wall-clock, working set, CPU count, GC, propagation depth, scenario count, and machine-specific thresholds are never PASS authority."
  - "Direct internal calls use exact TypeChecker callable identity and one sparse call-edge writer. Passing a callable is not itself invocation; exact reachable direct calls and finite fixed-bit parameter/return effects model callbacks, aliases, wrappers, factory returns, and higher-order parameters. Invoking a value carrying a protected role records the exact owner/site effect; unresolved indirect execution inside the bounded closure fails closed without enumerating every Program callable. Validators consume the frozen reachable-call and effect projection and do not run a second BFS or module exposure algorithm."
  - "Module surfaces use exact ExportSlot(ModuleId, exportName) nodes and one SCC summary for named/default/star/CommonJS/package exposure. Namespace and package acquisition consume that projection; known safe named selection reads only its exact slot, materializing a whole sensitive namespace or using an ambiguous property fails closed, and no ProgramNamespaceFact or recursive per-query moduleExposesBounded path remains."
  - "Every module, value, callable, export slot, constraint, emitted fact, query, and finding belongs to exactly one ScenarioPartition. Ambient/runtime capabilities are seeded only at exact TypeChecker-proved reference sites in their owning scenario. Cross-scenario transfers emit a deterministic finding and do not propagate. Adding an unrelated ordinary callable, namespace, property, module, or scenario cannot increase an existing scenario's protected semantic fact closure; catalog/source/edge insertion permutation cannot change canonical proof bytes or findings."
  - "The authority-binding runBoundedFastTestInvocations wrapper is physically file-local in platform/dev-runner/test-runner.ts. Any exported scheduling test seam is pure, owns no child-process handle, and accepts already-materialized data plus an injected dispatch dependency; module scope, rather than a current-consumer census, prevents future import/barrel/package exposure. Its closure owns exactly one direct canonical runDevCommand dispatch and no loader, child, policy, environment, or executor exposure. runCommandBytes reaches only the two literal gitChangedFiles('git', ...) calls. command-runner.ts obtains the sole reviewed dev-runner spawn value directly from node:child_process and uses it only inside the unique exported runDevCommand owner; aliasing, exporting, passing, wrapping, namespace/property flow, or any additional dev-runner child authority is rejected without claiming repository-global exclusivity over unrelated process owners."
  - "Every adversarial scenario owns a unique canonical virtual root under __contract__/scenario/<scenarioId>/ and declares its exact ScenarioPartition owner modules and expected findings. The live scenario binds the real canonical owners; owner-replacement scenarios bind unique virtual ModuleIds instead of overlaying live identities. All scenarios and the live inventory use the same ProgramSymbolIndex, module surface index, typed topology builder, capability registry, delta solver, and frozen validator projection; there is no legacy shadow solver, per-scenario Program, name-based fallback, second fixture analyzer, or post-solve semantic mutation."
  - "Pure property/model tests compare random small fixed-bit graphs with a simple reference closure; prove duplicate/cycle idempotence, shorthand/explicit equivalence, field sensitivity, unknown-frontier cardinality, exact once-only processing, cross-scenario isolation, module/call SCC convergence, unrelated-callable/module non-amplification, and canonical output under input permutation. The shared contract retains legitimate lexical shadowing, comments, ordinary strings, type-only edges, the reviewed runFastTests consumers, and already-materialized ordinary concurrency/environment arguments while rejecting policy/environment reads and import-equals, CommonJS, dynamic, namespace/default, package-surface, wrapper, higher-order, factory-return, alias, destructure, Reflect, opaque, and cyclic-barrel bypasses."
  - "Tracked host source reads are allocation-bounded and identity-bound: canonical containment and pre-open non-symlink metadata are followed by an opened read-only handle, handle fstat regular-file/identity/size proof, rejection before content allocation when size exceeds 512 KiB, at most limit+1 bytes read from that handle, explicit EOF/extra-byte classification, strict UTF-8 decode, post-read handle/path identity and size readback, and close in finally. The complete inventory remains NUL-delimited Git tracked paths with at most 1,024 modules and 8 MiB total accepted source bytes; any path, identity, size, read, decode, or parse drift fails closed."
  - "Object.prototype.toJSON and Array.prototype.toJSON have direct synchronous contract regressions: each test saves the exact canonical descriptor, installs a counting function or getter, invokes CodexDevelopmentSnapshotVerificationDataV1, restores the descriptor in finally before any matcher/error formatting/serialization, and proves rejection with zero candidate-controlled execution and descriptor-equivalent restoration."
  - "Synchronous spawn throw, asynchronous error-only, close, error-then-close, close-then-error, and duplicate terminal events settle exactly once; the first terminal event wins and no later event replaces or resolves it again."
  - "Child terminal outcome, observation-integrity failure, and observer rejection retain mutually distinct provenance. Observer rejection cannot invent effective argv or a child terminal; unresolved child terminal and failed observation integrity can coexist and remain non-passed through runFastTests composition."
  - "The command runner owns the only UTF-8-safe text-tail algorithm. After final public or receipt serialization, stdout/stderr tails, planned/effective argv entries, spawn errors, integrity errors, and observer errors each remain within their declared UTF-8 byte maximum without splitting a Unicode code point, including invalid raw bytes, multibyte boundaries, and lone surrogates. Direct unit cases exercise lone high and low surrogates below and at the three-byte replacement-scalar boundary and recheck the final serialized/public field byte bound."
  - "The fast runner assigns deterministic invocation identities, gives every started invocation exactly one outcome, waits for every sibling already started in a batch, emits one plan-order bounded receipt at the batch boundary, and starts no later batch or resource class after failure. The explicit bounded mechanism seam deterministically covers limits 1, 2, 3, 4, and greater than 4; host-derived fixtures wait for and assert only min(resolved limit, remaining queue length) actually startable children, so a one-CPU host cannot fail or deadlock."
  - "Signal termination, spawn failure, unresolved terminal, observation-integrity failure, observer rejection, and final workspace cleanup failure remain non-passed with no retry or timeout expansion. Primary-failure presence is tracked independently from its value: undefined, null, 0, false, and the empty string are rethrown unchanged, cleanup still runs and retains its secondary diagnostic, and cleanup never overwrites primary child or bootstrap classification."
  - "test-runner unit isolation loads the actual command-runner export surface before mocking, forwards every canonical export, and overrides only runDevCommand; it consumes the real boundedUtf8TextTail and devCommandObservationExitCode authorities and passes when executed as the only test file, independent of cross-file module cache or order."
  - "Successful children retain the existing live output and exit semantics without a duplicate failure summary. CI revision remains ci-verification-v19 because this package changes neither Gate argv/schema, artifact namespace, workflow, nor Evidence schema; the runner delta remains trust-root work that requires base-side bootstrap."
  - "The active pointer selects this raw Git blob digest, rolling plan names Issue #217 as the unique current package with #215 -> #216 -> #207 next, and affected-selection-trust-boundary-v1 exists only under docs/archive/work-packages/."
  - "docs/evidence/2026-08-03-constraint-thoughts-execution-plan.md freezes the phase 0-5 execution route (candidate-stack freeze, #227 completion, four Issue #215 replacement WPs, safety closure, product line) and records the adaptation that evidence is the durable location because #227 forbids docs/authority.json changes; rolling plan links it as the current route state source."
  - "Issue #217 closes only after the focused batch, one final affected plan/run, exact selected Risk, repository audit, independent exact-head Review, trusted-base bootstrap, expected-head integration, and new-main readback. Hosted manual-bootstrap-required is an expected trust boundary, not candidate self-certification."
tests:
  - tests/contract/verification-result-contract.test.ts
  - tests/unit/verification-result-core.test.ts
  - tests/unit/verification-artifact-claim-summary.test.ts
  - tests/unit/verification-claim-migration.test.ts
  - tests/unit/semantic-mutation-verification-adapter.test.ts
  - tests/integration/semantic-mutation-recovery-lifecycle.test.ts
  - tests/unit/dev-runner-authority-proof.test.ts
  - tests/contract/dev-runner-contract.test.ts
  - tests/contract/sec-merge-gate.test.ts
  - tests/unit/fast-test-concurrency.test.ts
  - tests/unit/test-runner.test.ts
  - tests/unit/command-runner.test.ts
---

# verification-artifact-claim-summary-v1

Issue #217. Close the trust boundary between the canonical unified Verification Result and
the current serialized Verification artifact without changing Issue #215 product semantics.

## Root cause and invariant

The current writer emits `summary.claimSummary`, while the artifact adapter previously either
rejected that current shape or validated its nested fields independently. Independent shape
checks permit contradictory aggregate, claim, and gate truth to reach a legacy PASS, and
accepting an unversioned report without `claimSummary` permits deletion of unified truth to
restore the same bypass.

The first assertion repair still accepted a self-consistent subset because it had only the
serialized `claimResults` and gates, not the trusted current required-claim plan. An attacker
could delete a non-passed runtime claim, rewrite the remaining aggregate to passed, and keep or
delete the runtime gate without violating any self-declared closure. Current product claim and
gate identities were also duplicated across three producers, so adding another table to the
artifact parser would preserve the same drift class. The plan, writer, blocked writer, gate
producers, and validator must instead share one compiled product claim-plan owner.

The next pre-freeze review found two remaining forms of the same authority error. The shared
leaf owned the six raw strings but producers still independently paired each gate and claim, so
imported constants merely hid a second semantic table. The public `unknown` assertions also used
enumerable-key checks plus `JSON.stringify` equality; a programmatic value with accessors,
custom prototypes, sparse or overridden arrays, or a hidden/inherited `toJSON` could therefore
pass a comparison that did not describe its actual fields. One product binding registry and one
strict data-only snapshot/equality boundary must close these seams before the artifact assertion
can narrow an unknown value authoritatively.

The next exact-head Review then found that a trusted claim inventory and internally consistent
aggregate were still insufficient: a report could keep `policyReport.status: skipped` while
replacing the canonical policy gate with an executed passed gate, recompute the aggregate, and
obtain legacy PASS. The serialized lanes and gates are two projections of one writer input, not
independent authorities. The product plan therefore also owns one byte-equivalent normal/blocked
report-to-gate projection. The writer and artifact validator share it; the artifact envelope only
compares the canonical gate subset and continues to allow unrelated observational gates.

The final affected closure also exposed a baseline fixture violation: `copyWorkspaceFixture`
created hard-link aliases for a mutable authoring source while claiming all writers would pass
through `writeText`. Direct host writes are legitimate in fault and recovery tests, so writer
discipline cannot make a shared inode safe. A mutable workspace clone must own independent
physical files before any product authority reads them.

After the fixture repair, the first final affected run exposed a second trust-root defect rather
than a product assertion failure. The outer fast runner and each Bun child independently derived
concurrency from `availableParallelism()`, so the actual default allocation multiplied two
uncoordinated budgets. The runner then collapsed distinct physical resource classes into one
queue and reduced each child to `code ?? 1`; when one child ended non-zero, exact invocation,
signal, spawn error, duration, and failure tail were permanently lost. A verification runner must
bound the complete process graph and preserve a deterministic failure receipt before its result
can be trusted.

The first contract proof reset removed regex and raw-count checks but still built several
competing semantic tables from bare identifier text. Its export fixed point could propagate only
the edges already extracted by those tables, so lexical shadowing, import-equals, namespace and
wrapper flows could either hide a second dispatcher or accuse an unrelated value with the same
name. It also read an entire untrusted source before applying the advertised per-file limit. The
failed analyzer is therefore replaced, not extended: one TypeScript Program supplies lexical
symbols and canonical module identities, one capability/call graph supplies reachability, and
opened-handle bounded reads establish source bytes before the Program accepts them.

The first Program-based implementation then exposed a different proof-architecture defect: every
adversarial scenario rebuilt the complete live inventory, Program, binder/checker, capability graph,
and fixed point. The only authorized three-file sentinel produced no Bun result while the process
grew to approximately 5.3 GiB working set and hundreds of CPU seconds. That exact input is invalid
and is not retried or granted a larger timeout. The lifecycle is instead refrozen around one
suite-wide Program and one graph solve whose already-solved facts are consumed by isolated,
explicitly bound scenario closures. Structural construction counters make recurrence mechanically
visible before scenario growth can multiply the trust-root proof cost again.

That one-Program implementation completed once with one real shorthand false negative. Binding a
shorthand property to `TypeChecker.getShorthandAssignmentValueSymbol` repaired the lexical identity,
but the corrected input then again produced no terminal test result while Bun grew monotonically to
approximately 3.74 GiB. The shorthand repair is retained: it exposed a pre-existing abstraction in
which each value carried a Set of every Program callable and namespace, field-insensitive objects
broadcast those identities through sibling properties, call sites formed callsite-by-callable pairs,
and the value worklist retransmitted complete accumulated sets. One Program and one solve invocation
therefore did not establish a bounded fact domain. This second architecture invalidation enters
`STOP_PROOF_RESET`; the exact failed bytes are never rerun.

The proof is now refrozen around one immutable identity index, exact scenario ownership, sparse
callable and export-slot graphs, a fixed-width sensitive-handle/protected-role lattice, property-
sensitive typed constraints, frozen topology, and one delta-only fact solve with an input-derived
upper bound. Ordinary callable and namespace identities never become value facts, unknown executable
flow produces one fail-closed frontier, and validators only consume a compact frozen projection. The
same review also found that `runBoundedFastTestInvocations` was named "private" while production
exported it. The authority-binding wrapper becomes file-local; only an authority-free pure scheduling
seam may remain exported for unit testing, so module scope rather than an inventory census owns
privacy.

`verification-result-contract.ts` is the only runtime authority for result status, reason codes,
gate invariants, aggregate invariants, and the current aggregate projection. The artifact
contract owns only the report envelope, cross-artifact binding, and legacy projection.

## Ordered ownership

1. A0 freezes this manifest and atomically reconciles the pointer, rolling plan, and prior
   manifest archive.
2. The single code Worker retains the already-staged claim-plan, Result/artifact, fixture, resource,
   receipt, and strict-data results. After the first proof reset, that Worker replaced the test-only
   name analyzer with Program identities, changed host reads to opened-handle limit+1 reads, and added
   canonical prototype `toJSON` zero-execution regressions. After the per-scenario Program lifecycle
   and then the Program-sized callable/namespace lattice were invalidated, A0 refreezes this same
   original package again and narrows the new implementation delta to
   `tests/helpers/dev-runner-authority-proof.ts`,
   `tests/unit/dev-runner-authority-proof.test.ts`,
   `tests/contract/dev-runner-contract.test.ts`,
   `platform/dev-runner/test-runner.ts`, and `tests/unit/test-runner.test.ts`.
   The same Worker, sequentially and as the only semantic writer, makes the authority-binding bounded
   executor file-local, creates the single fixed-bit/property-sensitive/frozen-topology proof kernel,
   integrates the complete live-plus-adversarial catalog, and deletes the old solver without a shadow
   fallback. It preserves the correct shorthand identity and opened-handle reader. Other production
   runner and Result/artifact implementation blobs remain unchanged unless an exact owned regression
   proves otherwise; the Worker never writes control-plane, dependency, toolchain, workflow, PR, or
   hosted-Gate state.
3. A0 alone freezes the single-parent candidate, owns final Gate/Review/bootstrap custody,
   integrates with expected-head protection, performs new-main readback, and cleans up.

## Migration boundary

- `VerificationReport.summary.claimSummary` remains optional for ordinary historical/UI reads.
- The current canonical artifact type requires `claimSummary`; omission is diagnostic-only and
  cannot authorize staged proof, pipeline completion, Semantic Mutation PASS, or merge Evidence.
- No serialized field is added or removed. Full versioned legacy retirement remains Issue #176.
- This package validates the parsed data model and does not claim preservation of raw lexical
  duplicate JSON keys after `JSON.parse`; a versioned raw-reader/duplicate-key policy remains part
  of Issue #176 rather than introducing an unversioned parser change here.
- Issue #215 exclusively owns environment matching, deterministic status lattice, policy
  applicability, runtime empty-selection truth, and coverage-consumer corrections.
- Test fixture isolation changes no product source-path policy: authoring source with hard-link
  aliases remains rejected before Semantic Mutation planning.
- Runner correction keeps the V19 Gate plan, workflows, artifact namespace, Evidence schema,
  package/lock, Test Impact algorithm, and timeout unchanged. `runDevCommand` remains the sole
  reviewed child-process dispatcher; the new observation contract is consumed by the fast runner
  without creating a second process pipeline.
- `verify-project.ts`, `run-runtime-verification.ts`, and `run-policy-gate.ts` change only to consume
  the shared current product claim plan and identity constants. Environment matching, status
  precedence, policy applicability, runtime no-test truth, and serialized report keys remain
  unchanged and continue to belong to Issue #215.

## Verification budget

The fixture delta first ran only the exact failing SM-3 name-pattern, then the five original manifest
tests as one focused batch. The runner and claim-plan implementation evidence is retained only where
its source blobs remain unchanged. The rejected name-based analyzer, its green result, the resource-
invalidated per-scenario Program sentinel, and the repaired but Program-sized callable/namespace
lattice are not architecture evidence and are never rerun. Only after the finite proof-kernel source
and manifest bytes materially change does development run the new authority-proof unit and
dev-runner contract files once as the minimal proof-reset sentinel. It then freezes imports and
receives independent Product and Runner exact-tree Review with P0/P1/P2 all zero. A recurrence of the
same fact-domain/resource-amplification class after this formal proof reset returns
`BLOCKED_REDESIGN_REQUIRED`, not another local optimization, retry, cache, timeout, scenario removal,
or assertion change. Only after those Reviews pass does development run all twelve manifest tests
once as the final focused batch.
After one new single-parent head is frozen, A0 runs one new affected plan/run, the selector's
exact Risk suites, and repository audit. This package does not run Full and does not repeat
unchanged hosted failures.
