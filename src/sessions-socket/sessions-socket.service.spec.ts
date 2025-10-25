import { Test, TestingModule } from '@nestjs/testing';
import { SessionsSocketService } from './sessions-socket.service';

describe('SessionsSocketService', () => {
  let service: SessionsSocketService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SessionsSocketService],
    }).compile();

    service = module.get<SessionsSocketService>(SessionsSocketService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
