import { build as bundle } from 'esbuild';
import { build as buildRenderer } from 'vite';

export async function buildDesktop() {
  await bundle({
    entryPoints: { main: 'src/desktop/main.ts', preload: 'src/desktop/preload.ts' },
    outdir: 'dist/desktop',
    outExtension: { '.js': '.cjs' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    target: 'node24',
    sourcemap: true,
  });
}

if (process.argv[1]?.endsWith('build.mjs')) {
  await buildDesktop();
  await buildRenderer();
}
