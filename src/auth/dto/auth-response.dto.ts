import { UserDto } from './user.dto';
import { TokensDto } from './tokens.dto';

export class AuthResponseDto {
    user: UserDto;
    tokens: TokensDto;
}