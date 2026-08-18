/**
 * Shared field validation — one source of truth so every form rejects the same
 * bad input the same way. Keep these pure (string in, boolean/string out) so
 * they work in inline `onChange` guards and in submit-time checks alike.
 */

/** RFC-ish email: something@something.tld — deliberately permissive, not a parser. */
export function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

/** Exactly 10 digits — Indian mobile numbers, sans country code. */
export function isPhone10(v: string): boolean {
  return /^\d{10}$/.test(digitsOnly(v));
}

/** A finite number (optionally allowing negatives). Empty string is not a number. */
export function isNumeric(v: string | number, opts: { allowNegative?: boolean } = {}): boolean {
  const s = String(v).trim();
  if (s === "") return false;
  const n = Number(s);
  if (!Number.isFinite(n)) return false;
  return opts.allowNegative ? true : n >= 0;
}

/** Strip everything that isn't a digit — for `onChange` sanitising of numeric/phone inputs. */
export function digitsOnly(v: string): string {
  return String(v).replace(/\D+/g, "");
}

/** Cap a digit string to a max length — e.g. `capDigits(v, 10)` for a mobile field. */
export function capDigits(v: string, max: number): string {
  return digitsOnly(v).slice(0, max);
}

/** 6-digit Indian PIN code. */
export function isPincode(v: string): boolean {
  return /^\d{6}$/.test(digitsOnly(v));
}

/** 15-char GSTIN — 2-digit state, 10-char PAN, entity, Z, checksum. Uppercased first. */
export function isGstin(v: string): boolean {
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(v.trim().toUpperCase());
}

/**
 * Run a set of field rules and return the first human error, or null if clean.
 * Each rule is [condition-that-must-hold, message]; the first false wins.
 *
 *   const err = firstError([
 *     [name.trim() !== "", "Name is required"],
 *     [isEmail(email), "Enter a valid email"],
 *     [isPhone10(phone), "Mobile must be 10 digits"],
 *   ]);
 *   if (err) { toast.error(err); return; }
 */
export function firstError(rules: [boolean, string][]): string | null {
  for (const [ok, msg] of rules) if (!ok) return msg;
  return null;
}
