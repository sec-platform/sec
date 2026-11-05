//! Re-export locked Serde's real traits only when the feature is selected.

#![cfg(feature = "serde")]

pub use ::serde::{Serialize, Serializer};
pub use ::serde::ser::SerializeStruct;
