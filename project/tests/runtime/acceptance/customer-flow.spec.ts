import { expect, test } from '@playwright/test';

test('customer runtime flow keeps tenant data isolated', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Username').fill('tenant-a-admin');
  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page).toHaveURL(/\/workspace$/);

  await page.getByRole('link', { name: '/customers' }).click();
  await expect(page).toHaveURL(/\/customers$/);
  const customerList = page.getByRole('list', { name: 'Customers' });
  await page.getByLabel('Name', { exact: true }).fill('Acme');
  await page.getByLabel('Email', { exact: true }).fill('Sales@Acme.test');
  await page.getByLabel('Phone', { exact: true }).fill('400-800-9000');
  await page.getByLabel('Company', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Create Customer' }).click();
  const createdCustomer = customerList.getByRole('listitem').filter({ hasText: 'Acme' });
  await expect(createdCustomer).toHaveCount(1);
  await page.getByLabel('Attachment for Acme').setInputFiles({
    name: 'contract.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('approved')
  });
  await page.getByRole('button', { name: 'Upload attachment for Acme' }).click();
  await expect(createdCustomer).toContainText('contract.txt');

  await page.getByLabel('Search customers').fill('acme');
  await page.getByLabel('Company filter').selectOption('Unknown');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(customerList.getByRole('listitem').filter({ hasText: 'Acme' })).toHaveCount(1);

  await expect(page.getByText('Customer created: Acme')).toBeVisible();

  await page.request.post('/api/session/logout');
  await page.goto('/login');
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel('Username').fill('tenant-b-admin');
  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.getByRole('link', { name: '/customers' }).click();
  await expect(customerList.getByRole('listitem').filter({ hasText: 'Acme' })).toHaveCount(0);
  await expect(page.getByText('contract.txt')).toHaveCount(0);
});
