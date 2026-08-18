import React, { useState, useEffect } from 'react';

// Route: /customer/create & /customers
export function CustomerCreatePage() {
  const [customerName, setCustomerName] = useState('');
  const [email, setEmail] = useState('');
  const [creditLimit, setCreditLimit] = useState(10000);
  const [statusMessage, setStatusMessage] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    const payload = {
      name: customerName,
      email: email,
      creditLimit: parseFloat(creditLimit)
    };

    const response = await fetch('/api/v1/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (response.ok) {
      setStatusMessage(`Customer created successfully with ID: ${data.id}`);
    } else {
      setStatusMessage(`Error creating customer: ${data.error}`);
    }
  };

  return (
    <div className="p-6 max-w-xl mx-auto bg-slate-900 rounded-xl text-white border border-slate-700">
      <h2 className="text-2xl font-bold mb-4">Create Customer Record</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Customer Name</label>
          <input
            id="field-customer-name"
            type="text"
            required
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="e.g. Acme Corporation"
            className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-md"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Email Address</label>
          <input
            id="field-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="contact@acme.com"
            className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-md"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Credit Limit ($)</label>
          <input
            id="field-credit-limit"
            type="number"
            required
            value={creditLimit}
            onChange={(e) => setCreditLimit(e.target.value)}
            className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-md"
          />
        </div>
        <button
          id="btn-submit-customer"
          type="submit"
          className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 rounded-md font-semibold transition"
        >
          Save Customer
        </button>
      </form>
      {statusMessage && <div id="customer-status-msg" className="mt-4 p-3 bg-indigo-950 border border-indigo-700 rounded-md text-sm">{statusMessage}</div>}
    </div>
  );
}
