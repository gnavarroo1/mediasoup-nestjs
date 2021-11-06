import { Socket, Server } from 'socket.io';
import { MediaKind, RtpCapabilities } from 'mediasoup/lib/RtpParameters';
import {
  AudioLevelObserver,
  Consumer,
  ConsumerLayers,
  ConsumerScore,
  DtlsParameters,
  Producer,
  ProducerScore,
  ProducerVideoOrientation,
  Router,
  RouterOptions,
  WebRtcTransport,
  Worker,
} from 'mediasoup/lib/types';

import {
  IClientQuery,
  IMediasoupClient,
  IMsMessage,
  RoomClient,
  TMediaKind,
  TMediaProduceCapabilities,
  TTransportKind,
} from './mediasoup.types';

import { LoggerService } from '../../logger/logger.service';
import {
  IMediasoupMediacodecSettings,
  IMediasoupWebRtcTransport,
  IProducerRequest,
} from '../../../types/global';
import { AppConfigService } from '../../config/config.service';

export class MediasoupRoom {
  private _clients: Map<string, RoomClient> = new Map<string, RoomClient>();
  private _router: Router;
  private _audioLevelObserver: AudioLevelObserver;
  private _worker: Worker;
  private _workerIndex: number;
  private _sessionId: string;
  private mediaCodecs: IMediasoupMediacodecSettings[];
  private webRtcTransport: IMediasoupWebRtcTransport;
  constructor(
    private readonly logger: LoggerService,
    private readonly appConfig: AppConfigService,
    private readonly wssServer: Server,
  ) {
    this.mediaCodecs = appConfig.mediasoupSettings.router.mediaCodecs;
    this.webRtcTransport = appConfig.mediasoupSettings.webRtcTransport;
  }
  get clients(): Map<string, RoomClient> {
    return this._clients;
  }
  get router(): Router {
    return this._router;
  }
  set router(value: Router) {
    this._router = value;
  }
  get audioLevelObserver(): AudioLevelObserver {
    return this._audioLevelObserver;
  }
  set audioLevelObserver(value: AudioLevelObserver) {
    this._audioLevelObserver = value;
  }
  get worker(): Worker {
    return this._worker;
  }
  set worker(value: Worker) {
    this._worker = value;
  }
  get workerIndex(): number {
    return this._workerIndex;
  }
  set workerIndex(value: number) {
    this._workerIndex = value;
  }
  get sessionId(): string {
    return this._sessionId;
  }
  set sessionId(value: string) {
    this._sessionId = value;
  }
  get clientsCount(): number {
    return this._clients.size;
  }
  get clientsIds(): string[] {
    return Array.from(this._clients.keys());
  }
  get audioProducerIds(): string[] {
    return Array.from(this._clients.values())
      .filter((c) => {
        if (c.media && c.media.producerAudio && !c.media.producerAudio.closed) {
          return true;
        }

        return false;
      })
      .map((c) => c.id);
  }
  get videoProducerIds(): string[] {
    return Array.from(this._clients.values())
      .filter((c) => {
        if (c.media && c.media.producerVideo && !c.media.producerVideo.closed) {
          return true;
        }

        return false;
      })
      .map((c) => c.id);
  }
  get producerIds(): string[] {
    return Array.from(this._clients.values())
      .filter((c) => {
        if (c.media) {
          if (c.media.producerVideo || c.media.producerAudio) {
            return true;
          } else {
            return false;
          }
        } else {
          return false;
        }
      })
      .map((c) => c.id);
  }
  get getRouterRtpCapabilities(): RtpCapabilities {
    return this._router.rtpCapabilities;
  }
  get stats() {
    const clientsArray = Array.from(this._clients.values());

    return {
      id: this.sessionId,
      worker: this.workerIndex,
      clients: clientsArray.map((c) => ({
        id: c.id,
        device: c.device,
        produceAudio: !!c.media.producerAudio,
        produceVideo: !!c.media.producerVideo,
      })),
      groupByDevice: clientsArray.reduce((acc, curr) => {
        if (!acc[curr.device]) {
          acc[curr.device] = 1;
        }

        acc[curr.device] += 1;

        return acc;
      }, {}) as { [device: string]: number },
    };
  }
  private async configureWorker() {
    try {
      await this.worker
        .createRouter({
          mediaCodecs: this.mediaCodecs,
        } as RouterOptions)
        .then((router) => {
          this.router = router;
          return this.router.createAudioLevelObserver({
            maxEntries: 1,
            threshold: -80,
            interval: 800,
          });
        })
        .then((observer) => (this.audioLevelObserver = observer))
        .then(() => {
          // tslint:disable-next-line: no-any
          this.audioLevelObserver.on(
            'volumes',
            (volumes: Array<{ producer: Producer; volume: number }>) => {
              this.wssServer.to(this.sessionId).emit('mediaActiveSpeaker', {
                userId: (volumes[0].producer.appData as { userId: string })
                  .userId,
                volume: volumes[0].volume,
              });
            },
          );

          this.audioLevelObserver.on('silence', () => {
            this.wssServer.to(this.sessionId).emit('mediaActiveSpeaker', {
              userId: null,
            });
          });
        });
    } catch (error) {
      this.logger.error(
        error.message,
        error.stack,
        'WssRoom - configureWorker',
      );
    }
  }

  /**
   * Configures a worker.
   * @returns {Promise<void>} Promise<void>
   */
  public async load(): Promise<void> {
    try {
      await this.configureWorker();
    } catch (error) {
      this.logger.error(error.message, error.stack, 'WssRoom - load');
    }
  }
  /**
   * Closes the room, killing all connections to it.
   * @returns {void} void
   */
  public close(): void {
    try {
      this.clients.forEach((user) => {
        const { io: client, media, id } = user;

        if (client) {
          client.broadcast
            .to(this.sessionId)
            .emit('mediaDisconnectMember', { id });
          client.leave(this.sessionId);
        }

        if (media) {
          this.closeMediaClient(media);
        }
      });
      this.clients.clear();
      this.audioLevelObserver.close();
      this.router.close();

      this.logger.log(`room ${this.sessionId} closed`);
    } catch (error) {
      this.logger.error(error.message, error.stack, 'WssRoom - close');
    }
  }
  /**
   * Changes the worker in the room.
   * @param {IWorker} worker worker
   * @param {number} index worker's index
   * @returns {Promise<void>} Promise<void>
   */
  public async reConfigureMedia(worker: Worker, index: number): Promise<void> {
    try {
      this.clients.forEach((user) => {
        const { media } = user;

        if (media) {
          this.closeMediaClient(media);
          user.media = {};
        }
      });

      this.audioLevelObserver.close();
      this.router.close();

      this.worker = worker;
      this.workerIndex = index;

      await this.configureWorker();

      this.broadcastAll('mediaReconfigure', {});
    } catch (error) {
      this.logger.error(
        error.message,
        error.stack,
        'WssRoom - reConfigureMedia',
      );
    }
  }
  /**
   *  Kill all connections on the mediasoup client
   * @param {IMediasoupClient} mediaClient Data from the room at the mediasoup client
   * @returns {boolean} boolean
   */
  private closeMediaClient(mediaClient: IMediasoupClient): boolean {
    try {
      if (mediaClient.producerVideo && !mediaClient.producerVideo.closed) {
        mediaClient.producerVideo.close();
      }
      if (mediaClient.producerAudio && !mediaClient.producerAudio.closed) {
        mediaClient.producerAudio.close();
      }
      if (
        mediaClient.producerTransport &&
        !mediaClient.producerTransport.closed
      ) {
        mediaClient.producerTransport.close();
      }
      if (
        mediaClient.consumerTransport &&
        !mediaClient.consumerTransport.closed
      ) {
        mediaClient.consumerTransport.close();
      }

      return true;
    } catch (error) {
      this.logger.error(
        error.message,
        error.stack,
        'WssRoom - closeMediaClient',
      );
    }
  }

  /**
   * Adds a user to the room.
   * @param {IClientQuery} query Query client
   * @param {io.Socket} client client
   * @returns {Promise<boolean>} Promise<boolean>
   */
  public addClient(query: IClientQuery, client: Socket, data: any): any {
    try {
      if (this.clients.get(query.userId)) {
        throw new Error('Peer already joined');
      }
      this.logger.log(`${query.userId} connected to room ${this.sessionId}`);
      const roomClient = new RoomClient();
      roomClient.io = client;
      roomClient.id = query.userId;
      roomClient.device = query.device;
      roomClient.kind = query.kind;
      this._clients.set(query.userId, roomClient);

      return true;
    } catch (error) {
      this.logger.error(error.message, error.stack, 'WssRoom - addClient');
    }
  }

  public async joinRoom(
    query: IClientQuery,
    client: Socket,
    rtpCapabilities: RtpCapabilities,
    producerCapabilities: TMediaProduceCapabilities,
  ): Promise<any> {
    const roomClient = this.clients.get(query.userId);
    if (roomClient.joined) {
      throw new Error('Peer already joined');
    }
    roomClient.globalProduceVideoEnabled =
      producerCapabilities.globalVideoEnabled;
    roomClient.globalProduceAudioEnabled =
      producerCapabilities.globalAudioEnabled;
    roomClient.producerAudioEnabled = producerCapabilities.producerAudioEnabled;
    roomClient.producerVideoEnabled = producerCapabilities.producerVideoEnabled;
    roomClient.rtpCapabilities = rtpCapabilities;
    roomClient.joined = true;
    client.join(this.sessionId);
    for (const peer of this.getProducersPeers(query.userId)) {
      if (peer.producerAudio) {
        // this.createConsumer(roomClient, peer, peer.producerAudio);
      }
      if (peer.producerVideo) {
        // this.createConsumer(roomClient, peer, peer.producerVideo);
      }
    }
    const peersInfo = this.getJoinedPeers(query.userId).map((peer) => {
      return {
        id: peer.id,
        kind: peer.kind,
        isScreenSharing: peer.isScreenSharing,
      };
    });

    this.broadcastAll('mediaClientConnected', {
      id: query.userId,
      kind: query.kind,
      producerAudioEnabled: roomClient.producerAudioEnabled,
      producerVideoEnabled: roomClient.producerVideoEnabled,
      globalAudioEnabled: roomClient.globalProduceAudioEnabled,
      globalVideoEnabled: roomClient.globalProduceVideoEnabled,
      isScreenSharing: roomClient.isScreenSharing,
    });

    return {
      id: query.userId,
      peersInfo: peersInfo,
    };
  }

  /**
   * Removes the user from the room.
   * @param {string} userId user
   * @returns {Promise<boolean>} Promise<boolean>
   */
  public async removeClient(userId: string): Promise<boolean> {
    try {
      this.logger.log(`${userId} disconnected from room ${this.sessionId}`);
      const user = this.clients.get(userId);
      if (user) {
        const { io: client, media, id } = user;
        if (client) {
          this.broadcast(client, 'mediaClientDisconnect', { id });

          client.leave(this.sessionId);
        }
        if (media) {
          this.closeMediaClient(media);
        }
        this.clients.delete(userId);
      }
      return true;
    } catch (error) {
      this.logger.error(error.message, error.stack, 'WssRoom - removeClient');
    }
  }

  /**
   * Processes the message.
   * @param {string} userId sender of the message
   * @param {IMsMessage} msg message
   * @returns {Promise<Record<string, unknown> | boolean>} Promise<Record<string, unknown> | boolean>
   */
  public async speakMsClient(
    userId: string,
    msg: IMsMessage,
  ): Promise<Record<string, unknown> | string[] | boolean | IProducerRequest> {
    try {
      switch (msg.action) {
        case 'getRouterRtpCapabilities':
          return {
            routerRtpCapabilities: this.getRouterRtpCapabilities,
          };
        case 'createWebRtcTransport':
          const { type } = msg.data as {
            type: TTransportKind;
          };

          return await this.createWebRtcTransport({ type }, userId);
        case 'connectWebRtcTransport':
          return await this.connectWebRtcTransport(
            msg.data as {
              dtlsParameters: DtlsParameters;
              type: TTransportKind;
            },
            userId,
          );
        case 'produce':
          return await this.produce(
            msg.data as {
              rtpParameters: RTCRtpParameters;
              kind: MediaKind;
              appData: any;
            },
            userId,
          );
        case 'consume':
          return await this.consume(
            msg.data as {
              rtpCapabilities: RtpCapabilities;
              userId: string;
              kind: MediaKind;
              appData: any;
            },
            userId,
          );
        case 'restartIce':
          return await this.restartIce(
            msg.data as { type: 'PRODUCER' | 'CONSUMER' },
            userId,
          );
        case 'requestConsumerKeyFrame':
          return await this.requestConsumerKeyFrame(
            msg.data as { userId: string },
            userId,
          );
        case 'getTransportStats':
          return await this.getTransportStats(
            msg.data as { type: 'PRODUCER' | 'CONSUMER' },
            userId,
          );
        case 'getProducerStats':
          return await this.getProducerStats(
            msg.data as { userId: string; kind: MediaKind },
            userId,
          );
        case 'getConsumerStats':
          return await this.getConsumerStats(
            msg.data as { userId: string; kind: MediaKind },
            userId,
          );
        case 'getAudioProducerIds':
          return await this.getAudioProducerIds(userId);
        case 'getVideoProducerIds':
          return await this.getVideoProducerIds(userId);
        case 'producerClose':
          return await this.producerClose(
            msg.data as {
              userId: string;
              kind: TMediaKind;
              isScreenMedia: boolean;
            },
            userId,
          );
        case 'producerPause':
          return await this.producerPause(
            msg.data as unknown as IProducerRequest,
          );
        case 'producerResume':
          this.logger.warn(msg.data);
          return await this.producerResume(
            msg.data as {
              userId: string;
              kind: MediaKind;
              isGlobal?: boolean;
            },
            userId,
          );
        case 'allProducerClose':
          return await this.allProducerClose(
            msg.data as { kind: MediaKind },
            userId,
          );
        case 'allProducerPause':
          return await this.allProducerPause(
            msg.data as { kind: MediaKind },
            userId,
          );
        case 'allProducerResume':
          return await this.allProducerResume(
            msg.data as { kind: MediaKind },
            userId,
          );
      }

      throw new Error(
        `Couldn't find Mediasoup Event with 'name'=${msg.action}`,
      );
    } catch (error) {
      this.logger.error(error.message, error.stack, 'MediasoupHelper - commit');
      return false;
    }
  }

  /**
   * Creates a WebRTC transport for receiving or transmitting a stream.
   * @param {Record<string, unknown>} data { type: TTransportKind }
   * @param {string} userId sender of the message
   * @returns {Promise<Record<string, unknown>>} Promise<Record<string, unknown>>
   */
  public async createWebRtcTransport(
    data: {
      type: TTransportKind;
    },
    userId: string,
  ): Promise<Record<string, unknown>> {
    try {
      const webRtcTransportOptions = {
        listenIps: this.webRtcTransport.listenIps,
        initialAvailableOutgoingBitrate:
          this.webRtcTransport.initialAvailableOutgoingBitrate,
        appData: { userId, type: data.type },
        enableUdp: true,
        enableSctp: true,
        enableTcp: true,
        preferUdp: true,
      };
      this.logger.log(
        `room ${this.sessionId} createWebRtcTransport - ${data.type}`,
      );
      const client = this.clients.get(userId);
      const transport: WebRtcTransport =
        await this.router.createWebRtcTransport(webRtcTransportOptions);
      transport.on('dtlsstatechange', (dtlsState) => {
        switch (dtlsState) {
          case 'closed':
            this.logger.log({ name: userId }, 'Transport close');
            transport.close();
            break;
          case 'failed':
            this.logger.log({ name: userId }, 'Transport failed');
            break;
        }
      });

      transport.on('close', () => {
        this.logger.log({ name: userId }, 'Transport close');
      });
      switch (data.type) {
        case 'PRODUCER':
          client.producerTransport = transport;
          break;
        case 'CONSUMER':
          client.consumerTransport = transport;
          break;
      }
      return {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      };
    } catch (e) {
      this.logger.error(
        e.message,
        e.stack,
        `MediasoupHelper - createWebRtcTransport - ${e.name}`,
      );
      return {
        error: e,
      };
    }
  }

  /**
   * Connects WebRTC transport.
   * @param {Record<string, unknown>} data { dtlsParameters: RTCDtlsParameters; type: TTransportKind }
   * @param {string} userId sender of the message
   * @returns {Promise<Record<string, unknown>>} Promise<Record<string, unknown>>
   */
  public async connectWebRtcTransport(
    data: { dtlsParameters: DtlsParameters; type: TTransportKind },
    userId: string,
  ): Promise<Record<string, unknown>> {
    try {
      this.logger.log(
        `room ${this.sessionId} connectWebRtcTransport - ${data.type}`,
      );
      const user = this.clients.get(userId);
      let transport: WebRtcTransport;
      switch (data.type) {
        case 'PRODUCER':
          transport = user.producerTransport;
          break;
        case 'CONSUMER':
          transport = user.consumerTransport;
          break;
      }
      if (!transport) {
        throw new Error(
          `Couldn't find ${data.type} transport with 'userId'=${userId} and 'sessionId'=${this.sessionId}`,
        );
      }
      await transport.connect({ dtlsParameters: data.dtlsParameters });
      return {
        connected: true,
      };
    } catch (error) {
      this.logger.error(
        error.message,
        error.stack,
        'MediasoupHelper - connectWebRtcTransport',
      );
      return {
        error: error,
      };
    }
  }

  /**
   * Receives a stream of video or audio from the user.
   * @param {Record<string, unknown>} data { rtpParameters: RTCRtpParameters; kind: MediaKind }
   * @param {string} userId sender of the message
   * @returns {Promise<Record<string, unknown>>} Promise<Record<string, unknown>>
   */
  private async produce(
    data: {
      rtpParameters: RTCRtpParameters;
      kind: MediaKind;
      appData: any;
    },
    userId: string,
  ): Promise<Record<string, unknown>> {
    try {
      const user = this.clients.get(userId);
      const transport = user.producerTransport;
      console.warn(data.appData);
      if (!transport) {
        throw new Error(
          `Couldn't find producer transport with 'userId'=${userId} and 'sessionId'=${this.sessionId}`,
        );
      }

      const producer = await transport.produce({
        ...data,
        appData: { ...data.appData, userId, kind: data.kind },
      });
      this.logger.log(
        `session ${this.sessionId} produce - ${data.appData.mediaTag}`,
        'PRODUCE',
      );
      switch (data.appData.mediaTag) {
        case 'screen-media':
          user.producerScreen = producer;
          this.logger.log(!!user.producerScreen, 'producerVideo instance');
          this.logger.error(
            user.producerScreen == this.clients.get(userId).producerScreen,
            'producerScreen instance',
            'PRODUCE',
          );
          break;
        case 'video':
          user.producerVideo = producer;
          this.logger.log(!!user.producerVideo, 'producerVideo instance');
          this.logger.error(
            user.producerVideo == this.clients.get(userId).producerVideo,
            'producerVideo instance',
            'PRODUCE',
          );
          break;
        case 'audio':
          user.producerAudio = producer;
          this.logger.log(!!user.producerAudio, 'producerAudio instance');
          this.logger.error(
            user.producerAudio == this.clients.get(userId).producerAudio,
            'producerAudio instance',
            'PRODUCE',
          );
          await this.audioLevelObserver.addProducer({
            producerId: producer.id,
          });
          break;
      }

      this.broadcast(user.io, 'mediaProduce', { userId, kind: data.kind });
      if (data.appData.mediaTag === 'video') {
        producer.on(
          'videoorientationchange',
          (videoOrientation: ProducerVideoOrientation) => {
            this.broadcastAll('mediaVideoOrientationChange', {
              userId,
              videoOrientation,
            });
          },
        );
      }
      producer.on('score', (score: ProducerScore[]) => {
        // this.logger.log(
        //   `room ${this.sessionId} user ${userId} producer ${
        //     data.kind
        //   } score ${JSON.stringify(score)}`,
        // );
      });

      for (const peer of this.getJoinedPeers(user.id)) {
        this.createConsumer(peer, user, producer);
      }
      if (producer.kind === 'audio') {
        this.audioLevelObserver
          .addProducer({ producerId: producer.id })
          .catch((err) => {
            this.logger.error(err.message, err.stack);
          });
      }
      if (data.appData.mediaTag !== 'screen-media') {
        await producer.pause();
      } else {
        user.isScreenSharing = true;
      }

      return {};
    } catch (error) {
      this.logger.error(
        error.message,
        error.stack,
        'MediasoupHelper - produce',
      );
    }
  }
  /**
   * Streams video or audio from one user to another.
   * @param {Record<string, unknown>} data { rtpCapabilities: RTCRtpCapabilities; userId: string; kind: MediaKind }
   * @param {string} userId sender of the message
   * @returns {Promise<Record<string, unknown>>} Promise<Record<string, unknown>>
   */
  private async consume(
    data: {
      rtpCapabilities: RtpCapabilities;
      userId: string;
      kind: MediaKind;
      appData: any;
    },
    userId: string,
  ): Promise<Record<string, unknown>> {
    try {
      this.logger.log(`room ${this.sessionId} consume - ${data.kind}`);
      const user = this.clients.get(userId);
      const target = this.clients.get(data.userId);
      let targetProducer: Producer;
      console.log('MEDIA TAG', data.appData.mediaTag);
      switch (data.appData.mediaTag) {
        case 'screen-media':
          this.logger.warn(
            !!target.producerScreen,
            `target screen-media producer ${data.userId}`,
          );
          targetProducer = target.producerScreen;
          break;
        case 'video':
          this.logger.warn(
            !!target.producerVideo,
            `target video producer ${data.userId}`,
          );
          targetProducer = target.producerVideo;
          break;
        case 'audio':
          this.logger.warn(
            !!target.producerAudio,
            `target audio producer ${data.userId}`,
          );
          targetProducer = target.producerAudio;
          break;
      }
      if (!targetProducer) {
        throw new Error(
          `User ${userId} couldn't consume ${data.kind} with 'userId'=${data.userId} and 'sessionId'=${this.sessionId} | target ${data.appData.mediaTag} producer not found`,
        );
      }
      if (!data.rtpCapabilities) {
        throw new Error(
          `Couldn't consume ${data.kind} with 'userId'=${data.userId} and 'sessionId'=${this.sessionId} | rtpcapabilities not found`,
        );
      }

      if (
        !this.router.canConsume({
          producerId: targetProducer.id,
          rtpCapabilities: data.rtpCapabilities,
        })
      ) {
        throw new Error(
          `Couldn't consume ${data.kind} with 'userId'=${data.userId} and 'sessionId'=${this.sessionId} | router cant consume`,
        );
      }

      if (
        !targetProducer ||
        !data.rtpCapabilities ||
        !this.router.canConsume({
          producerId: targetProducer.id,
          rtpCapabilities: data.rtpCapabilities,
        })
      ) {
        throw new Error(
          `Couldn't consume ${data.kind} with 'userId'=${data.userId} and 'sessionId'=${this.sessionId}`,
        );
      }

      const transport = user.consumerTransport;

      if (!transport) {
        throw new Error(
          `Couldn't find consumer transport with 'userId'=${userId} and 'sessionId'=${this.sessionId}`,
        );
      }

      const consumer = await transport.consume({
        producerId: targetProducer.id,
        rtpCapabilities: data.rtpCapabilities,
        paused: targetProducer.paused,
        appData: {
          userId,
          kind: data.kind,
          producerUserId: data.userId,
          mediaTag: data.appData.mediaTag,
        },
      });

      switch (data.appData.mediaTag) {
        case 'screen-media':
          if (!user.consumersScreen) {
            user.media.consumersScreen = new Map<string, Consumer>();
          }
          user.consumersScreen.set(data.userId, consumer);
          consumer.on('transportclose', async () => {
            consumer.close();
            user.consumersScreen.delete(data.userId);
          });
          consumer.on('producerclose', async () => {
            user.io.emit('mediaProducerClose', {
              userId: data.userId,
              kind: data.kind,
            });
            consumer.close();
            user.consumersScreen.delete(data.userId);
          });
          break;
        case 'video':
          if (!user.consumersVideo) {
            user.media.consumersVideo = new Map<string, Consumer>();
          }
          if (consumer.type === 'simulcast') {
            await consumer.setPreferredLayers({
              spatialLayer: 2,
              temporalLayer: 2,
            });
          }
          user.consumersVideo.set(data.userId, consumer);
          consumer.on('transportclose', async () => {
            consumer.close();
            user.consumersVideo.delete(data.userId);
          });
          consumer.on('producerclose', async () => {
            user.io.emit('mediaProducerClose', {
              userId: data.userId,
              kind: data.kind,
            });
            consumer.close();
            user.consumersVideo.delete(data.userId);
          });
          break;
        case 'audio':
          if (!user.media.consumersAudio) {
            user.media.consumersAudio = new Map();
          }

          user.consumersAudio.set(data.userId, consumer);

          consumer.on('transportclose', async () => {
            consumer.close();
            user.consumersAudio.delete(data.userId);
          });

          consumer.on('producerclose', async () => {
            user.io.emit('mediaProducerClose', {
              userId: data.userId,
              kind: data.kind,
              mediaTag: data.appData.mediaTag,
            });
            consumer.close();
            user.media.consumersAudio.delete(data.userId);
          });
          break;
      }

      if (
        data.appData.mediaTag === 'video' ||
        data.appData.mediaTag === 'audio'
      ) {
        consumer.on('producerpause', async () => {
          // await consumer.pause();
          // user.io.emit('mediaProducerPause', {
          //   userId: data.userId,
          //   kind: data.kind,
          // });
        });

        consumer.on('producerresume', async () => {
          this.logger.warn(
            `producer ${data.userId} has resumed his stream. i am ${userId} `,
          );
          // await consumer.resume();
          // user.io.emit('mediaProducerResume', {
          //   userId: data.userId,
          //   kind: data.kind,
          // });
        });

        consumer.on('score', (score: ConsumerScore[]) => {
          // this.logger.log(
          //   `room ${this.sessionId} user ${userId} consumer ${
          //     data.kind
          //   } score ${JSON.stringify(score)}`,
          // );
        });
      }

      if (consumer.kind === 'video') {
        consumer.on('layerschange', (layers: ConsumerLayers | null) => {
          this.logger.log(
            `room ${this.sessionId} user ${userId} consumer ${
              data.kind
            } layerschange ${JSON.stringify(layers)}`,
          );
        });
        await consumer.resume();
      }

      return {
        producerId: targetProducer.id,
        id: consumer.id,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
        type: consumer.type,
        producerPaused: targetProducer.paused,
      };
    } catch (error) {
      this.logger.error(
        error.message,
        error.stack,
        'MediasoupHelper - consume',
      );
    }
  }

  /**
   * Restarts ice connection.
   * @param {Record<string, unknown>} data { type: TTransportKind }
   * https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Protocols
   * @param {string} userId sender of the message
   * @returns {Promise<Record<string, unknown>>} Promise<Record<string, unknown>>
   */
  private async restartIce(
    data: { type: TTransportKind },
    userId: string,
  ): Promise<Record<string, unknown>> {
    try {
      this.logger.log(`room ${this.sessionId} restartIce - ${data.type}`);

      const user = this.clients.get(userId);

      let transport: WebRtcTransport;

      switch (data.type) {
        case 'PRODUCER':
          transport = user.media.producerTransport;
          break;
        case 'CONSUMER':
          transport = user.media.consumerTransport;
          break;
      }

      if (!transport) {
        throw new Error(
          `Couldn't find ${data.type} transport with 'userId'=${userId} and 'sessionId'=${this.sessionId}`,
        );
      }

      const iceParameters = await transport.restartIce();

      return { ...iceParameters };
    } catch (error) {
      this.logger.error(
        error.message,
        error.stack,
        'MediasoupHelper - restartIce',
      );
    }
  }
  /**
   * Request a keyframe.
   * @param {Record<string, unknown>} data { userId: string }
   * @param {string} userId sender of the message
   * @returns {Promise<boolean>} Promise<boolean>
   */
  private async requestConsumerKeyFrame(
    data: { userId: string },
    userId: string,
  ): Promise<boolean> {
    try {
      const user = this.clients.get(userId);

      const consumer: Consumer = user.media.consumersVideo.get(data.userId);

      if (!consumer) {
        throw new Error(
          `Couldn't find video consumer with 'userId'=${data.userId} and 'sessionId'=${this.sessionId}`,
        );
      }

      await consumer.requestKeyFrame();

      return true;
    } catch (error) {
      this.logger.error(
        error.message,
        error.stack,
        'MediasoupHelper - requestConsumerKeyFrame',
      );
    }
  }
  /**
   * Gives the transport status.
   * @param {Record<string, unknown>} data { type: TTransportKind }
   * @param {string} userId sender of the message
   * @returns {Promise<Record<string, unknown>>} Promise<Record<string, unknown>>
   */
  private async getTransportStats(
    data: { type: 'PRODUCER' | 'CONSUMER' },
    userId: string,
  ): Promise<Record<string, unknown>> {
    try {
      this.logger.log(
        `room ${this.sessionId} getTransportStats - ${data.type}`,
      );

      const user = this.clients.get(userId);

      let transport: WebRtcTransport;

      switch (data.type) {
        case 'PRODUCER':
          transport = user.media.producerTransport;
          break;
        case 'CONSUMER':
          transport = user.media.consumerTransport;
          break;
      }

      if (!transport) {
        throw new Error(
          `Couldn't find ${data.type} transport with 'userId'=${userId} and 'sessionId'=${this.sessionId}`,
        );
      }

      const stats = await transport.getStats();

      return { ...data, stats };
    } catch (error) {
      this.logger.error(
        error.message,
        error.stack,
        'MediasoupHelper - getTransportStats',
      );
    }
  }

  /**
   * Gives information about the user's stream
   * Measurement occurs when a stream comes from the user to the server.
   * @param {Record<string, unknown>} data { userId: string; kind: MediaKind }
   * @param {string} userId sender of the message
   * @returns {Promise<Record<string, unknown>>} Promise<Record<string, unknown>>
   */
  private async getProducerStats(
    data: { userId: string; kind: MediaKind },
    userId: string,
  ): Promise<Record<string, unknown>> {
    try {
      this.logger.log(`room ${this.sessionId} getProducerStats - ${data.kind}`);

      const targetClient = this.clients.get(data.userId);

      let producer: Producer;

      switch (data.kind) {
        case 'video':
          producer = targetClient.media.producerVideo;
          break;
        case 'audio':
          producer = targetClient.media.producerAudio;
          break;
      }

      if (!producer) {
        throw new Error(
          `Couldn't find ${data.kind} producer with 'userId'=${data.userId} and 'sessionId'=${this.sessionId}`,
        );
      }

      const stats = await producer.getStats();

      return { ...data, stats };
    } catch (error) {
      this.logger.error(
        error.message,
        error.stack,
        'MediasoupHelper - getProducerStats',
      );
    }
  }

  /**
   * Gives information about the stream of the user to which the current user is subscribed.
   * Measurement occurs when the stream is transmitted from that user to the current user.
   * @param {Record<string, unknown>} data { userId: string; kind: MediaKind }
   * @param {string} userId sender of the message
   * @returns {Promise<Record<string, unknown>>} Promise<Record<string, unknown>>
   */
  private async getConsumerStats(
    data: { userId: string; kind: MediaKind },
    userId: string,
  ): Promise<Record<string, unknown>> {
    try {
      this.logger.log(`room ${this.sessionId} getConsumerStats - ${data.kind}`);

      const user = this.clients.get(userId);

      let consumer: Consumer;

      switch (data.kind) {
        case 'video':
          consumer = user.media.consumersVideo.get(data.userId);
          break;
        case 'audio':
          consumer = user.media.consumersAudio.get(data.userId);
          break;
      }

      if (!consumer) {
        this.logger.error(
          `Couldn't find ${data.kind} consumer with 'userId'=${data.userId} and 'sessionId'=${this.sessionId}`,
        );
        throw new Error(
          `Couldn't find ${data.kind} consumer with 'userId'=${data.userId} and 'sessionId'=${this.sessionId}`,
        );
      }

      const stats = await consumer.getStats();

      return { ...data, stats };
    } catch (error) {
      this.logger.error(
        error.message,
        error.stack,
        'MediasoupHelper - getConsumerStats',
      );
    }
  }

  /**
   * Id of users who transmit video streams to the server.
   * @param {string} userId sender of the message
   * @returns {Promise<string[]>} Promise<string[]>
   */
  private async getVideoProducerIds(userId: string): Promise<string[]> {
    try {
      return this.videoProducerIds;
    } catch (error) {
      this.logger.error(
        error.message,
        error.stack,
        'MediasoupHelper - getVideoProducerIds',
      );
    }
  }

  /**
   * Id of users who transmit audio streams to the server.
   * @param {string} userId sender of the message
   * @returns {Promise<string[]>} Promise<string[]>
   */
  private async getAudioProducerIds(userId: string): Promise<string[]> {
    try {
      return this.audioProducerIds;
    } catch (error) {
      this.logger.error(
        error.message,
        error.stack,
        'MediasoupHelper - getAudioProducerIds',
      );
    }
  }

  /**
   * Stop streaming from the user to the server.
   * @param {Record<string, unknown>} data { userId: string; kind: TMediaKind; isScreenMedia: boolean }
   * @param {string} userId sender of the message
   * @returns {Promise<boolean>} promise<boolean>
   */
  private async producerClose(
    data: { userId: string; kind: TMediaKind; isScreenMedia: boolean },
    userId: string,
  ): Promise<boolean> {
    console.log('PRODUCER CLOSE');
    try {
      const targetClient = this.clients.get(data.userId);
      if (targetClient) {
        let targetProducer: Producer;
        switch (data.kind) {
          case 'video':
            if (data.isScreenMedia) {
              targetProducer = targetClient.media.producerScreen;
            } else {
              targetProducer = targetClient.media.producerVideo;
            }
            break;
          case 'audio':
            targetProducer = targetClient.media.producerAudio;
            break;
        }
        const clients = this.getJoinedPeers(data.userId);
        for (const client of clients) {
          switch (data.kind) {
            case 'video':
              if (data.isScreenMedia) {
                client.consumersScreen.get(data.userId)?.close();
              } else {
                client.consumersVideo.get(data.userId)?.close();
              }
              break;
            case 'audio':
              client.consumersAudio.get(data.userId)?.close();
              break;
          }
        }

        if (targetProducer && !targetProducer.closed) {
          if (data.isScreenMedia) {
            targetClient.isScreenSharing = false;
          }
          targetProducer.close();
          targetClient.io.to(this.sessionId).emit('mediaProducerClose', {
            mediaTag: targetProducer.appData.mediaTag,
            userId: data.userId,
          });
        }
      }

      return true;
    } catch (error) {
      this.logger.error(
        error.message,
        error.stack,
        'MediasoupHelper - producerClose',
      );
    }
  }

  /**
   * Suspend streaming from the user to the server..
   * @param {IProducerRequest} data { userId: string; kind: MediaKind }
   * @returns {Promise<IProducerRequest>} promise<boolean>
   */
  private async producerPause(
    data: IProducerRequest,
  ): Promise<IProducerRequest> {
    try {
      const targetClient = this.clients.get(data.userId);
      if (targetClient) {
        console.warn(
          !data.isGlobal &&
            !targetClient.getGlobalProducerCapabilitiesByKind(data.kind),
          'producer pause',
        );
        if (
          !data.isGlobal &&
          !targetClient.getGlobalProducerCapabilitiesByKind(data.kind)
        ) {
          return data;
        }
        let targetProducer: Producer;

        switch (data.kind) {
          case 'video':
            targetProducer = targetClient.media.producerVideo;
            break;
          case 'audio':
            targetProducer = targetClient.media.producerAudio;
            break;
        }

        if (targetProducer && !targetProducer.paused) {
          await targetProducer.pause();
          switch (data.kind) {
            case 'video':
              targetClient.producerVideoEnabled = false;
              break;
            case 'audio':
              targetClient.producerAudioEnabled = false;
              break;
          }
          targetClient.io.to(this.sessionId).emit('mediaProducerPause', {
            mediaTag: targetProducer.appData.mediaTag,
            isGlobal: data.isGlobal,
            userId: data.userId,
          });
        }
      }
      return data;
    } catch (error) {
      this.logger.error(
        error.message,
        error.stack,
        'MediasoupHelper - producerPause',
      );
    }
  }

  /**
   * Resume streaming from the user to the server.
   * @param {Record<string, unknown>} data { userId: string; kind: MediaKind }
   * @param {string} userId sender of the message
   * @returns {Promise<boolean>} promise<boolean>
   */
  private async producerResume(
    data: { userId: string; kind: MediaKind; isGlobal?: boolean },
    userId: string,
  ): Promise<boolean> {
    try {
      const targetClient = this.clients.get(data.userId);
      if (targetClient) {
        console.warn(
          !data.isGlobal &&
            !targetClient.getGlobalProducerCapabilitiesByKind(data.kind),
          'producer resume',
        );
        let targetProducer: Producer;

        switch (data.kind) {
          case 'video':
            targetProducer = targetClient.media.producerVideo;
            break;
          case 'audio':
            targetProducer = targetClient.media.producerAudio;
            break;
        }
        if (
          !data.isGlobal &&
          !targetClient.getGlobalProducerCapabilitiesByKind(data.kind)
        ) {
          return false;
        }
        if (targetProducer && targetProducer.paused && !targetProducer.closed) {
          switch (data.kind) {
            case 'video':
              targetClient.producerVideoEnabled = false;
              break;
            case 'audio':
              targetClient.producerAudioEnabled = false;
              break;
          }
          await targetProducer.resume();
          targetClient.io.to(this.sessionId).emit('mediaProducerResume', {
            mediaTag: targetProducer.appData.mediaTag,
            isGlobal: data.isGlobal,
            userId: data.userId,
          });
        } else if (targetProducer && targetProducer.closed) {
          targetClient.io.emit('mediaReproduce', { kind: data.kind });
        }
      } else {
        console.error('target user doesnt exists', targetClient);
      }

      return true;
    } catch (error) {
      this.logger.error(
        error.message,
        error.stack,
        'MediasoupHelper - producerResume',
      );
    }
  }

  /**
   * Stream stop transmission to the server from all users..
   * @param {Record<string, unknown>} data { kind: MediaKind }
   * @param {string} userId sender of the message
   * @returns {Promise<boolean>} promise<boolean>
   */
  private async allProducerClose(
    data: { kind: MediaKind },
    userId: string,
  ): Promise<boolean> {
    try {
      this.clients.forEach(async (client) => {
        if (client.media) {
          let targetProducer: Producer;

          switch (data.kind) {
            case 'video':
              targetProducer = client.media.producerVideo;
              break;
            case 'audio':
              targetProducer = client.media.producerAudio;
              break;
          }

          if (targetProducer && !targetProducer.closed) {
            targetProducer.close();
          }
        }
      });

      return true;
    } catch (error) {
      this.logger.error(
        error.message,
        error.stack,
        'MediasoupHelper - allProducerClose',
      );
    }
  }

  /**
   * Pause Stream transmission to the server from all users.
   * @param {Record<string, unknown>} data { kind: MediaKind }
   * @param {string} userId sender of the message
   * @returns {Promise<boolean>} promise<boolean>
   */
  private async allProducerPause(
    data: { kind: MediaKind },
    userId: string,
  ): Promise<boolean> {
    try {
      this.clients.forEach(async (client) => {
        if (client.media) {
          let targetProducer: Producer;

          switch (data.kind) {
            case 'video':
              targetProducer = client.media.producerVideo;
              break;
            case 'audio':
              targetProducer = client.media.producerAudio;
              break;
          }

          if (targetProducer && !targetProducer.paused) {
            await targetProducer.pause();
          }
        }
      });

      return true;
    } catch (error) {
      this.logger.error(
        error.message,
        error.stack,
        'MediasoupHelper - allProducerPause',
      );
    }
  }

  /**
   * Resume streaming from all users to the server.
   * @param {Record<string, unknown>} data { kind: MediaKind }
   * @param {string} userId sender of the message
   * @returns {Promise<boolean>} promise<boolean>
   */
  private async allProducerResume(
    data: { kind: MediaKind },
    userId: string,
  ): Promise<boolean> {
    try {
      this.clients.forEach(async (client) => {
        if (client.media) {
          let targetProducer: Producer;

          switch (data.kind) {
            case 'video':
              targetProducer = client.media.producerVideo;
              break;
            case 'audio':
              targetProducer = client.media.producerAudio;
              break;
          }

          if (
            targetProducer &&
            targetProducer.paused &&
            !targetProducer.closed
          ) {
            await targetProducer.resume();
          } else if (targetProducer && targetProducer.closed) {
            client.io.emit('mediaReproduce', { kind: data.kind });
          }
        }
      });

      return true;
    } catch (error) {
      this.logger.error(
        error.message,
        error.stack,
        'MediasoupHelper - allProducerResume',
      );
    }
  }

  /**
   * Changes the quality of the stream.
   * @returns {Promise<boolean>} Promise<boolean>
   */
  private async updateMaxIncomingBitrate(): Promise<boolean> {
    try {
      const {
        minimumAvailableOutgoingBitrate,
        maximumAvailableOutgoingBitrate,
        factorIncomingBitrate,
      } = this.webRtcTransport;

      let newMaxIncomingBitrate = Math.round(
        maximumAvailableOutgoingBitrate /
          ((this.producerIds.length - 1) * factorIncomingBitrate),
      );

      if (newMaxIncomingBitrate < minimumAvailableOutgoingBitrate) {
        newMaxIncomingBitrate = minimumAvailableOutgoingBitrate;
      }

      if (this.producerIds.length < 3) {
        newMaxIncomingBitrate = maximumAvailableOutgoingBitrate;
      }

      this.clients.forEach((client) => {
        if (client.media) {
          if (
            client.media.producerTransport &&
            !client.media.producerTransport.closed
          ) {
            client.media.producerTransport.setMaxIncomingBitrate(
              newMaxIncomingBitrate,
            );
          }
          if (
            client.media.consumerTransport &&
            !client.media.consumerTransport.closed
          ) {
            client.media.consumerTransport.setMaxIncomingBitrate(
              newMaxIncomingBitrate,
            );
          }
        }
      });

      return true;
    } catch (error) {
      this.logger.error(
        error.message,
        error.stack,
        'MediasoupHelper - updateMaxBitrate',
      );
    }
  }

  private async createConsumer(
    consumerPeer: RoomClient,
    producerPeer: RoomClient,
    producer: Producer,
  ) {
    this.logger.warn(
      this.router.canConsume({
        producerId: producer.id,
        rtpCapabilities: this.router.rtpCapabilities,
      }),
      'CAN CONSUME',
    );
    if (
      !consumerPeer.rtpCapabilities ||
      !this.router.canConsume({
        producerId: producer.id,
        rtpCapabilities: this.router.rtpCapabilities,
      })
    ) {
      return;
    }
    // Must take the Transport the remote Peer is using for consuming.
    const transport = consumerPeer.media.consumerTransport;

    //Should not happen
    if (!transport) {
      this.logger.warn('Transport for consuming not found', 'createConsumer()');
      return;
    }
    let consumer;
    try {
      consumer = await transport.consume({
        producerId: producer.id,
        rtpCapabilities: consumerPeer.rtpCapabilities,
        paused: true,
      });
      if (producer.kind === 'audio') {
        await consumer.setPriority(255);
      }
    } catch (error) {
      this.logger.warn(error, '_createConsumer() | [error:"%o"]');
      return;
    }
    this.logger.warn(producer.appData, 'CREATE CONSUMER - set consumer');
    switch (producer.appData.mediaTag) {
      case 'screen-media':
        consumerPeer.media.consumersScreen.set(producerPeer.id, consumer);
        break;
      case 'video':
        consumerPeer.media.consumersVideo.set(producerPeer.id, consumer);
        break;
      case 'audio':
        consumerPeer.media.consumersAudio.set(producerPeer.id, consumer);
        break;
    }

    consumer.on('transportclose', () => {
      switch (producer.appData.mediaTag) {
        case 'screen-media':
          consumerPeer.media.consumersScreen.delete(producerPeer.id);
          break;
        case 'video':
          consumerPeer.media.consumersVideo.delete(producerPeer.id);
          break;
        case 'audio':
          consumerPeer.media.consumersAudio.delete(producerPeer.id);
          break;
      }
    });
    consumer.on('producerclose', () => {
      switch (producer.appData.mediaTag) {
        case 'screen-media':
          consumerPeer.media.consumersScreen.delete(producerPeer.id);
          break;
        case 'video':
          consumerPeer.media.consumersVideo.delete(producerPeer.id);
          break;
        case 'audio':
          consumerPeer.media.consumersAudio.delete(producerPeer.id);
          break;
      }
      consumerPeer.io.emit('consumerClosed', {
        userId: producerPeer.id,
        kind: producer.kind,
        mediaTag: producer.appData.mediaTag,
      });
    });
    consumer.on('producerpause', () => {
      consumerPeer.io.emit('consumerPaused', {
        userId: producerPeer.id,
        kind: producer.kind,
        mediaTag: producer.appData.mediaTag,
      });
    });
    consumer.on('producerresume', () => {
      consumerPeer.io.emit('consumerResumed', {
        userId: producerPeer.id,
        kind: producer.kind,
        mediaTag: producer.appData.mediaTag,
      });
    });
    consumer.on('score', (score) => {
      consumerPeer.io.emit('consumerScore', {
        mediaTag: producer.appData.mediaTag,
        userId: producerPeer.id,
        kind: producer.kind,
        score: score,
      });
    });
    if (producer.appData.mediaTag === 'video') {
      consumer.on('layerschange', (layers) => {
        const args = {
          userId: producerPeer.id,
          kind: producer.kind,
          spatialLayer: layers?.spatialLayer,
          temporalLayer: layers?.temporalLayer,
        };
        consumerPeer.io.emit('consumersLayersChanged', args);
      });
    }

    try {
      const response = await this.sendRequest(consumerPeer.io, 'newConsumer', {
        peerId: producerPeer.id,
        producerId: producer.id,
        id: consumer.id,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
        type: consumer.type,
        appData: producer.appData,
        producerPaused: consumer.producerPaused,
      });
      this.logger.warn(response, 'RESPONSE NEW CONSUMER');
      // Now that we got the positive response from the remote endpoint, resume
      // the Consumer so the remote endpoint will receive the a first RTP packet
      // of this new stream once its PeerConnection is already ready to process
      // and associate it.
      await consumer.resume();
      consumerPeer.io.emit('consumerScore', {
        userId: producerPeer.id,
        kind: producer.kind,
        score: consumer.score,
      });
    } catch (e) {
      this.logger.warn(e, '_createConsumer() | [error:"%o"]');
    }
  }

  private getJoinedPeers(excludePeerId = undefined): RoomClient[] {
    return Array.from(this.clients.values()).filter(
      (peer) => peer.id != excludePeerId,
    );
  }

  private getProducersPeers(excludedPeerId = undefined) {
    return Array.from(this.clients.values()).filter(
      (peer) =>
        (peer.producerAudio != undefined || peer.producerVideo != undefined) &&
        peer.id != excludedPeerId,
    );
  }

  /**
   * Sends messages from the client to everyone in the room.
   * @param {io.Socket} client source client
   * @param {string} event message event
   * @param {msg} msg client message
   * @returns {boolean} boolean
   */
  public broadcast(
    client: Socket,
    event: string,
    msg: Record<string, unknown>,
  ): boolean {
    try {
      return client.broadcast.to(this.sessionId).emit(event, msg);
    } catch (error) {
      this.logger.error(error.message, error.stack, 'WssRoom - broadcast');
    }
  }
  /**
   * Sends messages from the client to everyone in the room, including him.
   * @param {string} event event from the message
   * @param {msg} msg client message
   * @returns {boolean} boolean
   */
  public broadcastAll(event: string, msg: Record<string, unknown>): boolean {
    try {
      console.log(event);
      console.log(msg);
      return this.wssServer.to(this.sessionId).emit(event, msg);
    } catch (error) {
      this.logger.error(error.message, error.stack, 'WssRoom - broadcastAll');
    }
  }
  public notification(
    client: Socket,
    event: string,
    payload: Record<string, unknown>,
  ): void {
    client.emit(event, payload);
  }

  public async consumerPause(
    targetId: string,
    kind: MediaKind,
    action: 'pause' | 'resume',
  ) {
    const user = this.clients.get(targetId);
    switch (kind) {
      case 'video':
        switch (action) {
          case 'resume':
            // await user.producerVideo.resume();
            user.consumersVideo.forEach(async (value, key) => {
              value.resume();
            });
            break;
          case 'pause':
            user.consumersVideo.forEach(async (value, key) => {
              value.pause();
            });
            // await user.producerVideo.pause();
            break;
        }
        break;
      case 'audio':
        break;
    }
  }

  async sendRequest(socket, method, data) {
    return new Promise((resolve, reject) => {
      socket.emit('request', { method, data }, (err, response) => {
        if (err) {
          this.logger.warn(err, `sendrequest -reject ${data.kind}`);
          reject(err);
        } else {
          this.logger.warn(err, `sendrequest - resolve ${data.kind}`);
          resolve(response);
        }
      });
    });
  }
}
