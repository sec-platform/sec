//! Embed the existing declared grammar inputs, never a separately maintained schema bundle.
use std::{env, fs, path::{Component, Path, PathBuf}};

fn main() {
    let root = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap()).join("../..");
    let manifest = "schema/author/first-layer/codec-parameters.json";
    let parameters: serde_json::Value = serde_json::from_slice(&fs::read(root.join(manifest)).unwrap()).unwrap();
    let mut paths = vec![manifest.to_owned()];
    for list in ["resources", "externals"] {
        for item in parameters[list].as_array().expect("declared grammar resources") {
            paths.push(item["path"].as_str().expect("resource path").to_owned());
        }
    }
    let mut output = String::from("pub const CAPTURE: &[(&str, &[u8])] = &[\n");
    for path in paths {
        assert!(Path::new(&path).components().all(|part| matches!(part, Component::Normal(_))), "grammar inputs must be repository relative");
        let absolute = root.join(&path).canonicalize().expect("grammar input exists");
        assert!(absolute.starts_with(root.canonicalize().unwrap()), "grammar input escapes repository");
        println!("cargo:rerun-if-changed={}", absolute.display());
        output.push_str(&format!("({path:?}, include_bytes!({:?})),\n", absolute.to_str().unwrap()));
    }
    output.push_str("];\n");
    fs::write(PathBuf::from(env::var_os("OUT_DIR").unwrap()).join("grammar_capture.rs"), output).unwrap();
}
