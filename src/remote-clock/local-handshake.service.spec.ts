import { HANDSHAKE_TTL_MS, LocalHandshakeService } from './local-handshake.service';

const registryWith = (...sids: { userId: string; sid: string }[]) =>
  ({ listByUser: jest.fn((u: string) => sids.filter((p) => p.userId === u)) }) as any;

describe('LocalHandshakeService', () => {
  it('pasa cuando la app del mismo usuario lo canjeó y su socket sigue vivo', () => {
    const svc = new LocalHandshakeService(registryWith({ userId: 'u1', sid: 's1' }));
    const { nonce } = svc.issue('u1');
    expect(svc.redeem('u1', 's1', nonce)).toBe(true);
    expect(svc.evaluate('u1', nonce)).toBeNull();
  });

  it('el nonce es de un solo uso', () => {
    const svc = new LocalHandshakeService(registryWith({ userId: 'u1', sid: 's1' }));
    const { nonce } = svc.issue('u1');
    svc.redeem('u1', 's1', nonce);
    expect(svc.evaluate('u1', nonce)).toBeNull();
    expect(svc.evaluate('u1', nonce)).toBe('HANDSHAKE_INVALID');
  });

  it('NOT_LOCAL si nadie lo canjeó (no hay app en este equipo)', () => {
    const svc = new LocalHandshakeService(registryWith({ userId: 'u1', sid: 's1' }));
    const { nonce } = svc.issue('u1');
    expect(svc.evaluate('u1', nonce)).toBe('DESKTOP_APP_NOT_LOCAL');
  });

  it('OTHER_USER si lo canjeó la app de otro usuario', () => {
    const svc = new LocalHandshakeService(registryWith({ userId: 'u2', sid: 's2' }));
    const { nonce } = svc.issue('u1');
    svc.redeem('u2', 's2', nonce);
    expect(svc.evaluate('u1', nonce)).toBe('DESKTOP_APP_OTHER_USER');
  });

  it('REQUIRED si la app lo canjeó pero su socket ya no está (o es otra sesión)', () => {
    const svc = new LocalHandshakeService(registryWith({ userId: 'u1', sid: 'otra-laptop' }));
    const { nonce } = svc.issue('u1');
    svc.redeem('u1', 's1', nonce);
    expect(svc.evaluate('u1', nonce)).toBe('DESKTOP_APP_REQUIRED');
  });

  it('INVALID si caducó, es de otro usuario o no existe', () => {
    const svc = new LocalHandshakeService(registryWith({ userId: 'u1', sid: 's1' }));
    const t0 = 1_000_000;
    const { nonce } = svc.issue('u1', t0);
    expect(svc.redeem('u1', 's1', nonce, t0 + HANDSHAKE_TTL_MS + 1)).toBe(false);
    expect(svc.evaluate('u1', nonce, t0 + HANDSHAKE_TTL_MS + 1)).toBe('HANDSHAKE_INVALID');
    const b = svc.issue('u1');
    expect(svc.evaluate('u2', b.nonce)).toBe('HANDSHAKE_INVALID');
    expect(svc.evaluate('u1', 'x'.repeat(24))).toBe('HANDSHAKE_INVALID');
  });

  it('no deja canjear dos veces el mismo nonce', () => {
    const svc = new LocalHandshakeService(registryWith());
    const { nonce } = svc.issue('u1');
    expect(svc.redeem('u1', 's1', nonce)).toBe(true);
    expect(svc.redeem('u9', 's9', nonce)).toBe(false);
  });

  it('un usuario no puede acumular más de 10 nonces ni desplazar a otro', () => {
    const svc = new LocalHandshakeService(registryWith({ userId: 'u2', sid: 's2' }));
    const other = svc.issue('u2');
    svc.redeem('u2', 's2', other.nonce);
    const first = svc.issue('u1');
    for (let i = 0; i < 12; i++) svc.issue('u1');
    expect(svc.evaluate('u1', first.nonce)).toBe('HANDSHAKE_INVALID'); // el más viejo salió
    expect(svc.evaluate('u2', other.nonce)).toBeNull(); // el de otro usuario sigue
  });
});
