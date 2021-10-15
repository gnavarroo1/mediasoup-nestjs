import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { LoggerService } from '../../../logger/logger.service';
import { IMediasoupSettings } from '../../../../types/global';
import { AppConfigService } from '../../../config/config.service';
import { IClientQuery } from '../../types/mediasoup.types';
import { MediasoupService } from '../../services/mediasoup.service';

import {
  TMediaProduceCapabilities,
  TTransportKind,
} from '../../types/mediasoup.types';
import { RtpCapabilities } from 'mediasoup/lib/RtpParameters';

@WebSocketGateway(8098, {
  cors: {
    methods: ['GET', 'POST'],
  },
})
export class MediasoupGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;
  private mediasoupSettings: IMediasoupSettings;
  constructor(
    private readonly logger: LoggerService,
    private readonly appConfig: AppConfigService,
    private mediasoupService: MediasoupService,
  ) {
    this.mediasoupSettings = appConfig.mediasoupSettings;
    this.logger.info(`Creating workers`, 'Constructor');
  }

  afterInit(server: Server): any {
    this.mediasoupService.createWorkers();
  }

  async handleConnection(@ConnectedSocket() client: Socket): Promise<boolean> {
    this.mediasoupService.server = this.server;
    this.logger.info(`User connected on ${client.id}`);
    const { sessionId } = this.getClientQuery(client);
    try {
      return this.mediasoupService.initSession(sessionId);
    } catch (e) {
      this.logger.error(e.message, e.stack, 'handleConnection');
    }
  }

  public async handleDisconnect(
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    try {
      const { userId, sessionId } = this.getClientQuery(client);
      await this.mediasoupService.removeClient(sessionId, userId);
    } catch (error) {
      this.logger.error(
        error.message,
        error.stack,
        'WssGateway - handleDisconnect',
      );
    }
  }

  @SubscribeMessage('media')
  public async media(client: Socket, data: any): Promise<any> {
    const { userId, sessionId } = this.getClientQuery(client);
    try {
      // this.logger.info(
      //   `the client ${userId}, requested action ${data.action} `,
      //   'speakmsclient',
      // );
      return await this.mediasoupService.handleMedia(client, {
        data,
        sessionId: sessionId,
        userId: userId,
      });
    } catch (error) {
      this.logger.error(error.message, error.stack, 'WssGateway - media');
    }
  }

  @SubscribeMessage('joinRoom')
  public async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    payload: {
      kind: TTransportKind;
      rtpCapabilities: RtpCapabilities;
      producerCapabilities: TMediaProduceCapabilities;
    },
  ): Promise<any> {
    const { userId, sessionId, device } = this.getClientQuery(client);
    console.log(payload.kind, 'KIND');
    return this.mediasoupService.joinRoom({
      userId,
      sessionId,
      device,
      kind: payload.kind,
      client,
      rtpCapabilities: payload.rtpCapabilities,
      producerCapabilities: payload.producerCapabilities,
    });
  }

  @SubscribeMessage('addClient')
  public async handleAddClient(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: any,
  ): Promise<any> {
    const { userId, sessionId, device, kind } = this.getClientQuery(client);
    return this.mediasoupService.addClient(client, {
      query: {
        userId,
        sessionId,
        device,
        kind: payload.kind,
      },
      data: payload.data,
    });
  }

  @SubscribeMessage('toggleDevice')
  public async handleToggleDevice(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: any,
  ): Promise<any> {
    const { userId, sessionId } = this.getClientQuery(client);
    client.to(sessionId).emit('toggleDevice', {
      sender: userId,
      action: payload.action,
      kind: payload.kind,
    });
    return payload;
  }

  private getClientQuery(client: Socket): IClientQuery {
    return client.handshake.query as unknown as IClientQuery;
  }
}
