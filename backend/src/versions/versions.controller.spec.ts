import { Test, TestingModule } from '@nestjs/testing';
import { VersionsController } from './versions.controller';

describe('VersionsController', () => {
  let controller: VersionsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [VersionsController],
    })
      // dependencies (Prisma-backed services, JwtService, the gateway…) are stand-ins — these only check wiring
      .useMocker(() => ({}))
      .compile();

    controller = module.get<VersionsController>(VersionsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
