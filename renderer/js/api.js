// Open Food Facts client.
// Docs: https://openfoodfacts.github.io/openfoodfacts-server/api/

var CT = window.CT || (window.CT = {});

const OFF_BASE = 'https://world.openfoodfacts.org';
const OFF_SEARCH = 'https://search.openfoodfacts.org';

function nutrientPerServing(n, servingG) {
  // Open Food Facts gives nutrients "per 100g" by default.
  // Some products include nutriments_serving; prefer those when present.
  if (!n) return {};
  const hasServing = n['energy-kcal_serving'] != null || n['energy-kcal_serving_value'] != null;
  if (hasServing) {
    return {
      calories: num(n['energy-kcal_serving'] ?? n['energy-kcal_serving_value']),
      protein:  num(n.proteins_serving),
      carbs:    num(n.carbohydrates_serving),
      fat:      num(n.fat_serving)
    };
  }
  const per100 = {
    calories: num(n['energy-kcal_100g']),
    protein:  num(n.proteins_100g),
    carbs:    num(n.carbohydrates_100g),
    fat:      num(n.fat_100g)
  };
  if (servingG > 0) {
    const k = servingG / 100;
    return {
      calories: per100.calories * k,
      protein:  per100.protein * k,
      carbs:    per100.carbs * k,
      fat:      per100.fat * k
    };
  }
  return per100;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseServing(sizeStr) {
  // "30 g" / "250ml" / "1 piece (20 g)" → {size, unit}
  if (!sizeStr) return { size: 100, unit: 'g' };
  const m = String(sizeStr).match(/([\d.,]+)\s*(g|ml|oz|piece|pieces|slice|slices)?/i);
  if (!m) return { size: 100, unit: 'g' };
  const size = Number(m[1].replace(',', '.')) || 100;
  const unit = (m[2] || 'g').toLowerCase();
  return { size, unit };
}

function offProductToFood(p) {
  const { size, unit, inferred } = pickServing(p);
  const macros = nutrientPerServing(p.nutriments, unit === 'g' ? size : 0);
  return {
    id: 'off:' + (p.code || p._id || Math.random().toString(36).slice(2)),
    source: 'off',
    name: p.product_name || p.generic_name || p.product_name_en || '(unnamed)',
    brand: firstBrand(p.brands),
    barcode: p.code || '',
    serving_size: size,
    serving_unit: unit,
    serving_source: inferred, // 'product' | 'category' | 'default'
    calories: round(macros.calories),
    protein: round(macros.protein),
    carbs: round(macros.carbs),
    fat: round(macros.fat),
    image: p.image_small_url || p.image_front_small_url || p.image_url || ''
  };
}

function round(n) { return Math.round(n * 10) / 10; }

function firstBrand(b) {
  if (!b) return '';
  if (Array.isArray(b)) return String(b[0] || '').trim();
  return String(b).split(',')[0].trim();
}

const FIELDS = 'code,product_name,generic_name,brands,serving_size,serving_quantity,serving_quantity_unit,categories_tags,nutriments,image_small_url,image_front_small_url,image_url';

// Typical single-serving portions by Open Food Facts category, used when the
// product doesn't include its own serving size. Order matters (most specific first).
const CATEGORY_DEFAULTS = [
  { tag: 'waters',               size: 250, unit: 'ml' },
  { tag: 'sodas',                size: 330, unit: 'ml' },
  { tag: 'juices',               size: 250, unit: 'ml' },
  { tag: 'plant-based-milks',    size: 240, unit: 'ml' },
  { tag: 'milks',                size: 240, unit: 'ml' },
  { tag: 'beverages',            size: 250, unit: 'ml' },
  { tag: 'yogurts',              size: 125, unit: 'g' },
  { tag: 'cheeses',              size: 30,  unit: 'g' },
  { tag: 'breakfast-cereals',    size: 30,  unit: 'g' },
  { tag: 'breads',               size: 50,  unit: 'g' },
  { tag: 'chocolates',           size: 25,  unit: 'g' },
  { tag: 'biscuits-and-cakes',   size: 30,  unit: 'g' },
  { tag: 'chips-and-fries',      size: 30,  unit: 'g' },
  { tag: 'crackers',             size: 30,  unit: 'g' },
  { tag: 'nuts',                 size: 30,  unit: 'g' },
  { tag: 'snacks',               size: 30,  unit: 'g' },
  { tag: 'ice-creams',           size: 100, unit: 'g' },
  { tag: 'pastas',               size: 75,  unit: 'g' },
  { tag: 'rice',                 size: 75,  unit: 'g' },
  { tag: 'meats',                size: 100, unit: 'g' },
  { tag: 'fishes',               size: 100, unit: 'g' },
  { tag: 'fish-and-seafood',     size: 100, unit: 'g' },
  { tag: 'eggs',                 size: 50,  unit: 'g' },
  { tag: 'oils',                 size: 15,  unit: 'ml' },
  { tag: 'condiments',           size: 15,  unit: 'g' },
  { tag: 'dairies',              size: 100, unit: 'ml' },
  { tag: 'fruits',               size: 150, unit: 'g' },
  { tag: 'vegetables',           size: 100, unit: 'g' }
];

function categoryDefault(tags) {
  if (!Array.isArray(tags)) return null;
  const clean = tags.map(t => String(t).toLowerCase().replace(/^[a-z]{2}:/, ''));
  for (const { tag, size, unit } of CATEGORY_DEFAULTS) {
    if (clean.includes(tag)) return { size, unit, inferred: 'category' };
  }
  return null;
}

function pickServing(p) {
  if (p.serving_size) {
    const parsed = parseServing(p.serving_size);
    return { ...parsed, inferred: 'product' };
  }
  const q = Number(p.serving_quantity);
  if (Number.isFinite(q) && q > 0) {
    const u = String(p.serving_quantity_unit || 'g').toLowerCase();
    return { size: q, unit: u === 'ml' ? 'ml' : 'g', inferred: 'product' };
  }
  const fromCat = categoryDefault(p.categories_tags);
  if (fromCat) return fromCat;
  return { size: 100, unit: 'g', inferred: 'default' };
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
  return res.json();
}

async function searchViaSAL(query, pageSize) {
  // Search-a-licious (new OFF search service). Returns { hits: [...] }.
  const url = `${OFF_SEARCH}/search?q=${encodeURIComponent(query)}&page_size=${pageSize}&fields=${FIELDS}`;
  const json = await fetchJson(url);
  return json.hits || json.products || [];
}

async function searchViaLegacy(query, pageSize) {
  const url = `${OFF_BASE}/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=${pageSize}&fields=${FIELDS}`;
  const json = await fetchJson(url);
  return json.products || [];
}

CT.api = {
  async searchProducts(query, { pageSize = 20 } = {}) {
    let products;
    try {
      products = await searchViaSAL(query, pageSize);
    } catch (e) {
      console.warn('Search-a-licious failed, falling back to legacy:', e);
      products = await searchViaLegacy(query, pageSize);
    }
    return products
      .filter(p => p && (p.product_name || p.generic_name))
      .map(offProductToFood);
  },

  async lookupBarcode(barcode) {
    const url = `${OFF_BASE}/api/v2/product/${encodeURIComponent(barcode)}.json`;
    const json = await fetchJson(url);
    if (json.status !== 1 || !json.product) return null;
    return offProductToFood(json.product);
  }
};
