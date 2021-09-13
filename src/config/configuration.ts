export default () => ({
  LOGGER_SETTINGS: {
    level: 'debug',
    silence: ['healthz'],
  },
  APP_SETTINGS: {
    appPort: 8085,
    wssPort: 8086,
    swaggerScheme: 'http',
    client: {
      client_id: '',
      client_secret: '',
    },
    sslCrt: '',
    sslKey: '',
  },
  CORS_SETTINGS: {
    allowedOrigins: [],
    allowedMethods: ['GET', 'POST', 'PUT', 'PATCH', 'OPTIONS'],
    allowedCredentials: false,
    allowedHeaders: [
      'Content-Type',
      'Content-Language',
      'Authorization',
      'X-Authorization',
      'Origin',
      'Accept',
      'Accept-Language',
    ],
  },
  MEDIASOUP_SETTINGS: {
    workerPool: 3,
    worker: {
      rtcMinPort: 10000,
      rtcMaxPort: 10100,
      logLevel: 'warn',
      logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'],
    },
    router: {
      mediaCodecs: [
        {
          kind: 'audio',
          mimeType: 'audio/opus',
          clockRate: 48000,
          channels: 2,
        },
        {
          kind: 'video',
          mimeType: 'video/VP8',
          clockRate: 90000,
          parameters: {
            'x-google-start-bitrate': 1000,
          },
        },
      ],
    },
    webRtcTransport: {
      listenIps: [
        {
          ip: '127.0.0.1',
          announcedIp: null,
        },
      ],
      initialAvailableOutgoingBitrate: 100000,
      minimumAvailableOutgoingBitrate: 15000,
      maximumAvailableOutgoingBitrate: 200000,
      factorIncomingBitrate: 0.75,
    },
  },
});
