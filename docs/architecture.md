# Desktop architecture

Electron owns the window and local workspace. Its main process hosts a deterministic simulated task engine and persists state as validated JSON, using a write-to-temporary-file followed by atomic replacement. The preview uses JSON to avoid adding a native database dependency before the schema stabilizes. SQLite remains an option for the real runtime's task/event history.

The renderer receives a snapshot through a narrow preload bridge. React presents tasks and agents; Phaser translates agent statuses into destinations, movement, and animation. The world has no model calls and cannot advance the workflow.

## Simulation lifecycle

One top-level task is active at a time. Others queue until the active task is approved or cancelled. The manager plans for two simulated seconds. Frontend and backend jobs then run concurrently for six and eight seconds; QA runs for four seconds after both complete. Human review waits indefinitely. Requesting changes starts another iteration; approval completes the simulation and releases the next queued task.

Pause freezes workflow progress. Restored in-progress tasks start paused so work never silently advances while the app is closed. Approving or cancelling an existing task is still an explicit human action. Progress reaches 100% only after approval.

The engine bounds retained task/event history. Idle avatars animate locally but consume no model inference. Snapshot copies prevent the renderer from mutating engine state.

## Desktop boundary

Production assets load through the secure `workspace://app` protocol, confined to the built renderer directory. The renderer is sandboxed with Node integration disabled and context isolation enabled. IPC validates the invoking frame and arguments. New windows, permissions, arbitrary navigation, and webviews are blocked.

Project selection uses a native folder picker. In this milestone, the project path is metadata only. The app does not inspect, execute, or edit the selected project.

## Runtime extension

The future runtime should produce normalized events: task planning, worker started, message received, tool activity, approval required, turn completed, and failure. Mechanical orchestration belongs in code; reasoning belongs in Codex threads. The simulated runtime should remain usable for testing the office without inference.

Credentials belong to the local trusted runtime, never React state, project files, or logs. Starting real work must explicitly target a selected repository and isolated Git worktree. Reviews must come from independent task context rather than the implementation worker's private transcript.
