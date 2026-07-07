import { getBusinessByOwner } from '@/services/db.js';
import { sendButtons } from '@/services/whatsapp.js';

export async function sendMainMenu(customerId: string, greetingText: string): Promise<void> {
  const business = await getBusinessByOwner(customerId);

  if (business) {
    await sendButtons(customerId, greetingText, [
      { id: 'manage_catalog', title: 'Manage Catalog' },
      { id: 'delete_business', title: 'Delete Business' },
      { id: 'find_service', title: 'Find a Service' },
    ]);
  } else {
    await sendButtons(customerId, greetingText, [
      { id: 'register_business', title: 'Register a Business' },
      { id: 'find_service', title: 'Find a Service' },
    ]);
  }
}
