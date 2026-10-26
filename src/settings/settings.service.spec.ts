import { BadRequestException } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { CAPTURE_INTERVAL_EVENT } from './settings.constants';

describe('SettingsService (capture interval)', () => {
  const repo = { findOne: jest.fn(), save: jest.fn() };
  const registry = { broadcast: jest.fn().mockReturnValue(true) };
  let service: SettingsService;

  beforeEach(() => {
    jest.resetAllMocks();
    registry.broadcast.mockReturnValue(true);
    service = new SettingsService(repo as any, registry as any);
  });

  it('devuelve 300s por defecto si no hay fila', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(service.getCaptureInterval()).resolves.toEqual({
      seconds: 300,
      updatedAt: null,
    });
  });

  it('ignora un valor corrupto en BD y usa el default', async () => {
    repo.findOne.mockResolvedValue({ value: 'abc', updatedAt: new Date('2026-10-20T00:00:00Z') });
    const res = await service.getCaptureInterval();
    expect(res.seconds).toBe(300);
  });

  it.each([0, 59, 90, 3660, 1.5, NaN])('rechaza %p', async (value) => {
    await expect(service.setCaptureInterval(value as number, 'u1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.save).not.toHaveBeenCalled();
    expect(registry.broadcast).not.toHaveBeenCalled();
  });

  it('guarda y hace broadcast a todos los dispositivos', async () => {
    repo.save.mockResolvedValue(undefined);
    repo.findOne.mockResolvedValue({ value: 600, updatedAt: new Date('2026-10-20T20:00:00Z') });

    const res = await service.setCaptureInterval(600, 'admin-1');

    expect(repo.save).toHaveBeenCalledWith({
      key: 'capture_interval_seconds',
      value: 600,
      updatedBy: 'admin-1',
    });
    expect(registry.broadcast).toHaveBeenCalledWith(CAPTURE_INTERVAL_EVENT, res);
    expect(res.seconds).toBe(600);
  });
});
