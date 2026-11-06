//! Host transport only: bounded stdin -> pure compiler -> stdout. No project I/O or tool launch.
use std::io::{self, Read, Write};
use gift_author_kernel::{MAX_SOURCE_BYTES, compile, reader, model::fail};

fn main() {
    let mut bytes = Vec::new();
    let arguments:Vec<_>=std::env::args_os().skip(1).collect();
    let read_only=arguments.len()==1&&arguments[0]=="--read";
    let result = io::stdin().take((MAX_SOURCE_BYTES + 1) as u64).read_to_end(&mut bytes)
        .map_err(|error| gift_author_kernel::model::fail("InputFailure", "", error.to_string()))
        .and_then(|_| {
            if !arguments.is_empty()&&!read_only { return Err(fail("InputFailure","","Expected no argument or --read")); }
            if read_only { reader::read(&bytes).and_then(|v|v.output()).and_then(|v|serde_json::to_vec(&v).map_err(|e|fail("OutputFailure","",e.to_string()))) }
            else { compile(&bytes).and_then(|v|serde_json::to_vec(&v).map_err(|e|fail("OutputFailure","",e.to_string()))) }
        }).and_then(|output| {
            if output.len() >= reader::MAX_OUTPUT_BYTES { Err(fail("ResourceLimit","","Author result exceeds the transport budget")) }
            else { Ok(output) }
        });
    let (output, code) = match result {
        Ok(output) => (Ok(output), 0),
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
