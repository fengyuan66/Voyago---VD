import http from "node:http";
import { loadCatalog, loadUserProfiles, saveCatalog, saveUserProfiles } from "./db.js";
import { importTaggedCatalogFromObject } from "./catalog.js";
import { applyRating, createEmptyProfile, recommendNextBatch, summarizeTopTagPrefs } from "./recommender.js";
import { generateLlmPicks, maybeGenerateInsights } from "./llmInsights.js";
import { hasSupabaseConfig, loadUserProfilesFromSupabase, saveUserProfilesToSupabase } from "./supabaseState.js";

const HOST = process.env.HOST ?? "0.0.0.0";
const PORT = Number(process.env.PORT ?? 8787);

let catalog = loadCatalog();
let userProfiles = loadUserProfiles();

function persistUserProfiles() {
  saveUserProfiles(userProfiles);
  if (hasSupabaseConfig()) {
    void saveUserProfilesToSupabase(userProfiles).catch(() => {
      // Non-blocking persistence path; keep API reliable even if Supabase is transiently unavailable.
    });
  }
}

async function hydrateUserProfiles() {
  if (!hasSupabaseConfig()) {
    return;
  }
  try {
    const remoteProfiles = await loadUserProfilesFromSupabase();
    if (remoteProfiles && typeof remoteProfiles === "object") {
      userProfiles = remoteProfiles;
    }
  } catch {
    // Fall back to local file cache when Supabase is unavailable.
  }
}

function getCatalogCount() {
  return Array.isArray(catalog) ? catalog.length : 0;
}

function ensureProfile(userId) {
  if (!userProfiles[userId]) {
    userProfiles[userId] = createEmptyProfile(userId);
  }
  return userProfiles[userId];
}

function setJsonHeaders(response) {
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

function sendJson(response, statusCode, payload) {
  setJsonHeaders(response);
  response.statusCode = statusCode;
  response.end(JSON.stringify(payload));
}

function parseBody(request) {
  return new Promise((resolve, reject) => {
    let data = "";
    request.on("data", (chunk) => {
      data += chunk;
      if (data.length > 2_000_000) {
        reject(new Error("Request payload too large"));
      }
    });
    request.on("end", () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    request.on("error", reject);
  });
}

function parseExcludeIds(urlObject) {
  const raw = urlObject.searchParams.get("exclude_ids");
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

function compactRestaurantForClient(restaurant) {
  return {
    id: restaurant.id,
    name: restaurant.name,
    description: restaurant.description,
    imageUrl: restaurant.imageUrl,
    address: restaurant.address,
    locationTag: restaurant.locationTag,
    lat: restaurant.lat,
    lon: restaurant.lon,
    placeUrl: restaurant.placeUrl,
    priceRange: restaurant.priceRange,
    menu: restaurant.menu,
    genre: restaurant.genre,
    website: restaurant.website,
    hours: restaurant.hours,
    tags: restaurant.tags,
  };
}

function buildLlmPickCandidates({ userProfile, catalogItems, excludeIds = [] }) {
  const excluded = new Set(excludeIds);
  const ratedSet = new Set(userProfile.ratedRestaurantIds ?? []);
  const servedSet = new Set(userProfile.servedRestaurantIds ?? []);
  const primary = catalogItems.filter(
    (restaurant) => !excluded.has(restaurant.id) && !ratedSet.has(restaurant.id) && !servedSet.has(restaurant.id),
  );
  if (primary.length >= 20) {
    return primary;
  }
  const relaxed = catalogItems.filter((restaurant) => !excluded.has(restaurant.id) && !ratedSet.has(restaurant.id));
  if (relaxed.length > 0) {
    return relaxed;
  }
  return catalogItems.filter((restaurant) => !excluded.has(restaurant.id));
}

function importCatalogAndPersist(items) {
  const byId = new Map();
  const existing = Array.isArray(catalog) ? catalog : [];
  for (const restaurant of existing) {
    byId.set(restaurant.id, restaurant);
  }
  for (const item of items) {
    byId.set(item.id, item);
  }
  catalog = [...byId.values()];
  saveCatalog(catalog);
}

function normalizeCatalogInPlace() {
  if (Array.isArray(catalog)) {
    return false;
  }

  try {
    const imported = importTaggedCatalogFromObject(catalog);
    if (imported.length > 0) {
      importCatalogAndPersist(imported);
      return true;
    }
  } catch {
    // Ignore and fallback to empty array below.
  }

  catalog = [];
  saveCatalog(catalog);
  return true;
}

async function maybeRefreshInsights(userProfile) {
  try {
    const insights = await maybeGenerateInsights(userProfile);
    if (!insights) {
      return null;
    }
    userProfile.insights = insights;
    userProfile.lastInsightAt = new Date().toISOString();
    persistUserProfiles();
    return insights;
  } catch {
    // Non-critical path; ignore LLM failures for reliability.
    return null;
  }
}

normalizeCatalogInPlace();
void hydrateUserProfiles();

const server = http.createServer(async (request, response) => {
  if (!request.url) {
    sendJson(response, 400, { error: "Missing URL" });
    return;
  }

  const urlObject = new URL(request.url, `http://${request.headers.host || `${HOST}:${PORT}`}`);

  if (request.method === "OPTIONS") {
    setJsonHeaders(response);
    response.statusCode = 204;
    response.end();
    return;
  }

  if (request.method === "GET" && urlObject.pathname === "/api/health") {
    normalizeCatalogInPlace();
    sendJson(response, 200, {
      ok: true,
      restaurants: getCatalogCount(),
      users: Object.keys(userProfiles).length,
      dataSource: "backend/data/catalog.json",
      llmConfigured: Boolean(process.env.HACKCLUB_API_KEY),
    });
    return;
  }

  if (request.method === "POST" && urlObject.pathname === "/api/catalog/import") {
    try {
      const body = await parseBody(request);
      if (!body.items) {
        sendJson(response, 400, {
          error: "Strict catalog mode enabled. Provide body.items to import, or edit backend/data/catalog.json directly.",
        });
        return;
      }

      const imported = importTaggedCatalogFromObject(body.items);
      importCatalogAndPersist(imported);
      sendJson(response, 200, { imported: imported.length, total: getCatalogCount() });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return;
  }

  if (request.method === "GET" && urlObject.pathname === "/api/feed") {
    normalizeCatalogInPlace();
    const userId = urlObject.searchParams.get("user_id") ?? "demo-user";
    const limit = Number(urlObject.searchParams.get("limit") ?? "10");
    const excludeIds = parseExcludeIds(urlObject);

    const userProfile = ensureProfile(userId);
    const recommendations = recommendNextBatch({
      userProfile,
      catalog: Array.isArray(catalog) ? catalog : [],
      limit: Number.isFinite(limit) ? Math.max(1, Math.min(limit, 30)) : 10,
      excludeIds,
    });

    persistUserProfiles();
    sendJson(response, 200, {
      items: recommendations.map(compactRestaurantForClient),
      profileSummary: summarizeTopTagPrefs(userProfile, 5),
    });
    return;
  }

  if (request.method === "GET" && urlObject.pathname.startsWith("/api/restaurants/")) {
    normalizeCatalogInPlace();
    const encodedId = urlObject.pathname.slice("/api/restaurants/".length);
    const restaurantId = decodeURIComponent(encodedId).trim();
    if (!restaurantId) {
      sendJson(response, 400, { error: "restaurant id is required" });
      return;
    }
    const restaurant = (Array.isArray(catalog) ? catalog : []).find((candidate) => candidate.id === restaurantId);
    if (!restaurant) {
      sendJson(response, 404, { error: "restaurant not found" });
      return;
    }
    sendJson(response, 200, { item: compactRestaurantForClient(restaurant) });
    return;
  }

  if (request.method === "POST" && urlObject.pathname === "/api/ratings") {
    try {
      const body = await parseBody(request);
      const userId = String(body.user_id ?? body.userId ?? "").trim();
      const restaurantId = String(body.restaurant_id ?? body.restaurantId ?? "").trim();
      const rating = Number(body.rating);

      if (!userId) {
        sendJson(response, 400, { error: "user_id is required" });
        return;
      }
      if (!restaurantId) {
        sendJson(response, 400, { error: "restaurant_id is required" });
        return;
      }
      if (!Number.isFinite(rating) || rating < 1 || rating > 10) {
        sendJson(response, 400, { error: "rating must be a number between 1 and 10" });
        return;
      }

      const restaurant = (Array.isArray(catalog) ? catalog : []).find((candidate) => candidate.id === restaurantId);
      if (!restaurant) {
        sendJson(response, 404, { error: "restaurant not found" });
        return;
      }

      const userProfile = ensureProfile(userId);
      applyRating({ userProfile, restaurant, rating });
      persistUserProfiles();
      const refreshedInsights = await maybeRefreshInsights(userProfile);

      sendJson(response, 200, {
        ok: true,
        totalRatings: userProfile.totalRatings,
        profileSummary: summarizeTopTagPrefs(userProfile, 5),
        insights: refreshedInsights ?? userProfile.insights ?? null,
      });
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return;
  }

  if (
    request.method === "POST" &&
    (urlObject.pathname === "/api/recommendations/llm-picks" || urlObject.pathname === "/api/llm-picks")
  ) {
    try {
      normalizeCatalogInPlace();
      const body = await parseBody(request);
      const userId = String(body.user_id ?? body.userId ?? "demo-user").trim() || "demo-user";
      const count = Number(body.count ?? 5);
      const excludeIds = Array.isArray(body.exclude_ids ?? body.excludeIds)
        ? (body.exclude_ids ?? body.excludeIds).map((id) => String(id).trim()).filter(Boolean)
        : [];

      const userProfile = ensureProfile(userId);
      const catalogItems = Array.isArray(catalog) ? catalog : [];
      const candidates = buildLlmPickCandidates({ userProfile, catalogItems, excludeIds });
      const result = await generateLlmPicks({
        userProfile,
        candidates,
        count: Number.isFinite(count) ? count : 5,
      });

      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, 400, { error: error.message });
    }
    return;
  }

  sendJson(response, 404, { error: "Not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`Voyago API running at http://${HOST}:${PORT}`);
});
