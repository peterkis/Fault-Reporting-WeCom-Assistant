import type { ChildProcess, ForkOptions } from 'node:child_process';
export type P2016Role = 'APP' | 'WORKER' | 'GATEWAY';
export type P2016RoleMessage = { type: 'role-ready'; role: P2016Role; address?: unknown; cookies?: { expires: unknown }[] | null } | { type: 'role-failed'; role: P2016Role; error_code: string } | { type: 'role-stopped'; role: P2016Role };
export type P2016SupervisorCommand = { type: 'peer-status'; gateway_authenticated: boolean; worker_ready: boolean } | { type: 'stop' };
// IPC remains untrusted until the existing type/role comparisons below. Non-discriminant fields stay unknown.
interface IpcObservation { type?: unknown; role?: unknown; address?: unknown; cookies?: unknown; error_code?: unknown }
import { fork } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const stateDirectory = process.env.SS011_MANAGEMENT_STATE;
if (!stateDirectory) throw new Error('P2_016_MANAGEMENT_STATE_REQUIRED');
mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });

const children = new Map<P2016Role, ChildProcess>();
let stopping = false;
let workerReady = false;

function childOptions(): ForkOptions {
  return { cwd: '/app', env: process.env, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] };
}

function publishPeerStatus() {
  const app = children.get('APP');
  if (app?.connected) app.send({ type: 'peer-status', gateway_authenticated: true, worker_ready: workerReady });
}

function stopChild(child: ChildProcess | undefined) {
  if (child?.connected) child.send({ type: 'stop' });
  setTimeout(() => child?.kill('SIGTERM'), 12_000).unref();
}

function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children.values()) stopChild(child);
}

function failed(role: P2016Role, errorCode: unknown) {
  if (stopping) return;
  console.error(JSON.stringify({ event: 'P2_016_ROLE_FAILED', role, error_code: errorCode ?? 'P2_016_PROCESS_FAILED' }));
  stop();
  process.exitCode = 1;
}

function attach(role: P2016Role, child: ChildProcess) {
  children.set(role, child);
  child.on('message', (message: unknown) => {
    if ((message as IpcObservation | null)?.type === 'role-ready' && (message as IpcObservation).role === role) {
      if (role === 'APP') {
        writeFileSync(`${stateDirectory}/staff-cookies.json`, JSON.stringify({
          address: (message as IpcObservation).address, cookies: (message as IpcObservation).cookies ?? null, expires_at: (message as { cookies?: { expires?: unknown }[] | null }).cookies?.[0]?.expires ?? null,
        }) + '\n', { mode: 0o600 });
        publishPeerStatus();
      }
      if (role === 'WORKER') {
        workerReady = true;
        publishPeerStatus();
      }
      console.log(JSON.stringify({ event: 'P2_016_ROLE_READY', role, address: (message as IpcObservation).address ?? null }));
    }
    if ((message as IpcObservation | null)?.type === 'role-failed') failed(role, (message as IpcObservation).error_code);
    if ((message as IpcObservation | null)?.type === 'role-stopped' && role === 'WORKER') {
      workerReady = false;
      publishPeerStatus();
    }
  });
  child.once('error', error => failed(role, (error as NodeJS.ErrnoException).code ?? 'P2_016_PROCESS_FAILED'));
  child.once('exit', (code, signal) => {
    children.delete(role);
    if (role === 'WORKER') {
      workerReady = false;
      publishPeerStatus();
    }
    if (!stopping && (code !== 0 || signal)) failed(role, 'P2_016_PROCESS_FAILED');
    if (stopping && children.size === 0) process.exit(0);
  });
}

process.once('SIGTERM', stop);
process.once('SIGINT', stop);
attach('APP', fork('/app/scripts/p2-016-process-role.mjs', ['--role=app'], childOptions()));
attach('WORKER', fork('/app/scripts/p2-016-process-role.mjs', ['--role=worker'], childOptions()));
