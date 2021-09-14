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
import * as mediasoup from 'mediasoup';
import { Worker, WorkerSettings } from 'mediasoup/lib/types';
import { WssRoom } from './wss.room';
import { LoggerService } from '../logger/logger.service';
import { IClientQuery, IMsMessage, IWorkerInfo } from './wss.interfaces';
import { ConfigService } from '@nestjs/config';
import configuration from '../config/configuration';
import { AppConfigService } from '../config/config.service';
const config: ConfigService = new ConfigService(configuration());
const appSettings = config.get<IAppSettings>('APP_SETTINGS');
const mediasoupSettings = config.get<IMediasoupSettings>('MEDIASOUP_SETTINGS');
const wssPort: number = +process.env.WSS_PORT;

@WebSocketGateway(wssPort, {
  cors: {
    methods: ['GET', 'POST'],
  },
})
export class WssGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;
  private mediasoupSettings: IMediasoupSettings;
  public rooms: Map<string, WssRoom> = new Map<string, WssRoom>();
  public workers: {
    [index: number]: {
      clientsCount: number;
      roomsCount: number;
      pid: number;
      worker: Worker;
    };
  };
  afterInit(): any {
    this.logger.info(`Gateway started on port ${appSettings.wssPort}`);
  }

  constructor(
    private readonly logger: LoggerService,
    private readonly appConfig: AppConfigService,
  ) {
    this.mediasoupSettings = appConfig.mediasoupSettings;
    this.logger.info(`Creating workers`, 'Constructor');
    this.createWorkers();
  }

  async handleConnection(@ConnectedSocket() client: Socket): Promise<void> {
    this.logger.info(`client connected ${client.id}`);
    try {
      const { session_id, user_id, device } = this.getClientQuery(client);
      let room = this.rooms.get(session_id);

      if (!room) {
        this.updateWorkerStats();
        const index = this.getOptimalWorkerIndex();
        room = new WssRoom(
          this.mediasoupSettings,
          this.workers[index].worker,
          index,
          session_id,
          this.logger,
          this.server,
        );
        await room.load();
        this.rooms.set(session_id, room);
        this.logger.info(`room ${session_id} created`);
      } else {
        this.logger.info(session_id, 'client connected to room');
      }
      await room.addClient(
        { session_id: session_id, user_id: user_id, device: device },
        client,
      );
    } catch (error) {
      this.logger.error(
        error.message,
        error.stack,
        'WssGateway - handleConnection',
      );
    }
  }

  public async handleDisconnect(@ConnectedSocket() client: Socket) {
    try {
      const { user_id, session_id } = this.getClientQuery(client);
      const room = this.rooms.get(session_id);
      await room.removeClient(user_id);
      if (!room.clientsCount) {
        room.close();
        this.rooms.delete(session_id);
      }
      return true;
    } catch (error) {
      this.logger.error(
        error.message,
        error.stack,
        'WssGateway - handleDisconnect',
      );
    }
  }

  get workersInfo() {
    this.updateWorkerStats();
    return Object.fromEntries(
      Object.entries(this.workers).map((w) => {
        return [
          w[1].pid,
          {
            workerIndex: parseInt(w[0], 10),
            clientsCount: w[1].clientsCount,
            roomsCount: w[1].roomsCount,
          },
        ];
      }),
    ) as { [pid: string]: IWorkerInfo };
  }

  /**
   * Creates mediasoup workers.
   * @returns {Promise<void>} Promise<void>
   */
  private async createWorkers(): Promise<void> {
    const promises = [];
    const workerSettings = this.mediasoupSettings.worker as WorkerSettings;
    for (let i = 0; i < this.mediasoupSettings.workerPool; i++) {
      promises.push(mediasoup.createWorker(workerSettings));
    }
    this.workers = (await Promise.all(promises)).reduce(
      (acc, worker, index) => {
        acc[index] = {
          clientsCount: 0,
          roomsCount: 0,
          pid: worker.pid,
          worker,
        };

        return acc;
      },
      {},
    );
  }
  /**
   * Updates information about the number of users on the worker.
   * @returns {void} void
   */
  public updateWorkerStats(): void {
    const data: {
      [index: number]: { clientsCount: number; roomsCount: number };
    } = {};
    this.rooms.forEach((room) => {
      if (data[room.workerIndex]) {
        data[room.workerIndex].clientsCount += room.clientsCount;
        data[room.workerIndex].roomsCount += 1;
      } else {
        data[room.workerIndex] = {
          clientsCount: room.clientsCount,
          roomsCount: 1,
        };
      }
    });

    Object.entries(this.workers).forEach(([index, _worker]) => {
      const info = data[index];
      if (info) {
        this.workers[index].clientsCount = info.clientsCount;
        this.workers[index].roomsCount = info.roomsCount;
      } else {
        this.workers[index].clientsCount = 0;
        this.workers[index].roomsCount = 0;
      }
    });
  }
  /**
   * Returns the index of the worker with the least number of participants.
   * @returns {number} number
   */
  private getOptimalWorkerIndex(): number {
    return parseInt(
      Object.entries(this.workers).reduce((prev, curr) => {
        if (prev[1].clientsCount < curr[1].clientsCount) {
          return prev;
        }
        return curr;
      })[0],
      10,
    );
  }

  /**
   * Changes the worker at the room
   * @param {WssRoom} room комната
   * @returns {Promise<void>} Promise<void>
   */
  public async reConfigureMedia(room: WssRoom): Promise<void> {
    try {
      this.updateWorkerStats();
      const index = this.getOptimalWorkerIndex();
      await room.reConfigureMedia(this.workers[index].worker, index);
    } catch (error) {
      this.logger.error(
        error.message,
        error.stack,
        'WssGateway - reConfigureMedia',
      );
    }
  }

  private getClientQuery(@ConnectedSocket() client: Socket): IClientQuery {
    return client.handshake.query as unknown as IClientQuery;
  }
  @SubscribeMessage('mediaRoomClients')
  public async roomClients(@ConnectedSocket() client: Socket) {
    try {
      const { session_id } = this.getClientQuery(client);
      const room = this.rooms.get(session_id);
      return {
        clientsIds: room.clientsIds,
        producerAudioIds: room.audioProducerIds,
        producerVideoIds: room.videoProducerIds,
      };
    } catch (error) {
      this.logger.error(error.message, error.stack, 'WssGateway - roomClients');
    }
  }

  @SubscribeMessage('mediaRoomInfo')
  public async roomInfo(@ConnectedSocket() client: Socket) {
    try {
      const { session_id } = this.getClientQuery(client);
      const room = this.rooms.get(session_id);
      return room.stats;
    } catch (error) {
      this.logger.error(error.message, error.stack, 'WssGateway - roomInfo');
    }
  }

  @SubscribeMessage('media')
  public async media(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: IMsMessage,
  ): Promise<void> {
    // const event = 'media';
    const { user_id, session_id } = this.getClientQuery(client);
    try {
      const room = this.rooms.get(session_id);
      if (room) {
        const d = await room.speakMsClient(user_id, data);
        this.server.to(client.id).emit('media', {
          action: data.action,
          data: d,
          user_id: data.data?.user_id,
          type: data.data?.type,
          kind: data.data?.kind,
        });
      }
    } catch (error) {
      this.logger.error(error.message, error.stack, 'WssGateway - media');
    }
  }

  @SubscribeMessage('mediaReconfigure')
  public async roomReconfigure(@ConnectedSocket() client: Socket) {
    try {
      const { session_id } = this.getClientQuery(client);
      const room = this.rooms.get(session_id);
      if (room) {
        await this.reConfigureMedia(room);
      }

      return true;
    } catch (error) {
      this.logger.error(
        error.message,
        error.stack,
        'WssGateway - roomReconfigure',
      );
    }
  }
}
