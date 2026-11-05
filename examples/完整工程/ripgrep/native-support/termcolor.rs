//! Re-export locked termcolor identities; these constants are actual variants.

pub use ::termcolor::{ColorChoice, ColorSpec, HyperlinkSpec, WriteColor};

pub const ALWAYS: ColorChoice = ColorChoice::Always;
pub const ALWAYS_ANSI: ColorChoice = ColorChoice::AlwaysAnsi;
pub const AUTO: ColorChoice = ColorChoice::Auto;
pub const NEVER: ColorChoice = ColorChoice::Never;
