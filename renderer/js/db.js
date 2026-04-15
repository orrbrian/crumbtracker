// IndexedDB wrapper for CrumbTracker.
// Stores:
//   foods    — custom & cached remote foods (keyed by id; barcode indexed)
//   entries  — diary entries (keyed by id; date + meal indexed)
//   settings — key/value (targets, prefs)

const DB_NAME = 'crumbtracker';
const DB_VERSION = 5;

var CT = window.CT || (window.CT = {});

// Schema spec: each store with the indexes it must have. onupgradeneeded
// creates missing stores AND reconciles missing indexes on existing stores.
const SCHEMA = {
  foods:    { keyPath: 'id',   indexes: { barcode: 'barcode', source: 'source', updated_at: 'updated_at' } },
  entries:  { keyPath: 'id',   indexes: { date: 'date', date_meal: ['date', 'meal'] } },
  settings: { keyPath: 'key',  indexes: {} },
  notes:    { keyPath: 'date', indexes: {} },
  weights:  { keyPath: 'date', indexes: {} },
  exercise: { keyPath: 'id',   indexes: { date: 'date' } },
  meals:    { keyPath: 'id',   indexes: { updated_at: 'updated_at' } }
};

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const tx = req.transaction; // versionchange transaction, gives access to existing stores
      for (const [name, spec] of Object.entries(SCHEMA)) {
        let store;
        if (!db.objectStoreNames.contains(name)) {
          store = db.createObjectStore(name, { keyPath: spec.keyPath });
        } else {
          store = tx.objectStore(name);
        }
        for (const [idxName, keyPath] of Object.entries(spec.indexes)) {
          if (!store.indexNames.contains(idxName)) {
            store.createIndex(idxName, keyPath, { unique: false });
          }
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let _db;
async function db() {
  if (!_db) _db = await openDb();
  return _db;
}

function tx(storeNames, mode = 'readonly') {
  return db().then(d => {
    const t = d.transaction(storeNames, mode);
    return Array.isArray(storeNames)
      ? storeNames.map(n => t.objectStore(n))
      : t.objectStore(storeNames);
  });
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

CT.db = {
  async saveFood(food) {
    // Preserve last_amount across updates if the caller didn't supply one.
    let prior = null;
    if (food.id) prior = await this.getFood(food.id);
    const store = await tx('foods', 'readwrite');
    const record = {
      id: food.id || uid(),
      name: food.name || '',
      brand: food.brand || '',
      barcode: food.barcode || '',
      serving_size: Number(food.serving_size) || 0,
      serving_unit: food.serving_unit || 'g',
      serving_source: food.serving_source || (prior && prior.serving_source) || 'custom',
      calories: Number(food.calories) || 0,
      protein: Number(food.protein) || 0,
      carbs: Number(food.carbs) || 0,
      fat: Number(food.fat) || 0,
      image: food.image || (prior && prior.image) || '',
      source: food.source || 'custom',
      last_amount: Number(food.last_amount) || (prior && Number(prior.last_amount)) || 0,
      updated_at: Date.now()
    };
    await reqToPromise(store.put(record));
    return record;
  },

  async updateLastAmount(foodId, amount) {
    const food = await this.getFood(foodId);
    if (!food) return;
    food.last_amount = Number(amount) || 0;
    food.updated_at = Date.now();
    const store = await tx('foods', 'readwrite');
    await reqToPromise(store.put(food));
  },

  async getFood(id) {
    const store = await tx('foods');
    return reqToPromise(store.get(id));
  },

  async getFoodByBarcode(barcode) {
    const store = await tx('foods');
    const idx = store.index('barcode');
    return reqToPromise(idx.get(barcode));
  },

  async deleteFood(id) {
    const store = await tx('foods', 'readwrite');
    await reqToPromise(store.delete(id));
  },

  async listFoods({ source = null } = {}) {
    const store = await tx('foods');
    const results = [];
    return new Promise((resolve, reject) => {
      const req = store.openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) { resolve(results.sort((a, b) => b.updated_at - a.updated_at)); return; }
        if (!source || cur.value.source === source) results.push(cur.value);
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    });
  },

  async addEntry(entry) {
    const store = await tx('entries', 'readwrite');
    const record = {
      id: entry.id || uid(),
      date: entry.date,           // YYYY-MM-DD
      meal: entry.meal,           // breakfast | lunch | dinner | snacks
      food_id: entry.food_id,
      name: entry.name,
      brand: entry.brand || '',
      servings: Number(entry.servings) || 1,
      serving_size: Number(entry.serving_size) || 0,
      serving_unit: entry.serving_unit || 'g',
      calories: Number(entry.calories) || 0,
      protein: Number(entry.protein) || 0,
      carbs: Number(entry.carbs) || 0,
      fat: Number(entry.fat) || 0,
      created_at: Date.now()
    };
    await reqToPromise(store.put(record));
    return record;
  },

  async deleteEntry(id) {
    const store = await tx('entries', 'readwrite');
    await reqToPromise(store.delete(id));
  },

  async listEntriesForDate(date) {
    const store = await tx('entries');
    const idx = store.index('date');
    return new Promise((resolve, reject) => {
      const results = [];
      const req = idx.openCursor(IDBKeyRange.only(date));
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) { resolve(results.sort((a, b) => a.created_at - b.created_at)); return; }
        results.push(cur.value);
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    });
  },

  async recentEntries(limit = 25) {
    const store = await tx('entries');
    return new Promise((resolve, reject) => {
      const seen = new Set();
      const results = [];
      const req = store.openCursor(null, 'prev');
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur || results.length >= limit) { resolve(results); return; }
        const v = cur.value;
        if (v.food_id && !seen.has(v.food_id)) {
          seen.add(v.food_id);
          results.push(v);
        }
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    });
  },

  async getSetting(key, fallback = null) {
    const store = await tx('settings');
    const rec = await reqToPromise(store.get(key));
    return rec ? rec.value : fallback;
  },

  async setSetting(key, value) {
    const store = await tx('settings', 'readwrite');
    await reqToPromise(store.put({ key, value }));
  },

  async getNote(date) {
    const store = await tx('notes');
    const rec = await reqToPromise(store.get(date));
    return rec ? rec.text : '';
  },

  async saveNote(date, text) {
    const store = await tx('notes', 'readwrite');
    if (!text || !text.trim()) {
      await reqToPromise(store.delete(date));
    } else {
      await reqToPromise(store.put({ date, text, updated_at: Date.now() }));
    }
  },

  async saveWeight(date, kg) {
    const store = await tx('weights', 'readwrite');
    await reqToPromise(store.put({ date, kg: Number(kg) || 0, updated_at: Date.now() }));
  },

  async deleteWeight(date) {
    const store = await tx('weights', 'readwrite');
    await reqToPromise(store.delete(date));
  },

  async listWeights() {
    const store = await tx('weights');
    return new Promise((resolve, reject) => {
      const out = [];
      const req = store.openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) { resolve(out.sort((a, b) => a.date < b.date ? -1 : 1)); return; }
        out.push(cur.value);
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    });
  },

  async latestWeight() {
    const all = await this.listWeights();
    return all.length ? all[all.length - 1] : null;
  },

  async addExercise(ex) {
    const store = await tx('exercise', 'readwrite');
    const rec = {
      id: ex.id || uid(),
      date: ex.date,
      name: ex.name || '',
      duration_min: Number(ex.duration_min) || 0,
      calories: Number(ex.calories) || 0,
      created_at: Date.now()
    };
    await reqToPromise(store.put(rec));
    return rec;
  },

  async deleteExercise(id) {
    const store = await tx('exercise', 'readwrite');
    await reqToPromise(store.delete(id));
  },

  async listExercisesForDate(date) {
    const store = await tx('exercise');
    const idx = store.index('date');
    return new Promise((resolve, reject) => {
      const out = [];
      const req = idx.openCursor(IDBKeyRange.only(date));
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) { resolve(out.sort((a, b) => a.created_at - b.created_at)); return; }
        out.push(cur.value);
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    });
  },

  async saveMeal(meal) {
    const store = await tx('meals', 'readwrite');
    const record = {
      id: meal.id || uid(),
      name: meal.name || '',
      image: meal.image || '',
      ingredients: (meal.ingredients || []).map(i => ({
        food_id: i.food_id,
        servings: Number(i.servings) || 0
      })),
      updated_at: Date.now()
    };
    await reqToPromise(store.put(record));
    return record;
  },

  async getMeal(id) {
    const store = await tx('meals');
    return reqToPromise(store.get(id));
  },

  async deleteMeal(id) {
    const store = await tx('meals', 'readwrite');
    await reqToPromise(store.delete(id));
  },

  async listMeals() {
    const store = await tx('meals');
    return new Promise((resolve, reject) => {
      const out = [];
      const req = store.openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) { resolve(out.sort((a, b) => b.updated_at - a.updated_at)); return; }
        out.push(cur.value);
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    });
  },

  // Resolve ingredients to their food records and return the meal with totalled
  // macros plus a food-shaped view that openAddModal can consume. Ingredients
  // whose food has been deleted are reported in `unresolved`.
  async hydrateMeal(meal) {
    let calories = 0, protein = 0, carbs = 0, fat = 0;
    const resolved = [];
    const unresolved = [];
    for (const ing of meal.ingredients || []) {
      const food = await this.getFood(ing.food_id);
      if (!food) { unresolved.push(ing); continue; }
      const s = Number(ing.servings) || 0;
      calories += (food.calories || 0) * s;
      protein  += (food.protein  || 0) * s;
      carbs    += (food.carbs    || 0) * s;
      fat      += (food.fat      || 0) * s;
      resolved.push({ ...ing, food });
    }
    return {
      ...meal,
      resolved,
      unresolved,
      calories, protein, carbs, fat,
      serving_size: 1,
      serving_unit: 'serving',
      source: 'meal'
    };
  },

  async wipeAll() {
    const d = await db();
    for (const name of ['foods', 'entries', 'settings', 'notes', 'weights', 'exercise', 'meals']) {
      const t = d.transaction(name, 'readwrite');
      await reqToPromise(t.objectStore(name).clear());
    }
  }
};
