// Derived from ripgrep crates/ignore/src/pathutil.rs at
// 4c2362d359d9913c7a5e391ccd79cb4da22bc89b (MIT OR Unlicense).
// Ordinary native implementation of the FileName model; not generated output.
pub(super) fn file_name(path: &[u8]) -> Option<&[u8]> {
    if path.is_empty() {
        return None;
    } else if path.len() == 1 && path[0] == b'.' {
        return None;
    } else if path.last() == Some(&b'.') {
        return None;
    } else if path.len() >= 2 && &path[path.len() - 2..] == &b".."[..] {
        return None;
    }
    let last_slash = memchr::memrchr(b'/', path).map(|i| i + 1).unwrap_or(0);
    Some(&path[last_slash..])
}
