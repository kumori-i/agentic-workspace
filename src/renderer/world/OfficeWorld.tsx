import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import type { Agent, AgentId, AgentStatus, WorkspaceSnapshot } from '../../shared/types';
import { drawOfficeArt } from './office-art';
import { drawCharacterFrames } from './character-art';
import './office-world.css';

interface OfficeWorldProps {
  snapshot: WorkspaceSnapshot;
  selectedAgentId: AgentId | null;
  onSelectAgent: (id: AgentId) => void;
}

type Point = { x: number; y: number };
type Facing = 'down' | 'up' | 'left' | 'right';
type Avatar = {
  agent: Agent;
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Ellipse;
  ring: Phaser.GameObjects.Ellipse;
  dot: Phaser.GameObjects.Arc;
  caption: Phaser.GameObjects.Text;
  route: Point[];
  destination: 'lounge' | 'station';
  facing: Facing;
};

const WORLD_WIDTH = 960;
const WORLD_HEIGHT = 640;
const STATIONS: Record<AgentId, Point> = {
  manager: { x: 288, y: 268 },
  frontend: { x: 266, y: 480 },
  backend: { x: 482, y: 480 },
  qa: { x: 698, y: 480 },
};
const LOUNGE: Record<AgentId, Point> = {
  manager: { x: 625, y: 244 },
  frontend: { x: 685, y: 244 },
  backend: { x: 745, y: 244 },
  qa: { x: 805, y: 244 },
};
const STATUS_COLORS: Record<AgentStatus, number> = {
  idle: 0x96a78b,
  planning: 0xe4b264,
  working: 0x84be9e,
  waiting: 0xb6b2a8,
  review: 0xb0a3ce,
  blocked: 0xe2b264,
  error: 0xce7965,
};
/** Every visible asset is drawn here, on an integer pixel grid. No borrowed art. */
class OfficeScene extends Phaser.Scene {
  private avatars = new Map<AgentId, Avatar>();
  private previousSnapshot: WorkspaceSnapshot | null = null;
  private drag: { x: number; y: number; scrollX: number; scrollY: number } | null = null;
  private hovered: AgentId | null = null;

  constructor(
    private readonly getSnapshot: () => WorkspaceSnapshot,
    private readonly getSelection: () => AgentId | null,
    private readonly selectAgent: (id: AgentId) => void,
  ) {
    super('office');
  }

  create() {
    this.cameras.main.setBackgroundColor('#ede8dc');
    this.drawOffice();
    for (const agent of this.getSnapshot().agents) this.addAvatar(agent);
    this.applySnapshot(this.getSnapshot());

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer, objects: Phaser.GameObjects.GameObject[]) => {
      if (objects.length || !pointer.leftButtonDown()) return;
      this.drag = { x: pointer.x, y: pointer.y, scrollX: this.cameras.main.scrollX, scrollY: this.cameras.main.scrollY };
      this.game.canvas.style.cursor = 'grabbing';
    });
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!this.drag || !pointer.isDown) return;
      const camera = this.cameras.main;
      camera.scrollX = this.drag.scrollX + (this.drag.x - pointer.x) / camera.zoom;
      camera.scrollY = this.drag.scrollY + (this.drag.y - pointer.y) / camera.zoom;
      camera.scrollX = Phaser.Math.Clamp(camera.scrollX, -140, 140);
      camera.scrollY = Phaser.Math.Clamp(camera.scrollY, -100, 100);
    });
    this.input.on('pointerup', () => {
      this.drag = null;
      this.game.canvas.style.cursor = this.hovered ? 'pointer' : 'grab';
    });
    this.input.on('gameout', () => {
      this.drag = null;
      this.game.canvas.style.cursor = 'grab';
    });
    this.game.canvas.style.cursor = 'grab';
  }

  zoomBy(amount: number) {
    if (!this.sys.isActive()) return;
    this.cameras.main.setZoom(Phaser.Math.Clamp(this.cameras.main.zoom + amount, 0.85, 1.65));
  }

  resetView() {
    if (!this.sys.isActive()) return;
    this.cameras.main.setZoom(1).setScroll(0, 0);
  }

  private drawOffice() {
    drawOfficeArt(this);
  }

  private addAvatar(agent: Agent) {
    drawCharacterFrames(this, agent);
    const start = LOUNGE[agent.id];
    const ring = this.add.ellipse(start.x, start.y - 3, 47, 15, 0xefe5bf, 0.65)
      .setStrokeStyle(2, 0x7d9b7c).setVisible(false);
    const shadow = this.add.ellipse(start.x, start.y - 3, 32, 10, 0x5d6650, 0.16);
    const sprite = this.add.sprite(start.x, start.y, `${agent.id}-down-0`)
      .setOrigin(0.5, 1).setScale(1.35)
      .setInteractive({ useHandCursor: true });
    const dot = this.add.circle(start.x + 21, start.y - 58, 4, STATUS_COLORS[agent.status])
      .setStrokeStyle(2, 0xf5f0df);
    const caption = this.add.text(start.x, start.y - 76, '', {
      fontFamily: '"Courier New", monospace', fontSize: '10px', fontStyle: 'bold',
      color: '#f7f1df', backgroundColor: '#606c59', padding: { x: 6, y: 4 },
    }).setOrigin(0.5, 1).setVisible(false);
    const avatar: Avatar = { agent, sprite, shadow, ring, dot, caption, route: [], destination: 'lounge', facing: 'down' };
    this.avatars.set(agent.id, avatar);
    sprite.on('pointerdown', () => this.selectAgent(agent.id));
    sprite.on('pointerover', () => {
      this.hovered = agent.id;
      this.game.canvas.style.cursor = 'pointer';
    });
    sprite.on('pointerout', () => {
      this.hovered = null;
      if (!this.drag) this.game.canvas.style.cursor = 'grab';
    });
  }

  private routeBetween(id: AgentId, from: 'lounge' | 'station', to: 'lounge' | 'station'): Point[] {
    // Both rooms meet at the doorway; the lower aisle runs between desks.
    // Routes are reversible and deliberately avoid every furniture footprint.
    const stationToDoor = id === 'manager'
      ? [{ x: 288, y: 289 }, { x: 477, y: 289 }]
      : [{ x: STATIONS[id].x, y: 504 }, { x: 379, y: 504 }, { x: 379, y: 353 }, { x: 477, y: 353 }, { x: 477, y: 289 }];
    const doorToLounge = [{ x: 610, y: 289 }, { x: 610, y: 244 }, LOUNGE[id]];
    if (from === 'station' && to === 'lounge') return [...stationToDoor, ...doorToLounge];
    const loungeToDoor = [{ x: 610, y: 244 }, { x: 610, y: 289 }, { x: 477, y: 289 }];
    const doorToStation = id === 'manager'
      ? [{ x: 288, y: 289 }, STATIONS[id]]
      : [{ x: 477, y: 353 }, { x: 379, y: 353 }, { x: 379, y: 504 }, { x: STATIONS[id].x, y: 504 }, STATIONS[id]];
    return [...loungeToDoor, ...doorToStation];
  }

  private applySnapshot(snapshot: WorkspaceSnapshot) {
    this.previousSnapshot = snapshot;
    for (const agent of snapshot.agents) {
      if (!this.avatars.has(agent.id)) this.addAvatar(agent);
      const avatar = this.avatars.get(agent.id)!;
      avatar.agent = agent;
      const destination = agent.status === 'idle' ? 'lounge' : 'station';
      if (destination !== avatar.destination) {
        if (avatar.route.length) {
          // Finish the remaining safe aisle route, then walk to the new
          // destination. This also handles rapid task cancellation/reassignment
          // without teleporting or cutting through furniture.
          avatar.route = [...avatar.route, ...this.routeBetween(agent.id, avatar.destination, destination)];
        } else {
          avatar.route = this.routeBetween(agent.id, avatar.destination, destination);
        }
        avatar.destination = destination;
      }
    }
  }

  update(time: number, delta: number) {
    const snapshot = this.getSnapshot();
    const animationsPaused = snapshot.mode === 'simulation' && snapshot.paused;
    if (snapshot !== this.previousSnapshot) this.applySnapshot(snapshot);
    const selected = this.getSelection();
    for (const [id, avatar] of this.avatars) {
      const { sprite } = avatar;
      let walking = false;
      if (!animationsPaused && avatar.route.length) {
        let distance = (Math.min(delta, 60) / 1000) * 210;
        while (distance > 0 && avatar.route.length) {
          const target = avatar.route[0];
          const dx = target.x - sprite.x;
          const dy = target.y - sprite.y;
          const length = Math.hypot(dx, dy);
          if (length < 0.1) { avatar.route.shift(); continue; }
          avatar.facing = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
          const step = Math.min(distance, length);
          sprite.x += dx / length * step;
          sprite.y += dy / length * step;
          distance -= step;
          walking = true;
          if (step === length) avatar.route.shift();
        }
      }
      const atWork = avatar.destination === 'station' && !avatar.route.length
        && (avatar.agent.status === 'working' || avatar.agent.status === 'planning');
      if (!avatar.route.length) avatar.facing = atWork ? 'up' : 'down';
      const frame = animationsPaused ? 0 : walking ? Math.floor(time / 140) % 4 : atWork ? Math.floor(time / 380) % 2 : 0;
      sprite.setTexture(`${id}-${avatar.facing}-${frame}`);
      // Subpixel positions remain internal; sprite drawing snaps to the grid.
      sprite.setDepth(sprite.y + 2);
      avatar.shadow.setPosition(sprite.x, sprite.y - 3).setDepth(sprite.y - 1);
      avatar.ring.setPosition(sprite.x, sprite.y - 3).setDepth(sprite.y - 2).setVisible(selected === id || this.hovered === id);
      avatar.dot.setPosition(sprite.x + 21, sprite.y - 58).setDepth(sprite.y + 3).setFillStyle(STATUS_COLORS[avatar.agent.status]);
      let status: string = avatar.agent.status;
      if (snapshot.mode === 'simulation' && id === 'qa' && status === 'working') status = 'testing';
      avatar.caption.setText(`${avatar.agent.name.split(' ')[0]} · ${status}`)
        .setPosition(sprite.x, sprite.y - 72).setDepth(900)
        .setVisible(selected === id || this.hovered === id);
    }
  }
}

export function OfficeWorld({ snapshot, selectedAgentId, onSelectAgent }: OfficeWorldProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<OfficeScene | null>(null);
  const snapshotRef = useRef(snapshot);
  const selectionRef = useRef(selectedAgentId);
  const callbackRef = useRef(onSelectAgent);
  snapshotRef.current = snapshot;
  selectionRef.current = selectedAgentId;
  callbackRef.current = onSelectAgent;

  useEffect(() => {
    const parent = hostRef.current;
    if (!parent) return;
    const scene = new OfficeScene(
      () => snapshotRef.current,
      () => selectionRef.current,
      (id) => callbackRef.current(id),
    );
    sceneRef.current = scene;
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent,
      width: WORLD_WIDTH,
      height: WORLD_HEIGHT,
      backgroundColor: '#ede8dc',
      pixelArt: true,
      roundPixels: true,
      antialias: false,
      render: { antialias: false, pixelArt: true, roundPixels: true },
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      scene: [scene],
      audio: { noAudio: true },
      banner: false,
    });
    const observer = new ResizeObserver(() => game.scale.refresh());
    observer.observe(parent);
    return () => {
      observer.disconnect();
      sceneRef.current = null;
      game.destroy(true);
    };
  }, []);

  return (
    <div className="office-world" aria-label="Interactive pixel office. Select a worker to inspect their activity.">
      <div className="office-world__canvas" ref={hostRef} />
      <div className="office-world__hint"><span />{snapshot.mode === 'simulation' && snapshot.paused ? 'Office paused' : 'Click a worker to check in'}<span className="office-world__hint-extra"> · drag to explore</span></div>
      <div className="office-world__controls" aria-label="Office view controls">
        <button type="button" onClick={() => sceneRef.current?.zoomBy(-0.15)} aria-label="Zoom out" title="Zoom out">−</button>
        <button className="office-world__reset" type="button" onClick={() => sceneRef.current?.resetView()} aria-label="Fit whole office" title="Fit whole office">Fit</button>
        <button type="button" onClick={() => sceneRef.current?.zoomBy(0.15)} aria-label="Zoom in" title="Zoom in">+</button>
      </div>
    </div>
  );
}
