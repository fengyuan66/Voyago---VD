// Valhalla caller
const TRANSITER_API_ROOT = (import.meta.env.VITE_TRANSITER_API_URL || "/transiter-api").replace(/\/+$/, "");

export async function getRoute(data) {
  const res = await fetch(`${TRANSITER_API_ROOT}/route`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  const payload = await res.json();
  if (!res.ok) {
    throw new Error(payload?.detail || "Routing request failed");
  }
  return payload;
}
