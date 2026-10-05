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

## What works in v0.1

- An original pixel office with four clickable agents, movement, work animations, zoom, and camera panning.
- A manager, frontend developer, backend developer, and QA reviewer.
- Task briefs and a queue. Planning releases two simulated implementation jobs; QA waits for both; the task then awaits your review.
- Approval, change requests, cancellation, pause/resume, a task board, and an activity feed.
- Native project folder selection. Simulation never reads or changes the selected project's files.
- Local task history and progress, saved atomically in Electron's application-data directory. In-progress work reopens paused.
- An isolated desktop renderer and a narrow, validated IPC bridge.

**The first version is a simulation.** Worker messages, verification, and completion are demonstrated workflow states, not real model output or generated code. No Codex process or model request is launched. Settings labels Codex integration as not connected; CLI detection is deferred.

There is no app account. Real Codex workers, once implemented, will need the user's existing Codex/ChatGPT authentication to use that user's allowance.

## Verify

```sh
npm run check
npm run smoke
```

`check` runs TypeScript checks, engine and persistence tests, and the production build. `smoke` boots the built desktop app and checks its renderer, pixel canvas, IPC bridge, pause, review, rework, and cancellation. Run `npm run build` first if using `smoke` separately. Linux environments without a display can use `xvfb-run -a npm run smoke`; the CI workflow demonstrates this setup. All 21 tests, the production build, and the Linux desktop smoke check passed for the foundation implementation.

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
tests/              Workflow and persistence verification
scripts/            Build, launch, and cloud environment setup
```

All pixel art is defined in `src/renderer/world/OfficeWorld.tsx`. No third-party character sheets or office artwork are included. A project license has not been selected yet.
