import { SessionState } from '../generated/prisma/client.js';
import { getSession, updateSession } from './db.js';
import { sendText, sendButtons } from './whatsapp.js';

export async function handleFlow(customerId: string, text: string): Promise<void> {
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

    default:
      await sendText(customerId, "Sorry, I didn't understand that. Please try again.");
  }
}

// ── Handlers ──────────────────────────────────────────────

async function handleIdle(customerId: string, text: string): Promise<void> {
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
  const name = (session.data as Record<string, unknown>).name as string;

  await updateSession(customerId, {
    state: SessionState.INTENT_SELECTION,
    data: { name, email },
  });

  await sendButtons(customerId, `All set, ${name}! 🎉 What would you like to do?`, [
    { id: 'register_business', title: 'Register a Business' },
    { id: 'find_service', title: 'Find a Service' },
  ]);
}

async function handleIntentSelection(customerId: string, text: string): Promise<void> {
  if (text === 'register_business' || text.toLowerCase().includes('register')) {
    await updateSession(customerId, { state: SessionState.ONBOARDING_BUSINESS_NAME });
    await sendText(customerId, "Great! Let's set up your business. What's your business name?");
    return;
  }

  if (text === 'find_service' || text.toLowerCase().includes('find')) {
    await sendText(
      customerId,
      'Please share the business link or code you received from the seller.',
    );
    return;
  }

  await sendButtons(customerId, 'Please choose one of the options below:', [
    { id: 'register_business', title: 'Register a Business' },
    { id: 'find_service', title: 'Find a Service' },
  ]);
}

async function handleOnboardingBusinessName(customerId: string, text: string): Promise<void> {
  const businessName = text.trim();
  if (businessName.length < 2) {
    await sendText(customerId, 'Please enter a valid business name.');
    return;
  }

  const session = await getSession(customerId);
  const data = session.data as Record<string, unknown>;

  // Generate unique code from business name
  const uniqueCode = businessName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 12);

  // Save business to DB
  const { createBusiness } = await import('./db.js');
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

  const botNumber = process.env.WHATSAPP_PHONE_NUMBER_ID;
  await sendText(
    customerId,
    `🎊 Your business *${businessName}* is live!\n\nYour unique link:\nwa.me/${botNumber}?text=${uniqueCode}\n\nShare this with your customers. They'll be connected to your store automatically.`,
  );
}
