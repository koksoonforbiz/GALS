import { buildServer } from './server.js';
import { HOST, PORT, STUDIO_DATA_DIR } from './config.js';

const app = await buildServer();
try {
  await app.listen({ host: HOST, port: PORT });
  // eslint-disable-next-line no-console
  console.log(`GALS Studio server on http://${HOST}:${PORT}  (data: ${STUDIO_DATA_DIR})`);
} catch (err) {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
}
