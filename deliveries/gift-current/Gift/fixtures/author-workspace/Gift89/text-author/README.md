# IDE-like Gift author source (design example)（历史研究说明）

This is a **source-language design specimen** for Gift 89. It is NOT an implementation of VS Code and has not been compiled by Gift.

- `gift.project.json` uses the existing `gift.project/1` shell with a **new, opt-in** project extension `gift.author-text/1` (only designed, not implemented).
- `src/editor`, `src/extensions`, `src/remote` contain Gift 88-style pure type/function designs. `src/platform/files.gift` declares an unbound host capability; it **does not** read or write actual files.
- `src/spec/studio.gift` exercises the proposed strongly typed `gift/author` static Definition/Requirement authoring library; that library and static evaluator **do not ship with this package**.
- There is deliberately no `gift.lock.json`, because no resolver has produced actual frozen bindings; and no `targets` or `generated/`, because no target engine was run or claimed to be available.
- The sample is an illustrative **subset** of an IDE-class project, not a full IDE (there is no renderer, terminal, language-service host, complete extension runtime, packaging, etc.). Those must be supplied by other author modules/libraries/realizations and correctly checked for the requested goal.

In the distributed `Gift89-真实源码工程范本.zip`, compare this `text-author-project/` with the sibling `structural-author-project/`: the latter uses the existing `gift.author-module/1` fields, not a writable mirror of this project.
