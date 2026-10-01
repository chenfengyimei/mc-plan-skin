import 'reflect-metadata';
import 'dotenv/config';

import { loadApiConfig } from '@mc-plan/skin-config';

const config = loadApiConfig(process.env);
const { createApplication } = await import('./bootstrap.js');
const app = await createApplication(config);

await app.listen(config.apiPort, config.apiHost);

const shutdown = async (): Promise<void> => {
  await app.close();
};

process.once('SIGTERM', () => {
  void shutdown();
});
process.once('SIGINT', () => {
  void shutdown();
});
