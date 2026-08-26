import { buildApp } from './app';
import { loadConfig } from './config';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildApp(config);

  try {
    await app.listen({ port: config.API_PORT, host: config.API_HOST });
  } catch (error) {
    app.log.error({ err: error }, 'Failed to start API');
    process.exit(1);
  }

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'Shutting down');
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

try {
  await main();
} catch (error) {
  // Configuration errors surface here as clear startup failures.
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
