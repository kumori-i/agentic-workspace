import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import electron from 'electron';
import { buildDesktop } from './build.mjs';

await buildDesktop();
const server = await createServer();
await server.listen();
const env = { ...process.env, AW_DEV_URL: 'http://127.0.0.1:5173' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.'], { stdio: 'inherit', env });
let shuttingDown = false;
async function finish(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  await server.close();
  process.exitCode = code ?? 1;
}
child.on('error', (error) => { console.error(error); void finish(1); });
child.on('exit', (code) => void finish(code));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { child.kill(signal); void finish(0); });
