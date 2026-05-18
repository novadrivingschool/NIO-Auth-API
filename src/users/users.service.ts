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
import { QueryFiltersDto } from './dto/query-filters.dto';

const SALT_ROUNDS = 12;

function normalizeEmail(email: string) {
  return String(email).trim().toLowerCase();
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private repo: Repository<User>,
    @InjectRepository(UserProfile)
    private readonly profileRepo: Repository<UserProfile>,
    private readonly dataSource: DataSource,
  ) {}

  // ────────────────────────────────────────────────────────────────────────────
  // Crear usuario
  // ────────────────────────────────────────────────────────────────────────────

  getEmployeeNumber(firstName: string, lastName: string) {
    const initials = `${firstName.at(0)}${lastName.at(0)}`.toUpperCase();

    const number = Date.now().toString().slice(-6);

    return `NOVA${initials}${number}`;
  }

  async create(dto: CreateUserDto): Promise<User> {
    if (dto.email) {
      const email = normalizeEmail(dto.email);
      const emailExists = await this.repo.findOne({ where: { email } });
      if (emailExists)
        throw new BadRequestException('Email already registered');
      dto.email = email;
    }

    if (dto.profile?.userName) {
      const usernameExists = await this.repo.findOne({
        where: { profile: { userName: dto.profile.userName } },
        relations: { profile: true },
      });

      if (usernameExists) {
        throw new BadRequestException('Username already taken');
      }
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const roles: Role[] = (
      dto.roles?.length ? dto.roles : [Role.CUSTOMER]
    ) as Role[];

    let employee_number: string;

    if (dto.profile?.firstName && dto.profile.lastName) {
      employee_number = this.getEmployeeNumber(
        dto.profile.firstName,
        dto.profile.lastName,
      );
    } else {
      employee_number = this.getEmployeeNumber('John', 'Doe');
    }

    return await this.dataSource.transaction(async (manager) => {
      const user = manager.create(User, {
        email: dto.email,
        passwordHash,
        roles,
        isActive: dto.isActive ?? true,
      });
      await manager.save(user);

      if (dto.profile) {
        const profile = manager.create(UserProfile, {
          ...dto.profile,
          employee_number: employee_number,
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
    return this.repo.findOne({ where: { id }, relations: ['profile'] });
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
    const qb = this.repo
      .createQueryBuilder('u')
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
    const qb = this.repo
      .createQueryBuilder('u')
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
  async update(id: string, dto: UpdateUserDto): Promise<User> {
    const user = await this.repo.findOne({
      where: { id },
      relations: ['profile'],
    });

    if (!user) throw new NotFoundException('User not found');

    if (dto.email) {
      const newEmail = normalizeEmail(dto.email);
      if (newEmail !== user.email) {
        const taken = await this.repo.findOne({ where: { email: newEmail } });
        if (taken) throw new BadRequestException('Email already registered');
        user.email = newEmail;
      }
    }

    if (dto.profile?.userName) {
      const usernameExists = await this.repo.findOne({
        where: { profile: { userName: dto.profile.userName } },
        relations: { profile: true },
      });

      if (usernameExists) {
        throw new BadRequestException('Username already taken');
      }
    }

    if (dto.password) {
      user.passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    }

    if (typeof dto.isActive === 'boolean') user.isActive = dto.isActive;
    if (dto.roles) user.roles = dto.roles;

    if (dto.profile) {
      if (!user.profile) user.profile = new UserProfile();

      Object.assign(user.profile, dto.profile);
    }

    return this.repo.save(user);
  }

  async remove(id: string): Promise<void> {
    const { affected } = await this.repo.delete(id);
    if (!affected) throw new NotFoundException('User not found');
  }

  async findActiveUsers(): Promise<User[]> {
    return await this.repo
      .createQueryBuilder('user')
      .innerJoin('user.profile', 'profile')
      .select([
        'user.id',
        'user.email',
        'profile.employee_number',
        'profile.firstName',
        'profile.lastName',
      ])
      .where('user.isActive = :isActive', { isActive: true })
      // .andWhere('profile.employee_number IS NOT NULL')
      .getMany();
  }

  async filter(queryDto: QueryFiltersDto) {
    const { isActive, roles, page = 1, limit = 30 } = queryDto;

    const queryBuilder = this.repo.createQueryBuilder('user');

    queryBuilder.leftJoinAndSelect('user.profile', 'profile');

    if (isActive !== undefined) {
      queryBuilder.andWhere('user.isActive = :isActive', { isActive });
    }

    if (roles && roles.length > 0) {
      queryBuilder.andWhere('user.roles && :roles', { roles });
    }

    // Paginación
    queryBuilder.skip((page - 1) * limit).take(limit);

    const [items, total] = await queryBuilder.getManyAndCount();

    return {
      items,
      meta: {
        totalItems: total,
        itemCount: items.length,
        itemsPerPage: limit,
        totalPages: Math.ceil(total / limit),
        currentPage: page,
      },
    };
  }
}
