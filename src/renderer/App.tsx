import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { Agent, AgentId, DesktopInfo, Task, WorkspaceSnapshot } from '../shared/types';
import { OfficeWorld } from './world/OfficeWorld';

type View = 'office' | 'tasks' | 'activity';
type Glyph = 'office' | 'tasks' | 'activity' | 'folder' | 'plus' | 'pause' | 'play' | 'settings' | 'arrow' | 'close' | 'check';
function Icon({ name, size = 18 }: { name: Glyph; size?: number }) {
  const paths: Record<Glyph, ReactNode> = {
    office: <><path d="M3 21V7l9-4 9 4v14M8 21v-6h8v6M7 9h1m8 0h1M7 12h1m8 0h1" /></>,
    tasks: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V2h6v2M9 9h6M9 13h6M9 17h4" /></>,
    activity: <path d="M2 12h5l3-8 4 16 3-8h5" />,
    folder: <path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11H3V7Z" />,
    plus: <path d="M12 5v14M5 12h14" />,
    pause: <><path d="M8 5v14M16 5v14" /></>,
    play: <path d="m8 4 12 8-12 8Z" />,
    settings: <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" /><circle cx="15" cy="17" r="3" /></>,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    check: <path d="m5 12 4 4L19 6" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function Avatar({ agent, small = false }: { agent: Agent; small?: boolean }) {
  return <span className={`avatar ${small ? 'small' : ''}`} style={{ background: `${agent.color}16` }}><svg viewBox="0 0 24 28" shapeRendering="crispEdges" aria-hidden="true"><path fill="#26332e" d="M7 2h10v2h2v8H5V4h2Z" /><path fill="#dab996" d="M7 6h10v9H7Z" /><path fill="#26332e" d="M9 9h2v2H9Zm5 0h2v2h-2Z" /><path fill={agent.color} d="M6 16h12v2h2v7H4v-7h2Z" /><path fill="#31453c" d="M7 25h4v3H7Zm6 0h4v3h-4Z" /><path fill="#f1dac0" d="M4 18h2v5H4Zm14 0h2v5h-2Z" /></svg></span>;
}

const statusLabel: Record<Task['status'], string> = { queued: 'Queued', planning: 'Planning', working: 'In progress', testing: 'Testing', review: 'Your review', completed: 'Completed', cancelled: 'Cancelled' };
const isActive = (task: Task) => !['completed', 'cancelled', 'queued'].includes(task.status);

export function App() {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [info, setInfo] = useState<DesktopInfo | null>(null);
  const [view, setView] = useState<View>('office');
  const [selectedAgentId, setSelectedAgentId] = useState<AgentId | null>('manager');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [settings, setSettings] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (!window.workspace) { setError('Open this project with the desktop launcher: npm run dev.'); return; }
    let mounted = true;
    let receivedEvent = false;
    const unsubscribe = window.workspace.onSnapshot((next) => { receivedEvent = true; if (mounted) setSnapshot(next); });
    void window.workspace.getSnapshot().then((next) => { if (mounted && !receivedEvent) setSnapshot(next); }).catch((cause: Error) => { if (mounted) setError(cause.message); });
    void window.workspace.getInfo().then((next) => { if (mounted) setInfo(next); }).catch(() => {});
    return () => { mounted = false; unsubscribe(); };
  }, []);

  async function action(run: () => Promise<WorkspaceSnapshot>) {
    setPending(true); setError(null);
    try { setSnapshot(await run()); } catch (cause) { setError(cause instanceof Error ? cause.message : 'The action could not be completed.'); }
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

  const activeTask = snapshot.tasks.find(isActive);
  const selectedTask = snapshot.tasks.find((task) => task.id === selectedTaskId) ?? activeTask ?? snapshot.tasks.at(-1);
  const selectedAgent = snapshot.agents.find((agent) => agent.id === selectedAgentId);
  const working = snapshot.agents.filter((agent) => ['working', 'planning'].includes(agent.status)).length;
  const completed = snapshot.tasks.filter((task) => task.status === 'completed').length;
  const queued = snapshot.tasks.filter((task) => task.status === 'queued').length;
  const events = [...snapshot.events].reverse();
  const projectName = snapshot.projectPath?.split(/[\\/]/).filter(Boolean).at(-1) ?? 'Personal workspace';

  function selectAgent(id: AgentId) {
    setSelectedAgentId(id);
    const agent = snapshot!.agents.find((item) => item.id === id);
    if (agent?.taskId) setSelectedTaskId(agent.taskId);
  }

  const taskDetails = selectedTask ? <div className="task-detail">
    <div className="section-heading"><span>Selected task</span><span className={`badge ${selectedTask.status}`}>{statusLabel[selectedTask.status]}</span></div>
    <h3>{selectedTask.title}</h3>
    {selectedTask.iteration > 1 && <p className="muted small-text">Revision {selectedTask.iteration}</p>}
    <div className="progress"><span style={{ width: `${selectedTask.progress}%` }} /></div>
    <div className="progress-caption"><span>Simulation progress</span><span>{Math.round(selectedTask.progress)}%</span></div>
    <div className="jobs">{selectedTask.jobs.map((job) => <div className="job" key={job.id}><span className={`job-dot ${job.status}`} /> <span>{job.title}</span><span className="muted">{job.status === 'completed' ? <Icon name="check" size={13} /> : `${Math.round(job.progress)}%`}</span></div>)}</div>
    {selectedTask.status === 'review' && <div className="review-box"><p>The simulated handoff is ready. Approve it or send it back for another revision.</p><button className="primary" disabled={pending} onClick={() => void action(() => window.workspace.approveTask(selectedTask.id))}><Icon name="check" size={15} /> Approve simulation</button><button className="text-button" disabled={pending} onClick={() => void action(() => window.workspace.requestChanges(selectedTask.id))}>Request changes</button></div>}
    {!['completed', 'cancelled'].includes(selectedTask.status) && <button className="text-button cancel" disabled={pending} onClick={() => void action(() => window.workspace.cancelTask(selectedTask.id))}>Cancel task</button>}
  </div> : <div className="empty-detail"><Icon name="tasks" size={24} /><p>Your next idea starts here.</p><span>Give the team a task to see how work moves through the office.</span></div>;

  return <div className="app" data-app-ready="true">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">aw</span><div>agentic<span>WORKSPACE</span></div></div>
      <div className="workspace-label">YOUR WORKSPACE</div>
      <button className="project-card" onClick={() => void action(() => window.workspace.chooseProject())} title={snapshot.projectPath ?? 'Choose a local project folder'}><span className="project-icon"><Icon name="folder" /></span><span><strong>{projectName}</strong><small>{snapshot.projectPath ? 'Local project' : 'Choose a project folder'}</small></span></button>
      <nav aria-label="Workspace views">{(['office', 'tasks', 'activity'] as const).map((item) => <button key={item} className={`nav-item ${view === item ? 'active' : ''}`} onClick={() => setView(item)}><Icon name={item} /><span>{item === 'office' ? 'Office' : item === 'tasks' ? 'Task board' : 'Activity'}</span>{item === 'tasks' && snapshot.tasks.length > 0 && <span className="nav-count">{snapshot.tasks.length}</span>}</button>)}</nav>
      <div className="workspace-label departments-label">DEPARTMENTS <span>02</span></div>
      <button className="department" onClick={() => { setView('office'); selectAgent('manager'); }}><span className="dept-dot manager" /><span>Management</span><small>1</small></button>
      <button className="department" onClick={() => { setView('office'); selectAgent('frontend'); }}><span className="dept-dot engineering" /><span>Engineering</span><small>3</small></button>
      <div className="sidebar-bottom"><div className="local-indicator"><span />Saved on this computer</div><button className="nav-item" onClick={() => { setConfirmReset(false); setSettings(true); }}><Icon name="settings" /><span>Settings</span></button><div className="version">Desktop preview <span>v{info?.appVersion ?? '0.1.0'}</span></div></div>
    </aside>

    <main className="main">
      <header className="topbar"><div className="breadcrumb">Workspace <span>/</span> <strong>{view === 'office' ? 'Office' : view === 'tasks' ? 'Task board' : 'Activity'}</strong></div><div className="topbar-actions"><span className="mode-badge"><span /> Simulation mode</span><button className="subtle pause-button" disabled={pending} onClick={() => void action(() => window.workspace.setPaused(!snapshot.paused))}><Icon name={snapshot.paused ? 'play' : 'pause'} size={14} />{snapshot.paused ? 'Resume' : 'Pause'}</button></div></header>
      <section className="page-heading"><div><div className="eyebrow">A LITTLE OFFICE. BIG IDEAS.</div><h1>{view === 'office' ? 'Meet your team.' : view === 'tasks' ? 'Keep things moving.' : 'Follow the work.'}</h1><p>{view === 'office' ? 'A place for your agents to work, collaborate, and hand things back to you.' : view === 'tasks' ? 'Every idea has a place, from the first brief to your final review.' : 'Messages and milestones, all in one local workspace.'}</p></div><div className="summary"><span><strong>{working}</strong> active</span><span><strong>{queued}</strong> queued</span><span><strong>{completed}</strong> done</span></div></section>

      {error && <div className="error" role="alert">{error}<button aria-label="Dismiss error" onClick={() => setError(null)}><Icon name="close" size={14} /></button></div>}

      <div className="content-grid">
        <div className="primary-content">
          {view === 'office' ? <section className="world-panel"><div className="panel-heading"><span><span className="live-dot" /> Main office</span><span className="muted">4 agents · 2 departments</span></div><div className="world-container"><OfficeWorld snapshot={snapshot} selectedAgentId={selectedAgentId} onSelectAgent={selectAgent} /></div><div className="world-footer"><span>{snapshot.paused ? 'Simulation paused' : activeTask ? 'Your team is moving the work forward' : 'Your team is ready when you are'}</span><span>Click an agent to inspect</span></div></section> : view === 'tasks' ? <section className="board-panel"><div className="panel-heading"><span>All tasks</span><span className="muted">{snapshot.tasks.length} total</span></div><div className="task-list">{snapshot.tasks.length === 0 ? <div className="empty-list"><Icon name="tasks" size={32} /><h3>A clear desk, a fresh start.</h3><p>Add your first task below.</p></div> : [...snapshot.tasks].reverse().map((task) => <button className={`task-list-row ${selectedTask?.id === task.id ? 'selected' : ''}`} key={task.id} onClick={() => setSelectedTaskId(task.id)}><div><span className={`badge ${task.status}`}>{statusLabel[task.status]}</span><h3>{task.title}</h3><small>{task.jobs.length} subtasks · {Math.round(task.progress)}% complete</small></div><Icon name="arrow" /></button>)}</div></section> : <section className="activity-panel"><div className="panel-heading"><span>Workspace activity</span><span className="muted">Simulation events</span></div><div className="activity-list">{events.map((event) => <div className="event" key={event.id}><span className={`event-dot ${event.kind}`} /><div><strong>{snapshot.agents.find((agent) => agent.id === event.agentId)?.name ?? 'Workspace'}</strong><p>{event.message}</p></div><time>{new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>)}</div></section>}

          <section className="composer"><div className="composer-heading"><div><h2>What should we work on?</h2><p>Try the workflow. Simulated agents won’t change your project files.</p></div><span className="shortcut">LOCAL PREVIEW</span></div><form onSubmit={(event) => void submit(event)}><input aria-label="Task brief" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Build a settings panel for the workspace" maxLength={500} /><button className="primary" type="submit" disabled={pending || !title.trim()}><Icon name="plus" size={16} /> Add task</button></form><div className="suggestions"><span>Try a brief</span>{['Build a settings panel', 'Investigate a stuck agent', 'Add a new department'].map((text) => <button key={text} onClick={() => setTitle(text)}>{text}<Icon name="arrow" size={12} /></button>)}</div></section>
        </div>

        <aside className="inspector"><div className="panel-heading"><span>Your team</span><span className="muted">04</span></div><div className="team-list">{snapshot.agents.map((agent) => <button key={agent.id} className={`agent-row ${selectedAgentId === agent.id ? 'selected' : ''}`} onClick={() => selectAgent(agent.id)}><Avatar agent={agent} small /><span><strong>{agent.name}<small>{agent.id === 'manager' ? 'LEAD' : ''}</small></strong><span className="role">{agent.role}</span></span><span className={`status-dot ${agent.status}`} title={agent.status} /></button>)}</div>{selectedAgent && <div className="agent-detail"><div className="agent-heading"><Avatar agent={selectedAgent} /><div><h2>{selectedAgent.name}</h2><p>{selectedAgent.role}</p></div></div><div className="agent-activity"><span className={`status-dot ${selectedAgent.status}`} /><span>{snapshot.paused && ['working', 'planning'].includes(selectedAgent.status) ? 'Paused' : selectedAgent.activity}</span></div></div>}{taskDetails}<div className="inspector-note"><span className="live-dot" /><p>This preview uses simulated workers. No model calls or project edits.</p></div></aside>
      </div>
      <footer className="statusbar"><span><span className="live-dot" /> Local workspace</span><span>{snapshot.paused ? 'Paused' : 'Simulation ready'} <span className="status-separator">·</span> No account required</span></footer>
    </main>

    {settings && <div className="modal-backdrop" onClick={() => setSettings(false)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><h2 id="settings-title">Workspace settings</h2><button className="icon-button" aria-label="Close settings" onClick={() => setSettings(false)}><Icon name="close" /></button></div><p>This desktop preview keeps your workspace on this computer. There is no app account.</p><div className="settings-row"><span>Worker runtime</span><strong>Simulation</strong></div><div className="settings-row"><span>Codex integration</span><strong>Not connected yet</strong></div><div className="settings-row"><span>Codex CLI check</span><strong>Next milestone</strong></div><div className="settings-row"><span>Application version</span><strong>{info?.appVersion ?? '0.1.0'}</strong></div><div className="settings-project"><span>Project folder</span><p>{snapshot.projectPath ?? 'No project folder selected'}</p><button className="subtle" onClick={() => void action(() => window.workspace.chooseProject())}><Icon name="folder" size={14} /> Choose folder</button></div><div className="reset-section"><h3>Start fresh</h3><p>Clear simulated tasks and messages. Keep the selected project folder.</p>{confirmReset ? <div className="reset-actions"><span>This clears local simulation history.</span><button className="danger" disabled={pending} onClick={() => void action(async () => { const next = await window.workspace.resetWorkspace(); setSelectedTaskId(null); setConfirmReset(false); setSettings(false); return next; })}>Clear workspace</button><button className="text-button" onClick={() => setConfirmReset(false)}>Keep it</button></div> : <button className="subtle" onClick={() => setConfirmReset(true)}>Reset simulation…</button>}</div></section></div>}
  </div>;
}
