import { Socket } from 'socket.io';
import { Consumer, Producer, WebRtcTransport } from 'mediasoup/lib/types';
import { RtpCapabilities } from 'mediasoup/lib/RtpParameters';

export interface IClientQuery {
  readonly userId: string;
  readonly sessionId: string;
  readonly device: string;
  readonly kind: TTransportKind;
}

export interface IMediasoupClient {
  producerVideo?: Producer;
  producerScreen?: Producer;
  producerAudio?: Producer;
  producerTransport?: WebRtcTransport;
  consumerTransport?: WebRtcTransport;
  consumersVideo?: Map<string, Consumer>;
  consumersAudio?: Map<string, Consumer>;
  consumersScreen?: Map<string, Consumer>;
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

export type TMediaKindValue = {
  kind: TMediaKind;
  value: boolean;
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
  sessionId: string;
  userId: string;
  device: string;
  kind: TTransportKind;
  client: Socket;
  rtpCapabilities: RtpCapabilities;
  producerCapabilities: TMediaProduceCapabilities;
};
const MEDIA_KIND_AUDIO = 'audio';
const MEDIA_KIND_VIDEO = 'video';
// export type TTransportKind = 'consumer' | 'producer';
export type TTransportKind = 'consumer' | 'producer';
export type TState = 'paused' | 'resumed';
export type TMediaKind = 'audio' | 'video';

export type TMediaProduceCapabilities = {
  producerAudioEnabled: boolean;
  producerVideoEnabled: boolean;
  globalAudioEnabled: boolean;
  globalVideoEnabled: boolean;
  isScreenSharing: boolean;
};

export class RoomClient {
  private _id: string;
  private _io: Socket;
  private _device: string;
  private _rtpCapabilities: RtpCapabilities;
  private _joined = false;
  private _kind: TTransportKind;
  private _producerAudioEnabled = false;
  private _globalProduceAudioEnabled = true;
  private _globalProduceVideoEnabled = true;
  private _producerVideoEnabled = false;
  private _media: IMediasoupClient = {
    consumersVideo: new Map<string, Consumer>(),
    consumersScreen: new Map<string, Consumer>(),
    consumersAudio: new Map<string, Consumer>(),
  };
  private _isScreenSharing = false;
  get isScreenSharing(): boolean {
    return this._isScreenSharing;
  }
  set isScreenSharing(value: boolean) {
    this._isScreenSharing = value;
  }

  get producerScreen(): Producer {
    return this._media.producerScreen;
  }

  set producerScreen(value) {
    this._media.producerScreen = value;
  }

  get globalProduceAudioEnabled(): boolean {
    return this._globalProduceAudioEnabled;
  }

  set globalProduceAudioEnabled(value: boolean) {
    this._globalProduceAudioEnabled = value;
  }

  get globalProduceVideoEnabled(): boolean {
    return this._globalProduceVideoEnabled;
  }

  set globalProduceVideoEnabled(value: boolean) {
    this._globalProduceVideoEnabled = value;
  }

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
  get kind(): TTransportKind {
    return this._kind;
  }

  set kind(value: TTransportKind) {
    this._kind = value;
  }
  get consumersVideo(): Map<string, Consumer> {
    return this._media.consumersVideo;
  }
  get consumersScreen(): Map<string, Consumer> {
    return this._media.consumersScreen;
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
  set producerAudioEnabled(value) {
    this._producerAudioEnabled = value;
  }
  get producerAudioEnabled() {
    return this._producerAudioEnabled;
  }
  set producerVideoEnabled(value) {
    this._producerVideoEnabled = value;
  }
  get producerVideoEnabled() {
    return this._producerVideoEnabled;
  }

  set globalProducerCapabilitiesByKind(mediaKindValue: TMediaKindValue) {
    switch (mediaKindValue.kind) {
      case MEDIA_KIND_AUDIO:
        this._globalProduceAudioEnabled = mediaKindValue.value;
        break;
      case MEDIA_KIND_VIDEO:
        this._globalProduceVideoEnabled = mediaKindValue.value;
        break;
    }
  }
  public getGlobalProducerCapabilitiesByKind(kind: TMediaKind) {
    switch (kind) {
      case MEDIA_KIND_AUDIO:
        return this._globalProduceAudioEnabled;
      case MEDIA_KIND_VIDEO:
        return this._globalProduceVideoEnabled;
    }
  }

  set producerCapabilitiesByKind(mediaKindValue: TMediaKindValue) {
    switch (mediaKindValue.kind) {
      case 'audio':
        this._producerAudioEnabled = mediaKindValue.value;
        break;
      case 'video':
        this._producerVideoEnabled = mediaKindValue.value;
        break;
    }
  }
  public getProducerCapabilitiesByKind(kind: TMediaKind) {
    switch (kind) {
      case 'audio':
        return this._producerAudioEnabled;
      case 'video':
        return this._producerVideoEnabled;
    }
  }
}
