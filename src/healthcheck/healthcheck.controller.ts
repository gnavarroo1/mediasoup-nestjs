import { Controller, Get } from '@nestjs/common';
import { ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('healthz')
@Controller('healthz')
export class HealthcheckController {
  @ApiResponse({
    status: 200,
    description: 'Health check',
  })
  @Get()
  public async healthz() {
    return { message: 'OK' };
  }
}
