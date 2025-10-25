import { Test, TestingModule } from '@nestjs/testing';
import { SessionsSocketController } from './sessions-socket.controller';
import { SessionsSocketService } from './sessions-socket.service';

describe('SessionsSocketController', () => {
  let controller: SessionsSocketController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SessionsSocketController],
      providers: [SessionsSocketService],
    }).compile();

    controller = module.get<SessionsSocketController>(SessionsSocketController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
