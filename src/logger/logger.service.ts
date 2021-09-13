import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import configuration from '../config/configuration';

enum ELogLevel {
  debug,
  info,
  warn,
  error,
}

@Injectable()
export class LoggerService extends Logger {
  private _currentLevel: ELogLevel;

  constructor(private readonly _context?: string) {
    super(_context);
    const config = new ConfigService(configuration());
    this._currentLevel = ELogLevel[config.get<ILogSettings>('LOGGER_SETTINGS').level];
  }

  public log(message: any, context?: string) {
    if (this.isValidLevel(ELogLevel.debug)) {
      Logger.log(JSON.stringify(message, null, 2), context || this._context);
    }
  }

  public info(message: any, context?: string) {
    if (this.isValidLevel(ELogLevel.info)) {
      Logger.log(JSON.stringify(message, null, 2), context || this._context);
    }
  }

  public warn(message: any, context?: string) {
    if (this.isValidLevel(ELogLevel.warn)) {
      Logger.warn(JSON.stringify(message, null, 2), context || this._context);
    }
  }

  public error(message: any, trace?: string, context?: string) {
    if (this.isValidLevel(ELogLevel.error)) {
      Logger.error(JSON.stringify(message, null, 2), trace, context || this._context);
    }
  }

  private isValidLevel(level: ELogLevel): boolean {
    return level >= this._currentLevel;
  }
}
