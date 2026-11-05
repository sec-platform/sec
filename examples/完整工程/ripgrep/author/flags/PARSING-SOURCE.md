# Flags parsing source checkpoint

This is a bounded source checkpoint for `parse.module.json` and
`config.module.json`, not a claim that the complete ripgrep flags subsystem is
implemented or that Gift can compile or run these modules. The reference is
ripgrep commit `4c2362d359d9913c7a5e391ccd79cb4da22bc89b`,
`crates/core/flags/parse.rs` (SHA-256
`23d6531dfa42842e435b0e3972ebcc7e39b7e846cc14dee188b8467ab16018ee`)
and `crates/core/flags/config.rs` (SHA-256
`8b301da48a3043f30a149324c3baa67bd8cf3d69e6bc63d251277853b9f0c2ca`).
The existing `lowargs` source has a separate owner. `FlagValue` is defined in
the parse module; `defs` metadata and update implementations are separate work.

## Source correspondence

- `ParserBuild`, `BuildInfos` and `BuildAliases` construct an owned
  `Vector<FlagInfo>` in source order: long, aliases, short, negated. The
  map is built by borrowed indexed traversal, passes name bytes and the vector
  index to insertion, and asserts that insertion found no previous entry. The
  source requires an owned byte-vector key; the actual collection binding is
  still open. `FindShort` and `FindLong` borrow the parser's vector and return
  `FlagLookup<r>` with `Borrow<FlagInfo,r>`; `ArgAction<r>` carries that same
  loan. Non-ASCII short flags remain unrecognized. `ParserNew<r>` declares a
  borrow produced by `sync:OnceGetOrInit`; the actual static storage and
  its lifetime are an open shared interface below.
- `FlagInfoDisplayText` and `ParseFlag` inspect borrowed metadata fields.
  Negated entries produce `Switch(false)`, ordinary switches produce
  `Switch(true)`, and value flags ask lexopt for their value. Flag update and
  missing-value errors retain their distinct contextual messages. The flag
  object's real static trait-object representation is still an interface
  obligation, not proven by the current nominal type.
- Suggestions use the source's byte trigrams, union-before-intersection
  `u32` conversions, and the binary64 `0.4` threshold. Candidate order is
  long, negated, aliases. CLI parsing processes every argument before
  interpreting an early special result; a config reparse does not take that
  special a second time.
- `ParseReader` retains two owned vectors outside the exclusive line callback.
  Each accepted line mutably borrows one vector briefly and appends an owned
  argument or error. Trimmed empty and comment lines are skipped. An IO error
  aborts the result, while invalid UTF-8 follows the platform-specific
  `bstr`/OS-string behavior. No vector is moved out of the `FnMut` capture.
- `LoadAtPath` retains the owned `Parsed` value, temporarily borrows its
  `errors` field exclusively and takes that vector, leaving the default empty
  vector in place. `EmitErrors` moves the extracted vector into its owned
  iterator and processes each error in its own loop iteration. Debug output
  borrows the remaining `args` field; only after that borrow ends does a single
  `ConsumeField<Parsed,"args">` extract args and clean the empty errors field.
  This avoids two consuming projections from the same owner. Correct lowering,
  the standard `Vec` default/`mem::take` behavior, actual error Drop timing and
  unwind cleanup still require the integrated target evidence listed below.

## Focused evidence and limits

On this checkpoint, `.tmp/whole-engineering-20261025/flags-parsed-review.py`
reported **2,487 assertions including interpreter call-arity checks**. Its
strict JSON, lexical binding and local-reference checks plus bounded expression
evaluation use fixed Python native stubs and a finite selection of inputs. The
report binds the exact two module hashes and records the external references.
Scenarios include duplicate names and lookup order, small-byte ngrams, the
Jaccard conversion order and overflow, special flags and config reparse,
platform-specific invalid bytes, multiple error messages in order and an
injected read error. The stub also observes take, debug borrow and final
consume order for a representative parsed value.
The structural checks verify the explicit vector/borrow shapes and the absence
of captured-vector moves in the callback. This is not a Gift Reader, type,
effect, borrow, native-link, Rust lowering, real IO, allocation or complete
equivalence proof. The test's Python identity check is only its stub model's
identity, not proof of Rust borrow qualification.

## Open interfaces and remaining work

1. The shared owner must supply an actual `OnceLock<Parser>` and the
   `state:ParserOnce` / `sync:OnceGetOrInit` contract: storage identity,
   one-time initialization, thread safety and a genuine `'static` borrow
   capable of shortening to `r`. A nominal return declaration or the Python
   once stub cannot establish these facts.
2. The canonical representation owner must resolve the actual relationship
   between native `Vector<T>` and the public abstract `Sequence<T>` used by
   `config:Args`, `LoadAtPath`, `ParseConfigured`, `LowArgs`, debug formatting
   and their consumers. `Parsed.args` and `Parsed.errors` now state their
   native vector types and `EmitErrors` accepts the real error vector, while
   current sequence consumers retain an explicit unresolved type boundary.
   There is no implicit representation conversion proven here, and no new
   conversion wrapper is introduced.
3. The `defs` owner must establish `FLAGS` and `FlagInfo.flag` as the actual
   reusable `&'static dyn Flag` representation, and long/alias/negated names as
   the corresponding static string references. The present `defs:Flag` and
   `text` types do not independently prove Copy, lifetime or native dispatch;
   borrowed field projections, field movement and the metadata/update consumers
   require checking against that representation.
4. The actual collection, lexopt, bstr, IO, OS-string, logging and other
   external interfaces and profiles need source binding, exact signatures,
   effects, ownership, error and target behavior. In particular,
   `collections:ByteMap` must represent the source `HashMap<Vec<u8>, usize>`
   and `bstr:ForByteLineWithTerminator` must provide its real synchronous
   exclusive callback and error propagation. The native machine owner must
   bind `Vector`, `VectorNew`, `VectorPush`, `VectorLen`, `VectorGet`,
   `VectorIndex`, `VectorIntoIter`, `VectorIntoIterStart`, `IteratorNext`,
   `TakeValue`, `ReadCopy`, and their actual generic/lifetime signatures;
   the shared place owner supplies field, consumption and scoped-borrow
   operations. `VectorIntoIter` names the actual `std::vec::IntoIter<T>`,
   `VectorIntoIterStart` consumes the vector, and `IteratorNext` returns the
   iterator's associated Item; they do not wrap ripgrep business behavior.
5. Run the real Reader/TypeChecker/Method/Target closure on the integrated
   exact tree, followed by native and platform execution as applicable. Review
   inferred callback capture modes and drop points, including the remaining
   sequence consumers, against the source. Until then the checkpoint remains a
   partial design candidate, and the full flags definitions and updates remain
  未完成.
