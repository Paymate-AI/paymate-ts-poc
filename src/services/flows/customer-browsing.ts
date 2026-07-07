import { appendMessage, getSession } from '@/services/db.js';
import { sendText } from '@/services/whatsapp.js';
import { callAI } from '@/services/python-bridge.js';

export async function handleCustomerBrowsing(
  customerId: string,
  businessId: string | null,
  text: string,
): Promise<void> {
  const session = await getSession(customerId);
  if (!businessId && session.state === 'CUSTOMER_BROWSING') {
    await sendText(
      customerId,
      "Something went wrong — I've lost track of which business you're browsing. Type 'reset' to start over.",
    );
    return;
  }

  // NOTE: the user message is already persisted by webhook.ts before handleFlow is called

  try {
    const aiResponse = await callAI(customerId, businessId, text);
    await appendMessage(customerId, 'assistant', aiResponse.reply);
    await sendText(customerId, aiResponse.reply);

    if (aiResponse.action?.type === 'HUMAN_HANDOFF') {
      // TODO: escalate to business owner once that flow exists
    }
    // COLLECT_PAYMENT / PAYMENT_SUCCESSFUL — payload available for future wiring
  } catch (err) {
    console.error('Error in handleCustomerBrowsing calling Python AI:', err);
    await sendText(
      customerId,
      'Sorry, something went wrong on my end. Please try again in a moment.',
    );
  }
}
