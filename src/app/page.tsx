"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import StopSearch from "@/components/StopSearch";
import JourneyCard from "@/components/JourneyCard";
import LocationButton from "@/components/LocationButton";
import type { StopDetail, RouteResult } from "@/lib/types";
import { haversine } from "@/lib/geo";

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
  const routeRequest = useRef<AbortController | null>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/stops", { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load bus stops");
        return r.json();
      })
      .then((data) => {
        if (!controller.signal.aborted) setStops(data.stops || []);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("Failed to load bus stops");
      });

    fetch("/api/data-status", { signal: controller.signal })
      .then((r) => r.ok ? r.json() : { lastUpdated: null })
      .then((data) => {
        if (!controller.signal.aborted) setLastUpdated(data.lastUpdated ?? null);
      })
      .catch(() => {});

    return () => {
      controller.abort();
      routeRequest.current?.abort();
      routeRequest.current = null;
    };
  }, []);

  const invalidateRoute = useCallback(() => {
    routeRequest.current?.abort();
    routeRequest.current = null;
    setRoute(null);
    setError(null);
    setLoading(false);
  }, []);

  const handleFromSelect = useCallback((stop: StopDetail | null) => {
    invalidateRoute();
    setFromStop(stop);
  }, [invalidateRoute]);

  const handleToSelect = useCallback((stop: StopDetail | null) => {
    invalidateRoute();
    setToStop(stop);
  }, [invalidateRoute]);

  const handleFindRoute = useCallback(async () => {
    if (!fromStop || !toStop) return;
    invalidateRoute();
    const controller = new AbortController();
    routeRequest.current = controller;
    setLoading(true);

    try {
      const res = await fetch("/api/routes/find", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromStopId: fromStop.id, toStopId: toStop.id }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (routeRequest.current !== controller) return;
      if (!res.ok) {
        setError(data.error || "Route finding failed");
        return;
      }
      setRoute(data.route);
      // On mobile, switch to map view to show the route
      setMobileView("map");
    } catch {
      if (routeRequest.current === controller) setError("Network error. Please try again.");
    } finally {
      if (routeRequest.current === controller) {
        routeRequest.current = null;
        setLoading(false);
      }
    }
  }, [fromStop, toStop, invalidateRoute]);

  const handleLocationFound = useCallback(
    (lat: number, lng: number) => {
      setUserLocation({ lat, lng });
      if (stops.length > 0) {
        let nearest = stops[0];
        let minDist = Infinity;
        for (const stop of stops) {
          // Use great-circle distance so the result is correct at any latitude.
          // Plain Euclidean lat/lng skews badly far from the equator.
          const d = haversine(lat, lng, stop.latitude, stop.longitude);
          if (d < minDist) {
            minDist = d;
            nearest = stop;
          }
        }
        handleFromSelect(nearest);
      }
    },
    [stops, handleFromSelect]
  );

  const handleMapStopClick = useCallback(
    (stop: StopDetail) => {
      invalidateRoute();
      if (!fromStop) {
        setFromStop(stop);
      } else if (!toStop) {
        setToStop(stop);
      } else {
        setFromStop(stop);
        setToStop(null);
      }
    },
    [fromStop, toStop, invalidateRoute]
  );

  const handleSwapStops = useCallback(() => {
    invalidateRoute();
    const temp = fromStop;
    setFromStop(toStop);
    setToStop(temp);
  }, [fromStop, toStop, invalidateRoute]);

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
            <LocationButton onLocationFound={handleLocationFound} disabled={stops.length === 0} />
          </div>

          <div className="form-section">
            <StopSearch
              label="From"
              placeholder="Search start stop..."
              stops={stops}
              selectedStop={fromStop}
              onSelect={handleFromSelect}
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
              onSelect={handleToSelect}
              dotColor="red"
            />
          </div>

          <div className="form-section">
            <button
              className="primary-btn"
              onClick={handleFindRoute}
              disabled={!fromStop || !toStop || fromStop.id === toStop.id || loading}
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
