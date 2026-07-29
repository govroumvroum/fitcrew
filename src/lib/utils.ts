import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Thousands grouped the French way ("4 240"), because a bare 4240 kg is hard to
// read at a glance. One formatter so every screen groups identically.
//
// `digits` matters: volumes are whole kilos, but a bodyweight rounded to the kilo
// hides exactly the movement you weigh yourself to see (72,55 -> "73").
const formatters = new Map<number, Intl.NumberFormat>();
export function formatNumber(value: number, digits = 0) {
  let formatter = formatters.get(digits);
  if (!formatter) {
    formatter = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: digits });
    formatters.set(digits, formatter);
  }
  return formatter.format(value);
}
