import { HttpException } from '@nestjs/common';
import { LoginThrottleService } from './login-throttle.service';

const ID = 'user@example.com';
const IP = '203.0.113.7';

describe('LoginThrottleService', () => {
  let service: LoginThrottleService;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-07-12T12:00:00Z') });
    service = new LoginThrottleService();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function expect429(fn: () => void) {
    let caught: HttpException | undefined;
    try {
      fn();
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught).toBeInstanceOf(HttpException);
    expect(caught!.getStatus()).toBe(429);
    expect(caught!.getResponse()).toMatchObject({
      code: 'TOO_MANY_ATTEMPTS',
      retryAfterSeconds: expect.any(Number),
    });
    return caught!;
  }

  it('permite pasar con menos de 5 fallos por identifier', () => {
    for (let i = 0; i < 4; i++) service.registerFailure(ID, IP);
    expect(() => service.check(ID, IP)).not.toThrow();
  });

  it('bloquea al 5º fallo por identifier con retryAfterSeconds', () => {
    for (let i = 0; i < 5; i++) service.registerFailure(ID, IP);
    const err = expect429(() => service.check(ID, IP));
    const body = err.getResponse() as any;
    expect(body.retryAfterSeconds).toBeGreaterThan(0);
    expect(body.retryAfterSeconds).toBeLessThanOrEqual(15 * 60);
  });

  it('bloquea por IP a los 20 fallos aunque los identifiers sean distintos', () => {
    for (let i = 0; i < 20; i++) {
      service.registerFailure(`victim-${i}@example.com`, IP);
    }
    // identifier nuevo, misma IP → bloqueado
    expect429(() => service.check('fresh@example.com', IP));
    // misma cantidad de fallos NO bloquea a otra IP
    expect(() => service.check('fresh@example.com', '198.51.100.9')).not.toThrow();
  });

  it('los fallos fuera de la ventana de 15 min no cuentan (ventana deslizante)', () => {
    for (let i = 0; i < 4; i++) service.registerFailure(ID, IP);
    // Avanza más allá de la ventana
    jest.setSystemTime(Date.now() + 16 * 60_000);
    service.registerFailure(ID, IP); // este sería el 5º, pero los otros expiraron
    expect(() => service.check(ID, IP)).not.toThrow();
  });

  it('el bloqueo expira a los 15 min', () => {
    for (let i = 0; i < 5; i++) service.registerFailure(ID, IP);
    expect429(() => service.check(ID, IP));

    jest.setSystemTime(Date.now() + 15 * 60_000 + 1000);
    expect(() => service.check(ID, IP)).not.toThrow();
  });

  it('registerSuccess limpia los contadores', () => {
    for (let i = 0; i < 4; i++) service.registerFailure(ID, IP);
    service.registerSuccess(ID, IP);
    // Otros 4 fallos no bloquean porque el contador se reinició
    for (let i = 0; i < 4; i++) service.registerFailure(ID, IP);
    expect(() => service.check(ID, IP)).not.toThrow();
  });

  it('registerSuccess de una cuenta NO desbloquea a otra', () => {
    for (let i = 0; i < 5; i++) service.registerFailure(ID, IP);
    service.registerSuccess('other@example.com', '198.51.100.9');
    expect429(() => service.check(ID, IP));
  });
});
