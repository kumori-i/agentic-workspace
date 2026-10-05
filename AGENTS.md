# Development instructions

Build a local desktop app, with its own window and no application account. Keep the repository runnable with `npm ci` and `npm run dev`. Use Node24 or newer. Do not introduce a hosted backend or require an API billing account for the preview.

## Boundaries

- `src/core` owns workflow state. It must remain deterministic and independent of Electron, React, Phaser, and model credentials.
- `src/shared/types.ts` is the renderer/desktop contract. Keep IPC payloads serializable.
- `src/desktop` owns filesystem operations and future process execution. Validate IPC arguments and sender frames. Keep context isolation and the renderer sandbox enabled.
- `src/renderer/world` renders snapshots; animation must not change task state or trigger model calls.
- `src/renderer` must label simulations clearly. Do not claim a test, model run, patch, PR, or budget value is real unless it comes from a real runtime event.
- Preserve the original procedural artwork. Do not copy another project's assets.

## Checks

Run `npm run check` for implementation changes. Run `npm run smoke` after desktop or renderer changes, from a machine with a display or Xvfb. On isolated Linux CI runners, the smoke command uses `--no-sandbox` only as a test-launch flag; do not put that flag in the normal app launcher or disable `sandbox: true` in BrowserWindow.

Never commit generated build outputs, local workspace state, credentials, or `node_modules`. Keep the npm lockfile checked in. Use the roadmap for scope: real Codex execution and Git worktrees are the next milestone, not already implemented functionality.
