// import { Headers, Body, Controller, Get, Param, Post } from '@nestjs/common';
// import { throwNOTFOUND } from '../common/errors';
// import { WssGateway } from './wss.gateway';
// import * as pidusage from 'pidusage';
//
// @Controller('websocket')
// export class WssController {
//   constructor(private readonly wssGateway: WssGateway) {}
//
//   @Get('workers/stats')
//   public async workersStats() {
//     const workers = this.wssGateway.workersInfo;
//     const usage = await pidusage(Object.keys(workers));
//     Object.keys(workers).forEach((key) => {
//       workers[key].pidInfo = usage[key] || {};
//     });
//
//     return workers;
//   }
//
//   @Get('rooms/stats')
//   public async roomsStats() {
//     return Array.from(this.wssGateway.rooms.values()).map((room) => {
//       return room.stats;
//     });
//   }
//
//   @Get('rooms/:id/stats')
//   public async roomStats(@Param('id') id: string) {
//     const room = this.wssGateway.rooms.get(id);
//
//     if (room) {
//       return room.stats;
//     }
//
//     throwNOTFOUND();
//   }
//
//   @Get('rooms/:id/change_worker')
//   public async roomChangeWorker(@Param('id') id: string) {
//     const room = this.wssGateway.rooms.get(id);
//     if (room) {
//       await this.wssGateway.reConfigureMedia(room);
//
//       return { msg: 'ok' };
//     }
//     throwNOTFOUND();
//   }
//
//   // @Post('message-connection-handler')
//   // public async meeting(@Headers() header: any, @Body() request: any) {
//   //   console.log(request);
//   //   return this.wssGateway.handleMediaEvent(request);
//   // }
// }
