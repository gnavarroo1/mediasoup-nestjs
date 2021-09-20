import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { CorsMiddleware } from './common/middlewares/cors.middleware';
import { LoggerMiddleware } from './common/middlewares/logger.middleware';
import { LoggerModule } from './logger/logger.module';
import { HealthcheckModule } from './healthcheck/healthcheck.module';
import { MediasoupModule } from './mediasoup/mediasoup.module';

@Module({
  imports: [AppConfigModule, LoggerModule, HealthcheckModule, MediasoupModule],
  providers: [],
  controllers: [],
})
export class AppModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void | MiddlewareConsumer {
    consumer.apply(LoggerMiddleware, CorsMiddleware).forRoutes('*');
  }
}
