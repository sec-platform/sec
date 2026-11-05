//! Native path representation and standard operations, without matching policy.

use std::borrow::Cow;

use bstr::ByteVec;

pub use std::convert::AsRef;
pub use std::ffi::{OsStr, OsString};
pub use std::path::{Path, PathBuf};

pub fn as_ref_path<P: AsRef<Path> + ?Sized>(value: &P) -> &Path { value.as_ref() }
pub fn as_path(value: &PathBuf) -> &Path { value.as_path() }
pub fn as_os_str(value: &Path) -> &OsStr { value.as_os_str() }
pub fn os_string_as_os_str(value: &OsString) -> &OsStr { value.as_os_str() }
pub fn parent(value: &Path) -> Option<&Path> { value.parent() }
pub fn has_root(value: &Path) -> bool { value.has_root() }
pub fn to_path_buf(value: &Path) -> PathBuf { value.to_path_buf() }
pub fn clone(value: &PathBuf) -> PathBuf { value.clone() }
pub fn clone_optional_path_buf(value: &Option<PathBuf>) -> Option<PathBuf> { value.clone() }
pub fn equal(left: &Path, right: &Path) -> bool { left == right }
pub fn equal_text(left: &Path, right: String) -> bool { left == Path::new(&right) }
pub fn is_empty(value: &Path) -> bool { value.as_os_str().is_empty() }
pub fn is_file(value: &Path) -> bool { value.is_file() }
pub fn path_from_str(value: &str) -> &Path { Path::new(value) }
pub fn join_text(value: &Path, suffix: String) -> PathBuf { value.join(suffix) }
pub fn from_text(value: String) -> PathBuf { PathBuf::from(value) }
pub fn from_os_string(value: OsString) -> PathBuf { PathBuf::from(value) }
pub fn into_os_string(value: PathBuf) -> OsString { value.into_os_string() }
pub fn to_utf8(value: &OsString) -> Option<String> { value.to_str().map(str::to_owned) }
pub fn os_str_to_str(value: &OsStr) -> Option<&str> { value.to_str() }
pub fn os_str_to_owned(value: &OsStr) -> OsString { value.to_owned() }
pub fn os_string_is_empty(value: &OsString) -> bool { value.is_empty() }
pub fn os_string_vector_debug(value: &Vec<OsString>) -> String { format!("{value:?}") }
pub fn os_str_to_string_lossy(value: &OsStr) -> Cow<'_, str> { value.to_string_lossy() }
pub fn to_string_lossy_owned(value: &Path) -> String { value.to_string_lossy().into_owned() }
pub fn display(value: &Path) -> String { value.display().to_string() }

/// Directly retains the locked bstr platform and Cow branch semantics.
pub fn path_as_bytes_lossy(value: &Path) -> Cow<'_, [u8]> { Vec::from_path_lossy(value) }
pub fn is_unix_target() -> bool { cfg!(unix) }
pub fn is_separator_scalar(value: char) -> bool { std::path::is_separator(value) }

/// Unix representation is arbitrary bytes, without Unicode conversion.
#[cfg(unix)]
pub fn os_str_as_bytes(value: &OsStr) -> &[u8] {
    use std::os::unix::ffi::OsStrExt;
    value.as_bytes()
}

#[cfg(unix)]
pub fn os_str_from_bytes(value: &[u8]) -> &OsStr {
    use std::os::unix::ffi::OsStrExt;
    OsStr::from_bytes(value)
}

#[cfg(unix)]
pub fn os_string_from_bytes(value: Vec<u8>) -> OsString {
    use std::os::unix::ffi::OsStringExt;
    OsString::from_vec(value)
}

#[cfg(unix)]
pub fn os_string_into_bytes(value: OsString) -> Vec<u8> {
    use std::os::unix::ffi::OsStringExt;
    value.into_vec()
}

/// Windows representation is a round-trippable sequence of 16-bit code units.
#[cfg(windows)]
pub fn os_str_encode_wide(value: &OsStr) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    value.encode_wide().collect()
}

#[cfg(windows)]
pub fn os_string_from_wide(value: &[u16]) -> OsString {
    use std::os::windows::ffi::OsStringExt;
    OsString::from_wide(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_utf8_path_bytes_borrow_original_storage() {
        let path = Path::new("a/b");
        let bytes = path_as_bytes_lossy(path);
        assert!(matches!(bytes, Cow::Borrowed(_)));
        assert_eq!(bytes.as_ref(), b"a/b");
        assert_eq!(bytes.as_ptr(), path.to_str().unwrap().as_ptr());
    }

    #[test]
    fn path_construction_uses_standard_component_semantics() {
        let path = from_text(String::from("a/b"));
        assert_eq!(parent(as_path(&path)), Some(Path::new("a")));
        assert!(equal(as_path(&path), Path::new("a/b")));
        assert!(is_empty(Path::new("")));
        assert_eq!(into_os_string(path), OsString::from("a/b"));
    }

    #[cfg(windows)]
    #[test]
    fn windows_unpaired_surrogate_is_lossless_only_in_wide_form() {
        let wide = [0x0061, 0xD800, 0x0062];
        let os = os_string_from_wide(&wide);
        assert_eq!(os_str_encode_wide(&os), wide);
        assert_eq!(to_utf8(&os), None);
        let path = from_os_string(os);
        let bytes = path_as_bytes_lossy(&path);
        assert!(matches!(bytes, Cow::Owned(_)));
        assert_eq!(bytes.as_ref(), "a\u{FFFD}b".as_bytes());
        assert!(is_separator_scalar('\\'));
    }

    #[cfg(unix)]
    #[test]
    fn unix_non_utf8_bytes_are_preserved_and_borrowed() {
        let raw = vec![b'a', 0xFF, b'b'];
        let os = os_string_from_bytes(raw.clone());
        assert_eq!(to_utf8(&os), None);
        assert_eq!(os_str_as_bytes(&os), raw);
        let path = from_os_string(os);
        let bytes = path_as_bytes_lossy(&path);
        assert!(matches!(bytes, Cow::Borrowed(_)));
        assert_eq!(bytes.as_ref(), raw);
        assert_eq!(os_string_into_bytes(into_os_string(path)), raw);
        assert!(!is_separator_scalar('\\'));
    }
}
