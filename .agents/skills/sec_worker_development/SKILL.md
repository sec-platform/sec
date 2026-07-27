---
name: SEC Worker Development
description: Skill for the SEC Developer/Worker role. Enforces the 10-step delivery path, focused testing, and returning exact Reconciliation Deltas.
---
# SEC Worker Development Skill (Playbook)

## 1. Concrete 10-Step Execution Commands
Follow this sequence to implement tasks:
1. Reload context: `bun scripts/codex/document-control-plane.ts status --json`
2. Implement exact capability on the `feat/`, `fix/`, or `refactor/` branch.
3. Run ONLY focused validation: `bun test tests/unit/<target>.test.ts`
4. Re-calculate affected tests: `bun run check:affected --plan`
5. Run the affected union: `bun run check:affected` (do NOT run local risk unprompted).
6. Stage exact diff: `git add <files>`
7. Freeze imports: 
```powershell
$env:SEC_IMPORTS_CHANGED_ONLY="1"
$env:SEC_CHANGED_BASE="origin/main"
bun run imports:check
```
8. Commit: `git commit -m "feat(module): description"`
9. Push: `git push -u origin <branch>`
10. Halt execution and provide the Reconciliation Delta (see below).

## 2. Failure Refreeze (Strict Constraints)
If a test fails, you may perform **exactly ONE** refreeze (fix and commit). If it fails twice, you MUST revert and output `STOP_PROOF_RESET`.
Do NOT run `check:full` locally unless explicitly designated for a release.

## 3. Reconciliation Delta Payload
When halting to hand over to A0 or ending your turn, your final message MUST include a JSON block formatted exactly as follows:
```json
{
  "tested_head": "<git rev-parse HEAD>",
  "tested_base": "<git merge-base origin/main HEAD>",
  "changed_files": ["<list of changed files>"],
  "metrics": {
    "inspect_ms": <approx milliseconds spent inspecting>,
    "implement_ms": <approx ms spent implementing>,
    "focused_validation_ms": <approx ms spent validating>,
    "wait_ms": <approx ms spent waiting for tasks>,
    "reconcile_ms": <approx ms spent closing out>
  },
  "counters": {
    "context_reload_count": <number of times state was fetched>,
    "duplicate_gate_count": <number of repeated tests>,
    "tool_call_count": <number of tool calls made>,
    "candidate_invalidation_count": <number of test failures>
  },
  "next_ready_seam": "<what A0 should schedule next>"
}
```
