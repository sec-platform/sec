//! Standard formatting operations with the original formatter and builder state.

pub use std::fmt::{DebugList, DebugStruct, DebugTuple, Formatter, Result as FormatResult};

pub fn write_text(formatter: &mut Formatter<'_>, value: &str) -> FormatResult {
    formatter.write_str(value)
}

/// Nested arguments use their own default format specifier.
pub fn write_usize(formatter: &mut Formatter<'_>, value: usize) -> FormatResult {
    write!(formatter, "{value}")
}

/// Nested formatting uses default flags; direct trait dispatch keeps the original formatter flags.
pub fn write_display<T: std::fmt::Display + ?Sized>(formatter: &mut Formatter<'_>, value: &T) -> FormatResult {
    write!(formatter, "{value}")
}

pub fn display_fmt<T: std::fmt::Display + ?Sized>(value: &T, formatter: &mut Formatter<'_>) -> FormatResult {
    std::fmt::Display::fmt(value, formatter)
}

pub fn display_to_text<T: std::fmt::Display + ?Sized>(value: &T) -> String {
    format!("{value}")
}

pub fn write_f64_fixed(formatter: &mut Formatter<'_>, value: f64, precision: usize) -> FormatResult {
    write!(formatter, "{value:.precision$}")
}

pub fn f64_fixed_to_text(value: f64, precision: usize) -> String {
    format!("{value:.precision$}")
}

/// A builder retains the exclusive formatter borrow; its regions cannot be erased.
///
/// ```compile_fail
/// use ripgrep_native_support::format::{debug_struct, DebugStruct, Formatter};
/// fn escape<'format, 'data>(value: &'format mut Formatter<'data>) -> DebugStruct<'static, 'data> {
///     debug_struct(value, "Escaped")
/// }
/// ```
pub fn debug_struct<'format, 'data>(formatter: &'format mut Formatter<'data>, name: &str) -> DebugStruct<'format, 'data> {
    formatter.debug_struct(name)
}

pub fn debug_struct_field<'builder, 'format, 'data, T: std::fmt::Debug>(
    builder: &'builder mut DebugStruct<'format, 'data>,
    name: &str,
    value: &T,
) -> &'builder mut DebugStruct<'format, 'data> {
    builder.field(name, value)
}

pub fn debug_struct_finish(builder: &mut DebugStruct<'_, '_>) -> FormatResult { builder.finish() }

pub fn debug_tuple<'format, 'data>(formatter: &'format mut Formatter<'data>, name: &str) -> DebugTuple<'format, 'data> {
    formatter.debug_tuple(name)
}

pub fn debug_tuple_field<'builder, 'format, 'data, T: std::fmt::Debug>(
    builder: &'builder mut DebugTuple<'format, 'data>,
    value: &T,
) -> &'builder mut DebugTuple<'format, 'data> {
    builder.field(value)
}

pub fn debug_tuple_finish(builder: &mut DebugTuple<'_, '_>) -> FormatResult { builder.finish() }

pub fn debug_list<'format, 'data>(formatter: &'format mut Formatter<'data>) -> DebugList<'format, 'data> {
    formatter.debug_list()
}

pub fn debug_list_entry<'builder, 'format, 'data, T: std::fmt::Debug>(
    builder: &'builder mut DebugList<'format, 'data>,
    value: &T,
) -> &'builder mut DebugList<'format, 'data> {
    builder.entry(value)
}

pub fn debug_list_entries<'builder, 'format, 'data, I>(
    builder: &'builder mut DebugList<'format, 'data>,
    values: I,
) -> &'builder mut DebugList<'format, 'data>
where
    I: IntoIterator,
    I::Item: std::fmt::Debug,
{
    builder.entries(values)
}

pub fn debug_list_finish(builder: &mut DebugList<'_, '_>) -> FormatResult { builder.finish() }

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use std::fmt::{self, Debug, Display};

    #[expect(dead_code, reason = "derived Debug is the independent formatting oracle")]
    #[derive(Debug)]
    struct DerivedTuple(u32);

    struct NativeTuple(u32);

    impl Debug for NativeTuple {
        fn fmt(&self, formatter: &mut Formatter<'_>) -> FormatResult {
            let mut builder = debug_tuple(formatter, "DerivedTuple");
            debug_tuple_field(&mut builder, &self.0);
            debug_tuple_finish(&mut builder)
        }
    }

    #[expect(dead_code, reason = "derived Debug is the independent formatting oracle")]
    #[derive(Debug)]
    struct DerivedStruct {
        text: String,
        pair: DerivedTuple,
    }

    struct NativeStruct {
        text: String,
        pair: NativeTuple,
    }

    impl Debug for NativeStruct {
        fn fmt(&self, formatter: &mut Formatter<'_>) -> FormatResult {
            let mut builder = debug_struct(formatter, "DerivedStruct");
            debug_struct_field(&mut builder, "text", &self.text);
            debug_struct_field(&mut builder, "pair", &self.pair);
            debug_struct_finish(&mut builder)
        }
    }

    struct NativeList(Vec<NativeStruct>);

    impl Debug for NativeList {
        fn fmt(&self, formatter: &mut Formatter<'_>) -> FormatResult {
            let mut builder = debug_list(formatter);
            debug_list_entries(&mut builder, self.0.iter());
            debug_list_finish(&mut builder)
        }
    }

    #[test]
    fn builders_retain_standard_debug_flags_and_nested_values() {
        let native = NativeList(vec![NativeStruct {
            text: String::from("é\n\""),
            pair: NativeTuple(31),
        }]);
        let standard = vec![DerivedStruct {
            text: String::from("é\n\""),
            pair: DerivedTuple(31),
        }];
        assert_eq!(format!("{native:?}"), format!("{standard:?}"));
        assert_eq!(format!("{native:#?}"), format!("{standard:#?}"));
        assert_eq!(format!("{native:#x?}"), format!("{standard:#x?}"));
    }

    struct LiteralText;

    impl Display for LiteralText {
        fn fmt(&self, formatter: &mut Formatter<'_>) -> FormatResult { write_text(formatter, "abc") }
    }

    struct Decimal;

    impl Display for Decimal {
        fn fmt(&self, formatter: &mut Formatter<'_>) -> FormatResult { write_usize(formatter, 12) }
    }

    struct Fixed(f64, usize);

    impl Display for Fixed {
        fn fmt(&self, formatter: &mut Formatter<'_>) -> FormatResult {
            write_f64_fixed(formatter, self.0, self.1)
        }
    }

    struct FlagProbe;

    impl Display for FlagProbe {
        fn fmt(&self, formatter: &mut Formatter<'_>) -> FormatResult {
            write!(formatter, "{}", formatter.width().unwrap_or(0))
        }
    }

    struct ForwardProbe;

    impl Display for ForwardProbe {
        fn fmt(&self, formatter: &mut Formatter<'_>) -> FormatResult { display_fmt(&FlagProbe, formatter) }
    }

    struct NestedProbe;

    impl Display for NestedProbe {
        fn fmt(&self, formatter: &mut Formatter<'_>) -> FormatResult { write_display(formatter, &FlagProbe) }
    }

    #[test]
    fn nested_numeric_arguments_do_not_inherit_outer_flags() {
        assert_eq!(format!("{:>9.1}", LiteralText), "abc");
        assert_eq!(format!("{:08.1}", Decimal), "12");
        let value = Fixed(2.005, 2);
        assert_eq!(format!("{:0>20.1}", value), format!("{:.2}", value.0));
        assert_eq!(f64_fixed_to_text(f64::INFINITY, 4), format!("{:.4}", f64::INFINITY));
        assert_eq!(f64_fixed_to_text(f64::NAN, 4), format!("{:.4}", f64::NAN));
        assert_eq!(format!("{:>8}", ForwardProbe), "8");
        assert_eq!(format!("{:>8}", NestedProbe), "0");
        assert_eq!(display_to_text(&FlagProbe), "0");
    }

    struct Fail;

    impl Debug for Fail {
        fn fmt(&self, _: &mut Formatter<'_>) -> FormatResult { Err(fmt::Error) }
    }

    struct Count<'a>(&'a Cell<usize>);

    impl Debug for Count<'_> {
        fn fmt(&self, formatter: &mut Formatter<'_>) -> FormatResult {
            self.0.set(self.0.get() + 1);
            formatter.write_str("counted")
        }
    }

    struct FailThenCount<'a>(&'a Cell<usize>);

    impl Debug for FailThenCount<'_> {
        fn fmt(&self, formatter: &mut Formatter<'_>) -> FormatResult {
            let mut builder = debug_list(formatter);
            debug_list_entry(&mut builder, &Fail);
            debug_list_entry(&mut builder, &Count(self.0));
            debug_list_finish(&mut builder)
        }
    }

    #[test]
    fn builder_errors_stop_later_debug_effects() {
        let count = Cell::new(0);
        let mut output = String::new();
        let result = fmt::write(&mut output, format_args!("{:?}", FailThenCount(&count)));
        assert!(result.is_err());
        assert_eq!(count.get(), 0);
    }
}
