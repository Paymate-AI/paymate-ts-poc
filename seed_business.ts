import prisma from './src/services/db.js';

async function seedBusiness() {
  const phoneNumber = '2347064613220';
  const businessName = 'Quick Feets';
  const uniqueCode = 'quickfeets';
  const ownerName = 'Divine';
  const email = 'kamcyahaka@gmail.com';
  const service = 'Retail';

  console.log(`Pre-filling database for user ${phoneNumber}...`);

  try {
    // 1. Clean up existing business and sessions if any
    const existingBusiness = await prisma.business.findUnique({
      where: { ownerWhatsappId: phoneNumber },
    });

    if (existingBusiness) {
      await prisma.catalogItem.deleteMany({
        where: { businessId: existingBusiness.id },
      });
      await prisma.business.delete({
        where: { id: existingBusiness.id },
      });
      console.log('Cleared existing business and items.');
    }

    // 2. Create the business
    const business = await prisma.business.create({
      data: {
        ownerWhatsappId: phoneNumber,
        businessName,
        uniqueCode,
        ownerName,
        email,
        service,
      },
    });
    console.log(`Created business: ${business.businessName} (Code: ${business.uniqueCode})`);

    // 3. Create catalog items
    const items = [
      { name: 'Air Jordan 1 Retro', price: 45000, quantity: 15 },
      { name: 'Nike Air Max 90', price: 38000, quantity: 10 },
      { name: 'Adidas Yeezy Boost 350', price: 65000, quantity: 8 },
      { name: 'Nike Predator Edge', price: 55000, quantity: 12 },
      { name: 'Puma Suede Classic', price: 28000, quantity: 20 },
    ];

    for (const item of items) {
      const createdItem = await prisma.catalogItem.create({
        data: {
          businessId: business.id,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
        },
      });
      console.log(`Added catalog item: ${createdItem.name} at NGN ${createdItem.price}`);
    }

    // 4. Create or update session for the user
    await prisma.customerSession.upsert({
      where: { customerWhatsappId: phoneNumber },
      update: {
        state: 'INTENT_SELECTION',
        activeBusinessCode: null,
        activeBusinessId: null,
        data: { name: ownerName, email },
      },
      create: {
        customerWhatsappId: phoneNumber,
        state: 'INTENT_SELECTION',
        activeBusinessCode: null,
        activeBusinessId: null,
        data: { name: ownerName, email },
      },
    });
    console.log('Set session state to INTENT_SELECTION with user onboarded data.');

    console.log('\nDatabase pre-fill completed successfully! 🎉');
  } catch (error) {
    console.error('Error pre-filling database:', error);
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
}

seedBusiness();
