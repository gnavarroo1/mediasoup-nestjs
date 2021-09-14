import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
/**
 * Service dealing with app config based operations.
 *
 * @class
 */
@Injectable()
export class AppConfigService {
  constructor(private configService: ConfigService) {}

  get name(): string {
    return this.configService.get<string>('app.APP_SETTINGS.appPort');
  }
  get env(): string {
    return this.configService.get<string>('app.env');
  }
  get url(): string {
    return this.configService.get<string>('app.url');
  }
  get port(): number {
    return Number(this.configService.get<number>('app.port'));
  }
  get loggerSettings(): any {
    return this.configService.get('app.LOGGER_SETTINGS');
  }

  get corsSettings(): any {
    return this.configService.get('app.CORS_SETTINGS');
  }
  get mediasoupSettings(): IMediasoupSettings {
    return this.configService.get<IMediasoupSettings>('app.MEDIASOUP_SETTINGS');
  }
}
