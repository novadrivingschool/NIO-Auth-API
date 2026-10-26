import { DevicesRegistry } from './devices.registry';

const presence = (over: Partial<Parameters<DevicesRegistry['set']>[0]> = {}) => ({
  deviceId: 'd1',
  socketId: 's1',
  userId: 'u1',
  sid: 'sid1',
  connectedAt: 1000,
  onShift: false,
  ...over,
});

describe('DevicesRegistry (canal de control)', () => {
  it('setOnShift actualiza la presencia del socket y getByUser la devuelve', () => {
    const r = new DevicesRegistry();
    r.set(presence());
    expect(r.getByUser('u1')?.onShift).toBe(false);
    expect(r.setOnShift('s1', true)?.onShift).toBe(true);
    expect(r.getByUser('u1')?.onShift).toBe(true);
    expect(r.setOnShift('desconocido', true)).toBeNull();
  });

  it('getByUser devuelve la conexión más reciente y null si no hay', () => {
    const r = new DevicesRegistry();
    expect(r.getByUser('u1')).toBeNull();
    r.set(presence({ deviceId: 'a', socketId: 'sa', connectedAt: 1 }));
    r.set(presence({ deviceId: 'b', socketId: 'sb', connectedAt: 5 }));
    expect(r.getByUser('u1')?.deviceId).toBe('b');
  });

  describe('requestAck', () => {
    const ioWith = (emitWithAck: jest.Mock) => {
      const timeout = jest.fn(() => ({ emitWithAck }));
      const to = jest.fn(() => ({ timeout }));
      return { io: { to } as any, to, timeout };
    };

    it('delivered=false si el dispositivo no está en el registry', async () => {
      const r = new DevicesRegistry();
      r.setServer(ioWith(jest.fn()).io);
      expect(await r.requestAck('nope', 'clock:command', {}, 1000)).toEqual({ delivered: false });
    });

    it('devuelve la respuesta del cliente (primer ack)', async () => {
      const emitWithAck = jest.fn(async () => [{ ok: true, recordId: 3 }]);
      const { io, to, timeout } = ioWith(emitWithAck);
      const r = new DevicesRegistry();
      r.setServer(io);
      r.set(presence());
      const res = await r.requestAck('d1', 'clock:command', { a: 1 }, 5000);
      expect(res).toEqual({ delivered: true, response: { ok: true, recordId: 3 } });
      expect(to).toHaveBeenCalledWith('s1');
      expect(timeout).toHaveBeenCalledWith(5000);
      expect(emitWithAck).toHaveBeenCalledWith('clock:command', { a: 1 });
    });

    it('delivered=false si el cliente no confirma a tiempo (rechazo del timeout)', async () => {
      const { io } = ioWith(jest.fn(async () => { throw new Error('operation has timed out'); }));
      const r = new DevicesRegistry();
      r.setServer(io);
      r.set(presence());
      expect(await r.requestAck('d1', 'clock:command', {}, 10)).toEqual({ delivered: false });
    });
  });
});
