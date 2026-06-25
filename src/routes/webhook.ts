import { FastifyPluginAsync } from 'fastify';
import { callAI } from '../services/python-bridge.js';
import { sendText } from '../services/whatsapp.js';
import { getSession, getConversationHistory, appendMessage } from '../services/db.js';
import { WhatsAppMessage, WhatsAppWebhookBody } from '../types/index.js';

interface WebhookGetQuery {
  'hub.mode'?: string;
  'hub.verify_token'?: string;
  'hub.challenge'?: string;
}

/**
 * Extracts message text representation based on WhatsApp message type.
 */
function extractText(message: WhatsAppMessage): string | null {
  if (message.type === 'text' && message.text) {
    return message.text.body;
  }
  if (message.type === 'interactive' && message.interactive) {
    const { type, button_reply, list_reply } = message.interactive;
    if (type === 'button_reply' && button_reply) {
      return button_reply.title || button_reply.id;
    }
    if (type === 'list_reply' && list_reply) {
      return list_reply.title || list_reply.id;
    }
  }
  return null;
}

export const webhookRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /webhook - Verification Endpoint for Meta Webhook setup
  fastify.get<{ Querystring: WebhookGetQuery }>('/webhook', async (request, reply) => {
    const verifyToken = process.env.VERIFY_TOKEN;
    const mode = request.query['hub.mode'];
    const token = request.query['hub.verify_token'];
    const challenge = request.query['hub.challenge'];

    if (mode === 'subscribe' && token === verifyToken) {
      fastify.log.info('Webhook verified successfully');
      return reply.status(200).send(challenge);
    }

    fastify.log.warn('Webhook verification failed: verify token mismatch');
    return reply.status(403).send('Forbidden');
  });

  // POST /webhook - Receives messages and forwards to AI
  fastify.post<{ Body: WhatsAppWebhookBody }>('/webhook', async (request, reply) => {
    // Immediately return 200 OK to prevent webhook retry loops
    reply.status(200).send('OK');

    const body = request.body;

    // Safely extract message details
    const message = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message) {
      return;
    }

    const customerId = message.from;
    if (!customerId) {
      fastify.log.warn('Received webhook message without sender (from) ID');
      return;
    }

    const text = extractText(message);
    if (!text) {
      fastify.log.info({ messageId: message.id, type: message.type }, 'Skipped non-supported/empty message type');
      return;
    }

    const handleMessageAsync = async () => {
      try {
        // Load session and conversation history in parallel
        const [session, history] = await Promise.all([
          getSession(customerId),
          getConversationHistory(customerId),
        ]);

        fastify.log.info({ customerId, state: session.state }, 'Session loaded');

        // Persist the incoming user message
        await appendMessage(customerId, 'user', text);

        // Send to AI service with full conversation history
        const aiResponse = await callAI(customerId, text, history);

        if (aiResponse.action === null) {
          // Persist assistant reply and send to WhatsApp
          await appendMessage(customerId, 'assistant', aiResponse.reply);
          await sendText(customerId, aiResponse.reply);
        } else if (aiResponse.action.type === 'initiate_payment') {
          fastify.log.info(
            { action: aiResponse.action },
            'Payment initiation requested (placeholder handler logged)'
          );
        } else {
          fastify.log.info(
            { action: aiResponse.action },
            `Received unhandled action type: ${aiResponse.action.type}`
          );
        }
      } catch (err) {
        fastify.log.error(err, 'Error in background webhook processing');
      }
    };

    // Fire-and-forget background processing
    handleMessageAsync();
  });
};
