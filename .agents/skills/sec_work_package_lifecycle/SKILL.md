---
name: SEC Work Package Lifecycle
description: Skill for managing SEC documentation control planes, starting work packages, and archiving them.
---
# SEC Work Package Lifecycle Skill (Playbook)

## 1. Status Retrieval (Mandatory First Step)
To retrieve the current engineering state, you MUST execute exactly:
```bash
bun scripts/codex/document-control-plane.ts status --json
```
If the command fails (exit code 1), fix the drift before proceeding. The output contains `repository.defaultRefState`, `workspace`, and `github` statuses.

## 2. Opening a Work Package
When tasked with starting a new package:
1. Create `docs/work-packages/<id>.md` using this exact Frontmatter schema:
```yaml
---
schema: sec-work-package-manifest-v1
status: draft
last-reviewed: YYYY-MM-DD
---
```
2. **Calculate the SHA256 Git Blob Digest**. You MUST use this exact command to avoid CRLF mismatch:
```powershell
git show :docs/work-packages/<id>.md | bun -e "const chunks = []; process.stdin.on('data', c => chunks.push(c)); process.stdin.on('end', () => console.log('sha256:' + require('crypto').createHash('sha256').update(Buffer.concat(chunks)).digest('hex')));"
```
3. Update `docs/work/active-work-package.md` YAML block with the exact output from the step above:
```yaml
selectionMode: exact-manifest-not-on-default-branch-v1
defaultBranchRef: refs/remotes/origin/main
defaultRefFreshness: live-platform-match-required
manifest: docs/work-packages/<id>.md
manifestDigest: sha256:<the-calculated-digest>
digestBytes: git-blob
unavailableDefaultRef: unresolved
matchingDefaultBlob: none
```

## 3. Closing and Archiving a Work Package
To retire an active package:
1. `git mv docs/work-packages/<id>.md docs/archive/work-packages/<id>.md`
2. Reset `docs/work/active-work-package.md` to `none` (or point to the next active plan).
3. Update `docs/work/rolling-plan.md` to remove the package.

## 4. Documentation Verification
After any changes to the `docs/` tree, you MUST verify integrity:
```bash
bun run docs:doctor
```
If you see `[ERROR] work-packages/<id>.md (stale-work-package)`, you failed to archive a package. You must move it to `docs/archive/`.
