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
      process.env.HTTPS_CERT_FULLCHAIN || `${__dirname}/certs/fullchain.pem`,
    sslKey: process.env.HTTPS_CERT_PRIVKEY || `${__dirname}/certs/privkey.pem`,
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
      rtcMinPort: process.env.RTC_MIN_PORT || 40000,
      rtcMaxPort: process.env.RTC_MAX_PORT || 49999,
      logLevel: 'warn',
      logTags: [
        'info',
        'ice',
        'dtls',
        'rtp',
        'srtp',
        'rtcp',
        'rtx',
        'bwe',
        'score',
        'simulcast',
        'svc',
        'sctp',
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
          ip: process.env['MEDIASOUP_IP'],
          announcedIp: null,
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
    plainTransportOptions: {
      listenIp: {
        ip: process.env.MEDIASOUP_LISTEN_IP || '1.2.3.4',
        announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP,
      },
      maxSctpMessageSize: 262144,
    },
  },
}));
