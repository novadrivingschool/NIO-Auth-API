import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class CreateHandshakeDto {
  @ApiProperty({ description: 'Usuario al que se le pide la verificación' })
  @IsUUID()
  targetUserId: string;
}
