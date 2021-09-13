import { Injectable, NestMiddleware } from '@nestjs/common';
// import config from 'config';
import { NextFunction, Request, Response } from 'express';

import { ReqHelper } from '../helpers/req.helper';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class CorsMiddleware extends ReqHelper implements NestMiddleware {
  private corsSettings;
  constructor(config: ConfigService) {
    super();
    this.corsSettings = config.get<ICorsSettings>('CORS_SETTINGS');
  }

  public use(req: Request & { credentials: string | boolean }, res: Response, next: NextFunction) {
    const origin = this.getOrigin(req);

    const allowedOrigins = this.corsSettings.allowedOrigins;
    const allowedMethods = this.corsSettings.allowedMethods;
    const allowedHeaders = this.corsSettings.allowedHeaders;

    const findOrigin = allowedOrigins.find((o) => o === origin);

    if (origin && allowedOrigins.length) {
      res.setHeader('Access-Control-Allow-Origin', findOrigin || allowedOrigins[0]);
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }

    res.setHeader('Access-Control-Allow-Methods', allowedMethods.join(','));
    res.setHeader('Access-Control-Allow-Headers', allowedHeaders.join(','));
    res.setHeader('Access-Control-Allow-Credentials', `${this.corsSettings.allowedCredentials}`);
    res.setHeader('Access-Control-Max-Age', '1728000');

    return next();
  }
}
