# Typed finite-relation projection optimizer reference

**Recovery date:** 2026-11-19  
**Repository scope:** `sec-platform/sec`, current Gift candidate chain, under `alternatives/本地草稿封存/近期参考验证/`.  
**Status:** newly reconstructed, executable bounded reference. It is not the recovered 2026-11-08 source package and is not a production Gift Method/Reader/Target implementation.

## Why this exists

The 2026-11-08 run receipt reports that the missing local `plans.py` and `wire.py` implemented typed projection pushdown across explicit left/right bindings, Semijoin, finite Exclude, and role/value predicates. The exact 629-member archive and its 63 KB strict delta remain unavailable. Their reported hashes, tests, and original bytes have not been recreated here.

The current canonical relation and Method/Target owners already state the required rewrite contract. This reference makes a bounded part of that contract executable in the current repository, with independent test interpretation and explicit refusal boundaries. It preserves the useful algorithmic work without introducing a second production writer or pretending to restore the missing byte-for-byte artifact.

## What is implemented

`relation_optimizer.py` supplies:

- **Typed role identity.** A role occurrence includes owner and identity; display names do not create equality. An explicit `Binding` must match the exact `Scope` revision and `Sort` revision. Cross-scope combination is rejected because this reference does not implement semantic bridges.
- **Finite annotated relations.** Six small profiles are represented: Boolean, Count (arbitrary non-negative integers), Tropical min-plus, exact non-negative Rational, provenance polynomials, and finite-world Events.
- **Join and projection.** Join uses only declared bindings; no bindings means a Cartesian product within one exact scope. Projection groups colliding rows using the algebra's additive operation. Count multiplicity, provenance monomials, and event support are not replaced by set membership.
- **Support-only Semijoin.** The explicit existence-only profile retains a left annotation once when any matching right witness is supported; it does not multiply Count by the number or weights of right witnesses. Events is world-local: the result is the left event set intersected with the union of matching witness event sets. A support-only Provenance Semijoin deliberately keeps left provenance only; callers needing witness-source provenance must use Join followed by projection, or another separately qualified policy.
- **Finite Exclude.** A non-empty completeness reference is not enough on its own: the closure token must identify the exact right-side `domain_id` and `snapshot_id`. Events exclusion is world-local. The token is still a declared witness, not a cryptographic proof that an external provider told the truth.
- **Reverse role-demand closure.** The optimizer starts from output roles, propagates the demand backwards, retains all explicit binding keys and predicate roles until their last use, unions demands for shared plan objects, and inserts per-consumer projections. It normalizes nested/identity projections, preserves output role order, rejects cycles, and does not prune through predicates not declared pure and total.
- **Source validation before zero elimination.** All supplied row values are type-checked before a zero annotation can remove a row. A zero-weight invalid fact cannot disappear and make an invalid source look valid.

## Verification

The executable source and test modules are stored in `relation-optimizer-20261119-source-and-tests.zip` beside this README. Extract them into a clean directory, then run with Python 3.13 or a compatible modern Python 3 release:

```sh
python -m zipfile -e relation-optimizer-20261119-source-and-tests.zip .
python -m py_compile relation_optimizer.py test_relation_optimizer.py
python -m unittest -v
```

The recorded local run used Python 3.13.5. It passed **19 test methods**, including a deterministic exhaustive differential matrix of **6,561** two-by-two Count source-weight combinations. The optimized plan was compared with a separate test-only nested-loop interpreter, not just with another optimized plan. Targeted tests exercise all six annotation profiles, typed cross-binding and role filters, projection collisions, support-only Semijoin, per-world Events Semijoin/Exclude, incomplete and mismatched Exclude snapshots, impure/partial predicate barriers, shared-DAG demand union, optimizer idempotence, role-order preservation, and structural-width reduction.

A deliberately wide toy Join had 29 structural intermediate role slots before pruning and 7 after pruning (75.9% fewer slots). This is a model-level width proxy only. It is **not** a wall-clock, allocation, database-I/O, or production benchmark.

The new 6,561-case matrix is not the same test set as the 7,560 cases cited in the lost run receipt. The old 7,560 count, 38 targeted checks, and nine TypeScript executions remain historical claims, not independently reproduced results.

## Deliberate boundaries

This package does not implement the production relation Reader, `MethodSpec` selection, P0-P7 lowering, TypeScript/Rust emitter integration, SQL pushdown, database permissions or snapshot acquisition, real provider completeness, incremental maintenance, recursive fixed points, physical resource budgeting, or source maps. It supports finite in-memory relations only. The `ClosedDomain` token binds an explicit claim to an exact local domain/snapshot identity but cannot establish the truth of an external completeness claim. The Python model's callable sort validators and `pure`/`total` declarations are trusted reference-profile inputs, not proofs for arbitrary production callbacks. The readable companion also treats each versioned Sort equality callback as a trusted equivalence relation; it retains the first encountered representative and has no canonical value encoder, so it does not qualify deterministic target serialization.

The current `gift-author-kernel` method remains `gift:finite-ordered-records/2`; its ordered sequence semantics are not silently expanded to Bag relations by this work. Production adoption requires a separately reviewed relation Method/Target implementation under the existing canonical owners and consumers.

## Files

- `relation-optimizer-20261119-source-and-tests.zip` — `relation_optimizer.py`, `test_relation_optimizer.py`, the local test log, and source checksums.
- `README.md` — scope, verification, limitations, and provenance.

## Readable source companion (2026-11-19 follow-up)

The archive above remains the original 2026-11-19 bundle. Two separately committed, independently authored files now expose a smaller implementation in ordinary Git text form:

- [relation_optimizer_readable.py](./relation_optimizer_readable.py) — typed Scope/Sort/Role/Binding, six annotation algebras, finite relation formation, Join, projection, support-only Semijoin, snapshot-bound Exclude, and reverse role-demand closure over shared plan DAGs.
- [test_relation_optimizer_readable.py](./test_relation_optimizer_readable.py) — 18 test methods, including an independent nested-loop oracle over 6,561 Count source-weight combinations. The implementation coalesces duplicate tuples with algebra addition, uses versioned Sort equality for matching/grouping, rejects Semijoin output demand on right-side roles, and verifies the six selected semiring profiles on finite samples.

Run from this directory:

```sh
python -m py_compile relation_optimizer_readable.py test_relation_optimizer_readable.py
python -m unittest -v test_relation_optimizer_readable
```

The readable companion is **not extracted byte-for-byte from the ZIP**, does not claim the ZIP's source SHA values, and does not replace its 19-test report. Its independently executed result on 2026-11-19 was 21/21 test methods passing. SHA-256: source `b25a3016c9cccfbaecbc0c4ceb1c617433251a04352b0d4873eb111ee34d7ee0`; tests `04e85f9d34e78991b37c1c06bf8c68be193923b9bb9753bd2758bf6d3930da28`. Its role-demand analysis computes the liveness closure; it does **not** yet materialize per-consumer projection nodes, perform a complete Plan rewrite, or prove cycle handling. Those stronger optimizer features remain claims of the archived bundle until its exact source is independently inspected and executed.

The companion is intentionally a bounded reference. It does not integrate with the production Rust QueryKind, MethodSpec, Reader, P0–P7 lowering, TypeScript target or SQL adapters. Production integration remains a separate qualification task.

Production seam analysis: [Gift 关系投影优化生产接合缺口与实施边界](../records/2026-11-19/Gift_关系投影优化生产接合缺口与实施边界_20261119.md) maps the current Reader, QueryKind, Method and TypeScript Target boundaries and records why this work must enter through a separate relation Method rather than widening the existing ordered `/2` method.
