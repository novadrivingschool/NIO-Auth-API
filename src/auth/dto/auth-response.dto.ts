import { UserDto } from './user.dto';
import { TokensDto } from './tokens.dto';
import { SessionDto } from './session.dto';

export class AuthResponseDto {
    user: UserDto;
    tokens: TokensDto;
    session?: SessionDto
}