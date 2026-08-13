/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as aiUsage from "../aiUsage.js";
import type * as chef from "../chef.js";
import type * as chefToolSchemas from "../chefToolSchemas.js";
import type * as coach from "../coach.js";
import type * as consult from "../consult.js";
import type * as crew from "../crew.js";
import type * as crons from "../crons.js";
import type * as exerciseDemos from "../exerciseDemos.js";
import type * as foodFacts from "../foodFacts.js";
import type * as home from "../home.js";
import type * as households from "../households.js";
import type * as http from "../http.js";
import type * as migrations from "../migrations.js";
import type * as model from "../model.js";
import type * as nutrition from "../nutrition.js";
import type * as programs from "../programs.js";
import type * as progress from "../progress.js";
import type * as screenshots from "../screenshots.js";
import type * as search from "../search.js";
import type * as sentinels from "../sentinels.js";
import type * as shares from "../shares.js";
import type * as toolSchemas from "../toolSchemas.js";
import type * as users from "../users.js";
import type * as vision from "../vision.js";
import type * as workouts from "../workouts.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  aiUsage: typeof aiUsage;
  chef: typeof chef;
  chefToolSchemas: typeof chefToolSchemas;
  coach: typeof coach;
  consult: typeof consult;
  crew: typeof crew;
  crons: typeof crons;
  exerciseDemos: typeof exerciseDemos;
  foodFacts: typeof foodFacts;
  home: typeof home;
  households: typeof households;
  http: typeof http;
  migrations: typeof migrations;
  model: typeof model;
  nutrition: typeof nutrition;
  programs: typeof programs;
  progress: typeof progress;
  screenshots: typeof screenshots;
  search: typeof search;
  sentinels: typeof sentinels;
  shares: typeof shares;
  toolSchemas: typeof toolSchemas;
  users: typeof users;
  vision: typeof vision;
  workouts: typeof workouts;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  migrations: import("@convex-dev/migrations/_generated/component.js").ComponentApi<"migrations">;
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
  chefAgent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"chefAgent">;
};
