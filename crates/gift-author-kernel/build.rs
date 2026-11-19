//! Embed the existing declared grammar inputs, never a separately maintained schema bundle.
use std::{collections::BTreeSet, env, fs, path::{Component, Path, PathBuf}};

fn is_link(metadata:&fs::Metadata)->bool {
    #[cfg(windows)] {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))] {metadata.file_type().is_symlink()}
}

/// Capture this fixed implementation domain, including newly added modules.
/// Native execution separately proves it equals the issued and protected input
/// set; this build script neither interprets Git ignores nor issues that proof.
fn collect_rule_sources(root:&Path,directory:&Path,paths:&mut BTreeSet<String>) {
    let metadata=fs::symlink_metadata(directory).expect("rule source directory exists");
    assert!(metadata.is_dir()&&!is_link(&metadata),"rule source directory must be ordinary");
    println!("cargo:rerun-if-changed={}",directory.display());
    for entry in fs::read_dir(directory).expect("rule source membership is readable") {
        let path=entry.expect("rule source entry is readable").path();
        let metadata=fs::symlink_metadata(&path).expect("rule source entry exists");
        assert!(!is_link(&metadata),"rule source domain cannot contain links");
        if metadata.is_dir() {collect_rule_sources(root,&path,paths);}
        else {
            assert!(metadata.is_file(),"rule source entry must be an ordinary file");
            let relative=path.strip_prefix(root).expect("rule source stays in repository")
                .to_str().expect("rule source path must be UTF-8").replace('\\',"/");
            if relative.ends_with(".rs") {paths.insert(relative);}
        }
    }
}

fn main() {
    let root = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap()).join("../..").canonicalize().expect("repository root exists");
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
    let mut rule_paths=BTreeSet::from([
        "crates/gift-author-kernel/Cargo.lock".to_owned(), "crates/gift-author-kernel/Cargo.toml".to_owned(),
        "crates/gift-author-kernel/build.rs".to_owned(), "schema/source/binding-lock-1.schema.json".to_owned()]);
    collect_rule_sources(&root,&root.join("crates/gift-author-kernel/src"),&mut rule_paths);
    for path in rule_paths {
        let absolute=root.join(&path).canonicalize().expect("compiled rule input exists");
        assert!(absolute.starts_with(root.canonicalize().unwrap()));
        println!("cargo:rerun-if-changed={}",absolute.display());
        output.push_str(&format!("({path:?}, include_bytes!({:?})),\n",absolute.to_str().unwrap()));
    }
    output.push_str("];\n");
    fs::write(PathBuf::from(env::var_os("OUT_DIR").unwrap()).join("grammar_capture.rs"), output).unwrap();
}
