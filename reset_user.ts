import prisma from './src/services/db.js';

async function resetUser(phoneNumber: string) {
  if (!phoneNumber) {
    console.error('Please provide a phone number. Example: bun run reset_user.ts 2347064613220');
    process.exit(1);
  }

  console.log(`Starting database reset for user: ${phoneNumber}...`);

  try {
    // 1. Delete conversation messages
    const msgDel = await prisma.conversationMessage.deleteMany({
      where: { customerWhatsappId: phoneNumber },
    });
    console.log(`Deleted ${msgDel.count} conversation messages.`);

    // 2. Delete customer session
    const sessionDel = await prisma.customerSession.deleteMany({
      where: { customerWhatsappId: phoneNumber },
    });
    console.log(`Deleted ${sessionDel.count} sessions.`);

    // 3. Delete transactions
    const txDel = await prisma.transaction.deleteMany({
      where: {
        OR: [{ customerWhatsappId: phoneNumber }, { ownerWhatsappId: phoneNumber }],
      },
    });
    console.log(`Deleted ${txDel.count} transactions.`);

    // 4. Find the business owned by this user to delete its catalog items
    const business = await prisma.business.findUnique({
      where: { ownerWhatsappId: phoneNumber },
    });

    if (business) {
      const itemsDel = await prisma.catalogItem.deleteMany({
        where: { businessId: business.id },
      });
      console.log(`Deleted ${itemsDel.count} catalog items for business ${business.businessName}.`);

      const bizDel = await prisma.business.delete({
        where: { id: business.id },
      });
      console.log(`Deleted business: ${bizDel.businessName}.`);
    } else {
      console.log('No registered business found for this number.');
    }

    console.log(
      `\nSuccessfully reset database records for ${phoneNumber}! You can now start with a clean slate.`,
    );
  } catch (error) {
    console.error('Error resetting user database records:', error);
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
}

const targetNumber = process.argv[2];
resetUser(targetNumber);
