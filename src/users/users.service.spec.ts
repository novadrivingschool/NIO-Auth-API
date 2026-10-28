import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, UpdateResult } from 'typeorm';
import { User, Role } from './entities/user.entity';
import { UserProfile } from './entities/user-profile.entity';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

function makeProfile(overrides = {}): UserProfile {
  return { id: 'p1', firstName: 'Mateo', lastName: 'Torres', phone: null,
    birthdate: null, gender: null, userName: 'mateoT', avatarUrl: null,
    metadata: null, employee_number: null, external_employee_number: null, createdAt: new Date(), updatedAt: new Date(),
    ...overrides } as unknown as UserProfile;
}

function makeUser(overrides = {}): User {
  return { id: 'u1', email: 'test@example.com', passwordHash: 'hashed',
    roles: [Role.EMPLOYEE], isActive: true, refreshTokenHash: null,
    createdAt: new Date(), updatedAt: new Date(), profile: makeProfile(),
    ...overrides } as User;
}

const makeRepoMock = () => ({
  findOne: jest.fn(), find: jest.fn(), create: jest.fn(), exists: jest.fn().mockResolvedValue(false),
  save: jest.fn(), delete: jest.fn(), update: jest.fn(), createQueryBuilder: jest.fn(),
});

const makeDataSourceMock = () => ({ transaction: jest.fn() });

/** QueryBuilder mínimo para `assertExternalEmployeeNumberAvailable` (where/andWhere/getExists). */
const mockExternalNumberTaken = (repo: any, taken: boolean) => {
  const qb: any = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getExists: jest.fn().mockResolvedValue(taken),
  };
  repo.createQueryBuilder.mockReturnValue(qb);
  return qb;
};

describe('UsersService', () => {
  let service: UsersService;
  let repo: ReturnType<typeof makeRepoMock>;
  let profileRepo: ReturnType<typeof makeRepoMock>;
  let dataSource: ReturnType<typeof makeDataSourceMock>;
  const bcryptHashSpy = jest.spyOn(bcrypt, 'hash');

  beforeEach(async () => {
    repo = makeRepoMock();
    profileRepo = makeRepoMock();
    dataSource = makeDataSourceMock();
    bcryptHashSpy.mockReset().mockResolvedValue('hashed_pw' as any);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: repo },
        { provide: getRepositoryToken(UserProfile), useValue: profileRepo },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('debe estar definido', () => expect(service).toBeDefined());

  // getEmployeeNumber
  describe('getEmployeeNumber', () => {
    it('genera NIO{INICIALES}{6digits} - Mateo Torres -> NIOMT', () => {
      expect(service.getEmployeeNumber('Mateo', 'Torres')).toMatch(/^NIOMT\d{6}$/);
    });
    it('convierte iniciales a mayusculas', () => {
      expect(service.getEmployeeNumber('john', 'doe')).toMatch(/^NIOJD\d{6}$/);
    });
    it('Ximena Izurieta -> NIOXI', () => {
      expect(service.getEmployeeNumber('Ximena', 'Izurieta')).toMatch(/^NIOXI\d{6}$/);
    });
  });

  // CREATE
  describe('create', () => {
    function setupManager(returnUser: User) {
      const manager = {
        create: jest.fn().mockImplementation((_E: any, data: any) => ({ ...data })),
        save: jest.fn().mockResolvedValue({}),
        findOne: jest.fn().mockResolvedValue(returnUser),
      };
      dataSource.transaction.mockImplementation((cb: any) => cb(manager));
      return manager;
    }

    it('genera employee_number correcto al crear con nombre', async () => {
      repo.findOne.mockResolvedValue(null);
      const mgr = setupManager(makeUser());
      await service.create({ email: 'mateo@nova.com', password: 'secreto123',
        profile: { firstName: 'Mateo', lastName: 'Torres', avatarUrl: '' } } as any);
      const pCall = mgr.create.mock.calls.find((c: any[]) => c[0] === UserProfile);
      expect(pCall[1].employee_number).toMatch(/^NIOMT\d{6}$/);
    });

    it('fallback NIOJD sin nombre', async () => {
      repo.findOne.mockResolvedValue(null);
      const mgr = setupManager(makeUser());
      await service.create({ email: 'x@x.com', password: 'secreto123',
        profile: { avatarUrl: '' } } as any);
      const pCall = mgr.create.mock.calls.find((c: any[]) => c[0] === UserProfile);
      expect(pCall[1].employee_number).toMatch(/^NIOJD\d{6}$/);
    });

    describe('external_employee_number (app de RR.HH.)', () => {
      it('lo guarda recortado y NO afecta al employee_number del NIO (se sigue autogenerando)', async () => {
        repo.findOne.mockResolvedValue(null);
        mockExternalNumberTaken(profileRepo, false);
        const mgr = setupManager(makeUser());
        await service.create({ email: 'mateo@nova.com', password: 'secreto123',
          profile: { firstName: 'Mateo', lastName: 'Torres', external_employee_number: '  48213 ' } } as any);
        const pCall = mgr.create.mock.calls.find((c: any[]) => c[0] === UserProfile);
        expect(pCall[1].external_employee_number).toBe('48213');
        expect(pCall[1].employee_number).toMatch(/^NIOMT\d{6}$/);
      });

      it('sin valor o vacío queda null y no consulta unicidad', async () => {
        repo.findOne.mockResolvedValue(null);
        const mgr = setupManager(makeUser());
        await service.create({ email: 'x@x.com', password: 'secreto123',
          profile: { firstName: 'A', lastName: 'B', external_employee_number: '   ' } } as any);
        const pCall = mgr.create.mock.calls.find((c: any[]) => c[0] === UserProfile);
        expect(pCall[1].external_employee_number).toBeNull();
        expect(profileRepo.createQueryBuilder).not.toHaveBeenCalled();
      });

      it('BadRequest si ya lo tiene otro perfil (sin importar mayúsculas)', async () => {
        repo.findOne.mockResolvedValue(null);
        const qb = mockExternalNumberTaken(profileRepo, true);
        await expect(service.create({ email: 'x@x.com', password: 'secreto123',
          profile: { external_employee_number: 'ab-1' } } as any)).rejects.toBeInstanceOf(BadRequestException);
        expect(qb.where).toHaveBeenCalledWith(expect.stringContaining('UPPER'), { value: 'AB-1' });
        expect(dataSource.transaction).not.toHaveBeenCalled();
      });

      it('traduce la violación del índice único (carrera) a BadRequest', async () => {
        repo.findOne.mockResolvedValue(null);
        mockExternalNumberTaken(profileRepo, false);
        dataSource.transaction.mockRejectedValue(Object.assign(new Error('dup'), {
          driverError: { code: '23505', constraint: 'UQ_user_profiles_external_employee_number' },
        }));
        await expect(service.create({ email: 'x@x.com', password: 'secreto123',
          profile: { external_employee_number: '48213' } } as any)).rejects.toBeInstanceOf(BadRequestException);
      });

      it('otros errores de la transacción se propagan tal cual', async () => {
        repo.findOne.mockResolvedValue(null);
        dataSource.transaction.mockRejectedValue(new Error('boom'));
        await expect(service.create({ email: 'x@x.com', password: 'secreto123' } as any)).rejects.toThrow('boom');
      });
    });

    it('hashea password con bcrypt 12 rounds', async () => {
      repo.findOne.mockResolvedValue(null);
      setupManager(makeUser());
      await service.create({ email: 'a@b.com', password: 'secreto123' } as any);
      expect(bcryptHashSpy).toHaveBeenCalledWith('secreto123', 12);
    });

    it('normaliza email (trim + lowercase)', async () => {
      repo.findOne.mockResolvedValue(null);
      setupManager(makeUser());
      await service.create({ email: '  MATEO@NOVA.COM  ', password: 'secreto123' } as any);
      expect(repo.findOne).toHaveBeenCalledWith({ where: { email: 'mateo@nova.com' } });
    });

    it('rol default CUSTOMER si no se envian roles', async () => {
      repo.findOne.mockResolvedValue(null);
      const mgr = setupManager(makeUser());
      await service.create({ email: 'x@x.com', password: 'secreto123' } as any);
      const uCall = mgr.create.mock.calls.find((c: any[]) => c[0] === User);
      expect(uCall[1].roles).toEqual([Role.CUSTOMER]);
    });

    it('BadRequest si email ya existe', async () => {
      repo.findOne.mockResolvedValue({ id: 'existing' });
      await expect(service.create({ email: 'dup@test.com', password: 'secreto123' } as any))
        .rejects.toBeInstanceOf(BadRequestException);
    });

    it('BadRequest si username ya tomado', async () => {
      repo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'otro' });
      await expect(service.create({ email: 'new@test.com', password: 'secreto123',
        profile: { firstName: 'X', lastName: 'Y', userName: 'taken', avatarUrl: '' } } as any))
        .rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // UPDATE
  describe('update', () => {
    it('genera employee_number si no tiene uno (null) al editar', async () => {
      const user = makeUser({ profile: makeProfile({ employee_number: null }) });
      repo.findOne.mockResolvedValue(user);
      repo.save.mockImplementation((u: any) => u);
      profileRepo.update = jest.fn().mockResolvedValue({ affected: 1 });
      await service.update('u1', {} as any);
      expect(user.profile.employee_number).toMatch(/^NIOMT\d{6}$/);
      expect(profileRepo.update).toHaveBeenCalledWith(
        { id: user.profile.id },
        { employee_number: expect.stringMatching(/^NIOMT\d{6}$/) },
      );
    });

    it('genera employee_number si es cadena vacía al editar', async () => {
      const user = makeUser({ profile: makeProfile({ employee_number: '' }) });
      repo.findOne.mockResolvedValue(user);
      repo.save.mockImplementation((u: any) => u);
      profileRepo.update = jest.fn().mockResolvedValue({ affected: 1 });
      await service.update('u1', {} as any);
      expect(user.profile.employee_number).toMatch(/^NIOMT\d{6}$/);
      expect(profileRepo.update).toHaveBeenCalledWith(
        { id: user.profile.id },
        { employee_number: expect.stringMatching(/^NIOMT\d{6}$/) },
      );
    });

    it('NO sobreescribe employee_number existente', async () => {
      const user = makeUser({ profile: makeProfile({ employee_number: 'NIOMT123456' }) });
      repo.findOne.mockResolvedValue(user);
      repo.save.mockImplementation((u: any) => u);
      profileRepo.update = jest.fn();
      await service.update('u1', { profile: { firstName: 'Nuevo' } } as any);
      expect(user.profile.employee_number).toBe('NIOMT123456');
      expect(profileRepo.update).not.toHaveBeenCalled();
    });

    describe('bot de pruebas (dev_activity_bot)', () => {
      const build = () => {
        const registry = { notifyUser: jest.fn() };
        const svc = new UsersService(repo as any, profileRepo as any, dataSource as any, registry as any);
        const user = makeUser({ profile: makeProfile({ employee_number: 'NIOMT123456' }) });
        repo.findOne.mockResolvedValue(user);
        repo.save.mockImplementation((u: any) => u);
        return { registry, svc, user };
      };

      it.each([true, false])('guarda dev_activity_bot=%p y avisa a la app del usuario (profile:linked)', async (value) => {
        const { registry, svc, user } = build();
        await svc.update('u1', { profile: { dev_activity_bot: value } } as any);
        expect(user.profile.dev_activity_bot).toBe(value);
        expect(registry.notifyUser).toHaveBeenCalledWith('u1', 'profile:linked', { devActivityBot: value });
      });

      it('no avisa si la edición no toca dev_activity_bot', async () => {
        const { registry, svc } = build();
        await svc.update('u1', { profile: { firstName: 'Nuevo' } } as any);
        expect(registry.notifyUser).not.toHaveBeenCalled();
      });
    });

    describe('DevTools de la app NIO (devtools_enabled)', () => {
      const build = () => {
        const registry = { notifyUser: jest.fn() };
        const svc = new UsersService(repo as any, profileRepo as any, dataSource as any, registry as any);
        const user = makeUser({ profile: makeProfile({ employee_number: 'NIOMT123456' }) });
        repo.findOne.mockResolvedValue(user);
        repo.save.mockImplementation((u: any) => u);
        return { registry, svc, user };
      };

      it.each([true, false])('guarda devtools_enabled=%p y avisa a la app del usuario (profile:linked)', async (value) => {
        const { registry, svc, user } = build();
        await svc.update('u1', { profile: { devtools_enabled: value } } as any);
        expect(user.profile.devtools_enabled).toBe(value);
        expect(registry.notifyUser).toHaveBeenCalledWith('u1', 'profile:linked', { devtoolsEnabled: value });
      });

      it('no avisa si la edición no toca devtools_enabled', async () => {
        const { registry, svc } = build();
        await svc.update('u1', { profile: { firstName: 'Nuevo' } } as any);
        expect(registry.notifyUser).not.toHaveBeenCalled();
      });
    });

    describe('external_employee_number (app de RR.HH.)', () => {
      const withNio = () => makeUser({ profile: makeProfile({ employee_number: 'NIOMT123456' }) });

      it('lo asigna recortado, excluyendo su propio perfil, y deja intacto el del NIO', async () => {
        const user = withNio();
        repo.findOne.mockResolvedValue(user);
        repo.save.mockImplementation((u: any) => u);
        const qb = mockExternalNumberTaken(profileRepo, false);
        await service.update('u1', { profile: { external_employee_number: ' 48213 ' } } as any);
        expect(user.profile.external_employee_number).toBe('48213');
        expect(user.profile.employee_number).toBe('NIOMT123456');
        expect(qb.andWhere).toHaveBeenCalledWith(expect.stringContaining('<>'), { excludeProfileId: 'p1' });
      });

      it('BadRequest si lo tiene otro perfil', async () => {
        repo.findOne.mockResolvedValue(withNio());
        mockExternalNumberTaken(profileRepo, true);
        await expect(service.update('u1', { profile: { external_employee_number: '48213' } } as any))
          .rejects.toBeInstanceOf(BadRequestException);
        expect(repo.save).not.toHaveBeenCalled();
      });

      it('vacío lo borra (null) sin consultar unicidad', async () => {
        const user = withNio();
        user.profile.external_employee_number = '48213';
        repo.findOne.mockResolvedValue(user);
        repo.save.mockImplementation((u: any) => u);
        await service.update('u1', { profile: { external_employee_number: '' } } as any);
        expect(user.profile.external_employee_number).toBeNull();
        expect(profileRepo.createQueryBuilder).not.toHaveBeenCalled();
      });

      it('si no viene en el body no se toca', async () => {
        const user = withNio();
        user.profile.external_employee_number = '48213';
        repo.findOne.mockResolvedValue(user);
        repo.save.mockImplementation((u: any) => u);
        await service.update('u1', { profile: { firstName: 'Nuevo' } } as any);
        expect(user.profile.external_employee_number).toBe('48213');
        expect(profileRepo.createQueryBuilder).not.toHaveBeenCalled();
      });

      it('traduce la violación del índice único al guardar a BadRequest', async () => {
        repo.findOne.mockResolvedValue(withNio());
        mockExternalNumberTaken(profileRepo, false);
        repo.save.mockRejectedValue(Object.assign(new Error('dup'), {
          driverError: { code: '23505', constraint: 'UQ_user_profiles_external_employee_number' },
        }));
        await expect(service.update('u1', { profile: { external_employee_number: '48213' } } as any))
          .rejects.toBeInstanceOf(BadRequestException);
      });
    });

    it('cambia contraseña: hashea con bcrypt', async () => {
      const user = makeUser();
      repo.findOne.mockResolvedValue(user);
      repo.save.mockImplementation((u: any) => u);
      await service.update('u1', { password: 'nuevaPass123' } as any);
      expect(bcryptHashSpy).toHaveBeenCalledWith('nuevaPass123', 12);
      expect(user.passwordHash).toBe('hashed_pw');
    });

    it('normaliza y actualiza email', async () => {
      const user = makeUser({ email: 'old@test.com' });
      repo.findOne.mockResolvedValueOnce(user).mockResolvedValueOnce(null);
      repo.save.mockImplementation((u: any) => u);
      await service.update('u1', { email: '  NEW@TEST.COM  ' } as any);
      expect(user.email).toBe('new@test.com');
    });

    it('BadRequest si email nuevo ya tomado', async () => {
      const user = makeUser({ email: 'old@test.com' });
      repo.findOne.mockResolvedValueOnce(user).mockResolvedValueOnce({ id: 'u2' });
      await expect(service.update('u1', { email: 'taken@test.com' } as any))
        .rejects.toBeInstanceOf(BadRequestException);
    });

    it('NO busca duplicado si username no cambio', async () => {
      const user = makeUser({ profile: makeProfile({ userName: 'mateoT' }) });
      repo.findOne.mockResolvedValue(user);
      repo.save.mockImplementation((u: any) => u);
      await service.update('u1', { profile: { userName: 'mateoT' } } as any);
      expect(repo.findOne).toHaveBeenCalledTimes(1);
    });

    it('BadRequest si username nuevo ya tomado', async () => {
      const user = makeUser({ profile: makeProfile({ userName: 'mateoT' }) });
      repo.findOne.mockResolvedValueOnce(user).mockResolvedValueOnce({ id: 'u2' });
      await expect(service.update('u1', { profile: { userName: 'otroUser' } } as any))
        .rejects.toBeInstanceOf(BadRequestException);
    });

    it('actualiza isActive', async () => {
      const user = makeUser({ isActive: true });
      repo.findOne.mockResolvedValue(user);
      repo.save.mockImplementation((u: any) => u);
      await service.update('u1', { isActive: false } as any);
      expect(user.isActive).toBe(false);
    });

    it('NotFoundException si usuario no existe', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.update('nope', {} as any)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // updateRefreshToken (credentials)
  describe('updateRefreshToken', () => {
    it('hashea y guarda refresh token (login)', async () => {
      repo.update.mockResolvedValue({ affected: 1 } as UpdateResult);
      await service.updateRefreshToken('u1', 'myToken');
      expect(bcryptHashSpy).toHaveBeenCalledWith('myToken', 12);
      expect(repo.update).toHaveBeenCalledWith({ id: 'u1' }, { refreshTokenHash: 'hashed_pw' });
    });

    it('guarda null al hacer logout', async () => {
      repo.update.mockResolvedValue({ affected: 1 } as UpdateResult);
      await service.updateRefreshToken('u1', null);
      expect(repo.update).toHaveBeenCalledWith({ id: 'u1' }, { refreshTokenHash: null });
    });

    it('NotFoundException si usuario no existe', async () => {
      repo.update.mockResolvedValue({ affected: 0 } as UpdateResult);
      await expect(service.updateRefreshToken('nope', 'token')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // remove
  describe('remove', () => {
    it('elimina si existe', async () => {
      repo.delete.mockResolvedValue({ affected: 1 });
      await expect(service.remove('u1')).resolves.toBeUndefined();
    });
    it('NotFoundException si no existe', async () => {
      repo.delete.mockResolvedValue({ affected: 0 });
      await expect(service.remove('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // findByEmail
  describe('findByEmail', () => {
    it('normaliza email antes de buscar', async () => {
      repo.findOne.mockResolvedValue({ id: 'u1' });
      await service.findByEmail('  MATEO@NOVA.COM  ');
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { email: 'mateo@nova.com' }, relations: { profile: true },
      });
    });
  });
});
