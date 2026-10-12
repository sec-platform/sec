# `gift.lock.json` deliberately absent in both example projects（历史研究说明）

A valid `gift.binding-lock/1` must contain `schema`, `projectId`, `resolutionInputs`, `bindings`, `nodes`, optional `extensions`. A node contains `kind`, `subjectId`, `revision`, `content`, `dependencies`; `content` must carry algorithm, digest, length, and format over **actually fetched immutable bytes**. Binding keys are actual import/language/target use occurrences.

Do not fill a fake `sha256`, a made-up `revision`, or a mutable `latest`. A version string `"1"` in a module's `dialects` is only a published constraint selector; absent the exact language content this project is a **design fixture / UNRESOLVED_LANGUAGE_BINDING**, not a reproducible build. Git/Cargo/npm locks are separate and remain authoritative for their native ecosystems.

The first legitimate `gift.lock.json` must be emitted by a real resolver from accepted fixed inputs, then checked by a separate reader. A missing lock is not a request to fetch current latest silently.
