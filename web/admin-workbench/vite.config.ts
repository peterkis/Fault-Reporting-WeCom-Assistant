import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
export default defineConfig({plugins:[react(),tailwind()],base:'/workbench/app/',
  build:{manifest:true,sourcemap:false},server:{proxy:{'/api':'http://127.0.0.1:5195'}}});
