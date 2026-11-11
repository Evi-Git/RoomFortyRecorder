// Bundles the harness entries for a browser. Dev only; not part of the app.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const nm = path.join(repo, 'node_modules');
const fallbackNm = '/opt/npm-tools/node_modules';

export const resolveTool = (name) => {
  for (const base of [nm, fallbackNm]) {
    if (fs.existsSync(path.join(base, name, 'package.json')))
      return createRequire(path.join(base, 'x.js'))(name);
  }
  throw new Error(`${name} not found in ${nm} or ${fallbackNm}`);
};

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};

export const build = async (out = arg('out', '/tmp/rf-harness-out')) => {
  const esbuild = resolveTool('esbuild');
  const babel = createRequire(path.join(nm, 'x.js'))('@babel/core');
  fs.mkdirSync(out, { recursive: true });

  // The renderer build runs the React Compiler first; so do we, on all of src.
  const compiler = {
    name: 'react-compiler',
    setup(b) {
      b.onLoad({ filter: /\.[jt]sx?$/ }, async (args) => {
        if (!args.path.startsWith(path.join(repo, 'src') + path.sep))
          return undefined;
        const code = fs.readFileSync(args.path, 'utf8');
        const tsx = /\.[jt]sx$/.test(args.path);
        const result = await babel.transformAsync(code, {
          filename: args.path,
          babelrc: false,
          configFile: false,
          sourceMaps: 'inline',
          plugins: [path.join(nm, 'babel-plugin-react-compiler')],
          presets: [
            [
              path.join(nm, '@babel/preset-typescript'),
              { isTSX: tsx, allExtensions: true },
            ],
          ],
        });
        return { contents: result.code, loader: tsx ? 'tsx' : 'ts' };
      });
    },
  };

  // Node built-ins / electron pulled in by main-process or type imports.
  const stubs = {
    name: 'stubs',
    setup(b) {
      b.onResolve(
        {
          filter:
            /^(electron|electron-log.*|fs|path|os|child_process|node:.*)$/,
        },
        (a) => ({
          path: a.path,
          namespace: 'stub',
        }),
      );
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
        contents: 'export default {}; export const __stub = true;',
        loader: 'js',
      }));
    },
  };

  await esbuild.build({
    entryPoints: fs
      .readdirSync(path.join(here, 'entries'))
      .filter((f) => /\.tsx?$/.test(f))
      .map((f) => path.join(here, 'entries', f)),
    outdir: path.join(out, 'entries'),
    bundle: true,
    format: 'esm',
    splitting: true,
    platform: 'browser',
    jsx: 'automatic',
    nodePaths: [nm, path.join(repo, 'src')],
    loader: {
      '.css': 'empty',
      '.png': 'dataurl',
      '.jpg': 'dataurl',
      '.jpeg': 'dataurl',
      '.gif': 'dataurl',
      '.webp': 'dataurl',
      '.svg': 'dataurl',
      '.woff': 'empty',
      '.woff2': 'empty',
      '.ttf': 'empty',
      '.mp4': 'empty',
      '.node': 'empty',
    },
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [compiler, stubs],
    logLevel: 'warning',
  });

  fs.copyFileSync(path.join(here, 'index.html'), path.join(out, 'index.html'));
  execFileSync(
    process.execPath,
    [
      path.join(nm, 'tailwindcss/lib/cli.js'),
      '-c',
      'tailwind.config.js',
      '-i',
      'src/renderer/App.css',
      '-o',
      path.join(out, 'app.css'),
    ],
    { cwd: repo, stdio: 'inherit' },
  );
  return out;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(await build());
}
