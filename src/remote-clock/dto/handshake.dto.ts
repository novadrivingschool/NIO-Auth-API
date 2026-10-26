import { IsString, Length } from 'class-validator';

export class HandshakeNonceDto {
  @IsString()
  @Length(16, 128)
  nonce: string;
}
