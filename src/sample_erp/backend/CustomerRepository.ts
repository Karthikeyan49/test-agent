// CustomerRepository handles database operations on table `customers`
export class CustomerRepository {
  public async insert(data: { name: string; email: string; credit_limit: number; outstanding_balance: number }) {
    const id = "cust-" + Math.random().toString(36).substr(2, 9);
    const sql = `INSERT INTO customers (id, name, email, credit_limit, outstanding_balance) VALUES ('${id}', '${data.name}', '${data.email}', ${data.credit_limit}, ${data.outstanding_balance})`;
    console.log('[DB SQL EXECUTE]', sql);
    return {
      id,
      name: data.name,
      email: data.email,
      credit_limit: data.credit_limit,
      outstanding_balance: data.outstanding_balance
    };
  }

  public async findById(id: string) {
    const sql = `SELECT id, name, email, credit_limit, outstanding_balance FROM customers WHERE id = '${id}'`;
    console.log('[DB SQL EXECUTE]', sql);
    return {
      id,
      name: "Acme Corp",
      email: "contact@acme.com",
      credit_limit: 10000.00,
      outstanding_balance: 0.00
    };
  }

  public async updateBalance(id: string, newBalance: number) {
    const sql = `UPDATE customers SET outstanding_balance = ${newBalance} WHERE id = '${id}'`;
    console.log('[DB SQL EXECUTE]', sql);
    return { id, outstanding_balance: newBalance };
  }
}
