# Development roadmap

## v0.1 — Desktop foundation (implemented)

Own application window, original pixel office, four agent identities, local simulated task queue, dependency ordering, review controls, saved progress, and desktop checks.

## v0.2 — One real Codex worker (implemented)

Local app-server transport, managed ChatGPT authentication, actual model catalog, one developer thread, streamed items, command/file approvals, interruption, explicit resume, isolated Git worktrees, bounded diff review, native folder opening, and durable ownership records. Simulation remains available separately. Office art now uses detailed 32×48 characters and richer original furnishings.

Automated protocol/runtime fixtures and real-Git tests cover lifecycle and isolation. Actual account/model discovery is verified against Codex 0.160.0. Full live inference validation depends on the installed CLI's thread startup and sandbox availability; see the pull request's validation results. This milestone established the developer transport and worktree ownership used by v0.3.

## v0.3 — Independent review and confirmed Git handoff (implemented)

Mira coordinates Rowan → Quinn → user confirmation. Quinn opens a fresh read-only Codex thread in Rowan’s existing worktree, returns structured findings/checks, and approves a specific Git tree. Manager/reviewer controls operate on the selected task, preserving its identity. User confirmation commits, merges into the project’s checked-out branch, and pushes to its chosen existing remote. Stale reviews/plans stop publication. Conflicts and failed pushes preserve partial commits; recovery never pushes automatically. Real Git and Codex fixtures cover the handoff; actual live inference remains subject to the installed CLI startup limitation.

## Next — Structured manager planning

Convert a structured manager plan into dependency-aware implementation tasks, support concurrent workers, select their roles explicitly, and record usage events when supplied by Codex. Keep implementation/review ownership distinct. Do not present simulated verification as model output.

## v0.4 — Extensible departments

User-configured departments, temporary workers, skills/tools, permission policies, recoverable failures, and richer local event storage. Model providers can be optional adapters; Codex with ChatGPT authentication is the first target.

## Release work

Verify on macOS and Windows; choose the repository license; create an original application icon; configure signing/notarization where appropriate; publish installers and migration instructions. A cloud environment remains a development tool, while users run their own desktop runtime.
