# Agentic Workspace

A standalone desktop application that represents an agent workflow as a small, animated pixel office. Electron opens its own application window; React supplies the controls and Phaser renders original, procedurally drawn artwork.

![Desktop simulation preview](docs/office-preview.png)

## Run locally

Install Node.js **24 or newer**, clone this repository, then run:

```sh
npm ci
npm run dev
```

This opens the desktop application directly. No application account, hosting service, API key, or browser tab is needed. Interface changes reload during development; restart the command after changing desktop or engine code.

For the production build:

```sh
npm start
```

## What works in v0.2

- An original, detailed pixel office with 32×48 character frames, textured furnishings, plants, layered lighting, four clickable agents, movement, work animations, zoom, and camera panning.
- A manager, frontend developer, backend developer, and QA reviewer.
- Task briefs and a queue. Planning releases two simulated implementation jobs; QA waits for both; the task then awaits your review.
- Approval, change requests, cancellation, pause/resume, a task board, and an activity feed.
- Native project folder selection. Simulation never reads or changes the selected project's files.
- Local task history and progress, saved atomically in Electron's application-data directory. In-progress work reopens paused.
- An isolated desktop renderer and a narrow, validated IPC bridge.
- A live Codex mode with one real developer, streamed messages and tool output, model selection, explicit command/file approvals, interruption, and revisions in the same thread.
- A unique Git branch and isolated worktree for each live task, plus a local diff inspector and native worktree folder opener. Branches and files remain available after cancellation or review.

**Simulation mode** remains available without Codex or authentication. Its worker messages, verification, and progress percentages are demonstrations. **Codex mode** shows actual output from one developer; the other three roles remain idle. There is no automated manager or independent QA worker yet. Live tasks use phase labels rather than invented progress percentages.

There is no app account. Live inference uses your existing Codex CLI with ChatGPT authentication and that account's usage allowance. API-key and other billing modes are disabled in this milestone.

## Use a live Codex worker

Install Git and the Codex CLI. The adapter is checked against Codex **0.160.0**:

```sh
npm install -g @openai/codex@0.160.0
codex login
```

If your CLI is already signed in with ChatGPT, reuse that sign-in. The app never reads or copies authentication files. Open the desktop app, select **Codex** in the top bar, choose a Git repository with at least one commit, then **Connect Codex**. Settings lets you select the executable if it is absent from the app's PATH, and choose a model from the actual connected catalog. On Windows, use the native `codex.exe` when an npm command shim cannot launch directly.

Submit a task and release **Hold queue**. Each task starts from committed HEAD in a separate worktree under the app's local data directory. Uncommitted files and ignored dependencies in your original checkout are not copied. Project selection cannot retarget already queued live tasks.

Codex runs with workspace-write isolation and network access disabled by default. Requested command/file approvals appear in the inspector. Approve or decline them explicitly. Unsupported interactions are declined and recorded in Activity.

When Codex finishes, use **Inspect changes** and read its reported checks. **Mark reviewed** records your review; it does not merge or push. **Request changes** resumes the same Codex thread and worktree using your feedback. **Interrupt** preserves edits. Hold queue stops new tasks from launching; an active turn continues until interrupted. Restarting the app disconnects Codex, holds the queue, and records unfinished runs as interrupted so they only resume explicitly.

Worktrees are intentionally retained. Reset clears the selected mode's task history, including its worktree links, while leaving Git branches and folders on disk. Copy any paths you need before clearing live history. To integrate reviewed changes yourself, open the worktree, inspect or commit them, and merge the retained task branch using your normal Git workflow.

## Verify

```sh
npm run check
npm run smoke
```

`check` runs TypeScript, simulation, persistence, protocol-fixture, real-Git isolation, and live-runtime lifecycle checks, followed by the production build. These automated tests never spend model usage. `smoke` boots the desktop app and checks its renderer, pixel canvas, IPC bridge, disconnected Codex controls, simulation pause, review, rework, and cancellation. Run `npm run build` first if using `smoke` separately. Linux environments without a display can use `xvfb-run -a npm run smoke`; the CI workflow demonstrates this setup.

The v0.2 implementation passes 67 tests, TypeScript, the production build, and the Linux desktop smoke check. The preview above was captured from that Electron window.

## Package

```sh
npm run package
```

Electron Builder creates an installer for the current operating system in `release/`. Build macOS releases on macOS and Windows releases on Windows. These are unsigned development packages; signing, notarization, and release publishing are future work. The initial implementation is tested on Linux, not yet on physical macOS or Windows machines.

## Codex Cloud

The cloud environment is a development workspace for this repository. Use `bash scripts/cloud-setup.sh` to install dependencies and check the code. It does not host the users' desktop apps.

Read [AGENTS.md](AGENTS.md) before making changes. [Architecture](docs/architecture.md) describes the current boundaries; [roadmap](docs/roadmap.md) outlines the real Codex adapter and worktree milestones.

## Repository map

```text
src/desktop/        Electron lifecycle, preload, IPC, local persistence
src/core/           Deterministic simulated workflow engine
src/shared/         Serializable state and desktop bridge contracts
src/renderer/       React interface and original Phaser artwork
tests/              Workflow, persistence, Codex protocol, Git, and runtime verification
scripts/            Build, launch, and cloud environment setup
```

All pixel art is defined in `src/renderer/world/OfficeWorld.tsx`. No third-party character sheets or office artwork are included. A project license has not been selected yet.
