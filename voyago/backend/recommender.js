const DEFAULT_ALPHA = 3;
const DEFAULT_BETA = 3;
const PARENT_UPDATE_WEIGHT = 0.35;

const TAG_GROUPS = [
  {
    parent: "cuisine_asian",
    children: [
      "japanese",
      "sushi",
      "ramen",
      "izakaya",
      "korean",
      "korean_bbq",
      "chinese",
      "dim_sum",
      "hot_pot",
      "thai",
      "vietnamese",
      "pho",
      "indian",
      "pakistani",
      "filipino",
      "malaysian",
      "indonesian",
    ],
  },
  {
    parent: "cuisine_european",
    children: ["italian", "pizza", "pasta", "french", "spanish", "tapas", "greek"],
  },
  {
    parent: "cuisine_middle_east_africa",
    children: ["middle_eastern", "lebanese", "turkish", "moroccan", "african", "ethiopian", "nigerian"],
  },
  {
    parent: "cuisine_americas",
    children: [
      "american",
      "new_american",
      "southern",
      "bbq",
      "mexican",
      "tex_mex",
      "latin_american",
      "peruvian",
      "brazilian",
      "argentinian",
      "caribbean",
      "cuban",
    ],
  },
  {
    parent: "diet_flexible",
    children: ["vegan", "vegetarian", "plant_based", "healthy", "clean_eating", "gluten_free", "halal", "kosher"],
  },
  {
    parent: "price_budget",
    children: ["cheap_eats", "budget_friendly", "good_value"],
  },
  {
    parent: "price_upscale",
    children: ["moderate_price", "expensive", "fine_dining", "splurge_worthy", "tasting_menu"],
  },
  {
    parent: "vibe_chill",
    children: ["cozy", "quiet", "casual", "casual_vibe", "neighborhood_spot"],
  },
  {
    parent: "vibe_social",
    children: ["lively", "trendy", "sports_bar", "group_friendly", "family_friendly"],
  },
  {
    parent: "occasion_special",
    children: ["date_night", "special_occasion", "anniversary", "celebration", "romantic", "upscale", "intimate"],
  },
  {
    parent: "setting_outdoor",
    children: ["outdoor_seating", "patio", "rooftop", "waterfront", "scenic_view"],
  },
];

const CHILD_TO_PARENTS = buildChildToParents(TAG_GROUPS);

function buildChildToParents(groups) {
  const mapping = {};
  for (const group of groups) {
    for (const child of group.children) {
      if (!mapping[child]) {
        mapping[child] = [];
      }
      mapping[child].push(group.parent);
    }
  }
  return mapping;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeRatingToReward(rating) {
  return clamp((rating - 1) / 9, 0, 1);
}

function expectedValue(alpha, beta) {
  return alpha / (alpha + beta);
}

function betaStdDev(alpha, beta) {
  const denominator = (alpha + beta) ** 2 * (alpha + beta + 1);
  return Math.sqrt((alpha * beta) / denominator);
}

function getOrInitPref(profile, tag) {
  if (!profile.tagPrefs[tag]) {
    profile.tagPrefs[tag] = {
      alpha: DEFAULT_ALPHA,
      beta: DEFAULT_BETA,
      updates: 0,
    };
  }
  return profile.tagPrefs[tag];
}

function getTagSignals(tags, profile) {
  let preferenceSum = 0;
  let uncertaintySum = 0;
  let lowEvidenceCount = 0;

  for (const tag of tags) {
    const pref = getOrInitPref(profile, tag);
    const mean = expectedValue(pref.alpha, pref.beta);
    const uncertainty = betaStdDev(pref.alpha, pref.beta);
    preferenceSum += mean;
    uncertaintySum += uncertainty;
    if (pref.updates < 3) {
      lowEvidenceCount += 1;
    }
  }

  const count = Math.max(tags.length, 1);
  return {
    preference: preferenceSum / count,
    uncertainty: uncertaintySum / count,
    explorationPotential: lowEvidenceCount / count,
  };
}

function cuisineDiversityBonus(restaurant, profile) {
  if (!restaurant.genre) {
    return 0;
  }
  const recentGenres = profile.recentGenres ?? [];
  const recentMatchCount = recentGenres.filter((genre) => genre === restaurant.genre).length;
  if (recentMatchCount === 0) {
    return 0.07;
  }
  return -0.03 * recentMatchCount;
}

function explorationProbability(totalRatings) {
  return clamp(0.18 - totalRatings * 0.004, 0.05, 0.18);
}

function scoreRestaurant(restaurant, profile) {
  const tags = restaurant.tags ?? [];
  const signals = getTagSignals(tags, profile);
  const base = signals.preference;
  const uncertaintyBoost = 0.25 * signals.uncertainty;
  const explorationBoost = 0.09 * signals.explorationPotential;
  const diversity = cuisineDiversityBonus(restaurant, profile);
  return {
    score: base + uncertaintyBoost + explorationBoost + diversity,
    uncertainty: signals.uncertainty,
  };
}

function chooseRestaurant(ranked, profile) {
  if (ranked.length === 0) {
    return null;
  }
  const explore = Math.random() < explorationProbability(profile.totalRatings ?? 0);
  if (!explore) {
    return ranked[0];
  }
  const topSlice = ranked.slice(0, Math.min(15, ranked.length));
  topSlice.sort((a, b) => b.uncertainty - a.uncertainty);
  return topSlice[0];
}

function ensureArrayLimit(arrayRef, limit) {
  if (arrayRef.length <= limit) {
    return;
  }
  arrayRef.splice(0, arrayRef.length - limit);
}

export function createEmptyProfile(userId) {
  return {
    userId,
    tagPrefs: {},
    totalRatings: 0,
    ratings: [],
    servedRestaurantIds: [],
    ratedRestaurantIds: [],
    recentGenres: [],
    insights: null,
    lastInsightAt: null,
  };
}

export function recommendNextBatch({ userProfile, catalog, limit = 10, excludeIds = [] }) {
  if (!Array.isArray(catalog) || catalog.length === 0) {
    return [];
  }

  const excluded = new Set(excludeIds);
  const servedSet = new Set(userProfile.servedRestaurantIds ?? []);
  const ratedSet = new Set(userProfile.ratedRestaurantIds ?? []);

  const candidates = catalog.filter(
    (restaurant) => !excluded.has(restaurant.id) && !servedSet.has(restaurant.id) && !ratedSet.has(restaurant.id),
  );
  const pool = candidates.length > 0 ? candidates : catalog.filter((restaurant) => !excluded.has(restaurant.id));
  if (pool.length === 0) {
    return [];
  }

  const recommendations = [];
  const mutablePool = [...pool];
  while (recommendations.length < limit && mutablePool.length > 0) {
    const ranked = mutablePool
      .map((restaurant) => {
        const metrics = scoreRestaurant(restaurant, userProfile);
        return { restaurant, ...metrics };
      })
      .sort((a, b) => b.score - a.score);
    const chosen = chooseRestaurant(ranked, userProfile);
    if (!chosen) {
      break;
    }
    recommendations.push(chosen.restaurant);
    const index = mutablePool.findIndex((restaurant) => restaurant.id === chosen.restaurant.id);
    if (index >= 0) {
      mutablePool.splice(index, 1);
    }
  }

  for (const restaurant of recommendations) {
    userProfile.servedRestaurantIds.push(restaurant.id);
  }
  ensureArrayLimit(userProfile.servedRestaurantIds, 800);
  return recommendations;
}

export function applyRating({ userProfile, restaurant, rating }) {
  const reward = normalizeRatingToReward(rating);
  const tags = restaurant.tags ?? [];

  for (const tag of tags) {
    const pref = getOrInitPref(userProfile, tag);
    pref.alpha += reward;
    pref.beta += 1 - reward;
    pref.updates += 1;

    const parents = CHILD_TO_PARENTS[tag] ?? [];
    for (const parent of parents) {
      const parentPref = getOrInitPref(userProfile, parent);
      parentPref.alpha += reward * PARENT_UPDATE_WEIGHT;
      parentPref.beta += (1 - reward) * PARENT_UPDATE_WEIGHT;
      parentPref.updates += 1;
    }
  }

  userProfile.totalRatings += 1;
  userProfile.ratedRestaurantIds.push(restaurant.id);
  ensureArrayLimit(userProfile.ratedRestaurantIds, 800);

  if (restaurant.genre) {
    userProfile.recentGenres.push(restaurant.genre);
    ensureArrayLimit(userProfile.recentGenres, 20);
  }

  userProfile.ratings.push({
    restaurantId: restaurant.id,
    rating,
    reward,
    tags,
    timestamp: new Date().toISOString(),
  });
  ensureArrayLimit(userProfile.ratings, 200);
}

export function summarizeTopTagPrefs(userProfile, count = 8) {
  const entries = Object.entries(userProfile.tagPrefs ?? {}).map(([tag, pref]) => {
    const confidence = pref.alpha + pref.beta;
    return {
      tag,
      expected: expectedValue(pref.alpha, pref.beta),
      confidence,
    };
  });

  const reliable = entries.filter((entry) => entry.confidence >= 10);
  const liked = [...reliable].sort((a, b) => b.expected - a.expected).slice(0, count);
  const disliked = [...reliable].sort((a, b) => a.expected - b.expected).slice(0, count);
  return { liked, disliked };
}
