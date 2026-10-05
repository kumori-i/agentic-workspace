# Development roadmap

## v0.1 — Desktop foundation (implemented)

Own application window, original pixel office, four agent identities, local simulated task queue, dependency ordering, review controls, saved progress, and desktop checks.

## v0.2 — One real Codex worker

1. Add a typed app-server process adapter in Electron's trusted process with protocol negotiation and structured event parsing.
2. Verify supported ChatGPT authentication locally. Reuse the user's existing Codex configuration where supported; introduce no app account. Never copy another app's credentials.
3. Detect the CLI and present accurate availability/authentication state.
4. Create a worker thread, stream its messages/tool activity, interrupt it, and restore it by thread ID. Map failed/interrupted turns honestly.
5. Run a bounded task in an isolated worktree of an explicitly selected Git repository. Keep the main checkout untouched.
6. Verify against a harmless fixture repository using a user's local Codex session; no API key is required by the app's default plan.

## v0.3 — Manager and independent review

Convert a structured manager plan into dependency-aware worker tasks. Route implementation and review separately, collect diffs and actual test results, then prepare a human-reviewed Git handoff. Limit concurrency, preserve task IDs across restarts, and record actual usage events when supplied by Codex. Do not turn simulated verification messages into real assertions.

## v0.4 — Extensible departments

User-configured departments, temporary workers, skills/tools, permission policies, recoverable failures, and richer local event storage. Model providers can be optional adapters; Codex with ChatGPT authentication is the first target.

## Release work

Verify on macOS and Windows; choose the repository license; create an original application icon; configure signing/notarization where appropriate; publish installers and migration instructions. A cloud environment remains a development tool, while users run their own desktop runtime.
