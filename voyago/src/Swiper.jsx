import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { fetchFeed, fetchRestaurantById, getLlmPicks, submitRating } from "./recommendationApi";
import { getRoute } from "./routingapi";
import { getHQFromStorage, isWithinRoutingCoverage } from "./settingsStore";
import { decodePolyline6 } from "./polyline6";
import RouteMiniMap from "./RouteMinimap";
import "./swiper.css";



const USER_ID_STORAGE_KEY = "voyago_user_id";
const ANIMATION_SCROLLLOCK_MS = 420;
const PREFETCH_THRESHOLD = 3;
const PREFETCH_BATCH_SIZE = 10;
const GENERIC_FALLBACK_IMAGE_URL = "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&w=1200&q=80";
const ROUTE_MODES = [
  { value: "auto", label: "Driving" },
  { value: "pedestrian", label: "Walking" },
];



const cardVariants = {
  enter: (direction) => ({
    y: direction > 0 ? 90 : -90,
    opacity: 0,
    scale: 0.97,
  }),
  center: {
    y: 0,
    opacity: 1,
    scale: 1,
  },
  exit: (direction) => ({
    y: direction > 0 ? -90 : 90,
    opacity: 0,
    scale: 0.97,
  }),
};



function getImageFallback(restaurant) {
  if (restaurant.imageUrl) {
    return restaurant.imageUrl;
  }
  return GENERIC_FALLBACK_IMAGE_URL;
}

function createUserId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `user-${crypto.randomUUID()}`;
  }
  return `user-${Math.random().toString(36).slice(2, 12)}`;
}

function getOrCreateUserId() {
  if (typeof window === "undefined") {
    return "user-anon";
  }
  try {
    const existing = window.localStorage.getItem(USER_ID_STORAGE_KEY);
    if (existing && existing.trim()) {
      return existing;
    }
    const next = createUserId();
    window.localStorage.setItem(USER_ID_STORAGE_KEY, next);
    return next;
  } catch {
    return createUserId();
  }
}


function humanizeRouteError(message) {
  const raw = String(message ?? "");
  const normalized = raw.toLowerCase();
  if (normalized.includes("no suitable edges near location")) {
    return "Route unavailable from this HQ. Set HQ to a specific Vancouver street address.";
  }
  if (normalized.includes("outside the currently loaded routing tiles")) {
    return "HQ is outside the local routing map. Set HQ to a Vancouver address.";
  }
  return raw || "Failed to load route.";
}



function Swiper() {
  const [userId] = useState(() => getOrCreateUserId());
  const [cards, setCards] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [isBootLoading, setIsBootLoading] = useState(true);
  const [error, setError] = useState("");
  const [ratingByCardId, setRatingByCardId] = useState({});
  const [profileSummary, setProfileSummary] = useState(null);
  const [insights, setInsights] = useState(null);
  const [aiPicks, setAiPicks] = useState([]);
  const [aiPicksSource, setAiPicksSource] = useState("");
  const [isAiPicksLoading, setIsAiPicksLoading] = useState(false);
  const [aiPicksError, setAiPicksError] = useState("");
  const [hq, setHq] = useState(() => getHQFromStorage());
  const [routeMode, setRouteMode] = useState("auto");
  const [routeInfo, setRouteInfo] = useState({
    isLoading: false,
    error: "",
    etaMinutes: null,
    points: [],
  });

  const isAnimatingRef = useRef(false);
  const isFetchingRef = useRef(false);
  const cardsRef = useRef(cards);
  const currentIndexRef = useRef(currentIndex);

  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  useEffect(() => {
    const syncHq = () => setHq(getHQFromStorage());
    syncHq();
    window.addEventListener("storage", syncHq);
    window.addEventListener("focus", syncHq);
    return () => {
      window.removeEventListener("storage", syncHq);
      window.removeEventListener("focus", syncHq);
    };
  }, []);

  const currentPlace = cards[currentIndex];
  const totalCards = cards.length;

  const ratingButtons = useMemo(() => Array.from({ length: 10 }, (_, index) => index + 1), []);

  async function loadMoreCards(limit = PREFETCH_BATCH_SIZE) {
    if (isFetchingRef.current) {
      return;
    }
    isFetchingRef.current = true;
    try {
      const excludeIds = cardsRef.current.map((restaurant) => restaurant.id);
      const payload = await fetchFeed({
        userId,
        limit,
        excludeIds,
      });
      const incoming = payload.items ?? [];
      const knownIds = new Set(cardsRef.current.map((restaurant) => restaurant.id));
      const unique = incoming.filter((restaurant) => !knownIds.has(restaurant.id));
      if (unique.length > 0) {
        setCards((previous) => [...previous, ...unique]);
      }
      if (payload.profileSummary) {
        setProfileSummary(payload.profileSummary);
      }
      setError("");
    } catch (requestError) {
      setError(requestError.message || "Failed to fetch recommendations.");
    } finally {
      isFetchingRef.current = false;
      setIsBootLoading(false);
    }
  }

  useEffect(() => {
    void loadMoreCards(PREFETCH_BATCH_SIZE);
  }, [userId]);

  useEffect(() => {
    let cancelled = false;

    async function loadRoute() {
      if (!currentPlace) {
        setRouteInfo({
          isLoading: false,
          error: "",
          etaMinutes: null,
          points: [],
        });
        return;
      }

      if (!hq) {
        setRouteInfo({
          isLoading: false,
          error: "Set HQ in Settings to see route.",
          etaMinutes: null,
          points: [],
        });
        return;
      }
      if (!isWithinRoutingCoverage(hq.lat, hq.lon)) {
        setRouteInfo({
          isLoading: false,
          error: "HQ is outside routing coverage. Set HQ to a Vancouver address.",
          etaMinutes: null,
          points: [],
        });
        return;
      }

      const destinationLat = Number(currentPlace.lat);
      const destinationLon = Number(currentPlace.lon);
      if (!Number.isFinite(destinationLat) || !Number.isFinite(destinationLon)) {
        setRouteInfo({
          isLoading: false,
          error: "Restaurant coordinates are missing.",
          etaMinutes: null,
          points: [],
        });
        return;
      }

      setRouteInfo((previous) => ({
        ...previous,
        isLoading: true,
        error: "",
      }));

      try {
        const payload = await getRoute({
          locations: [
            { lat: hq.lat, lon: hq.lon },
            { lat: destinationLat, lon: destinationLon },
          ],
          costing: routeMode,
        });

        if (cancelled) {
          return;
        }

        const legShapes = (payload?.trip?.legs ?? []).map((leg) => leg?.shape).filter(Boolean);
        const mergedPoints = [];
        for (const shape of legShapes) {
          const decoded = decodePolyline6(shape);
          if (decoded.length === 0) {
            continue;
          }
          if (mergedPoints.length > 0) {
            const [lastLat, lastLon] = mergedPoints[mergedPoints.length - 1];
            const [firstLat, firstLon] = decoded[0];
            if (lastLat === firstLat && lastLon === firstLon) {
              mergedPoints.push(...decoded.slice(1));
              continue;
            }
          }
          mergedPoints.push(...decoded);
        }

        const etaSeconds = Number(payload?.trip?.summary?.time);
        const etaMinutes = Number.isFinite(etaSeconds) ? Math.max(1, Math.round(etaSeconds / 60)) : null;

        setRouteInfo({
          isLoading: false,
          error: mergedPoints.length > 0 ? "" : "Route geometry missing from response.",
          etaMinutes,
          points: mergedPoints,
        });
      } catch (routeError) {
        if (cancelled) {
          return;
        }
        setRouteInfo({
          isLoading: false,
          error: humanizeRouteError(routeError?.message),
          etaMinutes: null,
          points: [],
        });
      }
    }

    void loadRoute();
    return () => {
      cancelled = true;
    };
  }, [currentPlace, hq, routeMode]);

  async function maybePrefetch(nextIndex) {
    const remaining = cardsRef.current.length - nextIndex - 1;
    if (remaining <= PREFETCH_THRESHOLD) {
      await loadMoreCards(PREFETCH_BATCH_SIZE);
    }
  }

  async function moveCard(dir) {
    if (cardsRef.current.length === 0) {
      return;
    }
    if (isAnimatingRef.current) {
      return;
    }
    isAnimatingRef.current = true;
    setDirection(dir);

    if (dir > 0) {
      let nextIndex = currentIndexRef.current + 1;
      if (nextIndex >= cardsRef.current.length) {
        await loadMoreCards(6);
        nextIndex = currentIndexRef.current + 1;
      }
      if (nextIndex < cardsRef.current.length) {
        setCurrentIndex(nextIndex);
        currentIndexRef.current = nextIndex;
        await maybePrefetch(nextIndex);
      }
    } else if (dir < 0) {
      const nextIndex = Math.max(0, currentIndexRef.current - 1);
      setCurrentIndex(nextIndex);
      currentIndexRef.current = nextIndex;
    }

    setTimeout(() => {
      isAnimatingRef.current = false;
    }, ANIMATION_SCROLLLOCK_MS);
  }

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "ArrowDown") {
        void moveCard(1);
      }
      if (event.key === "ArrowUp") {
        void moveCard(-1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // This listener should only be registered once for the page session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleRating(rating) {
    if (!currentPlace) {
      return;
    }
    setRatingByCardId((previous) => ({ ...previous, [currentPlace.id]: rating }));
    try {
      const payload = await submitRating({
        userId,
        restaurantId: currentPlace.id,
        rating,
      });
      if (payload.profileSummary) {
        setProfileSummary(payload.profileSummary);
      }
      if (payload.insights) {
        setInsights(payload.insights);
      }
      setError("");
    } catch (requestError) {
      setError(requestError.message || "Failed to submit rating.");
    }
  }

  function jumpToRestaurant(restaurantId) {
    const nextIndex = cardsRef.current.findIndex((restaurant) => restaurant.id === restaurantId);
    if (nextIndex < 0) {
      return false;
    }
    if (nextIndex === currentIndexRef.current) {
      return true;
    }
    setDirection(nextIndex > currentIndexRef.current ? 1 : -1);
    setCurrentIndex(nextIndex);
    currentIndexRef.current = nextIndex;
    return true;
  }

  async function handleLoadAiPicks() {
    setIsAiPicksLoading(true);
    setAiPicksError("");
    try {
      const payload = await getLlmPicks({
        userId,
        count: 5,
      });
      setAiPicks(Array.isArray(payload?.picks) ? payload.picks : []);
      setAiPicksSource(String(payload?.source ?? ""));
    } catch (requestError) {
      setAiPicksError(requestError.message || "Failed to load AI picks.");
    } finally {
      setIsAiPicksLoading(false);
    }
  }

  async function handlePickClick(restaurantId) {
    const jumped = jumpToRestaurant(restaurantId);
    if (jumped) {
      setAiPicksError("");
      return;
    }

    try {
      const payload = await fetchRestaurantById({ restaurantId });
      const item = payload?.item;
      if (!item?.id) {
        setAiPicksError("Could not load this pick right now.");
        return;
      }

      const baseIndex = currentIndexRef.current;
      const insertIndex = Math.min(baseIndex + 1, cardsRef.current.length);
      setCards((previous) => {
        const next = [...previous];
        next.splice(insertIndex, 0, item);
        return next;
      });
      setDirection(1);
      setCurrentIndex(insertIndex);
      currentIndexRef.current = insertIndex;
      setAiPicksError("");
    } catch (requestError) {
      setAiPicksError(requestError.message || "Could not load this pick right now.");
    }
  }

  if (isBootLoading && !currentPlace) {
    return <section className="swiper-page">Loading recommendations...</section>;
  }

  if (!currentPlace) {
    return (
      <section className="swiper-page">
        <p>No restaurants available yet.</p>
        <button type="button" onClick={() => void loadMoreCards(10)}>
          Retry feed
        </button>
      </section>
    );
  }

  return (
    <section
      className={`swiper-page ${profileSummary ? "swiper-page-with-profile" : "swiper-page-no-profile"}`}
      onWheel={(event) => {
        if (Math.abs(event.deltaY) < 10) {
          return;
        }
        void moveCard(event.deltaY > 0 ? 1 : -1);
      }}
    >
      {/*<div className="swiper-meta">
        <span>
          Card {currentIndex + 1} / {Math.max(totalCards, 1)}
        </span>
        {error ? <span className="swiper-error">{error}</span> : null}
      </div>*/}

      <AnimatePresence mode="wait" custom={direction}>
        <motion.article
          className="swiper-card"
          key={currentPlace.id}
          initial="enter"
          animate="center"
          exit="exit"
          variants={cardVariants}
          custom={direction}
          transition={{ duration: 0.35 }}
        >
          <img
            src={getImageFallback(currentPlace)}
            alt={currentPlace.name}
            className="swiper-image"
            onError={(event) => {
              event.currentTarget.onerror = null;
              event.currentTarget.src = GENERIC_FALLBACK_IMAGE_URL;
            }}
          />
          <div className="swiper-content">
            <h1>{currentPlace.name}</h1>
            <p>{currentPlace.description || "No description available."}</p>
            <p>
              <strong>Genre:</strong> {currentPlace.genre || "Unknown"}
            </p>
            <p>
              <strong>Price:</strong> {currentPlace.priceRange || "Unknown"}
            </p>
            <p>
              <strong>Address:</strong> {currentPlace.address || "Unknown"}
            </p>
            <p>
              <strong>Hours:</strong> {currentPlace.hours || "Unknown"}
            </p>
            <p>
              <strong>Top tags:</strong> {(currentPlace.tags || []).slice(0, 8).join(", ") || "None"}
            </p>
            <section className="route-panel">
              <p>
                <strong>HQ:</strong>{" "}
                {hq ? hq.label || `${hq.lat.toFixed(5)}, ${hq.lon.toFixed(5)}` : "Not set"}
              </p>

              <div className="route-mode-toggle" role="group" aria-label="Route mode">
                {ROUTE_MODES.map((mode) => (
                  <button
                    key={mode.value}
                    type="button"
                    className={`route-mode-button ${routeMode === mode.value ? "route-mode-button-selected" : ""}`}
                    onClick={() => setRouteMode(mode.value)}
                    disabled={routeInfo.isLoading && routeMode === mode.value}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
              
              {routeInfo.isLoading ? <p>Loading route...</p> : null}
              {routeInfo.etaMinutes !== null ? (
                <p>
                  <strong>Estimated time ({routeMode === "auto" ? "driving" : "walking"}):</strong>{" "}
                  {routeInfo.etaMinutes} min
                </p>
              ) : null}
              {routeInfo.error ? <p className="route-error">{routeInfo.error}</p> : null}
              <RouteMiniMap points={routeInfo.points} />
            </section>
          </div>
        </motion.article>
      </AnimatePresence>

      <section className="rating-panel">
        <p>Rate this restaurant (1-10)</p>
        <div className="rating-grid">
          {ratingButtons.map((rating) => {
            const selected = ratingByCardId[currentPlace.id] === rating;
            return (
              <button
                key={rating}
                type="button"
                className={`rating-button ${selected ? "rating-button-selected" : ""}`}
                onClick={() => void handleRating(rating)}
              >
                {rating}
              </button>
            );
          })}
        </div>
      </section>

      {profileSummary ? (
        <section className="profile-panel">
          <div className="profile-header">
            <h2>Learned Preferences</h2>
            <button
              type="button"
              className="ai-picks-button"
              onClick={() => void handleLoadAiPicks()}
              disabled={isAiPicksLoading}
            >
              {isAiPicksLoading ? "Loading..." : "AI Picks"}
            </button>
          </div>
          <p>
            <strong>Liked:</strong>{" "}
            {profileSummary.liked?.map((entry) => entry.tag).join(", ") || "Not enough data yet"}
          </p>
          <p>
            <strong>Disliked:</strong>{" "}
            {profileSummary.disliked?.map((entry) => entry.tag).join(", ") || "Not enough data yet"}
          </p>
          {insights?.profile_summary ? (
            <p>
              <strong>Agent insight:</strong> {insights.profile_summary}
            </p>
          ) : null}
          {aiPicksError ? <p className="ai-picks-error">{aiPicksError}</p> : null}
          {aiPicks.length > 0 ? (
            <section className="ai-picks-panel">
              <p>
                <strong>AI picks{aiPicksSource === "heuristic" ? " (quick mode)" : ""}:</strong>
              </p>
              <ul className="ai-picks-list">
                {aiPicks.map((pick) => (
                  <li key={pick.id}>
                    <button type="button" className="ai-pick-jump" onClick={() => void handlePickClick(pick.id)}>
                      {pick.name}
                    </button>
                    <span className="ai-pick-reason"> - {pick.reason}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}

export default Swiper;
