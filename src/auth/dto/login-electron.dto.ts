import { IsEmail, IsNotEmpty, IsOptional, IsString, Length } from 'class-validator'

export class LoginElectronDto {
    @IsEmail() email: string
    @IsString() @IsNotEmpty() password: string
    @IsString() @Length(10, 64) deviceId: string
    @IsString() @IsOptional() label?: string
}
