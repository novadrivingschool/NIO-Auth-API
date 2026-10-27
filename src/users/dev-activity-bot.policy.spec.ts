import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Role } from './entities/user.entity';
import {
  assertDevActivityBotChangeAllowed,
  isDevActivityBotEnabled,
} from './dev-activity-bot.policy';

describe('dev-activity-bot.policy', () => {
  const previous = process.env.DEV_ACTIVITY_BOT;
  const setFlag = (v?: string) => {
    if (v === undefined) delete process.env.DEV_ACTIVITY_BOT;
    else process.env.DEV_ACTIVITY_BOT = v;
  };

  afterEach(() => setFlag(previous));

  describe('isDevActivityBotEnabled', () => {
    it.each([
      [undefined, false],
      ['', false],
      ['false', false],
      ['1', false],
      ['yes', false],
      ['true', true],
      [' TRUE ', true],
    ])('DEV_ACTIVITY_BOT=%p → %p', (value, expected) => {
      setFlag(value);
      expect(isDevActivityBotEnabled()).toBe(expected);
    });
  });

  describe('assertDevActivityBotChangeAllowed', () => {
    const superAdmin = [Role.SUPER_ADMIN];

    it('no valida nada si el payload no trae dev_activity_bot', () => {
      setFlag(undefined);
      expect(() =>
        assertDevActivityBotChangeAllowed([Role.EMPLOYEE], undefined),
      ).not.toThrow();
      expect(() =>
        assertDevActivityBotChangeAllowed(undefined, null),
      ).not.toThrow();
      expect(() => assertDevActivityBotChangeAllowed([], {})).not.toThrow();
    });

    it('403 si la variable está apagada, incluso para super_admin (true y false)', () => {
      setFlag(undefined);
      for (const value of [true, false]) {
        expect(() =>
          assertDevActivityBotChangeAllowed(superAdmin, {
            dev_activity_bot: value,
          }),
        ).toThrow(ForbiddenException);
      }
      setFlag('false');
      expect(() =>
        assertDevActivityBotChangeAllowed(superAdmin, {
          dev_activity_bot: true,
        }),
      ).toThrow(ForbiddenException);
    });

    it('403 si quien edita no es super_admin, con la variable en true', () => {
      setFlag('true');
      for (const roles of [[Role.ADMIN], [Role.EMPLOYEE], [], undefined]) {
        expect(() =>
          assertDevActivityBotChangeAllowed(roles, { dev_activity_bot: true }),
        ).toThrow(ForbiddenException);
      }
    });

    it('permite a super_admin con la variable en true (activar y desactivar)', () => {
      setFlag('true');
      for (const value of [true, false]) {
        expect(() =>
          assertDevActivityBotChangeAllowed(superAdmin, {
            dev_activity_bot: value,
          }),
        ).not.toThrow();
      }
    });

    it('400 si el valor no es booleano (p. ej. null)', () => {
      setFlag('true');
      expect(() =>
        assertDevActivityBotChangeAllowed(superAdmin, {
          dev_activity_bot: null,
        }),
      ).toThrow(BadRequestException);
    });
  });
});
