import fetch from 'node-fetch';
import { AIResponse, Message } from '@/types/index.js';

/**
 * Sends a message to the Python AI microservice for a given business.
 * Conversation history is fetched by the TS service and passed in the request body.
 * @param customerId The WhatsApp ID of the customer.
 * @param businessId The ID of the business the customer is interacting with.
 * @param message The current text/payload extracted from the webhook.
 * @param history The recent conversation history for this customer.
 */
export async function callAI(
  customerId: string,
  businessId: string | null,
  message: string,
  state?: string,
  data?: Record<string, unknown>,
  history: Message[] = [],
): Promise<AIResponse> {
  const pythonServiceUrl = process.env.PYTHON_SERVICE_URL;
  const internalSecret = process.env.INTERNAL_SECRET;

  if (!pythonServiceUrl || !internalSecret) {
    throw new Error('Missing PYTHON_SERVICE_URL or INTERNAL_SECRET in environment variables');
  }

  const queryParams = businessId ? `?business_id=${businessId}` : '';
  const url = `${pythonServiceUrl.replace(/\/$/, '')}/bot${queryParams}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${internalSecret}`,
    },
    body: JSON.stringify({ customerId, message, state, data, history }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Python AI service call failed with status ${response.status}: ${errorText}`);
  }

  return response.json() as Promise<AIResponse>;
}
