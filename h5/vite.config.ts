import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/wecom/yixiaoxiu/',
  publicDir: false,
  plugins: [react(), tailwindcss(), {name:'h5-render-blocking-entry',transformIndexHtml:{order:'post',handler:html=>html.replace(/<script type="module" crossorigin/g,'<script type="module" blocking="render" crossorigin')}}],
  resolve: {alias: {'@': fileURLToPath(new URL('./src', import.meta.url))}},
  server: {host:'127.0.0.1',port:5196,strictPort:true,proxy:{'/api':{target:'http://127.0.0.1:5197',changeOrigin:false}}},
  build: {outDir:'../.build/emit/h5',emptyOutDir:true,manifest:true,sourcemap:false}
});
