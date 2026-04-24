import type { CustomerRecord } from '../../runtime/database.ts';

export interface CustomerFilterInput {
  search?: string | null;
  company?: string | null;
}

function normalize(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}

export function filterCustomers(
  customers: CustomerRecord[],
  input: CustomerFilterInput = {}
): CustomerRecord[] {
  const search = normalize(input.search);
  const company = normalize(input.company);

  return customers.filter((customer) => {
    const matchesSearch =
      search.length === 0 ||
      [customer.name, customer.email, customer.company].some((value) => normalize(value).includes(search));
    const matchesCompany = company.length === 0 || normalize(customer.company) === company;
    return matchesSearch && matchesCompany;
  });
}

export function listCustomerCompanies(customers: CustomerRecord[]): string[] {
  return [...new Set(customers.map((customer) => customer.company).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}
