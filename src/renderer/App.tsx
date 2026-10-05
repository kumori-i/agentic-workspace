import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { Agent, AgentId, DesktopInfo, PublicationTargets, Task, WorktreeInspection, WorkspaceSnapshot } from '../shared/types';
import { OfficeWorld } from './world/OfficeWorld';

type View = 'office' | 'tasks' | 'activity';
type Glyph = 'office' | 'tasks' | 'activity' | 'folder' | 'plus' | 'pause' | 'play' | 'settings' | 'arrow' | 'close' | 'check' | 'branch';
function Icon({ name, size = 18 }: { name: Glyph; size?: number }) {
  const paths: Record<Glyph, ReactNode> = {
    office: <path d="M3 21V7l9-4 9 4v14M8 21v-6h8v6M7 9h1m8 0h1M7 12h1m8 0h1" />,
    tasks: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V2h6v2M9 9h6M9 13h6M9 17h4" /></>,
    activity: <path d="M2 12h5l3-8 4 16 3-8h5" />,
    folder: <path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11H3V7Z" />,
    plus: <path d="M12 5v14M5 12h14" />,
    pause: <path d="M8 5v14M16 5v14" />,
    play: <path d="m8 4 12 8-12 8Z" />,
    settings: <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" /><circle cx="15" cy="17" r="3" /></>,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    check: <path d="m5 12 4 4L19 6" />,
    branch: <><circle cx="6" cy="5" r="2" /><circle cx="18" cy="6" r="2" /><circle cx="6" cy="19" r="2" /><path d="M6 7v10m0-3c0-5 12-2 12-6" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function Avatar({ agent, small = false }: { agent: Agent; small?: boolean }) {
  const colors: Record<AgentId, { hair: string; light: string; skin: string; skinShade: string; shirtShade: string }> = {
    manager: { hair: '#524838', light: '#78664b', skin: '#e7bba0', skinShade: '#c58c77', shirtShade: '#768e67' },
    frontend: { hair: '#5c403b', light: '#875c4b', skin: '#ecc2a5', skinShade: '#cb957e', shirtShade: '#6689ad' },
    backend: { hair: '#342f35', light: '#51464a', skin: '#bd896f', skinShade: '#925f53', shirtShade: '#a48250' },
    qa: { hair: '#94705d', light: '#ba9473', skin: '#e5b694', skinShade: '#bd8b72', shirtShade: '#9580aa' },
  };
  const palette = colors[agent.id];
  return <span className={`avatar ${small ? 'small' : ''}`} style={{ background: `${agent.color}16` }}><svg viewBox="0 0 32 40" shapeRendering="crispEdges" aria-hidden="true">
    <path fill="#29332c" d="M9 2h14v2h3v15h-3v3H9v-3H6V5h3Z" />
    {agent.id === 'qa' && <path fill={palette.hair} d="M4 6h5v9H3V8h1Zm20-3h5v8h-5Z" />}
    <path fill={palette.hair} d="M9 3h14v2h2v13H7V6h2Z" />
    <path fill={palette.light} d="M10 4h11v2H9v3H8V6h2Z" />
    <path fill={palette.skinShade} d="M9 10h15v8h-2v3H11v-3H9Z" />
    <path fill={palette.skin} d="M10 9h12v8h-2v3h-8v-3h-2Z" />
    <path fill={palette.hair} d="M9 7h14v3h-4V9h-5v3h-4v-2H9Z" />
    <path fill="#2f332e" d="M12 13h2v2h-2Zm7 0h2v2h-2Z" />
    <path fill={palette.skinShade} d="M16 14h1v3h-2v-1h1Z" />
    <path fill="#a97664" d="M14 18h4v1h-4Z" />
    {agent.id === 'manager' && <path fill="#554b3a" d="M10 12h5v4h-5Zm7 0h6v4h-6Zm-2 1h2v1h-2Z" />}
    {agent.id === 'manager' && <path fill={palette.skin} d="M11 13h3v2h-3Zm7 0h4v2h-4Z" />}
    <path fill="#29332c" d="M11 21h11v2h4v3h2v10H5V26h2v-3h4Z" />
    <path fill={palette.shirtShade} d="M9 24h15v2h2v9H7v-9h2Z" />
    <path fill={agent.color} d="M10 23h12v3h2v7H9V26h1Z" />
    <path fill={palette.skinShade} d="M13 21h7v3h-7Z" />
    <path fill={palette.skin} d="M13 21h5v2h-5Z" />
    <path fill="#dce5c5" opacity=".6" d="M10 25h3v1h-3v5H9v-5h1Z" />
    <path fill={palette.skin} d="M6 30h3v5H6Zm18 0h3v5h-3Z" />
    <path fill="#3b4a40" d="M10 35h5v4h-5Zm8 0h5v4h-5Z" />
    <path fill="#202b25" d="M9 38h6v2H9Zm9 0h6v2h-6Z" />
  </svg></span>;
}

function Dialog({ title, titleId, children, onClose, wide = false }: { title: string; titleId: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const container = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previousFocus = document.activeElement;
    const dialog = container.current;
    dialog?.querySelector<HTMLButtonElement>('button')?.focus();
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); if (previousFocus instanceof HTMLElement) previousFocus.focus(); };
  }, []);
  return <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}><section ref={container} className={`modal ${wide ? 'wide-modal' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId}><div className="modal-heading"><h2 id={titleId}>{title}</h2><button className="icon-button" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}><Icon name="close" /></button></div>{children}</section></div>;
}

function ReviewReceipt({ task }: { task: Task }) {
  const review = task.review;
  if (!review) return null;
  const label = { pending: 'Waiting', running: 'Reviewing', approved: 'Approved', 'changes-requested': 'Changes requested', failed: 'Review failed', interrupted: 'Review interrupted', stale: 'Files changed · review again' }[review.status];
  return <section className={`review-receipt ${review.status}`} aria-label="Quinn review"><div className="section-heading"><strong>Quinn’s independent review</strong><span>{label}</span></div><p>{review.summary}</p>{review.findings.length > 0 && <details open={review.status !== 'approved'}><summary>Findings ({review.findings.length})</summary><ul>{review.findings.map((finding, index) => <li key={index}>{finding}</li>)}</ul></details>}{review.checks.length > 0 && <details><summary>Checks reported by Quinn</summary><ul>{review.checks.map((check, index) => <li key={index}>{check}</li>)}</ul></details>}{review.checkpoint && <span className="review-checkpoint">Reviewed tree <code title={review.checkpoint.tree}>{review.checkpoint.tree.slice(0, 12)}</code></span>}</section>;
}

function GitReceipt({ task }: { task: Task }) {
  const publication = task.publication;
  if (!publication) return null;
  return <div className="git-receipt" role="status"><strong>{publication.phase === 'published' ? 'Published by Mira' : publication.phase === 'prepared' ? 'Ready for your confirmation' : publication.phase === 'failed' || publication.phase === 'interrupted' ? 'Git handoff needs attention' : `Mira is ${publication.phase}`}</strong><span>{publication.plan.remote} / {publication.plan.targetBranch}</span>{publication.taskCommit && <span>Task commit <code>{publication.taskCommit.slice(0, 12)}</code></span>}{publication.mergeCommit && <span>{publication.merged ? 'Merged locally' : 'Merge prepared'} <code>{publication.mergeCommit.slice(0, 12)}</code></span>}{publication.error && <p>{publication.error}</p>}</div>;
}

const statusLabel: Record<Task['status'], string> = { queued: 'Queued', planning: 'Preparing', working: 'In progress', testing: 'Testing', reviewing: 'Quinn reviewing', publishing: 'Mira publishing', review: 'Your confirmation', completed: 'Completed', cancelled: 'Cancelled', blocked: 'Needs approval', failed: 'Failed', interrupted: 'Interrupted' };
const runningStatuses: Task['status'][] = ['planning', 'working', 'testing', 'blocked', 'reviewing', 'publishing'];
const isActive = (task: Task) => [...runningStatuses, 'review'].includes(task.status);
const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : 'The action could not be completed.';

export function App() {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [info, setInfo] = useState<DesktopInfo | null>(null);
  const [view, setView] = useState<View>('office');
  const [selectedAgentId, setSelectedAgentId] = useState<AgentId | null>('manager');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [eventTaskId, setEventTaskId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [settings, setSettings] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [inspection, setInspection] = useState<{ task: Task; result: WorktreeInspection | null } | null>(null);
  const [inspectionError, setInspectionError] = useState<string | null>(null);
  const [publicationDraft, setPublicationDraft] = useState<{ taskId: string; targets: PublicationTargets | null; remote: string; commitMessage: string } | null>(null);

  useEffect(() => {
    if (!window.workspace) { setError('Open this project with the desktop launcher: npm run dev.'); return; }
    let mounted = true;
    let receivedEvent = false;
    const unsubscribe = window.workspace.onSnapshot((next) => { receivedEvent = true; if (mounted) setSnapshot(next); });
    void window.workspace.getSnapshot().then((next) => { if (mounted && !receivedEvent) setSnapshot(next); }).catch((cause: Error) => { if (mounted) setError(cause.message); });
    void window.workspace.getInfo().then((next) => { if (mounted) setInfo(next); }).catch(() => {});
    return () => { mounted = false; unsubscribe(); };
  }, []);

  useEffect(() => {
    setSelectedTaskId(null); setEventTaskId(null); setFeedback(''); setInspection(null); setPublicationDraft(null);
    setSelectedAgentId(snapshot?.mode === 'codex' ? 'backend' : 'manager');
  }, [snapshot?.mode]);
  useEffect(() => { setFeedback(''); }, [selectedTaskId]);

  async function action(run: () => Promise<WorkspaceSnapshot>) {
    setPending(true); setError(null);
    try { setSnapshot(await run()); } catch (cause) { setError(errorMessage(cause)); }
    finally { setPending(false); }
  }

  async function openWorktree(taskId: string) {
    setPending(true); setError(null);
    try { await window.workspace.openWorktree(taskId); } catch (cause) { setError(errorMessage(cause)); }
    finally { setPending(false); }
  }

  async function inspect(task: Task) {
    setInspection({ task, result: null }); setInspectionError(null); setError(null); setPending(true);
    try {
      const result = await window.workspace.inspectTask(task.id);
      setInspection((current) => current?.task.id === task.id ? { task, result } : current);
    } catch (cause) { setInspectionError(errorMessage(cause)); }
    finally { setPending(false); }
  }

  async function openPublication(task: Task) {
    setSelectedAgentId('manager'); setSelectedTaskId(task.id); setPending(true); setError(null);
    setPublicationDraft({ taskId: task.id, targets: null, remote: task.publication?.plan.remote ?? '', commitMessage: task.publication?.plan.commitMessage ?? task.title });
    try {
      const targets = await window.workspace.getPublicationTargets(task.id);
      setPublicationDraft(current => current?.taskId === task.id ? { ...current, targets, remote: current.remote || (targets.remotes.includes('origin') ? 'origin' : targets.remotes[0] ?? '') } : current);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setPending(false); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || pending) return;
    const value = title.trim();
    await action(async () => {
      const next = await window.workspace.submitTask(value);
      setSelectedTaskId(next.tasks.at(-1)?.id ?? null);
      setTitle(''); setView('office');
      return next;
    });
  }

  if (!snapshot) return <div className="boot"><span className="brand-mark">aw</span><h1>Agentic Workspace</h1><p>{error ?? 'Opening your workspace…'}</p></div>;

  const live = snapshot.mode === 'codex';
  const codex = snapshot.codex;
  const codexReady = codex?.state === 'ready';
  const liveBusy = live && snapshot.tasks.some((task) => runningStatuses.includes(task.status));
  const canSubmit = !live || (codexReady && Boolean(snapshot.projectPath));
  const activeTask = snapshot.tasks.find(isActive);
  const selectedTask = snapshot.tasks.find((task) => task.id === selectedTaskId) ?? activeTask ?? snapshot.tasks.at(-1);
  const selectedAgent = snapshot.agents.find((agent) => agent.id === selectedAgentId);
  const working = snapshot.agents.filter((agent) => ['working', 'planning'].includes(agent.status)).length;
  const completed = snapshot.tasks.filter((task) => task.status === 'completed').length;
  const queued = snapshot.tasks.filter((task) => task.status === 'queued').length;
  const events = [...snapshot.events].filter((event) => !eventTaskId || event.taskId === eventTaskId).reverse();
  const projectName = snapshot.projectPath?.split(/[\\/]/).filter(Boolean).at(-1) ?? 'Personal workspace';
  const approvals = snapshot.approvals ?? [];
  const selectedModel = codex?.models.find((model) => model.model === codex.selectedModel);
  const publicationTask = snapshot.tasks.find(task => task.id === publicationDraft?.taskId);
  const publicationPlan = publicationTask?.publication?.plan;
  const retainedCommits = Boolean(publicationTask?.publication?.taskCommit);
  const currentPlan = publicationPlan && publicationPlan.remote === publicationDraft?.remote && publicationPlan.commitMessage === publicationDraft?.commitMessage.trim();
  const reviewable = selectedTask && selectedTask.jobs.some(job => job.agentId === 'backend' && job.status === 'completed') && ['review', 'completed', 'failed', 'interrupted'].includes(selectedTask.status) && !selectedTask.publication?.merged;
  const worldStatus = live
    ? activeTask?.status === 'reviewing' ? 'Quinn is reviewing Rowan’s existing worktree' : activeTask?.status === 'publishing' ? 'Mira is completing your confirmed Git handoff' : activeTask?.status === 'review' ? 'Review the result and confirm with Mira' : liveBusy ? 'Rowan is working in a separate Git worktree' : snapshot.paused ? 'Queue on hold · the current task continues' : 'Ready for your next brief'
    : snapshot.paused ? 'Simulation paused' : activeTask ? 'Your team is moving the work forward' : 'Your team is ready when you are';

  function selectAgent(id: AgentId) {
    setSelectedAgentId(id);
    const agent = snapshot!.agents.find((item) => item.id === id);
    if (agent?.taskId) setSelectedTaskId(agent.taskId);
  }

  function showActivity(taskId: string) { setEventTaskId(taskId); setView('activity'); }

  const taskDetails = selectedTask ? <div className="task-detail">
    <div className="section-heading"><span>Selected task</span><span className={`badge ${selectedTask.status}`}>{statusLabel[selectedTask.status]}</span></div>
    <h3>{selectedTask.title}</h3>
    {selectedTask.iteration > 1 && <p className="muted small-text revision-label">Revision {selectedTask.iteration}</p>}
    {live ? <>
      <div className="live-task-phase"><span className={`status-dot ${selectedTask.status}`} /><span>{selectedTask.status === 'working' ? 'Codex turn running' : selectedTask.status === 'planning' ? 'Preparing worktree and session' : selectedTask.status === 'queued' && snapshot.paused ? 'Queued · queue is on hold' : selectedTask.status === 'review' ? 'Turn finished · review the changes' : statusLabel[selectedTask.status]}</span></div>
      {selectedTask.model && <p className="task-model">Model <span>{selectedTask.model}</span></p>}
      {selectedTask.worktree && <div className="worktree-card"><div><Icon name="branch" size={14} /><strong>{selectedTask.worktree.branch}</strong></div><span>Based on {selectedTask.worktree.baseCommit.slice(0, 8)}</span><code title={selectedTask.worktree.path}>{selectedTask.worktree.path}</code><div className="worktree-actions"><button className="subtle" disabled={pending} onClick={() => void inspect(selectedTask)}>Inspect changes</button><button className="text-button" disabled={pending} onClick={() => void openWorktree(selectedTask.id)}><Icon name="folder" size={13} /> Open folder</button></div></div>}
      {selectedTask.error && <p className="task-error" role="status">{selectedTask.error}</p>}
      <button className="text-button task-activity-button" onClick={() => showActivity(selectedTask.id)}><Icon name="activity" size={13} /> View task activity</button>
      <ReviewReceipt task={selectedTask} />
      <GitReceipt task={selectedTask} />
      {selectedTask.review?.status === 'approved' && selectedTask.publication?.phase !== 'published' && <div className="review-box"><p>Quinn’s review is ready. Mira will commit this task branch, merge into the project’s checked-out branch, and push after your confirmation.</p><button className="primary" disabled={pending || liveBusy} onClick={() => void openPublication(selectedTask)}><Icon name="check" size={15} /> {selectedTask.publication?.taskCommit ? 'Resume Git handoff with Mira' : 'Confirm review with Mira…'}</button></div>}
      {reviewable && <button className="text-button review-again" disabled={pending || liveBusy || !codexReady} onClick={() => void action(() => window.workspace.reviewTask(selectedTask.id))}>{selectedTask.review ? 'Ask Quinn to review again' : 'Ask Quinn to review this worktree'}</button>}
      {selectedTask.status === 'review' && !selectedTask.publication?.merged && <button className="text-button" disabled={pending || liveBusy} onClick={() => void action(() => window.workspace.approveTask(selectedTask.id))}>Finish task · keep changes local</button>}
      {['review', 'failed', 'interrupted'].includes(selectedTask.status) && !selectedTask.publication?.merged && <div className="feedback-box"><label htmlFor="task-feedback">{selectedTask.status === 'review' ? 'Request a revision from Rowan' : 'Continue this task with Rowan'}</label><textarea id="task-feedback" value={feedback} onChange={(event) => setFeedback(event.target.value)} maxLength={2000} rows={3} placeholder="Tell Rowan what to change or where to continue…" /><button className="subtle" disabled={pending || !feedback.trim() || !codexReady || liveBusy} onClick={() => void action(async () => { const next = await window.workspace.requestChanges(selectedTask.id, feedback.trim()); setFeedback(''); return next; })}>{selectedTask.status === 'review' ? 'Request changes' : selectedTask.status === 'failed' ? 'Retry task' : 'Resume task'}<Icon name="arrow" size={13} /></button>{!codexReady && <span>Connect Codex to continue.</span>}</div>}
    </> : <>
      <div className="progress"><span style={{ width: `${selectedTask.progress}%` }} /></div>
      <div className="progress-caption"><span>Simulation progress</span><span>{Math.round(selectedTask.progress)}%</span></div>
      <div className="jobs">{selectedTask.jobs.map((job) => <div className="job" key={job.id}><span className={`job-dot ${job.status}`} /><span>{job.title}</span><span className="muted">{job.status === 'completed' ? <Icon name="check" size={13} /> : `${Math.round(job.progress)}%`}</span></div>)}</div>
      {selectedTask.status === 'review' && <div className="review-box"><p>The simulated handoff is ready. Approve it or send it back for another revision.</p><button className="primary" disabled={pending} onClick={() => void action(() => window.workspace.approveTask(selectedTask.id))}><Icon name="check" size={15} /> Approve simulation</button><button className="text-button" disabled={pending} onClick={() => void action(() => window.workspace.requestChanges(selectedTask.id))}>Request changes</button></div>}
    </>}
    {!['completed', 'cancelled', 'failed', 'interrupted', 'publishing'].includes(selectedTask.status) && <button className="text-button cancel" disabled={pending} onClick={() => void action(() => window.workspace.cancelTask(selectedTask.id))}>{live && runningStatuses.includes(selectedTask.status) ? 'Interrupt Codex' : 'Cancel task'}</button>}
  </div> : <div className="empty-detail"><Icon name="tasks" size={24} /><p>Your next idea starts here.</p><span>{live ? 'Connect Codex, choose a Git repository, and give Rowan a task.' : 'Give the team a task to see how work moves through the office.'}</span></div>;

  return <div className="app" data-app-ready="true">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">aw</span><div>agentic<span>WORKSPACE</span></div></div>
      <div className="workspace-label">YOUR WORKSPACE</div>
      <button className="project-card" disabled={pending || liveBusy} onClick={() => void action(() => window.workspace.chooseProject())} title={snapshot.projectPath ?? 'Choose a local project folder'}><span className="project-icon"><Icon name="folder" /></span><span><strong>{projectName}</strong><small>{snapshot.projectPath ? live ? 'Git project' : 'Local project' : live ? 'Choose a Git repository' : 'Choose a project folder'}</small></span></button>
      <nav aria-label="Workspace views">{(['office', 'tasks', 'activity'] as const).map((item) => <button key={item} className={`nav-item ${view === item ? 'active' : ''}`} onClick={() => setView(item)}><Icon name={item} /><span>{item === 'office' ? 'Office' : item === 'tasks' ? 'Task board' : 'Activity'}</span>{item === 'tasks' && snapshot.tasks.length > 0 && <span className="nav-count">{snapshot.tasks.length}</span>}</button>)}</nav>
      <div className="workspace-label departments-label">DEPARTMENTS <span>02</span></div>
      <button className="department" onClick={() => { setView('office'); selectAgent('manager'); }}><span className="dept-dot manager" /><span>Management</span><small>1</small></button>
      <button className="department" onClick={() => { setView('office'); selectAgent(live ? 'backend' : 'frontend'); }}><span className="dept-dot engineering" /><span>Engineering</span><small>3</small></button>
      <div className="sidebar-bottom"><div className="local-indicator"><span />Saved on this computer</div><button className="nav-item" onClick={() => { setConfirmReset(false); setSettings(true); }}><Icon name="settings" /><span>Settings</span></button><div className="version">Desktop preview <span>v{info?.appVersion ?? '0.3.0'}</span></div></div>
    </aside>

    <main className="main">
      <header className="topbar"><div className="breadcrumb">Workspace <span>/</span><strong>{view === 'office' ? 'Office' : view === 'tasks' ? 'Task board' : 'Activity'}</strong></div><div className="topbar-actions"><div className="mode-switch" role="group" aria-label="Worker runtime"><button aria-pressed={!live} className={!live ? 'active' : ''} disabled={pending || liveBusy} onClick={() => void action(() => window.workspace.setMode('simulation'))}>Simulation</button><button aria-pressed={live} className={live ? 'active' : ''} disabled={pending || liveBusy} onClick={() => void action(() => window.workspace.setMode('codex'))}>Codex</button></div><button className="subtle pause-button" disabled={pending} title={live ? 'Holding the queue prevents new tasks from starting. An active Codex turn continues.' : 'Pause the simulated workflow'} onClick={() => void action(() => window.workspace.setPaused(!snapshot.paused))}><Icon name={snapshot.paused ? 'play' : 'pause'} size={14} />{live ? snapshot.paused ? 'Release queue' : 'Hold queue' : snapshot.paused ? 'Resume' : 'Pause'}</button></div></header>
      <section className="page-heading"><div><div className="eyebrow">A LITTLE OFFICE. BIG IDEAS.</div><h1>{view === 'office' ? 'Meet your team.' : view === 'tasks' ? 'Keep things moving.' : 'Follow the work.'}</h1><p>{view === 'office' ? live ? 'Rowan builds. Quinn reviews. You confirm the Git handoff with Mira.' : 'A place for your agents to work, collaborate, and hand things back to you.' : view === 'tasks' ? 'Every idea has a place, from the first brief to your final review.' : live ? 'Actual Codex messages, tool output, and handoffs from this computer.' : 'Messages and milestones, all in one local workspace.'}</p></div><div className="summary"><span><strong>{working}</strong> active</span><span><strong>{queued}</strong> queued</span><span><strong>{completed}</strong> done</span></div></section>

      {error && <div className="error" role="alert">{error}<button aria-label="Dismiss error" onClick={() => setError(null)}><Icon name="close" size={14} /></button></div>}
      {live && <section className={`runtime-strip ${codexReady ? 'ready' : ''}`} aria-label="Codex connection"><div><span className={`connection-dot ${codex?.state ?? 'disconnected'}`} /><div><strong>{codexReady ? 'Codex connected' : codex?.state === 'connecting' ? 'Connecting to Codex…' : 'Connect your local Codex'}</strong><p>{codexReady ? `${selectedModel?.displayName ?? codex?.selectedModel ?? 'Default model'} · ChatGPT sign-in${snapshot.paused ? ' · Queue held' : ''}` : codex?.message || 'Use your installed Codex CLI and its existing ChatGPT sign-in.'}</p></div></div><button className="subtle" disabled={pending || codex?.state === 'connecting' || liveBusy} onClick={() => codexReady ? setSettings(true) : void action(() => window.workspace.connectCodex())}>{codexReady ? 'Manage connection' : codex?.state === 'needs-auth' ? 'Check sign-in' : 'Connect Codex'}</button></section>}
      {approvals.length > 0 && <section className="approval-section" aria-label="Codex approval requests">{approvals.map((approval) => <div className="approval-card" key={approval.id}><div className="approval-heading"><strong>Codex requests {approval.kind === 'command' ? 'command' : 'file'} approval</strong><button className="text-button" onClick={() => { setSelectedTaskId(approval.taskId); setView('office'); }}>View task<Icon name="arrow" size={12} /></button></div><p>{approval.reason}</p><pre>{approval.detail}</pre><div className="approval-actions"><button className="primary" disabled={pending} onClick={() => void action(() => window.workspace.respondToApproval(approval.id, true))}>Allow this request</button><button className="subtle" disabled={pending} onClick={() => void action(() => window.workspace.respondToApproval(approval.id, false))}>Decline</button></div></div>)}</section>}

      <div className="content-grid">
        <div className="primary-content">
          {view === 'office' ? <section className="world-panel"><div className="panel-heading"><span><span className="live-dot" /> Main office</span><span className="muted">{live ? 'Codex · worker + reviewer' : '4 simulated agents · 2 departments'}</span></div><div className="world-container"><OfficeWorld snapshot={snapshot} selectedAgentId={selectedAgentId} onSelectAgent={selectAgent} /></div><div className="world-footer"><span>{worldStatus}</span><span>Click an agent to inspect</span></div></section> : view === 'tasks' ? <section className="board-panel"><div className="panel-heading"><span>All tasks</span><span className="muted">{snapshot.tasks.length} total</span></div><div className="task-list">{snapshot.tasks.length === 0 ? <div className="empty-list"><Icon name="tasks" size={32} /><h3>A clear desk, a fresh start.</h3><p>Add your first task below.</p></div> : [...snapshot.tasks].reverse().map((task) => <button className={`task-list-row ${selectedTask?.id === task.id ? 'selected' : ''}`} key={task.id} onClick={() => setSelectedTaskId(task.id)}><div><span className={`badge ${task.status}`}>{statusLabel[task.status]}</span><h3>{task.title}</h3><small>{live ? task.worktree?.branch ?? 'Worktree created when task starts' : `${task.jobs.length} subtasks · ${Math.round(task.progress)}% complete`}</small></div><Icon name="arrow" /></button>)}</div></section> : <section className="activity-panel"><div className="panel-heading"><span>Workspace activity</span><label className="activity-filter"><span className="sr-only">Filter activity by task</span><select value={eventTaskId ?? ''} onChange={(event) => setEventTaskId(event.target.value || null)}><option value="">All tasks</option>{snapshot.tasks.map((task) => <option key={task.id} value={task.id}>{task.title.length > 42 ? `${task.title.slice(0, 42)}…` : task.title}</option>)}</select></label></div><div className="activity-list">{events.length === 0 && <div className="empty-list"><Icon name="activity" size={30} /><h3>No activity yet.</h3><p>{eventTaskId ? 'This task has no events yet.' : 'Task messages will appear here.'}</p></div>}{events.map((event) => <div className={`event ${event.kind}`} key={event.id}><span className={`event-dot ${event.kind}`} /><div><strong>{snapshot.agents.find((agent) => agent.id === event.agentId)?.name ?? 'Workspace'}<span className="event-kind">{event.kind === 'tool' ? 'TOOL' : event.kind === 'error' ? 'ERROR' : ''}</span></strong><p>{event.message}</p></div><time>{new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>)}</div></section>}

          {live && (selectedAgentId === 'qa' || selectedAgentId === 'manager') ? <section className="composer handoff-composer"><div className="composer-heading"><div><h2>{selectedAgentId === 'qa' ? 'Review Rowan’s worktree.' : 'Confirm the handoff with Mira.'}</h2><p>{selectedTask ? selectedTask.title : 'Choose an existing task from the task board.'}</p></div><span className="shortcut">EXISTING TASK</span></div><p className="handoff-explanation">{selectedAgentId === 'qa' ? 'Quinn opens a separate, read-only Codex session in the selected task’s worktree.' : 'Mira coordinates the Git handoff after Quinn’s approval and your confirmation.'}</p><div className="handoff-actions">{selectedTask && (selectedAgentId === 'manager' && selectedTask.review?.status === 'approved' && selectedTask.publication?.phase !== 'published' ? <button className="primary" disabled={pending || liveBusy} onClick={() => void openPublication(selectedTask)}>Confirm review with Mira…<Icon name="arrow" size={14} /></button> : <button className="primary" disabled={pending || liveBusy || !codexReady || !reviewable} onClick={() => void action(() => window.workspace.reviewTask(selectedTask.id))}>{selectedAgentId === 'qa' ? 'Review this worktree' : 'Ask Quinn to review'}<Icon name="check" size={14} /></button>)}<button className="text-button" onClick={() => selectAgent('backend')}>Give Rowan a new task<Icon name="plus" size={13} /></button></div></section> : <section className="composer"><div className="composer-heading"><div><h2>{live ? 'Give Rowan a new task.' : 'What should we work on?'}</h2><p>{live ? 'Each task starts from the repository’s committed HEAD in its own worktree.' : 'Try the workflow. Simulated agents won’t change your project files.'}</p></div><span className="shortcut">{live ? 'LOCAL CODEX' : 'SIMULATION'}</span></div>{live && !canSubmit && <div className="composer-prerequisites">{!snapshot.projectPath && <button className="text-button" disabled={pending} onClick={() => void action(() => window.workspace.chooseProject())}><Icon name="folder" size={13} /> Choose a Git repository</button>}{!codexReady && <span>Connect Codex before adding a task.</span>}</div>}<form onSubmit={(event) => void submit(event)}><input aria-label="Task brief" value={title} onChange={(event) => setTitle(event.target.value)} placeholder={live ? 'Describe a change, including the checks you want Codex to run…' : 'e.g. Build a settings panel for the workspace'} maxLength={500} /><button className="primary" type="submit" disabled={pending || !title.trim() || !canSubmit}><Icon name="plus" size={16} /> Add task</button></form><div className="suggestions"><span>Try a brief</span>{(live ? ['Explain the project structure', 'Find and fix a small bug', 'Add a settings panel with tests'] : ['Build a settings panel', 'Investigate a stuck agent', 'Add a new department']).map((text) => <button key={text} onClick={() => setTitle(text)}>{text}<Icon name="arrow" size={12} /></button>)}</div></section>}
        </div>

        <aside className="inspector"><div className="panel-heading"><span>Your team</span><span className="muted">04</span></div><div className="team-list">{snapshot.agents.map((agent) => <button key={agent.id} className={`agent-row ${selectedAgentId === agent.id ? 'selected' : ''}`} onClick={() => selectAgent(agent.id)}><Avatar agent={agent} small /><span><strong>{agent.name}<small>{live ? ['backend', 'qa'].includes(agent.id) ? 'CODEX' : agent.id === 'manager' ? 'LEAD' : '' : agent.id === 'manager' ? 'LEAD' : ''}</small></strong><span className="role">{agent.role}</span></span><span className={`status-dot ${agent.status}`} title={agent.status} /></button>)}</div>{selectedAgent && <div className="agent-detail"><div className="agent-heading"><Avatar agent={selectedAgent} /><div><h2>{selectedAgent.name}</h2><p>{selectedAgent.role}</p></div></div><div className="agent-activity"><span className={`status-dot ${selectedAgent.status}`} /><span>{!live && snapshot.paused && ['working', 'planning'].includes(selectedAgent.status) ? 'Paused' : selectedAgent.activity}</span></div></div>}{taskDetails}<div className="inspector-note"><span className="live-dot" /><p>{live ? 'Rowan and Quinn use separate Codex sessions in the same task worktree. Mira coordinates your confirmed Git handoff.' : 'This mode uses simulated workers. No model calls or project edits.'}</p></div></aside>
      </div>
      <footer className="statusbar"><span><span className="live-dot" /> Local workspace</span><span>{live ? snapshot.paused ? 'Queue held · active turn continues' : codexReady ? 'Codex ready' : 'Codex disconnected' : snapshot.paused ? 'Paused' : 'Simulation ready'}<span className="status-separator">·</span>{live ? 'Separate worktree per task' : 'No app account required'}</span></footer>
    </main>

    {settings && <Dialog title="Workspace settings" titleId="settings-title" onClose={() => setSettings(false)}><p>Your tasks and settings stay on this computer. The app has no account of its own.</p>{error && <div className="dialog-error" role="alert">{error}</div>}<div className="settings-row"><span>Worker runtime</span><strong>{live ? 'Codex' : 'Simulation'}</strong></div><div className="settings-row"><span>Application version</span><strong>{info?.appVersion ?? '0.3.0'}</strong></div><div className="codex-settings"><h3>Local Codex</h3><p>{live ? codex?.message ?? 'Use an installed Codex CLI to run real tasks in Git worktrees.' : 'Switch to Codex mode to connect an installed CLI and run tasks in Git worktrees.'}</p><div className="connection-label"><span className={`connection-dot ${codex?.state ?? 'disconnected'}`} /><span>{!live ? 'Inactive in simulation' : codex?.state === 'ready' ? 'Connected with ChatGPT' : codex?.state === 'connecting' ? 'Connecting…' : codex?.state === 'needs-auth' ? 'ChatGPT sign-in needed' : 'Not connected'}{codex?.version ? ` · ${codex.version}` : ''}</span></div><div className="settings-actions">{!live && <button className="subtle" disabled={pending} onClick={() => void action(() => window.workspace.setMode('codex'))}>Switch to Codex</button>}<button className="subtle" disabled={!live || pending || liveBusy || codex?.state === 'connecting'} onClick={() => void action(() => window.workspace.connectCodex())}>{codexReady ? 'Reconnect' : 'Connect Codex'}</button><button className="text-button" disabled={!live || pending || liveBusy} onClick={() => void action(() => window.workspace.chooseCodexExecutable())}>Choose executable…</button></div>{codex?.state === 'needs-auth' && <div className="auth-help"><p>In your terminal, sign in to the installed CLI with your ChatGPT account:</p><code>codex login</code><p>Then return here and choose Connect Codex. An existing CLI sign-in can be reused.</p></div>}{codexReady && codex.models.length > 0 && <label className="model-setting"><span>Model for new tasks</span><select aria-label="Codex model" value={codex.selectedModel ?? ''} disabled={pending} onChange={(event) => void action(() => window.workspace.setModel(event.target.value))}>{codex.models.map((model) => <option key={model.id} value={model.model}>{model.displayName}{model.isDefault ? ' (default)' : ''}</option>)}</select></label>}</div><div className="settings-project"><span>{live ? 'Git repository' : 'Project folder'}</span><p>{snapshot.projectPath ?? 'No project folder selected'}</p><button className="subtle" disabled={pending || liveBusy} onClick={() => void action(() => window.workspace.chooseProject())}><Icon name="folder" size={14} /> Choose folder</button>{live && <p className="settings-caption">Tasks use committed HEAD. Uncommitted source changes are not copied into the task worktree.</p>}</div><div className="reset-section"><h3>Start fresh</h3><p>{live ? 'Clear Codex task history and messages. Existing worktrees and branches remain on disk.' : 'Clear simulated tasks and messages. Keep the selected project folder.'}</p>{confirmReset ? <div className="reset-actions"><span>{live ? 'Task history will be cleared; worktree files are retained.' : 'This clears local simulation history.'}</span><button className="danger" disabled={pending || liveBusy} onClick={() => void action(async () => { const next = await window.workspace.resetWorkspace(); setSelectedTaskId(null); setEventTaskId(null); setConfirmReset(false); setSettings(false); return next; })}>Clear history</button><button className="text-button" onClick={() => setConfirmReset(false)}>Keep it</button></div> : <button className="subtle" disabled={pending || liveBusy} onClick={() => setConfirmReset(true)}>Reset {live ? 'Codex history' : 'simulation'}…</button>}</div></Dialog>}
    {publicationDraft && publicationTask && <Dialog title="Confirm review with Mira" titleId="publication-title" onClose={() => setPublicationDraft(null)}>
      <p>{publicationTask.title}</p><ReviewReceipt task={publicationTask} />
      {error && <div className="dialog-error" role="alert">{error}</div>}
      {!publicationDraft.targets ? <p role="status">Reading the project branch and Git remotes…</p> : <>
        <div className="publication-destination"><span>Task branch</span><code>{publicationTask.worktree?.branch}</code><span>Project checkout</span><code>{publicationTask.worktree?.repositoryPath}</code><span>Merge into project branch</span><strong>{publicationPlan?.targetBranch ?? publicationDraft.targets.targetBranch}</strong></div>
        {publicationDraft.targets.remotes.length === 0 && <div className="dialog-error">Add a Git remote in your project before publishing. Mira uses your existing Git configuration and credentials.</div>}
        <label className="publication-field"><span>Push to remote</span><select aria-label="Publication remote" disabled={pending || retainedCommits || liveBusy} value={publicationDraft.remote} onChange={event => setPublicationDraft({ ...publicationDraft, remote: event.target.value })}>{publicationDraft.targets.remotes.map(remote => <option key={remote} value={remote}>{remote}</option>)}</select></label>
        <label className="publication-field"><span>Commit message for uncommitted changes</span><input aria-label="Publication commit message" maxLength={500} disabled={pending || retainedCommits || liveBusy} value={publicationDraft.commitMessage} onChange={event => setPublicationDraft({ ...publicationDraft, commitMessage: event.target.value })} /></label>
        <GitReceipt task={publicationTask} />
        {currentPlan && <p className="publication-note">Quinn reviewed tree <code>{publicationPlan!.tree.slice(0, 12)}</code>. Destination is pinned to <code>{publicationPlan!.targetHead.slice(0, 12)}</code>. Changes after review or confirmation stop the handoff.</p>}
        <p className="publication-note">Mira keeps the task branch. A failed merge or push leaves completed commits available to inspect and retry.</p>
        {publicationTask.publication?.phase !== 'published' && <div className="publication-actions">{currentPlan ? <button className="primary" disabled={pending || liveBusy || publicationTask.review?.status !== 'approved'} onClick={() => void action(() => window.workspace.confirmPublication(publicationTask.id, publicationPlan!.id))}><Icon name="check" size={15} />{retainedCommits ? 'Confirm · resume Git handoff' : 'Confirm · commit, merge & push'}</button> : <button className="primary" disabled={pending || liveBusy || !publicationDraft.remote || !publicationDraft.commitMessage.trim() || publicationTask.review?.status !== 'approved'} onClick={() => void action(() => window.workspace.preparePublication(publicationTask.id, publicationDraft.remote, publicationDraft.commitMessage.trim()))}>Prepare Git handoff<Icon name="arrow" size={14} /></button>}<button className="text-button" disabled={pending} onClick={() => setPublicationDraft(null)}>Keep reviewing</button></div>}
      </>}
    </Dialog>}
    {inspection && <Dialog title="Worktree changes" titleId="inspection-title" wide onClose={() => setInspection(null)}><p className="inspection-title">{inspection.task.title}</p>{error && <div className="dialog-error" role="alert">{error}</div>}<div className="inspection-meta"><Icon name="branch" size={15} /><strong>{inspection.task.worktree?.branch}</strong><span>Compared with {inspection.task.worktree?.baseCommit.slice(0, 8)}</span></div>{inspectionError ? <div className="inspection-error" role="alert">{inspectionError}</div> : !inspection.result ? <p role="status">Reading worktree changes…</p> : <><div className="diff-summary"><strong>{inspection.result.files.length} changed {inspection.result.files.length === 1 ? 'file' : 'files'}</strong>{inspection.result.truncated && <span>Preview truncated · open the folder to inspect the full changes</span>}</div>{inspection.result.status && <details className="git-status"><summary>Git status</summary><pre>{inspection.result.status}</pre></details>}<pre className="diff-preview" tabIndex={0} aria-label="Worktree diff">{inspection.result.diff || 'No diff to display.'}</pre></>}<div className="inspection-footer"><p>Quinn reviews this same worktree. After approval, confirm the commit, merge, and push with Mira.</p><button className="subtle" disabled={pending} onClick={() => void openWorktree(inspection.task.id)}><Icon name="folder" size={14} /> Open worktree</button></div></Dialog>}
  </div>;
}
