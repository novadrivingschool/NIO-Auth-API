import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, UpdateResult } from 'typeorm';
import { User, Role } from './entities/user.entity';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

type RepoMock<T = any> = {
  findOne: jest.Mock;
  find: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  delete: jest.Mock;
  update: jest.Mock;
};

const makeRepoMock = (): RepoMock<Repository<User>> => ({
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  delete: jest.fn(),
  update: jest.fn(),
});

describe('UsersService (robusto)', () => {
  let service: UsersService;
  let repo: RepoMock;
  const bcryptHashSpy = jest.spyOn(bcrypt, 'hash');

  beforeEach(async () => {
    repo = makeRepoMock();
    bcryptHashSpy.mockReset().mockResolvedValue('hashed_value');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: repo },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('normaliza email y crea si no existe', async () => {
      repo.findOne.mockResolvedValue(null);
      repo.create.mockImplementation((u) => u);
      repo.save.mockImplementation((u) => ({ id: 'u1', ...u }));

      const dto = { email: '  TeSt@Ex.Com  ', password: 'Passw0rd!', roles: [Role.ADMIN] } as any;
      const res = await service.create(dto);

      expect(repo.findOne).toHaveBeenCalledWith({ where: { email: 'test@ex.com' } });
      expect(bcryptHashSpy).toHaveBeenCalledWith('Passw0rd!', expect.any(Number));
      expect(res).toMatchObject({ id: 'u1', email: 'test@ex.com', roles: [Role.ADMIN] });
    });

    it('lanza BadRequest si email ya existe', async () => {
      repo.findOne.mockResolvedValue({ id: 'exists' });
      await expect(
        service.create({ email: 'dup@ex.com', password: 'Passw0rd!' } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('findAll', () => {
    it('retorna lista', async () => {
      repo.find.mockResolvedValue([{ id: '1' }]);
      const res = await service.findAll();
      expect(repo.find).toHaveBeenCalled();
      expect(res).toEqual([{ id: '1' }]);
    });
  });

  describe('findOne', () => {
    it('retorna usuario o null', async () => {
      repo.findOne.mockResolvedValue({ id: '42' });
      const res = await service.findOne('42');
      expect(repo.findOne).toHaveBeenCalledWith({ where: { id: '42' } });
      expect(res).toEqual({ id: '42' });
    });
  });

  describe('update', () => {
    it('lanza NotFound si no existe', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.update('nope', {} as any)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lanza BadRequest si no hay campos a actualizar (no-op)', async () => {
      repo.findOne.mockResolvedValue({ id: 'u1', email: 'a@b.com' });
      await expect(service.update('u1', {} as any)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('normaliza email y evita colisión (aunque solo cambie el case)', async () => {
      // usuario actual
      repo.findOne
        .mockResolvedValueOnce({ id: 'u1', email: 'old@ex.com' }) // find by id
        .mockResolvedValueOnce({ id: 'u2', email: 'new@ex.com' }); // find by email (ocupado)

      await expect(
        service.update('u1', { email: '  NEW@EX.com  ' } as any),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(repo.findOne).toHaveBeenNthCalledWith(2, { where: { email: 'new@ex.com' } });
    });

    it('re-hashea password y actualiza otros campos', async () => {
      const existing = {
        id: 'u1',
        email: 'old@ex.com',
        roles: [Role.CUSTOMER],
        isActive: true,
      } as User;

      repo.findOne
        .mockResolvedValueOnce(existing) // find by id
        .mockResolvedValueOnce(null);    // email no tomado

      repo.save.mockImplementation((u) => u);

      const dto = {
        email: 'NEW@EX.com',
        password: 'NewPass123',
        roles: [Role.EMPLOYEE],
        isActive: false,
      } as any;

      const res = await service.update('u1', dto);

      expect(bcryptHashSpy).toHaveBeenCalledWith('NewPass123', expect.any(Number));
      expect(res).toMatchObject({
        email: 'new@ex.com',
        roles: [Role.EMPLOYEE],
        isActive: false,
      });
    });

    it('rechaza password < 8 chars', async () => {
      repo.findOne.mockResolvedValue({ id: 'u1', email: 'x@x.com' });
      await expect(
        service.update('u1', { password: 'short' } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('remove', () => {
    it('elimina si existe', async () => {
      repo.delete.mockResolvedValue({ affected: 1 });
      await expect(service.remove('u1')).resolves.toBeUndefined();
      expect(repo.delete).toHaveBeenCalledWith('u1');
    });

    it('lanza NotFound si no existe', async () => {
      repo.delete.mockResolvedValue({ affected: 0 });
      await expect(service.remove('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('findByEmail', () => {
    it('normaliza email antes de buscar', async () => {
      repo.findOne.mockResolvedValue({ id: 'x' });
      await service.findByEmail('  A@B.Com ');
      expect(repo.findOne).toHaveBeenCalledWith({ where: { email: 'a@b.com' } });
    });
  });

  describe('updateRefreshToken', () => {
    it('guarda hash cuando hay token', async () => {
      repo.update.mockResolvedValue({ affected: 1 } as UpdateResult);
      await service.updateRefreshToken('u1', 'token123');
      expect(bcryptHashSpy).toHaveBeenCalledWith('token123', expect.any(Number));
      expect(repo.update).toHaveBeenCalledWith({ id: 'u1' }, { refreshTokenHash: 'hashed_value' });
    });

    it('guarda null cuando no hay token', async () => {
      repo.update.mockResolvedValue({ affected: 1 } as UpdateResult);
      await service.updateRefreshToken('u1', null);
      expect(repo.update).toHaveBeenCalledWith({ id: 'u1' }, { refreshTokenHash: null });
    });

    it('lanza NotFound si no afectó (usuario inexistente)', async () => {
      repo.update.mockResolvedValue({ affected: 0 } as UpdateResult);
      await expect(service.updateRefreshToken('nope', 'x')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
