import { Socket } from 'socket.io';
import { Consumer, Producer, WebRtcTransport } from 'mediasoup/lib/types';

export interface IClientQuery {
  readonly user_id: string;
  readonly session_id: string;
  readonly device: string;
}

export interface IClient {
  id: string;
  io: Socket;
  media?: IMediasoupClient;
  device: string;
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
  pidInfo?: Record<string, unknown>;
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
