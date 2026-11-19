//! Target spelling only. Author names, binding identities and Text values are
//! unchanged; installed Rust toolchain acceptance is a separate obligation.
use crate::{binding::Budget,model::{Diagnostic,fail}};

pub(crate) struct RustIdentifier {
    pub spelling:String,
    /// The represented Rust identifier, excluding the raw syntax prefix.
    pub key:String,
    /// The codec's Unicode tables do not qualify an arbitrary rustc version.
    pub needs_unicode_conformance:bool,
}

/// `name` is the exact author name or an explicitly supplied target name, not
/// a caller-authored token fragment. Rust keywords use the native raw syntax.
pub(crate) fn identifier(name:&str,path:&str,budget:&mut Budget)->Result<RustIdentifier,Diagnostic> {
    budget.work(name.len().saturating_mul(2).saturating_add(1))?;
    budget.charge(name.len().saturating_mul(12).saturating_add(256))?;
    let missing=||fail("NeedsRustNameMapping",path,"The selected public name requires an explicit valid NFC Rust name mapping");
    if !unicode_normalization::is_nfc(name) {return Err(missing());}
    let spelling=format!("r#{name}");
    let parsed=syn::parse_str::<proc_macro2::Ident>(&spelling).map_err(|_|missing())?;
    // Parsing ignores whitespace/comments. They cannot silently change the
    // identity of the complete name supplied by the author or target mapping.
    if parsed.to_string()!=spelling {return Err(missing());}
    Ok(RustIdentifier {spelling,key:name.to_owned(),needs_unicode_conformance:!name.is_ascii()})
}

pub(crate) fn text_literal(value:&str,budget:&mut Budget)->Result<String,Diagnostic> {
    // Reserve expansion and token/string allocation before invoking the codec.
    budget.work(value.len().saturating_mul(2).saturating_add(1))?;
    budget.charge(value.len().saturating_mul(12).saturating_add(256))?;
    Ok(proc_macro2::Literal::string(value).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rust_syntax_preserves_name_identity_and_exposes_only_local_unicode_obligations() {
        let mut budget=Budget::new();
        let keyword=identifier("match","/export",&mut budget).unwrap();
        assert_eq!(keyword.spelling,"r#match");assert_eq!(keyword.key,"match");
        assert!(!keyword.needs_unicode_conformance);
        let unicode=identifier("名字","/export",&mut budget).unwrap();
        assert_eq!(unicode.key,"名字");assert!(unicode.needs_unicode_conformance);
        for name in ["","_","self","Self","super","crate","x y","x/*comment*/","x ","x-y","e\u{301}","r#match"] {
            let error=identifier(name,"/exact-public-name",&mut budget).err().expect(name);
            assert_eq!(error.code,"NeedsRustNameMapping");assert_eq!(error.path,"/exact-public-name");
        }
    }

    #[test]
    fn rust_syntax_consumes_the_original_budget_before_token_allocation() {
        let mut name_budget=Budget::new();name_budget.tighten(1000,8);
        assert_eq!(identifier("ordinary","/name",&mut name_budget).err().unwrap().code,"ResourceLimit");
        let mut text_budget=Budget::new();text_budget.tighten(1000,8);
        assert_eq!(text_literal("\0\n\"e\u{301}",&mut text_budget).unwrap_err().code,"ResourceLimit");
    }
}
