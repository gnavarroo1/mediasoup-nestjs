import { AppModule } from './app.module';
import { AppConfigService } from './config/config.service';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as cookieParser from 'cookie-parser';
import * as helmet from 'helmet';
import * as fs from 'fs';
import { HttpsOptions } from '@nestjs/common/interfaces/external/https-options.interface';

async function bootstrap() {
  let httpsOptions: HttpsOptions = {
    key: '',
    cert: '',
  };
  if (process.env.ENVIRONMENT !== 'DEVELOPMENT') {
    httpsOptions = {
      key: fs.readFileSync(process.env.DTLSPRIVATEKEYFILE),
      cert: fs.readFileSync(process.env.DTLSCERTIFICATEFILE),
    };
  }

  const app = await NestFactory.create(AppModule, {
    httpsOptions,
  });

  const options = new DocumentBuilder()
    .setTitle('NestJS Mediasoup Example')
    .addServer('http://')
    .addServer('https://')
    .setDescription('The NestJS Mediasoup Example description')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, options);
  SwaggerModule.setup('swagger', app, document);
  app.useGlobalPipes(new ValidationPipe());
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors();
  await app.listen(process.env.API_PORT);
}
bootstrap();
