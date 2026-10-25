// Fixed ordinary-value expectations authored independently of the Gift AST.
// Compile against the locked ripgrep memchr dependency. This is a portable
// byte-slice test, not a Unix filesystem or production Gift compiler test.
#[path = "../methods/P/path_policy.rs"]
mod p;
#[path = "../methods/Q/path_policy.rs"]
mod q;

type Policy = for<'a> fn(&'a [u8]) -> Option<&'a [u8]>;
type Vector = (&'static [u8], Option<&'static [u8]>, Option<&'static [u8]>);

const VECTORS: &[Vector] = &[
    (b"", None, None),
    (b".", None, None),
    (b"..", None, None),
    (b"...", None, Some(b"...")),
    (b"a", Some(b"a"), Some(b"a")),
    (b"a/b", Some(b"b"), Some(b"b")),
    (b"file.", None, Some(b"file.")),
    (b".foo.", None, Some(b".foo.")),
    (b"a/.foo..", None, Some(b".foo..")),
    (b"a/.", None, None),
    (b"a/..", None, None),
    (b"/", Some(b""), Some(b"")),
    (b"a/", Some(b""), Some(b"")),
    (b"a//b", Some(b"b"), Some(b"b")),
    (b"a/.foo", Some(b".foo"), Some(b".foo")),
    (b"/a/b/..", None, None),
    (b"a/.../", Some(b""), Some(b"")),
    (b"a\\b.", None, Some(b"a\\b.")),
    (b"a/.\xff.", None, Some(b".\xff.")),
    (b"\xff", Some(b"\xff"), Some(b"\xff")),
    (b".\0", Some(b".\0"), Some(b".\0")),
    (b"a/\xc3\xa9.", None, Some(b"\xc3\xa9.")),
];

fn check(policy: Policy, checkpoint: usize) {
    for (input, expected_p, expected_q) in VECTORS {
        let expected = if checkpoint == 0 { *expected_p } else { *expected_q };
        // Use a fresh owning input to avoid pointer equality with literal data.
        let input = input.to_vec();
        let actual = policy(&input);
        assert_eq!(actual, expected, "input: {input:?}");
        if let (Some(actual), Some(expected)) = (actual, expected) {
            let offset = input.len() - expected.len();
            assert_eq!(actual.as_ptr(), input[offset..].as_ptr(), "borrowed suffix");
        }
    }
}

#[test]
fn p_values_and_borrowed_suffix() {
    check(p::file_name, 0);
}

#[test]
fn q_values_and_borrowed_suffix() {
    check(q::file_name, 1);
}
