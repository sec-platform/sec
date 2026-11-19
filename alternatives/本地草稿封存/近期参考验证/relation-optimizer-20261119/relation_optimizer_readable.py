"""Bounded, typed finite-relation optimizer reference for Gift.

Independently readable companion to the archived 2026-11-19 bundle.
This file is not the recovered 2026-11-08 source or a production Gift
Method/Reader/Target implementation.
"""
from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass, field
from fractions import Fraction
from math import inf
from typing import Any, Callable, Iterable, Mapping


@dataclass(frozen=True, slots=True)
class Scope:
    identity: str
    revision: str


@dataclass(frozen=True, slots=True)
class Sort:
    identity: str
    revision: str
    accepts: Callable[[Any], bool] = field(compare=False, hash=False, repr=False)
    equals: Callable[[Any, Any], bool] = field(default=lambda left, right: left == right,
                                                   compare=False, hash=False, repr=False)


@dataclass(frozen=True, slots=True)
class Role:
    owner: str
    occurrence: str
    name: str
    scope: Scope
    sort: Sort

    @property
    def key(self) -> tuple[str, str]:
        return self.owner, self.occurrence


@dataclass(frozen=True, slots=True)
class Binding:
    left: Role
    right: Role

    def __post_init__(self) -> None:
        if self.left.scope != self.right.scope:
            raise ValueError("binding crosses incompatible Scope revisions")
        if (self.left.sort.identity, self.left.sort.revision) != (self.right.sort.identity, self.right.sort.revision):
            raise ValueError("binding crosses incompatible Sort revisions")


@dataclass(frozen=True, slots=True)
class ClosedDomain:
    domain_id: str
    snapshot_id: str
    authority: str

    def __post_init__(self) -> None:
        if not self.domain_id or not self.snapshot_id or not self.authority:
            raise ValueError("closed-domain witness must be fully identified")


@dataclass(frozen=True, slots=True)
class Algebra:
    kind: str
    worlds: frozenset[str] = frozenset()

    def zero(self) -> Any:
        return {
            "bool": False, "count": 0, "tropical": inf,
            "rational": Fraction(0), "provenance": (), "events": frozenset(),
        }[self.kind]

    def one(self) -> Any:
        return {
            "bool": True, "count": 1, "tropical": 0,
            "rational": Fraction(1), "provenance": (((), Fraction(1)),), "events": self.worlds,
        }[self.kind]

    def add(self, a: Any, b: Any) -> Any:
        if self.kind == "bool": return bool(a or b)
        if self.kind == "count": return a + b
        if self.kind == "tropical": return min(a, b)
        if self.kind == "rational": return a + b
        if self.kind == "events": return frozenset(a | b)
        if self.kind == "provenance": return _poly_add(a, b)
        raise ValueError(self.kind)

    def multiply(self, a: Any, b: Any) -> Any:
        if self.kind == "bool": return bool(a and b)
        if self.kind == "count": return a * b
        if self.kind == "tropical": return a + b
        if self.kind == "rational": return a * b
        if self.kind == "events": return frozenset(a & b)
        if self.kind == "provenance": return _poly_mul(a, b)
        raise ValueError(self.kind)

    def supported(self, a: Any) -> bool:
        return a != self.zero()

    def semijoin_left(self, left: Any, rights: Iterable[Any]) -> Any:
        rights = tuple(r for r in rights if self.supported(r))
        if not rights or not self.supported(left): return self.zero()
        if self.kind == "events":
            witness_worlds = frozenset().union(*rights)
            return frozenset(left & witness_worlds)
        # Explicit existence-only profile: right multiplicity, provenance,
        # or cost does not multiply the left annotation.
        return left

    def exclude_left(self, left: Any, rights: Iterable[Any]) -> Any:
        rights = tuple(r for r in rights if self.supported(r))
        if not self.supported(left): return self.zero()
        if self.kind == "events":
            witness_worlds = frozenset().union(*rights) if rights else frozenset()
            return frozenset(left - witness_worlds)
        return self.zero() if rights else left


def _poly_add(a: tuple, b: tuple) -> tuple:
    out: dict[tuple[str, ...], Fraction] = defaultdict(Fraction)
    for monomial, coefficient in (*a, *b): out[monomial] += coefficient
    return tuple(sorted((m, c) for m, c in out.items() if c))


def _poly_mul(a: tuple, b: tuple) -> tuple:
    out: dict[tuple[str, ...], Fraction] = defaultdict(Fraction)
    for ma, ca in a:
        for mb, cb in b:
            out[tuple(sorted((*ma, *mb)))] += ca * cb
    return tuple(sorted((m, c) for m, c in out.items() if c))


def atom(name: str) -> tuple:
    return (((name,), Fraction(1)),)


@dataclass(frozen=True, slots=True)
class Row:
    values: tuple[Any, ...]
    annotation: Any


@dataclass(frozen=True, slots=True)
class Relation:
    scope: Scope
    roles: tuple[Role, ...]
    algebra: Algebra
    rows: tuple[Row, ...]

    @classmethod
    def form(cls, scope: Scope, roles: Iterable[Role], algebra: Algebra,
             rows: Iterable[tuple[Mapping[Role, Any], Any]]) -> "Relation":
        roles = tuple(roles)
        if any(r.scope != scope for r in roles): raise ValueError("role Scope mismatch")
        if len({r.key for r in roles}) != len(roles): raise ValueError("duplicate role occurrence")
        formed: list[tuple[tuple[Any, ...], Any]] = []
        for mapping, annotation in rows:
            if set(mapping) != set(roles): raise ValueError("row role set mismatch")
            values = tuple(mapping[r] for r in roles)
            # Validate all supplied values before zero-weight elimination.
            for role, value in zip(roles, values):
                if not role.sort.accepts(value): raise ValueError(f"invalid value for role {role.name}")
            _validate_annotation(algebra, annotation)
            if not algebra.supported(annotation): continue
            # An annotated relation maps each tuple to one annotation.
            # Coalesce equal tuples with algebra addition, never set semantics.
            for index, (existing, weight) in enumerate(formed):
                if _tuple_equal(roles, existing, values):
                    formed[index] = (existing, algebra.add(weight, annotation))
                    break
            else:
                formed.append((values, annotation))
        return cls(scope, roles, algebra, tuple(Row(values, weight) for values, weight in formed
                                                if algebra.supported(weight)))

    def mapping(self, row: Row) -> dict[Role, Any]:
        return dict(zip(self.roles, row.values))


def _tuple_equal(roles: tuple[Role, ...], left: tuple[Any, ...], right: tuple[Any, ...]) -> bool:
    return len(left) == len(right) and all(role.sort.equals(a, b) for role, a, b in zip(roles, left, right))


def _validate_annotation(a: Algebra, value: Any) -> None:
    ok = {
        "bool": lambda: type(value) is bool,
        "count": lambda: type(value) is int and value >= 0,
        "tropical": lambda: (type(value) in (int, float) and value >= 0) or value == inf,
        "rational": lambda: isinstance(value, Fraction) and value >= 0,
        "events": lambda: isinstance(value, frozenset) and value <= a.worlds,
        "provenance": lambda: isinstance(value, tuple) and all(isinstance(m, tuple) and isinstance(c, Fraction) and c >= 0 for m, c in value),
    }[a.kind]()
    if not ok: raise ValueError(f"invalid {a.kind} annotation")


def _compatible(left: Relation, right: Relation) -> None:
    if left.scope != right.scope: raise ValueError("relations have different Scope revisions")
    if left.algebra != right.algebra: raise ValueError("relations use different annotation algebras")


def _match(lm: Mapping[Role, Any], rm: Mapping[Role, Any], bindings: tuple[Binding, ...]) -> bool:
    return all(b.left.sort.equals(lm[b.left], rm[b.right]) for b in bindings)


def join(left: Relation, right: Relation, bindings: Iterable[Binding] = ()) -> Relation:
    _compatible(left, right)
    bindings = tuple(bindings)
    if any(b.left not in left.roles or b.right not in right.roles for b in bindings):
        raise ValueError("binding endpoint is not owned by the corresponding input")
    if set(left.roles) & set(right.roles): raise ValueError("Join output role identity collision")
    roles = left.roles + right.roles
    rows = []
    for lr in left.rows:
        lm = left.mapping(lr)
        for rr in right.rows:
            rm = right.mapping(rr)
            if _match(lm, rm, bindings):
                rows.append(({**lm, **rm}, left.algebra.multiply(lr.annotation, rr.annotation)))
    return Relation.form(left.scope, roles, left.algebra, rows)


def project(source: Relation, keep: Iterable[Role]) -> Relation:
    keep = tuple(keep)
    if len(set(keep)) != len(keep) or any(r not in source.roles for r in keep):
        raise ValueError("projection roles must be unique members of the source")
    groups: list[tuple[tuple[Any, ...], Any]] = []
    for row in source.rows:
        values = source.mapping(row)
        key = tuple(values[r] for r in keep)
        for index, (existing, weight) in enumerate(groups):
            if _tuple_equal(keep, existing, key):
                groups[index] = (existing, source.algebra.add(weight, row.annotation))
                break
        else:
            groups.append((key, row.annotation))
    return Relation.form(source.scope, keep, source.algebra,
                         [({r: v for r, v in zip(keep, key)}, ann) for key, ann in groups])


def semijoin(left: Relation, right: Relation, bindings: Iterable[Binding]) -> Relation:
    _compatible(left, right)
    bindings = tuple(bindings)
    if any(b.left not in left.roles or b.right not in right.roles for b in bindings):
        raise ValueError("binding endpoint is not owned by the corresponding input")
    rows = []
    for lr in left.rows:
        lm = left.mapping(lr)
        witnesses = [rr.annotation for rr in right.rows if _match(lm, right.mapping(rr), bindings)]
        ann = left.algebra.semijoin_left(lr.annotation, witnesses)
        if left.algebra.supported(ann): rows.append((lm, ann))
    return Relation.form(left.scope, left.roles, left.algebra, rows)


def exclude(left: Relation, right: Relation, bindings: Iterable[Binding],
            closure: ClosedDomain, *, expected_domain: str, expected_snapshot: str) -> Relation:
    _compatible(left, right)
    if (closure.domain_id, closure.snapshot_id) != (expected_domain, expected_snapshot):
        raise ValueError("closed-domain witness does not cover this exact right input")
    bindings = tuple(bindings)
    if any(b.left not in left.roles or b.right not in right.roles for b in bindings):
        raise ValueError("binding endpoint is not owned by the corresponding input")
    rows = []
    for lr in left.rows:
        lm = left.mapping(lr)
        witnesses = [rr.annotation for rr in right.rows if _match(lm, right.mapping(rr), bindings)]
        ann = left.algebra.exclude_left(lr.annotation, witnesses)
        if left.algebra.supported(ann): rows.append((lm, ann))
    return Relation.form(left.scope, left.roles, left.algebra, rows)


@dataclass(frozen=True, slots=True)
class Scan:
    name: str
    available: frozenset[Role]


@dataclass(frozen=True, slots=True)
class Filter:
    source: Any
    predicate_roles: frozenset[Role]
    pure: bool
    total: bool


@dataclass(frozen=True, slots=True)
class JoinPlan:
    left: Any
    right: Any
    left_roles: frozenset[Role]
    right_roles: frozenset[Role]
    bindings: tuple[Binding, ...]


@dataclass(frozen=True, slots=True)
class SemiPlan:
    left: Any
    right: Any
    left_roles: frozenset[Role]
    right_roles: frozenset[Role]
    bindings: tuple[Binding, ...]


@dataclass(frozen=True, slots=True)
class Project:
    source: Any
    output_roles: frozenset[Role]


def demand_closure(root: Any, outputs: Iterable[Role]) -> dict[int, frozenset[Role]]:
    """Compute reverse liveness across a shared plan DAG; union consumer demands."""
    demands: dict[int, set[Role]] = defaultdict(set)
    queue = deque([(root, set(outputs))])
    while queue:
        node, demand = queue.popleft()
        ident = id(node)
        before = len(demands[ident])
        demands[ident].update(demand)
        if len(demands[ident]) == before: continue
        current = demands[ident]
        if isinstance(node, Scan):
            if not current <= node.available: raise ValueError("demanded role is unavailable at Scan")
        elif isinstance(node, Project):
            if not current <= node.output_roles: raise ValueError("consumer demands a role removed by Project")
            queue.append((node.source, set(current)))
        elif isinstance(node, Filter):
            queue.append((node.source, set(current) | set(node.predicate_roles)))
        elif isinstance(node, JoinPlan):
            if not current <= (node.left_roles | node.right_roles):
                raise ValueError("Join output demand is not owned by either input")
            if any(binding.left not in node.left_roles or binding.right not in node.right_roles for binding in node.bindings):
                raise ValueError("Join binding is outside its declared input roles")
            left_need = set(current & node.left_roles)
            right_need = set(current & node.right_roles)
            for binding in node.bindings:
                left_need.add(binding.left)
                right_need.add(binding.right)
            queue.append((node.left, left_need))
            queue.append((node.right, right_need))
        elif isinstance(node, SemiPlan):
            if not current <= node.left_roles:
                raise ValueError("Semijoin can only output left-side roles")
            if any(binding.left not in node.left_roles or binding.right not in node.right_roles for binding in node.bindings):
                raise ValueError("Semijoin binding is outside its declared input roles")
            left_need = set(current)
            right_need = {binding.right for binding in node.bindings}
            for binding in node.bindings:
                left_need.add(binding.left)
            queue.append((node.left, left_need))
            queue.append((node.right, right_need))
        else:
            raise TypeError(f"unknown plan node: {type(node).__name__}")
    return {ident: frozenset(value) for ident, value in demands.items()}


def can_cross_filter(node: Filter) -> bool:
    """Only pure, total predicates are eligible for projection/reordering."""
    return node.pure and node.total
