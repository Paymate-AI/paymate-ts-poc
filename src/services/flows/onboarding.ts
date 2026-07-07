import { SessionState, Prisma } from '@/generated/prisma/client.js';
import { getSession, updateSession, createBusiness } from '@/services/db.js';
import { sendText } from '@/services/whatsapp.js';

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
