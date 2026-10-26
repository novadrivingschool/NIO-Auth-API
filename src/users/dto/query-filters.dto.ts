import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsBoolean,
  IsString,
  IsEnum,
  IsInt,
  IsIn,
  Min,
  MaxLength,
  IsArray,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { Role } from '../entities/user.entity';

/**
 * Lista blanca de campos ordenables.
 *
 * Es una lista cerrada y no un string libre a propósito: el valor se
 * interpola en un `ORDER BY`, donde TypeORM no parametriza el identificador de
 * columna. Aceptar cualquier cadena abriría una inyección SQL.
 */
export const USER_SORT_FIELDS = [
  'createdAt',
  'email',
  'isActive',
  'firstName',
  'lastName',
  'employee_number',
] as const;

export type UserSortField = (typeof USER_SORT_FIELDS)[number];

/**
 * Traducción de campo público a *property path* de la entidad.
 *
 * Deben ser property paths (`profile.firstName`) y no nombres de columna de
 * base de datos (`profile.first_name`): al combinar `ORDER BY` con `skip/take`
 * y un join, TypeORM resuelve el orden con `findColumnWithPropertyPath()`. Si
 * el path no existe como propiedad, devuelve `undefined` y la consulta revienta
 * con un TypeError, no con un error de SQL.
 */
export const USER_SORT_COLUMNS: Record<UserSortField, string> = {
  createdAt: 'user.createdAt',
  email: 'user.email',
  isActive: 'user.isActive',
  firstName: 'profile.firstName',
  lastName: 'profile.lastName',
  employee_number: 'profile.employee_number',
};

export class QueryFiltersDto {
  @ApiPropertyOptional({
    example: true,
  })
  @IsOptional()
  @IsBoolean() // JSON ya envía un true/false real, no un string
  isActive?: boolean;

  @ApiPropertyOptional({
    enum: Role,
    isArray: true, // <--- Crucial para que Swagger UI muestre el selector múltiple
    example: [Role.ADMIN, Role.EMPLOYEE],
    description: 'Filtrar por uno o varios roles simultáneamente',
  })
  @IsOptional()
  @IsArray() // <--- Valida que el valor recibido sea un arreglo []
  @IsEnum(Role, { each: true }) // <--- Aplica la validación del Enum a CADA elemento del array
  roles?: Role[];

  @ApiPropertyOptional({
    example: 'NIOJD',
    description:
      'Búsqueda libre sobre email, nombre, apellido, username y employee number',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  // Solo normaliza strings: `String(undefined)` produciría el texto "undefined"
  // cuando el campo no viene en el body y filtraría todo el listado.
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;

  @ApiPropertyOptional({
    enum: USER_SORT_FIELDS,
    example: 'employee_number',
    description: 'Campo de ordenación',
  })
  @IsOptional()
  @IsIn(USER_SORT_FIELDS)
  sortBy?: UserSortField;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], example: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  // Igual que `search`: no convertir un valor ausente en el string "undefined".
  @Transform(({ value }) => (typeof value === 'string' ? value.toLowerCase() : value))
  sortDir?: 'asc' | 'desc';

  @ApiPropertyOptional({
    example: 1,
  })
  @IsOptional()
  @IsInt() // Ya no requiere @Type(() => Number) porque viaja como número en el JSON
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    example: 10,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number = 10;
}
