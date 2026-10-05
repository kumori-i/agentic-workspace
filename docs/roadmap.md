# Development roadmap

## v0.1 — Desktop foundation (implemented)

Own application window, original pixel office, four agent identities, local simulated task queue, dependency ordering, review controls, saved progress, and desktop checks.

## v0.2 — One real Codex worker (implemented)

Local app-server transport, managed ChatGPT authentication, actual model catalog, one developer thread, streamed items, command/file approvals, interruption, explicit resume, isolated Git worktrees, bounded diff review, native folder opening, and durable ownership records. Simulation remains available separately. Office art now uses detailed 32×48 characters and richer original furnishings.

Automated protocol/runtime fixtures and real-Git tests cover lifecycle and isolation. Actual account/model discovery is verified against Codex 0.160.0. Full live inference validation depends on the installed CLI's thread startup and sandbox availability; see the pull request's validation results. No independent QA, automatic merge, or multi-worker inference is claimed.

## v0.3 — Manager and independent review

Convert a structured manager plan into dependency-aware worker tasks. Route implementation and review separately, collect diffs and actual test results, then prepare a human-reviewed Git handoff. Limit concurrency, preserve task IDs across restarts, and record actual usage events when supplied by Codex. Do not turn simulated verification messages into real assertions.

## v0.4 — Extensible departments

User-configured departments, temporary workers, skills/tools, permission policies, recoverable failures, and richer local event storage. Model providers can be optional adapters; Codex with ChatGPT authentication is the first target.

## Release work

Verify on macOS and Windows; choose the repository license; create an original application icon; configure signing/notarization where appropriate; publish installers and migration instructions. A cloud environment remains a development tool, while users run their own desktop runtime.
