import { Injectable } from '@nestjs/common';
import {
  IMediasoupSettings,
  IMediasoupWorkerSettings,
} from '../../../types/global';
import { Worker, WorkerSettings } from 'mediasoup/lib/types';
import { LoggerService } from '../../logger/logger.service';
import { AppConfigService } from '../../config/config.service';
import { MediasoupRoom } from '../types/room.mediasoup';
import * as mediasoup from 'mediasoup';
import {
  AddClientDto,
  IClientQuery,
  IWorkerInfo,
} from '../types/mediasoup.types';
import { Server, Socket } from 'socket.io';

@Injectable()
export class MediasoupService {
  set server(value: Server) {
    this._server = value;
  }
  get rooms(): Map<string, MediasoupRoom> {
    return this._rooms;
  }
  set rooms(value: Map<string, MediasoupRoom>) {
    this._rooms = value;
  }
  get workers(): {
    [p: number]: {
      clientsCount: number;
      roomsCount: number;
      pid: number;
      worker: Worker;
    };
  } {
    return this._workers;
  }
  set workers(value: {
    [p: number]: {
      clientsCount: number;
      roomsCount: number;
      pid: number;
      worker: Worker;
    };
  }) {
    this._workers = value;
  }
  get workersInfo() {
    this.updateWorkerStats();
    return Object.fromEntries(
      Object.entries(this._workers).map((w) => {
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
  private _rooms: Map<string, MediasoupRoom> = new Map<string, MediasoupRoom>();
  private _workers: {
    [index: number]: {
      clientsCount: number;
      roomsCount: number;
      pid: number;
      worker: Worker;
    };
  };
  private workerSettings: IMediasoupWorkerSettings;
  private workerPool: number;
  private mediasoupSettings: IMediasoupSettings;
  private _server: Server;
  constructor(
    private readonly logger: LoggerService,
    private readonly appConfig: AppConfigService,
  ) {
    this.workerSettings = appConfig.mediasoupSettings.worker;
    this.mediasoupSettings = appConfig.mediasoupSettings;
    this.workerPool = appConfig.mediasoupSettings.workerPool;
    this.createWorkers();
  }

  /**
   * Creates mediasoup workers.
   * @returns {Promise<void>} Promise<void>
   */
  public async createWorkers(): Promise<void> {
    const promises = [];
    const workerSettings = this.workerSettings as WorkerSettings;
    for (let i = 0; i < this.workerPool; i++) {
      promises.push(mediasoup.createWorker(workerSettings));
    }
    this._workers = (await Promise.all(promises)).reduce(
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
   * Returns the index of the worker with the least number of participants.
   * @returns {number} number
   */
  public getOptimalWorkerIndex(): number {
    return parseInt(
      Object.entries(this._workers).reduce((prev, curr) => {
        if (prev[1].clientsCount < curr[1].clientsCount) {
          return prev;
        }
        return curr;
      })[0],
      10,
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
    this._rooms.forEach((room) => {
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

    Object.entries(this._workers).forEach(([index, _worker]) => {
      const info = data[index];
      if (info) {
        this._workers[index].clientsCount = info.clientsCount;
        this._workers[index].roomsCount = info.roomsCount;
      } else {
        this._workers[index].clientsCount = 0;
        this._workers[index].roomsCount = 0;
      }
    });
  }

  /**
   * Changes the worker at the room
   * @param {MediasoupRoom} room room
   * @returns {Promise<void>} Promise<void>
   */
  public async reConfigureMedia(room: MediasoupRoom): Promise<void> {
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

  public async initSession(sessionId: string): Promise<boolean> {
    let room = this._rooms.get(sessionId);
    if (!room) {
      room = new MediasoupRoom(this.logger, this.appConfig, this._server);
      this.updateWorkerStats();
      const index = this.getOptimalWorkerIndex();
      room.worker = this._workers[index].worker;
      room.workerIndex = index;
      room.sessionId = sessionId;
      await room.load();
      this._rooms.set(sessionId, room);
      this.logger.info(`room ${sessionId} created`);
      return true;
    } else {
      this.logger.info(`room ${sessionId} already exists`);
      return false;
    }
  }

  public async removeClient(sessionId: string, userId: string): Promise<void> {
    const room = this._rooms.get(sessionId);
    await room.removeClient(userId);
    if (!room.clientsCount) {
      room.close();
      this._rooms.delete(sessionId);
    }
  }

  public async addClient(
    client: Socket,
    payload: {
      query: IClientQuery;
      data: any;
    },
  ): Promise<any> {
    const room = this._rooms.get(payload.query.sessionId);
    this.logger.warn(room.clientsCount, 'ADDCLIENT');
    if (!room) {
      await this.initSession(payload.query.sessionId);
    }
    return room.addClient(payload.query, client, payload.data);
  }

  public async joinRoom(addClientDto: AddClientDto): Promise<any> {
    const { client, kind, userId, device, sessionId } = addClientDto;

    const room = this._rooms.get(sessionId);

    return room.joinRoom(
      {
        sessionId: sessionId,
        userId: userId,
        device: device,
        kind: kind,
      },
      client,
      addClientDto.rtpCapabilities,
      addClientDto.producerCapabilities,
    );
  }

  public async handleMedia(client: Socket, data: any): Promise<any> {
    const room = this._rooms.get(data.sessionId);
    if (room) {
      return room.speakMsClient(data.userId, data.data);
    }
  }

  public async handleConsumerActions(payload: {
    userId: string;
    sessionId: string;
    targetId: string;
    action: 'pause' | 'resume';
    kind: 'audio' | 'video';
  }) {
    const room = this._rooms.get(payload.sessionId);
    if (room) {
      switch (payload.action) {
        case 'pause':
          return room.consumerPause(
            payload.userId,
            payload.targetId,
            payload.kind,
          );

        case 'resume':
          return room.consumerResume(
            payload.userId,
            payload.targetId,
            payload.kind,
          );
      }
    } else {
      return { success: false, msg: 'NO SESSION FOUND' };
    }
  }
}
