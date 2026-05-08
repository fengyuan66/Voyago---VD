import { useState } from "react";
import {
  getHQFromStorage,
  getRoutingCoverageBounds,
  isWithinRoutingCoverage,
  saveHQToStorage,
} from "./settingsStore";

const ROUTING_HINT_SUFFIX = ", Vancouver, BC, Canada";

export default function SettingsPage() {
  const savedHQ = getHQFromStorage();
  const routingBounds = getRoutingCoverageBounds();

  const [label, setLabel] = useState(savedHQ?.label || "");
  const [address, setAddress] = useState("");
  const [lat, setLat] = useState(savedHQ?.lat ?? null);
  const [lon, setLon] = useState(savedHQ?.lon ?? null);
  const [message, setMessage] = useState("");

  async function geocode(inputAddress) {
    const searchQuery = inputAddress.includes(",")
      ? inputAddress
      : `${inputAddress}${ROUTING_HINT_SUFFIX}`;

    const params = new URLSearchParams({
      format: "jsonv2",
      limit: "1",
      countrycodes: "ca",
      bounded: "1",
      viewbox: `${routingBounds.minLon},${routingBounds.maxLat},${routingBounds.maxLon},${routingBounds.minLat}`,
      q: searchQuery,
    });

    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`);
    const data = await res.json();
    if (!data.length) {
      throw new Error("Address not found in Vancouver area.");
    }

    return {
      lat: Number(data[0].lat),
      lon: Number(data[0].lon),
    };
  }

  async function handleSave(event) {
    event.preventDefault();

    try {
      if (!address.trim()) {
        throw new Error("Enter an HQ address.");
      }

      const coords = await geocode(address);
      if (!isWithinRoutingCoverage(coords.lat, coords.lon)) {
        throw new Error("HQ must be inside the local Vancouver routing area.");
      }

      const hq = {
        label: label.trim(),
        lat: coords.lat,
        lon: coords.lon,
      };

      saveHQToStorage(hq);
      setLat(coords.lat);
      setLon(coords.lon);
      setMessage("Saved.");
    } catch (error) {
      setMessage(error.message || "Failed to save HQ.");
    }
  }

  const hasLocation = lat !== null && lon !== null;

  return (
    <section style={{ padding: "6rem 1rem 2rem" }}>
      <h1>Settings</h1>

      <form onSubmit={handleSave}>
        <div>
          <label>HQ name</label>
          <br />
          <input value={label} onChange={(event) => setLabel(event.target.value)} />
        </div>

        <div>
          <label>Address</label>
          <br />
          <input value={address} onChange={(event) => setAddress(event.target.value)} />
        </div>

        <button type="submit">Save</button>
      </form>

      <p>{message}</p>

      {hasLocation ? (
        <p>
          Saved location: {lat}, {lon}
        </p>
      ) : null}
    </section>
  );
}
