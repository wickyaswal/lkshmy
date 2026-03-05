const DEFAULT_SCALE = 8;

const normalizeInput = (input: string | number): string => {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) {
      return "0";
    }
    return input.toString();
  }

  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : "0";
};

export const decimalToScaledInt = (input: string | number, scale = DEFAULT_SCALE): bigint => {
  const normalized = normalizeInput(input);
  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [wholePartRaw, fractionRaw = ""] = unsigned.split(".");
  const wholePart = wholePartRaw.replace(/[^\d]/g, "") || "0";
  const fractionDigits = fractionRaw.replace(/[^\d]/g, "");
  const paddedFraction = `${fractionDigits}${"0".repeat(scale)}`.slice(0, scale);
  const combined = `${wholePart}${paddedFraction}`.replace(/^0+(\d)/, "$1");
  const value = BigInt(combined || "0");
  return negative ? -value : value;
};

export const scaledIntToDecimal = (value: bigint, scale = DEFAULT_SCALE): string => {
  const negative = value < 0n;
  const absValue = negative ? -value : value;
  const text = absValue.toString().padStart(scale + 1, "0");
  const whole = text.slice(0, -scale);
  const fraction = text.slice(-scale).replace(/0+$/, "");
  const body = fraction ? `${whole}.${fraction}` : whole;
  return negative ? `-${body}` : body;
};

export const subtractDecimals = (left: string | number, right: string | number, scale = DEFAULT_SCALE): string => {
  const leftInt = decimalToScaledInt(left, scale);
  const rightInt = decimalToScaledInt(right, scale);
  return scaledIntToDecimal(leftInt - rightInt, scale);
};

export const addDecimals = (left: string | number, right: string | number, scale = DEFAULT_SCALE): string => {
  const leftInt = decimalToScaledInt(left, scale);
  const rightInt = decimalToScaledInt(right, scale);
  return scaledIntToDecimal(leftInt + rightInt, scale);
};

export const maxDecimal = (value: string | number, min: string | number, scale = DEFAULT_SCALE): string => {
  const valueInt = decimalToScaledInt(value, scale);
  const minInt = decimalToScaledInt(min, scale);
  return scaledIntToDecimal(valueInt > minInt ? valueInt : minInt, scale);
};
