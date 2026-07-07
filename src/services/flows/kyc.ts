import { SessionState, Prisma } from '@/generated/prisma/client.js';
import { getSession, updateSession, getBusinessByCode } from '@/services/db.js';
import { sendText } from '@/services/whatsapp.js';
import { sendMainMenu } from '@/services/flows/menu.js';

export async function handleIdle(customerId: string, text: string): Promise<void> {
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
      return;
    }
  }

  // Fresh user, no matching code — start KYC
  await updateSession(customerId, { state: SessionState.KYC_NAME });
  await sendText(
    customerId,
    "👋 Welcome to PayMate! I help you buy and sell goods via WhatsApp.\n\nFirst, let's get you set up. What's your full name?",
  );
}

export async function handleKycName(customerId: string, text: string): Promise<void> {
  const name = text.trim();
  if (name.length < 2) {
    await sendText(customerId, 'Please enter a valid full name.');
    return;
  }

  await updateSession(customerId, {
    state: SessionState.KYC_EMAIL,
    data: { name },
  });

  await sendText(customerId, `Nice to meet you, ${name}! What's your email address?`);
}

export async function handleKycEmail(customerId: string, text: string): Promise<void> {
  const email = text.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailRegex.test(email)) {
    await sendText(customerId, "That doesn't look like a valid email. Please try again.");
    return;
  }

  const session = await getSession(customerId);
  const name = (session.data as Prisma.JsonObject).name as string;

  await updateSession(customerId, {
    state: SessionState.INTENT_SELECTION,
    data: { name, email },
  });

  await sendMainMenu(customerId, `All set, ${name}! 🎉 What would you like to do?`);
}
