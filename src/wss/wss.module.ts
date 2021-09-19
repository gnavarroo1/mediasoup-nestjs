import { Module } from '@nestjs/common';
import { LoggerService } from '../logger/logger.service';
import { WssController } from './wss.controller';
import { WssGateway } from './wss.gateway';
import { AppConfigModule } from '../config/config.module';
import { MediasoupService } from './mediasoup.service';

@Module({
  imports: [AppConfigModule],
  providers: [
    WssGateway,
    {
      provide: LoggerService,
      useValue: new LoggerService('Websocket'),
    },
    MediasoupService,
  ],
  exports: [WssGateway],
  controllers: [WssController],
})
export class WssModule {}
