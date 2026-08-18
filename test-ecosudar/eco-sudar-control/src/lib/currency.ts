/** Compact INR format: ₹1.2L, ₹45K, etc. */
export function inr(amount: number | null | undefined): string {
  if (amount == null) return '₹0';
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  if (abs >= 10_000_000) return `${sign}₹${(abs / 10_000_000).toFixed(2)}Cr`;
  if (abs >= 100_000)    return `${sign}₹${(abs / 100_000).toFixed(2)}L`;
  if (abs >= 1_000)      return `${sign}₹${(abs / 1_000).toFixed(1)}K`;
  return `${sign}₹${abs.toLocaleString('en-IN')}`;
}

/** Full 2-decimal INR format: ₹1,23,456.78 */
export function inrFull(amount: number | null | undefined): string {
  if (amount == null) return '₹0.00';
  return '₹' + amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
