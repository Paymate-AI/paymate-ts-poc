import { SessionState } from '@/generated/prisma/client.js';
import { updateSession, getBusinessByCode, appendMessage } from '@/services/db.js';
import { sendText } from '@/services/whatsapp.js';
import { handleCustomerBrowsing } from '@/services/flows/customer-browsing.js';
import { AIResponse } from '@/types/index.js';

export async function handleIdle(
  customerId: string,
  text: string,
): Promise<AIResponse['action'] | null | void> {
  const possibleCode = text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

  if (possibleCode) {
    const business = await getBusinessByCode(possibleCode);
    if (business) {
      await updateSession(customerId, {
        state: SessionState.CUSTOMER_BROWSING,
        activeBusinessCode: business.uniqueCode,
        activeBusinessId: business.id,
      });
      await sendText(
        customerId,
        `👋 Welcome to ${business.businessName}! Ask me anything about our products, or let me know what you'd like to order.`,
      );
      return null;
    }
  }

  // Fresh user, no matching code — start KYC
  await updateSession(customerId, { state: SessionState.KYC_NAME });
  const welcomeMsg =
    "👋 Welcome to PayMate! I help you buy and sell goods via WhatsApp.\n\nFirst, let's get you set up. What's your full name?";
  await sendText(customerId, welcomeMsg);
  await appendMessage(customerId, 'assistant', welcomeMsg);
  return null;
}

export async function handleKycName(
  customerId: string,
  text: string,
): Promise<AIResponse['action'] | null | void> {
  // Delegate custom input to the AI concierge for extraction
  return handleCustomerBrowsing(customerId, null, text);
}

export async function handleKycEmail(
  customerId: string,
  text: string,
): Promise<AIResponse['action'] | null | void> {
  // Delegate custom input to the AI concierge for extraction
  return handleCustomerBrowsing(customerId, null, text);
}
