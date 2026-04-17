"use client";

import { useState } from "react";

interface LocationButtonProps {
  onLocationFound: (lat: number, lng: number) => void;
}

export default function LocationButton({ onLocationFound }: LocationButtonProps) {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

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
        setTimeout(() => setStatus("idle"), 2000);
      },
      () => {
        setStatus("error");
        setTimeout(() => setStatus("idle"), 3000);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const cls = `location-btn ${status === "success" ? "success" : ""} ${status === "error" ? "error" : ""}`;

  return (
    <button className={cls} onClick={handleClick} disabled={status === "loading"}>
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
        "Location access denied"
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
