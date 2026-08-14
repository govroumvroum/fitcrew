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
  zAskQuestionnaire,
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
import { CONTEXT_OPTIONS, languageModel } from "./model";
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

/**
 * What `stream` actually injects, and nothing more: the user and the nutrition
 * profile. Today's meals, the log, hydration and the fridge are read by
 * `read_today` / `read_inventory` when the model asks for them, so a plain turn
 * no longer pays for them.
 *
 * Return type spelled out for the same circularity reason as `context` above.
 */
export const streamContext = internalQuery({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ user: Doc<"users">; profile: Doc<"nutritionProfiles"> | null }> => ({
    user: await requireCurrentUser(ctx),
    profile: await ctx.runQuery(api.nutrition.profile, {}),
  }),
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
 *
 * Neither date may reach a tool DESCRIPTION, though. Tool definitions are part of
 * the prefix the provider caches, so a date-stamped description invalidates the
 * cache every midnight just as surely as a date-stamped system prompt. Inside
 * `execute` they are invisible to the model, which is where every use below is;
 * the dates the model needs to WRITE are at the end of the system prompt.
 */
function chefTools(today: string) {
  const monday = weekStart(today);
  const week = { weekStart: monday };

  return {
    ask_questionnaire: createTool({
      description:
        "Affiche la carte de profil nutrition : c'est TOI qui écris les questions ET les réponses probables, et le user tape sur une puce au lieu d'écrire. Adapte-les à ce que la conversation a déjà révélé (s'il a dit vouloir sécher, mets « perte de poids » en premier) et n'inclus pas une question dont tu connais déjà la réponse. 2 à 4 options par question, jamais plus, et une option = une valeur que le champ accepte (\"prise\", pas « prise de masse »). age, heightCm et weightKg n'ont AUCUNE option : ils se saisissent au clavier. allergies et excluded sont les seules en multiple. N'enregistre RIEN par lui-même — c'est la validation de la carte qui écrit le profil et calcule ses cibles.",
      inputSchema: zAskQuestionnaire,
      execute: async (ctx: ToolCtx, { questions }) => {
        // The component injects `threadId` into every tool ctx it builds, but
        // types it optional because a tool can also run outside a thread. A
        // throw, not a fallback: the card sends its echo message back into this
        // conversation, and guessing which one would send it to the wrong place.
        if (!ctx.threadId) throw new Error("ask_questionnaire appelé hors conversation");
        return {
          ...(await ctx.runMutation(internal.questionnaires.open, {
            threadId: ctx.threadId,
            // Same null-stripping convention as the other tools: strict output
            // can't say "absent", so `multiple: null` is just « non ».
            questions: questions.map(({ multiple, ...q }) => ({
              ...q,
              multiple: multiple === true,
            })),
          })),
          note: "Le formulaire est à l'écran. Attends qu'il te dise l'avoir rempli — ne repose PAS les questions en prose par-dessus, et n'appelle PAS save_nutrition_profile : la validation du formulaire écrit le profil et ses cibles toute seule. SAUF s'il te dit qu'il ne veut pas le remplir : le formulaire est alors fermé, et c'est le seul cas où tu reprends les questions une par une, en prose.",
        };
      },
    }),

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

    read_today: createTool({
      description:
        "L'état de la journée du user : repas prévus au plan (avec leur verrou), ce qu'il a déjà loggué, les totaux du jour, ce qu'il reste sur ses cibles, et son hydratation. Rien de tout ça n'est dans ton prompt — appelle cet outil avant de parler de ce qu'il a mangé, de ce qu'il lui reste à manger, de son eau, ou avant de proposer un repas pour aujourd'hui.",
      inputSchema: z.object({}),
      execute: async (ctx: ToolCtx) => {
        // Only the dashboard: the fridge is `read_inventory`'s business.
        const dashboard: Dashboard = await ctx.runQuery(api.nutrition.dashboard, { today });
        const p = dashboard.profile;
        return {
          result: "ok" as const,
          date: today,
          weekStart: dashboard.weekStart,
          hasPlanThisWeek: dashboard.hasPlan,
          plannedMeals: dashboard.todayMeals.map((m) => ({
            slot: SLOT_LABEL[m.slot],
            name: m.name,
            macros: m.macros,
            prepMinutes: m.prepMinutes,
            // `regenerate_day` skips locked slots, so the flag has to come back
            // with the meals or the model proposes into a slot it can't write.
            locked: m.locked === true,
          })),
          loggedMeals: dashboard.log.map((e) => ({
            slot: SLOT_LABEL[e.slot],
            name: e.name,
            quantity: e.quantity ?? null,
            macros: e.macros,
          })),
          // Summed and subtracted server-side on purpose: a model doing this
          // arithmetic is a known bug class.
          consumed: dashboard.consumed,
          // The profile is the only thing `remaining` needs, so it's the only
          // thing that goes null without one. The rest of the day is real
          // without a profile — `addLogEntry` never required one, and hiding a
          // meal the user logged in the app mid-questionnaire is a regression.
          remaining: p
            ? {
                calories: p.targets.calories - dashboard.consumed.calories,
                protein: p.targets.protein - dashboard.consumed.protein,
                carbs: p.targets.carbs - dashboard.consumed.carbs,
                fat: p.targets.fat - dashboard.consumed.fat,
              }
            : null,
          hydrationMl: dashboard.hydrationMl,
          note: p
            ? null
            : "Pas encore de profil nutrition : aucune cible, donc pas de « restant » (remaining est null). Le reste de la journée est bien réel. Appelle ask_questionnaire pour lui afficher le formulaire de profil.",
          hints:
            "Une liste vide veut dire « rien », pas « je ne sais pas » : ne complète pas de mémoire. Les totaux et le restant sont déjà calculés, ne refais pas les soustractions. Tous ces chiffres sont des estimations.",
        };
      },
    }),

    read_inventory: createTool({
      description:
        "Ce que le user a dans son frigo et ses placards. Ce n'est pas dans ton prompt — appelle cet outil avant de proposer de cuisiner avec ce qu'il a, avant suggest_recipes_from_ingredients, et avant de lui dire qu'il lui manque quelque chose.",
      inputSchema: z.object({}),
      execute: async (ctx: ToolCtx) => {
        // Only the fridge: the day is `read_today`'s business.
        const inventory: Doc<"inventory">[] = await ctx.runQuery(api.nutrition.inventory, {});
        if (inventory.length === 0) {
          return {
            result: "empty" as const,
            note: "Inventaire vide — ça veut dire qu'il n'a rien saisi, pas qu'il n'a rien chez lui. Demande-lui, ou propose analyze_fridge.",
          };
        }
        return {
          result: "found" as const,
          items: inventory.map((i) => ({ name: i.name, quantity: i.quantity ?? null })),
          note: "Saisi par le user ou par une photo validée : ça peut être incomplet ou périmé.",
        };
      },
    }),

    generate_meal_plan: createTool({
      description:
        "Génère et enregistre les repas de la semaine EN COURS. Chaque date doit tomber entre le lundi et le dimanche de cette semaine — les deux sont écrits à la fin de ton system prompt. Écrase le plan existant de la semaine.",
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
        date: z
          .string()
          .describe("YYYY-MM-DD. La date d'aujourd'hui est donnée à la fin de ton system prompt"),
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
        date: z
          .string()
          .describe("YYYY-MM-DD. La date d'aujourd'hui est donnée à la fin de ton system prompt"),
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
        "Consulte le coach sportif quand la réponse dépend VRAIMENT de l'entraînement (quelle séance arrive, son intensité, les muscles travaillés). Jamais pour ce que tes propres outils de lecture savent déjà. Il n'a aucun outil et ne peut pas te reconsulter : une question, une réponse.",
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

/**
 * The volatile blocks — today's planned meals, today's log, hydration, the fridge
 * — left this string for `read_today` / `read_inventory`, because a cache hit
 * needs a byte-identical prefix and those changed on every logged bite.
 *
 * ALLERGIES, EXCLUDED FOODS and the daily targets stay INJECTED, deliberately.
 * The hard-constraint rule below is only enforceable because the lists are right
 * here; behind a tool, honouring an allergy would depend on the model remembering
 * to call it. That is a health risk, not a token trade — and both lists are tiny
 * and near-immutable, so they cost the cache nothing. Do not move them.
 *
 * The dates are the only dynamic values left and they sit at the very END (see
 * the comment above the return).
 */
function systemPrompt(user: Doc<"users">, profile: Doc<"nutritionProfiles"> | null, today: string) {
  const p = profile;
  const monday = weekStart(today);

  return `Tu es « Le Chef », l'assistant nutrition de ${user.name} dans l'app FitCrew. Tu parles français, tu tutoies, tu es bref : c'est une conversation sur un téléphone, pas un article de blog. 2-6 phrases par message, sauf quand tu présentes un menu.

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

Le profil est déjà fait. S'il veut le refaire ou change de poids/objectif, appelle \`ask_questionnaire\` : le formulaire s'ouvre pré-rempli avec ce qu'il a déjà. Sa validation réécrit le profil et les cibles — n'appelle pas \`save_nutrition_profile\` derrière.
S'il refuse le formulaire ou l'abandonne, reprends les questions une par une, récapitule, et là OUI, appelle \`save_nutrition_profile\` à la fin : sans validation du formulaire, rien n'a été écrit.`
    : `PREMIÈRE CONVERSATION — LE PROFIL N'EXISTE PAS ENCORE
Tu ne peux rien calculer sans lui. Déroule exactement ça :
- TON TOUT PREMIER MESSAGE fait les deux à la fois : une ou deux phrases d'accueil ET l'appel à \`ask_questionnaire\`, dans le MÊME tour. N'attends pas qu'il te réponde pour l'appeler — il n'a rien à répondre, la carte EST ce que tu lui demandes. Elle s'affiche dans la conversation, avec toutes les questions d'un coup.
- C'est toi qui écris ces questions ET les réponses probables : il tape sur une puce plutôt que d'écrire. 2 à 4 options par question, adaptées à ce qu'il a déjà dit ; age, heightCm et weightKg n'en prennent aucune (il les saisit) ; allergies et excluded sont en multiple. Une question par champ de la liste ci-dessous.
- Tant qu'il est à l'écran, tu ne poses AUCUNE de ces questions en prose. Tu attends qu'il te dise l'avoir rempli.
- Quand il te le dit : le profil et les cibles sont DÉJÀ enregistrés, n'appelle pas \`save_nutrition_profile\`. Annonce ses cibles en précisant que ce sont des estimations, puis propose de générer sa semaine de repas.
- S'il refuse le formulaire ou l'abandonne, et SEULEMENT dans ce cas : pose les questions UNE PAR UNE, jamais deux dans le même message, en rebondissant sur chaque réponse. Puis récapitule, demande si c'est bon, et appelle \`save_nutrition_profile\` une fois validé.
${QUESTIONS}`
}

CE PROMPT NE CONTIENT PAS SA JOURNÉE — TU VAS LA CHERCHER
Ses repas prévus, ce qu'il a déjà mangé, ses totaux du jour, son hydratation et son frigo ne sont PAS écrits ici. Tu y as accès, mais par outil, et un outil qu'on n'appelle pas ne renvoie rien.
- \`read_today\` : repas prévus (avec leur verrou), journal du jour, totaux, ce qu'il reste sur ses cibles, hydratation, et s'il existe un plan cette semaine. Appelle-le avant de parler de ce qu'il a mangé, de ce qu'il lui reste à manger, de son eau, ou de proposer un repas pour aujourd'hui — et avant \`generate_meal_plan\`, pour savoir si un plan existe déjà : générer ÉCRASE la semaine en cours, donc s'il en a un, dis-le et demande avant d'écraser.
- \`read_inventory\` : son frigo et ses placards. Appelle-le avant de proposer de cuisiner avec ce qu'il a.
- Les totaux et le restant arrivent DÉJÀ calculés : ne refais pas les additions ni les soustractions.
- Ne dis JAMAIS que tu n'as pas accès à sa journée, et n'invente ni un repas prévu, ni un chiffre du journal : tout ça se lit.
- Ce que tu as déjà lu dans cette conversation reste valable : n'appelle pas deux fois le même outil pour la même chose. Mais après une écriture (\`add_food_log_entry\`, \`log_planned_meal\`, \`generate_meal_plan\`, \`replace_meal\`, \`move_meal\`, \`regenerate_day\`, \`update_inventory\`) ou s'il dit avoir validé quelque chose dans l'app, relis avant de commenter.

RÈGLES NON NÉGOCIABLES
- LES ALLERGIES ET LES ALIMENTS EXCLUS SONT DES CONTRAINTES DURES. Une proposition qui en contient un est un bug, pas un choix de style. Vérifie chaque ingrédient de chaque repas avant de le proposer, y compris les ingrédients cachés (le beurre contient du lactose, la sauce soja contient du blé).
- Chaque chiffre en kcal ou en macros est une ESTIMATION et tu le présentes comme telle. Jamais « ton déjeuner fait 612 kcal » — « ~600 kcal, à peu près ».
- TU N'ES NI MÉDECIN NI DIÉTÉTICIEN. Pathologie (diabète, cholestérol, thyroïde…), symptôme, médicament, trouble du comportement alimentaire, grossesse, allaitement, régime d'un enfant : tu dis clairement que ça demande un professionnel de santé (médecin, diététicien-nutritionniste) et tu NE PRODUIS PAS de plan pour ça. Tu peux continuer à parler cuisine, pas soigner.
- Tu ne fixes jamais un objectif de poids ni un déficit agressif de toi-même. Les cibles viennent du calcul ci-dessus.

RÈGLES PLAN (quand tu appelles generate_meal_plan)
- Les dates sont celles de la semaine en cours, entre le lundi et le dimanche donnés dans la section DATES en fin de prompt. Ne calcule aucune autre semaine.
- ${p ? `${p.mealsPerDay} repas par jour` : "Le nombre de repas de son profil"}, et le total journalier tourne autour de ses cibles. Pas au kcal près : c'est une estimation.
- Respecte le temps de cuisine et le budget. Réutilise les mêmes ingrédients sur plusieurs repas — c'est moins cher et ça évite le gaspillage. Utilise \`mealPrep\` quand un plat se prépare la veille ou en double.
- Sers son entraînement : plus de glucides autour des séances, protéines réparties sur la journée.
- Après \`generate_meal_plan\`, résume la semaine dans ton message, jour par jour : le user ne voit que ce que tu écris.

AUTRES OUTILS
- \`lookup_food\` AVANT d'estimer un produit industriel, une marque ou un code-barres. Préfère toujours ces chiffres à ton estimation, et dis qu'ils viennent d'Open Food Facts. Jamais pour un plat maison : il n'y est pas. Si l'outil renvoie une erreur ou zéro résultat, estime et dis que c'est une estimation.
- \`replace_meal\` dès qu'il n'aime pas un repas ou n'a pas les ingrédients. \`move_meal\` pour un imprévu d'agenda. \`regenerate_day\` pour refaire une journée entière — les repas verrouillés restent, ne propose rien pour leurs créneaux. Pour aujourd'hui, \`read_today\` te dit lesquels sont verrouillés ; pour un autre jour, tu ne le sais pas, alors demande-lui avant de tout refaire.
- \`add_food_log_entry\` quand il te raconte ce qu'il a mangé hors plan. \`log_planned_meal\` quand il a mangé ce qui était prévu.
- \`shopping_list\` pour ses courses, \`read_inventory\` pour voir ce qu'il a en stock, \`update_inventory\` pour le mettre à jour, \`suggest_recipes_from_ingredients\` pour cuisiner avec ce qui reste (lis l'inventaire d'abord).
- Une PHOTO est jointe à son message : choisis l'outil selon ce qu'il décrit — une assiette ou un plat → \`analyze_plate\` ; un frigo ou un placard → \`analyze_fridge\` ; une étiquette ou un emballage → \`read_nutrition_label\` ; des courses ou un ticket → \`analyze_groceries\`. Si tu ne peux pas trancher, demande-lui ce que c'est plutôt que de deviner.
- AUCUNE analyse de photo n'est enregistrée par toi. Dis-lui juste de vérifier et valider la fiche affichée. Si l'outil renvoie une liste vide, NE LUI PARLE PAS de fiche à valider : il n'y en a aucune à l'écran. Dis ce que tu vois, ce qui manque, et propose une meilleure photo ou les chiffres à la main.
- \`ask_coach\` seulement quand la réponse dépend vraiment de l'entraînement (quelle séance arrive, son intensité). Jamais pour son profil, qui est ci-dessus, ni pour sa journée ou son frigo, que \`read_today\` et \`read_inventory\` te donnent. Une seule question à la fois, avec le minimum de contexte : il ne voit pas votre conversation.

DATES
Nous sommes le ${today}. La semaine en cours va du lundi ${monday} au dimanche ${shift(monday, 6)}.`;
  // ^ Deliberately the LAST lines of the prompt. They're the only values that
  // change from one turn to the next, and the provider's prompt cache matches on
  // a prefix: anything after the first differing byte is refused a cache hit. At
  // the end that costs two uncached lines instead of the whole prompt. They can't
  // leave the prompt entirely — a model doing calendar arithmetic is a bug
  // factory, and a plan filed under the wrong week is invisible to every reader.
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
    // state lives in the database, not in the transcript — profile and targets are
    // rebuilt into the system prompt on every call, and this week's plan, today's
    // log and the fridge are fetched on demand by `read_today` / `read_inventory`.
    // So yesterday's transcript is cost without value.
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
    /**
     * For a message the app sends ON the user's behalf — today only the
     * questionnaire's recap echo. It is a real, visible user turn (unlike a
     * sentinel), but it must not name the conversation: « le premier message de
     * l'utilisateur nomme la conversation » means HIS words, and on the
     * onboarding path the echo is the first user-role message there is.
     *
     * Optional, so an already-loaded bundle that never sends it keeps today's
     * behaviour exactly.
     */
    skipTitle: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await stream(
      ctx,
      args.threadId,
      args.today,
      {
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
      },
      args.skipTitle === true,
    );
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
  skipTitle = false,
) {
  // Only the user and the profile are read — for real: `streamContext` reads
  // nothing else. Today's meals, the log, hydration and the fridge are fetched
  // by `read_today` / `read_inventory`, when they're called. `internal.chef.context`
  // stays exported and unchanged for older bundles.
  const { user, profile } = await ctx.runQuery(internal.chef.streamContext, {});
  await authorize(ctx, threadId, user._id);
  // After authorize, never before: this writes to the thread.
  if ("prompt" in promptArgs && !skipTitle) await ensureTitle(ctx, threadId, promptArgs.prompt);

  const result = await chef().streamText(
    ctx,
    { userId: user._id, threadId },
    {
      ...promptArgs,
      system: systemPrompt(user, profile, today),
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
      contextOptions: CONTEXT_OPTIONS,
    },
  );
  await result.consumeStream();
}
