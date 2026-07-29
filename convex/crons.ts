import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// ponytail: Convex crons are UTC-only. 06:00 UTC = 07:00 à Bordeaux en hiver,
// 08:00 en été — invisible pour un défi qui court toute la semaine. Si l'heure
// locale finit par compter : cron quotidien qui vérifie l'heure du fuseau avant
// de générer.
crons.weekly(
  "weekly challenges",
  { dayOfWeek: "monday", hourUTC: 6, minuteUTC: 0 },
  internal.crew.generateWeekly,
  {},
);

export default crons;
