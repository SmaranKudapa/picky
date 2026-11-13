"use client";
import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

const STAR = '<svg class="starpin" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.8l3.1 6.6 7.1.9-5.2 4.9 1.3 7.1L12 17.8l-6.3 3.5 1.3-7.1-5.2-4.9 7.1-.9z" fill="#ff6a1f" stroke="#22170f" stroke-width="1.2" stroke-linejoin="round"/></svg>';

export default function MapView({ center, places, winnerId, backupIds = [], ruledOutIds = [], reasons = {} }) {
  const el = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);

  useEffect(() => {
    if (mapRef.current || !el.current) return;
    const map = L.map(el.current, { zoomControl: false }).setView([center.lat, center.lng], 16);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; CARTO',
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    L.marker([center.lat, center.lng], {
      icon: L.divIcon({ className: "", html: '<div class="mepin"></div>', iconSize: [0, 0] }),
      zIndexOffset: 900,
    }).addTo(layer);

    let winner = null;
    for (const p of places) {
      const isWin = p.id === winnerId;
      const isBackup = backupIds.includes(p.id);
      const isOut = ruledOutIds.includes(p.id);
      if (isWin) winner = p;
      const cls = isWin ? "win" : isBackup ? "backup" : isOut ? "out" : "dot";
      const label = isWin ? `${esc(p.name)} · ${p.walkMin} min` : esc(p.name);
      const mark = isWin ? STAR : isOut ? '<div class="x"></div>' : '<div class="pt"></div>';
      const m = L.marker([p.lat, p.lng], {
        icon: L.divIcon({ className: "", html: `<div class="pin ${cls}">${mark}<div class="bub">${label}</div></div>`, iconSize: [0, 0] }),
        zIndexOffset: isWin ? 1000 : isBackup ? 600 : isOut ? 300 : 0,
      }).addTo(layer);
      m.bindPopup(`<b>${esc(p.name)}</b><br>${esc(p.cuisine || p.kind)} · ${p.walkMin} min walk${isOut && reasons[p.id] ? `<br><s>${esc(reasons[p.id])}</s>` : ""}${p.hours ? `<br><small>${esc(p.hours)}</small>` : ""}`);
    }

    // Show every nearby place, plus you.
    const pts = [[center.lat, center.lng], ...places.map((p) => [p.lat, p.lng])];
    if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 17 });
    if (winner) setTimeout(() => map.panInside([winner.lat, winner.lng], { padding: [60, 60] }), 50);
  }, [center, places, winnerId, backupIds, ruledOutIds]);

  return <div ref={el} className="map" />;
}
