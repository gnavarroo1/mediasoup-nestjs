import {
  OnGatewayConnection,
  OnGatewayDisconnect,
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
const config: ConfigService = new ConfigService(configuration());
const appSettings = config.get<IAppSettings>('APP_SETTINGS');
const mediasoupSettings = config.get<IMediasoupSettings>('MEDIASOUP_SETTINGS');

@WebSocketGateway(appSettings.wssPort)
export class WssGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  public server: Server;
  public rooms: Map<string, WssRoom> = new Map();
  public workers: {
    [index: number]: {
      clientsCount: number;
      roomsCount: number;
      pid: number;
      worker: Worker;
    };
  };
  constructor(private readonly logger: LoggerService) {
    this.createWorkers();
  }

  async handleConnection(client: Socket): Promise<any> {
    try {
      const query = this.getClientQuery(client);

      let room = this.rooms.get(query.session_id);

      if (!room) {
        this.updateWorkerStats();

        const index = this.getOptimalWorkerIndex();

        room = new WssRoom(this.workers[index].worker, index, query.session_id, this.logger, this.server);

        await room.load();

        this.rooms.set(query.session_id, room);

        this.logger.info(`room ${query.session_id} created`);
      }

      await room.addClient(query, client);

      return true;
    } catch (error) {
      this.logger.error(error.message, error.stack, 'WssGateway - handleConnection');
    }
  }

  public async handleDisconnect(client: Socket) {
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
      this.logger.error(error.message, error.stack, 'WssGateway - handleDisconnect');
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
    for (let i = 0; i < mediasoupSettings.workerPool; i++) {
      promises.push(mediasoup.createWorker(mediasoupSettings.worker as WorkerSettings));
    }

    this.workers = (await Promise.all(promises)).reduce((acc, worker, index) => {
      acc[index] = {
        clientsCount: 0,
        roomsCount: 0,
        pid: worker.pid,
        worker,
      };

      return acc;
    }, {});
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
      this.logger.error(error.message, error.stack, 'WssGateway - reConfigureMedia');
    }
  }

  private getClientQuery(client: Socket): IClientQuery {
    return client.handshake.query as unknown as IClientQuery;
  }
  @SubscribeMessage('mediaRoomClients')
  public async roomClients(client: Socket) {
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
  public async roomInfo(client: Socket) {
    try {
      const { session_id } = this.getClientQuery(client);

      const room = this.rooms.get(session_id);

      return room.stats;
    } catch (error) {
      this.logger.error(error.message, error.stack, 'WssGateway - roomInfo');
    }
  }

  @SubscribeMessage('media')
  public async media(client: Socket, msg: IMsMessage) {
    try {
      const { user_id, session_id } = this.getClientQuery(client);

      const room = this.rooms.get(session_id);

      return await room.speakMsClient(user_id, msg);
    } catch (error) {
      this.logger.error(error.message, error.stack, 'WssGateway - media');
    }
  }

  @SubscribeMessage('mediaReconfigure')
  public async roomReconfigure(client: Socket) {
    try {
      const { session_id } = this.getClientQuery(client);

      const room = this.rooms.get(session_id);

      if (room) {
        await this.reConfigureMedia(room);
      }

      return true;
    } catch (error) {
      this.logger.error(error.message, error.stack, 'WssGateway - roomReconfigure');
    }
  }
}
