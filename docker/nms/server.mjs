/**
 * Node Media Server — c64-ready streaming backend
 *
 * RTMP ingest : rtmp://localhost:1935/live/<stream-key>
 * HTTP-FLV    : http://localhost:8000/live/<stream-key>.flv
 * HLS         : http://localhost:8000/live/<stream-key>/index.m3u8
 *
 * The stream key defaults to "c64" (matching the headless player default),
 * but NMS accepts any key on the /live app — no authentication is required
 * in this dev/local configuration.
 *
 * To add auth, set an `auth` block in the config object below — see
 * https://github.com/illuspas/Node-Media-Server#readme for details.
 */
import NodeMediaServer from 'node-media-server';

const config = {
  rtmp: {
    port: 1935,
    chunk_size: 60000,
    gop_cache: true,
    ping: 30,
    ping_timeout: 60,
  },
  http: {
    port: 8000,
    // Serve HTTP-FLV from the same port as the healthcheck endpoint
    mediaroot: '/tmp/nms-media',
    allow_origin: '*',
  },
  // NOTE: HLS transcoding (trans block) is intentionally omitted.
  // node-media-server v2.7 has a bug where its trans server references an
  // undeclared 'version' variable when started from an ES module, causing an
  // uncaught exception that kills the process.  RTMP ingest and HTTP-FLV
  // playback work correctly without it.  Re-enable once upstream is fixed:
  //   trans: { ffmpeg: '/usr/bin/ffmpeg', tasks: [{ app: 'live', hls: true, ... }] }
};

const nms = new NodeMediaServer(config);
nms.run();

console.log('Node Media Server started');
console.log('  RTMP  → rtmp://0.0.0.0:1935/live/<key>');
console.log('  HTTP  → http://0.0.0.0:8000/live/<key>.flv   (HTTP-FLV)');
console.log('  HLS   → http://0.0.0.0:8000/live/<key>/index.m3u8');

