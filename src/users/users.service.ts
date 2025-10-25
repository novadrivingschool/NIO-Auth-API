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

  // ────────────────────────────────────────────────────────────────────────────
  // Crear usuario
  // ────────────────────────────────────────────────────────────────────────────
  async create(dto: CreateUserDto): Promise<User> {
    const email = normalizeEmail(dto.email);

    const exists = await this.repo.findOne({ where: { email } });
    if (exists) throw new BadRequestException('Email already registered');

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const roles: Role[] = (dto.roles?.length ? dto.roles : [Role.CUSTOMER]) as Role[];

    return await this.dataSource.transaction(async (manager) => {
      const user = manager.create(User, {
        email,
        passwordHash,
        roles,
        isActive: dto.isActive ?? true,
      });
      await manager.save(user);

      if (dto.profile) {
        const profile = manager.create(UserProfile, {
          ...dto.profile,
          user,
        });
        await manager.save(profile);
      }

      const withProfile = await manager.findOne(User, {
        where: { id: user.id },
        relations: { profile: true },
      });
      return withProfile ?? user;
    });
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Lecturas genéricas
  // ────────────────────────────────────────────────────────────────────────────
  async findAll(): Promise<User[]> {
    // Asegúrate de incluir la relación con el perfil en la consulta
    return this.repo.find({
      relations: ['profile'], // Incluye la relación con 'profile' aquí
    });
  }

  findOne(id: string): Promise<User | null> {
    // ⚠️ Por defecto NO garantiza traer refreshTokenHash si la columna tiene select:false
    return this.repo.findOne({ where: { id } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.repo.findOne({
      where: { email: normalizeEmail(email) },
      relations: { profile: true },
    });
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Helpers para AUTH
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Para login (si quisieras centralizar aquí en vez de armar el select en AuthService).
   * Incluye passwordHash aunque tenga select:false en la entidad.
   */
  async findOneForLogin(email: string): Promise<User | null> {
    const qb = this.repo.createQueryBuilder('u')
      .addSelect('u.passwordHash') // por si passwordHash está con select:false
      .where('u.email = :email', { email: normalizeEmail(email) })
      .leftJoinAndSelect('u.profile', 'p');

    return qb.getOne();
  }

  /**
   * Para el REFRESH WEB: trae refreshTokenHash aunque esté con select:false.
   * Úsalo en AuthService.refresh() cuando el payload del refresh NO trae sid.
   */
  async findOneForRefresh(userId: string): Promise<User | null> {
    const qb = this.repo.createQueryBuilder('u')
      .addSelect('u.refreshTokenHash') // <— clave para evitar "Refresh token not found"
      .where('u.id = :id', { id: userId });

    return qb.getOne();
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

  // ────────────────────────────────────────────────────────────────────────────
  // Update / Delete
  // ────────────────────────────────────────────────────────────────────────────
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

    if (typeof dto.email !== 'undefined') {
      const newEmail = normalizeEmail(dto.email);
      if (newEmail !== user.email) {
        const taken = await this.repo.findOne({ where: { email: newEmail } });
        if (taken) throw new BadRequestException('Email already registered');
        user.email = newEmail;
      }
    }

    if (typeof dto.password !== 'undefined') {
      if (!dto.password || dto.password.length < 8) {
        throw new BadRequestException('Password must be at least 8 characters');
      }
      user.passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    }

    if (typeof dto.roles !== 'undefined') {
      user.roles = dto.roles;
    }

    if (typeof dto.isActive === 'boolean') {
      user.isActive = dto.isActive;
    }

    return this.repo.save(user);
  }

  async remove(id: string): Promise<void> {
    const { affected } = await this.repo.delete(id);
    if (!affected) throw new NotFoundException('User not found');
  }
}
