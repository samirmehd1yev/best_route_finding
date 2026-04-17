"use client";

import { useEffect, useRef, useMemo } from "react";
import L from "leaflet";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  CircleMarker,
  useMap,
} from "react-leaflet";
import type { StopDetail, RouteResult } from "@/lib/types";
import { WALKING_EDGE_BUS_ID } from "@/lib/types";

const BAKU_CENTER: [number, number] = [40.4093, 49.8671];
const DEFAULT_ZOOM = 12;

// Distinct colors for each bus segment — NOT blue (avoids confusion with stop dots)
const SEGMENT_COLORS = ["#e11d48", "#7c3aed", "#059669", "#ea580c"];

const StartIcon = L.divIcon({
  className: "map-marker-start",
  iconSize: [28, 28],
  iconAnchor: [14, 14],
  html: '<div class="marker-inner start-marker"></div>',
});

const EndIcon = L.divIcon({
  className: "map-marker-end",
  iconSize: [28, 28],
  iconAnchor: [14, 14],
  html: '<div class="marker-inner end-marker"></div>',
});

const TransferIcon = L.divIcon({
  className: "map-marker-transfer",
  iconSize: [24, 24],
  iconAnchor: [12, 12],
  html: '<div class="marker-inner transfer-marker"></div>',
});

interface MapViewProps {
  stops: StopDetail[];
  fromStop: StopDetail | null;
  toStop: StopDetail | null;
  route: RouteResult | null;
  userLocation: { lat: number; lng: number } | null;
  onStopClick: (stop: StopDetail) => void;
  isVisible?: boolean;
}

function InvalidateSize({ isVisible }: { isVisible?: boolean }) {
  const map = useMap();

  useEffect(() => {
    if (isVisible) {
      // Small delay to let the container finish its display transition
      const timer = setTimeout(() => {
        map.invalidateSize();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [map, isVisible]);

  return null;
}

function FitBounds({
  fromStop,
  toStop,
  route,
}: {
  fromStop: StopDetail | null;
  toStop: StopDetail | null;
  route: RouteResult | null;
}) {
  const map = useMap();

  useEffect(() => {
    if (route) {
      const allCoords: [number, number][] = [];
      for (const seg of route.segments) {
        for (const stop of seg.stops) {
          allCoords.push([stop.latitude, stop.longitude]);
        }
      }
      if (allCoords.length > 0) {
        const bounds = L.latLngBounds(allCoords);
        map.fitBounds(bounds, { padding: [60, 60] });
      }
    } else if (fromStop && toStop) {
      const bounds = L.latLngBounds([
        [fromStop.latitude, fromStop.longitude],
        [toStop.latitude, toStop.longitude],
      ]);
      map.fitBounds(bounds, { padding: [60, 60] });
    } else if (fromStop) {
      map.setView([fromStop.latitude, fromStop.longitude], 15);
    }
  }, [map, fromStop, toStop, route]);

  return null;
}

export default function MapView({
  stops,
  fromStop,
  toStop,
  route,
  userLocation,
  onStopClick,
  isVisible,
}: MapViewProps) {
  const mapRef = useRef<L.Map | null>(null);

  // Build per-segment polylines with distinct colors
  const segmentPolylines = useMemo(() => {
    if (!route) return [];
    let busColorIdx = 0;
    return route.segments.map((seg) => {
      const isWalking = seg.busId === WALKING_EDGE_BUS_ID;
      const coords: [number, number][] = seg.stops.map((s) => [s.latitude, s.longitude]);
      const color = isWalking ? "#64748b" : SEGMENT_COLORS[busColorIdx % SEGMENT_COLORS.length];
      if (!isWalking) busColorIdx++;
      return {
        coords,
        color,
        busNumber: seg.busNumber,
        isWalking,
      };
    });
  }, [route]);

  // Transfer points: where user changes buses (skip walking segments)
  const transferPoints = useMemo(() => {
    if (!route || route.segments.length <= 1) return [];
    const points: Array<{ lat: number; lng: number; fromBus: string; toBus: string; stopName: string; colorIdx: number }> = [];
    const busSegs = route.segments.filter((s) => s.busId !== WALKING_EDGE_BUS_ID);
    for (let i = 0; i < busSegs.length - 1; i++) {
      const lastStop = busSegs[i].stops[busSegs[i].stops.length - 1];
      points.push({
        lat: lastStop.latitude,
        lng: lastStop.longitude,
        fromBus: busSegs[i].busNumber,
        toBus: busSegs[i + 1].busNumber,
        stopName: lastStop.name,
        colorIdx: i,
      });
    }
    return points;
  }, [route]);

  // Stop IDs on the route (for highlighting)
  const routeStopIds = useMemo(() => {
    const ids = new Set<number>();
    if (route) {
      for (const seg of route.segments) {
        for (const stop of seg.stops) {
          ids.add(stop.id);
        }
      }
    }
    return ids;
  }, [route]);

  return (
    <MapContainer
      center={BAKU_CENTER}
      zoom={DEFAULT_ZOOM}
      className="w-full h-full"
      ref={mapRef}
      zoomControl={true}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <InvalidateSize isVisible={isVisible} />
      <FitBounds fromStop={fromStop} toStop={toStop} route={route} />

      {/* All bus stops — larger, more visible */}
      {stops.map((stop) => {
        const isFrom = fromStop?.id === stop.id;
        const isTo = toStop?.id === stop.id;
        if (isFrom || isTo) return null;

        const isOnRoute = routeStopIds.has(stop.id);

        return (
          <CircleMarker
            key={stop.id}
            center={[stop.latitude, stop.longitude]}
            radius={isOnRoute ? 8 : stop.is_transport_hub ? 7 : 5}
            pathOptions={{
              color: "white",
              fillColor: isOnRoute ? "#0f172a" : stop.is_transport_hub ? "#f59e0b" : "#64748b",
              fillOpacity: isOnRoute ? 1 : 0.7,
              weight: isOnRoute ? 2.5 : 1.5,
            }}
            eventHandlers={{ click: () => onStopClick(stop) }}
          >
            <Popup className="stop-popup">
              <div>
                <strong style={{ fontSize: 14 }}>{stop.name}</strong>
                <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                  Code: {stop.code}
                </div>
                {stop.is_transport_hub && (
                  <div style={{ fontSize: 12, color: "#f59e0b", marginTop: 2, fontWeight: 600 }}>
                    Transport Hub
                  </div>
                )}
                <button
                  onClick={() => onStopClick(stop)}
                  style={{
                    marginTop: 8,
                    fontSize: 12,
                    background: "#2563eb",
                    color: "white",
                    padding: "6px 14px",
                    borderRadius: 8,
                    border: "none",
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  Select Stop
                </button>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}

      {/* Route polylines — each segment a different bold color, walking = dashed */}
      {segmentPolylines.map((seg, idx) => (
        <Polyline
          key={idx}
          positions={seg.coords}
          pathOptions={{
            color: seg.color,
            weight: seg.isWalking ? 5 : 7,
            opacity: seg.isWalking ? 0.7 : 0.9,
            lineCap: "round",
            lineJoin: "round",
            dashArray: seg.isWalking ? "8, 12" : undefined,
          }}
        />
      ))}

      {/* Transfer point markers — large, distinctive */}
      {transferPoints.map((tp, idx) => (
        <Marker
          key={`transfer-${idx}`}
          position={[tp.lat, tp.lng]}
          icon={TransferIcon}
        >
          <Popup>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                Transfer Point
              </div>
              <div style={{ fontSize: 12, color: "#475569" }}>{tp.stopName}</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>
                <span style={{ color: SEGMENT_COLORS[tp.colorIdx % SEGMENT_COLORS.length], fontWeight: 700 }}>
                  Bus {tp.fromBus}
                </span>
                {" → "}
                <span style={{ color: SEGMENT_COLORS[(tp.colorIdx + 1) % SEGMENT_COLORS.length], fontWeight: 700 }}>
                  Bus {tp.toBus}
                </span>
              </div>
            </div>
          </Popup>
        </Marker>
      ))}

      {/* Start marker */}
      {fromStop && (
        <Marker position={[fromStop.latitude, fromStop.longitude]} icon={StartIcon}>
          <Popup><strong>Start: {fromStop.name}</strong></Popup>
        </Marker>
      )}

      {/* Destination marker */}
      {toStop && (
        <Marker position={[toStop.latitude, toStop.longitude]} icon={EndIcon}>
          <Popup><strong>Destination: {toStop.name}</strong></Popup>
        </Marker>
      )}

      {/* User location */}
      {userLocation && (
        <CircleMarker
          center={[userLocation.lat, userLocation.lng]}
          radius={10}
          pathOptions={{
            color: "#4f46e5",
            fillColor: "#6366f1",
            fillOpacity: 0.8,
            weight: 3,
          }}
        >
          <Popup>Your location</Popup>
        </CircleMarker>
      )}
    </MapContainer>
  );
}
