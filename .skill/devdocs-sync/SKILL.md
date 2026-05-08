---
name: devdocs-sync
description: "Sync documentation after code changes. Use docs/index.md to locate affected docs and keep them consistent with the codebase. Activate when the user mentions code changes that need doc updates, or asks to refresh/sync documentation."
---

# Devdocs Sync

## Goal

Keep project documentation in sync with code changes:
- detect which docs are affected by a code change
- update doc content to match the current code (APIs, config, signatures, etc.)
- preserve existing doc format and structure
- never modify code files — only docs

## Inputs to ask for (if missing)

- Which code changed? (file paths, git diff, or a description)
- Scope: single doc update or full sync across all affected docs?
- Any docs that should be explicitly excluded?

## Workflow (checklist)

### 1) Identify code changes

- If the user provides specific files or a description, use that.
- Otherwise, run `git diff` (unstaged) or `git diff --cached` (staged) to capture recent changes.
- If the diff is large (>500 lines), ask the user to narrow the scope.
- If the diff is empty, report "no code changes detected" and stop.

Extract from the diff:
- New/modified API routes, methods, parameters, response fields
- Changed protocol fields or serialization formats
- New/modified config keys, env vars, or defaults
- Changed function signatures or class interfaces
- Removed or deprecated features

### 2) Locate affected docs

1. Read `docs/index.md` — it maps code areas to their documentation files.
2. Cross-reference changed code paths against the index to find candidate docs.
3. Also check `README.md` if the change affects project-level features, setup, or usage.

If `docs/index.md` does not exist or has no mapping for the changed code:
- Prompt the user to create/update `docs/index.md` with the mapping.
- Do not proceed until the mapping is available.

### 3) Analyze and plan updates

For each affected doc:
- Read the current doc content.
- Compare doc claims (endpoints, params, examples, config keys) against the actual code.
- Identify stale, missing, or incorrect sections.
- Plan the minimal set of edits needed — do not rewrite the entire doc.

### 4) Preview changes

Show the user a preview before making any edits:
- Which docs will be modified.
- A summary of what changes in each doc (add / update / remove).
- If the change is large, show a diff-style preview of the key sections.

### 5) Confirm and apply

- Ask: "Apply these doc updates?"
- On confirmation, apply the edits and report a summary.
- If the user rejects, discard the plan.

## Edge cases

| Scenario | Action |
|----------|--------|
| No code changes detected | Report and stop. |
| `docs/index.md` missing | Prompt user to create it; stop until resolved. |
| Changed code has no matching doc | Suggest creating a new doc entry in `docs/index.md`. |
| Doc format is unparseable | Warn the user and ask how to proceed. |
| README is affected | Always include it in the preview. |

## Deliverable

Provide:
- a list of updated docs with file paths
- a summary of what changed per doc (added / updated / removed)
- the commands used to detect changes (e.g., `git diff --stat`)

## Example

```
Doc sync complete

Change: POST /api/users — added `phone` parameter

Updated:
  README.md           — added phone to the user creation example
  docs/api/users.md   — added phone field to request params table
```
