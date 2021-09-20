import { Socket } from 'socket.io';
import { Consumer, Producer, WebRtcTransport } from 'mediasoup/lib/types';
import { RtpCapabilities } from 'mediasoup/lib/RtpParameters';

export interface IClientQuery {
  readonly user_id: string;
  readonly session_id: string;
  readonly device: string;
  readonly kind: TKind;
}

export interface IClient {
  id: string;
  io: Socket;
  media?: IMediasoupClient;
  device: string;
  rtpCapabilities?: RtpCapabilities;
}

export interface IMediasoupClient {
  producerVideo?: Producer;
  producerAudio?: Producer;
  producerTransport?: WebRtcTransport;
  consumerTransport?: WebRtcTransport;
  consumersVideo?: Map<string, Consumer>;
  consumersAudio?: Map<string, Consumer>;
}

export interface IWorkerInfo {
  workerIndex: number;
  clientsCount: number;
  roomsCount: number;
  pidInfo?: any;
}

export interface IMsMessage {
  readonly action:
    | 'getRouterRtpCapabilities'
    | 'createWebRtcTransport'
    | 'connectWebRtcTransport'
    | 'produce'
    | 'consume'
    | 'restartIce'
    | 'requestConsumerKeyFrame'
    | 'getTransportStats'
    | 'getProducerStats'
    | 'getConsumerStats'
    | 'getAudioProducerIds'
    | 'getVideoProducerIds'
    | 'producerClose'
    | 'producerPause'
    | 'producerResume'
    | 'allProducerClose'
    | 'allProducerPause'
    | 'allProducerResume';
  readonly data?: Record<string, unknown>;
}

export type TPeer = {
  type: TKind;
};
export class SocketTimeoutError extends Error {
  constructor(message) {
    super(message);

    this.name = 'SocketTimeoutError';

    if (Error.hasOwnProperty('captureStackTrace'))
      // Just in V8.
      Error.captureStackTrace(this, SocketTimeoutError);
    else this.stack = new Error(message).stack;
  }
}
export type AddClientDto = {
  session_id: string;
  user_id: string;
  device: string;
  kind: TKind;
  client: Socket;
  rtpCapabilities: RtpCapabilities;
};
export type TKind = 'consumer' | 'producer';

export class RoomClient {
  get id(): string {
    return this._id;
  }

  set id(value: string) {
    this._id = value;
  }

  get io(): Socket {
    return this._io;
  }

  set io(value: Socket) {
    this._io = value;
  }

  get device(): string {
    return this._device;
  }

  set device(value: string) {
    this._device = value;
  }

  get rtpCapabilities(): RtpCapabilities {
    return this._rtpCapabilities;
  }

  set rtpCapabilities(value: RtpCapabilities) {
    this._rtpCapabilities = value;
  }

  get media(): IMediasoupClient {
    return this._media;
  }

  set media(value: IMediasoupClient) {
    this._media = value;
  }
  get joined(): boolean {
    return this._joined;
  }
  set joined(value) {
    this._joined = value;
  }
  get kind(): TKind {
    return this._kind;
  }

  set kind(value: TKind) {
    this._kind = value;
  }

  private _id: string;
  private _io: Socket;
  private _device: string;
  private _rtpCapabilities: RtpCapabilities;
  private _joined = false;
  private _kind: TKind;

  get consumersVideo(): Map<string, Consumer> {
    return this._media.consumersVideo;
  }
  get consumersAudio(): Map<string, Consumer> {
    return this._media.consumersVideo;
  }

  get consumerTransport(): WebRtcTransport {
    return this._media.consumerTransport;
  }
  set consumerTransport(value) {
    this._media.consumerTransport = value;
  }
  get producerTransport(): WebRtcTransport {
    return this._media.producerTransport;
  }
  set producerTransport(value) {
    this.media.producerTransport = value;
  }
  get producerAudio(): Producer {
    return this._media.producerAudio;
  }
  set producerAudio(value) {
    this._media.producerAudio = value;
  }
  get producerVideo(): Producer {
    return this._media.producerVideo;
  }
  set producerVideo(value) {
    this._media.producerVideo = value;
  }

  private _media: IMediasoupClient = {
    consumersVideo: new Map<string, Consumer>(),
    consumersAudio: new Map<string, Consumer>(),
  };
}
