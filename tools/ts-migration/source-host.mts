import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sourceRoot, safeFile } from './common.mjs';
import { verifyArtifact } from './verify-artifact.mjs';

// Only a source-review host installs this hook. Production and staged tests do not.
export function installSourceHost(root: string): void {
  sourceRoot(root); verifyArtifact(root);
  registerHooks({ resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith('.') || specifier.startsWith('file:')) && context.parentURL) {
      const url = new URL(specifier, context.parentURL);
      if (url.protocol === 'file:') {
        const relative = path.relative(root, fileURLToPath(url)).split(path.sep).join('/');
        if (relative.startsWith('src/')) {
          const target = safeFile(path.join(root, '.build/runtime'), relative);
          return nextResolve(pathToFileURL(target).href, context);
        }
      }
    }
    return nextResolve(specifier, context);
  } });
}
