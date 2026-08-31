import assert from 'node:assert/strict';
import { fork } from 'node:child_process';

const activeChildren = new Set();

export async function spawnP2004WorkerStage({ databaseUrl, deliveryId, mode, timeoutMs = 10_000 }) {
  const child = fork(new URL('./p2-004-worker-child.mjs', import.meta.url), [], {
    cwd: process.cwd(), silent: true,
    env: {
      ...process.env,
      P2_004_CHILD_DATABASE_URL: databaseUrl,
      P2_004_CHILD_DELIVERY_ID: deliveryId,
      P2_004_CHILD_MODE: mode,
    },
  });
  activeChildren.add(child);
  const stage = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('P2_004_WORKER_CHILD_STAGE_TIMEOUT')), timeoutMs);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code, signal) => {
      if (code !== null || signal !== null) {
        clearTimeout(timer);
        reject(new Error('P2_004_WORKER_CHILD_EXITED_BEFORE_STAGE'));
      }
    });
    child.on('message', (message) => {
      if (message?.stage === mode) { clearTimeout(timer); resolve(message.stage); }
    });
  });
  assert.equal(stage, mode);
  return child;
}

export async function killP2004WorkerChild(child) {
  if (!activeChildren.has(child)) throw new TypeError('P2_004_WORKER_CHILD_NOT_OWNED');
  const exit = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  child.kill('SIGKILL');
  const result = await exit;
  activeChildren.delete(child);
  child.stdout?.destroy(); child.stderr?.destroy();
  return result;
}

export function assertNoP2004WorkerChildResidual() {
  assert.equal(activeChildren.size, 0);
  return Object.freeze({ worker_child_count: 0 });
}
