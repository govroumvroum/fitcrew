import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Thousands grouped the French way ("4 240"), because a bare 4240 kg is hard to
// read at a glance. One formatter so every screen groups identically.
const number = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 })
export const formatNumber = (value: number) => number.format(value)
