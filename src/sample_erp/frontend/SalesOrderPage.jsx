import React, { useState } from 'react';

// Route: /sales/order/create
export function SalesOrderPage() {
  const [customerId, setCustomerId] = useState('');
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [unitPrice, setUnitPrice] = useState(100);
  const [discount, setDiscount] = useState(0);
  const [taxRate, setTaxRate] = useState(0.10); // 10%
  const [orderResult, setOrderResult] = useState(null);

  // Derived transformation calculations
  const subtotal = quantity * unitPrice;
  const tax = subtotal * taxRate;
  const grandTotal = subtotal + tax - discount;

  const handleCreateOrder = async (e) => {
    e.preventDefault();
    const payload = {
      customerId,
      items: [
        { productId, quantity, unitPrice }
      ],
      subtotal,
      tax,
      discount,
      grandTotal
    };

    const response = await fetch('/api/v1/sales-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (response.ok) {
      setOrderResult(data);
    }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto bg-slate-900 rounded-xl text-white border border-slate-700">
      <h2 className="text-2xl font-bold mb-4">Create Sales Order</h2>
      <form onSubmit={handleCreateOrder} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Select Customer ID</label>
          <input
            id="field-sales-customer-id"
            type="text"
            required
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            placeholder="UUID of Customer"
            className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-md"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Product ID</label>
            <input
              id="field-product-id"
              type="text"
              required
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Quantity</label>
            <input
              id="field-quantity"
              type="number"
              min="1"
              required
              value={quantity}
              onChange={(e) => setQuantity(parseInt(e.target.value) || 0)}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-md"
            />
          </div>
        </div>

        <div className="p-4 bg-slate-800 rounded-lg space-y-2 text-sm border border-slate-700">
          <div className="flex justify-between">
            <span>Subtotal:</span>
            <span id="field-subtotal">${subtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>Estimated Tax (10%):</span>
            <span id="field-tax">${tax.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>Discount:</span>
            <span id="field-discount">${discount.toFixed(2)}</span>
          </div>
          <div className="flex justify-between font-bold text-lg text-emerald-400 border-t border-slate-700 pt-2">
            <span>Grand Total:</span>
            <span id="field-grand-total">${grandTotal.toFixed(2)}</span>
          </div>
        </div>

        <button
          id="btn-confirm-order"
          type="submit"
          className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 rounded-md font-semibold transition"
        >
          Confirm & Create Sales Order
        </button>
      </form>
    </div>
  );
}
