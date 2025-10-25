import { PartialType } from '@nestjs/mapped-types';
import { CreateSessionsSocketDto } from './create-sessions-socket.dto';

export class UpdateSessionsSocketDto extends PartialType(CreateSessionsSocketDto) {}
