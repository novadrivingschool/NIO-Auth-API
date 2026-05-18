import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsBoolean,
  IsString,
  IsEnum,
  IsInt,
  Min,
  IsArray,
} from 'class-validator';
import { Role } from '../entities/user.entity';

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
