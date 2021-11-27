import { Controller, Get, Param } from '@nestjs/common';
import { MediasoupService } from '../../services/mediasoup.service';
import { throwNOTFOUND } from '../../../common/errors';

@Controller('mediasoup')
export class MediasoupController {
  constructor(private mediasoupGateway: MediasoupService) {}

  @Get('rooms/stats')
  public async roomsStats() {
    return Array.from(this.mediasoupGateway.rooms.values()).map((room) => {
      return room.stats;
    });
  }

  @Get('rooms/:id/stats')
  public async roomStats(@Param('id') id: string) {
    const room = this.mediasoupGateway.rooms.get(id);
    if (room) {
      return room.stats;
    }
    throwNOTFOUND();
  }
}
