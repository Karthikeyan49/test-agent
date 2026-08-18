/**
 * Units of measurement offered in dropdowns (Purchase Items, PO line items).
 * One shared list so every "unit" picker across the app stays consistent.
 */
export const UOM_OPTIONS = [
  "nos", "kg", "g", "ton", "quintal",
  "litre", "ml",
  "metre", "cm", "ft", "inch", "sqft", "sqm",
  "box", "bag", "roll", "set", "pair", "packet", "dozen", "bundle",
] as const;

export type Uom = (typeof UOM_OPTIONS)[number];

/** GST rate slabs used across purchase/sales forms. */
export const GST_RATES = ["0", "3", "5", "12", "18", "28"] as const;
