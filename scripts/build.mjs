import { build } from 'esbuild';
import { mkdir, copyFile, cp, rm } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await build({ entryPoints: ['web/app.js'], bundle: true, minify: true, format: 'esm', target: 'es2022', outfile: 'dist/app.js' });
await Promise.all(['index.html', 'style.css', 'theme.css', 'theme.js'].map(name => copyFile(`web/${name}`, `dist/${name}`)));
await cp('web/assets', 'dist/assets', { recursive: true });
await rm('dist/favicon.svg', { force: true });
console.log('Scotia Compass compilado en dist/');
