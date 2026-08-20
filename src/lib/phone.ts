/** Kenyan mobile number normalisation: 07..., 01..., 2547..., +2547... -> +2547... */
export function normaliseKenyanPhone(input: string): string {
  const digits = input.replace(/[^\d+]/g, "");
  let value = digits.startsWith("+") ? digits.slice(1) : digits;
  if (value.startsWith("254")) value = value.slice(3);
  else if (value.startsWith("0")) value = value.slice(1);
  if (!/^[17]\d{8}$/.test(value)) {
    throw new Error("Enter a valid Kenyan mobile number, for example 0712 345 678.");
  }
  return `+254${value}`;
}

export function isValidKenyanPhone(input: string): boolean {
  try {
    normaliseKenyanPhone(input);
    return true;
  } catch {
    return false;
  }
}

export function maskPhone(phone: string): string {
  return phone.replace(/^(\+254)(\d{3})(\d{3})(\d{3})$/, "$1 $2 *** $4");
}
