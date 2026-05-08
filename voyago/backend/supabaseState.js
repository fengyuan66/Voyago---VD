const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const SUPABASE_STATE_TABLE = (process.env.SUPABASE_STATE_TABLE || "voyago_state").trim();

export function hasSupabaseConfig() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

function createHeaders(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra,
  };
}

export async function loadUserProfilesFromSupabase() {
  if (!hasSupabaseConfig()) {
    return null;
  }

  const url = `${SUPABASE_URL}/rest/v1/${SUPABASE_STATE_TABLE}?key=eq.user_profiles&select=value&limit=1`;
  const response = await fetch(url, {
    method: "GET",
    headers: createHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Supabase load failed (${response.status})`);
  }

  const rows = await response.json();
  const value = rows?.[0]?.value;
  return value && typeof value === "object" ? value : null;
}

export async function saveUserProfilesToSupabase(profiles) {
  if (!hasSupabaseConfig()) {
    return;
  }

  const url = `${SUPABASE_URL}/rest/v1/${SUPABASE_STATE_TABLE}?on_conflict=key`;
  const payload = [{ key: "user_profiles", value: profiles }];
  const response = await fetch(url, {
    method: "POST",
    headers: createHeaders({
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    }),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Supabase save failed (${response.status})`);
  }
}
