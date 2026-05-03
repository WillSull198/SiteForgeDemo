export const validators = {
  required: (value) => Boolean(String(value ?? "").trim()),
  email: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim()),
  ausPhone: (value) => /^(?:\+61|0)[2-478](?:[ -]?\d){8}$/.test(String(value || "").trim()),
  abn: (value) => {
    const cleaned = String(value || "").replace(/\s/g, "");
    if (!/^\d{11}$/.test(cleaned)) return false;
    const digits = cleaned.split("").map(Number);
    digits[0] -= 1;
    const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
    const sum = digits.reduce((total, digit, index) => total + digit * weights[index], 0);
    return sum % 89 === 0;
  },
  positiveNumber: (value) => !Number.isNaN(Number(value)) && Number(value) > 0,
  nonNegativeNumber: (value) => !Number.isNaN(Number(value)) && Number(value) >= 0,
  date: (value) => !Number.isNaN(new Date(value).getTime()),
  futureDate: (value) => new Date(value).getTime() > Date.now(),
  ausPostcode: (value) => /^\d{4}$/.test(String(value || "").trim()),
  ausState: (value) => ["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT"].includes(String(value || "").trim().toUpperCase()),
};

export function validateStructuredAddress(address = {}) {
  return (
    validators.required(address.street) &&
    validators.required(address.suburb) &&
    validators.ausState(address.state) &&
    validators.ausPostcode(address.postcode)
  );
}
