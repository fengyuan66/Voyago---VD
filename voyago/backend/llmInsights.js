import { summarizeTopTagPrefs } from "./recommender.js";

const HACKCLUB_BASE_URL = process.env.HACKCLUB_BASE_URL ?? "https://ai.hackclub.com/proxy/v1";
const HACKCLUB_MODEL = process.env.HACKCLUB_MODEL ?? "gpt-4o-mini";

function canRunInsights(userProfile) {
  const ratingsCount = userProfile.totalRatings ?? 0;
  if (ratingsCount < 6) {
    return false;
  }
  if (ratingsCount % 5 !== 0) {
    return false;
  }
  return true;
}

function buildPrompt(userProfile) {
  const recent = (userProfile.ratings ?? []).slice(-20);
  const topPrefs = summarizeTopTagPrefs(userProfile, 6);
  return [
    "You are a restaurant preference analyst.",
    "Given rating signals over tags, infer likely user taste and exploration ideas.",
    "Return strict JSON with this shape:",
    '{"profile_summary":"...", "hypotheses":["..."], "exploration_tags":["tag_a","tag_b","tag_c"], "confidence":"low|medium|high"}',
    "",
    `Top liked tags: ${JSON.stringify(topPrefs.liked)}`,
    `Top disliked tags: ${JSON.stringify(topPrefs.disliked)}`,
    `Recent ratings: ${JSON.stringify(recent)}`,
  ].join("\n");
}

function sanitizeReason(reason) {
  const normalized = String(reason ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return "Matches your recent taste profile.";
  }
  return normalized.slice(0, 140);
}

function buildPickPrompt({ userProfile, candidates, count }) {
  const recent = (userProfile.ratings ?? []).slice(-30);
  const topPrefs = summarizeTopTagPrefs(userProfile, 8);
  const candidateList = candidates.slice(0, 80).map((restaurant) => ({
    id: restaurant.id,
    name: restaurant.name,
    genre: restaurant.genre,
    priceRange: restaurant.priceRange,
    tags: (restaurant.tags ?? []).slice(0, 10),
    description: String(restaurant.description ?? "").slice(0, 180),
  }));

  return [
    "You are a restaurant recommender.",
    `Pick exactly ${count} restaurants from candidate list for this user.`,
    "Use only provided candidate IDs.",
    'Return strict JSON only: {"picks":[{"id":"restaurant_id","reason":"one short sentence"}]}',
    "Keep each reason under 20 words.",
    "",
    `Top liked tags: ${JSON.stringify(topPrefs.liked)}`,
    `Top disliked tags: ${JSON.stringify(topPrefs.disliked)}`,
    `Recent ratings: ${JSON.stringify(recent)}`,
    `Candidates: ${JSON.stringify(candidateList)}`,
  ].join("\n");
}

function uniqueById(list) {
  const seen = new Set();
  const unique = [];
  for (const entry of list) {
    const id = String(entry?.id ?? "").trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    unique.push(entry);
  }
  return unique;
}

function scoreCandidateWithTags(restaurant, likedTags, dislikedTags) {
  const tags = new Set((restaurant.tags ?? []).map((tag) => String(tag)));
  let likedMatches = 0;
  let dislikedMatches = 0;
  for (const liked of likedTags) {
    if (tags.has(liked)) {
      likedMatches += 1;
    }
  }
  for (const disliked of dislikedTags) {
    if (tags.has(disliked)) {
      dislikedMatches += 1;
    }
  }
  return { likedMatches, dislikedMatches, score: likedMatches * 2 - dislikedMatches };
}

function heuristicPickList({ userProfile, candidates, count }) {
  const summary = summarizeTopTagPrefs(userProfile, 8);
  const likedTags = new Set((summary.liked ?? []).map((entry) => entry.tag));
  const dislikedTags = new Set((summary.disliked ?? []).map((entry) => entry.tag));

  const ranked = candidates
    .map((restaurant) => {
      const metrics = scoreCandidateWithTags(restaurant, likedTags, dislikedTags);
      return { restaurant, ...metrics };
    })
    .sort((a, b) => b.score - a.score || b.likedMatches - a.likedMatches);

  return ranked.slice(0, count).map((entry) => ({
    id: entry.restaurant.id,
    name: entry.restaurant.name,
    reason:
      entry.likedMatches > 0
        ? `Strong match on ${entry.likedMatches} preferred tag${entry.likedMatches > 1 ? "s" : ""}.`
        : "Exploration pick based on your recent ratings.",
  }));
}

function normalizePickPayload(rawPicks, candidatesById, count) {
  const normalized = uniqueById(rawPicks)
    .map((pick) => {
      const id = String(pick?.id ?? "").trim();
      const restaurant = candidatesById.get(id);
      if (!restaurant) {
        return null;
      }
      return {
        id: restaurant.id,
        name: restaurant.name,
        reason: sanitizeReason(pick?.reason),
      };
    })
    .filter(Boolean);
  return normalized.slice(0, count);
}

export async function generateLlmPicks({ userProfile, candidates, count = 5 }) {
  const safeCount = Number.isFinite(count) ? Math.max(1, Math.min(Math.floor(count), 8)) : 5;
  const safeCandidates = Array.isArray(candidates) ? candidates.slice(0, 120) : [];
  const candidatesById = new Map(safeCandidates.map((restaurant) => [restaurant.id, restaurant]));

  if (safeCandidates.length === 0) {
    return { source: "none", picks: [] };
  }

  const fallback = heuristicPickList({ userProfile, candidates: safeCandidates, count: safeCount });
  const apiKey = process.env.HACKCLUB_API_KEY;
  if (!apiKey) {
    return { source: "heuristic", picks: fallback };
  }

  try {
    const response = await fetch(`${HACKCLUB_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: HACKCLUB_MODEL,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You are precise and concise." },
          { role: "user", content: buildPickPrompt({ userProfile, candidates: safeCandidates, count: safeCount }) },
        ],
      }),
    });

    if (!response.ok) {
      return { source: "heuristic", picks: fallback };
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (!content) {
      return { source: "heuristic", picks: fallback };
    }

    const parsed = JSON.parse(content);
    const llmPicks = normalizePickPayload(parsed?.picks ?? [], candidatesById, safeCount);
    if (llmPicks.length === 0) {
      return { source: "heuristic", picks: fallback };
    }
    return { source: "llm", picks: llmPicks };
  } catch {
    return { source: "heuristic", picks: fallback };
  }
}

export async function maybeGenerateInsights(userProfile) {
  const apiKey = process.env.HACKCLUB_API_KEY;
  if (!apiKey || !canRunInsights(userProfile)) {
    return null;
  }

  const response = await fetch(`${HACKCLUB_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: HACKCLUB_MODEL,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You are precise and conservative with inferences." },
        { role: "user", content: buildPrompt(userProfile) },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Hack Club API returned status ${response.status}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) {
    return null;
  }

  const parsed = JSON.parse(content);
  return {
    ...parsed,
    generatedAt: new Date().toISOString(),
  };
}
