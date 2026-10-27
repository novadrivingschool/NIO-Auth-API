import { HttpException } from '@nestjs/common';
import { RemoteClockService } from './remote-clock.service';

function build(opts: {
  external?: string | null;
  linked?: boolean;
  presence?: { deviceId: string; onShift: boolean; connectedAt: number } | null;
  ack?: { delivered: boolean; response?: any };
}) {
  const usersRepo = {
    findOne: jest.fn(async () => ({
      id: 'u1',
      profile: {
        external_employee_number: opts.external === undefined ? 'EXT-1' : opts.external,
        activity_linked: opts.linked ?? true,
      },
    })),
  };
  const registry = {
    getByUser: jest.fn(() => opts.presence ?? null),
    requestAck: jest.fn(async () => opts.ack ?? { delivered: true, response: { ok: true, recordId: 7 } }),
  };
  const config = { get: jest.fn(() => undefined) };
  const service = new RemoteClockService(usersRepo as any, registry as any, config as any);
  return { service, registry };
}

const presence = { deviceId: 'd1', onShift: false, connectedAt: Date.now() };

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    return ((e as HttpException).getResponse() as any)?.code;
  }
  return undefined;
}

describe('RemoteClockService.request', () => {
  it('409 NOT_LINKED y no envía nada a la app si el usuario está en modo independiente (NIO | AR)', async () => {
    const { service, registry } = build({ presence, linked: false });
    expect(await codeOf(service.request('u1', 'EXT-1', 'CLOCK_IN'))).toBe('NOT_LINKED');
    expect(registry.requestAck).not.toHaveBeenCalled();
  });

  it('403 EXTERNAL_MISMATCH si el externo no es del usuario del token', async () => {
    const { service, registry } = build({ presence });
    expect(await codeOf(service.request('u1', 'OTRO-9', 'CLOCK_IN'))).toBe('EXTERNAL_MISMATCH');
    expect(registry.requestAck).not.toHaveBeenCalled();
  });

  it('403 NO_EXTERNAL_NUMBER si el perfil no tiene externo', async () => {
    const { service } = build({ presence, external: null });
    expect(await codeOf(service.request('u1', 'EXT-1', 'CLOCK_IN'))).toBe('NO_EXTERNAL_NUMBER');
  });

  it('409 DEVICE_UNAVAILABLE si no hay socket', async () => {
    const { service } = build({ presence: null });
    expect(await codeOf(service.request('u1', 'EXT-1', 'CLOCK_IN'))).toBe('DEVICE_UNAVAILABLE');
  });

  it('409 DEVICE_UNAVAILABLE si el socket no confirma (ack timeout)', async () => {
    const { service } = build({ presence, ack: { delivered: false } });
    expect(await codeOf(service.request('u1', 'EXT-1', 'CLOCK_OUT'))).toBe('DEVICE_UNAVAILABLE');
  });

  it('propaga el código de rechazo de la app', async () => {
    const { service } = build({
      presence,
      ack: { delivered: true, response: { ok: false, code: 'BUSY', message: 'cooldown' } },
    });
    expect(await codeOf(service.request('u1', 'EXT-1', 'CLOCK_IN'))).toBe('BUSY');
  });

  it('ok: compara el externo sin importar mayúsculas y envía el comando con source ACTIVITY_REPORT', async () => {
    const { service, registry } = build({ presence });
    const res = await service.request('u1', ' ext-1 ', 'CLOCK_IN');
    expect(res).toMatchObject({ ok: true, action: 'CLOCK_IN', recordId: 7, alreadyInState: false });
    expect(registry.requestAck).toHaveBeenCalledWith(
      'd1',
      'clock:command',
      expect.objectContaining({ action: 'CLOCK_IN', source: 'ACTIVITY_REPORT', requestedBy: 'u1' }),
      15000,
    );
  });

  it('409 COMMAND_IN_PROGRESS si hay otro comando del mismo usuario en curso', async () => {
    let release!: (v: any) => void;
    const { service, registry } = build({ presence });
    (registry.requestAck as jest.Mock).mockImplementationOnce(
      () => new Promise((r) => (release = r)),
    );
    const first = service.request('u1', 'EXT-1', 'CLOCK_IN');
    await new Promise((r) => setImmediate(r));
    expect(await codeOf(service.request('u1', 'EXT-1', 'CLOCK_IN'))).toBe('COMMAND_IN_PROGRESS');
    release({ delivered: true, response: { ok: true } });
    await first;
  });
});

describe('RemoteClockService.status', () => {
  it('connected/onShift según la presencia', () => {
    const { service } = build({ presence: { deviceId: 'd1', onShift: true, connectedAt: 0 } });
    expect(service.status('u1')).toMatchObject({ connected: true, onShift: true });
    const none = build({ presence: null }).service.status('u1');
    expect(none).toMatchObject({ connected: false, onShift: false, connectedAt: null });
  });
});
