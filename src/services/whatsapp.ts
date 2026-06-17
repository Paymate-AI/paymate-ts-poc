import fetch from 'node-fetch';

/**
 * Sends a text message to a WhatsApp user using the Meta Cloud API.
 * @param to The recipient's WhatsApp ID/phone number (e.g. "16505551234").
 * @param message The text message content to send.
 */
export async function sendText(to: string, message: string): Promise<void> {
  const whatsappToken = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.PHONE_NUMBER_ID;

  if (!whatsappToken || !phoneNumberId) {
    throw new Error('Missing WHATSAPP_TOKEN or PHONE_NUMBER_ID in environment variables');
  }

  const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;

  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: to,
    type: 'text',
    text: {
      preview_url: false,
      body: message,
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${whatsappToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`WhatsApp API call failed with status ${response.status}: ${errorText}`);
  }
}
