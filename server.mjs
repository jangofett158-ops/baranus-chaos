import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createApp, APP_VERSION} from './lib/app.mjs';

const BASE = path.dirname(fileURLToPath(import.meta.url));
const arg = name => {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : undefined;
};

export async function start({dataDir, port, protector} = {}) {
  const app = createApp({
    dataDir: dataDir || arg('--data') || process.env.BARANUS_DATA_DIR || path.join(BASE, '.data'),
    publicDir: path.join(BASE, 'public'),
    port: Number(port ?? arg('--port') ?? process.env.APP_PORT ?? 3217),
    protector
  });
  await app.listen();
  return app;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  start()
    .then(app => console.log(`Baranus Chaos ${APP_VERSION}: http://127.0.0.1:${app.port}`))
    .catch(error => { console.error('Не удалось запустить:', error.message); process.exit(1); });
}
