//! Exact standard Duration identity and operations; overflow follows std.

pub use std::time::Duration;

pub const DURATION_ZERO: Duration = Duration::ZERO;

pub fn duration_add(left: Duration, right: Duration) -> Duration { left + right }

pub fn duration_equal(left: Duration, right: Duration) -> bool { left == right }

pub fn duration_as_secs(value: Duration) -> u64 { value.as_secs() }

pub fn duration_subsec_nanos(value: Duration) -> u32 { value.subsec_nanos() }
