import { SessionState, Prisma } from '@/generated/prisma/client.js';
import { getSession, updateSession } from '@/services/db.js';
import { sendText } from '@/services/whatsapp.js';
import { sendMainMenu } from '@/services/flows/menu.js';
import { handleIdle, handleKycName, handleKycEmail } from '@/services/flows/kyc.js';
import {
  handleOnboardingBusinessName,
  handleOnboardingBusinessService,
} from '@/services/flows/onboarding.js';
import { handleIntentSelection } from '@/services/flows/intent.js';
import { handleCustomerBrowsing } from '@/services/flows/customer-browsing.js';
import { AIResponse } from '@/types/index.js';

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
  let action: AIResponse['action'] | void = null;

  switch (session.state) {
    case SessionState.IDLE:
      action = await handleIdle(customerId, text);
      break;

    case SessionState.KYC_NAME:
      action = await handleKycName(customerId, text);
      break;

    case SessionState.KYC_EMAIL:
      action = await handleKycEmail(customerId, text);
      break;

    case SessionState.INTENT_SELECTION:
      action = await handleIntentSelection(customerId, text);
      break;

    case SessionState.ONBOARDING_BUSINESS_NAME:
      await handleOnboardingBusinessName(customerId, text);
      break;

    case SessionState.ONBOARDING_BUSINESS_SERVICE:
      await handleOnboardingBusinessService(customerId, text);
      break;

    case SessionState.ONBOARDING_COMPLETE:
      await updateSession(customerId, { state: SessionState.INTENT_SELECTION });
      await sendMainMenu(customerId, 'What would you like to do next?');
      break;

    case SessionState.CUSTOMER_BROWSING:
      action = await handleCustomerBrowsing(customerId, session.activeBusinessId, text);
      break;

    default:
      await sendText(customerId, "Sorry, I didn't understand that. Please try again.");
  }

  // Execute AI action block payloads
  if (action) {
    if (action.type === 'TRIGGER_COMMAND') {
      const command = action.payload?.command as string;
      if (command) {
        const isMainMenuCommand = [
          'register_business',
          'find_service',
          'manage_catalog',
          'delete_business',
          'main_menu',
        ].includes(command.trim().toLowerCase());

        if (isMainMenuCommand) {
          const currentSession = await getSession(customerId);
          const sessionData = (currentSession.data as Prisma.JsonObject) ?? {};
          await updateSession(customerId, {
            state: SessionState.INTENT_SELECTION,
            activeBusinessCode: null,
            activeBusinessId: null,
            data: sessionData,
          });
        }

        return handleFlow(customerId, command);
      }
    }

    if (action.type === 'SET_KYC_NAME') {
      const name = action.payload?.name as string;
      if (name) {
        await updateSession(customerId, {
          state: SessionState.KYC_EMAIL,
          data: { name },
        });
        return;
      }
    }

    if (action.type === 'SET_KYC_EMAIL') {
      const email = action.payload?.email as string;
      const nextCommand = action.payload?.next_command as string | undefined;
      if (email) {
        const currentSession = await getSession(customerId);
        const name = ((currentSession.data as Prisma.JsonObject) ?? {}).name as string;
        await updateSession(customerId, {
          state: SessionState.INTENT_SELECTION,
          data: { name, email },
        });

        if (nextCommand) {
          return handleFlow(customerId, nextCommand);
        }

        await sendMainMenu(customerId, 'Please select an option below:');
        return;
      }
    }
  }
}
