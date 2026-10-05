# Desktop architecture

Electron owns the window, filesystem, Git commands, and Codex child process. React presents serializable snapshots; Phaser translates agent states into destinations and animations. Rendering never advances tasks or makes model calls.

## Two runtimes

`WorkspaceEngine` remains a deterministic, credential-free simulation. Its manager plans, frontend/backend jobs run concurrently, QA waits for both, and human review releases the next task. Pausing freezes simulated time.

`CodexRuntime` hosts one real developer. It creates an isolated worktree, creates or resumes a Codex thread, starts a turn, normalizes streamed items, routes approvals, and waits for actual turn completion before human review. It uses phase labels; no simulated testing or model percentage is presented as real. Other office workers stay idle until independent live roles are implemented.

Live mode's Hold queue prevents new launches without suspending the active turn. Review blocks subsequent tasks until the user marks it reviewed, requests changes, or cancels it. Failed and interrupted turns hold the queue. Revisions reuse the retained thread and worktree. Cancellation interrupts Codex while retaining files. Configuration cannot change during an active launch or turn, and queued tasks prevent repository retargeting.

## Codex protocol

`CodexClient` launches an installed CLI with `spawn`, `shell: false`, and JSONL stdio. It negotiates initialization, requests `account/read`, and reads the paginated model catalog. Only managed ChatGPT authentication is accepted; API credential environment variables are omitted. Auth files and account email never enter app state. Credentials remain owned by Codex.

Thread configuration explicitly selects the OpenAI provider, `workspace-write`, user-reviewed `on-request` approvals, and the task worktree. Turns set the writable root to that worktree and disable network access. Command/file approval requests reach the user; unsupported interactions receive an explicit refusal and Activity entry. The app does not automatically approve requests.

Requests have bounded timeouts; thread startup has a longer initialization allowance. UTF-8 JSONL parsing has bounded buffers. Death, malformed protocol, changed authentication, and ambiguous timeout reject pending requests and terminate the transport. Thread/turn identity checks ignore unrelated notifications. Actual messages, command output/exit codes, and file-change status are retained as bounded local events. Process stderr is drained without exposing authentication diagnostics.

## Git worktrees

`GitWorktreeService` uses native Git argument arrays without a shell. A committed HEAD is required. Task worktrees live under the app's local data directory on unique `agentic/task-…` branches. Source checkout changes and ignored dependencies remain in the source checkout. Git hooks, filesystem monitors, external diff commands, and text conversion are disabled for app-owned Git operations.

Before inspection, the service verifies the canonical managed directory, worktree registry, branch, common Git directory, and base commit. Diffs include committed and uncommitted tracked changes against the recorded base, plus bounded untracked text. Binary and symlink contents are omitted. Review output reports truncation. The native folder opener accepts only validated task ownership metadata.

Mark reviewed records a decision and leaves the branch intact. The app never automatically merges, pushes, fetches, resets, or removes worktrees.

## Persistence and restart

Simulation and live history use separate validated JSON files in Electron's application-data directory. Files are written with private permissions through a temporary file, fsync, and atomic replacement. State is bounded and normalized to known fields; pending approvals are never restored.

Live ownership metadata is saved before model execution. Shutdown waits for an in-flight worktree checkpoint and closes the child before the final save. Restoring live history disconnects Codex, holds the queue, and converts unfinished active runs to interrupted. Resume requires an explicit user action. Clearing live history retains worktree folders and branches but removes their UI links.

## Desktop boundary

Production assets load from the confined `workspace://app` protocol. The renderer has sandboxing and context isolation enabled and Node integration disabled. Every IPC operation checks the exact main frame, sender, and arguments. Native pickers select projects and executables; renderer-supplied paths cannot launch programs or open arbitrary folders. Arbitrary navigation, new windows, webviews, and renderer permissions are blocked.

## Verification

Protocol fixtures cover message framing, auth rejection, approvals, process death, and timeouts without model usage. Real temporary Git repositories cover worktree ownership and file isolation. Runtime fixtures cover durable checkpoints, review/revisions, failure, interruption, and restart. The Electron smoke check verifies the actual desktop UI and disconnected-mode controls in Linux CI. Physical macOS and Windows checks remain release work.
