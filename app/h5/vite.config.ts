import { defineConfig, transformWithOxc, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { h5Catalogs } from './compile-i18n';

/** A classic, dependency-free script finishes theme selection before the first
 * paint. It must not be folded into the deferred React application entry. */
function prepaint(): Plugin {
  let build = false, file = '';
  return {
    name: 'h5-independent-prepaint',
    configResolved(config) { build = config.command === 'build'; },
    async buildStart() {
      if (!build) return;
      const source = await readFile(new URL('./src/prepaint.ts', import.meta.url), 'utf8');
      if (/\b(?:import|export)\s/u.test(source)) throw new Error('H5_PREPAINT_DEPENDENCIES_FORBIDDEN');
      const { code } = await transformWithOxc(source, 'prepaint.ts', { lang: 'ts', target: 'es2022' });
      if (gzipSync(code).length > 2048) throw new Error('H5_PREPAINT_BUDGET_EXCEEDED');
      file = 'assets/prepaint-' + createHash('sha256').update(code).digest('hex').slice(0, 16) + '.js';
      this.emitFile({ type: 'asset', fileName: file, source: code });
    },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return html.replace('<!--h5-prepaint-->', build
          ? '<script src="/wecom/yixiaoxiu/' + file + '"></script>'
          : '<script type="module" blocking="render" src="/src/prepaint.ts"></script>');
      }
    },
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const output = bundle['.vite/manifest.json'];
        if (!output || output.type !== 'asset') throw new Error('H5_MANIFEST_REQUIRED');
        const value: unknown = JSON.parse(String(output.source));
        if (!value || typeof value !== 'object' || !('index.html' in value)) throw new Error('H5_MANIFEST_REQUIRED');
        const entry: unknown = value['index.html'];
        if (!entry || typeof entry !== 'object') throw new Error('H5_MANIFEST_REQUIRED');
        const assets: unknown = 'assets' in entry ? entry.assets : [];
        if (!Array.isArray(assets) || !assets.every((asset: unknown) => typeof asset === 'string')) throw new Error('H5_MANIFEST_ASSETS_INVALID');
        Object.assign(entry, { assets: [...assets, file] });
        output.source = JSON.stringify(value, null, 2) + '\n';
      }
    }
  };
}
export default defineConfig(({command})=>({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/wecom/yixiaoxiu/',
  publicDir: false,
  plugins: [react(), tailwindcss(), h5Catalogs(fileURLToPath(new URL('.', import.meta.url))), prepaint()],
  // The pinned router package's ESM export targets its development tree, whose
  // ENABLE_DEV_WARNINGS constant stays true even in Vite production mode. Use
  // the same official package's production entry for builds; keep dev diagnostics.
  resolve: {alias: {'@': fileURLToPath(new URL('./src', import.meta.url)),...(command==='build'?{'react-router':fileURLToPath(new URL('../../node_modules/react-router/dist/production/index.mjs',import.meta.url))}:{})}},
  server: {host:'127.0.0.1',port:5196,strictPort:true,proxy:{'/api':{target:'http://127.0.0.1:5197',changeOrigin:false}}},
  build: {
    outDir:'../../.build/emit/h5',emptyOutDir:true,manifest:true,sourcemap:false,
    // Give already-required startup modules one gzip/Brotli dictionary. The
    // $initial tag excludes route, dialog and device-bridge dynamic imports.
    rolldownOptions:{output:{codeSplitting:{groups:[{name:'app-core',tags:['$initial']}]}}}
  }
}));
