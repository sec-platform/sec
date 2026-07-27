---
name: SEC A0 Integrator
description: Master skill for the A0 Integrator role in SEC. Responsible for DAG management, task allocation, verifying PR conditions, and issuing repository dispatches.
---
# SEC A0 Integrator Skill (Playbook)

## 1. Context Capsule Definition
Do not create random text files. You distribute work by feeding the Worker a strictly scoped Task Envelope in your prompt:
```markdown
## Task Envelope
- **Issue/Goal**: ...
- **Current Base**: origin/main
- **Branch**: feat/xxx
- **Ownership/Forbidden**: You may only touch `platform/xxx`, DO NOT touch `docs/xxx`.
- **Required Acceptance**: ...
```

## 2. Dispatching CI (The Frozen Point)
When a Worker finishes and reports `READY_FOR_INTEGRATION`:
1. **DO NOT** trigger normal pushes or `run-quick` labels.
2. Calculate the verification payload properties (exact head, base, digest).
3. Trigger Scope Attestation via GitHub API:
```powershell
gh api repos/{owner}/{repo}/dispatches -f event_type=sec-scope-attest-v1
```
4. Trigger Heavy Verification:
```powershell
gh api repos/{owner}/{repo}/dispatches -f event_type=sec-verify-frozen-v1 -F client_payload[profile]=quick
```
(Replace `{owner}/{repo}` with actual values from `document-control-plane.ts` output).

## 3. Handling `STOP_PROOF_RESET`
If a Worker returns `STOP_PROOF_RESET` after 2 candidate invalidations:
1. `git reset --hard origin/main`
2. Stop the current branch, redefine the Task Envelope, and restart from the failing invariant reproduction.
