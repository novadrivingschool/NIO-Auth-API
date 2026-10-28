import { ConflictException, GatewayTimeoutException, HttpException } from '@nestjs/common';
import { HandshakesService, PING_COOLDOWN_MS, PING_REQUEST_EVENT, PING_TIMEOUT_MS } from './handshakes.service';

describe('HandshakesService.ping', () => {
  const ADMIN = 'admin-1';
  const TARGET = 'user-1';
  let registry: { getByUser: jest.Mock; requestAck: jest.Mock };
  let service: HandshakesService;
  let nowSpy: jest.SpyInstance;
  let clock: number;

  beforeEach(() => {
    clock = 1_000_000;
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => clock);
    registry = {
      getByUser: jest.fn().mockReturnValue({ deviceId: 'dev-1', userId: TARGET }),
      requestAck: jest.fn().mockImplementation(async () => {
        clock += 42;
        return { delivered: true, response: { ok: true } };
      }),
    };
    service = new HandshakesService({} as any, registry as any);
  });

  afterEach(() => nowSpy.mockRestore());

  it('envía ping:request al dispositivo y devuelve la latencia', async () => {
    const res = await service.ping(ADMIN, TARGET);

    expect(registry.requestAck).toHaveBeenCalledWith(
      'dev-1',
      PING_REQUEST_EVENT,
      expect.objectContaining({ pingId: expect.any(String), sentAt: expect.any(String) }),
      PING_TIMEOUT_MS,
    );
    expect(res).toMatchObject({ ok: true, targetUserId: TARGET, deviceId: 'dev-1', rttMs: 42 });
  });

  it('responde 409 si el usuario no tiene el NIO conectado', async () => {
    registry.getByUser.mockReturnValue(null);
    await expect(service.ping(ADMIN, TARGET)).rejects.toBeInstanceOf(ConflictException);
    expect(registry.requestAck).not.toHaveBeenCalled();
  });

  it('responde 504 si el dispositivo no confirma', async () => {
    registry.requestAck.mockResolvedValue({ delivered: false });
    await expect(service.ping(ADMIN, TARGET)).rejects.toBeInstanceOf(GatewayTimeoutException);
  });

  it('limita la frecuencia: segundo ping inmediato → 429; pasado el cooldown vuelve a funcionar', async () => {
    await service.ping(ADMIN, TARGET);
    await expect(service.ping(ADMIN, TARGET)).rejects.toMatchObject({ status: 429 });
    await expect(service.ping(ADMIN, TARGET)).rejects.toBeInstanceOf(HttpException);

    clock += PING_COOLDOWN_MS + 1;
    await expect(service.ping(ADMIN, TARGET)).resolves.toMatchObject({ ok: true });
  });

  it('el límite es por par admin/usuario', async () => {
    await service.ping(ADMIN, TARGET);
    await expect(service.ping('admin-2', TARGET)).resolves.toMatchObject({ ok: true });
  });
});
