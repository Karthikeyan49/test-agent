import { Request, Response } from 'express';
import { CustomerService } from './CustomerService';

export class CustomerController {
  private customerService: CustomerService;

  constructor() {
    this.customerService = new CustomerService();
  }

  // POST /api/v1/customers
  public async createCustomer(req: Request, res: Response): Promise<void> {
    try {
      const { name, email, creditLimit } = req.body;
      
      if (!name || !email) {
        res.status(400).json({ error: 'Name and email are required fields' });
        return;
      }

      const customer = await this.customerService.createCustomer({
        name,
        email,
        creditLimit: creditLimit || 10000.00
      });

      res.status(201).json(customer);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }

  // GET /api/v1/customers/:id
  public async getCustomerById(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const customer = await this.customerService.findById(id);
      if (!customer) {
        res.status(404).json({ error: 'Customer not found' });
        return;
      }
      res.status(200).json(customer);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
}
