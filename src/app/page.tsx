"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import StopSearch from "@/components/StopSearch";
import JourneyCard from "@/components/JourneyCard";
import LocationButton from "@/components/LocationButton";
import type { StopDetail, RouteResult } from "@/lib/types";

const MapView = dynamic(() => import("@/components/Map"), { ssr: false });

const MOBILE_BREAKPOINT = 768;

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    setIsMobile(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);
  return isMobile;
}

export default function Home() {
  const [stops, setStops] = useState<StopDetail[]>([]);
  const [fromStop, setFromStop] = useState<StopDetail | null>(null);
  const [toStop, setToStop] = useState<StopDetail | null>(null);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  // Mobile: "search" = form panel, "map" = map panel
  const [mobileView, setMobileView] = useState<"search" | "map">("search");
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    fetch("/api/stops")
      .then((r) => r.json())
      .then((data) => setStops(data.stops || []))
      .catch(() => setError("Failed to load bus stops"));

    fetch("/api/data-status")
      .then((r) => r.json())
      .then((data) => setLastUpdated(data.lastUpdated ?? null))
      .catch(() => {});
  }, []);

  const handleFindRoute = useCallback(async () => {
    if (!fromStop || !toStop) return;
    setLoading(true);
    setError(null);
    setRoute(null);

    try {
      const res = await fetch("/api/routes/find", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromStopId: fromStop.id, toStopId: toStop.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Route finding failed");
        return;
      }
      setRoute(data.route);
      // On mobile, switch to map view to show the route
      setMobileView("map");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [fromStop, toStop]);

  const handleLocationFound = useCallback(
    (lat: number, lng: number) => {
      setUserLocation({ lat, lng });
      if (stops.length > 0) {
        let nearest = stops[0];
        let minDist = Infinity;
        for (const stop of stops) {
          const d = Math.sqrt(
            Math.pow(stop.latitude - lat, 2) + Math.pow(stop.longitude - lng, 2)
          );
          if (d < minDist) {
            minDist = d;
            nearest = stop;
          }
        }
        setFromStop(nearest);
      }
    },
    [stops]
  );

  const handleMapStopClick = useCallback(
    (stop: StopDetail) => {
      if (!fromStop) {
        setFromStop(stop);
      } else if (!toStop) {
        setToStop(stop);
      } else {
        setFromStop(stop);
        setToStop(null);
        setRoute(null);
      }
    },
    [fromStop, toStop]
  );

  const handleSwapStops = useCallback(() => {
    const temp = fromStop;
    setFromStop(toStop);
    setToStop(temp);
    setRoute(null);
  }, [fromStop, toStop]);

  return (
    <div className="app-layout">
      {/* Sidebar / Form panel */}
      <aside className={`sidebar${isMobile && mobileView !== "search" ? " hidden-view" : ""}`}>
        <div className="sidebar-header">
          <h1>Baku Bus Route Planner</h1>
          <p>Find the best bus routes across Baku</p>
          {lastUpdated && (
            <p className="data-freshness">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="2.5" style={{flexShrink: 0}}>
                <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
              </svg>
              Data updated {formatRelativeTime(lastUpdated)}
            </p>
          )}
        </div>

        <div className="sidebar-body">
          <div className="form-section">
            <LocationButton onLocationFound={handleLocationFound} />
          </div>

          <div className="form-section">
            <StopSearch
              label="From"
              placeholder="Search start stop..."
              stops={stops}
              selectedStop={fromStop}
              onSelect={setFromStop}
              dotColor="green"
            />
          </div>

          <div className="form-section" style={{ textAlign: "center" }}>
            <button className="swap-btn" onClick={handleSwapStops} title="Swap stops">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
              </svg>
            </button>
          </div>

          <div className="form-section">
            <StopSearch
              label="To"
              placeholder="Search destination stop..."
              stops={stops}
              selectedStop={toStop}
              onSelect={setToStop}
              dotColor="red"
            />
          </div>

          <div className="form-section">
            <button
              className="primary-btn"
              onClick={handleFindRoute}
              disabled={!fromStop || !toStop || loading}
            >
              {loading ? (
                <>
                  <span className="spinner" />
                  Finding best route...
                </>
              ) : (
                "Find Route"
              )}
            </button>
          </div>

          {error && <div className="error-msg">{error}</div>}

          {route && <JourneyCard route={route} />}
        </div>
      </aside>

      {/* Map panel */}
      <div className={`map-wrapper${isMobile && mobileView !== "map" ? " hidden-view" : ""}`}>
        <MapView
          stops={stops}
          fromStop={fromStop}
          toStop={toStop}
          route={route}
          userLocation={userLocation}
          onStopClick={handleMapStopClick}
          isVisible={!isMobile || mobileView === "map"}
        />
      </div>

      {/* Mobile bottom tab bar */}
      <nav className="mobile-tab-bar">
        <button
          className={mobileView === "search" ? "active" : ""}
          onClick={() => setMobileView("search")}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          Search
        </button>
        <button
          className={mobileView === "map" ? "active" : ""}
          onClick={() => setMobileView("map")}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z" />
            <path d="M8 2v16" />
            <path d="M16 6v16" />
          </svg>
          Map
        </button>
      </nav>
    </div>
  );
}
