---
name: SEC CI and Merge
description: Skill for handling PR integration, merging, and post-merge branch hygiene.
---
# SEC CI and Merge Skill (Playbook)

## 1. Concrete Squash Merge Execution
When a PR has passed all required tests and is ready to enter `main`, DO NOT use the GitHub UI merge button if it creates merge commits. Execute a precise Squash merge locally:
```powershell
# 1. Fetch latest main
git fetch origin main

# 2. Check out your feature branch (if not already)
git checkout <your-branch>

# 3. Soft reset to the tip of main to squash all commits
git reset --soft origin/main

# 4. Commit with a unified message
git commit -m "feat(scope): concrete description (#PR_NUMBER)"

# 5. Force push to update the PR head
git push -f origin <your-branch>
```
Then use `gh pr merge <PR_NUMBER> --squash --delete-branch`.

## 2. Post-Merge Branch Hygiene (Garbage Collection)
Immediately after the code is safely in `main`, you MUST clean up the workspace:
```powershell
# Close the PR if it wasn't merged by CLI
gh pr close <PR_NUMBER>

# Close any related issues
gh issue close <ISSUE_NUMBER>

# Delete the remote tracking branch
git push origin --delete <branch_name>

# Checkout main and pull
git checkout main
git pull origin main

# Delete the local branch
git branch -D <branch_name>
```
Do NOT leave stale branches like `validation/case-XX` or `feat/old-stuff` locally or remotely. If a branch is abandoned, delete it immediately.
