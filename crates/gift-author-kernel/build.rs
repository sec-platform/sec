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
    output.push_str("pub const RULE_CAPTURE: &[(&str, &[u8])] = &[\n");
    for path in ["crates/gift-author-kernel/Cargo.lock", "crates/gift-author-kernel/Cargo.toml", "crates/gift-author-kernel/build.rs",
        "crates/gift-author-kernel/src/lib.rs", "crates/gift-author-kernel/src/model.rs",
        "crates/gift-author-kernel/src/source.rs", "crates/gift-author-kernel/src/grammar.rs",
        "crates/gift-author-kernel/src/reader.rs", "crates/gift-author-kernel/src/expansion.rs",
        "crates/gift-author-kernel/src/reference_slots.rs", "crates/gift-author-kernel/src/binding.rs",
        "crates/gift-author-kernel/src/lexical.rs", "crates/gift-author-kernel/src/semantic_types.rs",
        "crates/gift-author-kernel/src/header_seeds.rs", "crates/gift-author-kernel/src/type_constraints.rs",
        "crates/gift-author-kernel/src/body_analysis.rs", "crates/gift-author-kernel/src/effect_analysis.rs",
        "crates/gift-author-kernel/src/signature_resolution.rs", "crates/gift-author-kernel/src/captured_input.rs",
        "crates/gift-author-kernel/src/project_input.rs", "schema/source/binding-lock-1.schema.json"] {
        let absolute=root.join(path).canonicalize().expect("compiled rule input exists");
        assert!(absolute.starts_with(root.canonicalize().unwrap()));
        println!("cargo:rerun-if-changed={}",absolute.display());
        output.push_str(&format!("({path:?}, include_bytes!({:?})),\n",absolute.to_str().unwrap()));
    }
    output.push_str("];\n");
    fs::write(PathBuf::from(env::var_os("OUT_DIR").unwrap()).join("grammar_capture.rs"), output).unwrap();
}
