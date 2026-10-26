import { randomBytes } from "crypto";
import { Request, Response } from "express";
import httpStatus from "http-status";
import { Types } from "mongoose";
import AppError from "../../errorHelpers/AppError";
import { RideStatus } from "./ride.interface";
import { Ride } from "./ride.model";
import { ACTIVE_RIDE } from "./ride.service";

/**
 * "Share my trip" (client 2026-10-26, moto-taxi safety): the passenger sends a link to a
 * close one, who follows the ride in a browser, no app or account: the driver (name,
 * photo, plate, vest), the live position and the steps. Once the ride ends the link only
 * says so: no more position, addresses or driver.
 */

const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;
const WITH_RIDER = [RideStatus.accepted, RideStatus.arrived, RideStatus.in_progress];

const latLng = (p?: { coordinates?: [number, number] }) => (p?.coordinates ? { lat: p.coordinates[1], lng: p.coordinates[0] } : undefined);
const firstName = (name?: string) => name?.trim().split(/\s+/)[0] ?? "";

/** The passenger's link for one running ride (the same link if asked again) */
const createShareLink = async (passengerId: string, rideId: string, baseUrl: string) => {
  const ride = Types.ObjectId.isValid(rideId) ? await Ride.findById(rideId).select("+shareToken passengerId status") : null;
  if (!ride || String(ride.passengerId) !== passengerId) throw new AppError(httpStatus.NOT_FOUND, "Ride not found");
  if (!ACTIVE_RIDE.includes(ride.status)) throw new AppError(httpStatus.BAD_REQUEST, "This ride is over: there is nothing to share");
  if (!ride.shareToken) {
    ride.shareToken = randomBytes(16).toString("base64url");
    await ride.save();
  }
  return { token: ride.shareToken, url: `${baseUrl}/r/${ride.shareToken}` };
};

interface SharedRide {
  status: RideStatus;
  rideNumber: string;
  passengerId?: { name?: string };
  riderId?: {
    userId?: { name?: string; avatar?: { url?: string } };
    vehicle?: { type?: string; brand?: string; color?: string; plateNumber?: string };
    vestNumber?: string;
    lastLocation?: { coordinates: [number, number] };
    lastLocationAt?: Date;
  };
  pickup: { address: string; location: { coordinates: [number, number] } };
  dropoff: { address: string; location: { coordinates: [number, number] } };
  distanceKm: number;
  durationMin: number;
  acceptedAt?: Date;
  arrivedAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  cancellation?: { at?: Date };
  updatedAt?: Date;
}

/** What the link shows: public, so only what a close one needs, and only while the ride runs */
const getSharedRide = async (token: string) => {
  const ride = TOKEN_RE.test(token)
    ? await Ride.findOne({ shareToken: token })
        .populate("passengerId", "name")
        .populate({ path: "riderId", select: "userId vehicle vestNumber lastLocation lastLocationAt", populate: { path: "userId", select: "name avatar" } })
        .lean<SharedRide>()
    : null;
  if (!ride) throw new AppError(httpStatus.NOT_FOUND, "This link doesn't exist or has expired");

  const base = { status: ride.status, rideNumber: ride.rideNumber, passenger: firstName(ride.passengerId?.name) };
  if (!ACTIVE_RIDE.includes(ride.status)) {
    return { ...base, ended: true, endedAt: ride.completedAt ?? ride.cancellation?.at ?? ride.updatedAt };
  }

  const rider = ride.riderId && WITH_RIDER.includes(ride.status) ? ride.riderId : null;
  return {
    ...base,
    ended: false,
    pickup: { address: ride.pickup.address, ...latLng(ride.pickup.location) },
    dropoff: { address: ride.dropoff.address, ...latLng(ride.dropoff.location) },
    distanceKm: ride.distanceKm,
    durationMin: ride.durationMin,
    acceptedAt: ride.acceptedAt,
    arrivedAt: ride.arrivedAt,
    startedAt: ride.startedAt,
    rider: rider
      ? {
          name: rider.userId?.name,
          avatar: rider.userId?.avatar?.url,
          vehicle: { type: rider.vehicle?.type, brand: rider.vehicle?.brand, color: rider.vehicle?.color, plateNumber: rider.vehicle?.plateNumber },
          vestNumber: rider.vestNumber,
          location: latLng(rider.lastLocation),
          locationAt: rider.lastLocationAt,
        }
      : undefined,
  };
};

export const RideShareServices = { createShareLink, getSharedRide };

// ── The page (served by the API itself: nothing else to host) ─────────

const LEAFLET = "https://unpkg.com/leaflet@1.9.4/dist";

/** GET /r/:token: the browser page; it polls /api/v1/rides/shared/:token */
export const rideSharePage = (req: Request, res: Response) => {
  const token = String(req.params.token);
  if (!TOKEN_RE.test(token)) {
    res.status(httpStatus.NOT_FOUND).type("text/plain").send("Lien introuvable / Link not found");
    return;
  }
  const nonce = randomBytes(16).toString("base64");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'none'",
      `script-src 'nonce-${nonce}' ${LEAFLET}/leaflet.js`,
      `style-src 'unsafe-inline' ${LEAFLET}/leaflet.css`,
      "img-src 'self' data: https://*.tile.openstreetmap.org https://res.cloudinary.com",
      "connect-src 'self'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join("; "),
  );
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Cache-Control", "no-store");
  res.type("html").send(page(token, nonce));
};

const page = (token: string, nonce: string) => `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Kadou24h · Suivi de course</title>
<link rel="stylesheet" href="${LEAFLET}/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="anonymous">
<style>
  :root { --primary:#6d28d9; --bg:#f6f5fb; --card:#fff; --text:#1f1b2d; --muted:#6b6880; --line:#e7e5ef; --ok:#15803d; --warn:#b45309; }
  * { box-sizing: border-box; }
  html, body { margin:0; height:100%; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background:var(--bg); color:var(--text); }
  .wrap { display:flex; flex-direction:column; height:100%; max-width:720px; margin:0 auto; }
  header { display:flex; align-items:center; gap:8px; padding:12px 16px; background:var(--primary); color:#fff; }
  header b { font-size:17px; } header span { opacity:.85; font-size:13px; margin-left:auto; }
  #map { flex:1; min-height:240px; }
  .sheet { background:var(--card); border-top:1px solid var(--line); padding:16px; display:grid; gap:12px; }
  .status { font-size:18px; font-weight:700; } .sub { color:var(--muted); font-size:14px; }
  .driver { display:flex; gap:12px; align-items:center; }
  .driver img, .avatar { width:52px; height:52px; border-radius:50%; object-fit:cover; background:var(--line); flex:none; }
  .ids { display:flex; flex-wrap:wrap; gap:8px; }
  .id { border:2px solid var(--text); border-radius:8px; padding:4px 10px; font-weight:800; letter-spacing:1px; font-size:16px; }
  .id small { display:block; font-size:10px; font-weight:600; letter-spacing:0; color:var(--muted); }
  .route { display:grid; gap:6px; font-size:14px; } .route div { display:flex; gap:8px; } .dot { width:10px; height:10px; border-radius:50%; margin-top:5px; flex:none; }
  .a { background:var(--ok); } .b { background:var(--primary); }
  .note { font-size:12px; color:var(--muted); } .name { font-weight:700; }
  .ended { flex:1; display:grid; place-items:center; text-align:center; padding:32px; }
  .hidden { display:none !important; }
</style>
</head>
<body>
<div class="wrap">
  <header><b>Kadou24h</b><span id="number"></span></header>
  <div id="map"></div>
  <div class="sheet" id="sheet">
    <div><div class="status" id="status">…</div><div class="sub" id="sub"></div></div>
    <div class="driver hidden" id="driver">
      <img id="avatar" alt="">
      <div><div id="dname" class="name"></div><div class="sub" id="vehicle"></div></div>
    </div>
    <div class="ids hidden" id="ids"></div>
    <div class="route" id="route"></div>
    <div class="note" id="note"></div>
  </div>
  <div class="ended hidden" id="ended"><div><div class="status" id="endTitle"></div><p class="sub" id="endText"></p></div></div>
</div>
<script src="${LEAFLET}/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin="anonymous"></script>
<script nonce="${nonce}">
(function () {
  var en = /^en/i.test(navigator.language || "");
  var T = en ? {
    title: "Trip tracking", searching: "Looking for a driver", accepted: "The driver is coming to pick up", arrived: "The driver is at the pickup point",
    in_progress: "On the way", shares: function (n) { return n ? n + " shares this trip with you" : "A trip is shared with you"; },
    plate: "Plate", vest: "Vest", from: "From", to: "To", updated: function (m) { return m < 1 ? "Position updated just now" : "Position updated " + m + " min ago"; },
    noPos: "Waiting for the driver's position", ended: "This trip is over", completed: "Arrived at", cancelled: "The trip was cancelled",
    expired: "No driver was found", gone: "This link doesn't exist or has expired"
  } : {
    title: "Suivi de course", searching: "Recherche d’un chauffeur", accepted: "Le chauffeur arrive au point de départ", arrived: "Le chauffeur est au point de départ",
    in_progress: "En route", shares: function (n) { return n ? n + " partage sa course avec vous" : "Une course est partagée avec vous"; },
    plate: "Plaque", vest: "Gilet", from: "Départ", to: "Arrivée", updated: function (m) { return m < 1 ? "Position mise à jour à l’instant" : "Position mise à jour il y a " + m + " min"; },
    noPos: "En attente de la position du chauffeur", ended: "Cette course est terminée", completed: "Arrivée à", cancelled: "La course a été annulée",
    expired: "Aucun chauffeur n’a été trouvé", gone: "Ce lien n’existe pas ou a expiré"
  };
  var VEHICLE = en ? { motorbike: "Motorbike", car: "Car", bicycle: "Bicycle" } : { motorbike: "Moto", car: "Voiture", bicycle: "Vélo" };
  document.documentElement.lang = en ? "en" : "fr";
  document.title = "Kadou24h · " + T.title;

  var $ = function (id) { return document.getElementById(id); };
  var text = function (id, v) { $(id).textContent = v || ""; };
  var map = L.map("map", { zoomControl: false }).setView([9.537, -13.677], 13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
  var pin = function (color) { return { radius: 8, color: "#fff", weight: 3, fillColor: color, fillOpacity: 1 }; };
  var A = null, B = null, D = null, fitted = false, timer = null;

  function show(r) {
    text("number", r.rideNumber);
    if (r.ended) {
      var done = r.status === "completed";
      return end(done ? T.ended : r.status === "expired" ? T.expired : r.status === "cancelled" ? T.cancelled : T.ended, done && r.endedAt ? T.completed + " " + time(r.endedAt) : "");
    }
    text("status", T[r.status] || r.status);
    text("sub", T.shares(r.passenger));
    if (r.pickup && r.pickup.lat != null) { A = A || L.circleMarker([r.pickup.lat, r.pickup.lng], pin("#15803d")).addTo(map); }
    if (r.dropoff && r.dropoff.lat != null) { B = B || L.circleMarker([r.dropoff.lat, r.dropoff.lng], pin("#6d28d9")).addTo(map); }
    $("route").innerHTML = "";
    [[T.from, r.pickup, "a"], [T.to, r.dropoff, "b"]].forEach(function (x) {
      if (!x[1]) return;
      var row = document.createElement("div"), dot = document.createElement("span"), label = document.createElement("span");
      dot.className = "dot " + x[2]; label.textContent = x[0] + " : " + x[1].address;
      row.appendChild(dot); row.appendChild(label); $("route").appendChild(row);
    });

    var d = r.rider;
    $("driver").classList.toggle("hidden", !d);
    $("ids").classList.toggle("hidden", !d);
    if (d) {
      text("dname", d.name);
      if (d.avatar) { $("avatar").src = d.avatar; } else { $("avatar").removeAttribute("src"); }
      var v = d.vehicle || {};
      text("vehicle", [VEHICLE[v.type] || v.type, v.brand, v.color].filter(Boolean).join(" · "));
      $("ids").innerHTML = "";
      [[T.plate, v.plateNumber], [T.vest, d.vestNumber]].forEach(function (x) {
        if (!x[1]) return;
        var box = document.createElement("div"), small = document.createElement("small");
        box.className = "id"; small.textContent = x[0]; box.appendChild(small); box.appendChild(document.createTextNode(x[1]));
        $("ids").appendChild(box);
      });
      if (d.location) {
        var at = [d.location.lat, d.location.lng];
        if (D) D.setLatLng(at); else D = L.circleMarker(at, { radius: 11, color: "#fff", weight: 3, fillColor: "#f59e0b", fillOpacity: 1 }).addTo(map);
        var mins = d.locationAt ? Math.floor((Date.now() - new Date(d.locationAt).getTime()) / 60000) : 0;
        text("note", T.updated(Math.max(mins, 0)));
      } else text("note", T.noPos);
    } else text("note", "");

    if (!fitted) {
      var pts = [A, B, D].filter(Boolean).map(function (m) { return m.getLatLng(); });
      if (pts.length) { map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 16 }); fitted = true; }
    }
  }

  function time(iso) { return iso ? new Date(iso).toLocaleTimeString(en ? "en" : "fr", { hour: "2-digit", minute: "2-digit" }) : ""; }

  function end(title, sub) {
    clearInterval(timer);
    $("map").classList.add("hidden"); $("sheet").classList.add("hidden"); $("ended").classList.remove("hidden");
    text("endTitle", title); text("endText", sub);
  }

  function load() {
    fetch("/api/v1/rides/shared/${token}", { cache: "no-store" })
      .then(function (res) { if (res.status === 404) { end(T.gone); return null; } return res.ok ? res.json() : null; })
      .then(function (body) { if (body && body.data) show(body.data); })
      .catch(function () {});
  }
  load();
  timer = setInterval(load, 10000);
})();
</script>
</body>
</html>`;
