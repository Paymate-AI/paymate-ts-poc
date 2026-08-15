import { appendMessage, getSession, getConversationHistory } from '@/services/db.js';
import { sendText } from '@/services/whatsapp.js';
import { callAI } from '@/services/python-bridge.js';
import { AIResponse } from '@/types/index.js';

export async function handleCustomerBrowsing(
  customerId: string,
  businessId: string | null,
  text: string,
  stateOverride?: string,
): Promise<AIResponse['action'] | null> {
  const session = await getSession(customerId);
  if (!businessId && session.state === 'CUSTOMER_BROWSING' && !stateOverride) {
    await sendText(
      customerId,
      "Something went wrong — I've lost track of which business you're browsing. Type 'reset' to start over.",
    );
    return null;
  }

  // NOTE: the user message is already persisted by webhook.ts before handleFlow is called
  // Fetch history including the just-saved user message to pass to Python
  const history = await getConversationHistory(customerId, 20);

  try {
    const aiResponse = await callAI(
      customerId,
      businessId,
      text,
      stateOverride ?? session.state,
      session.data as Record<string, unknown>,
      history,
    );
    await appendMessage(customerId, 'assistant', aiResponse.reply);
    await sendText(customerId, aiResponse.reply);

    if (aiResponse.action?.type === 'HUMAN_HANDOFF') {
      // TODO: escalate to business owner once that flow exists
    }

    if (aiResponse.action?.type === 'PAYMENT_SUCCESSFUL') {
      const amount = aiResponse.action.payload?.amount as number | undefined;
      const amountStr = amount ? `NGN ${Number(amount).toLocaleString('en-NG')}` : 'your payment';
      await sendText(
        customerId,
        `✅ *Payment Confirmed!*\n\nWe've received ${amountStr} successfully. Thank you for your order! 🎉\n\nType *'main menu'* to continue shopping.`,
      );
    }

    return aiResponse.action;
  } catch (err) {
    console.error('Error in handleCustomerBrowsing calling Python AI:', err);
    await sendText(
      customerId,
      'Sorry, something went wrong on my end. Please try again in a moment.',
    );
    return null;
  }
}
