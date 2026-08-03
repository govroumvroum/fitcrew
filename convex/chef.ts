import {
  Agent,
  createThread,
  createTool,
  getThreadMetadata,
  listUIMessages,
  stepCountIs,
  syncStreams,
  updateThreadMetadata,
  type ToolCtx,
  vStreamArgs,
} from "@convex-dev/agent";
import { paginationOptsValidator } from "convex/server";
import { v, type GenericId } from "convex/values";
import { z } from "zod";
import { api, components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
  type QueryCtx,
} from "./_generated/server";
import { costUsdFrom } from "./aiUsage";
import {
  zAddFoodLogEntry,
  zAnalyzeImage,
  zAskCoach,
  zGenerateMealPlan,
  zLogPlannedMeal,
  zLookupFood,
  zMoveMeal,
  zPlannedMeal,
  zRegenerateDay,
  zReplaceMeal,
  zSaveNutritionProfile,
  zSuggestRecipes,
  zUpdateInventory,
} from "./chefToolSchemas";
import { foodByBarcode, isBarcode, searchFood } from "./foodFacts";
import { languageModel } from "./model";
import type { Macros, PlannedMeal } from "./nutrition";
import { shift, weekStart } from "./progress";
import { KICKOFF, CHEF_ATTACHMENTS, isSentinel } from "./sentinels";
import { getCurrentUser, requireCurrentUser } from "./users";

// ---------------------------------------------------------------------------
// Pure shape conversion (model output -> what the schema accepts)
// ---------------------------------------------------------------------------

type ModelMeal = z.infer<typeof zPlannedMeal>;

/**
 * Strict structured output can't express "optional", so nulls come back instead.
 * `locked` is deliberately absent: it belongs to the user (the lock button in the
 * UI), and letting the model set it would let it lock its own proposals.
 */
export function toPlannedMeal({ mealPrep, ...rest }: ModelMeal): PlannedMeal {
  return { ...rest, ...(mealPrep ? { mealPrep } : {}) };
}

// ---------------------------------------------------------------------------
// Reads the chef needs
// ---------------------------------------------------------------------------

/** What the dashboard query hands back — see `api.nutrition.dashboard`. */
type Dashboard = {
  profile: Doc<"nutritionProfiles"> | null;
  todayMeals: PlannedMeal[];
  log: Doc<"foodLog">[];
  consumed: Macros;
  hydrationMl: number;
  weekStart: string;
  hasPlan: boolean;
};

type ChefContext = { user: Doc<"users">; dashboard: Dashboard; inventory: Doc<"inventory">[] };

/**
 * Everything the system prompt is built from, in one transaction. Reuses the
 * dashboard query the /nutrition screen already subscribes to rather than a
 * second set of reads that could disagree with it.
 *
 * The return type is spelled out because calling `api.nutrition.*` from a module
 * that is itself part of `api` is circular for TypeScript (see the Convex
 * guidelines) — without it the whole generated `api` degrades to `any`.
 */
export const context = internalQuery({
  args: { today: v.string() },
  handler: async (ctx, args): Promise<ChefContext> => {
    const user = await requireCurrentUser(ctx);
    return {
      user,
      dashboard: await ctx.runQuery(api.nutrition.dashboard, { today: args.today }),
      inventory: await ctx.runQuery(api.nutrition.inventory, {}),
    };
  },
});

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const SLOT_LABEL = {
  petit_dejeuner: "petit-déjeuner",
  dejeuner: "déjeuner",
  diner: "dîner",
  collation: "collation",
} as const;

/**
 * `today` is closed over rather than asked of the model, and `weekStart` is
 * derived from it here: a plan filed under a Tuesday is invisible to every
 * reader, and a model doing calendar arithmetic is a bug factory.
 */
function chefTools(today: string) {
  const monday = weekStart(today);
  const sunday = shift(monday, 6);
  const week = { weekStart: monday };

  return {
    save_nutrition_profile: createTool({
      description:
        "Enregistre le profil nutrition et calcule ses cibles caloriques. À appeler UNIQUEMENT après que le user a validé ton récapitulatif.",
      inputSchema: zSaveNutritionProfile,
      execute: async (ctx: ToolCtx, { diet, budget, cookMinutes, people, ...rest }) =>
        await ctx.runMutation(api.nutrition.saveProfile, {
          ...rest,
          // Absent, not null: Convex `patch` DELETES a key set to `undefined`, and
          // `saveProfile` only forwards the keys it actually receives.
          ...(diet ? { diet } : {}),
          ...(budget ? { budget } : {}),
          ...(cookMinutes !== null ? { cookMinutes } : {}),
          ...(people !== null ? { people } : {}),
        }),
    }),

    generate_meal_plan: createTool({
      description: `Génère et enregistre les repas de la semaine en cours (lundi ${monday} → dimanche ${sunday}). Les dates doivent être dans cette plage. Écrase le plan existant de la semaine.`,
      inputSchema: zGenerateMealPlan,
      execute: async (ctx: ToolCtx, { days }) =>
        await ctx.runMutation(internal.nutrition.savePlan, {
          ...week,
          days: days.map((day) => ({ date: day.date, meals: day.meals.map(toPlannedMeal) })),
        }),
    }),

    replace_meal: createTool({
      description:
        "Remplace UN repas du plan de la semaine (il n'aime pas, il n'a pas les ingrédients, il veut autre chose).",
      inputSchema: zReplaceMeal,
      execute: async (ctx: ToolCtx, { date, slot, meal }) =>
        await ctx.runMutation(internal.nutrition.replaceMeal, {
          ...week,
          date,
          slot,
          meal: toPlannedMeal(meal),
        }),
    }),

    move_meal: createTool({
      description:
        "Déplace un repas prévu vers un autre jour ou créneau. Si la destination est occupée, les deux repas s'échangent.",
      inputSchema: zMoveMeal,
      execute: async (ctx: ToolCtx, { from, to }) =>
        await ctx.runMutation(internal.nutrition.moveMeal, { ...week, from, to }),
    }),

    regenerate_day: createTool({
      description:
        "Refait tous les repas NON verrouillés d'une journée. Les repas verrouillés par le user sont conservés : ne propose rien pour leurs créneaux.",
      inputSchema: zRegenerateDay,
      execute: async (ctx: ToolCtx, { date, meals }) =>
        await ctx.runMutation(internal.nutrition.regenerateDay, {
          ...week,
          date,
          meals: meals.map(toPlannedMeal),
        }),
    }),

    shopping_list: createTool({
      description:
        "La liste de courses de la semaine, consolidée depuis le plan. Rien à inventer : ça sort du plan enregistré.",
      inputSchema: z.object({}),
      execute: async (ctx: ToolCtx) => await ctx.runQuery(api.nutrition.shoppingList, { ...week }),
    }),

    add_food_log_entry: createTool({
      description:
        "Enregistre ce que le user a mangé quand ce n'était pas le repas prévu. Pour un produit industriel ou une marque, appelle lookup_food AVANT pour avoir de vrais chiffres.",
      inputSchema: zAddFoodLogEntry.extend({
        date: z.string().describe(`YYYY-MM-DD. Aujourd'hui = ${today}`),
      }),
      execute: async (ctx: ToolCtx, { quantity, ...rest }) =>
        await ctx.runMutation(api.nutrition.addLogEntry, {
          ...rest,
          ...(quantity ? { quantity } : {}),
          source: "manual",
        }),
    }),

    log_planned_meal: createTool({
      description:
        "« J'ai mangé ce qui était prévu » : recopie le repas du plan dans le journal, tel quel.",
      inputSchema: zLogPlannedMeal.extend({
        date: z.string().describe(`YYYY-MM-DD. Aujourd'hui = ${today}`),
      }),
      execute: async (ctx: ToolCtx, { date, slot }) =>
        await ctx.runMutation(api.nutrition.logPlannedMeal, { ...week, date, slot }),
    }),

    update_inventory: createTool({
      description:
        "Met à jour ce qu'il a dans son frigo / ses placards. « add » complète, « replace » refait l'inventaire à zéro.",
      inputSchema: zUpdateInventory,
      execute: async (ctx: ToolCtx, { items, mode }) =>
        await ctx.runMutation(api.nutrition.setInventory, {
          mode,
          items: items.map(({ name, quantity }) => ({
            name,
            ...(quantity ? { quantity } : {}),
          })),
        }),
    }),

    suggest_recipes_from_ingredients: createTool({
      description:
        "Propose des recettes à partir de ce qu'il a réellement sous la main. Ne les enregistre PAS : présente-les, et utilise replace_meal ou add_food_log_entry s'il en choisit une.",
      inputSchema: zSuggestRecipes,
      execute: async (ctx: ToolCtx, { ingredients, constraints }) =>
        await ctx.runAction(api.vision.suggestRecipes, { ingredients, constraints }),
    }),

    lookup_food: createTool({
      description:
        "Cherche les valeurs nutritionnelles réelles d'un produit dans Open Food Facts. À appeler AVANT d'estimer un produit industriel, une marque ou un code-barres. Jamais pour un plat maison : il n'y est pas.",
      inputSchema: zLookupFood,
      execute: async (_ctx: ToolCtx, { query }) => {
        try {
          const results = isBarcode(query)
            ? [await foodByBarcode(query)].filter((f) => f !== null)
            : await searchFood(query);
          return { query, source: "Open Food Facts", basis: "pour 100 g / 100 ml", results };
        } catch (error) {
          // Returned, not thrown: a public API having a bad day must not abort
          // the chef's turn.
          const message = error instanceof Error ? error.message : String(error);
          console.error("lookup_food", message);
          return { query, results: [], error: message };
        }
      },
    }),

    analyze_plate: createTool({
      description:
        "Analyse la photo d'une assiette ou d'un plat pour estimer ce qu'il y a dedans. N'enregistre RIEN : le user valide lui-même la fiche affichée.",
      inputSchema: zAnalyzeImage,
      execute: async (ctx: ToolCtx, { storageId }) =>
        await ctx.runAction(api.vision.analyze, {
          storageId: storageId as Id<"_storage">,
          intent: "plate",
          today,
        }),
    }),

    analyze_fridge: createTool({
      description:
        "Analyse la photo d'un frigo ou d'un placard pour lister les ingrédients visibles. N'enregistre RIEN : le user valide lui-même.",
      inputSchema: zAnalyzeImage,
      execute: async (ctx: ToolCtx, { storageId }) =>
        await ctx.runAction(api.vision.analyze, {
          storageId: storageId as Id<"_storage">,
          intent: "fridge",
          today,
        }),
    }),

    read_nutrition_label: createTool({
      description:
        "Lit une étiquette nutritionnelle ou un code-barres sur un emballage. N'enregistre RIEN : le user valide lui-même.",
      inputSchema: zAnalyzeImage,
      execute: async (ctx: ToolCtx, { storageId }) =>
        await ctx.runAction(api.vision.analyze, {
          storageId: storageId as Id<"_storage">,
          intent: "label",
          today,
        }),
    }),

    analyze_groceries: createTool({
      description:
        "Analyse la photo de courses ou d'un ticket pour lister ce qu'il a acheté. N'enregistre RIEN : le user valide lui-même.",
      inputSchema: zAnalyzeImage,
      execute: async (ctx: ToolCtx, { storageId }) =>
        await ctx.runAction(api.vision.analyze, {
          storageId: storageId as Id<"_storage">,
          intent: "groceries",
          today,
        }),
    }),

    ask_coach: createTool({
      description:
        "Consulte le coach sportif quand la réponse dépend VRAIMENT de l'entraînement (quelle séance arrive, son intensité, les muscles travaillés). Jamais pour ce qui est déjà dans ton contexte. Il n'a aucun outil et ne peut pas te reconsulter : une question, une réponse.",
      inputSchema: zAskCoach,
      execute: async (ctx: ToolCtx, { question, context: consultContext }) =>
        await ctx.runAction(internal.consult.askCoach, {
          question,
          context: consultContext,
          expectedFormat: "Séance à venir, intensité, et ce que ça implique pour l'alimentation.",
        }),
    }),
  };
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const QUESTIONS = `1. Objectif (perte de poids, maintien, prise de masse)
2. Âge et sexe
3. Taille et poids
4. Niveau d'activité dans la journée hors sport (sédentaire, léger, modéré, actif, très actif)
5. Régime particulier (végétarien, halal, sans lactose…) ou aucun
6. ALLERGIES alimentaires
7. Aliments qu'il ne veut pas voir dans ses repas
8. Nombre de repas par jour
9. Budget courses (serré, normal…)
10. Temps de cuisine dispo par repas
11. Nombre de personnes pour qui il cuisine`;

const GOAL_LABEL = { perte: "perte de poids", maintien: "maintien", prise: "prise de masse" };

function systemPrompt(
  user: Doc<"users">,
  dashboard: Dashboard,
  inventory: Doc<"inventory">[],
  today: string,
) {
  const p = dashboard.profile;

  return `Tu es « Le Chef », l'assistant nutrition de ${user.name} dans l'app FitCrew. Tu parles français, tu tutoies, tu es bref : c'est une conversation sur un téléphone, pas un article de blog. 2-6 phrases par message, sauf quand tu présentes un menu.

Nous sommes le ${today}. La semaine en cours commence le lundi ${dashboard.weekStart}.

${
  p
    ? `PROFIL NUTRITION
- Objectif : ${GOAL_LABEL[p.goal]}
- ${p.age} ans, ${p.sex === "h" ? "homme" : "femme"}, ${p.heightCm} cm, ${p.weightKg} kg, activité ${p.activityLevel}
- Régime : ${p.diet ?? "aucun"}
- ALLERGIES : ${p.allergies.join(", ") || "aucune"}
- ALIMENTS EXCLUS : ${p.excluded.join(", ") || "aucun"}
- ${p.mealsPerDay} repas/jour${p.people && p.people > 1 ? `, il cuisine pour ${p.people} personnes` : ""}
- Budget : ${p.budget ?? "non précisé"}${p.cookMinutes ? `, ${p.cookMinutes} min de cuisine par repas` : ""}

CIBLES QUOTIDIENNES (estimées, Mifflin-St Jeor) : ${p.targets.calories} kcal — ${p.targets.protein} g de protéines, ${p.targets.carbs} g de glucides, ${p.targets.fat} g de lipides.

Le profil est déjà fait. S'il veut le refaire ou change de poids/objectif, reprends les questions une par une et rappelle \`save_nutrition_profile\` à la fin.`
    : `PREMIÈRE CONVERSATION — LE PROFIL N'EXISTE PAS ENCORE
Tu ne peux rien calculer sans lui. Déroule exactement ça :
- Accueille en une ou deux phrases.
- Pose les questions suivantes UNE PAR UNE. Jamais deux questions dans le même message, jamais de liste à cocher. Tu rebondis sur la réponse avant d'enchaîner.
${QUESTIONS}
- Puis fais un récapitulatif de ce que tu as compris et demande si c'est bon.
- Une fois validé, appelle \`save_nutrition_profile\`, annonce ses cibles en précisant que ce sont des estimations, puis propose de générer sa semaine de repas.`
}

PLAN DE LA SEMAINE : ${dashboard.hasPlan ? "il en existe un." : "aucun pour cette semaine."}
REPAS PRÉVUS AUJOURD'HUI :
${dashboard.todayMeals.map((m) => `- ${SLOT_LABEL[m.slot]} : ${m.name} — ~${m.macros.calories} kcal, ${m.macros.protein} g P / ${m.macros.carbs} g G / ${m.macros.fat} g L, ${m.prepMinutes} min${m.locked ? " [VERROUILLÉ par le user]" : ""}`).join("\n") || "(rien de prévu)"}

DÉJÀ MANGÉ AUJOURD'HUI :
${dashboard.log.map((e) => `- ${SLOT_LABEL[e.slot]} : ${e.name}${e.quantity ? ` (${e.quantity})` : ""} — ~${e.macros.calories} kcal, ${e.macros.protein} g P`).join("\n") || "(rien de loggé)"}
Total du jour : ${dashboard.consumed.calories} kcal, ${dashboard.consumed.protein} g P / ${dashboard.consumed.carbs} g G / ${dashboard.consumed.fat} g L${p ? ` — reste ${p.targets.calories - dashboard.consumed.calories} kcal sur la cible` : ""}.
Hydratation : ${dashboard.hydrationMl} ml aujourd'hui.

FRIGO / PLACARDS :
${inventory.map((i) => `- ${i.name}${i.quantity ? ` (${i.quantity})` : ""}`).join("\n") || "(inventaire vide)"}

RÈGLES NON NÉGOCIABLES
- LES ALLERGIES ET LES ALIMENTS EXCLUS SONT DES CONTRAINTES DURES. Une proposition qui en contient un est un bug, pas un choix de style. Vérifie chaque ingrédient de chaque repas avant de le proposer, y compris les ingrédients cachés (le beurre contient du lactose, la sauce soja contient du blé).
- Chaque chiffre en kcal ou en macros est une ESTIMATION et tu le présentes comme telle. Jamais « ton déjeuner fait 612 kcal » — « ~600 kcal, à peu près ».
- TU N'ES NI MÉDECIN NI DIÉTÉTICIEN. Pathologie (diabète, cholestérol, thyroïde…), symptôme, médicament, trouble du comportement alimentaire, grossesse, allaitement, régime d'un enfant : tu dis clairement que ça demande un professionnel de santé (médecin, diététicien-nutritionniste) et tu NE PRODUIS PAS de plan pour ça. Tu peux continuer à parler cuisine, pas soigner.
- Tu ne fixes jamais un objectif de poids ni un déficit agressif de toi-même. Les cibles viennent du calcul ci-dessus.

RÈGLES PLAN (quand tu appelles generate_meal_plan)
- Les dates sont celles de la semaine en cours, du lundi ${dashboard.weekStart} au dimanche ${shift(dashboard.weekStart, 6)}. Ne calcule aucune autre semaine.
- ${p ? `${p.mealsPerDay} repas par jour` : "Le nombre de repas de son profil"}, et le total journalier tourne autour de ses cibles. Pas au kcal près : c'est une estimation.
- Respecte le temps de cuisine et le budget. Réutilise les mêmes ingrédients sur plusieurs repas — c'est moins cher et ça évite le gaspillage. Utilise \`mealPrep\` quand un plat se prépare la veille ou en double.
- Sers son entraînement : plus de glucides autour des séances, protéines réparties sur la journée.
- Après \`generate_meal_plan\`, résume la semaine dans ton message, jour par jour : le user ne voit que ce que tu écris.

AUTRES OUTILS
- \`lookup_food\` AVANT d'estimer un produit industriel, une marque ou un code-barres. Préfère toujours ces chiffres à ton estimation, et dis qu'ils viennent d'Open Food Facts. Jamais pour un plat maison : il n'y est pas. Si l'outil renvoie une erreur ou zéro résultat, estime et dis que c'est une estimation.
- \`replace_meal\` dès qu'il n'aime pas un repas ou n'a pas les ingrédients. \`move_meal\` pour un imprévu d'agenda. \`regenerate_day\` pour refaire une journée entière — les repas verrouillés restent, ne propose rien pour leurs créneaux.
- \`add_food_log_entry\` quand il te raconte ce qu'il a mangé hors plan. \`log_planned_meal\` quand il a mangé ce qui était prévu.
- \`shopping_list\` pour ses courses, \`update_inventory\` pour ce qu'il a en stock, \`suggest_recipes_from_ingredients\` pour cuisiner avec ce qui reste.
- Une PHOTO est jointe à son message : choisis l'outil selon ce qu'il décrit — une assiette ou un plat → \`analyze_plate\` ; un frigo ou un placard → \`analyze_fridge\` ; une étiquette ou un emballage → \`read_nutrition_label\` ; des courses ou un ticket → \`analyze_groceries\`. Si tu ne peux pas trancher, demande-lui ce que c'est plutôt que de deviner.
- AUCUNE analyse de photo n'est enregistrée par toi. Dis-lui juste de vérifier et valider la fiche affichée. Si l'outil renvoie une liste vide, NE LUI PARLE PAS de fiche à valider : il n'y en a aucune à l'écran. Dis ce que tu vois, ce qui manque, et propose une meilleure photo ou les chiffres à la main.
- \`ask_coach\` seulement quand la réponse dépend vraiment de l'entraînement (quelle séance arrive, son intensité). Jamais pour ce qui est déjà écrit au-dessus. Une seule question à la fois, avec le minimum de contexte : il ne voit pas votre conversation.`;
}

// ---------------------------------------------------------------------------
// Agent + functions
// ---------------------------------------------------------------------------

/** Built on first use: the API key only exists in the deployment, not at import time. */
let agent: Agent | undefined;
function chef() {
  // `components.chefAgent`, NOT `components.agent`: the Chef has its own instance
  // of the component (see convex.config.ts), so its threads can never show up in
  // the Coach's conversation list. Every call below passes the same one.
  agent ??= new Agent(components.chefAgent, {
    name: "Chef FitCrew",
    languageModel: languageModel(),
    instructions:
      "Tu es « Le Chef », l'assistant nutrition de l'app FitCrew. Tu réponds en français, en tutoyant.",
    // The component already knows the userId of every call it makes, so this one
    // hook covers the whole chef — all 8 steps of every turn, tools included.
    usageHandler: async (ctx, { userId, usage, providerMetadata, model }) => {
      await ctx.runMutation(internal.aiUsage.record, {
        userId: userId as Id<"users"> | undefined,
        feature: "chef",
        model,
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        reasoningTokens: usage.outputTokenDetails?.reasoningTokens,
        costUsd: costUsdFrom(providerMetadata),
      });
    },
  });
  return agent;
}

/** A thread is the user's or it doesn't exist for them. */
async function authorize(ctx: QueryCtx | ActionCtx, threadId: string, userId: Id<"users">) {
  const thread = await getThreadMetadata(ctx, components.chefAgent, { threadId });
  if (thread.userId !== userId) throw new Error("Conversation introuvable");
}

/**
 * The user's latest chef conversation. `null` means the profile row doesn't exist
 * yet (first sign-in, webhook in flight) — this query is reactive, so the client
 * just waits. `{ threadId: null }` means they've never talked to it.
 */
export const thread = query({
  // Epoch ms of the caller's local midnight. A timestamp, not a date string:
  // comparing `_creationTime` against a UTC-derived date would discard a thread
  // started at 00:30 in Bordeaux, which is 22:30 UTC the day before.
  args: { dayStart: v.number() },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const threads = await ctx.runQuery(components.chefAgent.threads.listThreadsByUserId, {
      userId: user._id,
      order: "desc",
      paginationOpts: { cursor: null, numItems: 1 },
    });

    const latest = threads.page[0];
    if (!latest) return { threadId: null };

    // One conversation per day, same reasoning as the coach: the chef's real
    // state — profile, targets, this week's plan, today's log — is rebuilt into
    // the system prompt on every call, so yesterday's transcript is cost without
    // value.
    return { threadId: latest._creationTime >= args.dayStart ? latest._id : null };
  },
});

/** Untitled on purpose: the first user message names it (see `ensureTitle`). */
export const newThread = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);
    return await createThread(ctx, components.chefAgent, { userId: user._id });
  },
});

/** The sidebar's list. Paginated — nobody needs every conversation at once. */
export const threads = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return { page: [], isDone: true, continueCursor: "" };
    const result = await ctx.runQuery(components.chefAgent.threads.listThreadsByUserId, {
      userId: user._id,
      order: "desc",
      paginationOpts: args.paginationOpts,
    });
    return {
      ...result,
      page: result.page.map((t) => ({
        _id: t._id,
        _creationTime: t._creationTime,
        title: t.title ?? null,
      })),
    };
  },
});

export const renameThread = mutation({
  args: { threadId: v.string(), title: v.string() },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    await authorize(ctx, args.threadId, user._id);
    await updateThreadMetadata(ctx, components.chefAgent, {
      threadId: args.threadId,
      patch: { title: args.title.slice(0, 80) },
    });
    return null;
  },
});

/** Real delete, not archive: the component deletes the messages too, in pages. */
export const deleteThread = mutation({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    await authorize(ctx, args.threadId, user._id);
    await ctx.runMutation(components.chefAgent.threads.deleteAllForThreadIdAsync, {
      threadId: args.threadId as GenericId<"threads">,
    });
    return null;
  },
});

/**
 * First user message becomes the title, truncated. No LLM call: a substring is a
 * perfectly good label and the whole point of this app's prompt budget is not
 * paying for prose nobody reads.
 */
async function ensureTitle(ctx: ActionCtx, threadId: string, prompt: string) {
  const meta = await getThreadMetadata(ctx, components.chefAgent, { threadId });
  if (meta.title) return;
  const title = prompt.length > 40 ? `${prompt.slice(0, 39).trimEnd()}…` : prompt;
  await updateThreadMetadata(ctx, components.chefAgent, { threadId, patch: { title } });
}

export const listMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    await authorize(ctx, args.threadId, user._id);
    const paginated = await listUIMessages(ctx, components.chefAgent, args);
    const streams = await syncStreams(ctx, components.chefAgent, args);
    // Machine-generated turns are persisted as user messages; without this they
    // render as the user's own bubbles (see `KICKOFF`).
    const page = paginated.page.filter(
      (message) => !(message.role === "user" && isSentinel(message.text, CHEF_ATTACHMENTS)),
    );
    return { ...paginated, page, streams };
  },
});

/**
 * Called straight from the client so the user's auth reaches the tools — they
 * write through the same authenticated mutations the UI uses. The reply arrives
 * over the `listMessages` subscription, so the caller need not await this.
 */
export const send = action({
  args: {
    threadId: v.string(),
    prompt: v.string(),
    today: v.string(),
    /** Photos joined to this message. Kept out of the prompt so the user's bubble
     * stays readable — the ids reach the model as unsaved context. */
    storageIds: v.optional(v.array(v.id("_storage"))),
  },
  handler: async (ctx, args) => {
    await stream(ctx, args.threadId, args.today, {
      prompt: args.prompt,
      ...(args.storageIds?.length && {
        messages: [
          {
            role: "user" as const,
            // Unlike the coach there are four analysis tools, so the marker says
            // to CHOOSE rather than naming one: only the user's own words say
            // whether this is a plate, a fridge, a label or a shopping bag. That
            // choice stays with the model — guessing the intent server-side from
            // a filename would be worse than asking.
            content: `${CHEF_ATTACHMENTS}, à analyser avec l'outil qui correspond à ce que le user décrit — analyze_plate, analyze_fridge, read_nutrition_label ou analyze_groceries : ${args.storageIds.join(", ")})`,
          },
        ],
      }),
    });
    return null;
  },
});

/** The kickoff turn. Why it is persisted and hidden: see `convex/sentinels.ts`. */

export const greet = action({
  args: { threadId: v.string(), today: v.string() },
  handler: async (ctx, args) => {
    await stream(ctx, args.threadId, args.today, {
      messages: [{ role: "user", content: KICKOFF }],
    });
    return null;
  },
});

async function stream(
  ctx: ActionCtx,
  threadId: string,
  today: string,
  promptArgs:
    | { prompt: string; messages?: { role: "user"; content: string }[] }
    | { messages: { role: "user"; content: string }[] },
) {
  const { user, dashboard, inventory } = await ctx.runQuery(internal.chef.context, { today });
  await authorize(ctx, threadId, user._id);
  // After authorize, never before: this writes to the thread.
  if ("prompt" in promptArgs) await ensureTitle(ctx, threadId, promptArgs.prompt);

  const result = await chef().streamText(
    ctx,
    { userId: user._id, threadId },
    {
      ...promptArgs,
      system: systemPrompt(user, dashboard, inventory, today),
      tools: chefTools(today),
      // A tool call must be followed by the chef's own words, so one step is
      // never enough (the AI SDK default).
      stopWhen: stepCountIs(8),
      // `usage.include` makes OpenRouter return the real cost; `user` is its
      // anti-abuse identifier, not analytics — the numbers come from usageHandler.
      providerOptions: { openrouter: { user: user._id, usage: { include: true } } },
    },
    {
      saveStreamDeltas: true,
      // The component default is 100 recent messages, re-sent on every turn.
      // 20 is plenty: the chef's actual state — profile, targets, this week's
      // plan, today's log — lives in Convex and is rebuilt into the system prompt
      // each call, so old transcript is chatter, not memory.
      contextOptions: { recentMessages: 20 },
    },
  );
  await result.consumeStream();
}
