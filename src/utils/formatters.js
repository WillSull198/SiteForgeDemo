const UNDER_TWENTY = [
  "Zero",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];

const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function wordsUnderThousand(value) {
  const number = Number(value || 0);
  if (number < 20) return UNDER_TWENTY[number];
  if (number < 100) {
    const ten = Math.floor(number / 10);
    const remainder = number % 10;
    return `${TENS[ten]}${remainder ? ` ${UNDER_TWENTY[remainder]}` : ""}`;
  }
  const hundreds = Math.floor(number / 100);
  const remainder = number % 100;
  return `${UNDER_TWENTY[hundreds]} Hundred${remainder ? ` and ${wordsUnderThousand(remainder)}` : ""}`;
}

function numberToWords(value = 0) {
  const amount = Math.round(Number(value) || 0);
  if (amount === 0) return "Zero Dollars";
  const millions = Math.floor(amount / 1_000_000);
  const thousands = Math.floor((amount % 1_000_000) / 1000);
  const remainder = amount % 1000;
  const parts = [];
  if (millions) parts.push(`${wordsUnderThousand(millions)} Million`);
  if (thousands) parts.push(`${wordsUnderThousand(thousands)} Thousand`);
  if (remainder) parts.push(wordsUnderThousand(remainder));
  return `${parts.join(" ")} Dollars`;
}

export const formatters = {
  aud: (amount) =>
    new Intl.NumberFormat("en-AU", {
      style: "currency",
      currency: "AUD",
    }).format(Number(amount) || 0),
  abn: (value) => String(value || "").replace(/\s/g, "").replace(/(\d{2})(\d{3})(\d{3})(\d{3})/, "$1 $2 $3 $4"),
  ausPhone: (value) => String(value || "").replace(/^(\+61|0)([2-478])(\d{4})(\d{4})$/, "$1 $2 $3 $4"),
  ausDateShort: (date) => new Date(date).toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" }),
  ausDateLong: (date) => new Date(date).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" }),
  ausDateTime: (date) => new Date(date).toLocaleString("en-AU"),
  numberToWords,
};
