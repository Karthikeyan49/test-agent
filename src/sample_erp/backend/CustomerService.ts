import { CustomerRepository } from './CustomerRepository';

export interface CreateCustomerDTO {
  name: string;
  email: string;
  creditLimit: number;
}

export class CustomerService {
  private repository: CustomerRepository;

  constructor() {
    this.repository = new CustomerRepository();
  }

  public async createCustomer(dto: CreateCustomerDTO) {
    // Business logic validation
    if (dto.creditLimit < 0) {
      throw new Error('Credit limit cannot be negative');
    }

    // Call repository layer to insert into database table `customers`
    const newCustomer = await this.repository.insert({
      name: dto.name,
      email: dto.email,
      credit_limit: dto.creditLimit,
      outstanding_balance: 0.00
    });

    return newCustomer;
  }

  public async findById(id: string) {
    return await this.repository.findById(id);
  }

  public async updateOutstandingBalance(customerId: string, amountPaid: number) {
    const customer = await this.repository.findById(customerId);
    if (!customer) throw new Error('Customer not found');

    const newBalance = customer.outstanding_balance - amountPaid;
    return await this.repository.updateBalance(customerId, newBalance);
  }
}
