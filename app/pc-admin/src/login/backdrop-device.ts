interface PreparedDevice {
  kind: 'ready';
  gpu: {adapter: GPUAdapter; device: GPUDevice};
  loss: GPUDeviceLostInfo | null;
}

type FailureReason = 'unsupported' | 'no-adapter' | 'no-device';
type DevicePreparation = PreparedDevice | {kind: 'failed'; reason: FailureReason; error: unknown} | {kind: 'retired'};

let deviceRequest: Promise<DevicePreparation> | undefined;
let ownedDevice: PreparedDevice | undefined;
let retired = false;

async function requestDevice(): Promise<DevicePreparation> {
  let reason: FailureReason = 'unsupported';
  try {
    const gpu = navigator.gpu;
    if (!gpu) return {kind: 'failed', reason, error: new Error('WebGPU unavailable')};

    reason = 'no-adapter';
    const adapter = await gpu.requestAdapter({powerPreference: 'high-performance'});
    if (retired) return {kind: 'retired'};
    if (!adapter) return {kind: 'failed', reason, error: new Error('No WebGPU adapter')};

    reason = 'no-device';
    const device = await adapter.requestDevice({requiredFeatures: []});
    if (retired) {
      device.destroy();
      return {kind: 'retired'};
    }

    const prepared: PreparedDevice = {kind: 'ready', gpu: {adapter, device}, loss: null};
    ownedDevice = prepared;
    void device.lost.then(info => { prepared.loss = info; });
    return prepared;
  } catch (error) {
    if (retired) return {kind: 'retired'};
    return {kind: 'failed', reason, error};
  }
}

export function prepareBackdropDevice(): Promise<DevicePreparation> {
  if (retired) return Promise.resolve({kind: 'retired'});
  deviceRequest ??= requestDevice();
  return deviceRequest;
}

export function releaseLostBackdropDevice(prepared: PreparedDevice): boolean {
  if (retired || ownedDevice !== prepared || !prepared.loss) {
    return false;
  }
  ownedDevice = undefined;
  deviceRequest = undefined;
  return true;
}

export function retireBackdropDevice(): void {
  if (retired) return;
  retired = true;
  const prepared = ownedDevice;
  ownedDevice = undefined;
  deviceRequest = undefined;
  prepared?.gpu.device.destroy();
}
