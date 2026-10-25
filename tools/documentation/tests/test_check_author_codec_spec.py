"""Independent expansion equations and preservation boundaries, not a Reader test."""
import copy
import json
from pathlib import Path
from unittest import TestCase

from author_codec_spec import Expansion, ShortFormError
from codec_parameters import build_graph
from source_inventory import capture_source_bytes


class AuthorCodecSpec(TestCase):
    @classmethod
    def setUpClass(cls):
        cls.expansion = Expansion(build_graph(capture_source_bytes(Path(__file__).resolve().parents[3])))

    def test_independently_authored_expansion_vectors(self):
        path = Path(__file__).resolve().parents[3] / 'examples/第一层作者/names-and-roots/codec-cases.json'
        vectors = json.loads(path.read_text(encoding='utf-8'))['cases']
        self.assertEqual(len({v['name'] for v in vectors}), len(vectors))
        for vector in vectors:
            with self.subTest(vector=vector['name']):
                original = copy.deepcopy(vector['input'])
                expand = getattr(self.expansion, vector['slot'])
                if vector.get('expectedExpansionError'):
                    with self.assertRaises(ShortFormError): expand(vector['input'])
                else:
                    self.assertEqual(expand(vector['input']), vector['expectedExpanded'])
                self.assertEqual(vector['input'], original)

    def test_every_complete_kind_remains_reachable_without_a_special_short_body(self):
        specialized = {'core:type', 'core:constant', 'intent:goal', 'state:machine'}
        for kind in self.expansion.kinds - specialized:
            # Wrapper reachability alone does not validate this deliberately
            # opaque body; strict S4 is a separate acceptance obligation.
            body = {'opaque': {'all': [], 'kind': 'ordinary data'}}
            self.assertEqual(self.expansion.definition({kind: body}), {'kind': kind, 'body': body})

    def test_mixed_definitions_metadata_and_exact_data_are_preserved(self):
        source = {'schema': 'gift.author-module/design-converged', 'moduleId': 'm',
                  'definitions': {'': {'req:enum-value': {}, 'name': '显示'},
                                  'Bool': {'core:type': 'bool'},
                                  'C': {'kind': 'core:constant', 'body': {'type': {'tag': 'scalar', 'name': 'text'},
                                         'value': {'op': 'literal', 'type': {'tag': 'scalar', 'name': 'text'}, 'value': 'local:X'}}}},
                  'imports': {'库': {'locked': 'module:library', 'constraint': 'exact'}}, 'exports': ['', 'Bool']}
        before = copy.deepcopy(source)
        result = self.expansion.module_value(source)
        self.assertEqual(result['definitions'][''], {'kind': 'req:enum-value', 'name': '显示', 'body': {}})
        self.assertEqual(result['definitions']['Bool'], {'kind': 'core:type', 'body': {'type': {'tag': 'scalar', 'name': 'bool'}}})
        self.assertEqual(result['definitions']['C'], source['definitions']['C'])
        self.assertEqual(result['imports']['库'], {'mode': 'locked', 'moduleId': 'module:library', 'constraint': 'exact'})
        self.assertEqual(result['exports'], {'': {'definitionId': ''}, 'Bool': {'definitionId': 'Bool'}})
        self.assertEqual(source, before)

    def test_kind_wrapper_does_not_invent_specialized_body_shorthand(self):
        body = {'strength': 'require', 'fields': {'x': {'type': {'kind': 'value', 'valueType': {'builtin': 'Int'}}}},
                'semantics': {'source': 's', 'section': 'c', 'scope': 'all'}, 'implementation': 'unbound'}
        self.assertEqual(self.expansion.definition({'req:rule': body}), {'kind': 'req:rule', 'body': body})
        # Missing required in the field is deliberately retained for complete
        # Schema rejection. Expansion return alone must not be called decoding.

    def test_opaque_declaration_preserves_representation_boundary(self):
        source = {'core:type': {'opaque': True, 'visibility': 'public',
                  'type': {'record': {'start': 'int', 'end': 'int'}, 'open': False}}}
        expected = {'kind': 'core:type', 'body': {'opaque': True, 'visibility': 'public',
                    'type': {'tag': 'record', 'fields': {
                        'start': {'type': {'tag': 'scalar', 'name': 'int'}},
                        'end': {'type': {'tag': 'scalar', 'name': 'int'}}}, 'open': False}}}
        self.assertEqual(self.expansion.definition(source), expected)
        self.assertEqual(self.expansion.definition(expected), expected)
        for opaque in (False, 'true'):
            candidate = copy.deepcopy(source)
            candidate['core:type']['opaque'] = opaque
            self.assertEqual(self.expansion.definition(candidate)['body']['opaque'], opaque)
        # A malformed flag is retained for strict Schema rejection, not coerced.
        transparent = copy.deepcopy(source)
        del transparent['core:type']['opaque']
        self.assertNotIn('opaque', self.expansion.definition(transparent)['body'])

    def test_exact_branches_stop_recursive_short_expansion(self):
        for value, method in [({'tag': 'option', 'inner': 'bool'}, self.expansion.type),
                              ({'op': 'all', 'items': [{'local:P': {}}]}, self.expansion.formula)]:
            self.assertEqual(method(value), value)
        exact = {'kind': 'core:type', 'body': {'type': 'bool'}}
        self.assertEqual(self.expansion.definition(exact), exact)

    def test_type_record_fields_and_complete_professional_endpoints(self):
        self.assertEqual(self.expansion.type({'record': {'': {'type': 'bool', 'optional': True, 'mutable': False}}, 'open': False}),
                         {'tag': 'record', 'fields': {'': {'type': {'tag': 'scalar', 'name': 'bool'}, 'optional': True, 'mutable': False}}, 'open': False})
        self.assertEqual(self.expansion.type({'rational': True}), {'tag': 'rational'})
        self.assertEqual(self.expansion.type({'wireVariant': {'known': {'A': 'text'}, 'unknown': 'preserve-raw-frame',
                             'encoding': 'tagged-json-frame', 'duplicates': 'reject-known-preserve-unknown'}}),
                         {'tag': 'wire-variant', 'known': {'A': {'tag': 'scalar', 'name': 'text'}},
                          'unknown': 'preserve-raw-frame', 'encoding': 'tagged-json-frame', 'duplicates': 'reject-known-preserve-unknown'})

    def test_iff_expansion_shares_only_its_operand_occurrences(self):
        value = {'local:P': {'x': 'input'}}
        for _ in range(12):
            value = {'iff': [value, {'local:Q': {'x': 'input'}}]}
        expanded = self.expansion.formula(value)
        first, second = expanded['items']
        self.assertIs(first['if'], second['then'])
        self.assertIs(first['then'], second['if'])
        identities = set()
        def visit(node):
            if isinstance(node, (dict, list)):
                if id(node) in identities: return
                identities.add(id(node))
                for item in (node.values() if isinstance(node, dict) else node): visit(item)
        visit(expanded)
        self.assertLess(len(identities), 100)
        # Equal text at distinct source occurrences still decodes independently.
        pair = self.expansion.formula({'iff': [{'local:P': {}}, {'local:P': {}}]})['items'][0]
        self.assertIsNot(pair['if'], pair['then'])

    def test_state_table_is_default_external_and_rules_keep_internal(self):
        result = self.expansion.state({'states': ['A', 'B'], 'initial': 'A', 'events': ['go'],
                                       'transitions': {'table': {'B': {'go': 'A'}, 'A': {'go': 'B'}}}})
        self.assertEqual(result['transitions'], [{'from': 'A', 'event': 'go', 'to': 'B'}, {'from': 'B', 'event': 'go', 'to': 'A'}])
        self.assertEqual(result['events'], [{'name': 'go', 'payload': {'tag': 'scalar', 'name': 'unit'}}])
        rules = [{'from': 'A', 'event': 'go', 'to': 'A', 'kind': 'internal'}]
        self.assertEqual(self.expansion.state({'transitions': {'rules': rules}})['transitions'], rules)

    def test_goal_six_modalities_and_observations_have_distinct_slots(self):
        clauses = {'a': {'achieve': {'local:P': {'x': 'input'}}}, 'b': {'maintain': {'not': {'local:P': {'x': 'input'}}}},
                   'c': {'avoid': {'local:P': {'x': 'input'}}},
                   'd': {'oblige': {'actorRole': 'input', 'trigger': {'local:P': {'x': 'input'}},
                                    'fulfilment': {'local:Q': {'x': 'input'}}, 'temporalMode': 'open-ended'}},
                   'e': {'permit': {'actorRole': 'input', 'actionRef': 'local:A'}},
                   'f': {'prefer': {'qualityRef': 'local:Q', 'direction': 'minimize'}}}
        observation = {'meaningRef': 'local:P', 'sourceRef': 'observation:1'}
        result = self.expansion.goal({'roles': {'input': 'local:T'}, 'clauses': clauses, 'observations': [observation]})
        self.assertEqual(result['roles'], {'input': {'typeRef': 'local:T', 'cardinality': 'one'}})
        self.assertEqual([c['modality'] for c in result['clauses']], ['achieve', 'maintain', 'avoid', 'oblige', 'permit', 'prefer'])
        self.assertEqual(result['clauses'][3]['trigger'], {'op': 'call', 'meaningRef': 'local:P', 'bindings': {'x': 'input'}})
        self.assertEqual(result['observations'], [observation])

    def test_ambiguous_and_overwriting_short_forms_rejected(self):
        cases = [({'core:type': 'bool', 'req:enum-value': {}}, self.expansion.definition),
                 ({'core:type': 'bool', 'body': {}}, self.expansion.definition),
                 ({'record': {}}, self.expansion.type),
                 ({'bool': {'name': 'int'}}, self.expansion.type),
                 ({'quantify': {'op': 'call'}}, self.expansion.formula),
                 ({'iff': []}, self.expansion.formula)]
        for value, method in cases:
            with self.subTest(value=value), self.assertRaises(ShortFormError): method(value)

    def test_ordinary_data_and_explicit_choices_survive_literal_expansion(self):
        data = {'op': 'all', 'kind': 'core:type', 'local:X': {'tag': 'scalar'}}
        result = self.expansion.definition({'core:constant': {'type': {'nominal': 'local:Data'}, 'literal': data}})
        self.assertEqual(result['body']['value'], {'op': 'literal', 'type': {'tag': 'nominal', 'ref': 'local:Data'}, 'value': data})
        with self.assertRaises(ShortFormError):
            self.expansion.definition({'core:constant': {'type': 'bool', 'literal': True, 'value': {}}})
