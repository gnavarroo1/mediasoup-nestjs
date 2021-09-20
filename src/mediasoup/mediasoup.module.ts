import { Module } from '@nestjs/common';
import { MediasoupController } from './interfaces/rest/mediasoup.controller';
import { MediasoupGateway } from './interfaces/gateway/mediasoup.gateway';
import { AppConfigModule } from '../config/config.module';
import { LoggerService } from '../logger/logger.service';
import { MediasoupService } from './services/mediasoup.service';
@Module({
  imports: [AppConfigModule],
  providers: [
    MediasoupGateway,
    {
      provide: LoggerService,
      useValue: new LoggerService('WebSocket'),
    },
    MediasoupService,
  ],
  controllers: [MediasoupController],
  exports: [MediasoupGateway],
})
export class MediasoupModule {}
