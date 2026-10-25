// Derived from ripgrep crates/ignore/src/pathutil.rs at
// 7155f6408d370e699795dc75e954635abfaf08a6 (MIT OR Unlicense).
// Ordinary native implementation of the FileName model; not generated output.
pub(super) fn file_name(path: &[u8]) -> Option<&[u8]> {
    if path.is_empty() {
        return None;
    }
    let last_slash = memchr::memrchr(b'/', path).map(|i| i + 1).unwrap_or(0);
    let name = &path[last_slash..];
    // Only an exact dot or dot-dot component lacks a file name.
    if name == b"." || name == b".." {
        return None;
    }
    Some(name)
}
