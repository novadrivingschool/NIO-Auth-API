import { DevicesRegistry } from './devices.registry';

const presence = (socketId: string, connectedAt: number) => ({
  deviceId: 'dev-1',
  socketId,
  userId: 'user-1',
  sid: 'sid-1',
  connectedAt,
  onShift: false,
});

describe('DevicesRegistry', () => {
  let registry: DevicesRegistry;
  beforeEach(() => {
    registry = new DevicesRegistry();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('un socket obsoleto que se desconecta tarde NO borra la presencia del socket nuevo', () => {
    registry.set(presence('old', 1)); // app abierta
    registry.set(presence('new', 2)); // Exit + reabrir: el socket nuevo se registra primero
    registry.deleteBySocket('old'); // el servidor detecta tarde la caída del viejo
    expect(registry.getByUser('user-1')?.socketId).toBe('new');
    expect(registry.setOnShift('new', true)?.onShift).toBe(true);
  });

  it('la desconexión del socket vigente sí elimina la presencia', () => {
    registry.set(presence('s1', 1));
    registry.deleteBySocket('s1');
    expect(registry.getByUser('user-1')).toBeNull();
  });
});
