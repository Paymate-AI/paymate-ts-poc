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
import { AIResponse } from '@/types/index.js';

export async function handleIntentSelection(
  customerId: string,
  text: string,
): Promise<AIResponse['action'] | null | void> {
  const normalizedText = text.trim().toLowerCase();
  const session = await getSession(customerId);
  const sessionData = (session.data as Prisma.JsonObject) ?? {};
  const catalogState = sessionData.catalogState as string | undefined;

  // 1. Handle Active Catalog/Deletion Sub-states

  if (catalogState === 'ADD_ITEM_NAME') {
    // Route to AI bot to extract the product name from natural language
    return handleCustomerBrowsing(customerId, null, text, 'ADD_ITEM_NAME');
  }

  if (catalogState === 'ADD_ITEM_PRICE') {
    // Route to AI bot to extract the price from natural language
    return handleCustomerBrowsing(customerId, null, text, 'ADD_ITEM_PRICE');
  }

  if (catalogState === 'ADD_ITEM_QUANTITY') {
    const quantity = parseInt(text.trim(), 10);
    if (isNaN(quantity) || quantity < 0) {
      await sendText(customerId, 'Please enter a valid stock quantity (numbers only, e.g. 10).');
      return;
    }

    const business = await getBusinessByOwner(customerId);
    if (!business) {
      const restData = { ...sessionData };
      delete restData.catalogState;
      delete restData.pendingItemName;
      delete restData.pendingItemPrice;
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
      price: sessionData.pendingItemPrice as number,
      quantity,
    });

    const restData = { ...sessionData };
    delete restData.catalogState;
    delete restData.pendingItemName;
    delete restData.pendingItemPrice;
    await updateSession(customerId, { data: restData });

    await sendText(
      customerId,
      `✅ *${sessionData.pendingItemName}* has been added to your catalog at *NGN ${sessionData.pendingItemPrice}* with stock *${quantity}*!`,
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
      const isQuantifiable = business.service === 'Retail';
      const catalogText = items
        .map((item) => {
          if (isQuantifiable) {
            return `- *${item.name}*: NGN ${item.price} (Stock: ${item.quantity})`;
          }
          return `- *${item.name}*: NGN ${item.price}`;
        })
        .join('\n');
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

  // 3. Fallback — route free text to the AI bot with current session state.
  // If not currently browsing a business, pass null for businessId so they stay in INTENT_SELECTION state.
  if (text.trim().length > 0) {
    const targetBusinessId = session.activeBusinessId || null;
    return handleCustomerBrowsing(customerId, targetBusinessId, text);
  }

  await sendMainMenu(customerId, 'Please select an option:');
}
