# Gift author compiler

This is a Rust implementation of a bounded author-to-TypeScript capability, consumed by the repository's `author` CLI. It reads the existing `gift.author-module/2` encoding. The original source bytes remain authoritative; the model, typed lowering plan, bindings, dependency graph, project members and source map are rebuildable outputs.

The semantic owner is the [finite ordered record profile](../../docs/领域/状态关系与流/关系查询与维护.md#有限有序记录的独立方法画像), with the existing [scalar and expression rules](../../docs/领域/计算基础/文法类型与求值.md). The method is `gift:finite-ordered-records/2`; it does not reuse the earlier I64 experiment's qualification.

## Build and use

Run from the repository root with its pinned Bun dependencies, Cargo and Rust installed:

```powershell
cargo build --locked --manifest-path crates/gift-author-kernel/Cargo.toml --target-dir .tmp/gift-author-kernel-target
bun run sec -- author --input crates/gift-author-kernel/fixtures/shared-views.module.json --kernel .tmp/gift-author-kernel-target/debug/gift-author-kernel.exe --json
```

On Unix the executable has no `.exe` suffix. `--kernel` is an explicitly selected local compiler executable, not an automatic installer or an untrusted-plugin sandbox. The host captures one workspace-relative source file, passes its exact bytes through bounded stdin, and checks the returned source revision. The Rust library itself does not read files, environment, Git, clocks or the network. The standalone executable has only stdin/stdout transport.

The JSON result contains `src/index.ts`, `src/main.ts`, `package.json` and `tsconfig.json`. It does not write these members into the workspace or execute the target. Materialize the members into a new destination through an authorized caller. The emitted package builds with TypeScript 6.0.3 and runs its `dist/main.js` with Node. Its public library uses `bigint`; the demonstration JSON observer renders integers as decimal strings, keeping negative and greater-than-I64 values exact.

## Supported semantics and failures

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
bun crates/gift-author-kernel/tests/target-check.ts .tmp/gift-author-kernel-target/debug/gift-author-kernel.exe
```

The Rust cases cover accepted structure, exact values, role/occurrence binding, dependency changes, rejected interpretations and source preservation. `target-check.ts` uses the repository-pinned TypeScript Compiler API to typecheck and emit each generated project, executes the emitted JavaScript under Node against independently written expected values, and invokes the actual repository CLI. It exercises the baseline, shared threshold change, shared `≥` to `>` change, empty input, large negative boundaries, equivalent declaration reordering and Unicode line separators. Source-map lines are checked against the target compiler's own parsed line positions. Each run prints the retained artifact/evidence directory under `.tmp`; it never overwrites an existing destination.

`serde_json` owns JSON syntax and lossless numeric transport, `num-bigint` checks exact integer values, and `sha2` supplies content digests. The small Rust emitter operates only on checked typed nodes; JSON escaping and compiler-generated identifiers prevent author names/text from becoming target syntax. TypeScript's actual compiler remains the independent target syntax/type authority. No new general parser, integer arithmetic library or target-language checker is implemented here. The Cargo lock records exact dependency revisions; the licenses are inherited from their upstream packages (serde/serde_json, num-bigint and sha2 use MIT/Apache-2.0 alternatives).

The earlier research experiment described by PR #895 has not been recovered as source here. Its reported TS experiment and I64 bound are not counted as tests of this implementation. The 1,786 U / 568 D originals, general abstraction generation, full author editing, imported modules, component runtime and additional targets remain separate obligations with their original owners.
