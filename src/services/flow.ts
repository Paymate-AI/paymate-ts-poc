import { SessionState, Prisma } from '@/generated/prisma/client.js';
import { getSession, updateSession } from '@/services/db.js';
import { sendText } from '@/services/whatsapp.js';
import { sendMainMenu } from '@/services/flows/menu.js';
import { handleIdle, handleKycName, handleKycEmail } from '@/services/flows/kyc.js';
import { handleOnboardingBusinessName } from '@/services/flows/onboarding.js';
import { handleIntentSelection } from '@/services/flows/intent.js';
import { handleCustomerBrowsing } from '@/services/flows/customer-browsing.js';

export async function handleFlow(customerId: string, text: string): Promise<void> {
  const normalised = text.trim().toLowerCase();

  // Global reset command
  if (normalised === 'restart' || normalised === 'reset' || normalised === 'start over') {
    const currentSession = await getSession(customerId);
    const existingData = (currentSession.data as Prisma.JsonObject) ?? {};
    const name = existingData.name as string | undefined;
    const email = existingData.email as string | undefined;

    if (name && email) {
      // Already fully onboarded — go straight back to intent selection
      await updateSession(customerId, {
        state: SessionState.INTENT_SELECTION,
        activeBusinessCode: null,
        activeBusinessId: null,
        data: { name, email },
      });
      await sendMainMenu(customerId, `Welcome back, ${name}! What would you like to do?`);
      return;
    }

    if (name) {
      // Have name, still need email
      await updateSession(customerId, {
        state: SessionState.KYC_EMAIL,
        activeBusinessCode: null,
        activeBusinessId: null,
        data: { name },
      });
      await sendText(customerId, `Welcome back, ${name}! What's your email address?`);
      return;
    }

    // Nothing on file yet — full fresh start
    await updateSession(customerId, {
      state: SessionState.KYC_NAME,
      activeBusinessCode: null,
      activeBusinessId: null,
      data: {},
    });
    await sendText(customerId, "Let's start fresh! What's your full name?");
    return;
  }

  const session = await getSession(customerId);

  switch (session.state) {
    case SessionState.IDLE:
      return handleIdle(customerId, text);

    case SessionState.KYC_NAME:
      return handleKycName(customerId, text);

    case SessionState.KYC_EMAIL:
      return handleKycEmail(customerId, text);

    case SessionState.INTENT_SELECTION:
      return handleIntentSelection(customerId, text);

    case SessionState.ONBOARDING_BUSINESS_NAME:
      return handleOnboardingBusinessName(customerId, text);

    case SessionState.ONBOARDING_COMPLETE:
      await updateSession(customerId, { state: SessionState.INTENT_SELECTION });
      return sendMainMenu(customerId, 'What would you like to do next?');

    case SessionState.CUSTOMER_BROWSING:
      return handleCustomerBrowsing(customerId, session.activeBusinessId, text);

    default:
      await sendText(customerId, "Sorry, I didn't understand that. Please try again.");
  }
}
