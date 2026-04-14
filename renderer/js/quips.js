// Dry/funny over-budget lines, tiered by percent over calorie goal.
// Self-deprecating about the situation, not the person.

var CT = window.CT || (window.CT = {});

const QUIPS = {
  // 0% < over <= 10%  — light, gentle
  tier1: [
    "Technically over. Philosophically fine.",
    "A rounding error, if your rounding is generous.",
    "The deficit is on a coffee break.",
    "Close enough for jazz.",
    "Within the margin of denial.",
    "Barely over. Barely.",
    "The budget is lightly compromised.",
    "A small tax on living.",
    "Slight overshoot. Rocket still in orbit.",
    "Goal: dented.",
    "A tactical overreach.",
    "You paid the convenience fee.",
    "Numerical indulgence logged.",
    "No points on your license.",
    "Budget pleasantly bruised.",
    "Crossed the line. Didn't stomp it.",
    "Margin of error, loosely defined.",
    "The calculator winced.",
    "Over by a pinch. A generous pinch.",
    "Rebalancing recommended, not required.",
    "Light tax, paid in full.",
    "The goal called. It's fine.",
    "A gentle overcorrection.",
    "Just a sprinkle over.",
    "The spreadsheet noted it and moved on."
  ],

  // 10% < over <= 25% — playful, sharper
  tier2: [
    "The deficit is not answering its phone.",
    "Plan survived until it didn't.",
    "Math has opinions.",
    "The fridge has entered the chat.",
    "Goal: negotiable, apparently.",
    "Calorie budget: lightly on fire.",
    "You and the goal have drifted apart.",
    "Deficit? I hardly know her.",
    "The spreadsheet is raising an eyebrow.",
    "That was brave.",
    "The plan met reality. Reality won.",
    "Calorie creditor calling.",
    "An ambitious afternoon.",
    "Goalposts moving themselves in self-defense.",
    "Budget: vibes-based now.",
    "Discipline on a coffee break.",
    "The macros have questions.",
    "Strong effort. Wrong direction.",
    "Calorie limit sends its regards.",
    "Leftovers: undefeated.",
    "Executive decisions were made.",
    "The pantry is doing numbers.",
    "Restraint left the building.",
    "One for the archives.",
    "The diary just sighed."
  ],

  // 25% < over <= 50% — dry, theatrical
  tier3: [
    "Calorie budget officially fictional.",
    "The deficit has been declared missing.",
    "RIP deficit — we hardly knew ye.",
    "Kitchen: 1. Willpower: 0.",
    "Goal? Never heard of her.",
    "Catering for one. Aggressively.",
    "The oven filed for overtime.",
    "Big day for the crumbs.",
    "The budget has left the country.",
    "Today's theme: abundance.",
    "You feasted. We noticed.",
    "Macro chaos. Vibes immaculate.",
    "The plate did not survive.",
    "Archaeologists will study this day.",
    "Pending hall-of-fame review.",
    "The numbers refused to comment.",
    "An unscheduled buffet occurred.",
    "Spreadsheet: cowering.",
    "Calorie containment breach.",
    "Goal unreachable. Try again tomorrow.",
    "You outran the math.",
    "The fridge posted a W.",
    "Caloric surplus: acquired.",
    "Full send. Full receipt.",
    "The app is taking notes."
  ],

  // >50% over — absurd, giving up the bit
  tier4: [
    "App concedes. Well played.",
    "The calculator has resigned.",
    "Goal has entered witness protection.",
    "A feast for the ages.",
    "Deleting the budget. Starting a festival.",
    "We're writing a cookbook about today.",
    "The tracker requests hazard pay.",
    "Calorie singularity achieved.",
    "The deficit is not just dead, it is avenged.",
    "History will name today.",
    "Gravitational events occurred.",
    "New moon, new budget, same story.",
    "Budget: purely theoretical.",
    "The scale is hiding.",
    "This was a lifestyle choice.",
    "Respectfully, absolutely not.",
    "App in shambles.",
    "Containment failed. Have a nice day.",
    "Heroic effort. Wrong arena.",
    "A monument to eating.",
    "The diary needs a moment.",
    "This is art now.",
    "Stopped counting. Started praying.",
    "Legend status confirmed. See you at the gym.",
    "Zero notes. Standing ovation."
  ]
};

function tierFor(ratio) {
  if (ratio <= 1.0)  return null;
  if (ratio <= 1.10) return QUIPS.tier1;
  if (ratio <= 1.25) return QUIPS.tier2;
  if (ratio <= 1.50) return QUIPS.tier3;
  return QUIPS.tier4;
}

// Deterministic pick based on date + tier, so the line doesn't flicker as you
// log food but does rotate once you tip into a new tier or a new day.
function seedFrom(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h;
}

CT.quips = {
  pick(calories, target, dateStr) {
    if (!target || target <= 0 || !calories) return '';
    const ratio = calories / target;
    const tier = tierFor(ratio);
    if (!tier) return '';
    const tierIdx = [QUIPS.tier1, QUIPS.tier2, QUIPS.tier3, QUIPS.tier4].indexOf(tier);
    const seed = seedFrom(dateStr + ':' + tierIdx);
    return tier[seed % tier.length];
  }
};
