//! Standard panic/unwrap/assertion semantics without product decisions.

pub use super::machine::panic;

#[track_caller]
pub fn assert_option_usize_equal(left: Option<usize>, right: Option<usize>) {
    assert_eq!(left, right);
}

#[track_caller]
pub fn unwrap_error<E: std::fmt::Debug>(error: E) -> ! {
    match Result::<std::convert::Infallible, E>::Err(error).unwrap() {}
}
