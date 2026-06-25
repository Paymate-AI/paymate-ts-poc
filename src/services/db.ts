import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, SessionState, MessageRole } from '../generated/prisma/client.js';
import { Message } from '../types/index.js';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({ adapter });

export default prisma;

// ── Sessions ──────────────────────────────────────────────

export async function getSession(customerWhatsappId: string) {
  return prisma.customerSession.upsert({
    where: { customerWhatsappId },
    update: {},
    create: {
      customerWhatsappId,
      state: SessionState.IDLE,
      data: {},
    },
  });
}

export async function updateSession(
  customerWhatsappId: string,
  updates: {
    activeBusinessCode?: string | null;
    activeBusinessId?: string | null;
    state?: SessionState;
    data?: Record<string, any>;
  }
) {
  return prisma.customerSession.upsert({
    where: { customerWhatsappId },
    update: updates,
    create: { customerWhatsappId, ...updates },
  });
}

// ── Conversation History ──────────────────────────────────

export async function getConversationHistory(
  customerWhatsappId: string,
  limit = 20
): Promise<Message[]> {
  const messages = await prisma.conversationMessage.findMany({
    where: { customerWhatsappId },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });

  return messages.map((m) => ({
    role: m.role === MessageRole.user ? 'user' : 'assistant',
    content: m.content,
  }));
}

export async function appendMessage(
  customerWhatsappId: string,
  role: 'user' | 'assistant',
  content: string
) {
  return prisma.conversationMessage.create({
    data: {
      customerWhatsappId,
      role: role === 'user' ? MessageRole.user : MessageRole.assistant,
      content,
    },
  });
}
