import { expect, test } from '@playwright/test';

test('customer runtime flow keeps tenant data isolated', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Username').fill('tenant-a-admin');
  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page).toHaveURL(/\/workspace$/);

  await page.getByRole('link', { name: '/customers' }).click();
  await expect(page).toHaveURL(/\/customers$/);
  await page.getByLabel('Name').fill('Acme');
  await page.getByLabel('Email').fill('Sales@Acme.test');
  await page.getByLabel('Phone').fill('400-800-9000');
  await page.getByLabel('Company').fill('');
  await page.getByRole('button', { name: 'Create Customer' }).click();
  const createdCustomer = page.getByRole('listitem').filter({ hasText: 'Acme' });
  await expect(createdCustomer).toHaveCount(1);

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel('Username').fill('tenant-b-admin');
  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.getByRole('link', { name: '/customers' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Acme' })).toHaveCount(0);
});
