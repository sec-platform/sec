"""Executable, pure expansion specification for the design-converged codec.

Input is already losslessly decoded JSON. This does not implement a production
SourceReader, locations, linking, types, permissions or runtime. A result is NOT
accepted until the complete candidate Schema graph and semantic owners accept it.
Unknown fields are retained for that strict validation, never silently dropped.
"""
from __future__ import annotations

import copy
import re

from codec_parameters import locate, tokens

MODULE = 'urn:gift:design-schema:universal-author-module-2-converged-base'
LEGACY_REF = re.compile(r'(local|[A-Za-z_][A-Za-z0-9_]*):[A-Za-z_][A-Za-z0-9_]*', re.ASCII)


class ShortFormError(ValueError):
    pass


def reject(message):
    raise ShortFormError(message)


def object_at(value, slot):
    if not isinstance(value, dict):
        reject(slot + ': expected object')
    return value


def array_at(value, slot):
    if not isinstance(value, list):
        reject(slot + ': expected array')
    return value


def exactly(value, keys, slot):
    object_at(value, slot)
    if set(value) != set(keys):
        reject(slot + ': unexpected/missing fields')


def resolve(graph, node, resource=MODULE):
    """Only follow fixed Schema aliases, not data or arbitrary JSON pointers."""
    seen = set()
    while '$ref' in node:
        ref = node['$ref']
        base, _, fragment = ref.partition('#')
        resource = base or resource
        key = (resource, fragment)
        if key in seen:
            reject('cyclic Schema alias')
        seen.add(key)
        node = locate(graph[resource], tokens(fragment)) if fragment else graph[resource]
    return node


class Expansion:
    def __init__(self, graph, *, sequence_collect_ref=None):
        self.graph = graph
        self.module = graph[MODULE]
        definitions = self.module['$defs']['Definition']['oneOf']
        self.kinds = {resolve(graph, branch)['properties']['kind']['const'] for branch in definitions}
        if len(self.kinds) != len(definitions):
            reject('ambiguous complete Definition dispatch')
        scalar = [resolve(graph, branch) for branch in self.module['$defs']['Type']['oneOf']
                  if resolve(graph, branch).get('properties', {}).get('tag') == {'const': 'scalar'}]
        if len(scalar) != 1:
            reject('scalar Type owner is ambiguous')
        self.scalars = frozenset(scalar[0]['properties']['name']['enum'])
        # Selected ordinary library binding, supplied by the qualified surface
        # context. This pure spec does not implement import/Method qualification.
        self.sequence_collect_ref = copy.deepcopy(sequence_collect_ref)
        self.expr_nodes = {}
        for branch in self.module['$defs']['Expr']['oneOf']:
            node = resolve(graph, branch)
            op = node.get('properties', {}).get('op', {}).get('const')
            if isinstance(op, str):
                self.expr_nodes.setdefault(op, []).append(node)

    def branch_matches(self, node, value, resource=MODULE):
        node = resolve(self.graph, node, resource)
        for union in ('oneOf', 'anyOf'):
            if union in node:
                return any(self.branch_matches(branch, value, resource) for branch in node[union])
        if not isinstance(value, dict):
            return False
        if not set(node.get('required', ())) <= set(value):
            return False
        return all('const' not in schema or value.get(key) == schema['const']
                   for key, schema in node.get('properties', {}).items())

    def expression_slots(self, node, value, resource=MODULE):
        """Visit only Schema-owned Expr slots; literal data is never traversed."""
        if not isinstance(node, dict):
            return copy.deepcopy(value)
        if '$ref' in node:
            base, _, fragment = node['$ref'].partition('#')
            resource = base or resource
            if resource == MODULE and fragment == '/$defs/Expr':
                return self.expression(value)
            if resource == MODULE and fragment == '/$defs/ExecBody':
                if isinstance(value, dict) and 'statements' in value:
                    return copy.deepcopy(value)  # complete control body stays exact
                return self.expression(value)
            return self.expression_slots(locate(self.graph[resource], tokens(fragment)), value, resource)
        union = 'oneOf' if 'oneOf' in node else 'anyOf' if 'anyOf' in node else None
        if union is not None:
            choices = [resolve(self.graph, b, resource) for b in node[union]]
            choices = [b for b in choices if self.branch_matches(b, value, resource)]
            if not choices:
                return copy.deepcopy(value)  # malformed data stays for strict S4
            results = [self.expression_slots(branch, value, resource) for branch in choices]
            if any(result != results[0] for result in results[1:]):
                reject('short Expr has ambiguous Schema-owned child slots')
            return results[0]  # overlapping anyOf is safe only with the same expansion
        if isinstance(value, dict) and 'properties' in node:
            properties = node['properties']
            return {k: self.expression_slots(properties[k], v, resource) if k in properties
                    else copy.deepcopy(v) for k, v in value.items()}
        if isinstance(value, list) and isinstance(node.get('items'), dict):
            return [self.expression_slots(node['items'], v, resource) for v in value]
        return copy.deepcopy(value)

    def expression(self, value):
        object_at(value, 'Expr')
        if 'op' in value:
            return copy.deepcopy(value)  # all descendants remain complete, not mixed short forms
        if len(value) != 1:
            reject('Expr: expected one short constructor')
        key, payload = next(iter(value.items()))
        if key == 'comprehension':
            exactly(payload, ('yield', 'clauses'), 'sequence comprehension')
            clauses = array_at(payload['clauses'], 'sequence qualifiers')
            result = {'op': 'sequence', 'items': [self.expression(payload['yield'])]}
            for clause in reversed(clauses):
                object_at(clause, 'sequence qualifier')
                if len(clause) != 1:
                    reject('sequence qualifier: expected one discriminator')
                mode, part = next(iter(clause.items()))
                if mode == 'where':
                    result = {'op': 'if', 'condition': self.expression(part), 'then': result,
                              'otherwise': {'op': 'sequence', 'items': []}}
                elif mode in ('from', 'let'):
                    value_key = 'in' if mode == 'from' else 'value'
                    exactly(part, ('bind', value_key), 'sequence ' + mode)
                    name = part['bind']
                    if not isinstance(name, str) or not re.fullmatch(self.module['$defs']['Identifier']['pattern'], name):
                        reject('sequence binder: expected the existing lexical Identifier')
                    expression = self.expression(part[value_key])
                    if mode == 'from':
                        if self.sequence_collect_ref is None:
                            reject('sequence comprehension requires a qualified ordinary Collect binding')
                        result = {'op': 'call', 'callee': {'op': 'symbol', 'ref': copy.deepcopy(self.sequence_collect_ref)},
                                  'arguments': [expression, {'op': 'lambda', 'params': [{'name': name}], 'body': result}]}
                    else:
                        result = {'op': 'let', 'name': name, 'value': expression, 'body': result}
                else:
                    reject('sequence qualifier: unknown discriminator')
            return result
        if key not in self.expr_nodes:
            reject('Expr: unknown short constructor')
        object_at(payload, 'short Expr payload')
        if 'op' in payload:
            reject('short Expr payload cannot override op')
        complete = {'op': key, **copy.deepcopy(payload)}
        choices = [n for n in self.expr_nodes[key] if self.branch_matches(n, complete)]
        if len(choices) != 1:
            reject('short Expr requires one complete constructor branch')
        return self.expression_slots(choices[0], complete)

    def type(self, value):
        if isinstance(value, str):
            if value in self.scalars:
                return {'tag': 'scalar', 'name': value}
            if LEGACY_REF.fullmatch(value):
                return {'tag': 'nominal', 'ref': value}
            reject('Type: unknown bare name')
        object_at(value, 'Type')
        if 'tag' in value or 'packElement' in value:
            return copy.deepcopy(value)  # entire exact branch, including children
        if 'record' in value:
            exactly(value, ('record', 'open'), 'short record Type')
            fields = object_at(value['record'], 'record fields')
            return {'tag': 'record', 'fields': {name: self.field(v) for name, v in fields.items()},
                    'open': copy.deepcopy(value['open'])}
        if 'nominal' in value:
            exactly(value, ('nominal',), 'short nominal Type')
            return {'tag': 'nominal', 'ref': copy.deepcopy(value['nominal'])}
        if 'rational' in value:
            exactly(value, ('rational',), 'short rational Type')
            if value['rational'] is not True:
                reject('rational: expected true')
            return {'tag': 'rational'}
        if 'wireVariant' in value:
            exactly(value, ('wireVariant',), 'short wire Type')
            payload = object_at(value['wireVariant'], 'wireVariant payload')
            if 'tag' in payload:
                reject('wireVariant payload cannot override tag')
            result = copy.deepcopy(payload)
            if 'known' in result:
                result['known'] = {name: self.type(v) for name, v in object_at(payload['known'], 'wire known').items()}
            return {'tag': 'wire-variant', **result}
        if len(value) == 1:
            name, attributes = next(iter(value.items()))
            if name in self.scalars:
                object_at(attributes, 'scalar attributes')
                if 'tag' in attributes or 'name' in attributes:
                    reject('scalar attributes cannot override discriminator')
                return {'tag': 'scalar', 'name': name, **copy.deepcopy(attributes)}
        reject('Type: unknown or mixed short shape')

    def field(self, value):
        if isinstance(value, dict) and 'type' in value:
            return {**copy.deepcopy(value), 'type': self.type(value['type'])}
        return {'type': self.type(value)}

    def formula(self, value):
        object_at(value, 'Formula')
        if 'op' in value:
            # Includes call.arguments and its full author Expr descendants.
            # Their op encoding never triggers Formula or shared-tag guessing.
            return copy.deepcopy(value)
        if len(value) != 1:
            reject('Formula: expected exactly one short discriminator')
        key, payload = next(iter(value.items()))
        if key == 'apply':
            exactly(payload, ('meaningRef', 'arguments'), 'short Meaning application')
            arguments = object_at(payload['arguments'], 'named arguments')
            result = copy.deepcopy(arguments)
            for name, argument in arguments.items():
                object_at(argument, 'Argument')
                if set(argument) == {'value'}:
                    result[name] = {'value': self.expression(argument['value'])}
                elif set(argument) != {'binding'}:
                    reject('Argument requires exactly binding or value')
            return {'op': 'call', 'meaningRef': copy.deepcopy(payload['meaningRef']), 'arguments': result}
        if key in ('all', 'any'):
            return {'op': key, 'items': [self.formula(v) for v in array_at(payload, key)]}
        if key == 'not':
            return {'op': 'not', 'item': self.formula(payload)}
        if key in ('implies', 'iff'):
            if len(array_at(payload, key)) != 2:
                reject(key + ': expected two operands')
            left, right = [self.formula(v) for v in payload]
            forward = {'op': 'implies', 'if': left, 'then': right}
            if key == 'implies':
                return forward
            # Keep pure operand occurrences shared in memory. Serializing this
            # derived DAG as a fully duplicated author tree is not a Writer.
            return {'op': 'all', 'items': [forward, {'op': 'implies', 'if': right, 'then': left}]}
        if key in ('quantify', 'temporal'):
            object_at(payload, key)
            if 'op' in payload:
                reject(key + ': payload cannot override op')
            # Only this explicit short quantify slot accepts short expressions.
            # A complete op:quantify above remains exact through all children.
            result = {'op': key, **copy.deepcopy(payload)}
            if key == 'quantify' and 'domain' in payload:
                result['domain'] = self.expression(payload['domain'])
            for child in (('predicate',) if key == 'quantify' else ('item', 'boundary')):
                if child in payload:
                    result[child] = self.formula(payload[child])
            return result
        if isinstance(key, str) and LEGACY_REF.fullmatch(key):
            return {'op': 'call', 'meaningRef': key, 'bindings': copy.deepcopy(payload)}
        reject('Formula: unknown short discriminator')

    def clause(self, identity, value):
        object_at(value, 'Goal clause')
        if 'id' in value or 'modality' in value:
            reject('keyed clause cannot override id/modality')
        modes = set(value) & {'achieve', 'maintain', 'avoid', 'oblige', 'permit', 'prefer'}
        if len(modes) != 1:
            reject('clause requires exactly one modality')
        mode = next(iter(modes))
        if mode in ('achieve', 'maintain', 'avoid'):
            if 'formula' in value:
                reject('clause contains both short and full formula')
            result = {k: copy.deepcopy(v) for k, v in value.items() if k != mode}
            result['formula'] = self.formula(value[mode])
        else:
            exactly(value, (mode,), 'professional clause wrapper')
            payload = object_at(value[mode], mode)
            if 'id' in payload or 'modality' in payload:
                reject('professional clause cannot override id/modality')
            result = copy.deepcopy(payload)
            if mode == 'oblige':
                for child in ('trigger', 'fulfilment'):
                    if child in payload:
                        result[child] = self.formula(payload[child])
        return {'id': identity, 'modality': mode, **result}

    def goal(self, value):
        result = copy.deepcopy(object_at(value, 'Goal Body'))
        if 'roles' in value:
            roles = object_at(value['roles'], 'Goal roles')
            result['roles'] = {}
            for name, role in roles.items():
                if isinstance(role, str):
                    if not LEGACY_REF.fullmatch(role):
                        reject('short role requires a legacy Ref; use typeRef object for other names')
                    role = {'typeRef': role, 'cardinality': 'one'}
                result['roles'][name] = copy.deepcopy(role)
        if isinstance(value.get('clauses'), dict):
            result['clauses'] = [self.clause(k, value['clauses'][k]) for k in sorted(value['clauses'])]
        # Full clause arrays stay exact. Only assumptions have Formula slots;
        # observations carry original meaningRef/sourceRef and remain untouched.
        if 'assumptions' in value:
            for source, target in zip(array_at(value['assumptions'], 'assumptions'), result['assumptions']):
                if isinstance(source, dict) and 'formula' in source:
                    target['formula'] = self.formula(source['formula'])
        return result

    def state(self, value):
        result = copy.deepcopy(object_at(value, 'State Body'))
        if 'events' in value:
            result['events'] = [{'name': event, 'payload': {'tag': 'scalar', 'name': 'unit'}}
                                if isinstance(event, str) else copy.deepcopy(event)
                                for event in array_at(value['events'], 'events')]
        transitions = value.get('transitions')
        if isinstance(transitions, dict):
            if set(transitions) == {'rules'}:
                result['transitions'] = copy.deepcopy(array_at(transitions['rules'], 'transition rules'))
            elif set(transitions) == {'table'}:
                table = object_at(transitions['table'], 'transition table')
                result['transitions'] = [
                    {'from': source, 'event': event, 'to': table[source][event]}
                    for source in sorted(table)
                    for event in sorted(object_at(table[source], 'state event table'))]
            else:
                reject('transitions require exactly table or rules')
        return result

    def definition(self, value):
        object_at(value, 'Definition')
        if 'kind' in value:
            return copy.deepcopy(value)
        selected = set(value) & self.kinds
        if len(selected) != 1:
            reject('Definition requires exactly one known kind-key')
        kind = next(iter(selected))
        if 'body' in value:
            reject('Definition contains both short and exact body')
        body = value[kind]
        if kind == 'core:type':
            body = ({**copy.deepcopy(body), 'type': self.type(body['type'])}
                    if isinstance(body, dict) and 'type' in body else {'type': self.type(body)})
        elif kind == 'core:constant':
            body = copy.deepcopy(object_at(body, 'constant Body'))
            if 'type' in body:
                body['type'] = self.type(body['type'])
            if 'literal' in body:
                if 'value' in body or 'type' not in body:
                    reject('constant literal requires type and excludes value')
                body['value'] = {'op': 'literal', 'type': body['type'], 'value': body.pop('literal')}
            elif 'value' in body:
                body['value'] = self.expression(body['value'])
        elif kind == 'core:function':
            body = copy.deepcopy(object_at(body, 'function Body'))
            if 'body' in body and not (isinstance(body['body'], dict) and 'statements' in body['body']):
                body['body'] = self.expression(body['body'])
        elif kind == 'intent:goal':
            body = self.goal(body)
        elif kind == 'state:machine':
            body = self.state(body)
        else:
            body = copy.deepcopy(body)
        return {'kind': kind, 'body': body, **{k: copy.deepcopy(v) for k, v in value.items() if k != kind}}

    def module_value(self, value):
        object_at(value, 'Module')
        if value.get('schema') != 'gift.author-module/design-converged':
            reject('unsupported module codec')
        result = copy.deepcopy(value)
        definitions = object_at(value.get('definitions'), 'definitions')
        result['definitions'] = {name: self.definition(body) for name, body in definitions.items()}
        if 'imports' in value:
            for alias, imported in object_at(value['imports'], 'imports').items():
                object_at(imported, 'import')
                if 'mode' in imported:
                    continue
                modes = set(imported) & {'workspace', 'locked'}
                if len(modes) != 1 or 'moduleId' in imported:
                    reject('import requires one short mode and no moduleId')
                mode = next(iter(modes))
                result['imports'][alias] = {'mode': mode, 'moduleId': imported[mode],
                    **{k: copy.deepcopy(v) for k, v in imported.items() if k != mode}}
        if 'exports' in value:
            exports = value['exports']
            if isinstance(exports, list):
                if any(not isinstance(name, str) for name in exports) or len(set(exports)) != len(exports):
                    reject('exports require distinct Names')
                if any(name not in definitions for name in exports):
                    reject('same-name export has no local definition')
                result['exports'] = {name: {'definitionId': name} for name in exports}
            else:
                result['exports'] = {name: {'definitionId': ref} if isinstance(ref, str) else copy.deepcopy(ref)
                                     for name, ref in object_at(exports, 'exports').items()}
        return result
