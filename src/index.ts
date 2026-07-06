import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import { webhookRoutes } from './routes/webhook.js';
import { chatsRoutes } from './routes/chats.js';

const fastify = Fastify({
  logger: true,
});

// Register form body parser
fastify.register(formbody);

// Register Webhook routes
fastify.register(webhookRoutes);

// AI Bot routes
fastify.register(chatsRoutes);

// Get Port from environment
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;

const start = async () => {
  try {
    // Note: host '0.0.0.0' is critical for running in Docker / Cloud Run
    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    fastify.log.info(`Server is listening on port ${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
