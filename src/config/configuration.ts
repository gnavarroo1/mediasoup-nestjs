import { registerAs } from '@nestjs/config';
import * as os from 'os';
export default registerAs('app', () => ({
  LOGGER_SETTINGS: {
    level: 'debug',
    silence: ['healthz'],
  },
  APP_SETTINGS: {
    appPort: process.env.API_PORT || 443,
    wssPort: process.env.WSS_PORT,
    swaggerScheme: 'http',
    client: {
      client_id: '',
      client_secret: '',
    },
    sslCrt:
      process.env.DTLSCERTIFICATEFILE || `${__dirname}/certs/fullchain.pem`,
    sslKey: process.env.DTLSPRIVATEKEYFILE || `${__dirname}/certs/privkey.pem`,
  },
  CORS_SETTINGS: {
    allowedOrigins: [],
    allowedMethods: ['GET', 'POST', 'PUT', 'PATCH', 'OPTIONS'],
    allowedCredentials: false,
    allowedHeaders: [
      'X-Requested-With',
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
    workerPool: Object.keys(os.cpus()).length,
    worker: {
      rtcMinPort: 40000,
      rtcMaxPort: 49999,
      logLevel: 'debug',
      logTags: [
        'info',
        'ice',
        'dtls',
        'rtp',
        'srtp',
        'rtcp',
        // 'rtx',
        // 'bwe',
        // 'score',
        // 'simulcast',
        // 'svc',
        // 'sctp',
      ],
      dtlsCertificateFile: process.env.DTLSCERTIFICATEFILE || undefined,
      dtlsPrivateKeyFile: process.env.DTLSPRIVATEKEYFILE || undefined,
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
        {
          kind: 'video',
          mimeType: 'video/VP9',
          clockRate: 90000,
          parameters: {
            'profile-id': 2,
            'x-google-start-bitrate': 1000,
          },
        },
        {
          kind: 'video',
          mimeType: 'video/h264',
          clockRate: 90000,
          parameters: {
            'packetization-mode': 1,
            'profile-level-id': '4d0032',
            'level-asymmetry-allowed': 1,
            'x-google-start-bitrate': 1000,
          },
        },
        {
          kind: 'video',
          mimeType: 'video/h264',
          clockRate: 90000,
          parameters: {
            'packetization-mode': 1,
            'profile-level-id': '42e01f',
            'level-asymmetry-allowed': 1,
            'x-google-start-bitrate': 1000,
          },
        },
      ],
    },
    webRtcTransport: {
      listenIps: [
        {
          //private ip address set 127.0.0.1 on local
          ip: process.env.MEDIASOUP_LISTEN_IP,
          //public ip address set null on local
          announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP,
        },
      ],
      initialAvailableOutgoingBitrate: 1000000,
      minimumAvailableOutgoingBitrate: 600000,
      maxSctpMessageSize: 262144,
      maximumAvailableOutgoingBitrate: 200000,
      factorIncomingBitrate: 0.75,
      // Additional options that are not part of WebRtcTransportOptions.
      maxIncomingBitrate: 1500000,
    },
    // plainTransportOptions: {
    //   listenIp: {
    //     //private ip address set 127.0.0.1 on local
    //     ip: process.env.MEDIASOUP_LISTEN_IP,
    //     //public ip address set null on local
    //     announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP,
    //   },
    //   maxSctpMessageSize: 262144,
    // },
  },
}));
