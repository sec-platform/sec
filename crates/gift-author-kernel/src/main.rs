//! Host transport only: bounded stdin -> pure compiler -> stdout. No project I/O or tool launch.
use std::io::{self, Read, Write};
use gift_author_kernel::{MAX_SOURCE_BYTES, compile};

fn main() {
    let mut bytes = Vec::new();
    let result = io::stdin().take((MAX_SOURCE_BYTES + 1) as u64).read_to_end(&mut bytes)
        .map_err(|error| gift_author_kernel::model::fail("InputFailure", "", error.to_string()))
        .and_then(|_| compile(&bytes));
    let (output, code) = match result {
        Ok(compilation) => (serde_json::to_vec(&compilation), 0),
        Err(diagnostic) => (serde_json::to_vec(&serde_json::json!({"schema":"gift.author-compilation-failure/1", "diagnostic":diagnostic})), 1),
    };
    match output {
        Ok(mut output) => {
            output.push(b'\n');
            if io::stdout().lock().write_all(&output).is_err() { std::process::exit(2); }
        }
        Err(_) => std::process::exit(2),
    }
    std::process::exit(code);
}
