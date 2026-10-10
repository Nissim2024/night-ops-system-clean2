import { Test, TestingModule } from '@nestjs/testing';
import { TasksController } from './tasks.controller';

describe('TasksController', () => {
  let controller: TasksController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TasksController],
    })
      // dependencies (Prisma-backed services, JwtService, the gateway…) are stand-ins — these only check wiring
      .useMocker(() => ({}))
      .compile();

    controller = module.get<TasksController>(TasksController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
