import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import {fileURLToPath} from 'node:url';
export default defineConfig({plugins:[react(),tailwind()],base:'/workbench/app/',
  build:{manifest:true,sourcemap:false,rolldownOptions:{preserveEntrySignatures:'strict',input:{workbench:fileURLToPath(new URL('./index.html',import.meta.url)),feedbackRecovery:fileURLToPath(new URL('./src/feedback-recovery.ts',import.meta.url))}}},server:{proxy:{'/api':'http://127.0.0.1:5195'}}});
