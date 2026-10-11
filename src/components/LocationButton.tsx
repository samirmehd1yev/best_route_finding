"use client";

import { useState, useEffect } from "react";

interface LocationButtonProps {
  onLocationFound: (lat: number, lng: number) => void;
  disabled?: boolean;
}

export default function LocationButton({ onLocationFound, disabled }: LocationButtonProps) {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

  useEffect(() => {
    if (status !== "success" && status !== "error") return;
    const timer = setTimeout(() => setStatus("idle"), status === "success" ? 2000 : 3000);
    return () => clearTimeout(timer);
  }, [status]);

  const handleClick = () => {
    if (!navigator.geolocation) {
      setStatus("error");
      return;
    }
    setStatus("loading");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setStatus("success");
        onLocationFound(pos.coords.latitude, pos.coords.longitude);
      },
      () => {
        setStatus("error");
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const cls = `location-btn ${status === "success" ? "success" : ""} ${status === "error" ? "error" : ""}`;

  return (
    <button className={cls} onClick={handleClick} disabled={disabled || status === "loading"}>
      {status === "loading" ? (
        <>
          <span className="spinner" style={{ borderColor: "rgba(0,0,0,0.15)", borderTopColor: "#2563eb", width: 16, height: 16 }} />
          Detecting location...
        </>
      ) : status === "success" ? (
        <>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M20 6L9 17l-5-5" />
          </svg>
          Location found! Nearest stop selected.
        </>
      ) : status === "error" ? (
        "Unable to get your location"
      ) : (
        <>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v4m0 12v4M2 12h4m12 0h4" />
          </svg>
          Use My Location
        </>
      )}
    </button>
  );
}
