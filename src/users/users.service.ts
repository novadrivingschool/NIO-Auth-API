import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, UpdateResult } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { DevicesRegistry } from '../devices/devices.registry';

import { User, Role } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserProfile } from './entities/user-profile.entity';
import {
  QueryFiltersDto,
  USER_SORT_COLUMNS,
} from './dto/query-filters.dto';

const SALT_ROUNDS = 12;

/** Prefijo de los employee_number nuevos. Los históricos usan 'NOVA' y se conservan. */
const EMPLOYEE_NUMBER_PREFIX = 'NIO';
const EMPLOYEE_NUMBER_MAX_ATTEMPTS = 10;
/** Índice único parcial del número de empleado EXTERNO (migración 1790000000002). */
const EXTERNAL_EMPLOYEE_NUMBER_UNIQUE_INDEX =
  'UQ_user_profiles_external_employee_number';

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
    @Optional() private readonly registry?: DevicesRegistry,
  ) {}

  // ────────────────────────────────────────────────────────────────────────────
  // Crear usuario
  // ────────────────────────────────────────────────────────────────────────────

  getEmployeeNumber(firstName: string, lastName: string) {
    const initials = `${firstName.at(0)}${lastName.at(0)}`.toUpperCase();

    const number = Date.now().toString().slice(-6);

    return `${EMPLOYEE_NUMBER_PREFIX}${initials}${number}`;
  }

  /**
   * El número de empleado EXTERNO (de la app de RR.HH.) es independiente del
   * `employee_number` del NIO: se captura a mano, es opcional y se puede borrar.
   * Devuelve `undefined` si no vino (no tocar), `null` si vino vacío.
   */
  private normalizeExternalEmployeeNumber(
    raw: string | null | undefined,
  ): string | null | undefined {
    if (raw === undefined) return undefined;
    const value = raw === null ? '' : String(raw).trim();
    return value === '' ? null : value;
  }

  /** Unicidad insensible a mayúsculas, igual que el índice de la migración. */
  private async assertExternalEmployeeNumberAvailable(
    value: string,
    excludeProfileId?: string,
  ): Promise<void> {
    const qb = this.profileRepo
      .createQueryBuilder('p')
      .where('UPPER(p.external_employee_number) = :value', {
        value: value.toUpperCase(),
      });
    if (excludeProfileId) {
      qb.andWhere('p.id <> :excludeProfileId', { excludeProfileId });
    }
    if (await qb.getExists()) {
      throw new BadRequestException('External employee number already in use');
    }
  }

  /** Convierte la violación del índice único (carrera entre dos altas) en 400. */
  private rethrowExternalEmployeeNumberConflict(error: unknown): never {
    const driver = (
      error as { driverError?: { code?: string; constraint?: string } }
    )?.driverError;
    if (
      driver?.code === '23505' &&
      driver.constraint === EXTERNAL_EMPLOYEE_NUMBER_UNIQUE_INDEX
    ) {
      throw new BadRequestException('External employee number already in use');
    }
    throw error;
  }

  /**
   * Genera un employee_number garantizando que no exista ya en BD.
   * Es obligatorio porque el login web (`POST /auth/login/web`) resuelve el
   * usuario por este campo: un duplicado permitiría autenticar a la persona
   * equivocada. `getEmployeeNumber` usa `Date.now()` truncado a 6 dígitos, que
   * se repite cada ~16,7 min, así que la colisión es posible.
   */
  private async generateUniqueEmployeeNumber(
    firstName: string,
    lastName: string,
  ): Promise<string> {
    for (let attempt = 0; attempt < EMPLOYEE_NUMBER_MAX_ATTEMPTS; attempt++) {
      const candidate =
        attempt === 0
          ? this.getEmployeeNumber(firstName, lastName)
          : `${this.getEmployeeNumber(firstName, lastName).slice(0, -2)}${String(
              Math.floor(Math.random() * 100),
            ).padStart(2, '0')}`;

      const taken = await this.profileRepo.exists({
        where: { employee_number: candidate },
      });
      if (!taken) return candidate;
    }

    throw new BadRequestException(
      'Could not generate a unique employee number. Please retry.',
    );
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

    const hasFullName = !!(dto.profile?.firstName && dto.profile?.lastName);
    const employee_number = await this.generateUniqueEmployeeNumber(
      hasFullName ? dto.profile!.firstName! : 'John',
      hasFullName ? dto.profile!.lastName! : 'Doe',
    );

    const external_employee_number = this.normalizeExternalEmployeeNumber(
      dto.profile?.external_employee_number,
    );
    if (external_employee_number) {
      await this.assertExternalEmployeeNumberAvailable(external_employee_number);
    }

    try {
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
            external_employee_number: external_employee_number ?? null,
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
    } catch (error) {
      this.rethrowExternalEmployeeNumberConflict(error);
    }
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

    if (dto.profile?.userName && dto.profile.userName !== user.profile?.userName) {
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

      // `undefined` = no tocar; vacío = borrar; con valor = debe ser único.
      const external = this.normalizeExternalEmployeeNumber(
        dto.profile.external_employee_number,
      );
      if (external !== undefined) {
        if (external) {
          await this.assertExternalEmployeeNumberAvailable(
            external,
            user.profile.id,
          );
        }
        user.profile.external_employee_number = external;
      }
    }

    // Generar employee_number siempre que no tenga (null o vacío) y haya nombre completo
    if (user.profile && (!user.profile.employee_number || user.profile.employee_number.trim() === '')) {
      const firstName = user.profile.firstName;
      const lastName = user.profile.lastName;
      if (firstName && lastName) {
        const newEmpNumber = await this.generateUniqueEmployeeNumber(
          firstName,
          lastName,
        );
        user.profile.employee_number = newEmpNumber;
        // UPDATE directo — evita problemas de cascade o relación suelta
        await this.profileRepo.update(
          { id: user.profile.id },
          { employee_number: newEmpNumber },
        );
      }
    }

    let saved: User;
    try {
      saved = await this.repo.save(user);
    } catch (error) {
      this.rethrowExternalEmployeeNumberConflict(error);
    }

    // Modo vinculado: la app de escritorio del usuario relee su perfil al instante.
    if (typeof dto.profile?.activity_linked === 'boolean') {
      this.registry?.notifyUser(saved.id, 'profile:linked', {
        activityLinked: dto.profile.activity_linked,
      });
    }
    return saved;
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
    const {
      isActive,
      roles,
      search,
      sortBy,
      sortDir,
      page = 1,
      limit = 30,
    } = queryDto;

    const queryBuilder = this.repo.createQueryBuilder('user');

    queryBuilder.leftJoinAndSelect('user.profile', 'profile');

    if (isActive !== undefined) {
      queryBuilder.andWhere('user.isActive = :isActive', { isActive });
    }

    if (roles && roles.length > 0) {
      queryBuilder.andWhere('user.roles && :roles::text[]', { roles });
    }

    const term = search?.trim();
    if (term) {
      // `ILIKE` es insensible a mayúsculas en Postgres. Se escapan los comodines
      // para que un `%` escrito por el usuario se busque literalmente en vez de
      // convertir la consulta en un "traer todo".
      const pattern = `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
      // Property paths de la entidad, no nombres de columna: funcionaba por
      // coincidencia entre ambos, pero se rompería al renombrar una columna.
      queryBuilder.andWhere(
        `(
          user.email ILIKE :pattern
          OR profile.firstName ILIKE :pattern
          OR profile.lastName ILIKE :pattern
          OR profile.userName ILIKE :pattern
          OR profile.employee_number ILIKE :pattern
        )`,
        { pattern },
      );
    }

    // `sortBy` viene validado contra una lista blanca (`@IsIn`), de modo que el
    // identificador de columna que se interpola aquí nunca es texto arbitrario.
    const sortColumn = sortBy
      ? USER_SORT_COLUMNS[sortBy]
      : USER_SORT_COLUMNS.createdAt;
    const sortDirection: 'ASC' | 'DESC' = sortDir === 'asc' ? 'ASC' : 'DESC';

    queryBuilder.orderBy(sortColumn, sortDirection);

    // Desempate estable: sin un segundo criterio, dos filas con el mismo valor
    // pueden intercambiarse entre páginas y hacer que un registro se repita o
    // desaparezca al paginar.
    if (sortColumn !== USER_SORT_COLUMNS.createdAt) {
      queryBuilder.addOrderBy(USER_SORT_COLUMNS.createdAt, 'DESC');
    }
    queryBuilder.addOrderBy('user.id', 'ASC');

    queryBuilder.skip((page - 1) * limit).take(limit);

    // DEBUG TEMPORAL (quitar al resolver): diagnóstico de listado vacío
    const dbOpts: any = this.dataSource.options;
    console.log('[USERS][filter] DB:', dbOpts.database, '@', dbOpts.host, '| filtros recibidos:', JSON.stringify(queryDto));
    console.log('[USERS][filter] SQL:', queryBuilder.getSql(), '| params:', JSON.stringify(queryBuilder.getParameters()));
    console.log('[USERS][filter] users en la tabla (sin filtros):', await this.repo.count(), '| activos:', await this.repo.count({ where: { isActive: true } }));

    const [items, totalItems] = await queryBuilder.getManyAndCount();
    console.log('[USERS][filter] resultado -> items:', items.length, '| totalItems:', totalItems);

    return {
      items,
      meta: {
        totalItems,
        itemCount: items.length,
        itemsPerPage: limit,
        totalPages: Math.ceil(totalItems / limit),
        currentPage: page,
      },
    };
  }
}
