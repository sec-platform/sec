"""Independent design checks, not Gift repository or runtime tests.
Run: python design_counterexamples.py
Only the specifically stated toy semantics are checked.
"""
from __future__ import annotations
from collections import Counter
from fractions import Fraction
from itertools import product
import json
from pathlib import Path


def run() -> dict:
    checks = []
    def record(name: str, observed: dict, explanation: str) -> None:
        checks.append({'name': name, 'status': 'passed', 'observed': observed,
                       'scope': explanation})

    # Count bag relation: correlation must survive projection until the join.
    left = [(0, 'A'), (1, 'A')]
    right = [0]
    correct = Counter(x for key, x in left for other in right if key == other)
    prematurely_projected = Counter(x for _, x in left for _ in right)
    assert correct == {'A': 1} and prematurely_projected == {'A': 2}
    record('projection_must_retain_join_key',
           {'correct_count': dict(correct), 'dropped_key_count': dict(prematurely_projected)},
           'Count-valued bag, equality join, final projection. This refutes only the bad rewrite dropping correlation keys.')

    # Existence-only semijoin is not weighted join plus projection.
    left_weight, witness_weights = 2, [3, 4]
    existential = left_weight if any(w > 0 for w in witness_weights) else 0
    multiplied = left_weight * sum(witness_weights)
    assert existential == 2 and multiplied == 14
    record('existence_semijoin_is_not_weighted_join',
           {'existence_guard_profile': existential, 'weighted_join_profile': multiplied},
           'Chosen existence-guard profile only; does not assert the intended semantics of every Gift semijoin.')

    # A finite tuple domain does not bound annotation ascending chains.
    count_values = [0]
    bool_values = [False]
    for _ in range(6):
        count_values.append(1 + count_values[-1])
        bool_values.append(True or bool_values[-1])
    assert count_values == list(range(7)) and bool_values[1:] == [True] * 6
    record('finite_carrier_not_finite_weighted_fixed_point',
           {'count_iterates': count_values, 'boolean_iterates': bool_values},
           'One-tuple equations x=1+x over N and x=True OR x over Bool. Nonexistence of a finite N solution follows algebraically, not from bounded sampling.')

    # All annotations do not have subtraction.
    assert min([1, 3]) == 1 and min([3]) == 3
    record('min_deletion_requires_support',
           {'before_minimum': 1, 'removed': 1, 'after_minimum': 3, 'naive_subtraction': 0},
           'Deleting a minimum requires remaining support or recomputation, not subtraction from the old minimum.')

    # Source formation and optimizer dead-value elimination are separate.
    carrier, raw_value, annotation = {'a'}, 'outside', 0
    formation_valid = raw_value in carrier
    eliminated_before_validation_appears_empty = annotation == 0
    assert not formation_valid and eliminated_before_validation_appears_empty
    record('zero_weight_cannot_erase_invalid_source',
           {'source_valid': formation_valid, 'premature_elimination_empty': True},
           'The model requires all supplied facts to be typed before zero elimination; no existing implementation is executed.')

    # A chosen exact rational algebra cannot be silently lowered to binary float.
    exact = Fraction(1, 10) + Fraction(2, 10)
    machine = 0.1 + 0.2
    assert exact == Fraction(3, 10) and machine != 0.3
    record('exact_rational_not_host_float',
           {'exact_sum': str(exact), 'binary_float_sum_repr': repr(machine)},
           'Only illustrates that a rational profile needs an exact target representation; does not benchmark target backends.')

    # Returned values and read dependencies must be considered separately.
    before = {'flag': True, 'a': 7, 'b': 7}
    after = {'flag': False, 'a': 7, 'b': 7}
    def query(v: dict) -> tuple[int, set[str]]:
        chosen = 'a' if v['flag'] else 'b'
        return v[chosen], {'flag', chosen}
    v0, r0 = query(before)
    v1, r1 = query(after)
    assert v0 == v1 and r0 != r1
    record('same_value_new_dependency',
           {'before_value': v0, 'after_value': v1, 'before_reads': sorted(r0), 'after_reads': sorted(r1)},
           'May avoid downstream value recomputation, but must update the query dependency set for later changes.')

    # Publication requires an exact live basis, even after successful computation.
    accepted, rejected = 0, 0
    for active_epoch, result_epoch, active_revision, result_revision in product([0, 1], repeat=4):
        may_publish = active_epoch == result_epoch and active_revision == result_revision
        if may_publish:
            accepted += 1
            assert (active_epoch, active_revision) == (result_epoch, result_revision)
        else:
            rejected += 1
    assert (accepted, rejected) == (4, 12)
    record('publication_basis_guard',
           {'finite_states': 16, 'accepted_matching_basis': accepted, 'rejected_stale_basis': rejected},
           'Exhaustive truth table for a two-field equality guard only; not a proof of real concurrent publication, IPC or filesystem atomicity.')

    return {'schema': 'gift.design-review-counterexamples/1',
            'purpose': 'Independent model-level checks; not repository conformance tests.',
            'product_tests_run': False, 'checks': checks, 'passed_count': len(checks)}

if __name__ == '__main__':
    result = run()
    destination = Path(__file__).with_name('design_counterexamples.json')
    destination.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f"{result['passed_count']} independent design checks passed; product tests NOT_RUN.")
