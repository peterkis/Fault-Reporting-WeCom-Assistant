import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
export default defineConfig({plugins:[react()],base:'/workbench/desktop/',build:{manifest:true,sourcemap:false,rolldownOptions:{input:fileURLToPath(new URL('./src/login/main.ts',import.meta.url))}}});
