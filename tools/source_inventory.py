"""The documentation source boundary shared by checks and reading builds."""
from pathlib import Path
import json


def load(path: Path):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f'duplicate JSON key {key!r}: {path.name}')
            result[key] = value
        return result
    return json.loads(path.read_text(encoding='utf-8'), object_pairs_hook=unique)


def local_path(root: Path, name: str) -> Path:
    if not isinstance(name, str) or not name or '\\' in name or ':' in name:
        raise ValueError(f'unsafe relative path: {name!r}')
    parts = name.split('/')
    if any(part in ('', '.', '..') for part in parts):
        raise ValueError(f'unsafe relative path: {name!r}')
    current = root
    for part in parts:
        current = current / part
        if current.is_symlink() or (hasattr(current, 'is_junction') and current.is_junction()):
            raise ValueError(f'linked documentation path: {name}')
    return current


def source_files(root: Path) -> tuple[Path, ...]:
    """Enumerate declared roots completely; the manifest does not hide extras."""
    root = root.resolve()
    baseline = load(local_path(root, '.documentation/baseline.json'))
    names = baseline['source_roots']
    if (not isinstance(names, list) or not names
            or not all(isinstance(name, str) for name in names)
            or len(set(names)) != len(names)):
        raise ValueError('source_roots must be a nonempty set of relative paths')
    roots = [local_path(root, name) for name in names]
    for index, first in enumerate(roots):
        for second in roots[index + 1:]:
            if first == second or first in second.parents or second in first.parents:
                raise ValueError('documentation source roots overlap')
    files = []
    pending = list(roots)
    while pending:
        entry = pending.pop()
        entry = local_path(root, entry.relative_to(root).as_posix())
        if entry.is_file():
            files.append(entry)
        elif entry.is_dir():
            pending.extend(entry.iterdir())
        else:
            raise ValueError(f'missing or non-ordinary documentation source: {entry.relative_to(root)}')
    namespaces = baseline['audited_namespaces']
    exemptions = baseline['non_documentation_roots']
    if not namespaces:
        raise ValueError('audited_namespaces must be nonempty')
    for values in (namespaces, exemptions):
        if (not isinstance(values, list) or not all(isinstance(value, str) for value in values)
                or len(set(values)) != len(values)):
            raise ValueError('documentation namespace boundaries must be unique relative paths')
    namespace_paths = [local_path(root, name) for name in namespaces]
    exemption_paths = [local_path(root, name) for name in exemptions]
    for exemption in exemption_paths:
        if not any(namespace in exemption.parents for namespace in namespace_paths):
            raise ValueError('non-documentation root must be inside an audited namespace')
        if any(exemption == source or exemption in source.parents or source in exemption.parents
               for source in roots):
            raise ValueError('non-documentation root overlaps a documentation source root')
    members = set(files)
    pending = [namespace for namespace in namespace_paths if namespace.exists()]
    while pending:
        entry = pending.pop()
        if any(entry == exemption or exemption in entry.parents for exemption in exemption_paths):
            continue
        entry = local_path(root, entry.relative_to(root).as_posix())
        if entry.is_dir():
            pending.extend(entry.iterdir())
        elif entry not in members:
            raise ValueError(f'unexpected file in documentation namespace: {entry.relative_to(root)}')
    return tuple(sorted(files, key=lambda entry: entry.relative_to(root).as_posix()))
