import { SessionState, Prisma } from '@/generated/prisma/client.js';
import {
  getSession,
  updateSession,
  getBusinessByCode,
  getBusinessByOwner,
  appendMessage,
  createCatalogItem,
  getCatalogItems,
  deleteCatalogItem,
  deleteBusinessByOwner,
} from '@/services/db.js';
import { sendText, sendButtons } from '@/services/whatsapp.js';
import { sendMainMenu } from '@/services/flows/menu.js';
import { handleCustomerBrowsing } from '@/services/flows/customer-browsing.js';

export async function handleIntentSelection(customerId: string, text: string): Promise<void> {
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

    await createCatalogItem({
      businessId: business.id,
      name: sessionData.pendingItemName as string,
      price,
    });

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
    await deleteCatalogItem(itemId);

    const restData = { ...sessionData };
    delete restData.catalogState;
    delete restData.itemsList;
    await updateSession(customerId, { data: restData });

    await sendText(customerId, `🗑️ Item has been removed from your catalog.`);
    await sendMainMenu(customerId, 'What would you like to do next?');
    return;
  }

  if (catalogState === 'DELETE_BUSINESS_CONFIRM') {
    const shouldDelete =
      normalizedText === 'confirm_delete_business' ||
      normalizedText === 'yes' ||
      normalizedText === 'delete' ||
      (normalizedText.includes('delete') &&
        !normalizedText.includes('cancel') &&
        !normalizedText.includes('no') &&
        !normalizedText.includes('dont') &&
        normalizedText !== 'cancel_delete_business');

    if (shouldDelete) {
      await deleteBusinessByOwner(customerId);

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
  // 1. Exact button IDs and direct typed equivalents first
  if (normalizedText === 'register_business' || normalizedText === 'register') {
    await updateSession(customerId, { state: SessionState.ONBOARDING_BUSINESS_NAME });
    await sendText(customerId, "Great! Let's set up your business. What's your business name?");
    return;
  }

  if (normalizedText === 'find_service' || normalizedText === 'find') {
    await sendText(
      customerId,
      'Please share the business link or code you received from the seller.',
    );
    return;
  }

  if (normalizedText === 'add_item' || normalizedText === 'add item') {
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

  if (normalizedText === 'manage_catalog' || normalizedText === 'manage catalog') {
    const business = await getBusinessByOwner(customerId);
    if (!business) {
      await sendText(customerId, 'You do not have a business registered yet.');
      await sendMainMenu(customerId, 'Please select an option below:');
      return;
    }

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

  // 2. Loose fallback/includes checks for free text (excluding button IDs)
  const isButtonId = [
    'register_business',
    'find_service',
    'manage_catalog',
    'delete_business',
    'add_item',
    'remove_item',
    'view_catalog',
    'main_menu',
  ].includes(normalizedText);

  if (!isButtonId) {
    if (normalizedText.includes('register')) {
      await updateSession(customerId, { state: SessionState.ONBOARDING_BUSINESS_NAME });
      await sendText(customerId, "Great! Let's set up your business. What's your business name?");
      return;
    }

    if (normalizedText.includes('find')) {
      await sendText(
        customerId,
        'Please share the business link or code you received from the seller.',
      );
      return;
    }

    if (normalizedText.includes('catalog')) {
      const business = await getBusinessByOwner(customerId);
      if (!business) {
        await sendText(customerId, 'You do not have a business registered yet.');
        await sendMainMenu(customerId, 'Please select an option below:');
        return;
      }

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
  }

  // 3. Fallback — if there's an active business context (or the user owns a business), route free text to the AI bot
  if (!isButtonId && text.trim().length > 0) {
    let targetBusinessId = session.activeBusinessId;

    if (!targetBusinessId) {
      const ownedBusiness = await getBusinessByOwner(customerId);
      if (ownedBusiness) {
        targetBusinessId = ownedBusiness.id;
        // Update session so they transition to browsing mode
        await updateSession(customerId, {
          state: SessionState.CUSTOMER_BROWSING,
          activeBusinessId: ownedBusiness.id,
          activeBusinessCode: ownedBusiness.uniqueCode,
        });
      }
    }

    // Fallback: call the AI concierge bot (businessId = null) for general assistance.
    // This keeps the user in INTENT_SELECTION state, allowing them to type naturally or click buttons anytime.
    return handleCustomerBrowsing(customerId, targetBusinessId, text);
  }

  await sendMainMenu(customerId, 'Please select an option:');
}
