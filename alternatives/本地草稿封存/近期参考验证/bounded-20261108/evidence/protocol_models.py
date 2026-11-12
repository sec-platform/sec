#!/usr/bin/env python3
"""Bounded design models for the Gift fusion review.

These models DO NOT import, execute or validate the Gift product. They enumerate
small event orders and compare explicitly unsafe designs with proposed guards.
No real filesystem durability, OS scheduling or distributed delivery is proved.
Run: python protocol_models.py --output protocol_model_results.json
"""
from __future__ import annotations
import argparse
import base64
import itertools
import json
from pathlib import Path
from typing import Any, Callable, Iterator


def interleave(a: tuple[str, ...], b: tuple[str, ...]) -> Iterator[tuple[str, ...]]:
    if not a:
        yield b
    elif not b:
        yield a
    else:
        for rest in interleave(a[1:], b):
            yield (a[0],) + rest
        for rest in interleave(a, b[1:]):
            yield (b[0],) + rest


def histories(name: str, a: tuple[str, ...], b: tuple[str, ...],
              simulate: Callable[[tuple[str, ...], bool], dict[str, Any]],
              scope: str) -> dict[str, Any]:
    orders = list(interleave(a, b))
    runs = [[simulate(order, repaired) for order in orders] for repaired in (False, True)]
    bad = [[(order, result) for order, result in zip(orders, group) if result['violation']]
           for group in runs]
    if not bad[0]:
        raise AssertionError(f'{name}: unsafe design was not distinguished')
    if bad[1]:
        raise AssertionError(f'{name}: guarded model still violates its modeled invariant: {bad[1][0]}')
    return {'id': name, 'scope': scope, 'histories_per_design': len(orders),
            'unsafe_violating_histories': len(bad[0]), 'guarded_violating_histories': len(bad[1]),
            'unsafe_witness': {'schedule': bad[0][0][0], **bad[0][0][1]},
            'guarded_same_schedule': simulate(bad[0][0][0], True)}


def consistent_generation() -> dict[str, Any]:
    def sim(order: tuple[str, ...], safe: bool) -> dict[str, Any]:
        current = 0
        pinned = None
        values = []
        for event in order:
            if event == 'publish_g1':
                current = 1
            elif event == 'read_data':
                pinned = current
                values.append(current)
            else:
                values.append(pinned if safe else current)
        return {'violation': values[0] != values[1], 'observed_generations': values}
    return histories('one_generation_per_logical_read', ('read_data', 'read_index'), ('publish_g1',), sim,
                     'Two correlated reads; one atomic publication. Acquiring/retaining a generation is atomic in this model.')


def pin_and_reclaim() -> dict[str, Any]:
    def sim(order: tuple[str, ...], safe: bool) -> dict[str, Any]:
        current, loaded, pinned = 0, None, None
        live = {0, 1}
        refs = {0: 0, 1: 0}
        violation = False
        trace = []
        for event in order:
            if event == 'load_unprotected':
                loaded = current
            elif event == 'protect':
                # Safe acquisition reselects current and increments protection atomically.
                pinned = current if safe else loaded
                if pinned not in live:
                    violation = True
                refs[pinned] += 1
            elif event == 'read':
                violation |= pinned not in live
            elif event == 'release':
                refs[pinned] -= 1
            elif event == 'publish_g1':
                current = 1
            elif event == 'collect_old':
                if current != 0 and refs[0] == 0:
                    live.discard(0)
            trace.append({'event': event, 'active': current, 'live': sorted(live),
                          'pinned': pinned, 'refs': dict(refs)})
        return {'violation': violation, 'trace': trace}
    return histories('pin_acquisition_vs_reclamation',
                     ('load_unprotected', 'protect', 'read', 'release'), ('publish_g1', 'collect_old'), sim,
                     'One reader and one retirement attempt. Safety only: eventual reclamation and real Arc/OS semantics are not proved.')


def semantic_write_skew() -> dict[str, Any]:
    def sim(order: tuple[str, ...], safe: bool, capacity: int = 1) -> dict[str, Any]:
        values = {'A': 0, 'B': 0}
        snapshots: dict[str, dict[str, int]] = {}
        accepted = []
        for event in order:
            action, who = event.split('_')
            if action == 'read':
                snapshots[who] = dict(values)
            else:
                observed = snapshots[who]
                local_cas = values[who] == observed[who]
                admissible = sum(observed.values()) + 1 <= capacity
                # Commit and predicate revalidation share one modeled serial point.
                if safe:
                    admissible &= sum(values.values()) + 1 <= capacity
                if local_cas and admissible:
                    values[who] += 1
                    accepted.append(who)
        return {'violation': sum(values.values()) > capacity, 'allocations': values,
                'accepted': accepted, 'capacity': capacity}
    result = histories('disjoint_writes_shared_predicate', ('read_A', 'commit_A'), ('read_B', 'commit_B'), sim,
                       'Two one-unit reservations; capacity is one. The guard rechecks the actual shared predicate, not every project file.')
    benign = [sim(s, True, 2) for s in interleave(('read_A', 'commit_A'), ('read_B', 'commit_B'))]
    assert all(r['accepted'] and len(r['accepted']) == 2 and not r['violation'] for r in benign)
    result['capacity_two_control'] = {'histories': len(benign), 'both_accepted_in_all': True}
    return result


def publish_after_check() -> dict[str, Any]:
    def sim(order: tuple[str, ...], safe: bool) -> dict[str, Any]:
        source = 0
        admitted = False
        published = False
        violation = False
        for event in order:
            if event == 'check_basis':
                admitted = source == 0
            elif event == 'edit_source':
                source = 1
            elif admitted and (not safe or source == 0):
                published = True
                violation = source != 0
        return {'violation': violation, 'published_as_current': published, 'source_at_end': source}
    return histories('check_then_publish_race', ('check_basis', 'publish'), ('edit_source',), sim,
                     'The request requires current-basis publication. Historical/detached artifact creation has a different, weaker contract.')


def operation_aba() -> dict[str, Any]:
    def sim(order: tuple[str, ...], safe: bool) -> dict[str, Any]:
        content, fence = 'A', 0
        published = violation = False
        for event in order:
            if event == 'replace_with_B_cancel':
                content, fence = 'B', 1
            elif event == 'new_request_for_A':
                content, fence = 'A', 2
            elif content == 'A' and (not safe or fence == 0):
                published = True
                violation = fence != 0
        return {'violation': violation, 'published_by_old_request': published,
                'active_content': content, 'active_fence': fence,
                'pure_value_cache_reuse_for_new_request': content == 'A'}
    return histories('content_equality_does_not_revive_request',
                     ('replace_with_B_cancel', 'new_request_for_A'), ('publish_old_request',), sim,
                     'Old request is explicitly revoked. Equal content permits pure-value reuse, not resurrection of that request authority.')


def migration_information_loss() -> dict[str, Any]:
    inputs = [tuple(i for i in range(3) if mask & (1 << i)) for mask in range(8)]
    groups: dict[int, list[dict[str, Any]]] = {}
    for data in inputs:
        old = len(data)
        new = sum(x >= 2 for x in data)
        groups.setdefault(old, []).append({'input': data, 'old_state': old, 'new_state': new})
    ambiguous = [members for members in groups.values() if len({x['new_state'] for x in members}) > 1]
    assert len(ambiguous) == 2
    witness = next((a, b) for members in ambiguous for a, b in itertools.combinations(members, 2)
                   if a['new_state'] != b['new_state'])
    return {'id': 'state_schema_equality_is_not_migration', 'finite_inputs': len(inputs),
            'ambiguous_old_state_classes': len(ambiguous), 'witness': witness,
            'conclusion': 'No total function of old_count alone can reconstruct the new filtered count for all enumerated inputs.',
            'allowed_recovery': 'Retained exact input at a fixed cut, sufficient supporting state, or a qualified mapping; not guessed zero.',
            'scope': 'Finite non-injectivity witness, not an executed product migration.'}


def summary_is_not_ir() -> dict[str, Any]:
    arenas = [{'nodes': ['Int'], 'return_type_id': 0}, {'nodes': ['Text'], 'return_type_id': 0}]
    projected = [{'type_count': len(a['nodes']), 'return_type_id': a['return_type_id']} for a in arenas]
    assert projected[0] == projected[1] and arenas[0] != arenas[1]
    return {'id': 'summary_does_not_reconstruct_arena', 'witness': {'arenas': arenas, 'common_projection': projected[0]},
            'conclusion': 'Count plus arena indices omits type definitions. Full report basis hashes can distinguish inputs but cannot reconstruct those definitions without retained data or reanalysis.',
            'scope': 'Lossy-projection witness. Does NOT claim two actual complete reports or input hashes collide.'}


def request_specific_qualification() -> dict[str, Any]:
    keys = ('prepared', 'type_ready', 'body_checked', 'method_qualified', 'target_legal', 'relevant_need', 'unrelated_need')
    states = [dict(zip(keys, bits)) for bits in itertools.product((False, True), repeat=len(keys))]
    naive = lambda s: s['prepared'] and s['type_ready'] and s['body_checked']
    allowed = lambda s: naive(s) and s['method_qualified'] and s['target_legal'] and not s['relevant_need']
    false_positives = [s for s in states if naive(s) and not allowed(s)]
    useful = [s for s in states if allowed(s) and s['unrelated_need']]
    inspect_only = [s for s in states if s['prepared'] and not allowed(s)]
    assert false_positives and useful and inspect_only
    return {'id': 'qualification_depends_on_requested_stage', 'finite_states': len(states),
            'false_generation_acceptances_from_three_ready_flags': len(false_positives),
            'allowed_generations_despite_unrelated_need': len(useful),
            'prepared_states_not_generation_ready': len(inspect_only),
            'unsafe_witness': false_positives[0],
            'scope': 'A selected pure generation region. relevant_need includes independent accepted obligations and shared invariants; this is not the complete Gift qualification algorithm.'}


def transport_costs() -> dict[str, Any]:
    def length(data: bytes) -> int:
        return 2 if not data else 1 + len(data) + sum(len(str(b)) for b in data)
    samples = [b'', b'abc', bytes(range(256)), b'd' * 65536]
    for data in samples:
        assert length(data) == len(json.dumps(list(data), separators=(',', ':')).encode())
    mib = 1024 * 1024
    table = []
    for m in (1, 4, 6, 8, 16, 32):
        n = m * mib
        encoded = 4 * n + 1  # All byte values have three decimal digits.
        table.append({'raw_bytes': n, 'numeric_array_bytes': encoded,
                      'base64_payload_bytes': 4 * ((n + 2) // 3),
                      'exceeds_64MiB_transport_before_envelope': encoded > 64 * mib,
                      'exceeds_48MiB_native_charge_at_2x_before_other_costs': encoded * 2 > 48 * mib})
    b = 65536
    rounds = [{'sequential_new_captures': n, 'replayed_source_bytes': b * n * (n + 1) // 2,
               'one_transfer_per_capture_bytes': b * n} for n in (1, 4, 8, 16, 32)]
    return {'id': 'transport_encoded_size_and_replay', 'sample_encodings_verified': len(samples),
            'worst_three_digit_byte_tables': table, 'sequential_discovery_scenario': rounds,
            'scope': 'Exact encoded-byte arithmetic. No wall-clock, JS/Rust heap, real user workload or effective maximum source capacity was measured. Base64 is a comparison, not an adopted protocol.'}


def retained_generation_budget() -> dict[str, Any]:
    capacity, generation_size = 20, 10
    live = {0, 1}
    pinned = {0}
    reclaimable = {g for g in live if g not in pinned and g != 1}
    required = (len(live - reclaimable) + 1) * generation_size
    assert required == 30 > capacity
    return {'id': 'pins_have_global_retention_cost', 'capacity_units': capacity,
            'currently_live': sorted(live), 'pinned': sorted(pinned), 'candidate_generation': 2,
            'required_units_with_candidate': required, 'admission': 'defer_or_reject_before_allocation',
            'scope': 'Synthetic equal-sized generations. One pin prevents reclamation; no byte-size or performance claim about Gift.'}


def visibility_vs_durability() -> dict[str, Any]:
    phases = ('write_candidate', 'persist_candidate', 'replace_active_name', 'persist_directory')
    cases = []
    for completed in range(len(phases) + 1):
        visible_new = completed >= 3
        durable_new = completed >= 4
        naive_ack = visible_new
        guarded_ack = durable_new
        cases.append({'completed_prefix': phases[:completed], 'new_visible': visible_new,
                      'new_durable_in_model': durable_new,
                      'unsafe_reports_durable': naive_ack,
                      'guarded_reports_durable': guarded_ack,
                      'unsafe_false_claim': naive_ack and not durable_new})
    assert sum(c['unsafe_false_claim'] for c in cases) == 1
    return {'id': 'atomic_visibility_is_not_durable_commit', 'crash_cuts': cases,
            'scope': 'Abstract persistence contract inspired by Linux fsync documentation. Not a filesystem test, Windows recipe or proof that one directory fsync qualifies an entire multi-file tree.'}


def explicit_vs_inherited() -> dict[str, Any]:
    def outputs(default: int, body: int) -> dict[str, int]:
        # B explicitly fixes parameter 1, not the whole shared implementation.
        return {'A': body * 10 + default, 'B': body * 10 + 1}
    baseline = outputs(1, 1)
    local_default_change = outputs(2, 1)
    local_body_change = outputs(1, 2)
    new_registry_version_without_lock_change = baseline.copy()
    assert local_default_change == {'A': 12, 'B': 11}
    assert local_body_change == {'A': 21, 'B': 21}
    assert new_registry_version_without_lock_change == baseline
    return {'id': 'explicit_parameter_is_not_definition_pin',
            'baseline': baseline, 'accepted_local_default_change': local_default_change,
            'accepted_local_body_change': local_body_change,
            'new_remote_version_with_unchanged_lock': new_registry_version_without_lock_change,
            'scope': 'Plain arithmetic design witness, not a gift.author-module fixture or compiler execution.'}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path('protocol_model_results.json'))
    args = parser.parse_args()
    studies = [consistent_generation(), pin_and_reclaim(), semantic_write_skew(), publish_after_check(),
               operation_aba(), migration_information_loss(), summary_is_not_ir(),
               request_specific_qualification(), transport_costs(), retained_generation_budget(),
               visibility_vs_durability(), explicit_vs_inherited()]
    result = {'scope': 'Independent bounded design studies; NOT Gift implementation tests.',
              'study_count': len(studies), 'model_checks_completed': True, 'studies': studies}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'studies': len(studies), 'output': str(args.output),
                      'bounded_histories': [{k: s[k] for k in ('id', 'histories_per_design',
                         'unsafe_violating_histories', 'guarded_violating_histories')} for s in studies if 'histories_per_design' in s]}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
