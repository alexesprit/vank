---
name: general-development
description: Use for implementing, debugging, or refactoring code in this project; prefer test-first changes and require a dedicated code-reviewer agent review.
---

# General development

Use this skill for general code changes in Vank. Follow the repository structure, style, and test commands in `AGENTS.md`.

## Workflow

- Trace the relevant flow and callers before editing. Keep the change focused and reuse existing helpers.
- Use TDD whenever practical: add a focused test that fails for the reported behavior, make the smallest change that passes, then refactor if useful. Prefer offline Vitest tests and fixtures.
- This project has no Playwright setup. Do not add browser tests or introduce Playwright just to complete a task. Test underlying logic where possible; for behavior that can only be verified in a browser, report the unautomated check clearly.
- Run the relevant tests and checks from `AGENTS.md` before calling implementation complete.
- For every code change, request a review from a dedicated `code-reviewer` agent before reporting completion. Give it the user request, changed files, and diff. Resolve actionable findings, rerun affected checks, and request a follow-up review for fixes. If no reviewer agent is available, state that review remains incomplete.

Advice-only, read-only, and documentation-only tasks do not require TDD or code review.
