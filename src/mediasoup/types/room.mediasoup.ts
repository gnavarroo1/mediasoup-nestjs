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
  IClient,
  IClientQuery,
  IMediasoupClient,
  IMsMessage,
  RoomClient,
  SocketTimeoutError,
  TPeer,
} from './mediasoup.types';

import { LoggerService } from '../../logger/logger.service';
import {
  IMediasoupMediacodecSettings,
  IMediasoupSettings,
  IMediasoupWebRtcTransport,
  IProducerRequest,
} from '../../../types/global';
import { AppConfigService } from '../../config/config.service';

export class MediasoupRoom {
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

  get session_id(): string {
    return this._session_id;
  }

  set session_id(value: string) {
    this._session_id = value;
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
      id: this.session_id,
      worker: this.workerIndex,
      clients: clientsArray.map((c) => ({
        id: c.id,
        device: c.device,
        produceAudio: c.media.producerAudio ? true : false,
        produceVideo: c.media.producerVideo ? true : false,
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

  private _clients: Map<string, RoomClient> = new Map<string, RoomClient>();
  private _router: Router;
  private _audioLevelObserver: AudioLevelObserver;
  private mediaCodecs: IMediasoupMediacodecSettings[];
  private webRtcTransport: IMediasoupWebRtcTransport;
  private _worker: Worker;
  private _workerIndex: number;
  private _session_id: string;

  constructor(
    private readonly logger: LoggerService,
    private readonly appConfig: AppConfigService,
    private readonly wssServer: Server,
  ) {
    this.mediaCodecs = appConfig.mediasoupSettings.router.mediaCodecs;
    this.webRtcTransport = appConfig.mediasoupSettings.webRtcTransport;
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
              this.wssServer.to(this.session_id).emit('mediaActiveSpeaker', {
                user_id: (volumes[0].producer.appData as { user_id: string })
                  .user_id,
                volume: volumes[0].volume,
              });
            },
          );

          this.audioLevelObserver.on('silence', () => {
            this.wssServer.to(this.session_id).emit('mediaActiveSpeaker', {
              user_id: null,
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
            .to(this.session_id)
            .emit('mediaDisconnectMember', { id });
          client.leave(this.session_id);
        }

        if (media) {
          this.closeMediaClient(media);
        }
      });
      this.clients.clear();
      this.audioLevelObserver.close();
      this.router.close();

      this.logger.log(`room ${this.session_id} closed`);
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
      if (this.clients.get(query.user_id)) {
        throw new Error('Peer already joined');
      }
      this.logger.log(`${query.user_id} connected to room ${this.session_id}`);
      this.logger.info(
        `Creating room client for ${query.user_id}`,
        'ADDCLIENT',
      );
      const roomClient = new RoomClient();
      roomClient.io = client;
      roomClient.id = query.user_id;
      roomClient.device = query.device;
      roomClient.kind = query.kind;
      this._clients.set(query.user_id, roomClient);
      this.logger.warn(this._clients, 'ADD CLIENT - CLIENTS');

      return true;
    } catch (error) {
      this.logger.error(error.message, error.stack, 'WssRoom - addClient');
    }
  }

  public async joinRoom(
    query: IClientQuery,
    client: Socket,
    rtpCapabilities: RtpCapabilities,
  ): Promise<any> {
    const roomClient = this.clients.get(query.user_id);
    if (roomClient.joined) {
      throw new Error('Peer already joined');
    }

    roomClient.rtpCapabilities = rtpCapabilities;
    roomClient.joined = true;
    client.join(this.session_id);
    for (const peer of this.getProducersPeers(query.user_id)) {
      if (peer.producerAudio) {
        this.createConsumer(roomClient, peer, peer.producerAudio);
      }
      if (peer.producerVideo) {
        this.createConsumer(roomClient, peer, peer.producerVideo);
      }
    }
    const peersInfo = this.getJoinedPeers(query.user_id).map((peer) => {
      return {
        id: peer.id,
        kind: peer.kind,
      };
    });

    this.broadcastAll('mediaClientConnected', {
      id: query.user_id,
      kind: query.kind,
    });

    return {
      id: query.user_id,
      peersInfo: peersInfo,
    };
  }

  /**
   * Removes the user from the room.
   * @param {string} user_id user
   * @returns {Promise<boolean>} Promise<boolean>
   */
  public async removeClient(user_id: string): Promise<boolean> {
    try {
      this.logger.log(`${user_id} disconnected from room ${this.session_id}`);
      const user = this.clients.get(user_id);
      if (user) {
        const { io: client, media, id } = user;
        if (client) {
          this.broadcast(client, 'mediaClientDisconnect', { id });

          client.leave(this.session_id);
        }
        if (media) {
          this.closeMediaClient(media);
        }
        this.clients.delete(user_id);
      }
      return true;
    } catch (error) {
      this.logger.error(error.message, error.stack, 'WssRoom - removeClient');
    }
  }

  /**
   * Processes the message.
   * @param {string} user_id sender of the message
   * @param {IMsMessage} msg message
   * @returns {Promise<Record<string, unknown> | boolean>} Promise<Record<string, unknown> | boolean>
   */
  public async speakMsClient(
    user_id: string,
    msg: IMsMessage,
  ): Promise<Record<string, unknown> | string[] | boolean | IProducerRequest> {
    try {
      switch (msg.action) {
        case 'getRouterRtpCapabilities':
          return {
            routerRtpCapabilities: this.getRouterRtpCapabilities,
          };
        case 'createWebRtcTransport':
          const { forceTcp, producing, consuming, type } = msg.data as TPeer;

          return await this.createWebRtcTransport(
            { forceTcp, producing, consuming, type },
            user_id,
          );
        case 'connectWebRtcTransport':
          return await this.connectWebRtcTransport(
            msg.data as {
              dtlsParameters: DtlsParameters;
              type: string;
            },
            user_id,
          );
        case 'produce':
          return await this.produce(
            msg.data as {
              rtpParameters: RTCRtpParameters;
              kind: MediaKind;
              appData: any;
              rtpCapabilities: RtpCapabilities;
            },
            user_id,
          );
        case 'consume':
          return await this.consume(
            msg.data as {
              rtpCapabilities: RtpCapabilities;
              user_id: string;
              kind: MediaKind;
            },
            user_id,
          );
        case 'restartIce':
          return await this.restartIce(
            msg.data as { type: 'producer' | 'consumer' },
            user_id,
          );
        case 'requestConsumerKeyFrame':
          return await this.requestConsumerKeyFrame(
            msg.data as { user_id: string },
            user_id,
          );
        case 'getTransportStats':
          return await this.getTransportStats(
            msg.data as { type: 'producer' | 'consumer' },
            user_id,
          );
        case 'getProducerStats':
          return await this.getProducerStats(
            msg.data as { user_id: string; kind: MediaKind },
            user_id,
          );
        case 'getConsumerStats':
          return await this.getConsumerStats(
            msg.data as { user_id: string; kind: MediaKind },
            user_id,
          );
        case 'getAudioProducerIds':
          return await this.getAudioProducerIds(user_id);
        case 'getVideoProducerIds':
          return await this.getVideoProducerIds(user_id);
        case 'producerClose':
          return await this.producerClose(
            msg.data as { user_id: string; kind: MediaKind },
            user_id,
          );
        case 'producerPause':
          return await this.producerPause(
            msg.data as unknown as IProducerRequest,
          );
        case 'producerResume':
          this.logger.warn(msg.data);
          return await this.producerResume(
            msg.data as { user_id: string; kind: MediaKind },
            user_id,
          );
        case 'allProducerClose':
          return await this.allProducerClose(
            msg.data as { kind: MediaKind },
            user_id,
          );
        case 'allProducerPause':
          return await this.allProducerPause(
            msg.data as { kind: MediaKind },
            user_id,
          );
        case 'allProducerResume':
          return await this.allProducerResume(
            msg.data as { kind: MediaKind },
            user_id,
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
   * @param {Record<string, unknown>} data { type: TPeer }
   * @param {string} user_id sender of the message
   * @returns {Promise<Record<string, unknown>>} Promise<Record<string, unknown>>
   */
  private async createWebRtcTransport(
    data: TPeer,
    user_id: string,
  ): Promise<Record<string, unknown>> {
    try {
      const { forceTcp, producing, consuming } = data;

      const webRtcTransportOptions = {
        ...this.webRtcTransport,
        appData: { producing, consuming, user_id },
        enableSctp: true,
        enableTcp: true,
        enableUdp: false,
        preferUdp: false,
      };
      if (forceTcp) {
        webRtcTransportOptions.enableUdp = false;
      } else {
        webRtcTransportOptions.enableUdp = true;
        webRtcTransportOptions.preferUdp = true;
      }

      this.logger.log(
        `room ${this.session_id} createWebRtcTransport - ${data.type}`,
      );
      console.warn(this.clients, 'clients');
      const user = this.clients.get(user_id);

      const transport = await this.router.createWebRtcTransport(
        webRtcTransportOptions,
      );

      transport.on('dtlsstatechange', (dtlsState) => {
        if (dtlsState === 'failed' || dtlsState === 'closed')
          this.logger.warn(
            dtlsState,
            'WebRtcTransport "dtlsstatechange" event [dtlsState:%s]',
          );
      });

      if (producing) {
        user.media.producerTransport = transport;
      }
      if (consuming) {
        user.media.consumerTransport = transport;
      }

      await this.updateMaxIncomingBitrate();
      return {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      };
    } catch (error) {
      this.logger.error(
        error.message,
        error.stack,
        'MediasoupHelper - createWebRtcTransport',
      );
    }
  }

  /**
   * Connects WebRTC transport.
   * @param {Record<string, unknown>} data { dtlsParameters: RTCDtlsParameters; type: TPeer }
   * @param {string} user_id sender of the message
   * @returns {Promise<Record<string, unknown>>} Promise<Record<string, unknown>>
   */
  private async connectWebRtcTransport(
    data: { dtlsParameters: DtlsParameters; type: string },
    user_id: string,
  ): Promise<Record<string, unknown>> {
    try {
      this.logger.log(
        `room ${this.session_id} connectWebRtcTransport - ${data.type}`,
      );

      const user = this.clients.get(user_id);

      let transport: WebRtcTransport;

      switch (data.type) {
        case 'producer':
          transport = user.media.producerTransport;
          break;
        case 'consumer':
          transport = user.media.consumerTransport;
          break;
      }

      if (!transport) {
        throw new Error(
          `Couldn't find ${data.type} transport with 'user_id'=${user_id} and 'room_id'=${this.session_id}`,
        );
      }

      await transport.connect({ dtlsParameters: data.dtlsParameters });

      return {};
    } catch (error) {
      this.logger.error(
        error.message,
        error.stack,
        'MediasoupHelper - connectWebRtcTransport',
      );
    }
  }

  /**
   * Receives a stream of video or audio from the user.
   * @param {Record<string, unknown>} data { rtpParameters: RTCRtpParameters; kind: MediaKind }
   * @param {string} user_id sender of the message
   * @returns {Promise<Record<string, unknown>>} Promise<Record<string, unknown>>
   */
  private async produce(
    data: {
      rtpParameters: RTCRtpParameters;
      kind: MediaKind;
      appData: any;
      rtpCapabilities: RtpCapabilities;
    },
    user_id: string,
  ): Promise<Record<string, unknown>> {
    const { rtpCapabilities, rtpParameters, kind, appData } = data;
    try {
      this.logger.log(`room ${this.session_id} produce - ${data.kind}`);

      const user = this.clients.get(user_id);

      const transport = user.producerTransport;

      if (!transport) {
        throw new Error(
          `Couldn't find producer transport with 'user_id'=${user_id} and 'room_id'=${this.session_id}`,
        );
      }

      const producer = await transport.produce({
        rtpParameters,
        kind,
        appData: {
          user_id,
          kind: data.kind,
        },
      });

      switch (data.kind) {
        case 'video':
          user.producerVideo = producer;
          break;
        case 'audio':
          user.producerAudio = producer;
          await this.audioLevelObserver.addProducer({
            producerId: producer.id,
          });
          break;
      }
      this.broadcast(user.io, 'mediaProduce', { user_id, kind: data.kind });
      if (data.kind === 'video') {
        producer.on(
          'videoorientationchange',
          (videoOrientation: ProducerVideoOrientation) => {
            this.broadcastAll('mediaVideoOrientationChange', {
              user_id,
              videoOrientation,
            });
          },
        );
      }
      producer.on('score', (score: ProducerScore[]) => {
        this.notification(user.io, 'producerScore', {
          producerId: producer.id,
          kind: data.kind,
          score,
        });
        this.logger.log(
          `room ${this.session_id} user ${user_id} producer ${
            data.kind
          } score ${JSON.stringify(score)}`,
        );
      });
      // for (const peer of this.getJoinedPeers(user.id)) {
      //   this.createConsumer(peer, user, producer);
      // }
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
   * @param {Record<string, unknown>} data { rtpCapabilities: RTCRtpCapabilities; user_id: string; kind: MediaKind }
   * @param {string} user_id sender of the message
   * @returns {Promise<Record<string, unknown>>} Promise<Record<string, unknown>>
   */
  private async consume(
    data: {
      rtpCapabilities: RtpCapabilities;
      user_id: string;
      kind: MediaKind;
    },
    user_id: string,
  ): Promise<Record<string, unknown>> {
    try {
      this.logger.log(`room ${this.session_id} produce - ${data.kind}`);
      const user = this.clients.get(user_id);
      const target = this.clients.get(data.user_id);
      let target_producer: Producer;
      switch (data.kind) {
        case 'video':
          target_producer = target.media.producerVideo;
          break;
        case 'audio':
          target_producer = target.media.producerAudio;
          break;
      }
      if (
        !target_producer ||
        !data.rtpCapabilities ||
        !this.router.canConsume({
          producerId: target_producer.id,
          rtpCapabilities: data.rtpCapabilities,
        })
      ) {
        throw new Error(
          `Couldn't consume ${data.kind} with 'user_id'=${data.user_id} and 'room_id'=${this.session_id}`,
        );
      }

      const transport = user.media.consumerTransport;

      if (!transport) {
        throw new Error(
          `Couldn't find consumer transport with 'user_id'=${user_id} and 'room_id'=${this.session_id}`,
        );
      }

      const consumer = await transport.consume({
        producerId: target_producer.id,
        rtpCapabilities: data.rtpCapabilities,
        paused: data.kind === 'video',
        appData: { user_id, kind: data.kind, producer_user_id: data.user_id },
      });

      switch (data.kind) {
        case 'video':
          if (!user.media.consumersVideo) {
            user.media.consumersVideo = new Map();
          }
          console.log('CONSUMER TYPE ', consumer.type);
          if (consumer.type === 'simulcast') {
            await consumer.setPreferredLayers({
              spatialLayer: 2,
              temporalLayer: 2,
            });
          }
          user.media.consumersVideo.set(data.user_id, consumer);

          consumer.on('transportclose', async () => {
            consumer.close();
            user.media.consumersVideo.delete(data.user_id);
          });

          consumer.on('producerclose', async () => {
            user.io.emit('mediaProducerClose', {
              user_id: data.user_id,
              kind: data.kind,
            });
            consumer.close();
            user.media.consumersVideo.delete(data.user_id);
          });
          break;
        case 'audio':
          if (!user.media.consumersAudio) {
            user.media.consumersAudio = new Map();
          }

          user.media.consumersAudio.set(data.user_id, consumer);

          consumer.on('transportclose', async () => {
            consumer.close();
            user.media.consumersAudio.delete(data.user_id);
          });

          consumer.on('producerclose', async () => {
            user.io.emit('mediaProducerClose', {
              user_id: data.user_id,
              kind: data.kind,
            });
            consumer.close();
            user.media.consumersAudio.delete(data.user_id);
          });
          break;
      }

      consumer.on('producerpause', async () => {
        await consumer.pause();
        user.io.emit('mediaProducerPause', {
          user_id: data.user_id,
          kind: data.kind,
        });
      });

      consumer.on('producerresume', async () => {
        await consumer.resume();
        user.io.emit('mediaProducerResume', {
          user_id: data.user_id,
          kind: data.kind,
        });
      });

      consumer.on('score', (score: ConsumerScore[]) => {
        // this.logger.log(
        //   `room ${this.session_id} user ${user_id} consumer ${
        //     data.kind
        //   } score ${JSON.stringify(score)}`,
        // );
      });

      consumer.on('layerschange', (layers: ConsumerLayers | null) => {
        this.logger.log(
          `room ${this.session_id} user ${user_id} consumer ${
            data.kind
          } layerschange ${JSON.stringify(layers)}`,
        );
      });

      if (consumer.kind === 'video') {
        await consumer.resume();
      }

      return {
        producerId: target_producer.id,
        id: consumer.id,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
        type: consumer.type,
        producerPaused: consumer.producerPaused,
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
   * @param {Record<string, unknown>} data { type: TPeer }
   * https://developer.mozilla.org/ru/docs/Web/API/WebRTC_API/%D0%BF%D1%80%D0%BE%D1%82%D0%BE%D0%BA%D0%BE%D0%BB%D1%8B
   * @param {string} user_id sender of the message
   * @returns {Promise<Record<string, unknown>>} Promise<Record<string, unknown>>
   */
  private async restartIce(
    data: { type: 'producer' | 'consumer' },
    user_id: string,
  ): Promise<Record<string, unknown>> {
    try {
      this.logger.log(`room ${this.session_id} restartIce - ${data.type}`);

      const user = this.clients.get(user_id);

      let transport: WebRtcTransport;

      switch (data.type) {
        case 'producer':
          transport = user.media.producerTransport;
          break;
        case 'consumer':
          transport = user.media.consumerTransport;
          break;
      }

      if (!transport) {
        throw new Error(
          `Couldn't find ${data.type} transport with 'user_id'=${user_id} and 'room_id'=${this.session_id}`,
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
   * @param {Record<string, unknown>} data { user_id: string }
   * @param {string} user_id sender of the message
   * @returns {Promise<boolean>} Promise<boolean>
   */
  private async requestConsumerKeyFrame(
    data: { user_id: string },
    user_id: string,
  ): Promise<boolean> {
    try {
      const user = this.clients.get(user_id);

      const consumer: Consumer = user.media.consumersVideo.get(data.user_id);

      if (!consumer) {
        throw new Error(
          `Couldn't find video consumer with 'user_id'=${data.user_id} and 'room_id'=${this.session_id}`,
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
   * @param {Record<string, unknown>} data { type: TPeer }
   * @param {string} user_id sender of the message
   * @returns {Promise<Record<string, unknown>>} Promise<Record<string, unknown>>
   */
  private async getTransportStats(
    data: { type: 'producer' | 'consumer' },
    user_id: string,
  ): Promise<Record<string, unknown>> {
    try {
      this.logger.log(
        `room ${this.session_id} getTransportStats - ${data.type}`,
      );

      const user = this.clients.get(user_id);

      let transport: WebRtcTransport;

      switch (data.type) {
        case 'producer':
          transport = user.media.producerTransport;
          break;
        case 'consumer':
          transport = user.media.consumerTransport;
          break;
      }

      if (!transport) {
        throw new Error(
          `Couldn't find ${data.type} transport with 'user_id'=${user_id} and 'room_id'=${this.session_id}`,
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
   * @param {Record<string, unknown>} data { user_id: string; kind: MediaKind }
   * @param {string} _user_id sender of the message
   * @returns {Promise<Record<string, unknown>>} Promise<Record<string, unknown>>
   */
  private async getProducerStats(
    data: { user_id: string; kind: MediaKind },
    _user_id: string,
  ): Promise<Record<string, unknown>> {
    try {
      this.logger.log(
        `room ${this.session_id} getProducerStats - ${data.kind}`,
      );

      const target_user = this.clients.get(data.user_id);

      let producer: Producer;

      switch (data.kind) {
        case 'video':
          producer = target_user.media.producerVideo;
          break;
        case 'audio':
          producer = target_user.media.producerAudio;
          break;
      }

      if (!producer) {
        throw new Error(
          `Couldn't find ${data.kind} producer with 'user_id'=${data.user_id} and 'room_id'=${this.session_id}`,
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
   * @param {Record<string, unknown>} data { user_id: string; kind: MediaKind }
   * @param {string} user_id sender of the message
   * @returns {Promise<Record<string, unknown>>} Promise<Record<string, unknown>>
   */
  private async getConsumerStats(
    data: { user_id: string; kind: MediaKind },
    user_id: string,
  ): Promise<Record<string, unknown>> {
    try {
      this.logger.log(
        `room ${this.session_id} getProducerStats - ${data.kind}`,
      );

      const user = this.clients.get(user_id);

      let consumer: Consumer;

      switch (data.kind) {
        case 'video':
          consumer = user.media.consumersVideo.get(data.user_id);
          break;
        case 'audio':
          consumer = user.media.consumersAudio.get(data.user_id);
          break;
      }

      if (!consumer) {
        throw new Error(
          `Couldn't find ${data.kind} consumer with 'user_id'=${data.user_id} and 'room_id'=${this.session_id}`,
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
   * @param {string} _user_id sender of the message
   * @returns {Promise<string[]>} Promise<string[]>
   */
  private async getVideoProducerIds(_user_id: string): Promise<string[]> {
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
   * @param {string} _user_id sender of the message
   * @returns {Promise<string[]>} Promise<string[]>
   */
  private async getAudioProducerIds(_user_id: string): Promise<string[]> {
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
   * @param {Record<string, unknown>} data { user_id: string; kind: MediaKind }
   * @param {string} _user_id sender of the message
   * @returns {Promise<boolean>} promise<boolean>
   */
  private async producerClose(
    data: { user_id: string; kind: MediaKind },
    _user_id: string,
  ): Promise<boolean> {
    try {
      const target_user = this.clients.get(data.user_id);

      if (target_user) {
        let target_producer: Producer;

        switch (data.kind) {
          case 'video':
            target_producer = target_user.media.producerVideo;
            break;
          case 'audio':
            target_producer = target_user.media.producerAudio;
            break;
        }

        if (target_producer && !target_producer.closed) {
          target_producer.close();
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
   * @param {IProducerRequest} data { user_id: string; kind: MediaKind }
   * @returns {Promise<IProducerRequest>} promise<boolean>
   */
  private async producerPause(
    data: IProducerRequest,
  ): Promise<IProducerRequest> {
    try {
      const target_user = this.clients.get(data.user_id);
      if (target_user) {
        let target_producer: Producer;

        switch (data.kind) {
          case 'video':
            target_producer = target_user.media.producerVideo;
            break;
          case 'audio':
            target_producer = target_user.media.producerAudio;
            break;
        }

        if (target_producer && !target_producer.paused) {
          await target_producer.pause();
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
   * @param {Record<string, unknown>} data { user_id: string; kind: MediaKind }
   * @param {string} _user_id sender of the message
   * @returns {Promise<boolean>} promise<boolean>
   */
  private async producerResume(
    data: { user_id: string; kind: MediaKind },
    _user_id: string,
  ): Promise<boolean> {
    try {
      const target_user = this.clients.get(data.user_id);
      if (target_user) {
        let target_producer: Producer;

        switch (data.kind) {
          case 'video':
            target_producer = target_user.media.producerVideo;
            break;
          case 'audio':
            target_producer = target_user.media.producerAudio;
            break;
        }

        if (
          target_producer &&
          target_producer.paused &&
          !target_producer.closed
        ) {
          await target_producer.resume();
        } else if (target_producer && target_producer.closed) {
          target_user.io.emit('mediaReproduce', { kind: data.kind });
        }
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
   * @param {string} _user_id sender of the message
   * @returns {Promise<boolean>} promise<boolean>
   */
  private async allProducerClose(
    data: { kind: MediaKind },
    _user_id: string,
  ): Promise<boolean> {
    try {
      this.clients.forEach(async (client) => {
        if (client.media) {
          let target_producer: Producer;

          switch (data.kind) {
            case 'video':
              target_producer = client.media.producerVideo;
              break;
            case 'audio':
              target_producer = client.media.producerAudio;
              break;
          }

          if (target_producer && !target_producer.closed) {
            target_producer.close();
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
   * @param {string} _user_id sender of the message
   * @returns {Promise<boolean>} promise<boolean>
   */
  private async allProducerPause(
    data: { kind: MediaKind },
    _user_id: string,
  ): Promise<boolean> {
    try {
      this.clients.forEach(async (client) => {
        if (client.media) {
          let target_producer: Producer;

          switch (data.kind) {
            case 'video':
              target_producer = client.media.producerVideo;
              break;
            case 'audio':
              target_producer = client.media.producerAudio;
              break;
          }

          if (target_producer && !target_producer.paused) {
            await target_producer.pause();
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
   * @param {string} _user_id sender of the message
   * @returns {Promise<boolean>} promise<boolean>
   */
  private async allProducerResume(
    data: { kind: MediaKind },
    _user_id: string,
  ): Promise<boolean> {
    try {
      this.clients.forEach(async (client) => {
        if (client.media) {
          let target_producer: Producer;

          switch (data.kind) {
            case 'video':
              target_producer = client.media.producerVideo;
              break;
            case 'audio':
              target_producer = client.media.producerAudio;
              break;
          }

          if (
            target_producer &&
            target_producer.paused &&
            !target_producer.closed
          ) {
            await target_producer.resume();
          } else if (target_producer && target_producer.closed) {
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
    if (
      !consumerPeer.rtpCapabilities ||
      !this.router.canConsume({
        producerId: producer.id,
        rtpCapabilities: this.router.rtpCapabilities,
      })
    ) {
      return;
    }
    const transport = consumerPeer.media.consumerTransport;
    if (!transport) {
      this.logger.warn('Transport for consuming not found', 'createConsumer()');
    }
    let consumer;
    try {
      consumer = await transport.consume({
        producerId: producer.id,
        rtpCapabilities: consumerPeer.rtpCapabilities,
        paused: producer.kind === 'video',
      });
      if (producer.kind === 'audio') {
        await consumer.setPriority(255);
      }
    } catch (error) {
      this.logger.warn(error, '_createConsumer() | [error:"%o"]');
      return;
    }
    consumerPeer.media.consumersVideo.set(producerPeer.id, consumer);
    consumer.on('transportclose', () => {
      if (producer.kind === 'video') {
        consumerPeer.media.consumersVideo.delete(producer.id);
      } else {
        consumerPeer.media.consumersAudio.delete(producer.id);
      }
    });
    consumer.on('producerclose', () => {
      if (producer.kind === 'video') {
        consumerPeer.media.consumersVideo.delete(producer.id);
      } else {
        consumerPeer.media.consumersAudio.delete(producer.id);
      }
      consumerPeer.io.emit('consumerClosed', {
        user_id: producerPeer.id,
        kind: producer.kind,
      });
    });
    consumer.on('producerpause', () => {
      consumerPeer.io.emit('consumerPaused', {
        user_id: producerPeer.id,
        kind: producer.kind,
      });
    });
    consumer.on('producerresume', () => {
      consumerPeer.io.emit('consumerResumed', {
        user_id: producerPeer.id,
        kind: producer.kind,
      });
    });
    consumer.on('score', (score) => {
      consumerPeer.io.emit('consumerScore', {
        user_id: producerPeer.id,
        kind: producer.kind,
        score: score,
      });
    });
    consumer.on('layerschange', (layers) => {
      consumerPeer.io.emit('consumersLayersChanged', {
        user_id: producerPeer.id,
        kind: producer.kind,
        spatialLayer: layers ? layers.spatialLayer : null,
        temporalLayer: layers ? layers.temporalLayer : null,
      });
    });

    try {
      await consumer.resume();
      consumerPeer.io.emit('consumerScore', {
        user_id: producerPeer.id,
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
      return client.broadcast.to(this.session_id).emit(event, msg);
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
      return this.wssServer.to(this.session_id).emit(event, msg);
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
  _timeoutCallback(callback) {
    let called = false;

    const interval = setTimeout(() => {
      if (called) return;
      called = true;
      callback(new SocketTimeoutError('Request timed out'));
    }, 20000);

    return (...args) => {
      if (called) return;
      called = true;
      clearTimeout(interval);

      callback(...args);
    };
  }

  _sendRequest(socket, method, data) {
    return new Promise((resolve, reject) => {
      socket.emit(
        'request',
        { method, data },
        this._timeoutCallback((err, response) => {
          if (err) {
            this.logger.warn(err, `sendrequest -reject ${data.kind}`);
            reject(err);
          } else {
            this.logger.warn(err, `sendrequest - resolve ${data.kind}`);
            resolve(response);
          }
        }),
      );
    });
  }
  async _request(socket, method, data) {
    this.logger.debug(
      method,
      data.peerId + ' ' + data.kind,
      '_request() [method:"%s", data:"%o"]',
    );
    const requestRetries = 3;
    for (let tries = 0; tries < requestRetries; tries++) {
      try {
        return await this._sendRequest(socket, method, data);
      } catch (error) {
        if (error instanceof SocketTimeoutError && tries < requestRetries)
          this.logger.warn(
            tries + ' ' + data.kind + ' ' + data.peerId,
            '_request() | timeout, retrying [attempt:"%s"]',
          );
        else throw error;
      }
    }
  }
}
