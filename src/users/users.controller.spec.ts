import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { Role } from './entities/user.entity';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

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

  describe('dev_activity_bot (solo super_admin y con DEV_ACTIVITY_BOT=true)', () => {
    const previousFlag = process.env.DEV_ACTIVITY_BOT;
    const superAdminReq = { user: { roles: [Role.SUPER_ADMIN] } };
    const adminReq = { user: { roles: [Role.ADMIN] } };
    const botDto = { profile: { dev_activity_bot: true } } as any;

    afterEach(() => {
      if (previousFlag === undefined) delete process.env.DEV_ACTIVITY_BOT;
      else process.env.DEV_ACTIVITY_BOT = previousFlag;
    });

    it('update: 403 si DEV_ACTIVITY_BOT no está en true (aunque sea super_admin)', () => {
      delete process.env.DEV_ACTIVITY_BOT;
      expect(() => controller.update('u1', botDto, superAdminReq)).toThrow(
        ForbiddenException,
      );
      expect(usersServiceMock.update).not.toHaveBeenCalled();
    });

    it('update: 403 si quien edita no es super_admin (aunque la variable esté en true)', () => {
      process.env.DEV_ACTIVITY_BOT = 'true';
      expect(() => controller.update('u1', botDto, adminReq)).toThrow(
        ForbiddenException,
      );
      expect(() => controller.update('u1', botDto)).toThrow(ForbiddenException);
      expect(usersServiceMock.update).not.toHaveBeenCalled();
    });

    it('update: pasa con super_admin y DEV_ACTIVITY_BOT=true', async () => {
      process.env.DEV_ACTIVITY_BOT = 'true';
      usersServiceMock.update.mockResolvedValue({ id: 'u1' });
      await controller.update('u1', botDto, superAdminReq);
      expect(usersServiceMock.update).toHaveBeenCalledWith('u1', botDto);
    });

    it('update: las ediciones que no tocan dev_activity_bot no se ven afectadas', async () => {
      delete process.env.DEV_ACTIVITY_BOT;
      usersServiceMock.update.mockResolvedValue({ id: 'u1' });
      await controller.update('u1', { email: 'a@b.com' } as any, adminReq);
      expect(usersServiceMock.update).toHaveBeenCalledTimes(1);
    });

    it('create: aplica el mismo candado', () => {
      process.env.DEV_ACTIVITY_BOT = 'true';
      const dto = {
        email: 'x@x.com',
        password: 'Passw0rd!',
        profile: { dev_activity_bot: true },
      } as any;
      expect(() => controller.create(dto, adminReq)).toThrow(ForbiddenException);
      expect(usersServiceMock.create).not.toHaveBeenCalled();
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
