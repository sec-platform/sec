# Studio Design / Gift 91 — structured author-source sample（历史研究说明）

This project **is a genuine source-shape example**, not a working IDE and not an executed Gift build.

- `gift.project.json`: declares the actual project identity, semantic author scopes, module paths and no target request.
- `design/*.module.json`: directly authored reusable Composite definitions and finite composition terms.
- `targets: {}` means no target is requested. There is intentionally no `gift.lock.json` because no Gift resolution ran.
- `RetryPolicy`, `HistoryPolicy` and `LoggingPolicy` are **composites with parameters but no Rule terms**. Their names and values **do not force an implementation to retry, persist history, or log**. These are named composition wiring examples only.
- `any` and `exists` only describe finite alternatives; no chosen implementation or certified optimum is contained here.

For real IDE semantics, separate `RequirementDefinition` rule bodies, observation, Type and Method contracts must be obtained. Their complete published codecs are not present in Gift 90, so this fixture intentionally does not invent a lock or pretend all IDE requirements are satisfied.
