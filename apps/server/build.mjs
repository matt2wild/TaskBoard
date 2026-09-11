/** Bundles the server so the shipped image runs plain JavaScript with no
 *  TypeScript resolution at runtime. Native modules stay external. */
import { build } from 'esbuild';
import { rm, mkdir, cp } from 'node:fs/promises';

const external = ['better-sqlite3', '@node-rs/argon2'];

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });

await build({
  entryPoints: ['src/main.ts', 'src/cli.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: false,
  minify: false,
  external,
  logLevel: 'info',
  // Bundled ESM still needs the CJS globals some dependencies reach for.
  banner: {
    js: [
      "import { createRequire as __hsRequire } from 'node:module';",
      "import { fileURLToPath as __hsUrl } from 'node:url';",
      "import { dirname as __hsDirname } from 'node:path';",
      'const require = __hsRequire(import.meta.url);',
      'const __filename = __hsUrl(import.meta.url);',
      'const __dirname = __hsDirname(__filename);',
    ].join('\n'),
  },
});

await cp('migrations', 'dist/migrations', { recursive: true });
console.log('server bundled to dist/');
