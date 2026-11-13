/**
 * The illustration a recipe gets when it has no photo — or when its photo fails
 * to load (offline PWA, a hotlink gone). Never a grey hole.
 *
 * Diet's `drawArt` is drawn by hand per recipe; a Chef recipe has no such
 * drawing, so this one is generic: a plate (or a bowl, or a ramekin, by shelf),
 * toppings picked from words in the name and ingredients, and every position and
 * colour drawn from a generator seeded by the name. Same name, same picture, on
 * every device — no state, no network.
 */

import { Fragment } from "react";
import type { RecipeCategory } from "../../../convex/recipeLogic";

/** diet's mkRng: FNV-1a seed, mulberry32 stream. */
export function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (const c of seed) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fold = (s: string) =>
  s
    .toLowerCase()
    .replace(/œ/g, "oe")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

type Topping =
  | "rice"
  | "pasta"
  | "chicken"
  | "beef"
  | "fish"
  | "egg"
  | "greens"
  | "tomato"
  | "berries"
  | "oats"
  | "cream"
  | "choco"
  | "potato"
  | "bread";

/** Word stems → topping. First match per topping; order is drawing order (bed first). */
const KEYWORDS: [Topping, RegExp][] = [
  ["rice", /\b(riz|risotto|quinoa|boulgour|semoule)/],
  ["pasta", /\b(pate|spaghetti|penne|nouille|tagliatelle|lasagne|coquillette)/],
  ["oats", /\b(avoine|flocon|granola|muesli|porridge)/],
  ["potato", /\b(pomme de terre|patate|frite|puree)/],
  ["bread", /\b(pain|toast|tartine|bagel|wrap|tortilla|pita|naan|burger|croque)/],
  ["cream", /\b(skyr|yaourt|fromage blanc|creme|feta|mozza|ricotta)/],
  [
    "greens",
    /\b(salade|epinard|brocoli|courgette|haricot vert|roquette|chou|poireau|legume|avocat|concombre|edamame)/,
  ],
  ["chicken", /\b(poulet|dinde|volaille)/],
  ["beef", /\b(boeuf|steak|hache|veau|agneau|chili|bolo)/],
  ["fish", /\b(saumon|thon|cabillaud|poisson|crevette|colin|truite|sardine)/],
  ["egg", /\b(oeuf|omelette)/],
  ["tomato", /\b(tomate|poivron|ratatouille)/],
  ["berries", /\b(fruits rouges|myrtille|fraise|framboise|banane|pomme|mangue|fruit)/],
  ["choco", /\b(chocolat|cacao|cafe|espresso)/],
];

export function toppingsFor(name: string, ingredients: string[] = []): Topping[] {
  const text = fold([name, ...ingredients].join(" "));
  return KEYWORDS.filter(([, re]) => re.test(text)).map(([topping]) => topping);
}

// Warm, food-ish backdrops; one per recipe, picked by the seed.
const BACKDROPS = ["#F3E3C7", "#E9D8C0", "#DCE7D3", "#F2D6C9", "#E4DCEF", "#D7E4EA", "#F1E6B8"];

const f1 = (n: number) => n.toFixed(1);

export function RecipeArt({
  name,
  category,
  ingredients,
  className,
}: {
  name: string;
  category: RecipeCategory;
  ingredients?: string[];
  className?: string;
}) {
  const rng = seededRandom(name);
  const R = (a: number, b: number) => a + rng() * (b - a);
  const pick = <T,>(list: T[]) => list[Math.floor(rng() * list.length)];

  const cx = 160 + R(-12, 12);
  const cy = 98;
  const r = category === "collation" ? 54 : category === "petit_dej" ? 62 : 70;

  /** A point inside the food area, sqrt-distributed so it fills the disc. */
  const pt = (spread = r * 0.68): [number, number] => {
    const a = R(0, Math.PI * 2);
    const d = Math.sqrt(rng()) * spread;
    return [cx + Math.cos(a) * d, cy + Math.sin(a) * d];
  };

  /** Wobbly closed blob, diet's blobPath. */
  const blob = (x: number, y: number, rr: number, jitter = 0.22, n = 9) => {
    const ps: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const k = rr * (1 + R(-jitter, jitter));
      ps.push([x + Math.cos(a) * k, y + Math.sin(a) * k]);
    }
    let d = `M${f1((ps[0][0] + ps[n - 1][0]) / 2)},${f1((ps[0][1] + ps[n - 1][1]) / 2)}`;
    for (let i = 0; i < n; i++) {
      const a = ps[i];
      const b = ps[(i + 1) % n];
      d += `Q${f1(a[0])},${f1(a[1])} ${f1((a[0] + b[0]) / 2)},${f1((a[1] + b[1]) / 2)}`;
    }
    return `${d}Z`;
  };

  const toppings = toppingsFor(name, ingredients ?? []);
  // Nothing recognised: two or three generic blobs in the recipe's own hues.
  const hue = Math.floor(R(0, 360));
  const shapes: React.ReactNode[] = [];
  let key = 0;
  const add = (node: React.ReactElement) => shapes.push(<Fragment key={key++}>{node}</Fragment>);

  const scatter = (
    n: number,
    draw: (x: number, y: number) => React.ReactElement,
    spread?: number,
  ) => {
    for (let i = 0; i < n; i++) {
      const [x, y] = pt(spread);
      add(draw(x, y));
    }
  };

  for (const t of toppings) {
    switch (t) {
      case "rice":
        add(<path d={blob(cx - r * 0.2, cy, r * 0.45, 0.12)} fill="#F7F4EC" />);
        scatter(
          26,
          (x, y) => (
            <ellipse
              cx={f1(x - r * 0.2)}
              cy={f1(y)}
              rx="2.6"
              ry="1.2"
              fill={rng() < 0.5 ? "#FFFFFF" : "#E9E3D5"}
              transform={`rotate(${Math.floor(R(0, 180))} ${f1(x - r * 0.2)} ${f1(y)})`}
            />
          ),
          r * 0.4,
        );
        break;
      case "pasta":
        add(<path d={blob(cx, cy, r * 0.6, 0.1)} fill="#E3BE6C" />);
        for (let i = 0; i < 12; i++) {
          const rr = R(r * 0.15, r * 0.55);
          const a0 = R(0, 6.28);
          const a1 = a0 + R(1.4, 3);
          add(
            <path
              d={`M${f1(cx + Math.cos(a0) * rr)} ${f1(cy + Math.sin(a0) * rr)}A${f1(rr)} ${f1(rr)} 0 0 1 ${f1(cx + Math.cos(a1) * rr)} ${f1(cy + Math.sin(a1) * rr)}`}
              stroke={rng() < 0.5 ? "#F2D58E" : "#EBCB7E"}
              strokeWidth="3.5"
              fill="none"
              strokeLinecap="round"
            />,
          );
        }
        break;
      case "oats":
        add(<path d={blob(cx, cy, r * 0.62, 0.1)} fill="#E8D6B5" />);
        scatter(
          30,
          (x, y) => (
            <ellipse
              cx={f1(x)}
              cy={f1(y)}
              rx="3.2"
              ry="2.2"
              fill={rng() < 0.5 ? "#D9C095" : "#F1E3C6"}
            />
          ),
          r * 0.55,
        );
        break;
      case "potato":
        for (let i = 0; i < 9; i++) {
          const x = cx + r * 0.35 + R(-16, 16);
          const y = cy + R(-18, 18);
          add(
            <rect
              x={f1(x - 3)}
              y={f1(y - 12)}
              width="6"
              height="24"
              rx="2"
              fill={rng() < 0.5 ? "#F2C14E" : "#E9AE34"}
              transform={`rotate(${Math.floor(R(-60, 60))} ${f1(x)} ${f1(y)})`}
            />,
          );
        }
        break;
      case "bread": {
        const x = cx - r * 0.15;
        add(<rect x={f1(x - 34)} y={f1(cy - 24)} width="68" height="48" rx="16" fill="#B9773A" />);
        add(<rect x={f1(x - 30)} y={f1(cy - 20)} width="60" height="40" rx="13" fill="#E9C48A" />);
        break;
      }
      case "cream":
        add(<path d={blob(cx + r * 0.25, cy - r * 0.2, r * 0.26, 0.18)} fill="#FBFAF5" />);
        add(<path d={blob(cx + r * 0.2, cy - r * 0.25, r * 0.11, 0.2)} fill="#FFFFFF" />);
        break;
      case "greens":
        scatter(9, (x, y) => (
          <ellipse
            cx={f1(x)}
            cy={f1(y)}
            rx={f1(R(6, 10))}
            ry={f1(R(3.5, 5))}
            fill={rng() < 0.5 ? "#4E9238" : "#7DB356"}
            transform={`rotate(${Math.floor(R(0, 180))} ${f1(x)} ${f1(y)})`}
          />
        ));
        break;
      case "chicken":
        scatter(
          6,
          (x, y) => (
            <rect
              x={f1(x - 8)}
              y={f1(y - 6)}
              width="16"
              height="12"
              rx="4"
              fill="#E2B06A"
              stroke="#B57A3A"
              strokeWidth="1.2"
              transform={`rotate(${Math.floor(R(0, 180))} ${f1(x)} ${f1(y)})`}
            />
          ),
          r * 0.5,
        );
        break;
      case "beef":
        scatter(
          14,
          (x, y) => (
            <path d={blob(x, y, R(3.5, 6), 0.35, 6)} fill={rng() < 0.5 ? "#7A3F22" : "#93512D"} />
          ),
          r * 0.55,
        );
        break;
      case "fish":
        scatter(
          5,
          (x, y) => (
            <rect
              x={f1(x - 9)}
              y={f1(y - 6)}
              width="18"
              height="12"
              rx="4"
              fill="#F2895A"
              stroke="#FBD3BE"
              strokeWidth="1.4"
              transform={`rotate(${Math.floor(R(0, 180))} ${f1(x)} ${f1(y)})`}
            />
          ),
          r * 0.5,
        );
        break;
      case "egg": {
        const [x, y] = pt(r * 0.35);
        add(<path d={blob(x, y, 17, 0.2)} fill="#FFFFFF" stroke="#EDE8DE" />);
        add(<circle cx={f1(x + 2)} cy={f1(y - 1)} r="6.5" fill="#F7B21B" />);
        break;
      }
      case "tomato":
        scatter(4, (x, y) => (
          <g>
            <circle cx={f1(x)} cy={f1(y)} r="7" fill="#E0412F" />
            <circle cx={f1(x)} cy={f1(y)} r="4.3" fill="#F58A73" />
          </g>
        ));
        break;
      case "berries":
        scatter(
          10,
          (x, y) => (
            <circle
              cx={f1(x)}
              cy={f1(y)}
              r={f1(R(3, 4.5))}
              fill={pick(["#B3263A", "#5B4B9E", "#D7263D"])}
            />
          ),
          r * 0.6,
        );
        break;
      case "choco":
        scatter(
          18,
          (x, y) => <circle cx={f1(x)} cy={f1(y)} r={f1(R(1, 2))} fill="#5A3420" />,
          r * 0.6,
        );
        break;
    }
  }

  if (toppings.length === 0) {
    for (let i = 0; i < 3; i++) {
      const [x, y] = pt(r * 0.35);
      add(
        <path
          d={blob(x, y, R(r * 0.18, r * 0.3), 0.3)}
          fill={`hsl(${(hue + i * 40) % 360} 55% ${R(55, 70).toFixed(0)}%)`}
        />,
      );
    }
  }
  // Herbs on everything savoury: it reads as « food » even when nothing matched.
  if (category !== "collation") {
    scatter(10, (x, y) => <circle cx={f1(x)} cy={f1(y)} r="1.5" fill="#3F8F3A" />);
  }

  const backdrop = pick(BACKDROPS);
  const rim = category === "petit_dej" ? "#F3EFE7" : "#FDFDFB";

  return (
    // Decorative: the recipe's name is always written right next to it.
    <svg
      viewBox="0 0 320 190"
      aria-hidden
      className={className}
      preserveAspectRatio="xMidYMid slice"
    >
      <rect width="320" height="190" fill={backdrop} />
      <ellipse cx={cx + 4} cy={cy + 8} rx={r + 4} ry={r + 4} fill="rgba(20,23,28,.14)" />
      <circle cx={cx} cy={cy} r={r + 6} fill="#FBFAF7" stroke="#E4DFD6" strokeWidth="2" />
      <circle cx={cx} cy={cy} r={r * 0.86} fill={rim} stroke="#EEEAE2" strokeWidth="2" />
      {shapes}
    </svg>
  );
}
