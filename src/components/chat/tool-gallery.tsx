"use client";

import { TriangleAlertIcon } from "lucide-react";
import { Component, type ReactNode } from "react";
import type { Id } from "../../../convex/_generated/dataModel";
import type { Entry } from "../../../convex/screenshots";
import type { AgentConfig, AgentToolLabel, ToolPart } from "@/components/chat/agent-chat";
import { CHEF } from "@/components/chat/chef-chat";
import { COACH } from "@/components/chat/coach-chat";

/**
 * The design harness behind /demo: every chat tool card, both agents, all four
 * states, without talking to a model to trigger one.
 *
 * It is driven by the REAL `COACH` / `CHEF` configs — the tool list comes from
 * `config.toolLabels` and every completed card comes from `config.renderTool`,
 * so a tool added to an agent shows up here on its own (with "pas de fixture"
 * until someone writes one). Nothing is re-listed by hand.
 *
 * `ToolRunning` / `ToolFailed` are private to `agent-chat.tsx`, so the three
 * non-completed states are re-implemented below. THAT DUPLICATION IS DELIBERATE
 * (the shell must not grow exports for a review page) AND IT MUST BE UPDATED
 * WITH `agent-chat.tsx`: if the shimmer line or the failure line changes there,
 * change `PendingLine` / `FailedLine` here too, or this gallery starts lying.
 */

/** One completed-state fixture. `note` is printed under it, as-is. */
type Fixture = { label: string; tool: ToolPart; note?: string };

const MACROS = { calories: 520, protein: 22, carbs: 62, fat: 18 };

const PORRIDGE = {
  slot: "petit_dejeuner" as const,
  name: "Porridge avoine, banane, beurre de cacahuète",
  ingredients: [
    { name: "Flocons d'avoine", quantity: "80 g" },
    { name: "Lait demi-écrémé", quantity: "250 ml" },
    { name: "Banane", quantity: "1" },
    { name: "Beurre de cacahuète", quantity: "1 cuillère à soupe" },
  ],
  steps: [
    "Fais chauffer le lait avec les flocons 5 min.",
    "Écrase la banane dedans hors du feu.",
    "Ajoute le beurre de cacahuète.",
  ],
  prepMinutes: 8,
  macros: MACROS,
  mealPrep: "Se prépare la veille, se mange froid.",
};

const POULET_RIZ = {
  slot: "dejeuner" as const,
  name: "Poulet grillé, riz basmati, brocolis",
  ingredients: [
    { name: "Filet de poulet", quantity: "180 g" },
    { name: "Riz basmati", quantity: "90 g cru" },
    { name: "Brocolis", quantity: "200 g" },
    { name: "Huile d'olive", quantity: "1 cuillère à café" },
  ],
  steps: [
    "Fais cuire le riz 11 min.",
    "Grille le poulet 6 min par face.",
    "Fais les brocolis à la vapeur 8 min.",
  ],
  prepMinutes: 25,
  macros: { calories: 680, protein: 55, carbs: 72, fat: 16 },
  mealPrep: "Double la quantité de riz pour demain.",
};

const OMELETTE = {
  slot: "diner" as const,
  name: "Omelette 3 œufs, comté, salade verte",
  ingredients: [
    { name: "Œufs", quantity: "3" },
    { name: "Comté", quantity: "30 g" },
    { name: "Salade verte", quantity: "1 poignée" },
  ],
  steps: ["Bats les œufs, sale, poivre.", "Cuis 4 min à feu moyen.", "Sers avec la salade."],
  prepMinutes: 10,
  macros: { calories: 420, protein: 30, carbs: 6, fat: 30 },
  mealPrep: null,
};

const done = (type: string, input: unknown, output?: unknown): ToolPart => ({
  type,
  state: "output-available",
  input,
  output,
});

const COACH_FIXTURES: Record<string, Fixture[]> = {
  "tool-save_onboarding": [
    {
      label: "Profil complet",
      tool: done("tool-save_onboarding", {
        experience: "intermediaire",
        goals: ["Prendre du muscle", "Garder le cardio de la boxe"],
        sport: "Boxe anglaise, 2 fois par semaine",
        limitations: "Épaule droite sensible sur le développé militaire",
        daysPerWeek: 4,
        sessionMinutes: 60,
        equipment: ["Salle complète", "Barre olympique", "Haltères"],
        tone: "direct",
      }),
    },
    {
      label: "Profil minimal (sport et limitations à null)",
      tool: done("tool-save_onboarding", {
        experience: "debutant",
        goals: ["Me remettre en forme"],
        sport: null,
        limitations: null,
        daysPerWeek: 2,
        sessionMinutes: 30,
        equipment: ["Poids du corps"],
        tone: "motivant",
      }),
    },
  ],
  "tool-generate_program": [
    {
      label: "Programme 2 jours, v3",
      tool: done(
        "tool-generate_program",
        {
          name: "Push/Pull 4 jours — boxe",
          days: [
            {
              name: "Jour 1 — Push (pectoraux, épaules, triceps)",
              exercises: [
                {
                  name: "Développé couché à la barre",
                  sets: 4,
                  reps: "6-8",
                  restSeconds: 150,
                  notes: "Descente contrôlée en 3 s",
                },
                {
                  name: "Développé incliné haltères",
                  sets: 3,
                  reps: "8-10",
                  restSeconds: 120,
                  notes: null,
                },
                {
                  name: "Élévations latérales",
                  sets: 3,
                  reps: "12-15",
                  restSeconds: 60,
                  notes: null,
                },
                {
                  name: "Extensions triceps à la poulie",
                  sets: 3,
                  reps: "10-12",
                  restSeconds: 60,
                  notes: "Coudes collés au corps",
                },
              ],
            },
            {
              name: "Jour 2 — Pull (dos, biceps)",
              exercises: [
                {
                  name: "Tractions supination",
                  sets: 4,
                  reps: "AMRAP",
                  restSeconds: 180,
                  notes: null,
                },
                { name: "Rowing barre", sets: 4, reps: "8", restSeconds: 150, notes: "Dos à 45°" },
                { name: "Curl haltères", sets: 3, reps: "10-12", restSeconds: 60, notes: null },
              ],
            },
          ],
          progressionRules:
            "Ajoute 2,5 kg dès que tu tiens le haut de la fourchette sur toutes les séries. Si tu rates le bas de la fourchette deux séances de suite, retire 5 % et remonte.",
          deloadEveryWeeks: 6,
        },
        { version: 3 },
      ),
    },
  ],
  "tool-swap_exercise": [
    {
      label: "Remplacement, jour nommé par l'output",
      tool: done(
        "tool-swap_exercise",
        {
          dayIndex: 0,
          from: "Développé militaire à la barre",
          to: {
            name: "Développé haltères assis",
            sets: 3,
            reps: "8-10",
            restSeconds: 120,
            notes: "Moins de contrainte sur l'épaule droite",
          },
        },
        { version: 4, dayName: "Jour 1 — Push (pectoraux, épaules, triceps)" },
      ),
    },
  ],
  "tool-explain_exercise": [
    {
      label: "Résultat sans carte",
      tool: done("tool-explain_exercise", { name: "Soulevé de terre" }),
      note: "Par design : `renderTool` renvoie null, le coach explique en prose au-dessus.",
    },
  ],
  "tool-extract_screenshot": [
    {
      label: "Pesée lue sur une capture Zepp",
      tool: done("tool-extract_screenshot", null, {
        screenshotId: "demo_fake_screenshot_id" as Id<"screenshots">,
        entries: [
          {
            source: "zepp",
            type: "bodyweight",
            date: "2026-07-28",
            weight_kg: 72.5,
            body_fat_pct: 14.8,
            muscle_kg: 58.2,
          },
        ] satisfies Entry[],
      }),
      note: "État live, dépend d'une vraie ligne Convex : l'id est faux, la carte s'abonne à `api.screenshots.status`.",
    },
  ],
  "tool-log_workout": [
    {
      label: "Séance notée, 9 séries",
      tool: done(
        "tool-log_workout",
        {
          date: "2026-08-01",
          exercises: [
            {
              name: "Développé couché",
              sets: [
                { weight: 80, reps: 8 },
                { weight: 80, reps: 7 },
                { weight: 75, reps: 8 },
              ],
            },
            {
              name: "Rowing barre",
              sets: [
                { weight: 70, reps: 10 },
                { weight: 70, reps: 9 },
              ],
            },
          ],
          notes: "Bonne séance, épaule silencieuse.",
        },
        { sets: 9 },
      ),
    },
  ],
  "tool-search_web": [
    {
      label: "Deux sources",
      tool: done("tool-search_web", null, {
        query: "créatine monohydrate dose journalière",
        results: [
          {
            title: "Créatine : 3 à 5 g par jour, sans phase de charge",
            url: "https://examine.com/supplements/creatine/",
            snippet: "La dose d'entretien couvre la saturation musculaire en 3 à 4 semaines.",
          },
          {
            title: "ISSN position stand: creatine supplementation",
            url: "https://jissn.biomedcentral.com/articles/10.1186/s12970-017-0173-z",
            snippet: "Revue de la littérature sur la sécurité et l'efficacité.",
          },
        ],
      }),
    },
    {
      label: "Zéro résultat",
      tool: done("tool-search_web", null, { query: "cardio à jeun 2026", results: [] }),
      note: "`SourcesCard` renvoie null quand la liste est vide — rien ne s'affiche, c'est voulu.",
    },
  ],
  "tool-ask_chef": [
    {
      label: "Consultation du Chef",
      tool: done("tool-ask_chef", {
        question: "Combien de protéines par repas sur 4 repas à 164 g par jour ?",
        context: "Homme 72 kg, prise de masse, 4 séances par semaine.",
      }),
    },
  ],
};

const CHEF_FIXTURES: Record<string, Fixture[]> = {
  "tool-save_nutrition_profile": [
    {
      label: "Profil complet, cibles 2220 kcal",
      tool: done(
        "tool-save_nutrition_profile",
        {
          goal: "prise",
          age: 31,
          sex: "h",
          heightCm: 178,
          weightKg: 72,
          activityLevel: "actif",
          diet: null,
          allergies: ["Fruits à coque"],
          excluded: ["Abats"],
          mealsPerDay: 4,
          budget: "normal",
          cookMinutes: 30,
          people: 2,
        },
        { targets: { calories: 2220, protein: 164, carbs: 252, fat: 62 } },
      ),
    },
    {
      label: "Champs optionnels à null, aucune allergie",
      tool: done("tool-save_nutrition_profile", {
        goal: "maintien",
        age: 44,
        sex: "f",
        heightCm: 165,
        weightKg: 61,
        activityLevel: "leger",
        diet: null,
        allergies: [],
        excluded: [],
        mealsPerDay: 3,
        budget: null,
        cookMinutes: null,
        people: null,
      }),
      note: "Sans output : pas de bloc « cibles quotidiennes ».",
    },
  ],
  "tool-generate_meal_plan": [
    {
      label: "Deux jours, 21 repas annoncés",
      tool: done(
        "tool-generate_meal_plan",
        {
          days: [
            { date: "2026-08-03", meals: [PORRIDGE, POULET_RIZ, OMELETTE] },
            {
              date: "2026-08-04",
              meals: [
                PORRIDGE,
                { ...POULET_RIZ, name: "Poulet, patate douce, haricots verts" },
                { ...OMELETTE, name: "Omelette aux champignons, salade" },
              ],
            },
          ],
        },
        { meals: 21 },
      ),
    },
    {
      label: "Nom de repas très long (truncation du Header)",
      tool: done(
        "tool-generate_meal_plan",
        {
          days: [
            {
              date: "2026-08-05",
              meals: [
                {
                  ...POULET_RIZ,
                  name: "Poulet rôti au citron et au thym, riz basmati aux petits pois, brocolis vapeur et sauce yaourt-citron maison",
                },
              ],
            },
          ],
        },
        { meals: 1 },
      ),
    },
    {
      label: "Date hors calendrier",
      tool: done("tool-generate_meal_plan", {
        days: [{ date: "2026-13-40", meals: [PORRIDGE] }],
      }),
      // Cette fixture a trouvé un vrai crash : l'ancien garde ne testait que la
      // FORME `\\d{4}-\\d{2}-\\d{2}`, donc "2026-13-40" passait et `Intl.format`
      // jetait `RangeError` — le prerender de /demo échouait, et en prod c'était
      // /chef qui tombait. `formatLoose` valide maintenant que la date existe.
      // Ne la remplace pas par une date valide : c'est elle qui garde le garde.
      note: "Date bien formée mais inexistante : `formatLoose` la réaffiche telle quelle au lieu de jeter. Cette fixture a trouvé un crash réel, elle reste ici exprès.",
    },
  ],
  "tool-replace_meal": [
    {
      label: "Dîner remplacé",
      tool: done("tool-replace_meal", {
        date: "2026-08-03",
        slot: "diner",
        meal: OMELETTE,
      }),
    },
  ],
  "tool-move_meal": [
    {
      label: "Déplacé, nom donné par l'output",
      tool: done(
        "tool-move_meal",
        {
          from: { date: "2026-08-03", slot: "dejeuner" },
          to: { date: "2026-08-04", slot: "diner" },
        },
        { name: "Poulet grillé, riz basmati, brocolis" },
      ),
    },
  ],
  "tool-regenerate_day": [
    {
      label: "Journée refaite, 1 repas verrouillé gardé",
      tool: done(
        "tool-regenerate_day",
        {
          date: "2026-08-04",
          meals: [
            { ...PORRIDGE, name: "Skyr, myrtilles, granola" },
            { ...OMELETTE, name: "Cabillaud, quinoa, courgettes" },
          ],
        },
        { kept: 1 },
      ),
      note: "Le déjeuner verrouillé n'est PAS dans l'input (le schéma ne porte que les créneaux libres) ; seul le badge « 1 gardé(s) » le dit.",
    },
  ],
  "tool-shopping_list": [
    {
      label: "Ingrédient à plusieurs quantités",
      tool: done("tool-shopping_list", null, [
        { name: "Filet de poulet", quantities: ["180 g", "180 g", "2 filets"] },
        { name: "Flocons d'avoine", quantities: ["80 g", "80 g"] },
        { name: "Brocolis", quantities: ["200 g"] },
        { name: "Œufs", quantities: ["3", "6"] },
        { name: "Comté", quantities: ["30 g"] },
      ]),
    },
    {
      label: "Liste vide",
      tool: done("tool-shopping_list", null, []),
      note: "`ShoppingListCard` renvoie null : rien ne s'affiche.",
    },
  ],
  "tool-add_food_log_entry": [
    {
      label: "Entrée normale",
      tool: done("tool-add_food_log_entry", {
        date: "2026-08-03",
        slot: "collation",
        name: "Skyr nature",
        quantity: "1 pot de 150 g",
        macros: { calories: 96, protein: 17, carbs: 6, fat: 0 },
      }),
    },
    {
      label: "0 kcal (verre d'eau)",
      tool: done("tool-add_food_log_entry", {
        date: "2026-08-03",
        slot: "dejeuner",
        name: "Grand verre d'eau",
        quantity: null,
        macros: { calories: 0, protein: 0, carbs: 0, fat: 0 },
      }),
      note: "Quantité à null : pas de tiret après le nom.",
    },
  ],
  "tool-log_planned_meal": [
    {
      label: "Repas prévu, mangé",
      tool: done("tool-log_planned_meal", { date: "2026-08-03", slot: "dejeuner" }),
    },
  ],
  "tool-update_inventory": [
    {
      label: "Inventaire refait (replace)",
      tool: done(
        "tool-update_inventory",
        {
          mode: "replace",
          items: [
            { name: "Œufs", quantity: "6" },
            { name: "Riz basmati", quantity: "1 kg" },
            { name: "Moutarde", quantity: null },
            { name: "Brocolis surgelés", quantity: "500 g" },
          ],
        },
        { count: 4 },
      ),
    },
    {
      label: "Ajout (add), sans compte",
      tool: done("tool-update_inventory", {
        mode: "add",
        items: [{ name: "Beurre de cacahuète", quantity: "1 pot" }],
      }),
    },
  ],
  "tool-suggest_recipes_from_ingredients": [
    {
      label: "Deux recettes",
      tool: done("tool-suggest_recipes_from_ingredients", null, {
        recipes: [
          {
            name: "Omelette au comté et brocolis",
            ingredients: [
              { name: "Œufs", quantity: "3" },
              { name: "Comté", quantity: "30 g" },
              { name: "Brocolis cuits", quantity: "150 g" },
            ],
            steps: [
              "Réchauffe les brocolis à la poêle.",
              "Verse les œufs battus, ajoute le comté.",
              "Cuis 4 min à couvert.",
            ],
            prepMinutes: 12,
            macros: { calories: 470, protein: 33, carbs: 9, fat: 33 },
          },
          {
            name: "Riz sauté au poulet",
            ingredients: [
              { name: "Riz cuit", quantity: "200 g" },
              { name: "Filet de poulet", quantity: "150 g" },
              { name: "Sauce soja", quantity: "1 cuillère à soupe" },
            ],
            steps: ["Fais dorer le poulet en dés.", "Ajoute le riz et la sauce soja 3 min."],
            prepMinutes: 15,
            macros: { calories: 610, protein: 45, carbs: 68, fat: 14 },
          },
        ],
      }),
    },
  ],
  "tool-lookup_food": [
    {
      label: "Big Mac trouvé dans Open Food Facts",
      tool: done("tool-lookup_food", null, {
        query: "big mac",
        source: "Open Food Facts",
        basis: "pour 100 g",
        results: [
          {
            code: "3760020507350",
            name: "Big Mac",
            brand: "McDonald's",
            servingSize: "219 g",
            per100g: { calories: 234, protein: 12.5, carbs: 19.8, fat: 11.2 },
          },
          {
            code: "0000000004530",
            name: "Big Mac sauce",
            brand: "McDonald's",
            per100g: { calories: 340, protein: 1.2, carbs: 12, fat: 31 },
          },
        ],
      }),
    },
    {
      label: "Open Food Facts en panne (error posé)",
      tool: done("tool-lookup_food", null, {
        query: "pâte à tartiner bio",
        results: [],
        error: "timeout après 6 s",
      }),
    },
    {
      label: "Zéro résultat",
      tool: done("tool-lookup_food", null, {
        query: "gratin de crozets de ma grand-mère",
        results: [],
      }),
    },
  ],
  "tool-analyze_plate": [
    {
      label: "Assiette analysée",
      tool: done("tool-analyze_plate", null, {
        analysisId: "demo_fake_analysis_id" as Id<"visionAnalyses">,
        intent: "plate",
        items: [
          {
            name: "Poulet grillé",
            quantityEstimate: "≈ 150 g",
            calories: 250,
            macros: { protein: 46, carbs: 0, fat: 6 },
            confidence: "medium",
            needsConfirmation: true,
          },
        ],
        warnings: ["Observation : l'assiette est photographiée de trois quarts."],
      }),
      note: "État live, dépend d'une vraie ligne Convex : l'id est faux, la carte s'abonne à `api.vision.status`.",
    },
  ],
  "tool-analyze_fridge": [
    {
      label: "Frigo analysé",
      tool: done("tool-analyze_fridge", null, {
        analysisId: "demo_fake_analysis_id" as Id<"visionAnalyses">,
        intent: "fridge",
        items: [
          { name: "Œufs", quantityEstimate: "6", confidence: "high", needsConfirmation: false },
        ],
        warnings: [],
      }),
      note: "État live, dépend d'une vraie ligne Convex.",
    },
  ],
  "tool-read_nutrition_label": [
    {
      label: "Étiquette lue",
      tool: done("tool-read_nutrition_label", null, {
        analysisId: "demo_fake_analysis_id" as Id<"visionAnalyses">,
        intent: "label",
        items: [
          {
            name: "Granola chocolat",
            quantityEstimate: "45 g",
            calories: 198,
            macros: { protein: 4.5, carbs: 27, fat: 7.5 },
            confidence: "high",
            needsConfirmation: false,
          },
        ],
        warnings: ["Estimation : la portion pesée peut différer de celle imprimée."],
      }),
      note: "État live, dépend d'une vraie ligne Convex.",
    },
  ],
  "tool-analyze_groceries": [
    {
      label: "Courses analysées, photo inexploitable",
      tool: done("tool-analyze_groceries", null, {
        analysisId: "demo_fake_analysis_id" as Id<"visionAnalyses">,
        intent: "groceries",
        items: [],
        warnings: ["Observation : la photo est floue, rien n'est identifiable."],
      }),
      note: "État live, dépend d'une vraie ligne Convex.",
    },
  ],
  "tool-ask_coach": [
    {
      label: "Consultation du Coach",
      tool: done("tool-ask_coach", {
        question: "Faut-il manger avant une séance de 19 h ?",
        context: "4 séances par semaine, prise de masse, 2220 kcal.",
      }),
    },
  ],
};

/* -------------------------------------------------------------------------- */
/* Mirrors of `agent-chat.tsx`. Keep in sync — see the file header.           */
/* -------------------------------------------------------------------------- */

/** Mirror of `ToolRunning` in `agent-chat.tsx`. */
function PendingLine({ label, pending }: { label?: AgentToolLabel; pending: boolean }) {
  const text = pending
    ? (label?.pending ?? "Un instant…")
    : (label?.running ?? label?.pending ?? "Un instant…");
  return <p className="shimmer text-[11px] text-muted-foreground">{text}</p>;
}

/** Mirror of `ToolFailed` in `agent-chat.tsx`. */
function FailedLine({ label }: { label?: AgentToolLabel }) {
  return (
    <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
      <TriangleAlertIcon className="size-3.5 shrink-0" aria-hidden />
      {label?.failed ?? "Une action n'a pas marché."}
    </p>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * The two Convex-backed cards throw when handed a fake id — `v.id()` rejects a
 * string that isn't a real document id, and `useQuery` rethrows that in render.
 * The boundary is here so one honest failure doesn't take the whole gallery
 * down; the message it prints IS what those cards do with a fake id.
 */
class CardBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  render() {
    if (this.state.error !== null) {
      return (
        <p className="text-[11px] break-words text-muted-foreground">
          La carte a jeté : {this.state.error}
        </p>
      );
    }
    return this.props.children;
  }
}

/** Same guard as `AgentMessage`, so the gallery hides what the real shell hides. */
function Completed({ config, tool }: { config: AgentConfig; tool: ToolPart }) {
  if (!tool.input && !config.outputOnly.includes(tool.type)) {
    return (
      <p className="text-[11px] text-muted-foreground">
        Input absent : la coquille masquerait cette carte.
      </p>
    );
  }
  const card = config.renderTool(tool, false);
  return (
    <CardBoundary>
      {card ?? (
        <p className="text-[11px] text-muted-foreground">
          Aucune carte : `renderTool` renvoie null.
        </p>
      )}
    </CardBoundary>
  );
}

function State({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <span className="eyebrow">{name}</span>
      {children}
    </div>
  );
}

function ToolBlock({
  config,
  type,
  fixtures,
}: {
  config: AgentConfig;
  type: string;
  fixtures: Fixture[];
}) {
  const label = config.toolLabels[type];

  return (
    <section className="space-y-3 rounded-xl border bg-background p-3">
      <h3 className="font-heading text-sm font-semibold tracking-[-0.01em]">
        {type.replace(/^tool-/, "")}
      </h3>

      <State name="pending — input-streaming">
        <PendingLine label={label} pending />
      </State>
      <State name="running — input-available">
        <PendingLine label={label} pending={false} />
      </State>
      <State name="failed — output-error">
        <FailedLine label={label} />
      </State>

      {fixtures.length === 0 ? (
        <State name="completed — output-available">
          <p className="text-[11px] text-muted-foreground">
            Pas de fixture : cette carte n&apos;est pas couverte par la galerie.
          </p>
        </State>
      ) : (
        fixtures.map((fixture) => (
          <State key={fixture.label} name={`completed — ${fixture.label}`}>
            <Completed config={config} tool={fixture.tool} />
            {fixture.note ? (
              <p className="text-[11px] text-muted-foreground">{fixture.note}</p>
            ) : null}
          </State>
        ))
      )}
    </section>
  );
}

function AgentSection({
  config,
  fixtures,
}: {
  config: AgentConfig;
  fixtures: Record<string, Fixture[]>;
}) {
  const types = Object.keys(config.toolLabels);
  const covered = types.filter((type) => (fixtures[type]?.length ?? 0) > 0).length;

  return (
    <section className="space-y-3">
      <h2 className="font-heading text-lg font-semibold tracking-[-0.01em]">
        {config.name}{" "}
        <span className="text-sm font-normal text-muted-foreground tabular-nums">
          {types.length} outils · {covered} avec fixture
        </span>
      </h2>
      {/* Une colonne sur téléphone, plusieurs en revue desktop. */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {types.map((type) => (
          <ToolBlock key={type} config={config} type={type} fixtures={fixtures[type] ?? []} />
        ))}
      </div>
    </section>
  );
}

export function ToolGallery() {
  return (
    <div className="space-y-8">
      <AgentSection config={COACH} fixtures={COACH_FIXTURES} />
      <AgentSection config={CHEF} fixtures={CHEF_FIXTURES} />
    </div>
  );
}
