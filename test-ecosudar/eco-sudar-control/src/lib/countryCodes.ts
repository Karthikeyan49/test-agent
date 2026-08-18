export interface CountryCode {
  code: string;
  iso: string;
  name: string;
}

export const DEFAULT_COUNTRY_CODE = "+91";

export const COUNTRY_CODES: CountryCode[] = [
  { code: "+91",  iso: "IN", name: "India" },
  { code: "+971", iso: "AE", name: "United Arab Emirates" },
  { code: "+966", iso: "SA", name: "Saudi Arabia" },
  { code: "+974", iso: "QA", name: "Qatar" },
  { code: "+968", iso: "OM", name: "Oman" },
  { code: "+965", iso: "KW", name: "Kuwait" },
  { code: "+973", iso: "BH", name: "Bahrain" },
  { code: "+65",  iso: "SG", name: "Singapore" },
  { code: "+60",  iso: "MY", name: "Malaysia" },
  { code: "+94",  iso: "LK", name: "Sri Lanka" },
  { code: "+977", iso: "NP", name: "Nepal" },
  { code: "+880", iso: "BD", name: "Bangladesh" },
  { code: "+44",  iso: "GB", name: "United Kingdom" },
  { code: "+1",   iso: "US", name: "United States / Canada" },
  { code: "+61",  iso: "AU", name: "Australia" },
  { code: "+49",  iso: "DE", name: "Germany" },
];
