import { Test, TestingModule } from '@nestjs/testing';
import { MediasoupController } from './mediasoup.controller';

describe('MediasoupController', () => {
  let controller: MediasoupController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MediasoupController],
    }).compile();

    controller = module.get<MediasoupController>(MediasoupController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
