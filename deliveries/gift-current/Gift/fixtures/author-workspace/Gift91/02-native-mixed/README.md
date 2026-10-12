# Studio Native / Gift 91 — mixed-source example（历史研究说明）

This is a small IDE **algorithm and interface subset** illustrating real native author ownership, not a functioning IDE or completed VS Code equivalent.

- `src/**/*.ts`: **the only writable implementation source** for edit algorithm, undo history, extension-host state machine, remote session and FilePort interface.
- `design/requirements.module.json`: independent product author-definition shell (the two finite conditions in this fixture impose no behavioral Rule; they are explicitly not a correctness proof).
- `gift.project.json`: registration of source scopes and the one structured Gift module. Native TS files are not duplicated in `modules` or converted into JSON AST.
- `package.json`/`tsconfig.json`: remain authoritative native toolchain configuration.
- `assets/theme.json`: native JSON asset; its keys are interpreted by the hypothetical app code, not by Gift Core.
- `gift.lock.json`: intentionally absent; no Gift dependency/semantic/Target binding actually ran.

No actual UI, remote transport, host process, disk Provider, build distribution or runtime is supplied. The FilePort interface has no implementation. The TypeScript source is not semantically linked by a published native adapter to Gift Requirements in this fixture. It is a source-ownership specimen, not an independently executable IDE.
