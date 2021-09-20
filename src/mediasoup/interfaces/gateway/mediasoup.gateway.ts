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
import { IClientQuery } from '../../../wss/wss.interfaces';
import { MediasoupService } from '../../services/mediasoup.service';

import { TKind } from '../../types/mediasoup.types';
import { RtpCapabilities } from 'mediasoup/lib/RtpParameters';

@WebSocketGateway({
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
    const { session_id } = this.getClientQuery(client);
    try {
      return this.mediasoupService.initSession(session_id);
    } catch (e) {
      this.logger.error(e.message, e.stack, 'handleConnection');
    }
  }

  public async handleDisconnect(
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    try {
      const { user_id, session_id } = this.getClientQuery(client);
      await this.mediasoupService.removeClient(session_id, user_id);
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
    const { user_id, session_id } = this.getClientQuery(client);
    try {
      // this.logger.info(
      //   `the client ${user_id}, requested action ${data.action} `,
      //   'speakmsclient',
      // );
      return await this.mediasoupService.handleMedia(client, {
        data,
        session_id: session_id,
        user_id: user_id,
      });
    } catch (error) {
      this.logger.error(error.message, error.stack, 'WssGateway - media');
    }
  }

  @SubscribeMessage('joinRoom')
  public async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { kind: TKind; rtpCapabilities: RtpCapabilities },
  ): Promise<any> {
    const { user_id, session_id, device } = this.getClientQuery(client);
    const res = await this.mediasoupService.joinRoom({
      user_id,
      session_id,
      device,
      kind: payload.kind,
      client,
      rtpCapabilities: payload.rtpCapabilities,
    });
    return res;
  }

  @SubscribeMessage('addClient')
  public async handleAddClient(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: any,
  ): Promise<any> {
    const { user_id, session_id, device, kind } = this.getClientQuery(client);
    return await this.mediasoupService.addClient(client, {
      query: {
        user_id,
        session_id,
        device,
        kind: payload.kind,
      },
      data: payload.data,
    });
  }

  private getClientQuery(client: Socket): IClientQuery {
    return client.handshake.query as unknown as IClientQuery;
  }
}
