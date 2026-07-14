import { SessionState, Prisma } from '@/generated/prisma/client.js';
import prisma, {
  getSession,
  updateSession,
  getBusinessByCode,
  getBusinessByOwner,
  createCatalogItem,
} from '@/services/db.js';
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
        const lowerCmd = command.trim().toLowerCase();

        // Silently transition state — the bot already communicated with the user.
        // Do NOT call handleFlow here (which would trigger a second text message).
        if (lowerCmd === 'register_business' || lowerCmd === 'register') {
          await updateSession(customerId, {
            state: SessionState.ONBOARDING_BUSINESS_NAME,
            activeBusinessCode: null,
            activeBusinessId: null,
          });
          // Bot said "I'm starting the process" but didn't ask for the name — prompt it here.
          await sendText(customerId, 'What is the name of your business?');
          return;
        }

        if (lowerCmd === 'find_service' || lowerCmd === 'find') {
          // State stays INTENT_SELECTION; user just needs to send a business code next
          return;
        }

        if (lowerCmd === 'main_menu') {
          const currentSession = await getSession(customerId);
          const sessionData = (currentSession.data as Prisma.JsonObject) ?? {};
          await updateSession(customerId, {
            state: SessionState.INTENT_SELECTION,
            activeBusinessCode: null,
            activeBusinessId: null,
            data: sessionData,
          });
          return;
        }

        // For sub-commands (add_item, remove_item, view_catalog, manage_catalog,
        // delete_business, search_product, etc.) still delegate to handleFlow
        // so the right buttons/menus are shown.
        const currentSession = await getSession(customerId);
        const sessionData = (currentSession.data as Prisma.JsonObject) ?? {};
        await updateSession(customerId, {
          state: SessionState.INTENT_SELECTION,
          activeBusinessCode: null,
          activeBusinessId: null,
          data: sessionData,
        });
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
          if (nextCommand === 'search_product') {
            const searchQuery = action.payload?.search_query as string;
            const businessCode = action.payload?.business_code as string | null | undefined;
            return handleSearchProductAction(customerId, searchQuery, businessCode);
          }

          // register_business: silently advance state, then prompt for the business name.
          if (nextCommand === 'register_business' || nextCommand === 'register') {
            await updateSession(customerId, { state: SessionState.ONBOARDING_BUSINESS_NAME });
            await sendText(customerId, 'What is the name of your business?');
            return;
          }

          return handleFlow(customerId, nextCommand);
        }

        await sendMainMenu(customerId, 'Please select an option below:');
        return;
      }
    }

    if (action.type === 'SEARCH_PRODUCT') {
      const query = action.payload?.query as string;
      const businessCode = action.payload?.business_code as string | null | undefined;
      return handleSearchProductAction(customerId, query, businessCode);
    }

    if (action.type === 'SET_ITEM_NAME') {
      const name = action.payload?.name as string;
      if (name?.trim()) {
        const currentSession = await getSession(customerId);
        const sessionData = (currentSession.data as Prisma.JsonObject) ?? {};
        await updateSession(customerId, {
          data: {
            ...sessionData,
            catalogState: 'ADD_ITEM_PRICE',
            pendingItemName: name.trim(),
          },
        });
        // Bot already sent the confirmation reply; nothing more to do here
      }
      return;
    }

    if (action.type === 'SET_ITEM_PRICE') {
      const price = action.payload?.price as number;
      if (!price || price <= 0) return;

      const currentSession = await getSession(customerId);
      const sessionData = (currentSession.data as Prisma.JsonObject) ?? {};
      const pendingItemName = sessionData.pendingItemName as string;

      const business = await getBusinessByOwner(customerId);
      if (!business) {
        const restData = { ...sessionData };
        delete restData.catalogState;
        delete restData.pendingItemName;
        await updateSession(customerId, { data: restData });
        await sendMainMenu(
          customerId,
          "We couldn't find a business for you. What would you like to do?",
        );
        return;
      }

      const isQuantifiable = business.service === 'Retail';

      if (isQuantifiable) {
        await updateSession(customerId, {
          data: {
            ...sessionData,
            catalogState: 'ADD_ITEM_QUANTITY',
            pendingItemPrice: price,
          },
        });
        // Bot already sent the price confirmation; TS just advances the state
      } else {
        await createCatalogItem({
          businessId: business.id,
          name: pendingItemName,
          price,
          quantity: 0,
        });

        const restData = { ...sessionData };
        delete restData.catalogState;
        delete restData.pendingItemName;
        await updateSession(customerId, { data: restData });
        await sendMainMenu(customerId, 'What would you like to do next?');
      }
      return;
    }
  }

  async function handleSearchProductAction(
    customerId: string,
    query: string,
    businessCode: string | null | undefined,
  ): Promise<void> {
    const currentSession = await getSession(customerId);
    const code = businessCode || currentSession.activeBusinessCode;

    if (code) {
      const business = await getBusinessByCode(code);
      if (business) {
        await updateSession(customerId, {
          state: SessionState.CUSTOMER_BROWSING,
          activeBusinessCode: business.uniqueCode,
          activeBusinessId: business.id,
        });
        return handleFlow(customerId, query);
      } else {
        await sendText(
          customerId,
          `We couldn't find a store with the code "${code}". Please check the code and try again.`,
        );
        await sendMainMenu(customerId, 'What would you like to do next?');
      }
    } else {
      // If no store code is specified, try to search globally across all businesses
      try {
        const trimmedQuery = query?.trim();
        if (trimmedQuery) {
          const matchingItems = await prisma.catalogItem.findMany({
            where: {
              name: {
                contains: trimmedQuery,
                mode: 'insensitive',
              },
            },
            include: {
              business: true,
            },
          });

          if (matchingItems.length > 0) {
            const uniqueBusinesses = Array.from(
              new Map(matchingItems.map((item) => [item.business.id, item.business])).values(),
            );

            if (uniqueBusinesses.length === 1) {
              const business = uniqueBusinesses[0];
              await updateSession(customerId, {
                state: SessionState.CUSTOMER_BROWSING,
                activeBusinessCode: business.uniqueCode,
                activeBusinessId: business.id,
              });
              return handleFlow(customerId, query);
            } else {
              const businessListText = uniqueBusinesses
                .map((b, idx) => `${idx + 1}. *${b.businessName}* (Code: ${b.uniqueCode})`)
                .join('\n');
              await sendText(
                customerId,
                `I found matching products in multiple stores:\n\n${businessListText}\n\nPlease enter the store code of the store you want to browse.`,
              );
              await sendMainMenu(customerId, 'What would you like to do?');
              return;
            }
          }
        }

        // Fallback: If no query/matches, check if there is exactly one business in the DB
        const allBusinesses = await prisma.business.findMany();
        if (allBusinesses.length === 1) {
          const business = allBusinesses[0];
          await updateSession(customerId, {
            state: SessionState.CUSTOMER_BROWSING,
            activeBusinessCode: business.uniqueCode,
            activeBusinessId: business.id,
          });
          return handleFlow(customerId, query || 'view_catalog');
        }
      } catch (err) {
        console.error('Error performing global product search fallback:', err);
      }

      await sendText(
        customerId,
        "Please specify which store you want to browse by typing its store code (e.g., 'mamatopekitchen').",
      );
      await sendMainMenu(customerId, 'Please select an option below:');
    }
  }
}
