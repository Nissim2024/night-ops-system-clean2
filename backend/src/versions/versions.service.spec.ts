import { Test, TestingModule } from '@nestjs/testing';
import { VersionsService } from './versions.service';

describe('VersionsService', () => {
  let service: VersionsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [VersionsService],
    })
      // dependencies (Prisma-backed services, JwtService, the gateway…) are stand-ins — these only check wiring
      .useMocker(() => ({}))
      .compile();

    service = module.get<VersionsService>(VersionsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
