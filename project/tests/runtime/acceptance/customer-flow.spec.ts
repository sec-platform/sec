import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, username: string): Promise<void> {
  const response = await page.request.post('/api/session/login', {
    data: { username, password: 'password' }
  });
  expect(response.ok()).toBe(true);
}

test('customer runtime flow keeps tenant data isolated', async ({ page }) => {
  test.setTimeout(60000);

  await signIn(page, 'tenant-a-admin');
  await page.goto('/customers');
  await expect(page).toHaveURL(/\/customers$/);
  const customerList = page.getByRole('list', { name: 'Customers' });
  await page.getByLabel('Name', { exact: true }).fill('Acme');
  await page.getByLabel('Email', { exact: true }).fill('Sales@Acme.test');
  await page.getByLabel('Phone', { exact: true }).fill('400-800-9000');
  await page.getByLabel('Company', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Create Customer' }).click();
  await page.waitForLoadState('networkidle');
  const createdCustomer = customerList.getByRole('listitem').filter({ hasText: 'Acme' });
  await expect(createdCustomer).toHaveCount(1);
  await page.request.post('/api/session/logout');
  await signIn(page, 'tenant-b-admin');
  await page.goto('/customers');
  await expect(page).toHaveURL(/\/customers$/);
  await expect(customerList.getByRole('listitem').filter({ hasText: 'Acme' })).toHaveCount(0);
});
