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
import type * as coach from "../coach.js";
import type * as exerciseDemos from "../exerciseDemos.js";
import type * as home from "../home.js";
import type * as http from "../http.js";
import type * as model from "../model.js";
import type * as programs from "../programs.js";
import type * as progress from "../progress.js";
import type * as screenshots from "../screenshots.js";
import type * as search from "../search.js";
import type * as toolSchemas from "../toolSchemas.js";
import type * as users from "../users.js";
import type * as workouts from "../workouts.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  aiUsage: typeof aiUsage;
  coach: typeof coach;
  exerciseDemos: typeof exerciseDemos;
  home: typeof home;
  http: typeof http;
  model: typeof model;
  programs: typeof programs;
  progress: typeof progress;
  screenshots: typeof screenshots;
  search: typeof search;
  toolSchemas: typeof toolSchemas;
  users: typeof users;
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
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
};
