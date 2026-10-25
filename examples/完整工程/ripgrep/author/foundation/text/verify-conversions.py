"""Bounded local value evidence, not a Gift Reader/linker/compiler or emitter.

Reads the actual author Expr. Expected bytes/text come exclusively from Python's
built-in ASCII/UTF-8 codecs and format(), not from the implementation under test.
Only the six fixed pure std symbols and Expr forms used by this module are read.
"""
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "conversions.module.json"


def unique(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("duplicate JSON key: " + key)
        value[key] = item
    return value


module = json.loads(SOURCE.read_bytes(), object_pairs_hook=unique)
definitions = module["definitions"]
functions = {k: v["body"] for k, v in definitions.items() if v["kind"] == "core:function"}
exercised = set()
trace = []
trace_enabled = False
inject_division_failure = False
ALLOWED_STD = {"std:IntCompare", "std:IntAdd", "std:IntDivMod", "std:SeqEmpty", "std:SeqPrepend", "std:TextConcat"}


def tag(name, payload=None):
    return (name, payload)


def invoke(ref, args):
    if trace_enabled:
        trace.append(ref)
    if ref == "std:IntCompare":
        assert len(args) == 2 and all(type(x) is int for x in args)
        return tag("Less" if args[0] < args[1] else "Greater" if args[0] > args[1] else "Equal")
    if ref == "std:IntAdd":
        assert len(args) == 2 and all(type(x) is int for x in args)
        return args[0] + args[1]
    if ref == "std:IntDivMod":
        assert len(args) == 2 and all(type(x) is int for x in args)
        if inject_division_failure or args[1] == 0:
            return tag("Err", "test-only arithmetic fault token")
        quotient, remainder = divmod(args[0], abs(args[1]))
        return tag("Ok", {"quot": quotient if args[1] > 0 else -quotient, "rem": remainder})
    if ref == "std:SeqEmpty":
        assert not args
        return []
    if ref == "std:SeqPrepend":
        assert len(args) == 2 and type(args[0]) is int and type(args[1]) is list
        return [args[0], *args[1]]
    if ref == "std:TextConcat":
        assert len(args) == 2 and all(type(x) is str for x in args)
        return args[0] + args[1]
    assert ref.startswith("local:"), "unsupported symbol " + ref
    name = ref.removeprefix("local:")
    definition = functions[name]
    assert len(args) == len(definition["parameters"])
    exercised.add(name)
    return evaluate(definition["body"], dict(zip((p["name"] for p in definition["parameters"]), args)))


def evaluate(expression, environment):
    op = expression["op"]
    if op == "literal":
        return int(expression["value"]) if expression["type"]["name"] == "int" else expression["value"]
    if op == "var":
        return environment[expression["name"]]
    if op == "field":
        return evaluate(expression["record"], environment)[expression["name"]]
    if op == "variant":
        return tag(expression["constructor"], evaluate(expression["payload"], environment))
    if op == "if":
        condition = evaluate(expression["condition"], environment)
        assert type(condition) is bool
        return evaluate(expression["then"] if condition else expression["otherwise"], environment)
    if op == "match":
        name, payload = evaluate(expression["value"], environment)
        cases = [c for c in expression["cases"] if c["constructor"] == name]
        assert len(cases) == 1
        branch = cases[0]
        return evaluate(branch["body"], {**environment, branch["binding"]: payload})
    if op == "call":
        assert expression["callee"]["op"] == "symbol"
        return invoke(expression["callee"]["ref"], [evaluate(arg, environment) for arg in expression["arguments"]])
    raise AssertionError("unsupported author Expr " + op)


references = set()
def inspect(value):
    if isinstance(value, dict):
        if value.get("op") == "symbol":
            references.add(value["ref"])
        for child in value.values():
            inspect(child)
    elif isinstance(value, list):
        for child in value:
            inspect(child)


inspect(module)
assert {r for r in references if r.startswith("std:")} == ALLOWED_STD
assert all(r in ALLOWED_STD or r.removeprefix("local:") in functions for r in references)
assert all(e["definitionId"] in definitions for e in module["exports"].values())
assert all(fn["effects"] == [] for fn in functions.values())

counts = {}
for byte in range(128):
    expected = bytes([byte]).decode("ascii", errors="strict")
    assert invoke("local:AsciiText", [byte]) == tag("Ok", expected), byte
counts["ascii_complete_domain"] = 128
for byte in range(256):
    expected = format(byte, "02x")
    assert invoke("local:ByteHexLower", [byte]) == tag("Ok", expected), byte
counts["hex_complete_domain"] = 256

# All BMP scalars, deterministic supplementary-plane samples and every boundary
# neighborhood are selected independently of the tested module's own branches.
scalar_inputs = set(range(0x10000))
scalar_inputs.update(range(0x10000, 0x110000, 257))
for boundary in (0, 0x80, 0x800, 0xD800, 0xDC00, 0xE000, 0x10000, 0x110000):
    scalar_inputs.update(range(max(0, boundary - 2), min(0x110000, boundary + 3)))
for plane in range(1, 17):
    scalar_inputs.update((plane * 0x10000 - 1, plane * 0x10000, plane * 0x10000 + 1, plane * 0x10000 + 0xFFFF))
valid_count = 0
for scalar in sorted(scalar_inputs):
    try:
        expected = list(chr(scalar).encode("utf-8", errors="strict"))
    except UnicodeEncodeError:
        continue  # Surrogates are covered in the explicit rejection loop below.
    actual = invoke("local:ScalarUtf8", [scalar])
    assert actual == tag("Ok", expected), (scalar, actual, expected)
    assert all(0 <= byte <= 255 for byte in actual[1])
    valid_count += 1
counts["utf8_valid_scalars"] = valid_count

invalid_sets = {
    "ScalarUtf8": ("InvalidScalar", [*range(0xD800, 0xE000), -1, -(1 << 256), 0x110000, 0x110001, 1 << 256]),
    "AsciiText": ("InvalidAscii", [-1, -2, -(1 << 256), 128, 129, 255, 256, 1 << 256]),
    "ByteHexLower": ("InvalidByte", [-1, -2, -(1 << 256), 256, 257, 1 << 256]),
}
trace_enabled = True
for name, (kind, values) in invalid_sets.items():
    for value in values:
        trace.clear()
        assert invoke("local:" + name, [value]) == tag("Err", tag(kind, value))
        assert not {"local:EncodeScalarValid", "local:AsciiLookup", "local:HexNibble", "std:IntDivMod", "std:SeqPrepend", "std:TextConcat"}.intersection(trace)
    counts[name + "_rejections_before_conversion"] = len(values)

# Fault injection checks only the authored Err forwarding branch. It does not
# claim a conforming nonzero IntDivMod call can produce this error.
inject_division_failure = True
for name, value in (("ScalarUtf8", 128), ("ScalarUtf8", 2048), ("ScalarUtf8", 65536), ("ByteHexLower", 0)):
    trace.clear()
    assert invoke("local:" + name, [value]) == tag("Err", tag("ArithmeticInvariant"))
    assert trace.count("std:IntDivMod") == 1
    assert not {"std:SeqPrepend", "std:TextConcat", "local:HexNibble"}.intersection(trace)
counts["defensive_arithmetic_error_forwarding"] = 4
assert set(functions) == exercised

report = {
    "status": "PASS",
    "module_sha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
    "verifier_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    "checks": counts,
    "functions_exercised": len(exercised),
    "fixed_std_symbols": sorted(ALLOWED_STD),
    "oracle": "Python built-in bytes.decode('ascii'), chr(...).encode('utf-8', errors='strict'), and format(byte, '02x'); expected outputs are not computed by author bodies.",
    "scope": "Exact authored Expr under a task-local finite pure evaluator, plus independent value oracles; no production schema/linker/type/effect/Target/native or whole-ripgrep equivalence proof.",
}
print(json.dumps(report, indent=2))
