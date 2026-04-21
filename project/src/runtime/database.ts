export interface CustomerInput {
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
}

export interface NormalizedCustomerInput {
  name: string;
  email: string;
  phone: string;
  company: string;
}

export interface CustomerRecord extends NormalizedCustomerInput {
  id: number;
  tenantId: string;
}

export interface Database {
  nextCustomerId: number;
  customers: CustomerRecord[];
}

export function createDatabase(): Database {
  return {
    nextCustomerId: 1,
    customers: []
  };
}
