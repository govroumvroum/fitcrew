/** Record rendering, shared by /accueil, /progres and the finished-séance screen. */

export const PR_LABELS = {
  max_weight: { text: "Charge max", unit: "kg" },
  est_1rm: { text: "Force (1RM est.)", unit: "kg" },
  // Bodyweight exercises only — reps rank nothing once there's load on the bar.
  max_reps: { text: "Reps max", unit: "reps" },
  max_volume: { text: "Volume max", unit: "kg" },
} as const;

// Red text on our background fails contrast, so records use the lightened brand hue.
export const TROPHY = "size-4 shrink-0 text-[oklch(0.8_0.086_27.255)]";
