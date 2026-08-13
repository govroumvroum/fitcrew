import { z } from "zod";

/**
 * The Chef's tool inputSchemas, zod only — no Convex server imports, so the
 * client can `z.infer` them for the cards without pulling the backend in.
 * Same contract as `toolSchemas.ts`: strict structured output cannot express
 * "optional", so anything that may be absent is `.nullable()` and the tool's
 * `execute` strips the nulls before it reaches a mutation.
 */

export const zMealSlot = z.enum(["petit_dejeuner", "dejeuner", "diner", "collation"]);

export const zMacros = z.object({
  calories: z.number().min(0).describe("kcal, estimation"),
  protein: z.number().min(0).describe("grammes de protéines"),
  carbs: z.number().min(0).describe("grammes de glucides"),
  fat: z.number().min(0).describe("grammes de lipides"),
});

export const zSaveNutritionProfile = z.object({
  goal: z.enum(["perte", "maintien", "prise"]),
  age: z.number().int().min(10).max(100),
  sex: z.enum(["h", "f"]),
  heightCm: z.number().min(100).max(250),
  weightKg: z.number().min(30).max(300),
  activityLevel: z
    .enum(["sedentaire", "leger", "modere", "actif", "tres_actif"])
    .describe("Activité hors muscu, dans la journée"),
  diet: z.string().nullable().describe('"végétarien", "halal", "sans lactose"… null si aucun'),
  allergies: z.array(z.string()).describe("Contrainte DURE. Tableau vide si aucune"),
  excluded: z.array(z.string()).describe("Aliments qu'il refuse. Contrainte DURE. Vide si aucun"),
  mealsPerDay: z.number().int().min(1).max(6),
  budget: z.string().nullable().describe('"serré", "normal"… ses mots, null s\'il n\'en parle pas'),
  cookMinutes: z.number().int().min(0).max(240).nullable().describe("Temps de cuisine par repas"),
  people: z.number().int().min(1).max(12).nullable().describe("Nombre de couverts"),
});

/**
 * No arguments, deliberately: the questions ARE the nutrition profile above, and
 * they are fixed. Letting the model pass its own list of questions would be a
 * generic form engine, which is explicitly out of scope.
 */
export const zAskQuestionnaire = z.object({});

export const zPlannedMeal = z.object({
  slot: zMealSlot,
  name: z.string().describe('Ex : "Poulet rôti, patate douce, brocolis"'),
  ingredients: z
    .array(z.object({ name: z.string(), quantity: z.string().describe('"200 g", "1 cuillère"') }))
    .min(1),
  steps: z.array(z.string()).min(1).describe("Étapes courtes, à l'impératif"),
  prepMinutes: z.number().int().min(0).max(240),
  macros: zMacros,
  mealPrep: z
    .string()
    .nullable()
    .describe('"se prépare la veille", "double la quantité pour demain"… null si rien à dire'),
});

export const zGenerateMealPlan = z.object({
  days: z
    .array(z.object({ date: z.string(), meals: z.array(zPlannedMeal).min(1).max(6) }))
    .min(1)
    .max(7),
});

export const zReplaceMeal = z.object({
  date: z.string(),
  slot: zMealSlot,
  meal: zPlannedMeal,
});

const zSlotRef = z.object({ date: z.string(), slot: zMealSlot });

export const zMoveMeal = z.object({ from: zSlotRef, to: zSlotRef });

export const zRegenerateDay = z.object({
  date: z.string(),
  meals: z.array(zPlannedMeal).min(1).max(6).describe("Les repas des créneaux NON verrouillés"),
});

export const zAddFoodLogEntry = z.object({
  date: z.string(),
  slot: zMealSlot,
  name: z.string(),
  quantity: z.string().nullable().describe('"1 bol", "150 g"… null si non précisé'),
  macros: zMacros,
});

export const zLogPlannedMeal = z.object({ date: z.string(), slot: zMealSlot });

export const zUpdateInventory = z.object({
  items: z.array(z.object({ name: z.string(), quantity: z.string().nullable() })).min(1),
  mode: z
    .enum(["add", "replace"])
    .describe('"replace" seulement quand on refait l\'inventaire complet du frigo'),
});

export const zSuggestRecipes = z.object({
  ingredients: z.array(z.string()).min(1).describe("Ce qu'il a réellement sous la main"),
  constraints: z
    .array(z.string())
    .describe("Allergies, exclusions, régime, temps dispo. Vide si aucune"),
});

export const zLookupFood = z.object({
  query: z.string().describe("Nom du produit ou code-barres (8 à 14 chiffres)"),
});

/** The four vision tools share it: one attached photo, already uploaded. */
export const zAnalyzeImage = z.object({
  storageId: z.string().describe("L'id de la photo jointe au message"),
});

export const zAskCoach = z.object({
  question: z.string().describe("Une seule question, précise, sur l'entraînement"),
  context: z
    .string()
    .describe("Le strict nécessaire pour qu'il réponde. Pas l'historique de la conversation"),
});
