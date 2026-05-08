import fs from "node:fs";
import path from "node:path";

const GENRE_TO_TAG = {
  japanese: "japanese",
  sushi: "sushi",
  korean: "korean",
  chinese: "chinese",
  thai: "thai",
  vietnamese: "vietnamese",
  indian: "indian",
  italian: "italian",
  french: "french",
  mediterranean: "mediterranean",
  mexican: "mexican",
  seafood: "seafood",
};

const GENERIC_GENRE_TOKENS = new Set(["restaurant", "restaurants", "dining", "food"]);

const TEXT_TO_TAG = [
  { match: "brunch", tag: "brunch_spot" },
  { match: "breakfast", tag: "breakfast_spot" },
  { match: "lunch", tag: "lunch_spot" },
  { match: "dinner", tag: "dinner_spot" },
  { match: "bar", tag: "full_bar" },
  { match: "cocktail", tag: "cocktails" },
  { match: "wine", tag: "wine_bar" },
  { match: "patio", tag: "patio" },
  { match: "waterfront", tag: "waterfront" },
  { match: "vegan", tag: "vegan" },
  { match: "vegetarian", tag: "vegetarian" },
  { match: "sushi", tag: "sushi" },
  { match: "pizza", tag: "pizza" },
  { match: "pasta", tag: "pasta" },
  { match: "ramen", tag: "ramen" },
  { match: "pho", tag: "pho" },
  { match: "takeout", tag: "takeout" },
  { match: "delivery", tag: "delivery" },
];

function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function splitGenreTokens(genre) {
  return String(genre ?? "")
    .toLowerCase()
    .replace(/[&/]/g, ",")
    .replace(/\band\b/g, ",")
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !GENERIC_GENRE_TOKENS.has(token));
}

function getCuisineTagsFromGenre(genre) {
  const tokens = splitGenreTokens(genre);
  const tags = [];
  for (const token of tokens) {
    if (GENRE_TO_TAG[token]) {
      tags.push(GENRE_TO_TAG[token]);
      continue;
    }
    for (const [genreToken, tag] of Object.entries(GENRE_TO_TAG)) {
      if (token.includes(genreToken)) {
        tags.push(tag);
      }
    }
  }
  return [...new Set(tags)];
}

function ensureArrayStrings(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function parseRawAnswer(rawAnswer) {
  if (typeof rawAnswer !== "string" || rawAnswer.trim() === "") {
    return {};
  }
  try {
    const parsed = JSON.parse(rawAnswer);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function sanitizeTag(tag) {
  return String(tag ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function inferPriceTags(priceRange) {
  const price = String(priceRange ?? "").toLowerCase();
  if (!price) {
    return [];
  }
  if (price.includes("$$$") || price.includes("50") || price.includes("fine")) {
    return ["expensive", "fine_dining"];
  }
  if (price.includes("$$")) {
    return ["moderate_price"];
  }
  if (price.includes("$")) {
    return ["budget_friendly"];
  }
  if (price.includes("under") || price.includes("cheap")) {
    return ["cheap_eats"];
  }
  return [];
}

function inferTagsFromText(textBlob) {
  const text = String(textBlob ?? "").toLowerCase();
  if (!text) {
    return [];
  }
  return TEXT_TO_TAG.filter((entry) => text.includes(entry.match)).map((entry) => entry.tag);
}

function dedupeNonEmptyTags(tags) {
  return [...new Set(tags.map(sanitizeTag).filter(Boolean))];
}

function parseNumberOrNull(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return numeric;
}

function chooseBestDetails(rawItem) {
  const fromResult = rawItem?.result && typeof rawItem.result === "object" ? rawItem.result : {};
  const fromRawAnswer = parseRawAnswer(rawItem?.raw_answer);
  return {
    ...fromRawAnswer,
    ...fromResult,
  };
}

function normalizeStatus(rawStatus) {
  const status = String(rawStatus ?? "").toLowerCase().trim();
  if (!status) {
    return "unknown";
  }
  return status;
}

function normalizeTaggedItem(rawItem) {
  const details = chooseBestDetails(rawItem ?? {});
  const name = rawItem?.restaurant_name ?? rawItem?.name ?? details?.name ?? "";
  const address = details?.address ?? rawItem?.address ?? "";
  const locationTag = rawItem?.location_tag ?? rawItem?.locationTag ?? rawItem?.location ?? "";
  const lat =
    parseNumberOrNull(details?.lat) ??
    parseNumberOrNull(details?.latitude) ??
    parseNumberOrNull(rawItem?.lat) ??
    parseNumberOrNull(rawItem?.latitude);
  const lon =
    parseNumberOrNull(details?.lon) ??
    parseNumberOrNull(details?.lng) ??
    parseNumberOrNull(details?.longitude) ??
    parseNumberOrNull(rawItem?.lon) ??
    parseNumberOrNull(rawItem?.lng) ??
    parseNumberOrNull(rawItem?.longitude);
  const placeUrl = details?.place_url ?? details?.placeUrl ?? rawItem?.place_url ?? rawItem?.placeUrl ?? "";
  const seed = `${name}-${locationTag || address}`;
  const genre = details?.genre ?? rawItem?.genre ?? "";
  const description = details?.description ?? rawItem?.description ?? "";
  const menu = ensureArrayStrings(details?.menu ?? rawItem?.menu);
  const hours = details?.hours ?? rawItem?.hours ?? "";
  const website = details?.website ?? rawItem?.website ?? "";
  const priceRange = details?.price_range ?? rawItem?.price_range ?? rawItem?.priceRange ?? "";
  const llmTags = ensureArrayStrings(rawItem?.llm_tags ?? rawItem?.tags);
  const cuisineFromGenre = getCuisineTagsFromGenre(genre);
  const inferredFromPrice = inferPriceTags(priceRange);
  const inferredFromText = inferTagsFromText([name, genre, description, menu.join(" "), hours, website].join(" | "));
  const tags = dedupeNonEmptyTags([...llmTags, ...cuisineFromGenre, ...inferredFromPrice, ...inferredFromText]);
  if (tags.length === 0) {
    tags.push("casual", "dinner_spot");
  }

  const generatedId = rawItem?.id ?? slugify(seed) ?? slugify(name);
  return {
    id: generatedId || `restaurant-${Math.random().toString(36).slice(2, 8)}`,
    sourceStatus: normalizeStatus(rawItem?.status),
    name: String(name).trim(),
    description: String(description ?? "").trim(),
    imageUrl: details?.image_url ?? rawItem?.image_url ?? rawItem?.imageUrl ?? "",
    address: String(address ?? "").trim(),
    locationTag: String(locationTag ?? "").trim(),
    lat,
    lon,
    placeUrl: String(placeUrl ?? "").trim(),
    priceRange: String(priceRange ?? "").trim(),
    menu,
    genre: String(genre ?? "").trim(),
    website: String(website ?? "").trim(),
    hours: String(hours ?? "").trim(),
    tags,
  };
}

function isUsableRestaurant(restaurant) {
  if (!restaurant.name) {
    return false;
  }
  if (!restaurant.description && !restaurant.address && restaurant.tags.length === 0) {
    return false;
  }
  return true;
}

function toPayloadList(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload && Array.isArray(payload.results)) {
    return payload.results;
  }
  throw new Error("Input must be a list or an object containing results[]");
}

export function importTaggedCatalogFromObject(payload) {
  const items = toPayloadList(payload);
  return items.map(normalizeTaggedItem).filter(isUsableRestaurant);
}

export function importTaggedCatalogFromFile(filePath) {
  const absolutePath = path.resolve(filePath);
  const raw = fs.readFileSync(absolutePath, "utf-8");
  const payload = JSON.parse(raw);
  return importTaggedCatalogFromObject(payload);
}
