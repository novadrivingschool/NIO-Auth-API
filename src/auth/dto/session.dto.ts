import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class SessionDto {
  @ApiProperty({ format: 'uuid' })
  id: string

  @ApiProperty({ enum: ['electron', 'web', 'mobile'], default: 'electron' })
  client: 'electron' | 'web' | 'mobile'

  @ApiProperty()
  deviceId: string

  @ApiPropertyOptional({ nullable: true })
  label?: string | null
}
