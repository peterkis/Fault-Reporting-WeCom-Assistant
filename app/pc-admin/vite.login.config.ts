import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
import {desktopLoginPreparePlugin} from './desktop-login-prepare-plugin';
export default defineConfig({plugins:[desktopLoginPreparePlugin(),react()],base:'/workbench/desktop/',build:{manifest:true,sourcemap:false,rolldownOptions:{input:fileURLToPath(new URL('./src/login/main.ts',import.meta.url))}}});
