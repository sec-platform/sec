import assert from 'node:assert/strict';
import { normalizeCustomerInput } from '../../custom/customer_normalizer.ts';

export async function runSuite() {
  const normalized = normalizeCustomerInput({
    name: '  Alice Example  ',
    email: 'Alice@Example.COM ',
    phone: ' 138-0013 8000 ',
    company: ''
  });

  assert.deepEqual(normalized, {
    name: 'Alice Example',
    email: 'alice@example.com',
    phone: '13800138000',
    company: 'Unknown'
  });

  assert.throws(() => normalizeCustomerInput({ name: '   ' }), /required/);
}
