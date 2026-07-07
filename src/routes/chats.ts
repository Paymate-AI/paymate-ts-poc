// import { FastifyInstance } from 'fastify';
// import { getConversationHistory } from '../services/db.js';
//
// export async function chatsRoutes(app: FastifyInstance) {
//   app.get('/chats/:businessId/:customerId/recent', async (request, reply) => {
//     const secret = request.headers['x-internal-secret'];
//     if (secret !== process.env.INTERNAL_SECRET) {
//       return reply.code(401).send({ error: 'Unauthorized' });
//     }
//
//     const { customerId } = request.params as { businessId: string; customerId: string };
//     const limitQuery = (request.query as { limit?: string }).limit;
//     const limit = limitQuery ? parseInt(limitQuery, 10) : 20;
//
//     const messages = await getConversationHistory(customerId, limit);
//     return reply.send({ messages });
//   });
// }

import { FastifyInstance } from 'fastify';
import { getConversationHistory } from '@/services/db.js';

export async function chatsRoutes(app: FastifyInstance) {
  app.get('/chats/:businessId/:customerId/recent', async (request, reply) => {
    const authHeader = request.headers['authorization'];
    const expected = `Bearer ${process.env.INTERNAL_SECRET}`;

    if (authHeader !== expected) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { customerId } = request.params as { businessId: string; customerId: string };
    const messages = await getConversationHistory(customerId);
    return reply.send(messages);
  });
}
