import fetch from 'node-fetch';
import { Message, AIResponse } from '../types/index.js';

/**
 * Sends a message and message history to the Python AI microservice.
 * @param customerId The WhatsApp ID of the customer.
 * @param message The current text/payload extracted from the webhook.
 * @param history The conversation history list.
 */
export async function callAI(
  customerId: string,
  message: string,
  history: Message[],
): Promise<AIResponse> {
  const pythonServiceUrl = process.env.PYTHON_SERVICE_URL;
  const internalSecret = process.env.INTERNAL_SECRET;

  if (!pythonServiceUrl || !internalSecret) {
    throw new Error('Missing PYTHON_SERVICE_URL or INTERNAL_SECRET in environment variables');
  }

  const url = `${pythonServiceUrl.replace(/\/$/, '')}/ai/chat`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Secret': internalSecret,
    },
    body: JSON.stringify({
      customerId,
      message,
      history,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Python AI service call failed with status ${response.status}: ${errorText}`);
  }

  const data = (await response.json()) as AIResponse;
  return data;
}
