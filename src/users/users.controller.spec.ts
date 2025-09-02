import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { Role } from './entities/user.entity';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('UsersController', () => {
  let controller: UsersController;

  const usersServiceMock = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: usersServiceMock }],
    }).compile();

    controller = module.get<UsersController>(UsersController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('POST /users (create)', () => {
    it('crea y retorna el usuario (201)', async () => {
      usersServiceMock.create.mockResolvedValue({
        id: 'u1',
        email: 'admin@example.com',
        roles: [Role.ADMIN],
        isActive: true,
      });

      const res = await controller.create({
        email: 'admin@example.com',
        password: 'StrongPass123',
        roles: [Role.ADMIN],
        isActive: true,
      } as any);

      expect(usersServiceMock.create).toHaveBeenCalledWith({
        email: 'admin@example.com',
        password: 'StrongPass123',
        roles: [Role.ADMIN],
        isActive: true,
      });
      expect(res).toMatchObject({ id: 'u1', email: 'admin@example.com' });
    });

    it('lanza 400 si el service reporta datos inválidos', async () => {
      usersServiceMock.create.mockRejectedValue(new BadRequestException('Email already registered'));
      await expect(
        controller.create({ email: 'dup@ex.com', password: 'Passw0rd!' } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('GET /users (findAll)', () => {
    it('retorna lista (200)', async () => {
      usersServiceMock.findAll.mockResolvedValue([{ id: '1' }, { id: '2' }]);
      const res = await controller.findAll();
      expect(usersServiceMock.findAll).toHaveBeenCalled();
      expect(res).toHaveLength(2);
    });
  });

  describe('GET /users/:id (findOne)', () => {
    it('retorna usuario (200)', async () => {
      usersServiceMock.findOne.mockResolvedValue({ id: '42' });
      const res = await controller.findOne('42');
      expect(usersServiceMock.findOne).toHaveBeenCalledWith('42');
      expect(res).toEqual({ id: '42' });
    });

    it('lanza 404 si no existe', async () => {
      usersServiceMock.findOne.mockResolvedValue(null);
      await expect(controller.findOne('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('PATCH /users/:id (update)', () => {
    it('actualiza y retorna usuario (200)', async () => {
      usersServiceMock.update.mockResolvedValue({ id: 'u1', email: 'nuevo@example.com' });
      const res = await controller.update('u1', { email: 'nuevo@example.com' } as any);
      expect(usersServiceMock.update).toHaveBeenCalledWith('u1', { email: 'nuevo@example.com' });
      expect(res).toEqual({ id: 'u1', email: 'nuevo@example.com' });
    });

    it('propaga 404 si el service no encuentra el usuario', async () => {
      usersServiceMock.update.mockRejectedValue(new NotFoundException('User not found'));
      await expect(
        controller.update('nope', { email: 'x@x.com' } as any),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('propaga 400 si payload inválido', async () => {
      usersServiceMock.update.mockRejectedValue(new BadRequestException('No fields to update'));
      await expect(controller.update('u1', {} as any)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('DELETE /users/:id (remove)', () => {
    it('elimina (204 sin cuerpo)', async () => {
      usersServiceMock.remove.mockResolvedValue(undefined);
      await expect(controller.remove('u1')).resolves.toBeUndefined();
      expect(usersServiceMock.remove).toHaveBeenCalledWith('u1');
    });

    it('propaga 404 si no existe', async () => {
      usersServiceMock.remove.mockRejectedValue(new NotFoundException('User not found'));
      await expect(controller.remove('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
