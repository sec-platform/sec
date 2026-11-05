//! Rust representation and ordinary standard operations, without ripgrep policy.
//!
//! Native generic parameter order is authoritative: lifetimes precede types.
//! Ordinary arithmetic uses the selected Rust overflow-checks configuration.

// Distinguish the standard key-borrow trait from the reference type alias below.
pub use std::borrow::Borrow as BorrowKey;
pub use std::boxed::Box;
pub use std::clone::Clone;
pub use std::cmp::{Eq, PartialEq};
pub use std::collections::hash_map::IntoIter as HashMapIntoIter;
pub use std::collections::HashMap;
pub use std::convert::AsRef;
pub use std::default::Default;
pub use std::fmt::{Debug, Display, Formatter, Result as FormatResult};
pub use std::hash::{BuildHasher, BuildHasherDefault, Hash, Hasher};
pub use std::io::Error as IOError;
pub use std::iter::{IntoIterator, Iterator, Peekable};
pub use std::marker::{Copy, Sized};
pub use std::num::{ParseIntError, TryFromIntError};
pub use std::ops::{Add, AddAssign, Fn, FnMut, FnOnce};
pub use std::str::Utf8Error;
pub use std::string::FromUtf8Error;
pub use std::vec::Vec;
pub use std::vec::Vec as Vector;

pub type Usize = usize;
pub type U32 = u32;
pub type U64 = u64;
pub type Byte = u8;
pub type I32 = i32;
pub type F64 = f64;
pub type Char = char;
pub type Str = str;
pub type Text = String;
pub type ByteSlice = [u8];
pub type ByteVector = Vec<u8>;
pub type ByteArray<const N: usize> = [u8; N];
pub type Tuple1<T> = (T,);
pub type Pair<A, B> = (A, B);
// Explicitly expose unsized views to the native signature reader. Rust does not
// enforce ordinary type-alias bounds at use sites; the reference is authoritative.
#[allow(type_alias_bounds)]
pub type Borrow<'r, T: ?Sized> = &'r T;
#[allow(type_alias_bounds)]
pub type BorrowMut<'r, T: ?Sized> = &'r mut T;
pub type CowBytes<'r> = std::borrow::Cow<'r, [u8]>;
pub type CowStr<'r> = std::borrow::Cow<'r, str>;
pub type VectorIter<'r, T> = std::slice::Iter<'r, T>;
pub type VectorIterRev<'r, T> = std::iter::Rev<std::slice::Iter<'r, T>>;
pub type VectorIntoIter<T> = std::vec::IntoIter<T>;
pub type StrChars<'r> = std::str::Chars<'r>;

pub const USIZE_ZERO: usize = 0;
pub const USIZE_ONE: usize = 1;
pub const U64_ZERO: u64 = 0;
pub const BYTE_ZERO: u8 = 0;
pub const BYTE_ONE: u8 = 1;
pub const BYTE_TWO: u8 = 2;
pub const I32_ZERO: i32 = 0;
pub const I32_ONE: i32 = 1;
pub const F64_ONE_BILLION: f64 = 1_000_000_000.0;

/// Copies only a value whose actual Rust type implements Copy.
///
/// ```compile_fail
/// use ripgrep_native_support::machine::read_copy;
/// let value = String::from("not Copy");
/// let _ = read_copy(&value);
/// ```
pub fn read_copy<T: Copy>(value: &T) -> T {
    *value
}

pub fn read_copy_mut<T: Copy>(value: &mut T) -> T {
    *value
}

/// Assignment includes the actual old value's Drop behavior.
pub fn write_value<T>(place: &mut T, value: T) {
    *place = value;
}

/// Clone is an open trait call; it is not assumed pure or equivalent to Copy.
pub fn clone_value<T: Clone>(value: &T) -> T {
    value.clone()
}

/// Replaces the place with the actual T::default(), returning the previous value.
pub fn take_value<T: Default>(place: &mut T) -> T {
    std::mem::take(place)
}

/// Neither moved value is dropped by replace itself.
pub fn replace_value<T>(place: &mut T, value: T) -> T {
    std::mem::replace(place, value)
}

pub fn box_new<T>(value: T) -> Box<T> { Box::new(value) }
pub fn box_borrow<T: ?Sized>(value: &Box<T>) -> &T { value.as_ref() }
pub fn box_into_inner<T>(value: Box<T>) -> T { *value }

/// The callback result cannot depend on the freshly introduced borrow region.
///
/// ```compile_fail
/// use ripgrep_native_support::machine::with_borrow;
/// let value = String::from("owned");
/// let escaped = with_borrow(&value, |view| view);
/// println!("{escaped}");
/// ```
pub fn with_borrow<T: ?Sized, R, F>(value: &T, body: F) -> R
where
    F: for<'r> FnOnce(&'r T) -> R,
{
    body(value)
}

/// ```compile_fail
/// use ripgrep_native_support::machine::with_borrow_mut;
/// let mut value = vec![1_u8];
/// let escaped = with_borrow_mut(&mut value, |view| view);
/// escaped.push(2);
/// ```
pub fn with_borrow_mut<T: ?Sized, R, F>(value: &mut T, body: F) -> R
where
    F: for<'r> FnOnce(&'r mut T) -> R,
{
    body(value)
}

/// Temporarily shares an exclusive borrow; the exclusive place stays borrowed.
pub fn with_shared_borrow<T: ?Sized, R, F>(value: &mut T, body: F) -> R
where
    F: for<'r> FnOnce(&'r T) -> R,
{
    body(&*value)
}

pub fn borrow_shared<T: ?Sized>(value: &mut T) -> &T {
    &*value
}

pub fn usize_from_byte(value: u8) -> usize { usize::from(value) }
pub fn usize_equal(left: usize, right: usize) -> bool { left == right }
pub fn usize_less_equal(left: usize, right: usize) -> bool { left <= right }
pub fn usize_less(left: usize, right: usize) -> bool { left < right }
pub fn usize_add(left: usize, right: usize) -> usize { left + right }
pub fn usize_subtract(left: usize, right: usize) -> usize { left - right }
pub fn usize_checked_add(left: usize, right: usize) -> Option<usize> { left.checked_add(right) }
pub fn usize_decimal(value: usize) -> String { value.to_string() }
pub fn usize_as_u64(value: usize) -> u64 { value as u64 }

pub fn byte_equal(left: u8, right: u8) -> bool { left == right }
pub fn byte_greater(left: u8, right: u8) -> bool { left > right }
pub fn byte_divide(left: u8, right: u8) -> u8 { left / right }
pub fn byte_remainder(left: u8, right: u8) -> u8 { left % right }
pub fn byte_as_scalar(value: u8) -> char { char::from(value) }
pub fn char_equal(left: char, right: char) -> bool { left == right }
pub fn char_is_ascii(value: char) -> bool { value.is_ascii() }
/// This is the source's `as u8`; callers requiring ASCII first prove is_ascii.
pub fn ascii_char_to_byte(value: char) -> u8 { value as u8 }
pub fn byte_try_from_u32(value: u32) -> Result<u8, TryFromIntError> { u8::try_from(value) }
pub fn char_from_u32(value: u32) -> Option<char> { char::from_u32(value) }

pub fn word_and(left: u64, right: u64) -> u64 { left & right }
pub fn word_or(left: u64, right: u64) -> u64 { left | right }
pub fn word_not(value: u64) -> u64 { !value }
pub fn word_equal(left: u64, right: u64) -> bool { left == right }
pub fn word_shift_left(value: u64, shift: u8) -> u64 { value << shift }

pub fn u64_from_byte(value: u8) -> u64 { u64::from(value) }
pub fn u64_as_byte(value: u64) -> u8 { value as u8 }
pub fn u64_equal(left: u64, right: u64) -> bool { left == right }
pub fn u64_xor(left: u64, right: u64) -> u64 { left ^ right }
pub fn u64_wrapping_multiply(left: u64, right: u64) -> u64 { left.wrapping_mul(right) }
pub fn u64_greater(left: u64, right: u64) -> bool { left > right }
pub fn u64_add(left: u64, right: u64) -> u64 { left + right }
pub fn u64_divide(left: u64, right: u64) -> u64 { left / right }
pub fn u64_remainder(left: u64, right: u64) -> u64 { left % right }
pub fn u64_decimal(value: u64) -> String { value.to_string() }
pub fn u32_as_usize(value: u32) -> usize { value as usize }
pub fn u32_try_from_usize(value: usize) -> Result<u32, TryFromIntError> { u32::try_from(value) }

pub fn i32_equal(left: i32, right: i32) -> bool { left == right }
pub fn i32_add(left: i32, right: i32) -> i32 { left + right }
pub fn i32_decimal(value: i32) -> String { value.to_string() }
pub fn f64_from_u32(value: u32) -> f64 { f64::from(value) }
pub fn f64_from_u64(value: u64) -> f64 { value as f64 }
pub fn f64_add(left: f64, right: f64) -> f64 { left + right }
pub fn f64_divide(left: f64, right: f64) -> f64 { left / right }
pub fn f64_greater_equal(left: f64, right: f64) -> bool { left >= right }
pub fn f64_from_be_bytes(value: [u8; 8]) -> f64 { f64::from_be_bytes(value) }
pub fn bool_equal(left: bool, right: bool) -> bool { left == right }

pub fn byte_slice_length(value: &[u8]) -> usize { value.len() }
pub fn byte_slice_is_empty(value: &[u8]) -> bool { value.is_empty() }
pub fn byte_slice_first(value: &[u8]) -> Option<u8> { value.first().copied() }
pub fn byte_slice_get(value: &[u8], index: usize) -> Option<u8> { value.get(index).copied() }
pub fn byte_slice_index(value: &[u8], index: usize) -> u8 { value[index] }
pub fn byte_slice_last(value: &[u8]) -> Option<u8> { value.last().copied() }
pub fn byte_slice_range(value: &[u8], start: usize, end: usize) -> &[u8] { &value[start..end] }
pub fn byte_slice_range_mut(value: &mut [u8], start: usize, end: usize) -> &mut [u8] {
    &mut value[start..end]
}
pub fn byte_singleton_slice(value: &u8) -> &[u8] { std::slice::from_ref(value) }
pub fn byte_slice_to_vector(value: &[u8]) -> Vec<u8> { value.to_vec() }
/// Equality is exact UTF-8 byte equality; the caller's ASCII domain is narrower.
pub fn byte_slice_equals_ascii(value: &[u8], text: String) -> bool { value == text.as_bytes() }
pub fn byte_vector_new() -> Vec<u8> { Vec::new() }
pub fn byte_vector_clone(value: &Vec<u8>) -> Vec<u8> { value.clone() }
pub fn byte_vector_into_text(value: Vec<u8>) -> Result<String, FromUtf8Error> {
    String::from_utf8(value)
}
pub fn byte_vector_extend(value: &mut Vec<u8>, suffix: &[u8]) { value.extend_from_slice(suffix); }
pub fn byte_vector_push(value: &mut Vec<u8>, byte: u8) { value.push(byte); }
pub fn byte_vector_set(value: &mut Vec<u8>, index: usize, byte: u8) { value[index] = byte; }
pub fn byte_vector_as_slice(value: &Vec<u8>) -> &[u8] { value.as_slice() }
pub fn byte_array_fill<const N: usize>(byte: u8) -> [u8; N] { [byte; N] }
pub fn byte_array_set<const N: usize>(value: &mut [u8; N], index: usize, byte: u8) {
    value[index] = byte;
}
pub fn byte_array_as_slice<const N: usize>(value: &[u8; N]) -> &[u8] { value }

pub fn cow_bytes_from_borrowed(value: &[u8]) -> CowBytes<'_> { CowBytes::Borrowed(value) }
pub fn cow_bytes_from_owned<'r>(value: Vec<u8>) -> CowBytes<'r> { CowBytes::Owned(value) }
pub fn cow_bytes_empty_borrowed<'r>() -> CowBytes<'r> { CowBytes::Borrowed(&[]) }
/// Only the Borrowed variant may yield a view tied to the original data region.
pub fn cow_bytes_borrowed_view<'origin>(value: &CowBytes<'origin>) -> Option<&'origin [u8]> {
    match value {
        CowBytes::Borrowed(bytes) => Some(bytes),
        CowBytes::Owned(_) => None,
    }
}
/// The owned branch forces this view to be tied to the borrow of the Cow itself.
pub fn cow_bytes_view<'view>(value: &'view CowBytes<'_>) -> &'view [u8] { value.as_ref() }
pub fn cow_bytes_to_mut<'view>(value: &'view mut CowBytes<'_>) -> &'view mut Vec<u8> { value.to_mut() }
pub fn cow_bytes_clone<'origin>(value: &CowBytes<'origin>) -> CowBytes<'origin> { value.clone() }

pub fn vector_new<T>() -> Vec<T> { Vec::new() }
pub fn vector_clear<T>(value: &mut Vec<T>) { value.clear(); }
pub fn vector_push<T>(value: &mut Vec<T>, item: T) { value.push(item); }
pub fn vector_len<T>(value: &Vec<T>) -> usize { value.len() }
pub fn vector_get<T>(value: &Vec<T>, index: usize) -> Option<&T> { value.get(index) }
pub fn vector_index<T>(value: &Vec<T>, index: usize) -> &T { &value[index] }
pub fn vector_remove<T>(value: &mut Vec<T>, index: usize) -> T { value.remove(index) }
pub fn vector_pop<T>(value: &mut Vec<T>) -> Option<T> { value.pop() }
pub fn vector_iter<T>(value: &Vec<T>) -> VectorIter<'_, T> { value.iter() }
pub fn vector_iter_rev<T>(value: &Vec<T>) -> VectorIterRev<'_, T> { value.iter().rev() }
pub fn vector_into_iter<T>(value: Vec<T>) -> VectorIntoIter<T> { value.into_iter() }
pub fn vector_iter_next<'origin, T>(value: &mut VectorIter<'origin, T>) -> Option<&'origin T> {
    value.next()
}
pub fn vector_iter_rev_next<'origin, T>(value: &mut VectorIterRev<'origin, T>) -> Option<&'origin T> {
    value.next()
}

/// Item is the iterator's actual associated type, including any retained borrow.
pub fn iterator_next<I: Iterator + ?Sized>(value: &mut I) -> Option<I::Item> { value.next() }
pub fn into_iterator<I: IntoIterator>(value: I) -> I::IntoIter { value.into_iter() }
pub fn iterator_peekable<I: Iterator>(value: I) -> Peekable<I> { value.peekable() }
pub fn iterator_peek<I: Iterator>(value: &mut Peekable<I>) -> Option<&I::Item> { value.peek() }

pub fn usize_vector_extend(value: &mut Vec<usize>, suffix: &Vec<usize>) { value.extend(suffix); }
pub fn usize_vector_sort(value: &mut Vec<usize>) { value.sort(); }
pub fn usize_vector_sort_unstable(value: &mut Vec<usize>) { value.sort_unstable(); }
pub fn usize_vector_dedup(value: &mut Vec<usize>) { value.dedup(); }

pub fn build_hasher_default_new<H>() -> BuildHasherDefault<H> { BuildHasherDefault::new() }
pub fn hash_map_with_hasher<K, V, S>(hash_builder: S) -> HashMap<K, V, S> {
    HashMap::with_hasher(hash_builder)
}
pub fn hash_map_entry_or_insert<K, V, S>(value: &mut HashMap<K, V, S>, key: K, default: V) -> &mut V
where
    K: Eq + Hash,
    S: BuildHasher,
{
    value.entry(key).or_insert(default)
}

/// The returned borrow is tied to the map, independently of the lookup key.
///
/// ```compile_fail
/// use ripgrep_native_support::machine::*;
/// let escaped = {
///     let mut map = hash_map_with_hasher(std::collections::hash_map::RandomState::new());
///     hash_map_insert(&mut map, String::from("key"), 1);
///     hash_map_get(&map, "key").unwrap()
/// };
/// println!("{escaped}");
/// ```
pub fn hash_map_get<'map, K, V, S, Q: ?Sized>(value: &'map HashMap<K, V, S>, key: &Q) -> Option<&'map V>
where
    K: Eq + Hash + std::borrow::Borrow<Q>,
    Q: Eq + Hash,
    S: BuildHasher,
{
    value.get(key)
}
pub fn hash_map_get_mut<'map, K, V, S, Q: ?Sized>(value: &'map mut HashMap<K, V, S>, key: &Q) -> Option<&'map mut V>
where
    K: Eq + Hash + std::borrow::Borrow<Q>,
    Q: Eq + Hash,
    S: BuildHasher,
{
    value.get_mut(key)
}
pub fn hash_map_insert<K, V, S>(value: &mut HashMap<K, V, S>, key: K, item: V) -> Option<V>
where
    K: Eq + Hash,
    S: BuildHasher,
{
    value.insert(key, item)
}
pub fn hash_map_contains_key<K, V, S, Q: ?Sized>(value: &HashMap<K, V, S>, key: &Q) -> bool
where
    K: Eq + Hash + std::borrow::Borrow<Q>,
    Q: Eq + Hash,
    S: BuildHasher,
{
    value.contains_key(key)
}
pub fn hash_map_length<K, V, S>(value: &HashMap<K, V, S>) -> usize { value.len() }
pub fn hash_map_into_iter<K, V, S>(value: HashMap<K, V, S>) -> HashMapIntoIter<K, V> {
    value.into_iter()
}
pub fn option_borrow<T>(value: &Option<T>) -> Option<&T> { value.as_ref() }

pub fn text_as_str(value: &String) -> &str { value.as_str() }
pub fn text_new() -> String { String::new() }
pub fn text_push_str(value: &mut String, suffix: &str) { value.push_str(suffix); }
pub fn text_vector_join(value: &Vec<String>, separator: &str) -> String { value.join(separator) }
pub fn str_to_owned(value: &str) -> String { value.to_owned() }
pub fn str_byte_length(value: &str) -> usize { value.len() }
pub fn str_chars(value: &str) -> StrChars<'_> { value.chars() }
pub fn str_trim_start_matches<'view>(value: &'view str, pattern: &str) -> &'view str {
    value.trim_start_matches(pattern)
}
pub fn str_replace(value: &str, from: &str, to: &str) -> String { value.replace(from, to) }
pub fn text_clone(value: &String) -> String { value.clone() }
pub fn cow_str_as_str<'view>(value: &'view CowStr<'_>) -> &'view str { value.as_ref() }
pub fn str_to_scalars(value: &str) -> Vec<char> { value.chars().collect() }
pub fn str_trim_end(value: &str) -> &str { value.trim_end() }
pub fn str_starts_with(value: &str, prefix: String) -> bool { value.starts_with(prefix.as_str()) }
pub fn str_ends_with(value: &str, suffix: String) -> bool { value.ends_with(suffix.as_str()) }
pub fn str_contains(value: &str, needle: String) -> bool { value.contains(needle.as_str()) }
pub fn str_equal_text(value: &str, text: String) -> bool { value == text }
pub fn str_find(value: &str, needle: String) -> Option<usize> { value.find(needle.as_str()) }
pub fn str_drop_first_scalar(value: &str) -> &str {
    let mut chars = value.chars();
    chars.next();
    chars.as_str()
}
pub fn str_drop_last_scalar(value: &str) -> &str {
    let mut chars = value.chars();
    chars.next_back();
    chars.as_str()
}
pub fn text_starts_with(value: &String, prefix: String) -> bool { value.starts_with(prefix.as_str()) }
pub fn text_ends_with(value: &String, suffix: String) -> bool { value.ends_with(suffix.as_str()) }
pub fn text_replace(value: &String, from: String, to: String) -> String {
    value.replace(from.as_str(), to.as_str())
}
pub fn text_trim_start_matches(value: &String, pattern: String) -> String {
    value.trim_start_matches(pattern.as_str()).to_owned()
}
pub fn text_trim_end_unicode_whitespace(value: &String) -> String { value.trim_end().to_owned() }
pub fn text_utf8_bytes(value: &String) -> Vec<u8> { value.as_bytes().to_vec() }
pub fn str_range(value: &str, start: usize, end: usize) -> &str { &value[start..end] }
pub fn str_from_utf8(value: &[u8]) -> Result<&str, Utf8Error> { std::str::from_utf8(value) }
pub fn utf8_error_valid_up_to(value: Utf8Error) -> usize { value.valid_up_to() }
pub fn utf8_error_debug(value: Utf8Error) -> String { format!("{value:?}") }
pub fn parse_u32(value: &str) -> Result<u32, ParseIntError> { value.parse() }
pub fn char_display(value: char) -> String { value.to_string() }
pub fn char_debug(value: char) -> String { format!("{value:?}") }
pub fn text_debug(value: &String) -> String { format!("{value:?}") }

#[track_caller]
pub fn panic(message: String) -> ! { panic!("{message}") }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scoped_mutation_and_original_region_are_distinct() {
        let original = [1, 2, 3];
        let mut cow = cow_bytes_from_borrowed(&original);
        let retained_original = with_borrow(&cow, cow_bytes_borrowed_view).unwrap();
        with_borrow_mut(&mut cow, |place| {
            assert_eq!(with_shared_borrow(place, |view| cow_bytes_view(view).len()), 3);
            byte_vector_set(cow_bytes_to_mut(place), 1, 9);
        });
        assert_eq!(retained_original, &[1, 2, 3]);
        assert_eq!(cow_bytes_view(&cow), &[1, 9, 3]);
        assert!(cow_bytes_borrowed_view(&cow).is_none());
    }

    #[test]
    fn borrowed_views_preserve_storage_and_ranges() {
        let mut bytes = [3, 4, 5];
        let base = bytes.as_ptr();
        assert_eq!(byte_slice_range(&bytes, 1, 3).as_ptr(), base.wrapping_add(1));
        byte_slice_range_mut(&mut bytes, 1, 2)[0] = 7;
        assert_eq!(bytes, [3, 7, 5]);
        assert_eq!(byte_singleton_slice(&bytes[0]).as_ptr(), bytes.as_ptr());
        assert_eq!(byte_slice_get(&bytes, 3), None);
        assert_eq!(str_range("aé", 1, 3), "é");
        let unsized_view: Borrow<'_, str> = "é";
        assert_eq!(with_borrow(unsized_view, str::len), 2);
    }

    #[test]
    #[should_panic]
    fn str_range_rejects_non_boundary() { str_range("é", 1, 2); }

    #[test]
    fn machine_limits_and_standard_parse_are_preserved() {
        assert_eq!(usize_checked_add(usize::MAX, 1), None);
        assert_eq!(parse_u32("4294967295").unwrap(), u32::MAX);
        assert!(parse_u32("4294967296").is_err());
        assert_eq!(parse_u32("0000000000000000000000").unwrap(), 0);
        assert_eq!(i32_decimal(-1), "-1");
        assert_eq!(word_not(0), u64::MAX);
        assert_eq!(word_shift_left(1, 63), 1 << 63);
        assert_eq!(f64_from_be_bytes([0x3f, 0xd9, 0x99, 0x99, 0x99, 0x99, 0x99, 0x9a]), 0.4);
        assert!(f64_divide(0.0, 0.0).is_nan());
        assert!(!f64_greater_equal(f64::NAN, 0.4));
        assert_eq!(char_from_u32(0xD800), None);
        assert_eq!(byte_try_from_u32(255).unwrap(), 255);
        assert!(byte_try_from_u32(256).is_err());
        assert_eq!(u64_xor(0xF0, 0xCC), 0x3C);
        assert_eq!(u64_wrapping_multiply(u64::MAX, 2), u64::MAX - 1);
        assert_eq!(u32_try_from_usize(usize::MAX).is_err(), usize::BITS > 32);
    }

    #[test]
    fn unicode_views_do_not_use_byte_indices_as_scalar_indices() {
        let text = "é🦀";
        assert_eq!(str_drop_first_scalar(text), "🦀");
        assert_eq!(str_drop_last_scalar(text), "é");
        assert_eq!(str_drop_first_scalar(""), "");
        assert_eq!(str_drop_last_scalar(""), "");
        assert_eq!(str_trim_end("é\u{2003}"), "é");
        assert_eq!(str_find(text, String::from("🦀")), Some(2));
        assert_eq!(str_to_scalars(text), vec!['é', '🦀']);
        assert_eq!(str_byte_length(text), 6);
        let bom_line = "\u{FEFF}\u{FEFF}é";
        let trimmed = str_trim_start_matches(bom_line, "\u{FEFF}");
        assert_eq!(trimmed, "é");
        assert_eq!(trimmed.as_ptr(), bom_line.as_ptr().wrapping_add(6));
        assert_eq!(str_replace("~/é/~", "~", "/home/人"), "/home/人/é//home/人");
        let mut joined = text_new();
        text_push_str(&mut joined, "é");
        text_push_str(&mut joined, "/🦀");
        assert_eq!(joined, "é/🦀");
        assert_eq!(text_vector_join(&vec![String::from("a"), String::from("b")], "\n"), "a\nb");
    }

    #[test]
    fn array_and_vector_borrows_update_the_same_place() {
        let mut fixed = byte_array_fill::<20>(0);
        with_borrow_mut(&mut fixed, |place| byte_array_set(place, 19, 57));
        assert_eq!(byte_array_as_slice(&fixed)[19], 57);
        let mut values = vector_new();
        vector_push(&mut values, String::from("first"));
        vector_push(&mut values, String::from("last"));
        assert_eq!(vector_len(&values), 2);
        let mut backwards = vector_iter_rev(&values);
        assert_eq!(vector_iter_rev_next(&mut backwards).unwrap(), "last");
        assert_eq!(vector_iter_rev_next(&mut backwards).unwrap(), "first");
        assert!(vector_iter_rev_next(&mut backwards).is_none());
    }

    #[test]
    fn iterators_preserve_associated_owned_and_borrowed_items() {
        let values = vec![String::from("first"), String::from("second")];
        let mut borrowed = iterator_peekable(vector_iter(&values));
        let peeked: &&String = iterator_peek(&mut borrowed).unwrap();
        assert_eq!(peeked.as_str(), "first");
        let first: &String = iterator_next(&mut borrowed).unwrap();
        assert!(std::ptr::eq(first, &values[0]));
        let mut owned: VectorIntoIter<String> = vector_into_iter(values);
        let first: String = iterator_next(&mut owned).unwrap();
        assert_eq!(first, "first");
        let mut scalars = iterator_peekable(str_chars("é🦀"));
        assert_eq!(iterator_peek(&mut scalars), Some(&'é'));
        assert_eq!(iterator_next(&mut scalars), Some('é'));
        let mut chars = into_iterator(['a', 'b']);
        let erased: &mut dyn Iterator<Item = char> = &mut chars;
        assert_eq!(iterator_next(erased), Some('a'));
    }

    #[test]
    fn generic_maps_use_borrowed_keys_and_retain_the_map_region() {
        let mut map: HashMap<String, Vec<usize>, _> =
            hash_map_with_hasher(build_hasher_default_new::<std::hash::DefaultHasher>());
        assert!(hash_map_insert(&mut map, String::from("key"), vec![1]).is_none());
        hash_map_entry_or_insert(&mut map, String::from("key"), vec![99]).push(2);
        let retained = {
            let temporary_key = String::from("key");
            hash_map_get(&map, temporary_key.as_str()).unwrap()
        };
        assert_eq!(retained, &[1, 2]);
        hash_map_get_mut(&mut map, "key").unwrap().push(3);
        assert!(hash_map_contains_key(&map, "key"));
        assert_eq!(hash_map_length(&map), 1);
        let mut owned = hash_map_into_iter(map);
        let item: Pair<String, Vec<usize>> = iterator_next(&mut owned).unwrap();
        assert_eq!(item, (String::from("key"), vec![1, 2, 3]));
        assert!(iterator_next(&mut owned).is_none());

        let mut byte_keys = hash_map_with_hasher(std::collections::hash_map::RandomState::new());
        hash_map_insert(&mut byte_keys, vec![1_u8, 2], 7);
        assert_eq!(hash_map_get(&byte_keys, &[1_u8, 2][..]), Some(&7));
        assert_eq!(hash_map_get(&byte_keys, &[2_u8, 1][..]), None);

        // The standard constructors and consuming iterator impose no Hasher bound.
        struct NotAHasher;
        let empty: HashMap<(), (), NotAHasher> = hash_map_with_hasher(NotAHasher);
        assert_eq!(hash_map_length(&empty), 0);
        let _: HashMapIntoIter<(), ()> = hash_map_into_iter(empty);
        let _: BuildHasherDefault<NotAHasher> = build_hasher_default_new();
    }

    #[test]
    fn byte_text_conversion_preserves_invalid_input() {
        let mut bytes = byte_vector_new();
        byte_vector_extend(&mut bytes, "é".as_bytes());
        let cloned = byte_vector_clone(&bytes);
        byte_vector_set(&mut bytes, 0, 0xFF);
        assert_eq!(byte_vector_into_text(cloned).unwrap(), "é");
        assert_eq!(byte_vector_into_text(bytes).unwrap_err().into_bytes(), vec![0xFF, 0xA9]);
    }

    #[test]
    fn take_replace_and_clear_preserve_drop_ownership() {
        use std::cell::Cell;
        use std::rc::Rc;

        #[derive(Default)]
        struct Tracked(Option<Rc<Cell<usize>>>);

        impl Drop for Tracked {
            fn drop(&mut self) {
                if let Some(drops) = &self.0 { drops.set(drops.get() + 1); }
            }
        }

        let drops = Rc::new(Cell::new(0));
        let mut place = Tracked(Some(Rc::clone(&drops)));
        let old = take_value(&mut place);
        assert!(place.0.is_none());
        assert_eq!(drops.get(), 0);
        let default = replace_value(&mut place, old);
        drop(default);
        assert_eq!(drops.get(), 0);
        let mut values = vec![place, Tracked(Some(Rc::clone(&drops)))];
        let capacity = values.capacity();
        vector_clear(&mut values);
        assert!(values.is_empty());
        assert_eq!(values.capacity(), capacity);
        assert_eq!(drops.get(), 2);

        let boxed = box_new(Tracked(Some(Rc::clone(&drops))));
        assert!(box_borrow(&boxed).0.is_some());
        let recovered = box_into_inner(boxed);
        assert_eq!(drops.get(), 2);
        drop(recovered);
        assert_eq!(drops.get(), 3);
        let unsized_box: Box<str> = "é".into();
        assert_eq!(box_borrow(&unsized_box), "é");

        let mut numbers = vec![3, 1, 1];
        usize_vector_extend(&mut numbers, &vec![3, 2]);
        usize_vector_sort(&mut numbers);
        usize_vector_dedup(&mut numbers);
        assert_eq!(numbers, vec![1, 2, 3]);
    }
}
