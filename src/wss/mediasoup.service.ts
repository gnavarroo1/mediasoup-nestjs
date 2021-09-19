import { Injectable } from '@nestjs/common';
import { IMediasoupSettings } from '../../types/global';
import { WssRoom } from './wss.room';
import { Worker } from 'mediasoup/lib/types';
import { LoggerService } from '../logger/logger.service';
import { throwNOTFOUND } from '../common/errors';

@Injectable()
export class MediasoupService {
  private _rooms: Map<string, WssRoom> = new Map<string, WssRoom>();
  private _workers: {
    [index: number]: {
      clientsCount: number;
      roomsCount: number;
      pid: number;
      worker: Worker;
    };
  };
  constructor(private readonly logger: LoggerService) {}
  // get mediasoupSettings(): IMediasoupSettings {
  //   return this._mediasoupSettings;
  // }
  //
  // set mediasoupSettings(value: IMediasoupSettings) {
  //   this._mediasoupSettings = value;
  // }

  get rooms(): Map<string, WssRoom> {
    return this._rooms;
  }

  set rooms(value: Map<string, WssRoom>) {
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

  async handleMediaEvent(payload: {
    user_id: string;
    session_id: string;
    data: any;
  }): Promise<any> {
    try {
      const room = this.rooms.get(payload.session_id);
      if (room) {
        return await room.speakMsClient(payload.user_id, payload.data);
      }
      throwNOTFOUND();
    } catch (error) {
      this.logger.error(error.message, error.stack, 'WssGateway - media');
    }
  }

  async handleMediaReconfigureEvent(data: any): Promise<any> {
    try {
      const room = this.rooms.get(data.session_id);
      if (room) {
        await this.reConfigureMedia(room);
      }
      throwNOTFOUND();
    } catch (error) {
      this.logger.error(
        error.message,
        error.stack,
        'WssGateway - roomReconfigure',
      );
    }
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
}
