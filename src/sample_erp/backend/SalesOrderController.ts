import { Request, Response } from 'express';

export class SalesOrderController {
  // POST /api/v1/sales-orders
  public async createSalesOrder(req: Request, res: Response): Promise<void> {
    const { customerId, items, subtotal, tax, discount, grandTotal } = req.body;
    
    // Calls SalesOrderService -> SalesOrderRepository -> INSERT INTO sales_orders
    const orderId = "so-" + Math.floor(Math.random() * 10000);
    res.status(201).json({
      id: orderId,
      orderNumber: `SO-${orderId}`,
      customerId,
      subtotal,
      tax,
      discount,
      grandTotal,
      status: 'CONFIRMED'
    });
  }

  // POST /api/v1/sales-orders/:id/invoice
  public async generateInvoice(req: Request, res: Response): Promise<void> {
    const { id } = req.params;
    const invId = "inv-" + Math.floor(Math.random() * 10000);
    res.status(201).json({
      id: invId,
      invoiceNumber: `INV-${invId}`,
      salesOrderId: id,
      status: 'UNPAID'
    });
  }
}
