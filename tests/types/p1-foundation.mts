import { validatePilotConfig, parseCliArgs, runPilotPreflight, listenPilotFoundation, closePilotFoundation, createPilotFoundationServer } from '../../src/p1-001-pilot-foundation.mjs';

const config = validatePilotConfig(process.env);
const phase: 'P1' = config.phase;
const baseline: 'V1.2' = config.architectureBaseline;
const disabled: false = config.featureFlags.aiTriageEnabled;
const mode: 'check' | 'serve' = parseCliArgs(['--check']).mode;
void [phase, baseline, disabled, mode];
// @ts-expect-error -- CLI arguments must be strings, never numeric tokens.
parseCliArgs([1]);
const preflight = runPilotPreflight();
if (preflight.ok) {
  preflight.config.wecom.botId.toUpperCase();
} else {
  const errorCode: 'P1_CONFIG_INVALID' = preflight.errorCode;
  // @ts-expect-error -- Failed preflight does not provide a validated config.
  preflight.config;
  void errorCode;
}
const server = createPilotFoundationServer();
await listenPilotFoundation(server, { port: 0 });
await closePilotFoundation(server);
// @ts-expect-error -- Listening ports are numeric after configuration validation.
listenPilotFoundation(server, { port: '3100' });
