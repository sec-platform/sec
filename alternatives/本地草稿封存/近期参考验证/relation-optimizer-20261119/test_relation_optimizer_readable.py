from fractions import Fraction
import itertools
import unittest

from relation_optimizer_readable import (
    Algebra, Binding, ClosedDomain, Filter, JoinPlan, Project, Relation,
    Role, Scan, Scope, Sort, atom, demand_closure, exclude, join, project,
    semijoin, can_cross_filter,
)


class RelationOptimizerTests(unittest.TestCase):
    def setUp(self):
        self.scope = Scope("repo-snapshot", "r1")
        self.text = Sort("Text", "v1", lambda x: isinstance(x, str))
        self.int = Sort("Int", "v1", lambda x: type(x) is int)
        self.key_l = Role("left", "k", "key", self.scope, self.text)
        self.value_l = Role("left", "v", "value", self.scope, self.text)
        self.key_r = Role("right", "k", "key", self.scope, self.text)
        self.value_r = Role("right", "w", "weight", self.scope, self.int)
        self.binding = Binding(self.key_l, self.key_r)

    def rel(self, roles, algebra, records):
        return Relation.form(self.scope, roles, algebra, records)

    def test_count_join_and_projection_collision(self):
        a = Algebra("count")
        left = self.rel((self.key_l, self.value_l), a, [
            ({self.key_l: "x", self.value_l: "A"}, 2),
            ({self.key_l: "x", self.value_l: "A"}, 3),
            ({self.key_l: "y", self.value_l: "A"}, 7),
        ])
        right = self.rel((self.key_r, self.value_r), a, [
            ({self.key_r: "x", self.value_r: 1}, 5),
            ({self.key_r: "x", self.value_r: 2}, 11),
        ])
        result = project(join(left, right, (self.binding,)), (self.value_l,))
        self.assertEqual(result.rows[0].annotation, 80)

    def test_relation_formation_coalesces_duplicate_tuples_by_algebra_addition(self):
        relation = self.rel((self.key_l,), Algebra("count"), [
            ({self.key_l: "x"}, 2), ({self.key_l: "x"}, 3),
        ])
        self.assertEqual(len(relation.rows), 1)
        self.assertEqual(relation.rows[0].annotation, 5)

    def test_semijoin_demand_cannot_leak_right_output_roles(self):
        left = Scan("left", frozenset({self.key_l}))
        right = Scan("right", frozenset({self.key_r}))
        node = SemiPlan(left, right, frozenset({self.key_l}), frozenset({self.key_r}), (self.binding,))
        with self.assertRaisesRegex(ValueError, "left-side roles"):
            demand_closure(node, (self.key_r,))

    def test_binding_and_projection_use_versioned_sort_equality(self):
        ci = Sort("CaseFoldText", "v1", lambda x: isinstance(x, str),
                  equals=lambda a, b: a.casefold() == b.casefold())
        left_key = Role("ci-left", "k", "key", self.scope, ci)
        right_key = Role("ci-right", "k", "key", self.scope, ci)
        a = Algebra("count")
        left = self.rel((left_key,), a, [({left_key: "A"}, 2), ({left_key: "a"}, 3)])
        right = self.rel((right_key,), a, [({right_key: "a"}, 7)])
        self.assertEqual(len(left.rows), 1)
        self.assertEqual(left.rows[0].annotation, 5)
        self.assertEqual(join(left, right, (Binding(left_key, right_key),)).rows[0].annotation, 35)

    def test_unbound_join_is_cartesian_within_exact_scope(self):
        a = Algebra("bool")
        left = self.rel((self.key_l,), a, [({self.key_l: "a"}, True)])
        right = self.rel((self.value_r,), a, [({self.value_r: 1}, True), ({self.value_r: 2}, True)])
        self.assertEqual(len(join(left, right).rows), 2)

    def test_scope_and_sort_revision_mismatch_rejected(self):
        wrong_scope = Role("right", "k", "key", Scope("repo-snapshot", "r2"), self.text)
        with self.assertRaisesRegex(ValueError, "Scope"):
            Binding(self.key_l, wrong_scope)
        wrong_sort = Role("right", "k", "key", self.scope, Sort("Text", "v2", lambda x: isinstance(x, str)))
        with self.assertRaisesRegex(ValueError, "Sort"):
            Binding(self.key_l, wrong_sort)

    def test_display_name_does_not_create_binding(self):
        a = Algebra("count")
        left = self.rel((self.key_l,), a, [({self.key_l: "same"}, 2)])
        right = self.rel((self.key_r,), a, [({self.key_r: "different"}, 3)])
        # No binding means Cartesian product; matching display labels are irrelevant.
        self.assertEqual(join(left, right).rows[0].annotation, 6)

    def test_support_semijoin_does_not_multiply_right_weight(self):
        a = Algebra("count")
        left = self.rel((self.key_l,), a, [({self.key_l: "x"}, 2)])
        right = self.rel((self.key_r, self.value_r), a, [
            ({self.key_r: "x", self.value_r: 3}, 3),
            ({self.key_r: "x", self.value_r: 4}, 4),
        ])
        self.assertEqual([r.annotation for r in semijoin(left, right, (self.binding,)).rows], [2])

    def test_events_semijoin_and_exclude_are_world_local(self):
        a = Algebra("events", frozenset({"w1", "w2", "w3"}))
        left = self.rel((self.key_l,), a, [({self.key_l: "x"}, frozenset({"w1", "w2", "w3"}))])
        right = self.rel((self.key_r,), a, [
            ({self.key_r: "x"}, frozenset({"w1"})),
            ({self.key_r: "x"}, frozenset({"w2"})),
        ])
        semi = semijoin(left, right, (self.binding,))
        anti = exclude(left, right, (self.binding,), ClosedDomain("d", "s1", "signed-index"),
                       expected_domain="d", expected_snapshot="s1")
        self.assertEqual(semi.rows[0].annotation, frozenset({"w1", "w2"}))
        self.assertEqual(anti.rows[0].annotation, frozenset({"w3"}))

    def test_exclude_requires_exact_complete_domain_and_snapshot(self):
        a = Algebra("bool")
        left = self.rel((self.key_l,), a, [({self.key_l: "x"}, True)])
        right = self.rel((self.key_r,), a, [])
        with self.assertRaisesRegex(ValueError, "exact right input"):
            exclude(left, right, (self.binding,), ClosedDomain("d", "old", "authority"),
                    expected_domain="d", expected_snapshot="new")

    def test_invalid_zero_weight_source_is_still_rejected(self):
        with self.assertRaisesRegex(ValueError, "invalid value"):
            self.rel((self.key_l,), Algebra("count"), [({self.key_l: 7}, 0)])

    def test_provenance_join_and_projection_preserve_polynomial(self):
        a = Algebra("provenance")
        left = self.rel((self.key_l,), a, [({self.key_l: "x"}, atom("L"))])
        right = self.rel((self.key_r,), a, [({self.key_r: "x"}, atom("R1")),
                                             ({self.key_r: "x"}, atom("R2"))])
        result = project(join(left, right, (self.binding,)), ())
        self.assertEqual(result.rows[0].annotation,
                         ((("L", "R1"), Fraction(1)), (("L", "R2"), Fraction(1))))

    def test_rational_is_exact(self):
        a = Algebra("rational")
        left = self.rel((self.key_l,), a, [({self.key_l: "x"}, Fraction(1, 10))])
        right = self.rel((self.key_r,), a, [({self.key_r: "x"}, Fraction(2, 10))])
        self.assertEqual(join(left, right, (self.binding,)).rows[0].annotation, Fraction(1, 50))

    def test_tropical_min_plus(self):
        a = Algebra("tropical")
        left = self.rel((self.key_l,), a, [({self.key_l: "x"}, 3)])
        right = self.rel((self.key_r,), a, [({self.key_r: "x"}, 4)])
        self.assertEqual(join(left, right, (self.binding,)).rows[0].annotation, 7)

    def test_boolean_idempotent_projection(self):
        a = Algebra("bool")
        rel = self.rel((self.value_l,), a, [({self.value_l: "A"}, True), ({self.value_l: "A"}, True)])
        self.assertEqual(project(rel, ()).rows[0].annotation, True)

    def test_join_demand_keeps_both_binding_endpoints(self):
        left = Scan("left", frozenset({self.key_l, self.value_l}))
        right = Scan("right", frozenset({self.key_r, self.value_r}))
        node = JoinPlan(left, right,
                        frozenset({self.key_l, self.value_l}),
                        frozenset({self.key_r, self.value_r}),
                        (self.binding,))
        demands = demand_closure(node, (self.value_l, self.value_r))
        self.assertEqual(demands[id(left)], frozenset({self.key_l, self.value_l}))
        self.assertEqual(demands[id(right)], frozenset({self.key_r, self.value_r}))

    def test_annotation_profiles_obey_selected_semiring_laws(self):
        profiles = [
            (Algebra("bool"), [False, True]),
            (Algebra("count"), [0, 1, 2]),
            (Algebra("tropical"), [float("inf"), 0, 2]),
            (Algebra("rational"), [Fraction(0), Fraction(1, 2), Fraction(2)]),
            (Algebra("provenance"), [(), (((), Fraction(1)),), atom("a"), atom("b")]),
            (Algebra("events", frozenset({"w1", "w2"})), [frozenset(), frozenset({"w1"}), frozenset({"w2"}), frozenset({"w1", "w2"})]),
        ]
        for algebra, values in profiles:
            zero, one = algebra.zero(), algebra.one()
            for a in values:
                self.assertEqual(algebra.add(a, zero), a)
                self.assertEqual(algebra.multiply(a, one), a)
                self.assertEqual(algebra.multiply(a, zero), zero)
                for b in values:
                    self.assertEqual(algebra.add(a, b), algebra.add(b, a))
                    self.assertEqual(algebra.multiply(a, b), algebra.multiply(b, a))
                    for d in values:
                        self.assertEqual(algebra.add(algebra.add(a, b), d), algebra.add(a, algebra.add(b, d)))
                        self.assertEqual(algebra.multiply(algebra.multiply(a, b), d), algebra.multiply(a, algebra.multiply(b, d)))
                        self.assertEqual(algebra.multiply(a, algebra.add(b, d)),
                                         algebra.add(algebra.multiply(a, b), algebra.multiply(a, d)))

    def test_shared_plan_dag_unions_consumer_demands(self):
        a, b = self.key_l, self.value_l
        shared = Scan("shared", frozenset({a, b}))
        left = Filter(shared, frozenset({a}), True, True)
        right = Filter(shared, frozenset({b}), True, True)
        root = JoinPlan(left, right, frozenset({a}), frozenset({b}), ())
        self.assertEqual(demand_closure(root, (a, b))[id(shared)], frozenset({a, b}))

    def test_predicate_roles_remain_live_and_barrier_is_explicit(self):
        scan = Scan("s", frozenset({self.key_l, self.value_l}))
        impure = Filter(scan, frozenset({self.key_l}), False, True)
        demands = demand_closure(impure, (self.value_l,))
        self.assertEqual(demands[id(scan)], frozenset({self.key_l, self.value_l}))
        self.assertFalse(can_cross_filter(impure))
        self.assertTrue(can_cross_filter(Filter(scan, frozenset({self.key_l}), True, True)))

    def test_project_cannot_satisfy_removed_role(self):
        scan = Scan("s", frozenset({self.key_l, self.value_l}))
        with self.assertRaisesRegex(ValueError, "removed by Project"):
            demand_closure(Project(scan, frozenset({self.value_l})), (self.key_l,))

    def test_exhaustive_count_projection_differential_6561(self):
        a = Algebra("count")
        checked = 0
        # Eight independent weights in {0,1,2}: 3^8 = 6,561 source cases.
        for weights in itertools.product((0, 1, 2), repeat=8):
            lw, rw = weights[:4], weights[4:]
            left = self.rel((self.key_l, self.value_l), a, [
                ({self.key_l: "x", self.value_l: "A"}, lw[0]),
                ({self.key_l: "x", self.value_l: "B"}, lw[1]),
                ({self.key_l: "y", self.value_l: "A"}, lw[2]),
                ({self.key_l: "z", self.value_l: "B"}, lw[3]),
            ])
            right = self.rel((self.key_r, self.value_r), a, [
                ({self.key_r: "x", self.value_r: 1}, rw[0]),
                ({self.key_r: "x", self.value_r: 2}, rw[1]),
                ({self.key_r: "y", self.value_r: 1}, rw[2]),
                ({self.key_r: "z", self.value_r: 2}, rw[3]),
            ])
            observed = {row.values[0]: row.annotation
                        for row in project(join(left, right, (self.binding,)), (self.value_l,)).rows}
            expected = {}
            # Independent nested-loop oracle; no optimizer or projection helper.
            left_raw = [("x", "A", lw[0]), ("x", "B", lw[1]),
                        ("y", "A", lw[2]), ("z", "B", lw[3])]
            right_raw = [("x", rw[0]), ("x", rw[1]), ("y", rw[2]), ("z", rw[3])]
            for lk, lv, left_weight in left_raw:
                for rk, right_weight in right_raw:
                    if lk == rk and left_weight and right_weight:
                        expected[lv] = expected.get(lv, 0) + left_weight * right_weight
            self.assertEqual(observed, expected)
            checked += 1
        self.assertEqual(checked, 6561)


if __name__ == "__main__":
    unittest.main(verbosity=2)
