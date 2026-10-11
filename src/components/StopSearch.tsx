"use client";

import { useState, useRef, useEffect, useMemo, useCallback, useId } from "react";
import type { StopDetail } from "@/lib/types";

interface StopSearchProps {
  label: string;
  placeholder: string;
  stops: StopDetail[];
  selectedStop: StopDetail | null;
  onSelect: (stop: StopDetail | null) => void;
  dotColor: "green" | "red";
}

export default function StopSearch({
  label,
  placeholder,
  stops,
  selectedStop,
  onSelect,
  dotColor,
}: StopSearchProps) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputId = useId();

  const filtered = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.trim().toLowerCase();
    return stops
      .filter((s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q))
      .slice(0, 20);
  }, [query, stops]);

  useEffect(() => {
    function handleOutside(e: MouseEvent | TouchEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("touchstart", handleOutside);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
    };
  }, []);

  useEffect(() => {
    if (isOpen && filtered.length > 0 && dropdownRef.current) {
      const timer = setTimeout(() => {
        dropdownRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isOpen, filtered.length]);

  const handleSelect = useCallback(
    (stop: StopDetail) => {
      onSelect(stop);
      setQuery("");
      setIsOpen(false);
      inputRef.current?.blur();
    },
    [onSelect]
  );

  return (
    <div ref={containerRef}>
      <label className="form-label" htmlFor={inputId}>
        <span className={`dot ${dotColor}`} />
        {label}
      </label>

      {selectedStop ? (
        <div className="selected-stop">
          <span className="stop-name">{selectedStop.name}</span>
          <span className="stop-code">{selectedStop.code}</span>
          <button
            className="clear-btn"
            onClick={() => {
              onSelect(null);
              setQuery("");
            }}
            aria-label={`Clear ${label.toLowerCase()} stop`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      ) : (
        <div>
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
            placeholder={placeholder}
            className="search-input"
          />

          {isOpen && filtered.length > 0 && (
            <div ref={dropdownRef} className="dropdown-inline">
              {filtered.map((stop) => (
                <button
                  key={stop.id}
                  className="dropdown-item"
                  onClick={() => handleSelect(stop)}
                >
                  <div className="name">{stop.name}</div>
                  <div className="code">{stop.code}</div>
                </button>
              ))}
            </div>
          )}

          {isOpen && query.trim() && filtered.length === 0 && (
            <div className="dropdown-inline" style={{ padding: 14, fontSize: 13, color: "#64748b" }}>
              No stops found for &quot;{query}&quot;
            </div>
          )}
        </div>
      )}
    </div>
  );
}
