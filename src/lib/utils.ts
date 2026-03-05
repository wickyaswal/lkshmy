export const roundTo = (value: number, decimals = 8): number => {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

export const floorToStep = (value: number, step: number): number => {
  if (step <= 0) {
    return value;
  }

  const scaled = Math.floor((value + Number.EPSILON) / step);
  return roundTo(scaled * step, 8);
};

export const parseBooleanLike = (value: string | boolean | null | undefined): boolean => {
  if (typeof value === "boolean") {
    return value;
  }

  if (!value) {
    return false;
  }

  const normalized = String(value).trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
};

export const safeJsonParse = <T>(value: string, fallback: T): T => {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

export const toFixedString = (value: number, decimals = 8): string => roundTo(value, decimals).toString();

export const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

export const formatIsoNow = (): string => new Date().toISOString();

export const formatDateInTimeZone = (date: Date, timeZone: string): string => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  return formatter.format(date);
};

export const formatTimeInTimeZone = (date: Date, timeZone: string): string => {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });

  return formatter.format(date);
};

export const isTimeWithinWindow = (timeValue: string, startValue: string, endValue: string): boolean => {
  if (startValue === endValue) {
    return true;
  }

  const normalize = (input: string): number => {
    const [hours, minutes] = input.split(":").map((segment) => Number(segment));
    return hours * 60 + (minutes || 0);
  };

  const timeMinutes = normalize(timeValue);
  const startMinutes = normalize(startValue);
  const endMinutes = normalize(endValue);

  if (startMinutes < endMinutes) {
    return timeMinutes >= startMinutes && timeMinutes <= endMinutes;
  }

  return timeMinutes >= startMinutes || timeMinutes <= endMinutes;
};
