# Gift author compiler

This Rust kernel implements the complete selected `design-converged` structural Reader and a separate bounded `/2` author-to-TypeScript method. Both are consumed by the repository's `author` CLI. The original source bytes remain authoritative; expanded structures, typed lowering plans, bindings, dependency graphs, project members and source maps are rebuildable outputs.

The `/2` method's semantic owner is the [finite ordered record profile](../../docs/领域/状态关系与流/关系查询与维护.md#有限有序记录的独立方法画像), with the existing [scalar and expression rules](../../docs/领域/计算基础/文法类型与求值.md). The method is `gift:finite-ordered-records/2`; it does not reuse the earlier I64 experiment's qualification.

## Build and use

Run from the repository root with its pinned Bun dependencies, Cargo and Rust installed:

```powershell
cargo build --locked --manifest-path crates/gift-author-kernel/Cargo.toml --target-dir .tmp/gift-author-kernel-target
bun run sec -- author --input crates/gift-author-kernel/fixtures/shared-views.module.json --kernel .tmp/gift-author-kernel-target/debug/gift-author-kernel.exe --json
```

On Unix the executable has no `.exe` suffix. `--kernel` is an explicitly selected local compiler executable, not an automatic installer or an untrusted-plugin sandbox. The host captures one workspace-relative source file, passes its exact bytes through bounded stdin, and checks the returned source revision. The Rust library itself does not read files, environment, Git, clocks or the network. The standalone executable has only stdin/stdout transport.

The JSON result contains `src/index.ts`, `src/main.ts`, `package.json` and `tsconfig.json`. It does not write these members into the workspace or execute the target. Materialize the members into a new destination through an authorized caller. The emitted package builds with TypeScript 6.0.3 and runs its `dist/main.js` with Node. Its public library uses `bigint`; the demonstration JSON observer renders integers as decimal strings, keeping negative and greater-than-I64 values exact.

## Supported semantics and failures

Use `author --read --input <file> --kernel <executable> --json` to read a complete `gift.author-module/design-converged` module or `gift.project/design-converged` project. The exact marker selects its Reader; a failure never retries another format. All complete Definition branches come from the existing [parameterized grammar](../../schema/author/first-layer/codec-parameters.json). Short forms consume the original [expansion equations](../../tools/documentation/author_codec_spec.py); complete `kind`, `tag`, `op` and control bodies keep their stopping boundaries. Project input uses its complete shape. A sequence comprehension needing an ordinary Collect binding returns `NeedsSurfaceBinding` until that binding is supplied by its qualified semantic context.

The result is `gift.author-read/1`, explicitly at the `structural` stage. It contains exact source and grammar revisions and a finite node graph with separate source/expanded roots. Children precede parents. Original values retain source JSON Pointers and half-open UTF-8 byte ranges; synthesized nodes retain their source occurrence. Numeric wire values are strings containing original number lexemes, so a JSON transport cannot round them. `iff` expansion shares each original operand without merging distinct same-valued occurrences. The Rust library retains the original bytes. This stage does not establish lexical binding, type/effect correctness, professional interpretation, Method availability, target generation or execution.

Cargo embeds only the manifest's exact resource closure. The runtime reconstructs and verifies its bounded graph and uses `jsonschema 0.60.2` with default HTTP/file resolution disabled and an explicit rejecting retriever. `serde_json` owns syntax and the shared source capture rejects duplicate decoded keys and non-scalar Unicode before map construction. The old `/2` method uses that same capture and retains its own semantic decoder.

The pinned Schema engine has a known upstream numeric-bound defect: a bound such as `9007199254740993` can miscompare an equal decimal token. Its use is qualified for the actual fixed Gift grammar, whose numeric bounds are safe integers. Before provider construction, every Schema node's bounds must be integer literals within `[-(2^53-1), 2^53-1]`; `multipleOf` is not qualified. New grammar outside this capability returns `GrammarCapabilityUnsupported`, without rounding or changing author values. The independent defect reproducer remains in the tests. Exact large-number const/enum/uniqueItems use the library's separate precise comparison path and have their own tests. Upgrading the engine requires requalifying these boundaries; the runtime does not accept arbitrary external Schemas.

Input is bounded to 4 MiB, 200,000 JSON nodes, 128 levels, 16 MiB of retained source-pointer bytes and 65,536 aggregate numeric lexical/exponent work units. Pointer bytes are charged before allocation; derived nodes share immutable origins. Expansion has its own depth, visit and derived-node budgets. Exceeding those budgets returns `ResourceLimit`, retaining the source; it does not declare the language construct invalid. Reader output allocation is charged before copying each unique node, conservatively allowing worst-case JSON escaping and container overhead within the 64 MiB transport limit. No performance or unbounded resource guarantee is claimed.

Use `author --names --input <file> --kernel <executable> --json` for the next, independent name-analysis stage. It registers every Definition in the captured design-converged module and locates references through their actual Schema-owned slots. It resolves local declarations and public export routes, preserving original locations and each expanded occurrence. SourceRef, historical DefinitionRef, original professional selectors and dialect consumer slots retain their distinct interpretation boundaries. JSON data, annotations, lexical variables and professional payload terms are not guessed into module references. `--read` and `--names` are mutually exclusive.

The result is `gift.author-names/1`, with `stage: names` and `identity_scope: capture-local`. Its `input_revision` binds ordered source/grammar revisions and the explicit in-memory import graph. The Rust `binding::analyze_sources` API accepts Reader-validated captures and import requests selecting existing source aliases and target capture slots; it validates the target's real moduleId. Captures with identical bytes remain distinct slots, while multiple aliases explicitly targeting one slot share the terminal declaration. Public alias cycles, missing local names, missing public exports, invalid namespaces and missing captures have separate results and read dependencies. The single-file CLI reports uncaptured imports as specific needs, without searching the filesystem.

These are name-location conclusions in that exact capture. Declaration IDs do not claim stable editing lineage, nominal identity or a formal ModuleUse; a locked import retains its pending lock qualification. The result explicitly lists unchecked lexical binders, declaration roles, types, effects, professional interpretation, callable qualification and target behavior. A found name is not a successfully typed program. Professional old strings retain their Profile resolution needs; extension payloads retain their exact interpretation boundary. No target artifacts are generated. Analysis is bounded to 128 captures and 32 MiB of captured bytes, with an 8-million-unit navigation/validation work budget and conservative 48 MiB allocation/output accounting; exhaustion is `ResourceLimit`, not invalid author syntax.

With neither flag, the existing `/2` compilation method supports:

- One closed `/2` module, explicit local exports, mathematical Int, Bool, Text, immutable closed records and ordered sequences. Int literals use the existing canonical decimal-string encoding.
- Pure, finite, acyclic internal first-order functions: literals, lexical variables, constant references, records, sequences, fields, calls, `if`, and exhaustive `Ordering` matches. The primitive binding supports mathematical `IntCompare`, `IntEq`, `IntAdd`, `IntSub`, `IntMul` and `BoolNot`.
- Predicate Meanings resolve to actual functions with matching named roles and result types. Names alone never supply an interpretation.
- `data:query` scan/filter consumes complete static record sequences and pure total unary predicates. It preserves order and duplicate occurrences; nested filters complete their source before evaluating the next predicate.
- Source revisions hash exact bytes. Semantic revisions hash the checked author structure. Definition dependencies and call occurrences retain source pointers; `affected_exports` computes the union of old/new dependency closures after edits. Compilation currently recomputes cleanly: there is no incremental-cache performance claim.
- The reader rejects duplicate JSON keys before maps can erase them. Source size and dependency depth have explicit implementation budgets. Resource refusal is separate from mathematical integer validity.

Imports, nominal types, finite-width numbers, mutable/optional/open records, arbitrary effects, recursion, contracts, Goal/Requirement, components, external data, Bag/Set and other queries return specific diagnostic codes. Callable exports return `NeedsTargetBridge` until a native input codec can establish immutable data and Unicode scalar Text; TypeScript's structural types alone admit accessors and lone surrogate code units. Internal functions and Meanings remain available to the static project. Unknown or unsupported obligations anywhere in the submitted module are not silently treated as dead code. The caller retains the unchanged input on failure.

The fixture's inherited view explicitly references `DefaultThreshold`; its fixed view contains the same integer literal. This demonstrates distinct evolution of a shared source and a fixed value. It does **not** implement absent-parameter default elaboration, component Use identity, arbitrary projection editing, general Method search, Rust target emission or the complete shared Workspace/state/resource example.

## Verification

```powershell
cargo test --locked --manifest-path crates/gift-author-kernel/Cargo.toml --target-dir .tmp/gift-author-kernel-target
bun crates/gift-author-kernel/tests/reader-check.ts .tmp/gift-author-kernel-target/debug/gift-author-kernel.exe
bun crates/gift-author-kernel/tests/target-check.ts .tmp/gift-author-kernel-target/debug/gift-author-kernel.exe
```

The Rust cases cover accepted structure, exact values, role/occurrence binding, dependency changes, rejected interpretations and source preservation. `target-check.ts` uses the repository-pinned TypeScript Compiler API to typecheck and emit each generated project, executes the emitted JavaScript under Node against independently written expected values, and invokes the actual repository CLI. It exercises the baseline, shared threshold change, shared `≥` to `>` change, empty input, large negative boundaries, equivalent declaration reordering and Unicode line separators. Source-map lines are checked against the target compiler's own parsed line positions. Each run prints the retained artifact/evidence directory under `.tmp`; it never overwrites an existing destination.

`serde_json` owns JSON syntax and lossless numeric transport, `num-bigint` checks exact integer values, and `sha2` supplies content digests. The small Rust emitter operates only on checked typed nodes; JSON escaping and compiler-generated identifiers prevent author names/text from becoming target syntax. TypeScript's actual compiler remains the independent target syntax/type authority. No new general parser, integer arithmetic library or target-language checker is implemented here. The Cargo lock records exact dependency revisions; the licenses are inherited from their upstream packages (serde/serde_json, num-bigint and sha2 use MIT/Apache-2.0 alternatives).

The earlier research experiment described by PR #895 has not been recovered as source here. Its reported TS experiment and I64 bound are not counted as tests of this implementation. The 1,786 U / 568 D originals, general abstraction generation, full author editing, imported modules, component runtime and additional targets remain separate obligations with their original owners.
