// Bundles the content script into dist/ next to copies of the manifest and
// the stylesheet.
// Load dist/ as the unpacked extension.
import { copyFile, mkdir } from 'node:fs/promises';
import * as esbuild from 'esbuild';

await mkdir('dist', { recursive: true });
await copyFile('manifest.json', 'dist/manifest.json');
await copyFile('src/content.css', 'dist/content.css');

const options = {
  entryPoints: ['src/content.ts'],
  outfile: 'dist/content.js',
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  logLevel: 'info',
};

if (process.argv.includes('--watch')) {
  await (await esbuild.context(options)).watch();
} else {
  await esbuild.build(options);
}
