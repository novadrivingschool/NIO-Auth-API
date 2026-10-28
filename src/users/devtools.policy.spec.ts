import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Role } from './entities/user.entity';
import { assertDevtoolsChangeAllowed } from './devtools.policy';

describe('devtools.policy', () => {
  const superAdmin = [Role.SUPER_ADMIN];
  const admin = [Role.ADMIN];

  it('no valida nada si el payload no trae devtools_enabled', () => {
    expect(() =>
      assertDevtoolsChangeAllowed([Role.EMPLOYEE], undefined),
    ).not.toThrow();
    expect(() => assertDevtoolsChangeAllowed(undefined, null)).not.toThrow();
    expect(() => assertDevtoolsChangeAllowed([], {})).not.toThrow();
  });

  it('403 si quien edita no es super_admin ni admin (encender o apagar)', () => {
    for (const roles of [[Role.EMPLOYEE], [Role.CUSTOMER], [], undefined]) {
      for (const value of [true, false]) {
        expect(() =>
          assertDevtoolsChangeAllowed(roles, { devtools_enabled: value }),
        ).toThrow(ForbiddenException);
      }
    }
  });

  it('permite a super_admin y admin encender y apagar', () => {
    for (const roles of [superAdmin, admin, [Role.EMPLOYEE, Role.ADMIN]]) {
      for (const value of [true, false]) {
        expect(() =>
          assertDevtoolsChangeAllowed(roles, { devtools_enabled: value }),
        ).not.toThrow();
      }
    }
  });

  it('400 si el valor no es booleano (p. ej. null)', () => {
    expect(() =>
      assertDevtoolsChangeAllowed(superAdmin, { devtools_enabled: null }),
    ).toThrow(BadRequestException);
  });
});
