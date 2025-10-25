import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { SessionsSocketService } from './sessions-socket.service';
import { CreateSessionsSocketDto } from './dto/create-sessions-socket.dto';
import { UpdateSessionsSocketDto } from './dto/update-sessions-socket.dto';

@Controller('sessions-socket')
export class SessionsSocketController {
  constructor(private readonly sessionsSocketService: SessionsSocketService) {}

  /* @Post()
  create(@Body() createSessionsSocketDto: CreateSessionsSocketDto) {
    return this.sessionsSocketService.create(createSessionsSocketDto);
  }

  @Get()
  findAll() {
    return this.sessionsSocketService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.sessionsSocketService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateSessionsSocketDto: UpdateSessionsSocketDto) {
    return this.sessionsSocketService.update(+id, updateSessionsSocketDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.sessionsSocketService.remove(+id);
  } */
}
