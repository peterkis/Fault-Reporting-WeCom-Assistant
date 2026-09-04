import { monitorEventLoopDelay } from 'node:perf_hooks';

export const P2_G1_PROCESS_ROLES = Object.freeze(['APP', 'WORKER', 'GATEWAY']);

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

export function createP2G1ProcessMetrics({ role } = {}) {
  if (!P2_G1_PROCESS_ROLES.includes(role)) throw new TypeError('P2_G1_PROCESS_ROLE_INVALID');
  const delay = monitorEventLoopDelay({ resolution: 20 });
  delay.enable();
  let closed = false;
  let previousCpu = process.cpuUsage();
  let previousCpuAt = process.hrtime.bigint();

  function sample() {
    if (closed) throw new Error('P2_G1_PROCESS_METRICS_CLOSED');
    const memory = process.memoryUsage();
    const cpu = process.cpuUsage();
    const cpuAt = process.hrtime.bigint();
    const elapsedMicroseconds = Number(cpuAt - previousCpuAt) / 1_000;
    const cpuPercent = elapsedMicroseconds > 0
      ? ((cpu.user - previousCpu.user) + (cpu.system - previousCpu.system)) / elapsedMicroseconds * 100
      : 0;
    previousCpu = cpu;
    previousCpuAt = cpuAt;
    const resources = typeof process.getActiveResourcesInfo === 'function' ? process.getActiveResourcesInfo() : [];
    const handles = typeof process._getActiveHandles === 'function' ? process._getActiveHandles() : [];
    return Object.freeze({
      role,
      rss_bytes: safeNumber(memory.rss),
      heap_used_bytes: safeNumber(memory.heapUsed),
      heap_total_bytes: safeNumber(memory.heapTotal),
      external_bytes: safeNumber(memory.external),
      cpu_percent: Number(Math.max(0, cpuPercent).toFixed(3)),
      event_loop_delay_p95_ms: Number(delay.percentile(95) / 1e6),
      active_resources: resources.length,
      active_timers: resources.filter((name) => /Timeout|Timer/iu.test(name)).length,
      active_sockets: resources.filter((name) => /TCP|Socket|Pipe/iu.test(name)).length,
      active_file_handles: resources.filter((name) => /FSReq|FileHandle/iu.test(name)).length,
      active_handles: handles.length,
      uptime_seconds: Number(process.uptime().toFixed(3)),
    });
  }

  function close() {
    if (!closed) delay.disable();
    closed = true;
  }

  return Object.freeze({ sample, close });
}
