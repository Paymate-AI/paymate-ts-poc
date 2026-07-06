import fetch from 'node-fetch';
import { AIResponse } from '../types/index.js';

/**
 * Sends a message to the Python AI microservice for a given business.
 * History is fetched by the Python service itself via the /chats/:businessId/:customerId/recent endpoint.
 * @param customerId The WhatsApp ID of the customer.
 * @param businessId The ID of the business the customer is interacting with.
 * @param message The current text/payload extracted from the webhook.
 */
export async function callAI(
  customerId: string,
  businessId: string,
  message: string,
): Promise<AIResponse> {
  const pythonServiceUrl = process.env.PYTHON_SERVICE_URL;
  const internalSecret = process.env.INTERNAL_SECRET;

  if (!pythonServiceUrl || !internalSecret) {
    throw new Error('Missing PYTHON_SERVICE_URL or INTERNAL_SECRET in environment variables');
  }

  const url = `${pythonServiceUrl.replace(/\/$/, '')}/bot?business_id=${businessId}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${internalSecret}`,
    },
    body: JSON.stringify({ customerId, message }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Python AI service call failed with status ${response.status}: ${errorText}`);
  }

  return response.json() as Promise<AIResponse>;
}
