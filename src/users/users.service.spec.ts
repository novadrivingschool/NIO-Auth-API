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
    metadata: null, employee_number: null, createdAt: new Date(), updatedAt: new Date(),
    ...overrides } as unknown as UserProfile;
}

function makeUser(overrides = {}): User {
  return { id: 'u1', email: 'test@example.com', passwordHash: 'hashed',
    roles: [Role.EMPLOYEE], isActive: true, refreshTokenHash: null,
    createdAt: new Date(), updatedAt: new Date(), profile: makeProfile(),
    ...overrides } as User;
}

const makeRepoMock = () => ({
  findOne: jest.fn(), find: jest.fn(), create: jest.fn(),
  save: jest.fn(), delete: jest.fn(), update: jest.fn(), createQueryBuilder: jest.fn(),
});

const makeDataSourceMock = () => ({ transaction: jest.fn() });

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
    it('genera NOVA{INICIALES}{6digits} - Mateo Torres -> NOVAMT', () => {
      expect(service.getEmployeeNumber('Mateo', 'Torres')).toMatch(/^NOVAMT\d{6}$/);
    });
    it('convierte iniciales a mayusculas', () => {
      expect(service.getEmployeeNumber('john', 'doe')).toMatch(/^NOVAJD\d{6}$/);
    });
    it('Ximena Izurieta -> NOVAXI', () => {
      expect(service.getEmployeeNumber('Ximena', 'Izurieta')).toMatch(/^NOVAXI\d{6}$/);
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
      expect(pCall[1].employee_number).toMatch(/^NOVAMT\d{6}$/);
    });

    it('fallback NOVAJD sin nombre', async () => {
      repo.findOne.mockResolvedValue(null);
      const mgr = setupManager(makeUser());
      await service.create({ email: 'x@x.com', password: 'secreto123',
        profile: { avatarUrl: '' } } as any);
      const pCall = mgr.create.mock.calls.find((c: any[]) => c[0] === UserProfile);
      expect(pCall[1].employee_number).toMatch(/^NOVAJD\d{6}$/);
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
      expect(user.profile.employee_number).toMatch(/^NOVAMT\d{6}$/);
      expect(profileRepo.update).toHaveBeenCalledWith(
        { id: user.profile.id },
        { employee_number: expect.stringMatching(/^NOVAMT\d{6}$/) },
      );
    });

    it('genera employee_number si es cadena vacía al editar', async () => {
      const user = makeUser({ profile: makeProfile({ employee_number: '' }) });
      repo.findOne.mockResolvedValue(user);
      repo.save.mockImplementation((u: any) => u);
      profileRepo.update = jest.fn().mockResolvedValue({ affected: 1 });
      await service.update('u1', {} as any);
      expect(user.profile.employee_number).toMatch(/^NOVAMT\d{6}$/);
      expect(profileRepo.update).toHaveBeenCalledWith(
        { id: user.profile.id },
        { employee_number: expect.stringMatching(/^NOVAMT\d{6}$/) },
      );
    });

    it('NO sobreescribe employee_number existente', async () => {
      const user = makeUser({ profile: makeProfile({ employee_number: 'NOVAMT123456' }) });
      repo.findOne.mockResolvedValue(user);
      repo.save.mockImplementation((u: any) => u);
      profileRepo.update = jest.fn();
      await service.update('u1', { profile: { firstName: 'Nuevo' } } as any);
      expect(user.profile.employee_number).toBe('NOVAMT123456');
      expect(profileRepo.update).not.toHaveBeenCalled();
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
