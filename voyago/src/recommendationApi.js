const API_ROOT = (import.meta.env.VITE_VOYAGO_API_URL || "/api").replace(/\/+$/, "");

function createQuery(params) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    query.set(key, String(value));
  }
  return query.toString();
}

async function parseJson(response) {
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error ?? "Request failed");
  }
  return payload;
}

export async function fetchFeed({ userId, limit = 10, excludeIds = [] }) {
  const query = createQuery({
    user_id: userId,
    limit,
    exclude_ids: excludeIds.join(","),
  });
  const response = await fetch(`${API_ROOT}/feed?${query}`);
  return parseJson(response);
}

export async function submitRating({ userId, restaurantId, rating }) {
  const response = await fetch(`${API_ROOT}/ratings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      user_id: userId,
      restaurant_id: restaurantId,
      rating,
    }),
  });
  return parseJson(response);
}

export async function getLlmPicks({ userId, count = 5, excludeIds = [] }) {
  const body = JSON.stringify({
    user_id: userId,
    count,
    exclude_ids: excludeIds,
  });
  const paths = [`${API_ROOT}/recommendations/llm-picks`, `${API_ROOT}/llm-picks`];

  let lastError = null;
  for (const path of paths) {
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body,
      });
      if (response.status === 404) {
        lastError = new Error("Not found");
        continue;
      }
      return await parseJson(response);
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    lastError?.message === "Not found"
      ? "AI Picks endpoint not available yet. Restart the backend API (`npm run api`)."
      : lastError?.message || "Failed to load AI picks.",
  );
}

export async function fetchRestaurantById({ restaurantId }) {
  const response = await fetch(`${API_ROOT}/restaurants/${encodeURIComponent(restaurantId)}`);
  return parseJson(response);
}
