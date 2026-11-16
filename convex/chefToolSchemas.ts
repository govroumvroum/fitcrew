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
 * One ingredient (#138). `amount` + `unit` make it count: by weight (g, ml) or
 * by the whole piece. `per` is the model's guess, used only for an ingredient
 * the user's food reference doesn't know yet.
 */
export const zIngredient = z.object({
  name: z.string(),
  quantity: z.string().describe('"200 g", "2", "1 cuillère"'),
  // Coerced: one live week (#138) had the model write "2" for 2 eggs, and the
  // whole 21-meal call failed validation and was paid twice.
  amount: z.coerce
    .number()
    .min(0)
    .nullable()
    .describe(
      "La quantité en nombre : grammes (unit g), millilitres (ml) ou pièces ENTIÈRES (piece). null seulement pour sel, poivre, épices, herbes.",
    ),
  unit: z
    .enum(["g", "ml", "piece"])
    .nullable()
    .describe(
      '"piece" pour ce qui s\'achète et se mange à l\'unité et ne se coupe pas : pain burger, tortilla, pita, œuf, banane. Tout le reste au poids : "g" (ou "ml" pour un liquide).',
    ),
  scalable: z
    .boolean()
    .nullable()
    .describe(
      "true pour ce qui fait varier la portion : la viande, le poisson, les féculents, la garniture. false pour le reste (légumes, sauce, pièces).",
    ),
  per: zMacros
    .nullable()
    .describe(
      "Tes valeurs estimées POUR 100 g / 100 ml (unit g ou ml) ou POUR UNE pièce (unit piece). Elles ne servent que si sa référence d'aliments ne connaît pas encore l'ingrédient.",
    ),
});

export const zPlannedMeal = z.object({
  slot: zMealSlot,
  name: z.string().describe('Ex : "Poulet rôti, patate douce, brocolis"'),
  ingredients: z
    .array(zIngredient)
    .describe(
      'Tels qu\'on les achète, poids CRU / SEC : "Riz" 80 g (sec), jamais "Riz cuit" 250 g. Pâtes, riz, semoule, quinoa, légumineuses sèches, viande et poisson : toujours le poids avant cuisson, et un nom sans "cuit" ni "sec" pour que la liste de courses les regroupe. Un même produit porte EXACTEMENT le même nom dans tous les repas de la semaine, avec le morceau précis : "Blanc de poulet" partout, jamais "Poulet" dans un repas et "Blanc de poulet" dans un autre. Avant d\'écrire un ingrédient, reprends le nom déjà utilisé dans le plan s\'il y est. Pour UNE personne. Vide pour un repas tiré d\'un batch (batchId) : il prend sa part de la marmite.',
    ),
  steps: z
    .array(z.string())
    .min(1)
    .describe(
      "Étapes dans l'ordre, à l'infinitif, chacune exécutable seule : les quantités de la liste d'ingrédients, le feu (doux, moyen, vif), les temps en minutes, la température du four, et un repère de cuisson (« jusqu'à ce que… », « cuit à cœur »). 4 à 8 étapes, une à deux phrases chacune.",
    ),
  prepMinutes: z.number().int().min(0).max(240),
  macros: zMacros.describe(
    "Les macros VISÉES pour ce repas (la portion qu'il mange). Le serveur ajuste les quantités réglables pour tenir ces kcal avec les valeurs de sa référence d'aliments.",
  ),
  mealPrep: z
    .string()
    .nullable()
    .describe('"se prépare la veille"… null si rien à dire. Un batch passe par batchId, pas par ce texte.'),
  batchId: z
    .string()
    .nullable()
    .describe("L'id d'un batch de la semaine si ce repas en est une part, sinon null"),
  share: z.coerce
    .number()
    .min(0)
    .max(1)
    .nullable()
    .describe(
      "Ta part estimée de la marmite (0,33 = un tiers). Recalculée à partir des macros visées. null hors batch",
    ),
});

/** A pot cooked once and eaten on several days (#138), for one person. */
export const zBatch = z.object({
  id: z.string().describe('Court et unique dans la semaine : "chili", "curry"'),
  name: z.string(),
  cookDate: z.string().describe("Le jour où il cuisine la marmite, une des dates du plan (AAAA-MM-JJ)"),
  ingredients: z.array(zIngredient).min(1).describe("Pour TOUTE la marmite, poids cru/sec"),
  steps: z.array(z.string()).min(1).describe("La recette de TOUTE la marmite"),
  macros: zMacros.describe("Ton estimation pour TOUTE la marmite"),
  cookedGrams: z.coerce
    .number()
    .min(0)
    .nullable()
    .describe("Poids estimé de la marmite une fois cuite, en grammes"),
});

export const zGenerateMealPlan = z.object({
  days: z
    .array(z.object({ date: z.string(), meals: z.array(zPlannedMeal).min(1).max(6) }))
    .min(1)
    .max(7),
  batches: z
    .array(zBatch)
    .max(4)
    .nullable()
    .describe("Les marmites de la semaine, chacune mangée par au moins 2 repas (batchId). null si aucune"),
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

/**
 * The two weeks the Chef works on (#126). Named, not a date: the server turns it
 * into a Monday, so the model never does calendar arithmetic.
 */
export const zPlanWeek = z
  .enum(["current", "next"])
  .describe(
    '"current" = la semaine en cours, "next" = la semaine prochaine. Les deux sont datées dans la section DATES',
  );

export const zShoppingList = z.object({ week: zPlanWeek });

export const zReadPlan = z.object({ week: zPlanWeek });

export const zAddFoodLogEntry = z.object({
  date: z.string(),
  slot: zMealSlot,
  name: z.string(),
  quantity: z.string().nullable().describe('"1 bol", "150 g"… null si non précisé'),
  macros: zMacros,
});

export const zLogPlannedMeal = z.object({
  date: z.string(),
  slot: zMealSlot,
  // #138: « j'en ai mangé que la moitié » → 0.5. null = comme prévu.
  factor: z
    .number()
    .min(0.25)
    .max(3)
    .nullable()
    .describe(
      "La part réellement mangée par rapport au repas prévu : 0.5 = la moitié, 1.25 = un quart de plus, (n+1)/n pour une pièce de plus sur n. null = comme prévu",
    ),
  quantity: z
    .string()
    .nullable()
    .describe('Ce qu\'il a dit, en court : "la moitié", "3 tacos". null si comme prévu'),
});

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

/** `save_food_ref` (#138): a label read or an Open Food Facts product picked. */
export const zSaveFoodRef = z.object({
  name: z
    .string()
    .describe("Le nom de l'ingrédient tel qu'il l'écrit dans ses repas (\"Tortillas de blé\")"),
  per100: zMacros.nullable().describe("Pour 100 g / 100 ml, null si l'étiquette ne le donne pas"),
  perPiece: zMacros.nullable().describe("Pour UNE pièce (une tortilla, un pain), null si sans objet"),
  pieceGrams: z.number().min(0).nullable().describe("Poids d'une pièce en grammes, null si inconnu"),
  source: z.enum(["label", "off"]).describe('"label" = photo d\'étiquette, "off" = Open Food Facts'),
  offCode: z.string().nullable().describe("Le code-barres du produit Open Food Facts, sinon null"),
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
