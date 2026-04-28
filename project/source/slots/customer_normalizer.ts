// @generated task:fill_slot_customer_normalizer
import type { CustomerInput, NormalizedCustomerInput } from '../../src/runtime/database.ts';

export function normalizeCustomerInput(input: CustomerInput): NormalizedCustomerInput {
  const name = String(input.name ?? '').trim();
  if (!name) {
    throw new Error('customer name is required');
  }
  const email = input.email ? String(input.email).trim() : '';
  const normalizedEmail = email.toLowerCase();
  const rawPhone = input.phone ? String(input.phone) : '';
  const normalizedPhone = rawPhone.replace(/[\s-]+/g, '');
  const company = String(input.company ?? '').trim() || 'Unknown';
  return {
    name,
    email: normalizedEmail,
    phone: normalizedPhone,
    company
  };
}
