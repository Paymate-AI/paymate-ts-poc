import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, SessionState, MessageRole, Prisma } from '../generated/prisma/client.js';
import { Message } from '../types/index.js';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 20000,
});

const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({ adapter });

setInterval(
  async () => {
    await prisma.$queryRaw`SELECT 1`;
  },
  3 * 60 * 1000,
); // ping every 3 minutes

export default prisma;

async function withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isConnErr =
        err instanceof Error &&
        (err.message.includes('Connection terminated') || err.message.includes('timeout'));
      if (!isConnErr || attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw new Error('unreachable');
}

// ── Sessions ──────────────────────────────────────────────

export async function getSession(customerWhatsappId: string) {
  return withRetry(() =>
    prisma.customerSession.upsert({
      where: { customerWhatsappId },
      update: {},
      create: { customerWhatsappId, state: SessionState.IDLE, data: {} },
    }),
  );
}

export async function updateSession(
  customerWhatsappId: string,
  updates: {
    activeBusinessCode?: string | null;
    activeBusinessId?: string | null;
    state?: SessionState;
    data?: Prisma.InputJsonValue;
  },
) {
  return withRetry(() =>
    prisma.customerSession.upsert({
      where: { customerWhatsappId },
      update: updates,
      create: { customerWhatsappId, ...updates },
    }),
  );
}

// ── Conversation History ──────────────────────────────────

export async function getConversationHistory(
  customerWhatsappId: string,
  limit = 20,
): Promise<Message[]> {
  const messages = await withRetry(() =>
    prisma.conversationMessage.findMany({
      where: { customerWhatsappId },
      orderBy: { createdAt: 'asc' },
      take: limit,
    }),
  );

  return messages.map((m) => ({
    role: m.role === MessageRole.user ? 'user' : 'assistant',
    content: m.content,
  }));
}

export async function appendMessage(
  customerWhatsappId: string,
  role: 'user' | 'assistant',
  content: string,
) {
  return withRetry(() =>
    prisma.conversationMessage.create({
      data: {
        customerWhatsappId,
        role: role === 'user' ? MessageRole.user : MessageRole.assistant,
        content,
      },
    }),
  );
}

export async function createBusiness(data: {
  ownerWhatsappId: string;
  businessName: string;
  uniqueCode: string;
  ownerName: string;
  email: string;
}) {
  return withRetry(() => prisma.business.create({ data }));
}
