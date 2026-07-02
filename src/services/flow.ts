import { SessionState, Prisma } from '../generated/prisma/client.js';
import {
  getSession,
  updateSession,
  getBusinessByCode,
  getConversationHistory,
  appendMessage,
  createBusiness,
  getBusinessByOwner,
  createCatalogItem,
  getCatalogItems,
  deleteCatalogItem,
  deleteBusinessByOwner,
} from './db.js';
import { sendText, sendButtons } from './whatsapp.js';
import { callAI } from './python-bridge.js';

async function sendMainMenu(customerId: string, greetingText: string): Promise<void> {
  const business = await getBusinessByOwner(customerId);

  if (business) {
    await sendButtons(customerId, greetingText, [
      { id: 'manage_catalog', title: 'Manage Catalog' },
      { id: 'delete_business', title: 'Delete Business' },
      { id: 'find_service', title: 'Find a Service' },
    ]);
  } else {
    await sendButtons(customerId, greetingText, [
      { id: 'register_business', title: 'Register a Business' },
      { id: 'find_service', title: 'Find a Service' },
    ]);
  }
}

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
      return handleCustomerBrowsing(customerId, text);

    default:
      await sendText(customerId, "Sorry, I didn't understand that. Please try again.");
  }
}

// ── Handlers ──────────────────────────────────────────────

async function handleIdle(customerId: string, _text: string): Promise<void> {
  // Check if message is a business code
  // (we'll wire this up when we build customer routing)

  // Fresh user — start KYC
  await updateSession(customerId, { state: SessionState.KYC_NAME });
  await sendText(
    customerId,
    "👋 Welcome to PayMate! I help you buy and sell goods via WhatsApp.\n\nFirst, let's get you set up. What's your full name?",
  );
}

async function handleKycName(customerId: string, text: string): Promise<void> {
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

async function handleKycEmail(customerId: string, text: string): Promise<void> {
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

async function handleIntentSelection(customerId: string, text: string): Promise<void> {
  const normalizedText = text.trim().toLowerCase();
  const session = await getSession(customerId);
  const sessionData = (session.data as Prisma.JsonObject) ?? {};
  const catalogState = sessionData.catalogState as string | undefined;

  // 1. Handle Active Catalog/Deletion Sub-states
  if (catalogState === 'ADD_ITEM_NAME') {
    const itemName = text.trim();
    if (itemName.length < 2) {
      await sendText(customerId, 'Please enter a valid item name (at least 2 characters).');
      return;
    }

    // Move to next step: price
    await updateSession(customerId, {
      data: {
        ...sessionData,
        catalogState: 'ADD_ITEM_PRICE',
        pendingItemName: itemName,
      },
    });

    await sendText(
      customerId,
      `Got it: *${itemName}*.\nWhat is the price of this item? (numbers only, e.g. 500 or 1500.50)`,
    );
    return;
  }

  if (catalogState === 'ADD_ITEM_PRICE') {
    const price = parseFloat(text.trim());
    if (isNaN(price) || price <= 0) {
      await sendText(
        customerId,
        'Invalid price. Please enter a valid number greater than 0 (e.g. 750).',
      );
      return;
    }

    const business = await getBusinessByOwner(customerId);
    if (!business) {
      // Safety check: reset sub-state if business was deleted in the interim
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

    // Save item
    await createCatalogItem({
      businessId: business.id,
      name: sessionData.pendingItemName as string,
      price,
    });

    // Clear substate
    const restData = { ...sessionData };
    delete restData.catalogState;
    delete restData.pendingItemName;
    await updateSession(customerId, { data: restData });

    await sendText(
      customerId,
      `✅ *${sessionData.pendingItemName}* has been added to your catalog at *NGN ${price}*!`,
    );
    await sendMainMenu(customerId, 'What would you like to do next?');
    return;
  }

  if (catalogState === 'REMOVE_ITEM') {
    if (normalizedText === 'cancel') {
      const restData = { ...sessionData };
      delete restData.catalogState;
      delete restData.itemsList;
      await updateSession(customerId, { data: restData });
      await sendMainMenu(customerId, 'Action cancelled. What would you like to do?');
      return;
    }

    const index = parseInt(text.trim(), 10);
    const itemsList = sessionData.itemsList as string[] | undefined;

    if (!itemsList || isNaN(index) || index < 1 || index > itemsList.length) {
      await sendText(
        customerId,
        `Invalid selection. Please enter a number between 1 and ${itemsList?.length || 0}, or type *'cancel'*.`,
      );
      return;
    }

    const itemId = itemsList[index - 1];

    // Delete item
    await deleteCatalogItem(itemId);

    // Clear substate
    const restData = { ...sessionData };
    delete restData.catalogState;
    delete restData.itemsList;
    await updateSession(customerId, { data: restData });

    await sendText(customerId, `🗑️ Item has been removed from your catalog.`);
    await sendMainMenu(customerId, 'What would you like to do next?');
    return;
  }

  if (catalogState === 'DELETE_BUSINESS_CONFIRM') {
    if (
      normalizedText === 'confirm_delete_business' ||
      normalizedText === 'yes' ||
      normalizedText.includes('delete') ||
      normalizedText.includes('yes')
    ) {
      // Perform delete
      await deleteBusinessByOwner(customerId);

      // Clear state and business variables
      const restData = { ...sessionData };
      delete restData.catalogState;
      await updateSession(customerId, {
        activeBusinessCode: null,
        activeBusinessId: null,
        data: restData,
      });

      await sendText(
        customerId,
        `🗑️ Your business and all associated catalog items/transactions have been deleted.`,
      );
      await sendMainMenu(customerId, "Let's get started again. What would you like to do?");
      return;
    }

    // Cancel deletion
    const restData = { ...sessionData };
    delete restData.catalogState;
    await updateSession(customerId, { data: restData });
    await sendText(customerId, 'Deletion cancelled. Your business remains intact.');
    await sendMainMenu(customerId, 'What would you like to do next?');
    return;
  }

  // 2. Handle standard menu options and business codes

  // Try to find a business with this code first
  const businessByCode = await getBusinessByCode(normalizedText);
  if (businessByCode) {
    await updateSession(customerId, {
      state: SessionState.CUSTOMER_BROWSING,
      activeBusinessCode: businessByCode.uniqueCode,
      activeBusinessId: businessByCode.id,
    });

    const welcomeMsg = `Welcome to *${businessByCode.businessName}*! 🛍️\n\nHow can we help you today?`;
    await sendText(customerId, welcomeMsg);
    await appendMessage(customerId, 'assistant', welcomeMsg);
    return;
  }

  // Handle Menu Buttons
  if (normalizedText === 'register_business' || normalizedText.includes('register')) {
    await updateSession(customerId, { state: SessionState.ONBOARDING_BUSINESS_NAME });
    await sendText(customerId, "Great! Let's set up your business. What's your business name?");
    return;
  }

  if (normalizedText === 'find_service' || normalizedText.includes('find')) {
    await sendText(
      customerId,
      'Please share the business link or code you received from the seller.',
    );
    return;
  }

  if (normalizedText === 'manage_catalog' || normalizedText.includes('catalog')) {
    const business = await getBusinessByOwner(customerId);
    if (!business) {
      await sendText(customerId, 'You do not have a business registered yet.');
      await sendMainMenu(customerId, 'Please select an option below:');
      return;
    }

    // Show catalog sub-menu
    await sendButtons(
      customerId,
      `*Manage Catalog* for *${business.businessName}*:\nSelect an option below:`,
      [
        { id: 'add_item', title: 'Add Item' },
        { id: 'remove_item', title: 'Remove Item' },
        { id: 'view_catalog', title: 'View Catalog' },
      ],
    );
    return;
  }

  if (normalizedText === 'add_item' || normalizedText === 'add item') {
    // Start add item flow
    await updateSession(customerId, {
      data: {
        ...sessionData,
        catalogState: 'ADD_ITEM_NAME',
      },
    });
    await sendText(customerId, 'Please enter the name of the new item:');
    return;
  }

  if (normalizedText === 'remove_item' || normalizedText === 'remove item') {
    const business = await getBusinessByOwner(customerId);
    if (!business) {
      await sendText(customerId, 'You do not have a business registered yet.');
      await sendMainMenu(customerId, 'Please select an option below:');
      return;
    }

    const items = await getCatalogItems(business.id);
    if (items.length === 0) {
      await sendText(customerId, 'Your catalog is currently empty! Try adding an item first.');
      await sendButtons(customerId, 'Select an option below:', [
        { id: 'add_item', title: 'Add Item' },
        { id: 'view_catalog', title: 'View Catalog' },
      ]);
      return;
    }

    const itemsList = items.map((item) => item.id);
    await updateSession(customerId, {
      data: {
        ...sessionData,
        catalogState: 'REMOVE_ITEM',
        itemsList,
      },
    });

    const itemsMsg = items
      .map((item, idx) => `${idx + 1}. *${item.name}* (NGN ${item.price})`)
      .join('\n');

    await sendText(
      customerId,
      `Please reply with the number of the item you want to remove:\n\n${itemsMsg}\n\nType *'cancel'* to go back.`,
    );
    return;
  }

  if (normalizedText === 'view_catalog' || normalizedText === 'view catalog') {
    const business = await getBusinessByOwner(customerId);
    if (!business) {
      await sendText(customerId, 'You do not have a business registered yet.');
      await sendMainMenu(customerId, 'Please select an option below:');
      return;
    }

    const items = await getCatalogItems(business.id);
    if (items.length === 0) {
      await sendText(customerId, 'Your catalog is empty! 🛍️');
    } else {
      const catalogText = items.map((item) => `- *${item.name}*: NGN ${item.price}`).join('\n');
      await sendText(customerId, `*${business.businessName} Catalog*:\n\n${catalogText}`);
    }

    await sendButtons(customerId, 'Select an option below:', [
      { id: 'add_item', title: 'Add Item' },
      { id: 'remove_item', title: 'Remove Item' },
      { id: 'main_menu', title: 'Main Menu' },
    ]);
    return;
  }

  if (normalizedText === 'delete_business' || normalizedText === 'delete business') {
    await updateSession(customerId, {
      data: {
        ...sessionData,
        catalogState: 'DELETE_BUSINESS_CONFIRM',
      },
    });

    await sendButtons(
      customerId,
      `⚠️ *Are you sure you want to delete your business?*\n\nThis will permanently delete all catalog items and transactions associated with it. This action cannot be undone.`,
      [
        { id: 'confirm_delete_business', title: 'Yes, Delete' },
        { id: 'cancel_delete_business', title: 'No, Cancel' },
      ],
    );
    return;
  }

  if (normalizedText === 'main_menu' || normalizedText === 'main menu') {
    await sendMainMenu(customerId, 'Main Menu:');
    return;
  }

  // Fallback / Typo handling
  const isButtonPayload = [
    'register_business',
    'find_service',
    'manage_catalog',
    'delete_business',
    'add_item',
    'remove_item',
    'view_catalog',
    'main_menu',
  ].includes(normalizedText);

  if (!isButtonPayload && text.trim().length > 0) {
    await sendText(
      customerId,
      `Sorry, I didn't recognize that option. Please choose one of the menu options below:`,
    );
  }

  await sendMainMenu(customerId, 'Please select an option:');
}

async function handleOnboardingBusinessName(customerId: string, text: string): Promise<void> {
  const businessName = text.trim();
  if (businessName.length < 2) {
    await sendText(customerId, 'Please enter a valid business name.');
    return;
  }

  const session = await getSession(customerId);
  const data = session.data as Prisma.JsonObject;

  // Generate unique code from business name
  const uniqueCode = businessName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 12);

  // Save business to DB
  await createBusiness({
    ownerWhatsappId: customerId,
    businessName,
    uniqueCode,
    ownerName: data.name as string,
    email: data.email as string,
  });

  await updateSession(customerId, {
    state: SessionState.ONBOARDING_COMPLETE,
    activeBusinessCode: uniqueCode,
  });

  const botNumber = process.env.WHATSAPP_BOT_NUMBER;
  await sendText(
    customerId,
    `🎊 Your business *${businessName}* is live!\n\nYour unique link:\nwa.me/${botNumber}?text=${uniqueCode}\n\nShare this with your customers. They'll be connected to your store automatically.`,
  );
}

async function handleCustomerBrowsing(customerId: string, text: string): Promise<void> {
  const history = await getConversationHistory(customerId);
  const aiResponse = await callAI(customerId, text, history);

  await sendText(customerId, aiResponse.reply);
  await appendMessage(customerId, 'assistant', aiResponse.reply);
}
