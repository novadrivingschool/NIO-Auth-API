import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, UpdateResult } from 'typeorm';
import * as bcrypt from 'bcrypt';

import { User, Role } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserProfile } from './entities/user-profile.entity';

const SALT_ROUNDS = 12;

function normalizeEmail(email: string) {
  return String(email).trim().toLowerCase();
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private repo: Repository<User>,
    @InjectRepository(UserProfile) private readonly profileRepo: Repository<UserProfile>,
    private readonly dataSource: DataSource,

  ) { }

  // Crea usuario: normaliza email y previene duplicados

  async create(dto: CreateUserDto): Promise<User> {
    const email = normalizeEmail(dto.email);

    // 1) Unicidad de email
    const exists = await this.repo.findOne({ where: { email } });
    if (exists) throw new BadRequestException('Email already registered');

    // 2) Hash de password
    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

    // 3) Normaliza roles (default CUSTOMER)
    const roles: Role[] = (dto.roles?.length ? dto.roles : [Role.CUSTOMER]) as Role[];

    // 4) Transacción: crea User y (si viene) su Profile
    return await this.dataSource.transaction(async manager => {
      // User
      const user = manager.create(User, {
        email,
        passwordHash,
        roles,
        isActive: dto.isActive ?? true,
      });
      await manager.save(user);

      // Profile opcional
      if (dto.profile) {
        const profile = manager.create(UserProfile, {
          ...dto.profile,   // { firstName, lastName, birthdate, phone, gender, avatarUrl, metadata }
          user,             // FK
        });
        await manager.save(profile);
      }

      // Devuelve con la relación cargada
      const withProfile = await manager.findOne(User, {
        where: { id: user.id },
        relations: { profile: true },
      });

      // withProfile no debería ser null aquí; pero por seguridad:
      return withProfile ?? user;
    });
  }

  // Lista todos (si luego quieres filtros/paginación, los añadimos)
  findAll(): Promise<User[]> {
    return this.repo.find();
  }

  // Busca por id (deja null si no existe; el controller decide si 404)
  findOne(id: string): Promise<User | null> {
    return this.repo.findOne({ where: { id } });
  }

  // Actualiza con validaciones:
  // - Debe venir al menos un campo modificable
  // - Email normalizado y no duplicado (aunque cambie solo el case)
  // - Password re-hasheada si llega
  async update(id: string, dto: UpdateUserDto): Promise<User> {
    const user = await this.repo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    const hasAnyField =
      typeof dto.email !== 'undefined' ||
      typeof dto.password !== 'undefined' ||
      typeof dto.roles !== 'undefined' ||
      typeof dto.isActive !== 'undefined';

    if (!hasAnyField) {
      throw new BadRequestException('No fields to update');
    }

    // Email
    if (typeof dto.email !== 'undefined') {
      const newEmail = normalizeEmail(dto.email);
      if (newEmail !== user.email) {
        const taken = await this.repo.findOne({ where: { email: newEmail } });
        if (taken) throw new BadRequestException('Email already registered');
        user.email = newEmail;
      }
    }

    // Password
    if (typeof dto.password !== 'undefined') {
      // El DTO ya valida minLength, pero por si acaso:
      if (!dto.password || dto.password.length < 8) {
        throw new BadRequestException('Password must be at least 8 characters');
      }
      user.passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    }

    // Roles
    if (typeof dto.roles !== 'undefined') {
      // Permitimos [] si tu negocio lo admite; si no, valida aquí.
      user.roles = dto.roles;
    }

    // isActive
    if (typeof dto.isActive === 'boolean') {
      user.isActive = dto.isActive;
    }

    return this.repo.save(user);
  }

  // Elimina y valida existencia
  async remove(id: string): Promise<void> {
    const { affected } = await this.repo.delete(id);
    if (!affected) throw new NotFoundException('User not found');
  }

  // Utilidad para Auth
  /* findByEmail(email: string): Promise<User | null> {
    return this.repo.findOne({ where: { email: normalizeEmail(email) } });
  } */
  async findByEmail(email: string): Promise<User | null> {
    return this.repo.findOne({
      where: { email: normalizeEmail(email) },
      relations: { profile: true }, // siempre trae el perfil
    });
  }


  // Guarda el hash del refresh (o null). Valida que el usuario exista.
  async updateRefreshToken(userId: string, refreshToken: string | null) {
    const refreshTokenHash = refreshToken
      ? await bcrypt.hash(refreshToken, SALT_ROUNDS)
      : null;

    const result: UpdateResult = await this.repo.update(
      { id: userId },
      { refreshTokenHash },
    );

    if (!result.affected) {
      throw new NotFoundException('User not found');
    }
  }


}
