import { SessionState, Prisma } from '@/generated/prisma/client.js';
import { getSession, updateSession, createBusiness } from '@/services/db.js';
import { sendText, sendButtons } from '@/services/whatsapp.js';

export async function handleOnboardingBusinessName(
  customerId: string,
  text: string,
): Promise<void> {
  const businessName = text.trim();
  if (businessName.length < 2) {
    await sendText(customerId, 'Please enter a valid business name.');
    return;
  }

  const session = await getSession(customerId);
  const sessionData = (session.data as Prisma.JsonObject) ?? {};

  // Store the name in the session data and ask for business service type
  await updateSession(customerId, {
    state: SessionState.ONBOARDING_BUSINESS_SERVICE,
    data: {
      ...sessionData,
      pendingBusinessName: businessName,
    },
  });

  await sendButtons(customerId, `Great! What type of business or service is *${businessName}*?`, [
    { id: 'Retail', title: 'Retail (Goods/Products)' },
    { id: 'Services', title: 'Services (Non-physical)' },
  ]);
}

export async function handleOnboardingBusinessService(
  customerId: string,
  text: string,
): Promise<void> {
  const choice = text.trim().toLowerCase();

  const service =
    choice === 'services' || choice === 'service' || choice === 'services (non-physical)'
      ? 'Services'
      : choice === 'retail' || choice === 'retail (goods/products)'
        ? 'Retail'
        : text.trim() || 'Retail';

  const session = await getSession(customerId);
  const sessionData = (session.data as Prisma.JsonObject) ?? {};
  const businessName = sessionData.pendingBusinessName as string;

  if (!businessName) {
    await updateSession(customerId, {
      state: SessionState.ONBOARDING_BUSINESS_NAME,
    });
    await sendText(customerId, "Something went wrong. Let's restart. What's your business name?");
    return;
  }

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
    ownerName: sessionData.name as string,
    email: sessionData.email as string,
    service,
  });

  const cleanData = { ...sessionData };
  delete cleanData.pendingBusinessName;

  await updateSession(customerId, {
    state: SessionState.ONBOARDING_COMPLETE,
    activeBusinessCode: uniqueCode,
    data: cleanData,
  });

  const botNumber = process.env.WHATSAPP_BOT_NUMBER;
  await sendText(
    customerId,
    `🎊 Your business *${businessName}* is live!\n\nYour unique link:\nwa.me/${botNumber}?text=${uniqueCode}\n\nShare this with your customers. They'll be connected to your store automatically.`,
  );
}
