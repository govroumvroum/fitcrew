/**
 * The shared « sèche » catalogue: the 31 recipes of Basile's diet page
 * (diet.bazlab.si), seeded into `recipes` with no `userId` by
 * `migrations.seedRecipeCatalogue`.
 *
 * Pure data, no Convex import, so the self-check and the Chef prompt can read it
 * without a runtime.
 *
 * ESTIMATES, twice over. Diet only gives kcal and protein; carbs and fat are
 * estimated here from the ingredients (fat first, then carbs from what's left of
 * the kcal: 4 kcal/g of protein and carbs, 9 of fat). Every surface that shows
 * them says « estimations », like every other macro in the app.
 *
 * `allergens` is what a plain ingredient match can't see: « Skyr » doesn't say
 * lactose and « chorizo » doesn't say porc. They're extra words the read filter
 * (`visibleTo`) checks the user's allergies and exclusions against — written by
 * hand for this curated list only, never inferred for a Chef recipe.
 *
 * Photos are the ones picked by hand on the diet page (Wikimedia Commons, a few
 * TheMealDB), hotlinked.
 */

import type { RecipeCategory } from "./recipeLogic";

export type CatalogueRecipe = {
  name: string;
  category: RecipeCategory;
  cheat?: boolean;
  description: string;
  prepMinutes: number;
  macros: { calories: number; protein: number; carbs: number; fat: number };
  ingredients: { name: string; quantity: string }[];
  steps: string[];
  photoUrl: string;
  allergens: string[];
};

export const SECHE_TAG = "seche";

const WIKI = "https://thumb.wikimedia.org/wikipedia/commons/thumb";
const MEALDB = "https://www.themealdb.com/images/media/meals";

const DAIRY = ["lactose", "lait", "produits laitiers"];
const WHEAT = ["gluten", "blé"];
const EGG = ["œuf"];
const FISH = ["poisson"];
const PORK = ["porc", "viande"];
const MEAT = ["viande"];
const PEANUT = ["arachide", "cacahuète"];
const SOY = ["soja"];
const SESAME = ["sésame"];
const NUTS = ["fruits à coque"];

export const SECHE_CATALOGUE: CatalogueRecipe[] = [
  // --- Petit-déj ---------------------------------------------------------
  {
    name: "Bagel saumon-cream cheese",
    category: "petit_dej",
    description: "Bagel complet, 60 g de saumon fumé, 30 g de cream cheese léger, aneth, citron.",
    prepMinutes: 3,
    macros: { calories: 420, protein: 28, carbs: 48, fat: 13 },
    ingredients: [
      { name: "bagel complet", quantity: "1" },
      { name: "saumon fumé", quantity: "60 g" },
      { name: "cream cheese léger", quantity: "30 g" },
      { name: "aneth, citron, poivre", quantity: "" },
    ],
    steps: [
      "Couper le bagel en deux et le toaster légèrement.",
      "Tartiner le cream cheese sur les deux moitiés.",
      "Ajouter le saumon fumé, l'aneth, un filet de citron, poivre.",
      "Fermer, presser, manger.",
    ],
    photoUrl: `${WIKI}/c/cb/Lox_Bagel_Sandwich_with_Cream_Cheese_Schmear_Onion_Tomato.jpg/960px-Lox_Bagel_Sandwich_with_Cream_Cheese_Schmear_Onion_Tomato.jpg`,
    allergens: [...WHEAT, ...FISH, ...DAIRY],
  },
  {
    name: "Œufs brouillés chorizo",
    category: "petit_dej",
    description: "2 œufs + 100 g de blancs, 15 g de chorizo, 1 tranche de levain, ciboulette.",
    prepMinutes: 8,
    macros: { calories: 370, protein: 30, carbs: 27, fat: 16 },
    ingredients: [
      { name: "œufs", quantity: "2" },
      { name: "blancs d'œufs", quantity: "100 g" },
      { name: "chorizo", quantity: "15 g" },
      { name: "pain au levain", quantity: "1 tranche" },
      { name: "ciboulette, sel, poivre", quantity: "" },
    ],
    steps: [
      "Faire revenir le chorizo en dés dans une poêle antiadhésive, sans matière grasse.",
      "Battre les œufs et les blancs, verser dans la poêle à feu doux.",
      "Remuer sans arrêt, en sortant la poêle du feu de temps en temps, jusqu'à une texture crémeuse.",
      "Griller le levain, dresser, ciboulette et poivre.",
    ],
    photoUrl: `${WIKI}/e/e4/Scrambled_eggs_on_toast_-_Joe%27s_Cafe_2024-04-14.jpg/960px-Scrambled_eggs_on_toast_-_Joe%27s_Cafe_2024-04-14.jpg`,
    allergens: [...EGG, ...PORK, ...WHEAT],
  },
  {
    name: "Overnight oats tiramisu",
    category: "petit_dej",
    description:
      "40 g de flocons, 150 g de skyr, 1 espresso, cacao, édulcorant, chocolat noir râpé. Se prépare la veille.",
    prepMinutes: 5,
    macros: { calories: 315, protein: 23, carbs: 45, fat: 5 },
    ingredients: [
      { name: "flocons d'avoine", quantity: "40 g" },
      { name: "skyr ou fromage blanc 0 %", quantity: "150 g" },
      { name: "espresso", quantity: "1" },
      { name: "cacao en poudre, édulcorant", quantity: "" },
      { name: "chocolat noir râpé", quantity: "5 g" },
    ],
    steps: [
      "La veille : mélanger flocons + espresso (ajoute un peu d'eau ou de lait si c'est trop dense).",
      "Dans un verre : couche avoine-café, puis couche skyr battu avec l'édulcorant.",
      "Saupoudrer de cacao, râper le chocolat noir dessus.",
      "Réserver au frais une nuit.",
    ],
    photoUrl: `${WIKI}/f/fd/Protein_overnight_oats.jpg/960px-Protein_overnight_oats.jpg`,
    allergens: [...DAIRY, "gluten", "avoine"],
  },
  {
    name: "Pancakes protéinés",
    category: "petit_dej",
    description:
      "40 g de flocons mixés, 1 œuf, 150 g de fromage blanc 0 %, myrtilles, 1 c. à café de sirop d’érable.",
    prepMinutes: 10,
    macros: { calories: 335, protein: 23, carbs: 43, fat: 8 },
    ingredients: [
      { name: "flocons d'avoine mixés", quantity: "40 g" },
      { name: "œuf", quantity: "1" },
      { name: "fromage blanc 0 %", quantity: "150 g" },
      { name: "myrtilles", quantity: "1 poignée" },
      { name: "sirop d'érable", quantity: "1 c. à café" },
      { name: "levure chimique", quantity: "1/2 c. à café" },
    ],
    steps: [
      "Mixer les flocons en poudre.",
      "Mélanger avec l'œuf, 100 g de fromage blanc et la levure.",
      "Cuire 4 petits pancakes à la poêle antiadhésive, ~2 min par face.",
      "Servir avec le fromage blanc restant, myrtilles et filet d'érable.",
    ],
    photoUrl: `${MEALDB}/rwuyqx1511383174.jpg`,
    allergens: [...EGG, ...DAIRY, "gluten", "avoine"],
  },
  {
    name: "Toast avocat-œuf mollet",
    category: "petit_dej",
    description:
      "1 tranche de levain, 1/3 d’avocat, 2 œufs mollets, piment d’Espelette. Ajoute un skyr à côté.",
    prepMinutes: 8,
    macros: { calories: 415, protein: 33, carbs: 30, fat: 18 },
    ingredients: [
      { name: "pain au levain", quantity: "1 tranche" },
      { name: "avocat", quantity: "1/3" },
      { name: "œufs", quantity: "2" },
      { name: "piment d'Espelette", quantity: "" },
      { name: "skyr nature", quantity: "1 pot" },
    ],
    steps: [
      "Cuire les œufs 6 min dans l'eau bouillante (mollet), refroidir sous l'eau froide, écaler.",
      "Griller le levain, écraser l'avocat dessus, sel et piment.",
      "Couper les œufs en deux, poser sur le toast.",
      "Servir avec le skyr en accompagnement.",
    ],
    photoUrl: `${WIKI}/4/4a/Avocado_toast.jpg/960px-Avocado_toast.jpg`,
    allergens: [...WHEAT, ...EGG, ...DAIRY],
  },
  {
    name: "Bowl skyr granola",
    category: "petit_dej",
    description:
      "200 g de skyr vanille, 30 g de granola, fruits rouges, 10 g de beurre de cacahuète.",
    prepMinutes: 2,
    macros: { calories: 395, protein: 24, carbs: 52, fat: 10 },
    ingredients: [
      { name: "skyr vanille", quantity: "200 g" },
      { name: "granola", quantity: "30 g" },
      { name: "fruits rouges", quantity: "1 poignée" },
      { name: "beurre de cacahuète", quantity: "10 g" },
    ],
    steps: [
      "Verser le skyr dans un bol.",
      "Ajouter le granola et les fruits rouges.",
      "Passer le beurre de cacahuète 15 s au micro-ondes et le filer dessus.",
      "Manger tout de suite.",
    ],
    photoUrl: `${WIKI}/6/6c/Yogurt%2C_fruit%2C_granola_bowl_%2834999358091%29.jpg/960px-Yogurt%2C_fruit%2C_granola_bowl_%2834999358091%29.jpg`,
    allergens: [...DAIRY, ...WHEAT, ...PEANUT, ...NUTS],
  },

  // --- Repas -------------------------------------------------------------
  {
    name: "Smash burger maison",
    category: "repas",
    cheat: true,
    description:
      "150 g de bœuf 5 %, pain complet, cheddar light, cornichons, oignon, sauce skyr-ketchup-moutarde.",
    prepMinutes: 12,
    macros: { calories: 490, protein: 46, carbs: 43, fat: 15 },
    ingredients: [
      { name: "bœuf haché 5 %", quantity: "150 g" },
      { name: "pain burger complet", quantity: "1" },
      { name: "cheddar light", quantity: "1 tranche" },
      { name: "cornichons, oignon rouge", quantity: "" },
      { name: "skyr, ketchup, moutarde", quantity: "pour la sauce" },
    ],
    steps: [
      "Façonner 2 steaks fins, saler fortement un côté.",
      "Saisir 90 s côté salé sur poêle très chaude, saler l'autre face, retourner 45 s, poser le cheddar.",
      "Toaster le pain dans le jus de cuisson.",
      "Sauce : 1 c. à soupe de skyr + ketchup + moutarde.",
      "Monter : sauce, steaks, cornichons, oignon, chapeau.",
    ],
    photoUrl: `${WIKI}/5/5b/Single_Smashed_-_Honest_Burgers_2024-08-23.jpg/960px-Single_Smashed_-_Honest_Burgers_2024-08-23.jpg`,
    allergens: [...WHEAT, ...DAIRY, ...MEAT, "moutarde"],
  },
  {
    name: "Butter chicken light",
    category: "repas",
    description:
      "180 g de poulet, sauce tomate + 100 g de yaourt grec 0 % + garam masala, 60 g de riz basmati.",
    prepMinutes: 20,
    macros: { calories: 520, protein: 56, carbs: 61, fat: 6 },
    ingredients: [
      { name: "poulet en dés", quantity: "180 g" },
      { name: "sauce tomate", quantity: "200 g" },
      { name: "yaourt grec 0 %", quantity: "100 g" },
      { name: "garam masala, ail, gingembre", quantity: "" },
      { name: "riz basmati", quantity: "60 g" },
    ],
    steps: [
      "Lancer la cuisson du riz.",
      "Dorer les dés de poulet dans une poêle antiadhésive.",
      "Ajouter sauce tomate, ail, gingembre et garam masala, mijoter 10 min.",
      "Hors du feu, incorporer le yaourt grec (ne pas faire bouillir, ça trancherait).",
      "Servir sur le riz.",
    ],
    photoUrl: `${WIKI}/3/3c/Chicken_makhani.jpg/960px-Chicken_makhani.jpg`,
    allergens: [...DAIRY, ...MEAT],
  },
  {
    name: "Tacos poulet chipotle",
    category: "repas",
    description:
      "3 tortillas maïs, 160 g de poulet épicé, chou rouge, pico de gallo, sauce skyr-chipotle-citron vert.",
    prepMinutes: 15,
    macros: { calories: 420, protein: 47, carbs: 42, fat: 7 },
    ingredients: [
      { name: "tortillas de maïs", quantity: "3" },
      { name: "poulet", quantity: "160 g" },
      { name: "paprika fumé, cumin, ail", quantity: "" },
      { name: "chou rouge, pico de gallo", quantity: "" },
      { name: "skyr, chipotle, citron vert", quantity: "pour la sauce" },
    ],
    steps: [
      "Émincer le poulet, mariner 10 min : paprika fumé, cumin, ail.",
      "Saisir à feu vif 6-8 min.",
      "Sauce : skyr + chipotle haché + jus de citron vert.",
      "Chauffer les tortillas à sec à la poêle.",
      "Monter : chou émincé, poulet, pico de gallo, sauce.",
    ],
    photoUrl:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/6/69/Chicken_Club_Tacos%2C_Chilis_%288428054670%29.jpg/960px-Chicken_Club_Tacos%2C_Chilis_%288428054670%29.jpg",
    allergens: [...DAIRY, ...MEAT],
  },
  {
    name: "Kebab maison",
    category: "repas",
    description:
      "Pita, 160 g de poulet mariné paprika-cumin-ail, crudités, sauce blanche skyr-ail-menthe, harissa.",
    prepMinutes: 15,
    macros: { calories: 440, protein: 49, carbs: 45, fat: 7 },
    ingredients: [
      { name: "pain pita", quantity: "1" },
      { name: "poulet émincé", quantity: "160 g" },
      { name: "paprika, cumin, ail, citron", quantity: "" },
      { name: "salade, tomate, oignon", quantity: "" },
      { name: "skyr, ail, menthe", quantity: "pour la sauce blanche" },
      { name: "harissa", quantity: "1 pointe" },
    ],
    steps: [
      "Mariner le poulet émincé 15 min : paprika, cumin, ail, citron.",
      "Saisir à feu vif dans une poêle antiadhésive.",
      "Réchauffer la pita à la poêle.",
      "Sauce blanche : skyr, ail, menthe, sel.",
      "Garnir la pita : poulet, crudités, sauce blanche, pointe de harissa.",
    ],
    photoUrl: `${WIKI}/a/aa/D%C3%B6ner_Kebab%2C_Berlin%2C_2010_%2801%29.jpg/960px-D%C3%B6ner_Kebab%2C_Berlin%2C_2010_%2801%29.jpg`,
    allergens: [...WHEAT, ...DAIRY, ...MEAT],
  },
  {
    name: "Poke bowl saumon",
    category: "repas",
    description:
      "120 g de saumon ou thon, 60 g de riz, edamame, concombre, mangue, sauce soja-sésame-sriracha.",
    prepMinutes: 10,
    macros: { calories: 620, protein: 40, carbs: 61, fat: 24 },
    ingredients: [
      { name: "saumon très frais (ou thon)", quantity: "120 g" },
      { name: "riz", quantity: "60 g" },
      { name: "edamame, concombre, mangue", quantity: "" },
      { name: "sauce soja", quantity: "1 c. à soupe" },
      { name: "huile de sésame", quantity: "1 c. à café" },
      { name: "sriracha, miel", quantity: "" },
      { name: "graines de sésame", quantity: "" },
    ],
    steps: [
      "Cuire le riz, laisser tiédir.",
      "Couper le saumon en dés, garder au frais.",
      "Sauce : 1 c. à soupe de soja + 1 c. à café d'huile de sésame + sriracha + une pointe de miel.",
      "Dresser le bol : riz, saumon, edamame, concombre, mangue.",
      "Napper et parsemer de sésame.",
    ],
    photoUrl: `${WIKI}/5/55/Salmon_Poke_Bowl_%28S%29_with_Spicy_mayo_sauce_-_Kitokito.jpg/960px-Salmon_Poke_Bowl_%28S%29_with_Spicy_mayo_sauce_-_Kitokito.jpg`,
    allergens: [...FISH, ...SOY, ...SESAME, ...WHEAT],
  },
  {
    name: "Carbonara allégée",
    category: "repas",
    cheat: true,
    description:
      "80 g de pâtes, 1 œuf + 1 jaune, 20 g de parmesan, 70 g de bacon de dinde, beaucoup de poivre.",
    prepMinutes: 15,
    macros: { calories: 620, protein: 42, carbs: 68, fat: 20 },
    ingredients: [
      { name: "pâtes", quantity: "80 g" },
      { name: "œuf", quantity: "1" },
      { name: "jaune d'œuf", quantity: "1" },
      { name: "parmesan râpé", quantity: "20 g" },
      { name: "bacon de dinde", quantity: "70 g" },
      { name: "poivre", quantity: "beaucoup" },
    ],
    steps: [
      "Cuire les pâtes al dente, garder une louche d'eau de cuisson.",
      "Dorer le bacon de dinde sans matière grasse.",
      "Fouetter œuf + jaune + parmesan + poivre.",
      "Hors du feu, mélanger pâtes + bacon + mélange à l'œuf avec un peu d'eau de cuisson jusqu'à une sauce crémeuse. Jamais de crème.",
    ],
    photoUrl: `${MEALDB}/llcbn01574260722.jpg`,
    allergens: [...WHEAT, ...EGG, ...DAIRY, ...MEAT],
  },
  {
    name: "Bœuf teriyaki",
    category: "repas",
    description:
      "150 g de bœuf 5 % en lanières, brocolis, 60 g de riz, sauce soja-miel-gingembre-ail, sésame.",
    prepMinutes: 15,
    macros: { calories: 530, protein: 40, carbs: 68, fat: 11 },
    ingredients: [
      { name: "bœuf 5 % en lanières", quantity: "150 g" },
      { name: "brocolis", quantity: "1 portion" },
      { name: "riz", quantity: "60 g" },
      { name: "sauce soja", quantity: "2 c. à soupe" },
      { name: "miel", quantity: "1 c. à café" },
      { name: "gingembre, ail", quantity: "" },
      { name: "graines de sésame", quantity: "" },
    ],
    steps: [
      "Cuire le riz. Cuire les brocolis vapeur 5 min.",
      "Sauce : 2 c. à soupe de soja + 1 c. à café de miel + gingembre + ail râpés.",
      "Saisir le bœuf à feu vif 2-3 min.",
      "Ajouter la sauce, laisser réduire 1 min.",
      "Servir avec le riz et les brocolis, sésame.",
    ],
    photoUrl: `${WIKI}/c/c0/U.S._premium_beef_teriyakiB.jpg/960px-U.S._premium_beef_teriyakiB.jpg`,
    allergens: [...SOY, ...WHEAT, ...SESAME, ...MEAT],
  },
  {
    name: "Chili con carne",
    category: "repas",
    description:
      "150 g de bœuf 5 %, haricots rouges, tomates, épices, crème légère, 15 g de cheddar. Parfait en batch.",
    prepMinutes: 25,
    macros: { calories: 450, protein: 45, carbs: 34, fat: 15 },
    ingredients: [
      { name: "bœuf haché 5 %", quantity: "150 g" },
      { name: "haricots rouges", quantity: "200 g" },
      { name: "tomates concassées", quantity: "1 boîte" },
      { name: "oignon, ail", quantity: "" },
      { name: "chili, cumin, paprika", quantity: "" },
      { name: "crème légère", quantity: "1 filet" },
      { name: "cheddar", quantity: "15 g" },
    ],
    steps: [
      "Faire suer l'oignon et l'ail.",
      "Ajouter le bœuf et le dorer.",
      "Verser les tomates et les épices, mijoter 20 min (plus long = meilleur).",
      "Ajouter les haricots égouttés 5 min avant la fin.",
      "Servir avec un filet de crème légère et le cheddar. Parfait en batch.",
    ],
    photoUrl: `${WIKI}/6/61/Flickr_-_cyclonebill_-_Chili_con_carne_%282%29.jpg/960px-Flickr_-_cyclonebill_-_Chili_con_carne_%282%29.jpg`,
    allergens: [...DAIRY, ...MEAT],
  },
  {
    name: "Pizza tortilla",
    category: "repas",
    cheat: true,
    description:
      "Grande tortilla, sauce tomate, 60 g de mozza light, 60 g de jambon ou poulet, champignons, roquette.",
    prepMinutes: 12,
    macros: { calories: 380, protein: 30, carbs: 36, fat: 13 },
    ingredients: [
      { name: "grande tortilla de blé", quantity: "1" },
      { name: "sauce tomate", quantity: "3 c. à soupe" },
      { name: "mozzarella light", quantity: "60 g" },
      { name: "jambon ou poulet", quantity: "60 g" },
      { name: "champignons, roquette", quantity: "" },
    ],
    steps: [
      "Préchauffer le four à 220 °C.",
      "Poser la tortilla sur une plaque, étaler la sauce tomate.",
      "Garnir : mozzarella, jambon, champignons émincés.",
      "Cuire 8-10 min, bords croustillants.",
      "Roquette par-dessus à la sortie du four.",
    ],
    photoUrl: `${WIKI}/c/ca/Tortilla_pizza.jpg/960px-Tortilla_pizza.jpg`,
    allergens: [...WHEAT, ...DAIRY, ...PORK],
  },
  {
    name: "Bibimbap rapide",
    category: "repas",
    description:
      "150 g de bœuf haché 5 %, 60 g de riz, œuf au plat, épinards, carottes, gochujang.",
    prepMinutes: 15,
    macros: { calories: 640, protein: 48, carbs: 69, fat: 19 },
    ingredients: [
      { name: "bœuf haché 5 %", quantity: "150 g" },
      { name: "riz", quantity: "60 g" },
      { name: "œuf", quantity: "1" },
      { name: "épinards, carottes", quantity: "" },
      { name: "gochujang, sauce soja, sésame", quantity: "" },
    ],
    steps: [
      "Cuire le riz.",
      "Saisir le bœuf avec 1 c. à soupe de soja.",
      "Sauter séparément carottes en julienne puis épinards (2 min chacun).",
      "Cuire un œuf au plat.",
      "Bol : riz, tout disposé par zones, œuf au centre, gochujang + sésame. Mélanger avant de manger.",
    ],
    photoUrl: `${WIKI}/f/f5/Korean.food-Bibimbap-02.jpg/960px-Korean.food-Bibimbap-02.jpg`,
    allergens: [...EGG, ...SOY, ...WHEAT, ...SESAME, ...MEAT],
  },
  // Diet's « Gros repas » (xl) are filed under `repas`: the library has three
  // categories, like the plan's slots.
  {
    name: "Burrito bowl XL",
    category: "repas",
    description:
      "200 g de poulet, 90 g de riz, haricots noirs, maïs, salsa, 40 g de guacamole, sauce skyr-citron vert.",
    prepMinutes: 15,
    macros: { calories: 800, protein: 60, carbs: 104, fat: 16 },
    ingredients: [
      { name: "poulet", quantity: "200 g" },
      { name: "riz", quantity: "90 g" },
      { name: "haricots noirs, maïs", quantity: "" },
      { name: "salsa", quantity: "" },
      { name: "guacamole", quantity: "40 g" },
      { name: "skyr, citron vert", quantity: "pour la sauce" },
      { name: "paprika, cumin", quantity: "" },
    ],
    steps: [
      "Cuire le riz.",
      "Épicer le poulet (paprika, cumin) et le griller, entier ou en dés.",
      "Réchauffer haricots et maïs.",
      "Sauce : skyr + jus de citron vert + coriandre.",
      "Grand bol : riz, poulet tranché, haricots, maïs, salsa, guac, sauce.",
    ],
    photoUrl: `${WIKI}/9/99/2021-01-06_21_25_25_A_burrito_bowl_from_Chipotle_in_the_Franklin_Farm_section_of_Oak_Hill%2C_Fairfax_County%2C_Virginia.jpg/960px-2021-01-06_21_25_25_A_burrito_bowl_from_Chipotle_in_the_Franklin_Farm_section_of_Oak_Hill%2C_Fairfax_County%2C_Virginia.jpg`,
    allergens: [...DAIRY, ...MEAT],
  },
  {
    name: "Double smash + frites airfryer",
    category: "repas",
    cheat: true,
    description:
      "2 × 100 g de bœuf 5 %, pain complet, cheddar light, 200 g de pommes de terre en frites à l’airfryer.",
    prepMinutes: 20,
    macros: { calories: 720, protein: 60, carbs: 62, fat: 26 },
    ingredients: [
      { name: "bœuf haché 5 %", quantity: "2 × 100 g" },
      { name: "pain burger complet", quantity: "1" },
      { name: "cheddar light", quantity: "2 tranches" },
      { name: "pommes de terre", quantity: "200 g" },
      { name: "cornichons", quantity: "" },
      { name: "skyr, ketchup", quantity: "pour la sauce" },
    ],
    steps: [
      "Frites : couper les pommes de terre, 1 c. à café d'huile + sel, airfryer 18 min à 200 °C.",
      "Façonner 2 steaks très fins, bien salés.",
      "Smash à la spatule sur poêle brûlante, 2 min par face, cheddar dessus.",
      "Toaster le pain dans le jus de cuisson.",
      "Monter le double. Sauce skyr-ketchup à part pour tremper les frites.",
    ],
    photoUrl: `${WIKI}/9/9b/Cheeseburger_and_Fries_2.jpg/960px-Cheeseburger_and_Fries_2.jpg`,
    allergens: [...WHEAT, ...DAIRY, ...MEAT],
  },
  {
    name: "Pâtes bolo protéinées",
    category: "repas",
    description:
      "100 g de pâtes, 180 g de bœuf 5 %, sauce tomate, oignon, ail, 15 g de parmesan. Parfait en batch.",
    prepMinutes: 20,
    macros: { calories: 710, protein: 57, carbs: 87, fat: 15 },
    ingredients: [
      { name: "pâtes", quantity: "100 g" },
      { name: "bœuf haché 5 %", quantity: "180 g" },
      { name: "sauce tomate", quantity: "" },
      { name: "oignon, ail", quantity: "" },
      { name: "parmesan râpé", quantity: "15 g" },
    ],
    steps: [
      "Cuire les pâtes.",
      "Faire suer oignon + ail.",
      "Dorer le bœuf, ajouter la sauce tomate, mijoter 15 min.",
      "Mélanger avec les pâtes, parmesan dessus.",
      "Version batch : double les quantités et garde deux jours.",
    ],
    photoUrl: `${MEALDB}/sutysw1468247559.jpg`,
    allergens: [...WHEAT, ...DAIRY, ...MEAT],
  },
  {
    name: "Poulet tikka + naan",
    category: "repas",
    description:
      "200 g de poulet mariné yaourt-tikka, 1 naan, raïta concombre-menthe, oignons rouges.",
    prepMinutes: 20,
    macros: { calories: 600, protein: 60, carbs: 59, fat: 14 },
    ingredients: [
      { name: "poulet", quantity: "200 g" },
      { name: "yaourt nature", quantity: "100 g" },
      { name: "épices tikka, ail, gingembre", quantity: "" },
      { name: "naan", quantity: "1" },
      { name: "concombre, menthe, oignon rouge", quantity: "" },
    ],
    steps: [
      "Mariner le poulet : yaourt + épices tikka + ail-gingembre (30 min minimum, la veille c'est mieux).",
      "Cuire à la poêle bien chaude ou au four à 200 °C, ~15 min, légèrement noirci par endroits.",
      "Raïta : skyr + concombre râpé + menthe + sel.",
      "Réchauffer le naan, trancher le poulet.",
      "Servir avec raïta et oignons rouges.",
    ],
    photoUrl: `${WIKI}/9/9d/Chicken-Tikka.jpg/960px-Chicken-Tikka.jpg`,
    allergens: [...WHEAT, ...DAIRY, ...MEAT],
  },
  {
    name: "Saumon teriyaki + riz",
    category: "repas",
    description: "180 g de saumon, 90 g de riz, edamame, brocolis, sauce teriyaki maison, sésame.",
    prepMinutes: 15,
    macros: { calories: 850, protein: 55, carbs: 95, fat: 28 },
    ingredients: [
      { name: "saumon", quantity: "180 g" },
      { name: "riz", quantity: "90 g" },
      { name: "edamame, brocolis", quantity: "" },
      { name: "sauce soja, miel, gingembre", quantity: "" },
      { name: "graines de sésame", quantity: "" },
    ],
    steps: [
      "Cuire le riz.",
      "Sauce teriyaki : soja + miel + gingembre, réduire 2 min.",
      "Poêler le saumon 3-4 min par face, napper de sauce en fin de cuisson pour caraméliser.",
      "Cuire edamame et brocolis vapeur.",
      "Riz, saumon, légumes, sésame.",
    ],
    photoUrl: `${WIKI}/7/72/Salmon_Teriyaki.jpg/960px-Salmon_Teriyaki.jpg`,
    allergens: [...FISH, ...SOY, ...WHEAT, ...SESAME],
  },
  {
    name: "Croques jambon-fromage",
    category: "repas",
    cheat: true,
    description:
      "4 tranches de pain de mie complet, 120 g de jambon, emmental light, moutarde, salade verte à côté.",
    prepMinutes: 10,
    macros: { calories: 500, protein: 46, carbs: 43, fat: 16 },
    ingredients: [
      { name: "pain de mie complet", quantity: "4 tranches" },
      { name: "jambon", quantity: "120 g" },
      { name: "emmental light", quantity: "" },
      { name: "moutarde", quantity: "" },
      { name: "salade verte", quantity: "à côté" },
    ],
    steps: [
      "Moutarde sur 2 tranches, jambon + emmental râpé, refermer.",
      "Presser 4-5 min à la poêle ou au grille-pain panini jusqu'au croustillant.",
      "Quelques copeaux d'emmental sur le dessus en fin de cuisson.",
      "Salade verte à côté, vinaigrette légère.",
    ],
    photoUrl: `${WIKI}/6/66/Croque_Monsieur_and_salad_at_Paris_Bakery.jpg/960px-Croque_Monsieur_and_salad_at_Paris_Bakery.jpg`,
    allergens: [...WHEAT, ...DAIRY, ...PORK, "moutarde"],
  },

  // --- Collations --------------------------------------------------------
  {
    name: "Clear whey + pomme",
    category: "collation",
    description: "1 dose de clear whey à l’eau bien fraîche, 1 pomme. Léger et rafraîchissant.",
    prepMinutes: 1,
    macros: { calories: 180, protein: 22, carbs: 21, fat: 1 },
    ingredients: [
      { name: "clear whey", quantity: "1 dose" },
      { name: "eau bien fraîche", quantity: "" },
      { name: "pomme", quantity: "1" },
    ],
    steps: [
      "Shaker avec de l'eau très froide — ça reste plus léger qu'une whey classique.",
      "Laver la pomme.",
      "À boire entre les repas ou après l'entraînement.",
    ],
    photoUrl: `${WIKI}/c/c2/Protein_shake.jpg/960px-Protein_shake.jpg`,
    allergens: [...DAIRY],
  },
  {
    name: "Shaker whey + banane",
    category: "collation",
    description: "Le réflexe juste après la boxe.",
    prepMinutes: 1,
    macros: { calories: 230, protein: 25, carbs: 28, fat: 2 },
    ingredients: [
      { name: "whey", quantity: "1 dose" },
      { name: "eau ou lait", quantity: "" },
      { name: "banane", quantity: "1" },
    ],
    steps: [
      "Mettre la whey dans le shaker avec l'eau ou le lait.",
      "La banane se mange à part (ou mixée si tu as un blender).",
      "Le réflexe juste après la boxe.",
    ],
    photoUrl:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1b/Osaka_protein_shaker.jpg/960px-Osaka_protein_shaker.jpg",
    allergens: [...DAIRY],
  },
  {
    name: "Skyr cacahuète-cacao",
    category: "collation",
    description: "150 g de skyr nature, 1 c. à café de beurre de cacahuète, cacao en poudre.",
    prepMinutes: 1,
    macros: { calories: 140, protein: 18, carbs: 10, fat: 3 },
    ingredients: [
      { name: "skyr nature", quantity: "150 g" },
      { name: "beurre de cacahuète", quantity: "1 c. à café" },
      { name: "cacao en poudre", quantity: "" },
      { name: "édulcorant", quantity: "" },
    ],
    steps: [
      "Mélanger le skyr avec l'édulcorant.",
      "Filer le beurre de cacahuète (15 s au micro-ondes pour le détendre).",
      "Cacao tamisé dessus.",
    ],
    photoUrl: `${WIKI}/e/ea/Skyr_%26_Blackberries_20250816_143322.jpg/960px-Skyr_%26_Blackberries_20250816_143322.jpg`,
    allergens: [...DAIRY, ...PEANUT],
  },
  {
    name: "Mousse choco protéinée",
    category: "collation",
    description: "200 g de fromage blanc 0 %, cacao, édulcorant, 1 carré de chocolat noir.",
    prepMinutes: 2,
    macros: { calories: 135, protein: 17, carbs: 10, fat: 3 },
    ingredients: [
      { name: "fromage blanc 0 %", quantity: "200 g" },
      { name: "cacao en poudre", quantity: "" },
      { name: "édulcorant", quantity: "" },
      { name: "chocolat noir", quantity: "1 carré" },
    ],
    steps: [
      "Fouetter fromage blanc + cacao + édulcorant jusqu'à ce que ça mousse.",
      "15 min au frais pour raffermir.",
      "Râper le carré de chocolat noir dessus.",
    ],
    photoUrl: `${WIKI}/f/f6/Chocolate_mousse_-_stonesoup.jpg/960px-Chocolate_mousse_-_stonesoup.jpg`,
    allergens: [...DAIRY],
  },
  {
    name: "Cheesecake minute",
    category: "collation",
    description: "150 g de skyr vanille, 2 spéculoos émiettés, fruits rouges.",
    prepMinutes: 2,
    macros: { calories: 200, protein: 14, carbs: 27, fat: 4 },
    ingredients: [
      { name: "skyr vanille", quantity: "150 g" },
      { name: "spéculoos", quantity: "2" },
      { name: "fruits rouges", quantity: "1 poignée" },
    ],
    steps: [
      "Émietter les spéculoos au fond d'un verre.",
      "Recouvrir de skyr vanille.",
      "Fruits rouges dessus.",
      "5 min au congélateur si tu veux plus de tenue.",
    ],
    photoUrl: `${WIKI}/e/ea/Baked_cheesecake_with_raspberries_and_blueberries.jpg/960px-Baked_cheesecake_with_raspberries_and_blueberries.jpg`,
    allergens: [...DAIRY, ...WHEAT],
  },
  {
    name: "Assiette apéro",
    category: "collation",
    description: "2 tranches de jambon de dinde, 1 Babybel light, cornichons.",
    prepMinutes: 1,
    macros: { calories: 90, protein: 13, carbs: 1, fat: 4 },
    ingredients: [
      { name: "jambon de dinde", quantity: "2 tranches" },
      { name: "Babybel light", quantity: "1" },
      { name: "cornichons", quantity: "" },
    ],
    steps: [
      "Rouler les tranches de dinde.",
      "Sortir le Babybel et les cornichons.",
      "C'est tout — le tout pour 90 kcal.",
    ],
    photoUrl: `${WIKI}/7/7c/Cold_cut_plates_from_The_Farm_House.jpg/960px-Cold_cut_plates_from_The_Farm_House.jpg`,
    allergens: [...DAIRY, ...MEAT],
  },
  {
    name: "Pomme + amandes",
    category: "collation",
    description: "1 pomme, 20 g d’amandes.",
    prepMinutes: 0,
    macros: { calories: 200, protein: 5, carbs: 23, fat: 10 },
    ingredients: [
      { name: "pomme", quantity: "1" },
      { name: "amandes", quantity: "20 g (~12)" },
    ],
    steps: ["Laver la pomme.", "Peser les amandes — à l'œil, on dépasse vite les 20 g."],
    photoUrl: `${WIKI}/3/3e/Almonds_in_a_bowl.jpg/960px-Almonds_in_a_bowl.jpg`,
    allergens: [...NUTS, "amande"],
  },
  {
    name: "Popcorn paprika fumé",
    category: "collation",
    description: "25 g de maïs soufflé maison, paprika fumé, une pincée de sel.",
    prepMinutes: 5,
    macros: { calories: 120, protein: 3, carbs: 23, fat: 2 },
    ingredients: [
      { name: "maïs à éclater", quantity: "25 g" },
      { name: "paprika fumé, sel", quantity: "" },
      { name: "spray d'huile", quantity: "facultatif" },
    ],
    steps: [
      "Éclater le maïs au micro-ondes (bol couvert, ~3 min) ou à la casserole couverte, sans huile.",
      "Assaisonner de paprika fumé et sel.",
      "Un coup de spray d'huile pour faire tenir les épices si besoin.",
    ],
    photoUrl: `${WIKI}/e/e4/Popcorn_9.jpg/960px-Popcorn_9.jpg`,
    allergens: [],
  },
  {
    name: "Glace protéinée",
    category: "collation",
    description: "Un pot entier type Oppo ou Halo Top.",
    prepMinutes: 0,
    macros: { calories: 300, protein: 20, carbs: 35, fat: 9 },
    ingredients: [{ name: "glace protéinée (type Oppo, Halo Top)", quantity: "1 pot" }],
    steps: [
      "Laisser ramollir 3 min à température ambiante pour la texture.",
      "Compter le pot entier dans tes kcal.",
    ],
    photoUrl: `${WIKI}/9/9a/Brave_Robot_ice_cream.jpg/960px-Brave_Robot_ice_cream.jpg`,
    allergens: [...DAIRY],
  },
];
