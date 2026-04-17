"use client";

import type { RouteResult } from "@/lib/types";
import { WALKING_EDGE_BUS_ID } from "@/lib/types";

// Must match SEGMENT_COLORS in Map.tsx
const SEGMENT_COLORS = ["#e11d48", "#7c3aed", "#059669", "#ea580c"];

interface JourneyCardProps {
  route: RouteResult;
}

export default function JourneyCard({ route }: JourneyCardProps) {
  const firstStop = route.segments[0]?.stops[0];
  const lastSeg = route.segments[route.segments.length - 1];
  const lastStop = lastSeg?.stops[lastSeg.stops.length - 1];

  const busSegments = route.segments.filter((s) => s.busId !== WALKING_EDGE_BUS_ID);
  const busCount = busSegments.length;

  // Color index tracks only bus segments (walking segments don't consume a color)
  let busColorIdx = 0;

  return (
    <div className="journey-card">
      {/* Summary bar */}
      <div className="journey-summary">
        <div className="journey-stat">
          <span className="journey-stat-value">{route.totalDistance.toFixed(1)}</span>
          <span className="journey-stat-label">km</span>
        </div>
        <div className="journey-stat">
          <span className="journey-stat-value">{Math.round(route.totalTime)}</span>
          <span className="journey-stat-label">min</span>
        </div>
        <div className="journey-stat">
          <span className="journey-stat-value">
            {busCount === 1 ? "Direct" : `${busCount} buses`}
          </span>
          <span className="journey-stat-label">
            {route.totalTransfers === 0 ? "no transfer" : `${route.totalTransfers} transfer${route.totalTransfers > 1 ? "s" : ""}`}
          </span>
        </div>
      </div>

      {/* Timeline */}
      <div className="journey-timeline">
        {/* Start point */}
        <div className="timeline-row">
          <div className="timeline-dot start" />
          <div className="timeline-content">
            <span className="timeline-stop-name">{firstStop?.name}</span>
            <span className="timeline-label">Start</span>
          </div>
        </div>

        {/* Each segment (bus or walking) */}
        {route.segments.map((segment, idx) => {
          const isWalking = segment.busId === WALKING_EDGE_BUS_ID;
          const color = isWalking ? "#64748b" : SEGMENT_COLORS[busColorIdx % SEGMENT_COLORS.length];
          if (!isWalking) busColorIdx++;

          const distMeters = Math.round(segment.distance * 1000);

          return (
            <div key={idx}>
              {/* Segment line */}
              <div className="timeline-row">
                <div
                  className={`timeline-line${isWalking ? " walking" : ""}`}
                  style={{ "--seg-color": color } as React.CSSProperties}
                />
                {isWalking ? (
                  <div className="timeline-walk">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="5" r="2" />
                      <path d="M10 22l2-7 3 3v6" />
                      <path d="M10 13l-1.5-4.5L13 7l2 4" />
                    </svg>
                    <span className="walk-detail">
                      Walk {Math.round(segment.time)} min ({distMeters}m)
                    </span>
                  </div>
                ) : (
                  <div className="timeline-bus" style={{ borderColor: color, background: `${color}10` }}>
                    <span className="bus-number" style={{ color }}>Bus {segment.busNumber}</span>
                    <span className="bus-detail">
                      {segment.stops.length} stops &middot; {segment.distance.toFixed(1)} km &middot; {Math.round(segment.time)} min
                    </span>
                  </div>
                )}
              </div>

              {/* Transfer point between segments (skip if next is walking or current is walking) */}
              {idx < route.segments.length - 1 && !isWalking && route.segments[idx + 1].busId !== WALKING_EDGE_BUS_ID && (
                <div className="timeline-row">
                  <div className="timeline-dot transfer" />
                  <div className="timeline-content">
                    <span className="timeline-stop-name">
                      {segment.stops[segment.stops.length - 1]?.name}
                    </span>
                    <span className="timeline-label transfer-label">
                      Transfer to Bus {route.segments[idx + 1]?.busNumber}
                    </span>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* End point */}
        <div className="timeline-row">
          <div className="timeline-dot end" />
          <div className="timeline-content">
            <span className="timeline-stop-name">{lastStop?.name}</span>
            <span className="timeline-label">Destination</span>
          </div>
        </div>
      </div>
    </div>
  );
}
