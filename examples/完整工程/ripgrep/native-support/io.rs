//! Narrow bindings to the standard IO types and operations used by authors.
//!
//! Names referring to traits and names referring to callable operations are
//! distinct; all trait and error identities remain those of the standard lib.

pub use std::fs::File;
pub use std::io::{BufRead, BufReader, Error, ErrorKind, Lines, Read, Stdin, StdinLock, Write};

pub type StaticError = dyn std::error::Error + 'static;

pub fn buf_reader_new<R: Read>(reader: R) -> BufReader<R> { BufReader::new(reader) }

pub fn buf_read_lines<R: BufRead>(reader: R) -> Lines<R> { reader.lines() }

pub fn lines_next<R: BufRead>(lines: &mut Lines<R>) -> Option<Result<String, Error>> {
    lines.next()
}

pub fn file_open(path: &std::path::Path) -> Result<File, Error> { File::open(path) }

pub fn write_bytes<W: Write + ?Sized>(writer: &mut W, bytes: &[u8]) -> Result<usize, Error> {
    writer.write(bytes)
}

pub fn flush<W: Write + ?Sized>(writer: &mut W) -> Result<(), Error> { writer.flush() }

pub fn read_to_end<R: Read + ?Sized>(reader: &mut R, output: &mut Vec<u8>) -> Result<usize, Error> {
    reader.read_to_end(output)
}

pub fn stdin() -> Stdin { std::io::stdin() }

pub fn stdin_lock(stdin: &Stdin) -> StdinLock<'static> { stdin.lock() }

pub fn other_error<E: std::error::Error + Send + Sync + 'static>(error: E) -> Error {
    Error::new(ErrorKind::Other, error)
}

pub fn other_message(message: String) -> Error { Error::new(ErrorKind::Other, message) }

pub fn new_message(kind: ErrorKind, message: String) -> Error { Error::new(kind, message) }

pub fn error_display(error: &Error) -> String { error.to_string() }

#[allow(deprecated)]
pub fn error_description(error: &Error) -> &str { std::error::Error::description(error) }

pub fn raw_os_error(error: &Error) -> Option<i32> { error.raw_os_error() }

pub fn from_raw_os_error(code: i32) -> Error { Error::from_raw_os_error(code) }

pub fn kind(error: &Error) -> ErrorKind { error.kind() }
