import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import prisma, { getConversationHistory } from '@/services/db.js';

interface RawBusiness {
  id: string;
  name: string;
  phone: string;
  service: string;
  state: string;
  city: string;
  address: string;
}

interface RawProduct {
  id: number;
  name: string;
  price: number;
  stock_quantity: number;
  description?: string;
}

interface RawOrder {
  id: number;
  business_id: string;
  customer_name: string;
  total_amount: number;
  status: string;
}

interface RawPayment {
  id: number;
  order_id: number;
  amount: number;
  reference: string;
  virtual_account: string;
  bank_name: string;
  transaction_id: string;
  status: string;
}

export async function chatsRoutes(app: FastifyInstance) {
  // Global hook for internal routes authentication
  app.addHook('preHandler', async (request, reply) => {
    const authHeader = request.headers['authorization'];
    const expected = `Bearer ${process.env.INTERNAL_SECRET}`;

    if (authHeader !== expected) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  app.get('/chats/:businessId/:customerId/recent', async (request, reply) => {
    const { customerId } = request.params as { businessId: string; customerId: string };
    const messages = await getConversationHistory(customerId);
    return reply.send(messages);
  });

  // GET /internal/business/:id
  app.get('/internal/business/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const business = await prisma.business.findFirst({
      where: {
        OR: [{ id }, { uniqueCode: id }],
      },
    });

    if (business) {
      return reply.send({
        id: business.id,
        name: business.businessName,
        uniqueCode: business.uniqueCode,
        ownerWhatsappId: business.ownerWhatsappId,
        ownerName: business.ownerName,
        email: business.email,
        service: business.service,
        state: 'Lagos',
        city: 'Lagos',
        address: 'HQ',
        phone: business.ownerWhatsappId,
      });
    }

    return reply.code(404).send({ error: 'Business not found' });
  });

  // GET /internal/business/:id/products
  app.get('/internal/business/:id/products', async (request, reply) => {
    const { id } = request.params as { id: string };
    const name = (request.query as { name?: string }).name || '';

    const business = await prisma.business.findFirst({
      where: {
        OR: [{ id }, { uniqueCode: id }],
      },
    });

    if (business) {
      const items = await prisma.catalogItem.findMany({
        where: {
          businessId: business.id,
          name: {
            contains: name,
            mode: 'insensitive',
          },
        },
      });
      return reply.send(
        items.map((item: { id: string; name: string; price: number; quantity: number }) => ({
          id: item.id,
          name: item.name,
          price: item.price,
          stock_quantity: item.quantity,
        })),
      );
    }

    return reply.send([]);
  });

  // POST /internal/orders
  app.post('/internal/orders', async (request, reply) => {
    const { business_id, customer_name, items } = request.body as {
      business_id: string;
      customer_name: string;
      items: { product_id: string; quantity: number }[];
    };

    let totalAmount = 0;
    const resolvedItems = [];

    // Lookup the business to check if quantifiable
    const businessObj = await prisma.business.findFirst({
      where: {
        OR: [{ id: business_id }, { uniqueCode: business_id }],
      },
    });

    let serviceType = 'Retail';
    if (businessObj) {
      serviceType = businessObj.service;
    } else {
      // Fallback search in SQL table
      try {
        const rawBiz = await prisma.$queryRawUnsafe<RawBusiness[]>(
          `SELECT service FROM "businesses" WHERE id = $1 OR name = $2 LIMIT 1`,
          business_id,
          business_id,
        );
        if (rawBiz.length > 0) {
          serviceType = rawBiz[0].service;
        }
      } catch (e) {
        app.log.error(e, 'Failed to lookup business service type in fallback');
      }
    }

    const isQuantifiable = serviceType === 'Retail';

    // Let's resolve the product prices and check stock quantities
    for (const item of items) {
      const catalogItem = await prisma.catalogItem.findUnique({
        where: { id: item.product_id },
      });
      if (catalogItem) {
        if (isQuantifiable && catalogItem.quantity < item.quantity) {
          return reply.code(400).send({
            error: `Insufficient stock for product ${catalogItem.name}. Available: ${catalogItem.quantity}, Requested: ${item.quantity}`,
          });
        }
        totalAmount += catalogItem.price * item.quantity;
        resolvedItems.push({
          product_id: catalogItem.id,
          name: catalogItem.name,
          price: catalogItem.price,
          quantity: item.quantity,
        });
      } else {
        const intId = parseInt(item.product_id, 10);
        if (!isNaN(intId)) {
          try {
            const rawProducts = await prisma.$queryRawUnsafe<RawProduct[]>(
              `SELECT id, name, price, stock_quantity FROM "products" WHERE id = $1 LIMIT 1`,
              intId,
            );
            if (rawProducts.length > 0) {
              const p = rawProducts[0];
              if (isQuantifiable && p.stock_quantity < item.quantity) {
                return reply.code(400).send({
                  error: `Insufficient stock for product ${p.name}. Available: ${p.stock_quantity}, Requested: ${item.quantity}`,
                });
              }
              totalAmount += p.price * item.quantity;
              resolvedItems.push({
                product_id: String(p.id),
                name: p.name,
                price: p.price,
                quantity: item.quantity,
              });
            } else {
              return reply
                .code(404)
                .send({ error: `Product with ID ${item.product_id} not found` });
            }
          } catch (e) {
            app.log.error(e, 'Resolving products via raw query failed');
            return reply.code(500).send({ error: 'Database error resolving product' });
          }
        } else {
          return reply.code(404).send({ error: `Product with ID ${item.product_id} not found` });
        }
      }
    }

    try {
      // Insert order
      const insertOrderRes = await prisma.$queryRawUnsafe<RawOrder[]>(
        `INSERT INTO "orders" (business_id, customer_name, total_amount, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'pending', NOW(), NOW()) RETURNING id`,
        business_id,
        customer_name || '',
        totalAmount,
      );

      const orderId = insertOrderRes[0].id;

      for (const resolved of resolvedItems) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "order_items" (order_id, product_id, quantity, price)
           VALUES ($1, $2, $3, $4)`,
          orderId,
          resolved.product_id,
          resolved.quantity,
          resolved.price,
        );
      }

      return reply.send({
        id: orderId,
        total_amount: totalAmount,
        customer_name: customer_name,
        status: 'pending',
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      app.log.error(e, 'Failed to create order/order items');
      return reply.code(500).send({ error: msg });
    }
  });

  // GET /internal/orders/:id
  app.get('/internal/orders/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const orderId = parseInt(id, 10);
    if (isNaN(orderId)) {
      return reply.code(400).send({ error: 'Invalid order ID' });
    }
    try {
      const rawOrders = await prisma.$queryRawUnsafe<RawOrder[]>(
        `SELECT * FROM "orders" WHERE id = $1 LIMIT 1`,
        orderId,
      );
      if (rawOrders.length === 0) {
        return reply.code(404).send({ error: 'Order not found' });
      }
      return reply.send(rawOrders[0]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.code(500).send({ error: msg });
    }
  });

  // GET /internal/payments
  app.get('/internal/payments', async (request, reply) => {
    const { order_id, reference, business_id, status } = request.query as {
      order_id?: string;
      reference?: string;
      business_id?: string;
      status?: string;
    };
    try {
      if (order_id) {
        const orderId = parseInt(order_id, 10);
        const rawPayments = await prisma.$queryRawUnsafe<RawPayment[]>(
          `SELECT * FROM "payments" WHERE order_id = $1 LIMIT 1`,
          orderId,
        );
        return reply.send(rawPayments[0] || null);
      }
      if (reference) {
        const rawPayments = await prisma.$queryRawUnsafe<RawPayment[]>(
          `SELECT * FROM "payments" WHERE reference = $1 LIMIT 1`,
          reference,
        );
        return reply.send(rawPayments[0] || null);
      }
      if (business_id && status) {
        const rawPayments = await prisma.$queryRawUnsafe<RawPayment[]>(
          `SELECT p.* FROM "payments" p
           JOIN "orders" o ON p.order_id = o.id
           WHERE o.business_id = $1 AND p.status = $2
           ORDER BY p.created_at DESC LIMIT 1`,
          business_id,
          status,
        );
        return reply.send(rawPayments[0] || null);
      }
      return reply
        .code(400)
        .send({ error: 'Missing order_id, reference, or business_id and status' });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.code(500).send({ error: msg });
    }
  });

  // POST /internal/payments
  app.post('/internal/payments', async (request, reply) => {
    const { order_id, amount, reference, virtual_account, bank_name, transaction_id } =
      request.body as {
        order_id: number;
        amount: number;
        reference: string;
        virtual_account: string;
        bank_name: string;
        transaction_id: string;
      };
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "payments" (order_id, amount, reference, virtual_account, bank_name, transaction_id, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW(), NOW())`,
        order_id,
        amount,
        reference,
        virtual_account,
        bank_name,
        transaction_id,
      );
      return reply.send({ success: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.code(500).send({ error: msg });
    }
  });

  // PATCH /internal/payments/:reference
  app.patch('/internal/payments/:reference', async (request, reply) => {
    const { reference } = request.params as { reference: string };
    const { status } = request.body as { status: string };
    try {
      await prisma.$executeRawUnsafe(
        `UPDATE "payments" SET status = $1, updated_at = NOW() WHERE reference = $2`,
        status,
        reference,
      );

      // If payment is successful, let's also update the inventory of the catalog items of the order!
      if (status === 'success' || status === 'successful') {
        const rawPayments = await prisma.$queryRawUnsafe<RawPayment[]>(
          `SELECT order_id FROM "payments" WHERE reference = $1 LIMIT 1`,
          reference,
        );
        if (rawPayments.length > 0) {
          const orderId = rawPayments[0].order_id;
          const rawOrders = await prisma.$queryRawUnsafe<RawOrder[]>(
            `SELECT business_id FROM "orders" WHERE id = $1 LIMIT 1`,
            orderId,
          );

          if (rawOrders.length > 0) {
            const businessId = rawOrders[0].business_id;
            const business = await prisma.business.findFirst({
              where: {
                OR: [{ id: businessId }, { uniqueCode: businessId }],
              },
            });

            let serviceType = 'Retail';
            if (business) {
              serviceType = business.service;
            } else {
              const rawBiz = await prisma.$queryRawUnsafe<RawBusiness[]>(
                `SELECT service FROM "businesses" WHERE id = $1 LIMIT 1`,
                businessId,
              );
              if (rawBiz.length > 0) {
                serviceType = rawBiz[0].service;
              }
            }

            if (serviceType === 'Retail') {
              const orderItems = await prisma.$queryRawUnsafe<
                { product_id: string; quantity: number }[]
              >(`SELECT product_id, quantity FROM "order_items" WHERE order_id = $1`, orderId);

              for (const item of orderItems) {
                const pId = String(item.product_id);
                if (pId.startsWith('c')) {
                  await prisma.catalogItem.update({
                    where: { id: pId },
                    data: {
                      quantity: {
                        decrement: item.quantity,
                      },
                    },
                  });
                }
              }
            }
          }
        }
      }

      return reply.send({ success: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.code(500).send({ error: msg });
    }
  });

  // POST /internal/orders/:id/status
  app.post('/internal/orders/:id/status', async (request, reply) => {
    const { id } = request.params as { id: string };
    const orderId = parseInt(id, 10);
    const { status } = request.body as { status: string };
    try {
      await prisma.$executeRawUnsafe(
        `UPDATE "orders" SET status = $1, updated_at = NOW() WHERE id = $2`,
        status,
        orderId,
      );
      return reply.send({ success: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.code(500).send({ error: msg });
    }
  });

  // POST /internal/updateCatelogItem (performs updateCatelogItem(catagoryId, quantity, action))
  // Also supports /internal/catalog-item/update for clean path
  const updateCatalogItemHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const { catagoryId, quantity, action } = request.body as {
      catagoryId: string;
      quantity: number;
      action: 'add' | 'subtract' | 'set';
    };

    if (!catagoryId || quantity === undefined || !action) {
      return reply.code(400).send({ error: 'Missing catagoryId, quantity, or action' });
    }

    try {
      const isCuid = typeof catagoryId === 'string' && catagoryId.startsWith('c');

      if (isCuid) {
        const item = await prisma.catalogItem.findUnique({
          where: { id: catagoryId },
        });

        if (!item) {
          return reply.code(404).send({ error: 'Catalog item not found' });
        }

        let newQuantity = item.quantity;
        if (action === 'add') {
          newQuantity += quantity;
        } else if (action === 'subtract') {
          newQuantity -= quantity;
        } else if (action === 'set') {
          newQuantity = quantity;
        }

        await prisma.catalogItem.update({
          where: { id: catagoryId },
          data: { quantity: newQuantity },
        });

        return reply.send({ success: true, catagoryId, newQuantity });
      } else {
        const intId = parseInt(catagoryId, 10);
        if (isNaN(intId)) {
          return reply.code(400).send({ error: 'Invalid product ID format' });
        }

        const rawProducts = await prisma.$queryRawUnsafe<{ stock_quantity: number }[]>(
          `SELECT stock_quantity FROM "products" WHERE id = $1 LIMIT 1`,
          intId,
        );

        if (rawProducts.length === 0) {
          return reply.code(404).send({ error: 'Product not found in database' });
        }

        let newQuantity = rawProducts[0].stock_quantity;
        if (action === 'add') {
          newQuantity += quantity;
        } else if (action === 'subtract') {
          newQuantity -= quantity;
        } else if (action === 'set') {
          newQuantity = quantity;
        }

        await prisma.$executeRawUnsafe(
          `UPDATE "products" SET stock_quantity = $1, updated_at = NOW() WHERE id = $2`,
          newQuantity,
          intId,
        );

        return reply.send({ success: true, catagoryId, newQuantity });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      request.log.error(e, 'Failed to update catalog item');
      return reply.code(500).send({ error: msg });
    }
  };

  app.post('/internal/updateCatelogItem', updateCatalogItemHandler);
  app.post('/internal/catalog-item/update', updateCatalogItemHandler);
}
