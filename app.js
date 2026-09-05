const STORAGE_KEY = "delivery-helper-v1";
const API_KEY_STORAGE = "delivery-helper-ors-key";

// Firebase web configuration. This key identifies the Firebase web app; access is
// still controlled by Firebase Authentication + Firestore Security Rules.
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDeJ8scsE4HxfQcUQ45yFoCdqe0q502DvE",
  authDomain: "delivery-helper-cb3a9.firebaseapp.com",
  projectId: "delivery-helper-cb3a9",
  storageBucket: "delivery-helper-cb3a9.firebasestorage.app",
  messagingSenderId: "515425564957",
  appId: "1:515425564957:web:85a3567af68701628689f4"
};
const CLOUD_DOC_COLLECTION = "deliveryHelperSync";
const CLOUD_DOC_ID = "main";

const ORS_MATRIX_URL =
  "https://api.heigit.org/openrouteservice/v2/matrix/driving-hgv";

const ORS_DIRECTIONS_URL =
  "https://api.heigit.org/openrouteservice/v2/directions/driving-hgv/geojson";

let state = loadState();
if (!state.routeStats) state.routeStats = null;
let deferredPrompt = null;
let editingDeliveryKey = null;
let routeMap = null;
let routeMapLayer = null;
let arrivalWatchId = null;
let arrivalCandidate = null;

const el = id => document.getElementById(id);

const customerDialog = el("customerDialog");
const customerForm = el("customerForm");
const deliveryDialog = el("deliveryDialog");
const deliveryForm = el("deliveryForm");
const routeMapDialog = el("routeMapDialog");


// ---------------------------------------------------
// DATA
// ---------------------------------------------------

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}

  return {
    customers: [],
    today: []
  };
}

function saveState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(state)
  );

  render();
}

function customerByKey(key) {
  return state.customers.find(
    c => c.key === key
  );
}

function todayItemByKey(key) {
  return state.today.find(
    x => x.customerKey === key
  );
}

function displayName(c) {
  return [c.id, c.name]
    .filter(Boolean)
    .join(" — ");
}

function cleanPhone(p) {
  return String(p || "")
    .replace(/[^\d+]/g, "");
}

function coordsValid(c) {
  if (!c) return false;

  if (
    c.lat === null ||
    c.lat === undefined ||
    c.lat === "" ||
    c.lng === null ||
    c.lng === undefined ||
    c.lng === ""
  ) {
    return false;
  }

  const lat = Number(c.lat);
  const lng = Number(c.lng);

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return false;
  }

  if (
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return false;
  }

  if (lat === 0 && lng === 0) {
    return false;
  }

  return true;
}

function escapeHtml(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    ch => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[ch])
  );
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function hhmmFromEpoch(sec) {
  if (!Number.isFinite(Number(sec))) {
    return "";
  }

  const d = new Date(Number(sec) * 1000);

  return (
    pad2(d.getHours()) +
    ":" +
    pad2(d.getMinutes())
  );
}

function todayAt(hhmm) {
  if (!hhmm) return null;

  const [h, m] = hhmm
    .split(":")
    .map(Number);

  if (
    !Number.isFinite(h) ||
    !Number.isFinite(m)
  ) {
    return null;
  }

  const d = new Date();
  d.setHours(h, m, 0, 0);

  return Math.floor(
    d.getTime() / 1000
  );
}

function endOfToday() {
  const d = new Date();
  d.setHours(23, 59, 59, 0);

  return Math.floor(
    d.getTime() / 1000
  );
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);

  return Math.floor(
    d.getTime() / 1000
  );
}


// ---------------------------------------------------
// DELIVERY TEXT
// ---------------------------------------------------

function formatRule(t) {
  if (!t) return "";

  if (
    t.timeRule === "window" &&
    t.timeStart &&
    t.timeEnd
  ) {
    return `🕒 ${t.timeStart}–${t.timeEnd}`;
  }

  if (
    t.timeRule === "after" &&
    t.timeStart
  ) {
    return `🕒 After ${t.timeStart}`;
  }

  if (
    t.timeRule === "before" &&
    t.timeEnd
  ) {
    return `🕒 Before ${t.timeEnd}`;
  }

  return "";
}

function callReminderText(t) {
  if (!t?.callBeforeMin) {
    return "";
  }

  if (t.eta) {
    const callAt =
      Number(t.eta) -
      Number(t.callBeforeMin) * 60;

    return (
      "📞 Call about " +
      hhmmFromEpoch(callAt) +
      " (" +
      t.callBeforeMin +
      " min before)"
    );
  }

  return (
    "📞 Call " +
    t.callBeforeMin +
    " min before"
  );
}


// ---------------------------------------------------
// PHONE / NAVIGATION
// ---------------------------------------------------

function openCall(phone) {
  const p = cleanPhone(phone);

  if (!p) {
    return alert(
      "No phone number saved."
    );
  }

  location.href = `tel:${p}`;
}

function navigate(c) {
  let destination = "";

  // Verified point: use saved GPS. First visit: use the written address as the clue.
  if (c?.locationSource === "verified" && coordsValid(c)) {
    destination = `${c.lat},${c.lng}`;
  } else if (c?.deliveryAddress || c?.address || c?.taxAddress) {
    destination = c.deliveryAddress || c.address || c.taxAddress;
  } else if (coordsValid(c)) {
    destination = `${c.lat},${c.lng}`;
  } else {
    return alert("Δεν υπάρχει διεύθυνση ή GPS για αυτή την τοποθεσία.");
  }

  location.href =
    "https://www.google.com/maps/dir/?api=1&destination=" +
    encodeURIComponent(destination);
}


// ---------------------------------------------------
// TODAY / ORDER
// ---------------------------------------------------

function addToToday(c) {
  if (todayItemByKey(c.key)) {
    return;
  }

  state.today.push({
    customerKey: c.key,
    quantity: "",
    done: false,
    order: state.today.length,
    timeRule: "none",
    timeStart: "",
    timeEnd: "",
    callBeforeMin: 0,
    deliveryNote: "",
    eta: null,
    etaExcluded: false,
    visitStartedAt: null
  });

  saveState();
}

function removeFromToday(key) {
  state.today =
    state.today.filter(
      x => x.customerKey !== key
    );

  normalizeOrder();
  invalidateEtas(
    "Stop removed — recalculate ETA when the final order is ready."
  );
  saveState();
}

function learnServiceTimeFromVisit(item) {
  if (!item?.visitStartedAt) return null;

  const customer = customerByKey(item.customerKey);
  if (!customer) return null;

  const seconds = Math.round(Date.now() / 1000 - Number(item.visitStartedAt));
  item.visitStartedAt = null;

  // Ignore accidental taps and abandoned timers.
  if (!Number.isFinite(seconds) || seconds < 60 || seconds > 4 * 3600) return null;

  const oldTotal = Number(customer.serviceTotalSec || 0);
  const oldCount = Number(customer.serviceVisitCount || 0);
  customer.serviceTotalSec = oldTotal + seconds;
  customer.serviceVisitCount = oldCount + 1;
  customer.serviceMin = Math.max(1, Math.round(customer.serviceTotalSec / customer.serviceVisitCount / 60));

  item.lastLearnedVisitSec = seconds;
  item.lastLearnedAt = Date.now();
  return seconds;
}

function startVisitTimer(key, source = "manual") {
  const item = todayItemByKey(key);
  if (!item || item.done || item.visitStartedAt) return;

  item.visitStartedAt = Math.floor(Date.now() / 1000);
  item.visitStartSource = source;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  render();
}

function markDone(key) {
  const item = todayItemByKey(key);
  if (!item) return;

  learnServiceTimeFromVisit(item);
  item.done = true;
  saveState();
}

function undoDone(key) {
  const item = todayItemByKey(key);
  if (!item) return;

  // If this completion just contributed a learned sample, undo that sample too.
  if (item.lastLearnedVisitSec && item.lastLearnedAt) {
    const customer = customerByKey(item.customerKey);
    if (customer) {
      customer.serviceTotalSec = Math.max(0, Number(customer.serviceTotalSec || 0) - Number(item.lastLearnedVisitSec));
      customer.serviceVisitCount = Math.max(0, Number(customer.serviceVisitCount || 0) - 1);
      if (customer.serviceVisitCount > 0) {
        customer.serviceMin = Math.max(1, Math.round(customer.serviceTotalSec / customer.serviceVisitCount / 60));
      }
    }
    item.lastLearnedVisitSec = null;
    item.lastLearnedAt = null;
  }

  item.done = false;
  saveState();
}

function currentUndone() {
  return [...state.today]
    .sort(
      (a, b) =>
        a.order - b.order
    )
    .find(x => !x.done);
}

function normalizeOrder() {
  state.today
    .sort(
      (a, b) =>
        a.order - b.order
    )
    .forEach(
      (item, index) =>
        item.order = index
    );
}

function invalidateEtas(message = "") {
  state.today.forEach(item => item.eta = null);
  state.routeStats = null;

  if (message) {
    el("optimizerStatus")
      .textContent = message;
  }
}

function toggleEtaExcluded(customerKey) {
  const item = todayItemByKey(customerKey);
  if (!item) return;

  item.etaExcluded = !item.etaExcluded;
  item.eta = null;
  state.routeStats = null;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  render();

  if (routeMapDialog?.open) {
    drawNumberedMap().catch(error => {
      if (el("routeMapStatus")) el("routeMapStatus").textContent = "⚠ " + error.message;
    });
  }

  if (el("optimizerStatus")) {
    el("optimizerStatus").textContent = item.etaExcluded
      ? "Η στάση εξαιρέθηκε από ETA/βελτιστοποίηση. Παραμένει στη σημερινή διαδρομή και στον χάρτη."
      : "Η στάση επέστρεψε στο ETA. Πάτησε ETA για νέο υπολογισμό.";
  }
}

window.toggleEtaExcludedFromMap = function(customerKey) {
  toggleEtaExcluded(customerKey);
};

function moveStop(customerKey, delta) {
  const ordered =
    [...state.today].sort(
      (a, b) =>
        a.order - b.order
    );

  const index =
    ordered.findIndex(
      x =>
        x.customerKey === customerKey
    );

  if (index < 0) return;

  const target =
    index + delta;

  if (
    target < 0 ||
    target >= ordered.length
  ) {
    return;
  }

  const temp =
    ordered[index];

  ordered[index] =
    ordered[target];

  ordered[target] =
    temp;

  ordered.forEach(
    (item, i) =>
      item.order = i
  );

  state.today = ordered;

  invalidateEtas(
    "Manual order changed. Numbered map updated; tap Recalculate ETA when finished."
  );

  saveState();

  if (
    routeMapDialog.open
  ) {
    drawNumberedMap();
  }
}


// ---------------------------------------------------
// RENDER
// ---------------------------------------------------


// ---------------------------------------------------
// APP PAGES
// ---------------------------------------------------

const PAGE_TITLES = { drive: "Διαδρομή", prep: "Προετοιμασία", customers: "Πελάτες", more: "Περισσότερα" };

function showPage(page) {
  const validPage =
    PAGE_TITLES[page]
      ? page
      : "drive";

  document
    .querySelectorAll(".app-page")
    .forEach(section => {
      section.classList.toggle(
        "active",
        section.id ===
          `page-${validPage}`
      );
    });

  document
    .querySelectorAll(".nav-tab")
    .forEach(button => {
      button.classList.toggle(
        "active",
        button.dataset.page ===
          validPage
      );
    });

  sessionStorage.setItem(
    "delivery-helper-page",
    validPage
  );

  window.scrollTo({
    top: 0,
    behavior: "instant"
  });
}

document
  .querySelectorAll(".nav-tab")
  .forEach(button => {
    button.addEventListener(
      "click",
      () =>
        showPage(
          button.dataset.page
        )
    );
  });

function render() {
  renderSummary();
  renderCarousel();
  renderToday();
  renderCustomers();
  renderDriveExtras();
}

function renderSummary() {
  const total =
    state.today.length;

  const done =
    state.today.filter(
      x => x.done
    ).length;

  el("routeSummary").textContent = `${total} στάσεις σήμερα • ${done} παραδόθηκαν • ${Math.max(total - done, 0)} απομένουν`;
}


// ---------------------------------------------------
// NEXT 5 CARDS
// ---------------------------------------------------

function makeCard(t, idx, currentKey) {
  const c =
    customerByKey(
      t.customerKey
    );

  const node =
    el("cardTemplate")
      .content
      .firstElementChild
      .cloneNode(true);

  if (!c) {
    return node;
  }

  if (
    c.key === currentKey
  ) {
    node.classList.add(
      "current"
    );
  }

  node.querySelector(
    ".stop-number"
  ).textContent =
    idx === 0
      ? `ΕΠΟΜΕΝΗ • ΣΤΑΣΗ ${idx + 1}`
      : `ΣΤΑΣΗ ${idx + 1}`;

  node.querySelector(
    ".stop-title"
  ).textContent =
    displayName(c);

  const parts = [];

  if (t.quantity) {
    parts.push(
      `${t.quantity} units`
    );
  }

  if (t.eta) {
    parts.push(
      `ETA ~${hhmmFromEpoch(t.eta)}`
    );
  }

  if (formatRule(t)) {
    parts.push(
      formatRule(t)
    );
  }

  const cardAddress =
    c.deliveryAddress ||
    c.address ||
    c.taxAddress ||
    "";

  if (cardAddress) {
    parts.push("📍 " + cardAddress);
  }

  if (
    c.locationSource ===
    "verified"
  ) {
    parts.push(
      "🟢 Επιβεβαιωμένο GPS"
    );
  } else if (
    coordsValid(c)
  ) {
    parts.push(
      "🟡 Κατά προσέγγιση GPS"
    );
  }

  node.querySelector(
    ".stop-meta"
  ).textContent =
    parts.join(" • ");

  node.querySelector(
    ".stop-notes"
  ).textContent =
    [
      callReminderText(t),
      t.deliveryNote,
      c.companyNotes,
      c.myNotes
    ]
      .filter(Boolean)
      .join("\n");

  const b1 =
    node.querySelector(
      ".call1"
    );

  const b2 =
    node.querySelector(
      ".call2"
    );

  b1.onclick =
    () => openCall(c.phone1);

  b2.onclick =
    () => openCall(c.phone2);

  if (!c.phone1) {
    b1.disabled = true;
  }

  if (!c.phone2) {
    b2.disabled = true;
  }

  node.querySelector(
    ".nav"
  ).onclick =
    () => navigate(c);

  node.querySelector(
    ".done"
  ).onclick =
    () => markDone(c.key);

  return node;
}

function renderCarousel() {
  const box =
    el("carousel");

  box.innerHTML = "";

  const items =
    [...state.today]
      .sort(
        (a, b) =>
          a.order - b.order
      )
      .filter(
        x => !x.done
      );

  el("emptyRoute")
    .style.display =
      items.length
        ? "none"
        : "block";

  const visibleStops =
    items;

  const currentKey =
    visibleStops[0]
      ?.customerKey;

  visibleStops.forEach(
    (t, i) => {
      box.appendChild(
        makeCard(
          t,
          i,
          currentKey
        )
      );
    }
  );
}


// ---------------------------------------------------
// TODAY LIST
// ---------------------------------------------------

function renderToday() {
  const box =
    el("todayList");

  box.innerHTML = "";

  const items =
    [...state.today]
      .sort(
        (a, b) =>
          a.order - b.order
      );

  if (!items.length) {
    box.innerHTML =
      '<div class="subtle">No stops in today\'s route.</div>';

    return;
  }

  items.forEach(
    (t, i) => {
      const c =
        customerByKey(
          t.customerKey
        );

      if (!c) return;

      let gps = "";

      if (
        c.locationSource ===
        "verified"
      ) {
        gps =
          "🟢 Επιβεβαιωμένο GPS";
      } else if (coordsValid(c)) {
        gps = c.gpsSuspicious
          ? "⚠ Ύποπτο κατά προσέγγιση GPS"
          : "🟡 Κατά προσέγγιση GPS";
      }

      if (t.etaExcluded) {
        gps += (gps ? " • " : "") + "🚫 Εκτός ETA";
      }

      const row =
        document.createElement(
          "div"
        );

      row.className =
        "row" +
        (t.done
          ? " done"
          : "");

      row.innerHTML = `
        <div class="row-main">
          <div class="row-title">
            ${i + 1}. ${escapeHtml(displayName(c))}
          </div>

          <div class="row-sub">
            ${escapeHtml(
              [
                t.quantity
                  ? t.quantity + " units"
                  : "",

                t.eta
                  ? "ETA ~" + hhmmFromEpoch(t.eta)
                  : "",

                formatRule(t),
                callReminderText(t),

                c.deliveryAddress ||
                c.address ||
                "",

                gps
              ]
                .filter(Boolean)
                .join(" • ")
            )}
          </div>
        </div>

        <div class="row-actions">
          <button class="reorder" data-act="up" title="Move earlier">↑</button>
          <button class="reorder" data-act="down" title="Move later">↓</button>
          <button data-act="details">🗓 Πρόγραμμα</button>
          <button data-act="call">📞</button>
          <button data-act="nav">🧭</button>
          <button data-act="verify" class="verify-gps">${c.locationSource === "verified" ? "✓ GPS" : "📍 Επιβεβ. GPS"}</button>
          <button data-act="eta-toggle">${t.etaExcluded ? "↩ Στο ETA" : "🚫 Εκτός ETA"}</button>
          <button data-act="start">${t.visitStartedAt ? "⏱ Σε εξέλιξη" : "▶ Έναρξη"}</button>
          <button data-act="done">${t.done ? "↩ Αναίρεση" : "✓ Έτοιμο"}</button>
          <button data-act="remove">Αφαίρεση</button>
        </div>
      `;

      row.querySelector(
        '[data-act="up"]'
      ).disabled =
        i === 0;

      row.querySelector(
        '[data-act="down"]'
      ).disabled =
        i ===
        items.length - 1;

      row.querySelector(
        '[data-act="up"]'
      ).onclick =
        () =>
          moveStop(
            c.key,
            -1
          );

      row.querySelector(
        '[data-act="down"]'
      ).onclick =
        () =>
          moveStop(
            c.key,
            1
          );

      row.querySelector(
        '[data-act="details"]'
      ).onclick =
        () =>
          openDeliveryDialog(
            c.key
          );

      row.querySelector(
        '[data-act="call"]'
      ).onclick =
        () =>
          openCall(c.phone1);

      row.querySelector(
        '[data-act="nav"]'
      ).onclick =
        () =>
          navigate(c);

      const verifyBtn = row.querySelector(
        '[data-act="verify"]'
      );

      verifyBtn.disabled = c.locationSource === "verified";
      verifyBtn.onclick = () => verifyCustomerGps(c.key);

      row.querySelector('[data-act="eta-toggle"]').onclick = () => toggleEtaExcluded(c.key);

      const startBtn = row.querySelector('[data-act="start"]');
      startBtn.disabled = Boolean(t.done || t.visitStartedAt);
      startBtn.onclick = () => startVisitTimer(c.key, "manual");

      row.querySelector(
        '[data-act="done"]'
      ).onclick =
        () => {
          if (t.done) undoDone(c.key);
          else markDone(c.key);
        };

      row.querySelector(
        '[data-act="remove"]'
      ).onclick =
        () =>
          removeFromToday(
            c.key
          );

      box.appendChild(row);
    }
  );
}


// ---------------------------------------------------
// CUSTOMER LIST
// ---------------------------------------------------

function renderCustomers() {
  const q =
    el("searchInput")
      .value
      .trim()
      .toLowerCase();

  const box =
    el("customerList");

  box.innerHTML = "";

  const list =
    state.customers
      .filter(
        c => {
          const hay =
            [
              c.id,
              c.name,
              c.address,
              c.taxAddress,
              c.deliveryAddress,
              c.phone1,
              c.phone2,
              c.companyNotes,
              c.myNotes
            ]
              .join(" ")
              .toLowerCase();

          return hay.includes(q);
        }
      )
      .sort(
        (a, b) =>
          String(a.id)
            .localeCompare(
              String(b.id)
            )
      );

  list.forEach(
    c => {
      const inToday =
        !!todayItemByKey(
          c.key
        );

      const sameIdLocations = state.customers
        .filter(other => normalizedCustomerId(other.id) === normalizedCustomerId(c.id))
        .sort((a, b) => customerLocationAddress(a).localeCompare(customerLocationAddress(b)));
      const locationNumber = sameIdLocations.findIndex(other => other.key === c.key) + 1;
      const locationLabel = sameIdLocations.length > 1
        ? `📍 Τοποθεσία ${locationNumber}/${sameIdLocations.length}`
        : "";

      let gps = "";

      if (
        c.locationSource ===
        "verified"
      ) {
        gps =
          "🟢 Επιβεβαιωμένο";
      } else if (
        coordsValid(c)
      ) {
        gps =
          "🟡 Κατά προσέγγιση";
      }

      const row =
        document.createElement(
          "div"
        );

      row.className =
        "row";

      row.innerHTML = `
        <div class="row-main">
          <div class="row-title">
            ${escapeHtml(displayName(c))}
          </div>

          <div class="row-sub">
            ${escapeHtml(
              [
                c.deliveryAddress ||
                c.address ||
                "",
                locationLabel,
                gps,
                c.phone1 || ""
              ]
                .filter(Boolean)
                .join(" • ")
            )}
          </div>
        </div>

        <div class="row-actions">
          <button data-act="edit">Edit</button>
          <button data-act="today">${inToday ? "In today ✓" : "+ Today"}</button>
        </div>
      `;

      row.querySelector(
        '[data-act="edit"]'
      ).onclick =
        () =>
          openCustomerDialog(c);

      row.querySelector(
        '[data-act="today"]'
      ).onclick =
        () =>
          inToday
            ? removeFromToday(c.key)
            : addToToday(c);

      box.appendChild(row);
    }
  );
}


// ---------------------------------------------------
// ADDRESS LOOKUP
// ---------------------------------------------------

async function findAddressLocation() {
  const address =
    el("deliveryAddress")
      .value
      .trim() ||
    el("taxAddress")
      .value
      .trim();

  if (!address) {
    return alert(
      "Enter a delivery address, village or landmark first."
    );
  }

  const btn =
    el("findLocationBtn");

  const status =
    el("locationStatus");

  btn.disabled = true;
  btn.textContent =
    "Searching…";

  status.textContent =
    "Looking for the address…";

  try {
    const query =
      /greece|ελλάδα/i.test(
        address
      )
        ? address
        : `${address}, Greece`;

    const url =
      "https://nominatim.openstreetmap.org/search" +
      "?format=jsonv2" +
      "&limit=5" +
      "&countrycodes=gr" +
      "&q=" +
      encodeURIComponent(query);

    const response =
      await fetch(url);

    if (!response.ok) {
      throw new Error(
        "Address search failed"
      );
    }

    const results =
      await response.json();

    if (!results.length) {
      status.textContent =
        "No location found.";
      return;
    }

    const best =
      results[0];

    el("lat").value =
      Number(
        best.lat
      ).toFixed(6);

    el("lng").value =
      Number(
        best.lon
      ).toFixed(6);

    status.dataset.source =
      "approximate";

    status.textContent =
      "🟡 Approximate location: " +
      best.display_name;

  } catch (error) {
    console.error(error);

    status.textContent =
      "Could not find address.";
  } finally {
    btn.disabled = false;

    btn.textContent =
      "🔎 Find location";
  }
}


// ---------------------------------------------------
// FIRST-VISIT ADDRESS -> APPROXIMATE GPS
// Approximate points are used for planning only until the driver verifies them.
// ---------------------------------------------------

function customerAddressQuery(c) {
  return String(c?.deliveryAddress || c?.address || c?.taxAddress || "").trim();
}

async function geocodeCustomerApproximate(c) {
  if (!c || coordsValid(c)) return true;

  const address = customerAddressQuery(c);
  if (!address) return false;

  const query = /greece|ελλάδα/i.test(address) ? address : `${address}, Greece`;
  const apiKey = localStorage.getItem(API_KEY_STORAGE);

  if (apiKey) {
    try {
      const url =
        "https://api.openrouteservice.org/geocode/search" +
        "?api_key=" + encodeURIComponent(apiKey) +
        "&boundary.country=GR&size=1&text=" + encodeURIComponent(query);

      const response = await fetch(url, { cache: "no-store" });
      const result = await response.json();
      const coords = result?.features?.[0]?.geometry?.coordinates;

      if (response.ok && Array.isArray(coords) &&
          Number.isFinite(Number(coords[0])) && Number.isFinite(Number(coords[1]))) {
        c.lng = Number(coords[0]);
        c.lat = Number(coords[1]);
        c.locationSource = "approximate";
        return true;
      }
    } catch (error) {
      console.warn("ORS geocoding failed:", error);
    }
  }

  try {
    const url =
      "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=gr&q=" +
      encodeURIComponent(query);
    const response = await fetch(url, { cache: "no-store" });
    const results = await response.json();
    const best = results?.[0];

    if (response.ok && best &&
        Number.isFinite(Number(best.lat)) && Number.isFinite(Number(best.lon))) {
      c.lat = Number(best.lat);
      c.lng = Number(best.lon);
      c.locationSource = "approximate";
      return true;
    }
  } catch (error) {
    console.warn("Nominatim geocoding failed:", error);
  }

  return false;
}

// Mark unusual first-visit geocoding results for DRIVER REVIEW.
// Nothing is deleted and nothing is automatically excluded from ETA.
// Verified driver GPS is always trusted.
function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = deg => Number(deg) * Math.PI / 180;
  const aLat = toRad(lat1);
  const bLat = toRad(lat2);
  const dLat = toRad(Number(lat2) - Number(lat1));
  const dLng = toRad(Number(lng2) - Number(lng1));
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat) * Math.cos(bLat) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function medianNumber(values) {
  const nums = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function refreshSuspiciousGpsFlags(pending) {
  const located = pending
    .map(item => customerByKey(item.customerKey))
    .filter(c => coordsValid(c));

  for (const c of located) {
    if (c.locationSource === "verified") c.gpsSuspicious = false;
    else c.gpsSuspicious = false;
  }

  if (located.length < 3) return;

  const centerLat = medianNumber(located.map(c => c.lat));
  const centerLng = medianNumber(located.map(c => c.lng));
  if (!Number.isFinite(centerLat) || !Number.isFinite(centerLng)) return;

  // Warning only. This is deliberately NOT a hard geographic rule.
  // A remote village remains usable unless the driver chooses to exclude it.
  const SUSPICIOUS_FROM_ROUTE_CENTER_KM = 85;

  for (const item of pending) {
    const c = customerByKey(item.customerKey);
    if (!c || !coordsValid(c) || c.locationSource === "verified") continue;
    const km = haversineKm(centerLat, centerLng, c.lat, c.lng);
    c.gpsSuspicious = Number.isFinite(km) && km > SUSPICIOUS_FROM_ROUTE_CENTER_KM;
  }
}

function missingLocationSummary(items) {
  const counts = new Map();
  for (const item of items) {
    const c = customerByKey(item.customerKey);
    const id = String(c?.id || "Χωρίς κωδικό").trim();
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([id, count]) => count > 1 ? `${id} (${count} τοποθεσίες)` : id)
    .join(", ");
}

async function ensureApproximateGpsForStops(pending, statusText = "") {
  const missing = pending.filter(item => !coordsValid(customerByKey(item.customerKey)));
  if (!missing.length) {
    refreshSuspiciousGpsFlags(pending);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    render();
    return [];
  }

  const customers = [];
  const seen = new Set();
  for (const item of missing) {
    if (seen.has(item.customerKey)) continue;
    seen.add(item.customerKey);
    const c = customerByKey(item.customerKey);
    if (c) customers.push(c);
  }

  for (let i = 0; i < customers.length; i++) {
    if (el("optimizerStatus")) {
      el("optimizerStatus").textContent =
        `${statusText || "Εντοπίζω νέες διευθύνσεις"} • ${i + 1}/${customers.length}`;
    }
    await geocodeCustomerApproximate(customers[i]);
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

  // Highlight unusual approximate points, but leave the final decision to the driver.
  refreshSuspiciousGpsFlags(pending);

  render();
  return pending.filter(item => !coordsValid(customerByKey(item.customerKey)));
}

async function verifyCustomerGps(customerKey) {
  const c = customerByKey(customerKey);
  if (!c) return;

  const label = c.id || displayName(c);
  const status = el("optimizerStatus");

  try {
    // ONE-TAP VERIFY: no confirmation dialog. The button itself is the driver's confirmation.
    if (status) status.textContent = `📍 ${label}: λήψη GPS…`;

    const pos = await getCurrentPosition();
    const accuracy = Number(pos.coords.accuracy);

    // Never save a very weak fix as a permanent verified delivery point.
    // The driver simply taps the same button again when the phone has a better fix.
    if (Number.isFinite(accuracy) && accuracy > 80) {
      if (status) {
        status.textContent =
          `⚠ ${label}: χαμηλή ακρίβεια GPS (±${Math.round(accuracy)} m). Πάτησε ξανά σε λίγο.`;
      }
      return;
    }

    c.lat = Number(pos.coords.latitude.toFixed(6));
    c.lng = Number(pos.coords.longitude.toFixed(6));
    c.locationSource = "verified";
    c.gpsSuspicious = false;

    const todayItem = todayItemByKey(c.key);
    if (todayItem) {
      // A driver-verified point is trusted again for ETA automatically.
      todayItem.etaExcluded = false;

      // Verifying while physically at the customer also starts the visit timer.
      if (!todayItem.done && !todayItem.visitStartedAt) {
        todayItem.visitStartedAt = Math.floor(Date.now() / 1000);
        todayItem.visitStartSource = "gps-verified";
      }
    }

    invalidateEtas();
    saveState();
    render();

    if (status) {
      status.textContent =
        `✓ ${label}: GPS αποθηκεύτηκε με 1 πάτημα • ±${Math.round(accuracy || 0)} m`;
    }
  } catch (error) {
    if (status) status.textContent = `⚠ ${label}: δεν ήταν δυνατή η λήψη GPS`;
    alert("Δεν μπόρεσα να πάρω GPS:\n\n" + error.message);
  }
}


// ---------------------------------------------------
// CHECK MAP
// ---------------------------------------------------

function checkEnteredLocation() {
  let q = "";

  const lat =
    Number(
      el("lat").value
    );

  const lng =
    Number(
      el("lng").value
    );

  if (
    el("lat").value !== "" &&
    el("lng").value !== "" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng)
  ) {
    q =
      `${lat},${lng}`;
  } else {
    q =
      el("deliveryAddress")
        .value
        .trim() ||
      el("taxAddress")
        .value
        .trim();
  }

  if (!q) {
    return alert(
      "No location entered."
    );
  }

  window.open(
    "https://www.google.com/maps/search/?api=1&query=" +
    encodeURIComponent(q),
    "_blank",
    "noopener"
  );
}


// ---------------------------------------------------
// CUSTOMER FORM
// ---------------------------------------------------

function openCustomerDialog(
  c = null
) {
  customerForm.reset();

  el("serviceMin")
    .value = 12;

  el("locationStatus")
    .dataset.source = "";

  el("locationStatus")
    .textContent =
      "No location checked yet.";

  el("saveGpsBtn")
    .textContent =
      "📍 Use my current location";

  if (c) {
    el("dialogTitle")
      .textContent =
        "Edit customer";

    el("editKey")
      .value =
        c.key;

    el("customerId")
      .value =
        c.id || "";

    el("customerName")
      .value =
        c.name || "";

    el("taxAddress")
      .value =
        c.taxAddress ||
        c.address ||
        "";

    el("deliveryAddress")
      .value =
        c.deliveryAddress ||
        c.address ||
        "";

    el("phone1")
      .value =
        c.phone1 || "";

    el("phone2")
      .value =
        c.phone2 || "";

    el("lat")
      .value =
        c.lat ?? "";

    el("lng")
      .value =
        c.lng ?? "";

    el("serviceMin")
      .value =
        c.serviceMin ?? 12;

    el("open1Start")
      .value =
        c.open1Start || "";

    el("open1End")
      .value =
        c.open1End || "";

    el("open2Start")
      .value =
        c.open2Start || "";

    el("open2End")
      .value =
        c.open2End || "";

    el("companyNotes")
      .value =
        c.companyNotes || "";

    el("myNotes")
      .value =
        c.myNotes || "";

    if (
      c.locationSource ===
      "verified"
    ) {
      el("locationStatus")
        .dataset.source =
          "verified";

      el("locationStatus")
        .textContent =
          "🟢 Verified truck position";
    } else if (
      coordsValid(c)
    ) {
      el("locationStatus")
        .dataset.source =
          "approximate";

      el("locationStatus")
        .textContent =
          "🟡 Approximate address location";
    }
  } else {
    el("dialogTitle")
      .textContent =
        "New customer";

    el("editKey")
      .value = "";
  }

  customerDialog.showModal();
}


// ---------------------------------------------------
// SAVE CUSTOMER
// ---------------------------------------------------

customerForm.addEventListener(
  "submit",
  event => {
    event.preventDefault();

    const key =
      el("editKey")
        .value ||
      crypto.randomUUID();

    const existing =
      customerByKey(key);

    const customer = {
      key,

      id:
        el("customerId")
          .value
          .trim(),

      name:
        el("customerName")
          .value
          .trim(),

      taxAddress:
        el("taxAddress")
          .value
          .trim(),

      deliveryAddress:
        el("deliveryAddress")
          .value
          .trim(),

      address:
        el("deliveryAddress")
          .value
          .trim() ||
        el("taxAddress")
          .value
          .trim(),

      phone1:
        el("phone1")
          .value
          .trim(),

      phone2:
        el("phone2")
          .value
          .trim(),

      lat:
        el("lat").value === ""
          ? null
          : Number(
              el("lat").value
            ),

      lng:
        el("lng").value === ""
          ? null
          : Number(
              el("lng").value
            ),

      locationSource:
        el("locationStatus")
          .dataset.source ||
        existing
          ?.locationSource ||
        (
          el("lat").value &&
          el("lng").value
            ? "approximate"
            : null
        ),

      serviceMin:
        Number(
          el("serviceMin")
            .value || 12
        ),

      open1Start:
        el("open1Start")
          .value,

      open1End:
        el("open1End")
          .value,

      open2Start:
        el("open2Start")
          .value,

      open2End:
        el("open2End")
          .value,

      companyNotes:
        el("companyNotes")
          .value
          .trim(),

      myNotes:
        el("myNotes")
          .value
          .trim()
    };

    if (existing) {
      Object.assign(
        existing,
        customer
      );
    } else {
      state.customers.push(
        customer
      );
    }

    customerDialog.close();
    invalidateEtas(
      "Customer details changed — recalculate ETA if this customer is in today's route."
    );
    saveState();
  }
);


// ---------------------------------------------------
// SAVE REAL GPS
// ---------------------------------------------------

el("saveGpsBtn")
  .onclick =
    () => {
      if (
        !navigator.geolocation
      ) {
        return alert(
          "GPS is not available."
        );
      }

      el("saveGpsBtn")
        .textContent =
          "Getting GPS…";

      navigator.geolocation
        .getCurrentPosition(
          pos => {
            el("lat")
              .value =
                pos.coords
                  .latitude
                  .toFixed(6);

            el("lng")
              .value =
                pos.coords
                  .longitude
                  .toFixed(6);

            el("locationStatus")
              .dataset.source =
                "verified";

            el("locationStatus")
              .textContent =
                `🟢 Verified truck position • GPS ±${Math.round(pos.coords.accuracy || 0)} m`;

            el("saveGpsBtn")
              .textContent =
                "📍 GPS saved";
          },

          error => {
            alert(
              "Could not get GPS: " +
              error.message
            );

            el("saveGpsBtn")
              .textContent =
                "📍 Use my current location";
          },

          {
            enableHighAccuracy:
              true,
            timeout: 15000,
            maximumAge: 0
          }
        );
    };


// ---------------------------------------------------
// DELIVERY DETAILS
// ---------------------------------------------------

function openDeliveryDialog(
  customerKey
) {
  const c =
    customerByKey(
      customerKey
    );

  const t =
    todayItemByKey(
      customerKey
    );

  if (!c || !t) {
    return;
  }

  editingDeliveryKey =
    customerKey;

  deliveryForm.reset();

  el("deliveryDialogTitle")
    .textContent =
      displayName(c);

  el("deliveryQuantity")
    .value =
      t.quantity ?? "";

  el("timeRule")
    .value =
      t.timeRule || "none";

  el("timeStart")
    .value =
      t.timeStart || "";

  el("timeEnd")
    .value =
      t.timeEnd || "";

  el("callBeforeMin")
    .value =
      t.callBeforeMin || 0;

  el("deliveryNote")
    .value =
      t.deliveryNote || "";

  updateTimeRuleFields();

  deliveryDialog.showModal();
}

function updateTimeRuleFields() {
  const rule =
    el("timeRule").value;

  el("timeStartWrap")
    .style.display =
      (
        rule === "window" ||
        rule === "after"
      )
        ? "flex"
        : "none";

  el("timeEndWrap")
    .style.display =
      (
        rule === "window" ||
        rule === "before"
      )
        ? "flex"
        : "none";
}

el("timeRule")
  .onchange =
    updateTimeRuleFields;

deliveryForm.addEventListener(
  "submit",
  e => {
    e.preventDefault();

    const t =
      todayItemByKey(
        editingDeliveryKey
      );

    if (!t) return;

    t.quantity =
      el("deliveryQuantity")
        .value
        .trim();

    t.timeRule =
      el("timeRule")
        .value;

    t.timeStart =
      el("timeStart")
        .value;

    t.timeEnd =
      el("timeEnd")
        .value;

    t.callBeforeMin =
      Math.max(
        0,
        Number(
          el("callBeforeMin")
            .value || 0
        )
      );

    t.deliveryNote =
      el("deliveryNote")
        .value
        .trim();

    t.eta = null;

    deliveryDialog.close();

    el("optimizerStatus")
      .textContent =
        "Schedule changed — recalculate ETA when the final order is ready.";

    saveState();
  }
);


// ---------------------------------------------------
// BUILD TODAY FROM CUSTOMER IDS
// ---------------------------------------------------

el("buildRouteBtn")
  .onclick =
    () => {
      const text =
        el("routeInput")
          .value
          .trim();

      if (!text) {
        return alert(
          "Enter at least one customer ID."
        );
      }

      const lines =
        text
          .split("\n")
          .map(
            x => x.trim()
          )
          .filter(Boolean);

      const added = [];
      const missing = [];
      const already = [];

      lines.forEach(
        line => {
          const parts =
            line
              .split(
                /[\s,;]+/
              )
              .filter(Boolean);

          const id =
            String(
              parts[0] || ""
            ).trim();

          const quantity =
            String(
              parts[1] || ""
            ).trim();

          if (!id) return;

          const c =
            state.customers
              .find(
                x =>
                  String(x.id)
                    .trim()
                    .toLowerCase() ===
                  id.toLowerCase()
              );

          if (!c) {
            missing.push(id);
            return;
          }

          let t =
            todayItemByKey(
              c.key
            );

          if (t) {
            already.push(id);
          } else {
            t = {
              customerKey:
                c.key,
              quantity,
              done: false,
              order:
                state.today.length,
              timeRule:
                "none",
              timeStart: "",
              timeEnd: "",
              callBeforeMin: 0,
              deliveryNote: "",
              eta: null,
              etaExcluded: false,
              visitStartedAt: null
            };

            state.today.push(t);
            added.push(id);
          }

          if (
            quantity !== ""
          ) {
            t.quantity =
              quantity;
          }
        }
      );

      normalizeOrder();
      invalidateEtas();

      saveState();

      let msg =
        `${added.length} customers added in the order entered.`;

      if (already.length) {
        msg +=
          ` ${already.length} already in route.`;
      }

      if (missing.length) {
        msg +=
          ` ⚠️ Unknown IDs: ${missing.join(", ")}`;
      }

      el("routeBuildResult")
        .textContent =
          msg;

      el("optimizerStatus")
        .textContent =
          "Experienced-driver order preserved. Use Route map to inspect it, or Optimize only if you want a suggestion.";

      const details =
        el("buildRouteDetails");

      if (details) {
        details.open = false;
      }
    };


// ---------------------------------------------------
// API KEY
// ---------------------------------------------------

function loadApiKey() {
  const key =
    localStorage.getItem(
      API_KEY_STORAGE
    ) || "";

  el("apiKeyInput")
    .value =
      key;

  el("apiKeyStatus")
    .textContent =
      key
        ? "✓ API key saved on this device."
        : "No API key saved yet.";
}

el("saveApiKeyBtn")
  .onclick =
    () => {
      const key =
        el("apiKeyInput")
          .value
          .trim();

      if (!key) {
        return alert(
          "Paste your API key first."
        );
      }

      localStorage.setItem(
        API_KEY_STORAGE,
        key
      );

      el("apiKeyStatus")
        .textContent =
          "✓ API key saved on this device.";
    };

el("showApiKeyBtn")
  .onclick =
    () => {
      const input =
        el("apiKeyInput");

      input.type =
        input.type ===
        "password"
          ? "text"
          : "password";
    };


// ---------------------------------------------------
// TIME WINDOWS
// ---------------------------------------------------

function windowsFromCustomer(c) {
  const out = [];

  if (
    c.open1Start &&
    c.open1End
  ) {
    const a =
      todayAt(c.open1Start);

    const b =
      todayAt(c.open1End);

    if (
      a !== null &&
      b !== null &&
      b >= a
    ) {
      out.push([a, b]);
    }
  }

  if (
    c.open2Start &&
    c.open2End
  ) {
    const a =
      todayAt(c.open2Start);

    const b =
      todayAt(c.open2End);

    if (
      a !== null &&
      b !== null &&
      b >= a
    ) {
      out.push([a, b]);
    }
  }

  return out;
}

function windowsFromDelivery(t) {
  const dayStart =
    startOfToday();

  const dayEnd =
    endOfToday();

  if (
    t.timeRule === "window" &&
    t.timeStart &&
    t.timeEnd
  ) {
    const a =
      todayAt(t.timeStart);

    const b =
      todayAt(t.timeEnd);

    return (
      a !== null &&
      b !== null &&
      b >= a
    )
      ? [[a, b]]
      : [];
  }

  if (
    t.timeRule === "after" &&
    t.timeStart
  ) {
    const a =
      todayAt(t.timeStart);

    return (
      a !== null
    )
      ? [[a, dayEnd]]
      : [];
  }

  if (
    t.timeRule === "before" &&
    t.timeEnd
  ) {
    const b =
      todayAt(t.timeEnd);

    return (
      b !== null
    )
      ? [[dayStart, b]]
      : [];
  }

  return [];
}

function intersectWindows(a, b) {
  if (!a.length) return b;
  if (!b.length) return a;

  const out = [];

  for (const x of a) {
    for (const y of b) {
      const start =
        Math.max(
          x[0],
          y[0]
        );

      const end =
        Math.min(
          x[1],
          y[1]
        );

      if (start <= end) {
        out.push(
          [start, end]
        );
      }
    }
  }

  return out;
}

function allowedWindowsForStop(
  c,
  t
) {
  const shop =
    windowsFromCustomer(c);

  const delivery =
    windowsFromDelivery(t);

  const windows =
    intersectWindows(
      shop,
      delivery
    );

  if (
    (shop.length ||
      delivery.length) &&
    !windows.length
  ) {
    throw new Error(
      "No valid overlap between opening hours and delivery time for customer " +
      c.id +
      "."
    );
  }

  return windows;
}

function adjustArrivalToWindows(
  arrival,
  windows
) {
  if (!windows.length) {
    return {
      arrival,
      wait: 0
    };
  }

  for (const [start, end] of windows) {
    if (
      arrival >= start &&
      arrival <= end
    ) {
      return {
        arrival,
        wait: 0
      };
    }

    if (arrival < start) {
      return {
        arrival: start,
        wait:
          start - arrival
      };
    }
  }

  return null;
}


// ---------------------------------------------------
// CURRENT GPS
// ---------------------------------------------------

async function getCurrentPosition() {
  if (!navigator.geolocation) {
    throw new Error(
      "Current GPS is not available."
    );
  }

  const position =
    await new Promise(
      (resolve, reject) => {
        navigator.geolocation
          .getCurrentPosition(
            resolve,
            reject,
            {
              enableHighAccuracy:
                true,
              timeout: 15000,
              maximumAge: 0
            }
          );
      }
    );

  const lat =
    Number(
      position.coords.latitude
    );

  const lng =
    Number(
      position.coords.longitude
    );

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    (lat === 0 && lng === 0)
  ) {
    throw new Error(
      "Phone GPS returned an invalid position."
    );
  }

  return position;
}


// ---------------------------------------------------
// ETA + SUMMARY FROM THE SAME HGV MATRIX
// ---------------------------------------------------

function applyEtaAndSummaryFromMatrix(
  pending,
  matrixOrder,
  matrixResult
) {
  const durations =
    matrixResult?.durations;

  const distances =
    matrixResult?.distances;

  if (!durations) {
    throw new Error(
      "Δεν επιστράφηκαν χρόνοι διαδρομής."
    );
  }

  let clock =
    Math.floor(
      Date.now() / 1000
    );

  let previousMatrixIndex = 0;
  let totalDistanceMeters = 0;
  let totalWaitSeconds = 0;

  for (
    const matrixIndex of matrixOrder
  ) {
    const item =
      pending[
        matrixIndex - 1
      ];

    const customer =
      customerByKey(
        item.customerKey
      );

    const travelSeconds =
      Number(
        durations[
          previousMatrixIndex
        ]?.[matrixIndex]
      );

    if (
      !Number.isFinite(
        travelSeconds
      )
    ) {
      throw new Error(
        `Δεν βρέθηκε διαδρομή προς τον πελάτη ${customer?.id || ""}.`
      );
    }

    const legDistance =
      Number(
        distances?.[
          previousMatrixIndex
        ]?.[matrixIndex] || 0
      );

    if (
      Number.isFinite(
        legDistance
      )
    ) {
      totalDistanceMeters +=
        legDistance;
    }

    let arrival =
      clock +
      travelSeconds;

    const windows =
      allowedWindowsForStop(
        customer,
        item
      );

    const adjusted =
      adjustArrivalToWindows(
        arrival,
        windows
      );

    if (!adjusted) {
      throw new Error(
        `Η σειρά δεν προλαβαίνει το επιτρεπόμενο ωράριο του πελάτη ${customer?.id || ""}.`
      );
    }

    arrival =
      adjusted.arrival;

    totalWaitSeconds +=
      adjusted.wait;

    item.eta =
      arrival;

    clock =
      arrival +
      Math.max(
        0,
        Math.round(
          Number(
            customer?.serviceMin ??
            12
          ) * 60
        )
      );

    previousMatrixIndex =
      matrixIndex;
  }

  state.routeStats = {
    distanceMeters:
      totalDistanceMeters,

    fuelLiters:
      totalDistanceMeters > 0
        ? (
            totalDistanceMeters /
            1000
          ) * 0.25
        : 0,

    finishEpoch:
      clock
  };

  return {
    distanceMeters:
      totalDistanceMeters,
    finishEpoch:
      clock,
    totalWaitSeconds
  };
}


// ---------------------------------------------------
// ROAD-MATRIX OPTIMIZER
// Uses HGV road times and automatically calculates
// ETA, total distance and estimated fuel.
// ---------------------------------------------------

function routeTravelSeconds(order, matrix) {
  let total = 0;
  let fromIndex = 0;

  for (
    const customerIndex of order
  ) {
    const seconds =
      Number(
        matrix[fromIndex]
          ?.[customerIndex]
      );

    if (
      !Number.isFinite(
        seconds
      )
    ) {
      return Infinity;
    }

    total +=
      seconds;

    fromIndex =
      customerIndex;
  }

  return total;
}

function nearestNeighbourOrder(
  matrix,
  customerCount
) {
  const unvisited = [];

  for (
    let i = 1;
    i <= customerCount;
    i++
  ) {
    unvisited.push(i);
  }

  const order = [];
  let current = 0;

  while (
    unvisited.length
  ) {
    let bestPos = -1;
    let bestSeconds =
      Infinity;

    for (
      let p = 0;
      p < unvisited.length;
      p++
    ) {
      const candidate =
        unvisited[p];

      const seconds =
        Number(
          matrix[current]
            ?.[candidate]
        );

      if (
        Number.isFinite(
          seconds
        ) &&
        seconds <
          bestSeconds
      ) {
        bestSeconds =
          seconds;

        bestPos =
          p;
      }
    }

    if (
      bestPos < 0
    ) {
      throw new Error(
        "Δεν μπορούν να συνδεθούν όλες οι στάσεις."
      );
    }

    const next =
      unvisited.splice(
        bestPos,
        1
      )[0];

    order.push(next);
    current = next;
  }

  return order;
}

function twoOptOpenRoute(
  order,
  matrix
) {
  let best =
    [...order];

  let bestCost =
    routeTravelSeconds(
      best,
      matrix
    );

  let improved = true;
  let passes = 0;

  while (
    improved &&
    passes < 30
  ) {
    improved = false;
    passes++;

    for (
      let i = 0;
      i <
        best.length - 1;
      i++
    ) {
      for (
        let k = i + 1;
        k < best.length;
        k++
      ) {
        const candidate = [
          ...best.slice(
            0,
            i
          ),
          ...best.slice(
            i,
            k + 1
          ).reverse(),
          ...best.slice(
            k + 1
          )
        ];

        const cost =
          routeTravelSeconds(
            candidate,
            matrix
          );

        if (
          cost + 1 <
          bestCost
        ) {
          best =
            candidate;

          bestCost =
            cost;

          improved =
            true;
        }
      }
    }
  }

  return best;
}

function formatDurationSeconds(
  seconds
) {
  if (
    !Number.isFinite(
      seconds
    )
  ) {
    return "?";
  }

  const mins =
    Math.round(
      seconds / 60
    );

  const h =
    Math.floor(
      mins / 60
    );

  const m =
    mins % 60;

  if (!h) {
    return `${m} λ`;
  }

  return `${h}ω ${m}λ`;
}

async function fetchHgvMatrix(
  position,
  pending
) {
  const key =
    localStorage.getItem(
      API_KEY_STORAGE
    );

  if (!key) {
    throw new Error(
      "Αποθήκευσε πρώτα το κλειδί API."
    );
  }

  const locations = [
    [
      Number(
        position.coords
          .longitude
      ),
      Number(
        position.coords
          .latitude
      )
    ],

    ...pending.map(
      item => {
        const c =
          customerByKey(
            item.customerKey
          );

        return [
          Number(c.lng),
          Number(c.lat)
        ];
      }
    )
  ];

  const response =
    await fetch(
      ORS_MATRIX_URL,
      {
        method:
          "POST",

        headers: {
          Authorization:
            key,

          "Content-Type":
            "application/json",

          Accept:
            "application/json"
        },

        body:
          JSON.stringify({
            locations,

            metrics: [
              "duration",
              "distance"
            ]
          })
      }
    );

  const result =
    await response.json();

  if (
    !response.ok
  ) {
    throw new Error(
      result?.error?.message ||
      result?.error ||
      result?.message ||
      `Matrix API ${response.status}`
    );
  }

  if (
    !result.durations
  ) {
    throw new Error(
      "Δεν επιστράφηκε πίνακας χρόνων."
    );
  }

  return result;
}

async function optimizeRealRoute() {
  const pending =
    [...state.today]
      .sort(
        (a, b) =>
          a.order - b.order
      )
      .filter(
        x => !x.done
      );

  if (
    pending.length < 2
  ) {
    return alert(
      "Χρειάζονται τουλάχιστον 2 στάσεις."
    );
  }

  const stillMissing = await ensureApproximateGpsForStops(
    pending,
    "Χρησιμοποιώ τις διευθύνσεις ως πρώτη εκτίμηση GPS"
  );

  const unresolvedKeys = new Set(
    stillMissing.map(item => item.customerKey)
  );

  const excludedKeys = new Set(
    pending.filter(item => item.etaExcluded).map(item => item.customerKey)
  );

  const routablePending = pending.filter(
    item => !unresolvedKeys.has(item.customerKey) && !item.etaExcluded
  );

  stillMissing.forEach(item => { item.eta = null; });
  pending.filter(item => item.etaExcluded).forEach(item => { item.eta = null; });

  if (routablePending.length < 2) {
    return alert(
      "Δεν υπάρχουν αρκετές στάσεις με γνωστή θέση για βελτιστοποίηση.\n\n" +
      (stillMissing.length
        ? "Δεν εντοπίστηκαν: " + missingLocationSummary(stillMissing)
        : "")
    );
  }

  const button =
    el("optimizeBtn");

  button.disabled =
    true;

  button.textContent =
    "Υπολογισμός…";

  el("optimizerStatus")
    .textContent =
      "Υπολογίζω χρόνους δρόμου για το φορτηγό…";

  try {
    const position =
      await getCurrentPosition();

    const matrixResult =
      await fetchHgvMatrix(
        position,
        routablePending
      );

    const matrix =
      matrixResult.durations;

    const currentOrder =
      routablePending.map(
        (_, index) =>
          index + 1
      );

    const currentSeconds =
      routeTravelSeconds(
        currentOrder,
        matrix
      );

    let suggested =
      nearestNeighbourOrder(
        matrix,
        routablePending.length
      );

    suggested =
      twoOptOpenRoute(
        suggested,
        matrix
      );

    const suggestedSeconds =
      routeTravelSeconds(
        suggested,
        matrix
      );

    if (
      !Number.isFinite(
        suggestedSeconds
      )
    ) {
      throw new Error(
        "Δεν δημιουργήθηκε πλήρης διαδρομή."
      );
    }

    const sameOrder =
      suggested.every(
        (matrixIndex, i) =>
          matrixIndex ===
          currentOrder[i]
      );

    let finalMatrixOrder =
      currentOrder;

    let appliedSuggestion =
      false;

    const suggestionIsBetter =
      !sameOrder &&
      !(
        Number.isFinite(
          currentSeconds
        ) &&
        suggestedSeconds >=
          currentSeconds - 1
      );

    if (
      suggestionIsBetter
    ) {
      const savedSeconds =
        Number.isFinite(
          currentSeconds
        )
          ? currentSeconds -
            suggestedSeconds
          : 0;

      const message =
        "Σύγκριση διαδρομής:\n\n" +
        "Τωρινή σειρά: " +
        formatDurationSeconds(
          currentSeconds
        ) +
        "\nΠρόταση: " +
        formatDurationSeconds(
          suggestedSeconds
        ) +
        "\nΚέρδος οδήγησης: " +
        formatDurationSeconds(
          Math.max(
            0,
            savedSeconds
          )
        ) +
        "\n\nΝα εφαρμοστεί η πρόταση;";

      if (
        confirm(message)
      ) {
        const suggestedItems =
          suggested.map(
            matrixIndex =>
              routablePending[
                matrixIndex - 1
              ]
          );

        const done =
          [...state.today]
            .filter(
              x => x.done
            )
            .sort(
              (a, b) =>
                a.order - b.order
            );

        let suggestedPos = 0;
        const mergedPending = pending.map(item => {
          if (unresolvedKeys.has(item.customerKey) || excludedKeys.has(item.customerKey)) {
            return item;
          }
          return suggestedItems[suggestedPos++];
        });

        state.today = [
          ...done,
          ...mergedPending
        ];

        normalizeOrder();

        finalMatrixOrder =
          suggested;

        appliedSuggestion =
          true;
      }
    }

    /*
      Automatic ETA + summary.
      No second API request.
    */
    const summary =
      applyEtaAndSummaryFromMatrix(
        routablePending,
        finalMatrixOrder,
        matrixResult
      );

    saveState();

    const km =
      summary.distanceMeters /
      1000;

    const finish =
      hhmmFromEpoch(
        summary.finishEpoch
      );

    const unresolvedNote = stillMissing.length
      ? ` • ⚠ ${stillMissing.length} χωρίς GPS`
      : "";
    const excludedNote = excludedKeys.size
      ? ` • 🚫 ${excludedKeys.size} εκτός ETA`
      : "";

    el("optimizerStatus")
      .textContent =
        (appliedSuggestion
          ? `✓ Βελτιστοποιήθηκε • ${km.toFixed(1)} km • τέλος περίπου ${finish}`
          : `✓ Η σειρά διατηρήθηκε • ${km.toFixed(1)} km • τέλος περίπου ${finish}`) +
        unresolvedNote + excludedNote;

    if (
      routeMapDialog.open
    ) {
      await drawNumberedMap(
        position
      );
    }

  } catch (error) {
    console.error(
      error
    );

    el("optimizerStatus")
      .textContent =
        "⚠ Αποτυχία: " +
        error.message;

    alert(
      "Αποτυχία:\n\n" +
      error.message
    );
  } finally {
    button.disabled =
      false;

    button.textContent =
      "✨ Βελτιστοποίηση";
  }
}

el("optimizeBtn")
  .onclick =
    optimizeRealRoute;


// ---------------------------------------------------
// DIRECTIONS FOR EXACT CURRENT ORDER
// Used for numbered road map and ETA recalculation.
// This does NOT reorder stops.
// ---------------------------------------------------

async function fetchDirectionsForCurrentOrder(
  position
) {
  const key =
    localStorage.getItem(
      API_KEY_STORAGE
    );

  if (!key) {
    throw new Error(
      "Save your openrouteservice API key first."
    );
  }

  const allPending =
    [...state.today]
      .sort((a, b) => a.order - b.order)
      .filter(x => !x.done);

  if (!allPending.length) {
    throw new Error("There are no remaining stops.");
  }

  await ensureApproximateGpsForStops(
    allPending,
    "Εντοπίζω διευθύνσεις για τον χάρτη"
  );

  const pending = allPending.filter(item => {
    const c = customerByKey(item.customerKey);
    return !item.etaExcluded && coordsValid(c);
  });

  if (!pending.length) {
    throw new Error("Δεν υπάρχουν στάσεις διαθέσιμες για τη γραμμή δρόμου.");
  }

  const coordinates = [
    [
      Number(
        position.coords.longitude
      ),
      Number(
        position.coords.latitude
      )
    ],

    ...pending.map(
      item => {
        const c =
          customerByKey(
            item.customerKey
          );

        return [
          Number(c.lng),
          Number(c.lat)
        ];
      }
    )
  ];

  const response =
    await fetch(
      ORS_DIRECTIONS_URL,
      {
        method: "POST",
        headers: {
          Authorization:
            key,
          "Content-Type":
            "application/json",
          Accept:
            "application/json"
        },
        body:
          JSON.stringify({
            coordinates,
            instructions:
              false,
            options: {
              vehicle_type:
                "delivery"
            }
          })
      }
    );

  const result =
    await response.json();

  if (!response.ok) {
    throw new Error(
      result?.error?.message ||
      result?.error ||
      result?.message ||
      `Directions API error ${response.status}`
    );
  }

  const feature =
    result?.features?.[0];

  if (!feature) {
    throw new Error(
      "Directions returned no route."
    );
  }

  return {
    feature,
    pending
  };
}


// ---------------------------------------------------
// ETA FOR THE CURRENT MANUAL ORDER
// Uses the same HGV matrix and does not reorder.
// ---------------------------------------------------

async function recalculateEtaForCurrentOrder() {
  const button =
    el("recalcEtaBtn");

  button.disabled =
    true;

  button.textContent =
    "Υπολογισμός…";

  el("optimizerStatus")
    .textContent =
      "Υπολογίζω ETA για την τρέχουσα σειρά…";

  try {
    const pending =
      [...state.today]
        .sort(
          (a, b) =>
            a.order - b.order
        )
        .filter(
          x => !x.done
        );

    if (
      !pending.length
    ) {
      throw new Error(
        "Δεν υπάρχουν στάσεις."
      );
    }

    const stillMissing = await ensureApproximateGpsForStops(
      pending,
      "Χρησιμοποιώ τις διευθύνσεις για ETA"
    );

    const unresolvedKeys = new Set(
      stillMissing.map(item => item.customerKey)
    );

    const excludedItems = pending.filter(item => item.etaExcluded);

    const routablePending = pending.filter(
      item => !unresolvedKeys.has(item.customerKey) && !item.etaExcluded
    );

    stillMissing.forEach(item => { item.eta = null; });
    excludedItems.forEach(item => { item.eta = null; });

    if (!routablePending.length) {
      throw new Error(
        "Δεν υπάρχει καμία στάση με γνωστή θέση για υπολογισμό ETA."
      );
    }

    const position =
      await getCurrentPosition();

    const matrixResult =
      await fetchHgvMatrix(
        position,
        routablePending
      );

    const currentOrder =
      routablePending.map(
        (_, index) =>
          index + 1
      );

    const summary =
      applyEtaAndSummaryFromMatrix(
        routablePending,
        currentOrder,
        matrixResult
      );

    saveState();

    const km =
      summary.distanceMeters /
      1000;

    const unresolvedNote = stillMissing.length
      ? ` • ⚠ ${stillMissing.length} χωρίς GPS (${missingLocationSummary(stillMissing)})`
      : "";
    const excludedNote = excludedItems.length
      ? ` • 🚫 ${excludedItems.length} εκτός ETA`
      : "";

    el("optimizerStatus")
      .textContent =
        `✓ ETA ενημερώθηκε για ${routablePending.length}/${pending.length} στάσεις • ${km.toFixed(1)} km • τέλος περίπου ${hhmmFromEpoch(summary.finishEpoch)}` +
        unresolvedNote + excludedNote;

  } catch (error) {
    console.error(
      error
    );

    el("optimizerStatus")
      .textContent =
        "⚠ Αποτυχία ETA: " +
        error.message;

    alert(
      "Αποτυχία ETA:\n\n" +
      error.message
    );
  } finally {
    button.disabled =
      false;

    button.textContent =
      "⏱ ETA";
  }
}

el("recalcEtaBtn")
  .onclick =
    recalculateEtaForCurrentOrder;


// ---------------------------------------------------
// NUMBERED MAP
// ---------------------------------------------------

function ensureLeafletMap() {
  if (
    typeof L === "undefined"
  ) {
    throw new Error(
      "Map library did not load. Check internet connection."
    );
  }

  if (!routeMap) {
    routeMap =
      L.map(
        "routeMap",
        {
          zoomControl:
            true
        }
      );

    L.tileLayer(
      "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        maxZoom: 19,
        attribution:
          "&copy; OpenStreetMap contributors"
      }
    ).addTo(routeMap);
  }

  if (routeMapLayer) {
    routeMapLayer.clearLayers();
  } else {
    routeMapLayer =
      L.layerGroup()
        .addTo(routeMap);
  }

  setTimeout(
    () =>
      routeMap.invalidateSize(),
    50
  );
}

function numberedIcon(number, status = "normal") {
  return L.divIcon({
    className:
      `number-marker ${status}`,
    html:
      `<div>${number}</div>`,
    iconSize:
      [34, 34],
    iconAnchor:
      [17, 17]
  });
}

async function drawNumberedMap(
  knownPosition = null
) {
  ensureLeafletMap();

  const ordered =
    [...state.today]
      .sort(
        (a, b) =>
          a.order - b.order
      )
      .filter(
        item =>
          !item.done &&
          coordsValid(
            customerByKey(
              item.customerKey
            )
          )
      );

  if (!ordered.length) {
    throw new Error(
      "No remaining stops with GPS."
    );
  }

  refreshSuspiciousGpsFlags(ordered);
  const latLngs = [];

  ordered.forEach(
    (item, index) => {
      const c =
        customerByKey(
          item.customerKey
        );

      const latlng = [
        Number(c.lat),
        Number(c.lng)
      ];

      latLngs.push(
        latlng
      );

      const marker =
        L.marker(
          latlng,
          {
            icon:
              numberedIcon(
                index + 1,
                item.etaExcluded ? "eta-excluded" : (c.gpsSuspicious ? "suspicious" : (c.locationSource === "verified" ? "verified" : "approximate"))
              )
          }
        );

      const gpsLabel = c.locationSource === "verified"
        ? "🟢 Επιβεβαιωμένο GPS"
        : (c.gpsSuspicious ? "⚠ Ύποπτο κατά προσέγγιση GPS" : "🟡 Κατά προσέγγιση GPS");
      const etaLabel = item.etaExcluded ? "🚫 Εκτός ETA" : (item.eta ? `ETA ~${escapeHtml(hhmmFromEpoch(item.eta))}` : "Χωρίς ETA ακόμη");

      marker.bindPopup(
        `<b>${index + 1}. ${escapeHtml(displayName(c))}</b><br>` +
        `${escapeHtml(c.deliveryAddress || c.address || "")}<br>` +
        `${escapeHtml(gpsLabel)}<br>${etaLabel}<br>` +
        `<button class="map-eta-toggle" onclick="toggleEtaExcludedFromMap(decodeURIComponent('${encodeURIComponent(c.key)}'))">${item.etaExcluded ? "↩ Συμπερίληψη στο ETA" : "🚫 Εξαίρεση από ETA"}</button>`
      );

      marker.addTo(
        routeMapLayer
      );
    }
  );

  // Always show the simple sequence immediately.
  L.polyline(
    latLngs,
    {
      weight: 3,
      opacity: .45,
      dashArray: "7 8"
    }
  ).addTo(
    routeMapLayer
  );

  const bounds =
    L.latLngBounds(
      latLngs
    );

  routeMap.fitBounds(
    bounds.pad(.15)
  );

  el("routeMapStatus")
    .textContent =
      `${ordered.length} στάσεις • πάτησε marker για Ένταξη/Εξαίρεση ETA`;

  // If key + current GPS are available, draw the actual road path too.
  try {
    const key =
      localStorage.getItem(
        API_KEY_STORAGE
      );

    if (!key) {
      return;
    }

    const position =
      knownPosition ||
      await getCurrentPosition();

    const {
      feature
    } =
      await fetchDirectionsForCurrentOrder(
        position
      );

    const roadLayer =
      L.geoJSON(
        feature,
        {
          style: {
            weight: 5,
            opacity: .75
          }
        }
      );

    roadLayer.addTo(
      routeMapLayer
    );

    const combinedBounds = bounds.extend(roadLayer.getBounds());
    routeMap.fitBounds(combinedBounds.pad(.08));

    el("routeMapStatus")
      .textContent =
        `${ordered.length} στάσεις • γραμμή δρόμου χωρίς τις στάσεις που έχεις εξαιρέσει από ETA`;

  } catch (error) {
    console.warn(
      "Road line unavailable:",
      error
    );

    el("routeMapStatus")
      .textContent =
        `${ordered.length} στάσεις • εμφανίζεται η σειρά, η γραμμή δρόμου δεν είναι διαθέσιμη`;
  }
}

el("showRouteMapBtn")
  .onclick =
    async () => {
      routeMapDialog.showModal();

      el("routeMapStatus")
        .textContent =
          "Loading numbered route…";

      try {
        await drawNumberedMap();
      } catch (error) {
        el("routeMapStatus")
          .textContent =
            "⚠ " +
            error.message;
      }
    };

el("closeRouteMapBtn")
  .onclick =
    () =>
      routeMapDialog.close();


// ---------------------------------------------------
// VISIT TIMER / AUTO ARRIVAL
// Auto-start is intentionally conservative: verified GPS only, current stop only,
// near the point for 90 seconds while essentially stopped.
// ---------------------------------------------------

function startArrivalWatcher() {
  if (arrivalWatchId !== null || !navigator.geolocation) return;

  arrivalWatchId = navigator.geolocation.watchPosition(
    pos => {
      const item = currentUndone();
      if (!item || item.visitStartedAt) {
        arrivalCandidate = null;
        return;
      }

      const c = customerByKey(item.customerKey);
      if (!c || c.locationSource !== "verified" || !coordsValid(c)) {
        arrivalCandidate = null;
        return;
      }

      const distanceKm = haversineKm(pos.coords.latitude, pos.coords.longitude, c.lat, c.lng);
      const speed = Number(pos.coords.speed);
      const movingFast = Number.isFinite(speed) && speed > 3; // about 11 km/h

      if (distanceKm <= 0.08 && !movingFast) {
        const now = Date.now();
        if (!arrivalCandidate || arrivalCandidate.key !== item.customerKey) {
          arrivalCandidate = { key: item.customerKey, since: now };
        } else if (now - arrivalCandidate.since >= 90000) {
          startVisitTimer(item.customerKey, "auto-arrival");
          arrivalCandidate = null;
        }
      } else {
        arrivalCandidate = null;
      }
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 }
  );
}

// ---------------------------------------------------
// MAIN BUTTONS
// ---------------------------------------------------

el("findLocationBtn")
  .onclick =
    findAddressLocation;

el("checkMapBtn")
  .onclick =
    checkEnteredLocation;

el("newCustomerBtn")
  .onclick =
    () =>
      openCustomerDialog();

el("searchInput")
  .oninput =
    renderCustomers;

el("completeCurrentBtn")
  .onclick =
    () => {
      const cur =
        currentUndone();

      if (!cur) {
        return alert(
          "No remaining stop."
        );
      }

      markDone(
        cur.customerKey
      );
    };

el("resetTodayBtn")
  .onclick =
    () => {
      if (
        !confirm(
          "Clear today's route? Customer database will stay untouched."
        )
      ) {
        return;
      }

      state.today = [];
      saveState();

      el("optimizerStatus")
        .textContent =
          "Current order is preserved until you choose Optimize.";
    };



// ---------------------------------------------------
// DAILY CUSTOMER MERGE
// Adds/updates customers by Customer ID.
// NEVER overwrites verified GPS or personal notes.
// Does NOT change today's route.
// ---------------------------------------------------

function normalizedCustomerId(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizedLocationAddress(value) {
  return String(value || "")
    .replace(/[\u00A0\s]+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .trim()
    .toUpperCase();
}

function customerLocationAddress(c) {
  return String(
    c?.deliveryAddress ||
    c?.address ||
    c?.taxAddress ||
    ""
  ).trim();
}

function sameCustomerLocation(existing, incoming) {
  const sameId =
    normalizedCustomerId(existing?.id) ===
    normalizedCustomerId(incoming?.id);

  if (!sameId) return false;

  const oldAddress = normalizedLocationAddress(
    customerLocationAddress(existing)
  );
  const newAddress = normalizedLocationAddress(
    customerLocationAddress(incoming)
  );

  // If both rows have an address, ID + address identifies one delivery location.
  if (oldAddress && newAddress) {
    return oldAddress === newAddress;
  }

  // For old/partial records with no address, fall back to Customer ID.
  return !oldAddress || !newAddress;
}

function splitAddressLocations(address, city = "") {
  const raw = String(address || "").trim();
  const cleanCity = String(city || "").trim();

  if (!raw) return [cleanCity].filter(Boolean);

  const parts = raw
    .split("|")
    .map(x => x.trim())
    .filter(Boolean);

  const locations = parts.length ? parts : [raw];

  return locations.map(part => {
    if (!cleanCity) return part;
    const upperPart = part.toUpperCase();
    const upperCity = cleanCity.toUpperCase();
    if (upperPart.includes(upperCity)) return part;
    return `${part}, ${cleanCity}`;
  });
}

function mergeOneCustomer(incoming) {
  const incomingId =
    normalizedCustomerId(
      incoming?.id
    );

  if (!incomingId) {
    return { action: "skipped" };
  }

  const existing =
    state.customers.find(
      c => sameCustomerLocation(c, incoming)
    );

  if (!existing) {
    const fresh = {
      key:
        incoming.key ||
        (
          crypto.randomUUID
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random()}`
        ),

      id: String(incoming.id || "").trim(),
      name: String(incoming.name || "").trim(),
      taxAddress: String(incoming.taxAddress || "").trim(),
      deliveryAddress: String(
        incoming.deliveryAddress ||
        incoming.address ||
        ""
      ).trim(),
      address: String(
        incoming.deliveryAddress ||
        incoming.address ||
        incoming.taxAddress ||
        ""
      ).trim(),
      phone1: String(incoming.phone1 || "").trim(),
      phone2: String(incoming.phone2 || "").trim(),
      lat: null,
      lng: null,
      locationSource: null,
      serviceMin: Number(incoming.serviceMin || 12),
      open1Start: "",
      open1End: "",
      open2Start: "",
      open2End: "",
      companyNotes: "",
      myNotes: ""
    };

    state.customers.push(fresh);
    return { action: "added" };
  }

  // Refresh normal company/contact fields, but never erase useful saved values.
  const textFields = [
    "name",
    "taxAddress",
    "deliveryAddress",
    "address",
    "phone1",
    "phone2"
  ];

  for (const field of textFields) {
    const value = String(incoming?.[field] || "").trim();
    if (value) existing[field] = value;
  }

  // Protected: key, GPS, locationSource, personal notes, service/opening settings.
  return { action: "updated" };
}

// One Customer ID may have many delivery locations. Old records that contain
// "address 1 | address 2" are converted into separate location records once.
function migrateCombinedLocations() {
  const additions = [];
  let changed = false;

  for (const c of state.customers) {
    const current = customerLocationAddress(c);
    if (!current.includes("|")) continue;

    const parts = current
      .split("|")
      .map(x => x.trim())
      .filter(Boolean);

    if (parts.length < 2) continue;

    // Preserve this record's key/GPS on the first location.
    c.deliveryAddress = parts[0];
    c.address = parts[0];
    changed = true;

    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      const duplicate = state.customers.some(other =>
        other !== c &&
        normalizedCustomerId(other.id) === normalizedCustomerId(c.id) &&
        normalizedLocationAddress(customerLocationAddress(other)) === normalizedLocationAddress(part)
      ) || additions.some(other =>
        normalizedCustomerId(other.id) === normalizedCustomerId(c.id) &&
        normalizedLocationAddress(customerLocationAddress(other)) === normalizedLocationAddress(part)
      );

      if (duplicate) continue;

      additions.push({
        ...c,
        key: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
        deliveryAddress: part,
        address: part,
        lat: null,
        lng: null,
        locationSource: null,
        myNotes: ""
      });
    }
  }

  if (additions.length) {
    state.customers.push(...additions);
    changed = true;
  }

  if (changed) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
}

el("mergeCustomersInput")
  .onchange = async e => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      let customers = [];
      const lowerName = String(file.name || "").toLowerCase();

      if (lowerName.endsWith(".csv")) {
        // Google Sheets CSV is UTF-8. This parser also handles quoted commas,
        // quoted line breaks, BOM, and semicolon/tab-delimited exports.
        const text = (await file.text()).replace(/^\uFEFF/, "");

        function parseDelimited(input, delimiter) {
          const rows = [];
          let row = [];
          let field = "";
          let quoted = false;

          for (let i = 0; i < input.length; i++) {
            const ch = input[i];

            if (quoted) {
              if (ch === '"') {
                if (input[i + 1] === '"') {
                  field += '"';
                  i++;
                } else {
                  quoted = false;
                }
              } else {
                field += ch;
              }
              continue;
            }

            if (ch === '"') {
              quoted = true;
            } else if (ch === delimiter) {
              row.push(field);
              field = "";
            } else if (ch === "\n") {
              row.push(field.replace(/\r$/, ""));
              rows.push(row);
              row = [];
              field = "";
            } else {
              field += ch;
            }
          }

          row.push(field.replace(/\r$/, ""));
          if (row.length > 1 || row[0] !== "") rows.push(row);
          return rows;
        }

        function delimiterScore(line, delimiter) {
          let count = 0;
          let quoted = false;
          for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') {
              if (quoted && line[i + 1] === '"') i++;
              else quoted = !quoted;
            } else if (!quoted && ch === delimiter) {
              count++;
            }
          }
          return count;
        }

        const firstPhysicalLine = text.split(/\r?\n/, 1)[0] || "";
        const delimiters = [",", ";", "\t"];
        const delimiter = delimiters
          .map(d => [d, delimiterScore(firstPhysicalLine, d)])
          .sort((a, b) => b[1] - a[1])[0][0];

        const rows = parseDelimited(text, delimiter)
          .filter(row => row.some(v => String(v ?? "").trim() !== ""));

        if (!rows.length) {
          throw new Error("Το CSV είναι κενό.");
        }

        const normalizeHeader = value => String(value ?? "")
          .replace(/^\uFEFF/, "")
          .replace(/[\u00A0\s]+/g, " ")
          .trim()
          .toLowerCase();

        const headerAliases = {
          id: ["customer id", "customerid", "id", "κωδικός πελάτη", "κωδικος πελατη"],
          name: ["name", "όνομα", "ονομα", "όνομα / επωνυμία", "ονομα / επωνυμια", "επωνυμία", "επωνυμια"],
          phone1: ["phone 1", "phone1", "τηλέφωνο 1", "τηλεφωνο 1"],
          phone2: ["phone 2", "phone2", "τηλέφωνο 2", "τηλεφωνο 2"],
          address: ["address", "διεύθυνση", "διευθυνση"],
          city: ["city", "πόλη", "πολη"]
        };

        let headerRow = -1;
        let col = {};
        for (let r = 0; r < Math.min(rows.length, 20); r++) {
          const vals = rows[r].map(normalizeHeader);
          const candidate = {};
          for (const [key, aliases] of Object.entries(headerAliases)) {
            candidate[key] = vals.findIndex(v => aliases.includes(v));
          }
          if (candidate.id >= 0) {
            headerRow = r;
            col = candidate;
            break;
          }
        }

        // Some Google Sheets exports can arrive without the header row.
        // Our customer master has a fixed 7-column order, so if the first
        // rows already look like customer records, import them positionally:
        // Customer ID, Name, Phone 1, Phone 2, Address, City, Notes.
        if (headerRow < 0) {
          const looksLikeCustomerId = value => {
            const v = String(value ?? "").trim();
            return /^(?:R?W?[A-Z]?\d{4,}|S\d{6,}|\d{4,})$/i.test(v);
          };
          const sample = rows.slice(0, Math.min(rows.length, 5));
          const looksHeaderless = sample.length > 0 &&
            sample.filter(r => r.length >= 6 && looksLikeCustomerId(r[0])).length >= Math.min(2, sample.length);

          if (looksHeaderless) {
            headerRow = -1;
            col = { id: 0, name: 1, phone1: 2, phone2: 3, address: 4, city: 5 };
          } else {
            const preview = rows.slice(0, 3).map(r => r.join(" | ")).join(" / ");
            throw new Error(`Δεν βρέθηκε στήλη "Customer ID" στο CSV. Πρώτες γραμμές: ${preview}`);
          }
        }

        const cell = (row, idx) => idx >= 0 ? String(row[idx] ?? "").trim() : "";
        for (let r = headerRow + 1; r < rows.length; r++) {
          const row = rows[r];
          const id = cell(row, col.id);
          if (!id) continue;

          const addressOnly = cell(row, col.address);
          const city = cell(row, col.city);
          const locations = splitAddressLocations(addressOnly, city);

          for (const fullAddress of (locations.length ? locations : [""])) {
            customers.push({
              id,
              name: cell(row, col.name),
              phone1: cell(row, col.phone1).replace(/\.0$/, ""),
              phone2: cell(row, col.phone2).replace(/\.0$/, ""),
              address: fullAddress,
              taxAddress: fullAddress,
              deliveryAddress: fullAddress
            });
          }
        }

        if (!customers.length) {
          throw new Error("Βρέθηκε το Customer ID, αλλά δεν βρέθηκαν πελάτες στο CSV.");
        }
      } else if (lowerName.endsWith(".xlsx")) {
        if (typeof JSZip === "undefined") {
          throw new Error("Δεν φορτώθηκε ο αναγνώστης XLSX. Έλεγξε τη σύνδεση και ξαναδοκίμασε.");
        }

        const buffer = await file.arrayBuffer();
        const zip = await JSZip.loadAsync(buffer);

        // Read the workbook package directly. This avoids SheetJS compatibility
        // problems with XLSX files produced by different generators.
        const workbookFile = zip.file("xl/workbook.xml");
        const relsFile = zip.file("xl/_rels/workbook.xml.rels");
        if (!workbookFile || !relsFile) {
          throw new Error("Το αρχείο δεν είναι έγκυρο XLSX.");
        }

        const workbookXml = await workbookFile.async("text");
        const relsXml = await relsFile.async("text");

        const decodeXml = value => {
          const ta = document.createElement("textarea");
          ta.innerHTML = String(value ?? "");
          return ta.value;
        };

        // Locate the Customers sheet and its relationship id.
        const sheetTagRe = /<(?:[A-Za-z0-9_]+:)?sheet\b[^>]*>/gi;
        const sheetTags = workbookXml.match(sheetTagRe) || [];
        let chosenSheetTag = sheetTags.find(tag => /\bname=["']Customers["']/i.test(tag)) || sheetTags[0] || "";
        if (!chosenSheetTag) throw new Error("Το Excel δεν περιέχει φύλλο δεδομένων.");

        const nameMatch = chosenSheetTag.match(/\bname=["']([^"']+)["']/i);
        const sheetName = decodeXml(nameMatch?.[1] || "Customers");
        const ridMatch = chosenSheetTag.match(/(?:\br:id|\bid)=["']([^"']+)["']/i);
        const relId = ridMatch?.[1] || "";
        if (!relId) throw new Error(`Δεν βρέθηκε σύνδεση για το φύλλο ${sheetName}.`);

        const relTagRe = /<(?:[A-Za-z0-9_]+:)?Relationship\b[^>]*>/gi;
        const relTags = relsXml.match(relTagRe) || [];
        const relTag = relTags.find(tag => new RegExp(`\\bId=["']${relId.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}["']`, "i").test(tag));
        const targetMatch = relTag?.match(/\bTarget=["']([^"']+)["']/i);
        let target = targetMatch?.[1] || "";
        if (!target) throw new Error(`Δεν βρέθηκε το αρχείο του φύλλου ${sheetName}.`);
        target = target.replace(/^\//, "");
        if (!target.startsWith("xl/")) target = "xl/" + target.replace(/^\.\//, "");

        const sheetFile = zip.file(target);
        if (!sheetFile) throw new Error(`Δεν ανοίγει το φύλλο ${sheetName} (${target}).`);
        const sheetXml = await sheetFile.async("text");

        // Shared strings are optional. Read them when present.
        const shared = [];
        const ssFile = zip.file("xl/sharedStrings.xml");
        if (ssFile) {
          const ssXml = await ssFile.async("text");
          const siRe = /<(?:[A-Za-z0-9_]+:)?si\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?si>/gi;
          let sm;
          while ((sm = siRe.exec(ssXml))) {
            const parts = [];
            const tRe = /<(?:[A-Za-z0-9_]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?t>/gi;
            let tm;
            while ((tm = tRe.exec(sm[1]))) parts.push(decodeXml(tm[1]));
            shared.push(parts.join(""));
          }
        }

        const colIndex = letters => {
          let n = 0;
          for (const ch of letters.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
          return n - 1;
        };

        const grid = [];
        const rowRe = /<(?:[A-Za-z0-9_]+:)?row\b([^>]*)>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?row>/gi;
        let rm;
        let sequentialRow = 0;
        while ((rm = rowRe.exec(sheetXml))) {
          const rAttr = rm[1].match(/\br=["'](\d+)["']/i);
          const rr = rAttr ? Math.max(0, Number(rAttr[1]) - 1) : sequentialRow;
          sequentialRow = rr + 1;
          if (!grid[rr]) grid[rr] = [];

          const cellRe = /<(?:[A-Za-z0-9_]+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?c>)/gi;
          let cm;
          let seqCol = 0;
          while ((cm = cellRe.exec(rm[2]))) {
            const attrs = cm[1] || "";
            const body = cm[2] || "";
            const refMatch = attrs.match(/\br=["']([A-Z]+)(\d+)["']/i);
            const cc = refMatch ? colIndex(refMatch[1]) : seqCol;
            seqCol = cc + 1;
            const typeMatch = attrs.match(/\bt=["']([^"']+)["']/i);
            const type = typeMatch?.[1] || "";

            let value = "";
            if (type === "inlineStr") {
              const texts = [];
              const tRe = /<(?:[A-Za-z0-9_]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?t>/gi;
              let tm;
              while ((tm = tRe.exec(body))) texts.push(decodeXml(tm[1]));
              value = texts.join("");
            } else {
              const vm = body.match(/<(?:[A-Za-z0-9_]+:)?v\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?v>/i);
              value = vm ? decodeXml(vm[1]) : "";
              if (type === "s" && value !== "") value = shared[Number(value)] ?? value;
            }
            grid[rr][cc] = value;
          }
        }

        const norm = v => String(v ?? "")
          .replace(/^\uFEFF/, "")
          .replace(/[\u00A0\s]+/g, " ")
          .trim()
          .toLowerCase();
        const aliases = {
          id: ["customer id", "customerid", "id", "κωδικός πελάτη", "κωδικος πελατη"],
          name: ["name", "όνομα", "ονομα", "όνομα / επωνυμία", "ονομα / επωνυμια", "επωνυμία", "επωνυμια"],
          phone1: ["phone 1", "phone1", "τηλέφωνο 1", "τηλεφωνο 1"],
          phone2: ["phone 2", "phone2", "τηλέφωνο 2", "τηλεφωνο 2"],
          address: ["address", "διεύθυνση", "διευθυνση"],
          city: ["city", "πόλη", "πολη"]
        };

        let headerRow = -1;
        let col = {};
        for (let r = 0; r < Math.min(grid.length, 30); r++) {
          const vals = (grid[r] || []).map(norm);
          const candidate = {};
          for (const [key, list] of Object.entries(aliases)) {
            candidate[key] = vals.findIndex(v => list.includes(v));
          }
          if (candidate.id >= 0) {
            headerRow = r;
            col = candidate;
            break;
          }
        }

        if (headerRow < 0) {
          const firstRows = grid.slice(0, 3).map(r => (r || []).join(" | ")).join(" / ");
          throw new Error(`Δεν βρέθηκε "Customer ID" στο φύλλο ${sheetName}. Πρώτες γραμμές: ${firstRows || "(κενές)"}`);
        }

        const valueAt = (row, idx) => idx >= 0 ? String(row[idx] ?? "").trim() : "";
        for (let r = headerRow + 1; r < grid.length; r++) {
          const row = grid[r] || [];
          const id = valueAt(row, col.id);
          if (!id) continue;
          const addressOnly = valueAt(row, col.address);
          const city = valueAt(row, col.city);
          const locations = splitAddressLocations(addressOnly, city);
          for (const fullAddress of (locations.length ? locations : [""])) {
            customers.push({
              id,
              name: valueAt(row, col.name),
              phone1: valueAt(row, col.phone1).replace(/\.0$/, ""),
              phone2: valueAt(row, col.phone2).replace(/\.0$/, ""),
              address: fullAddress,
              taxAddress: fullAddress,
              deliveryAddress: fullAddress
            });
          }
        }

        if (!customers.length) {
          throw new Error(`Βρέθηκε το φύλλο ${sheetName}, αλλά δεν βρέθηκαν πελάτες κάτω από το Customer ID.`);
        }
      } else if (lowerName.endsWith(".xls")) {
        throw new Error("Το παλιό .xls δεν υποστηρίζεται. Χρησιμοποίησε CSV από Google Sheets ή .xlsx.");
      } else {
        const imported = JSON.parse(await file.text());
        customers = Array.isArray(imported) ? imported : imported?.customers;
      }

      if (!Array.isArray(customers)) throw new Error("Το αρχείο δεν περιέχει λίστα πελατών.");

      let added = 0, updated = 0, skipped = 0;
      for (const incoming of customers) {
        const result = mergeOneCustomer(incoming);
        if (result.action === "added") added++;
        else if (result.action === "updated") updated++;
        else skipped++;
      }
      saveState();
      const message = `✓ Διαβάστηκαν ${customers.length} πελάτες • ${added} νέοι • ${updated} υπάρχοντες` +
        (skipped ? ` • ${skipped} παραλείφθηκαν` : "");
      el("mergeCustomersStatus").textContent = message;
      alert(message);
    } catch (error) {
      console.error(error);
      const message = "Αποτυχία συγχώνευσης: " + error.message;
      el("mergeCustomersStatus").textContent = "⚠ " + message;
      alert(message);
    }
    e.target.value = "";
  };


// ---------------------------------------------------
// BACKUP
// ---------------------------------------------------

el("exportBtn")
  .onclick =
    () => {
      const blob =
        new Blob(
          [
            JSON.stringify(
              state,
              null,
              2
            )
          ],
          {
            type:
              "application/json"
          }
        );

      const a =
        document.createElement(
          "a"
        );

      a.href =
        URL.createObjectURL(
          blob
        );

      a.download =
        `delivery-helper-backup-${new Date().toISOString().slice(0,10)}.json`;

      a.click();

      URL.revokeObjectURL(
        a.href
      );
    };

el("importInput")
  .onchange =
    async e => {
      const file =
        e.target
          .files?.[0];

      if (!file) return;

      try {
        const imported =
          JSON.parse(
            await file.text()
          );

        if (
          !imported.customers ||
          !imported.today
        ) {
          throw new Error(
            "Invalid backup file"
          );
        }

        state =
          imported;

        normalizeOrder();
        saveState();

      } catch (error) {
        alert(
          "Import failed: " +
          error.message
        );
      }

      e.target.value = "";
    };


// ---------------------------------------------------
// INSTALL / PWA
// ---------------------------------------------------

// ---------------------------------------------------
// FIREBASE AUTH + MANUAL CLOUD SYNC TEST
// ---------------------------------------------------
let firebaseAuth = null;
let firebaseDb = null;
let firebaseUser = null;

function cloudSetStatus(message) {
  const node = el("cloudStatus");
  if (node) node.textContent = message;
}

function renderFirebaseUser(user) {
  firebaseUser = user || null;
  const userNode = el("firebaseUser");
  const signInBtn = el("googleSignInBtn");
  const signOutBtn = el("googleSignOutBtn");
  const controls = el("cloudSyncControls");
  if (!userNode || !signInBtn || !signOutBtn || !controls) return;

  if (user) {
    userNode.textContent = `✓ ${user.displayName || "Google"} — ${user.email || ""}`;
    signInBtn.classList.add("hidden");
    signOutBtn.classList.remove("hidden");
    controls.classList.remove("hidden");
  } else {
    userNode.textContent = "Δεν έχεις συνδεθεί.";
    signInBtn.classList.remove("hidden");
    signOutBtn.classList.add("hidden");
    controls.classList.add("hidden");
  }
}

function cloudDocRef() {
  if (!firebaseDb || !firebaseUser) return null;
  return firebaseDb
    .collection(CLOUD_DOC_COLLECTION)
    .doc(firebaseUser.uid)
    .collection("snapshots")
    .doc(CLOUD_DOC_ID);
}

async function initFirebaseSync() {
  if (typeof firebase === "undefined") {
    cloudSetStatus("⚠ Δεν φορτώθηκε το Firebase SDK. Έλεγξε τη σύνδεση internet.");
    return;
  }

  try {
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    firebaseAuth = firebase.auth();
    firebaseDb = firebase.firestore();

    firebaseAuth.onAuthStateChanged(user => {
      renderFirebaseUser(user);
      cloudSetStatus(user
        ? "Firebase: συνδεδεμένο. Έτοιμο για δοκιμή Cloud Sync."
        : "Firebase: αναμονή σύνδεσης.");
    });

    el("googleSignInBtn").onclick = async () => {
      try {
        cloudSetStatus("Σύνδεση με Google…");
        const provider = new firebase.auth.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" });
        await firebaseAuth.signInWithPopup(provider);
      } catch (error) {
        console.error(error);
        cloudSetStatus("⚠ Google login: " + (error.message || error.code || error));
      }
    };

    el("googleSignOutBtn").onclick = async () => {
      try {
        await firebaseAuth.signOut();
      } catch (error) {
        cloudSetStatus("⚠ Αποσύνδεση: " + (error.message || error));
      }
    };

    el("cloudUploadBtn").onclick = async () => {
      const ref = cloudDocRef();
      if (!ref) return cloudSetStatus("⚠ Συνδέσου πρώτα με Google.");
      try {
        cloudSetStatus("☁️ Αποστολή δεδομένων στο Firebase…");
        await ref.set({
          state: JSON.parse(JSON.stringify(state)),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAtClient: new Date().toISOString(),
          appVersion: 25
        });
        cloudSetStatus(`✓ Cloud upload OK • ${state.customers.length} πελάτες • ${state.today.length} σημερινές στάσεις`);
      } catch (error) {
        console.error(error);
        cloudSetStatus("⚠ Cloud upload: " + (error.message || error.code || error));
      }
    };

    el("cloudDownloadBtn").onclick = async () => {
      const ref = cloudDocRef();
      if (!ref) return cloudSetStatus("⚠ Συνδέσου πρώτα με Google.");
      try {
        cloudSetStatus("☁️ Έλεγχος Cloud…");
        const snap = await ref.get();
        if (!snap.exists) return cloudSetStatus("Δεν υπάρχει ακόμη Cloud backup. Κάνε πρώτα Αποστολή στο Cloud.");
        const cloudState = snap.data()?.state;
        if (!cloudState || !Array.isArray(cloudState.customers) || !Array.isArray(cloudState.today)) {
          throw new Error("Το Cloud snapshot δεν έχει έγκυρη μορφή Delivery Helper.");
        }
        const stamp = snap.data()?.updatedAtClient || "άγνωστη ώρα";
        const ok = confirm(
          `Βρέθηκε Cloud snapshot (${stamp}) με ${cloudState.customers.length} πελάτες.\n\n` +
          "Να ΑΝΤΙΚΑΤΑΣΤΑΘΟΥΝ τα τοπικά δεδομένα αυτής της συσκευής;"
        );
        if (!ok) return cloudSetStatus("Η λήψη ακυρώθηκε. Δεν άλλαξε τίποτα.");

        state = cloudState;
        if (!state.routeStats) state.routeStats = null;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        migrateCombinedLocations();
        normalizeOrder();
        render();
        cloudSetStatus(`✓ Cloud download OK • ${state.customers.length} πελάτες • ${state.today.length} σημερινές στάσεις`);
      } catch (error) {
        console.error(error);
        cloudSetStatus("⚠ Cloud download: " + (error.message || error.code || error));
      }
    };
  } catch (error) {
    console.error(error);
    cloudSetStatus("⚠ Firebase init: " + (error.message || error));
  }
}

window.addEventListener(
  "beforeinstallprompt",
  e => {
    e.preventDefault();

    deferredPrompt =
      e;

    el("installBtn")
      .classList
      .remove(
        "hidden"
      );
  }
);

el("installBtn")
  .onclick =
    async () => {
      if (!deferredPrompt) {
        return;
      }

      deferredPrompt.prompt();

      await deferredPrompt
        .userChoice;

      deferredPrompt = null;

      el("installBtn")
        .classList
        .add(
          "hidden"
        );
    };

if (
  "serviceWorker" in
  navigator
) {
  navigator.serviceWorker
    .register(
      "./sw.js?v=25"
    )
    .then(registration => {
      registration.update();
    })
    .catch(
      console.error
    );
}


// ---------------------------------------------------
// DRIVE SUMMARY + REAL-CLOCK REMINDER
// ---------------------------------------------------
function formatRemaining(seconds) {
  const minutes = Math.max(0, Math.round(Number(seconds || 0) / 60));
  if (minutes < 60) return `${minutes} λ`;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return m ? `${h}ω ${m}λ` : `${h}ω`;
}
function renderDriveSummary() {
  const stats = state.routeStats;
  if (!stats || !stats.finishEpoch) {
    el("summaryTime").textContent = "—";
    el("summaryDistance").textContent = "—";
    el("summaryFuel").textContent = "—";
    return;
  }
  const now = Date.now() / 1000;
  el("summaryTime").textContent = "~" + formatRemaining(stats.finishEpoch - now);
  el("summaryDistance").textContent = "~" + (Number(stats.distanceMeters || 0) / 1000).toFixed(1) + " km";
  el("summaryFuel").textContent = "~" + Number(stats.fuelLiters || 0).toFixed(1) + " L";
}
function renderNextReminder() {
  const now = Date.now() / 1000;
  const upcoming = [];
  [...state.today].sort((a,b)=>a.order-b.order).filter(item => !item.done && item.eta && Number(item.callBeforeMin || 0) > 0).forEach(item => {
    const customer = customerByKey(item.customerKey);
    if (!customer) return;
    upcoming.push({ item, customer, callAt: Number(item.eta) - Number(item.callBeforeMin) * 60 });
  });
  if (!upcoming.length) {
    el("nextReminderCard").classList.remove("due");
    el("nextReminderText").textContent = "Δεν υπάρχει προγραμματισμένη υπενθύμιση";
    el("nextReminderSub").textContent = "Εμφανίζεται όταν υπάρχει ETA και οδηγία κλήσης πριν την άφιξη.";
    return;
  }
  upcoming.sort((a,b)=>a.callAt-b.callAt);
  let next = upcoming.find(x => x.callAt >= now) || upcoming.find(x => Number(x.item.eta) >= now);
  if (!next) return;
  const dueNow = now >= next.callAt && now < Number(next.item.eta);
  el("nextReminderCard").classList.toggle("due", dueNow);
  if (dueNow) {
    el("nextReminderText").textContent = `📞 ΚΑΛΕΣΕ ΤΩΡΑ — ${displayName(next.customer)}`;
    el("nextReminderSub").textContent = `ETA ~${hhmmFromEpoch(next.item.eta)}`;
  } else {
    el("nextReminderText").textContent = `📞 Κλήση ${next.item.callBeforeMin} λ πριν — ${displayName(next.customer)}`;
    el("nextReminderSub").textContent = `στις ${hhmmFromEpoch(next.callAt)} • σε ${formatRemaining(next.callAt-now)}`;
  }
}
function renderDriveExtras() { renderDriveSummary(); renderNextReminder(); }
setInterval(renderDriveExtras, 30000);

// ---------------------------------------------------
// START
// ---------------------------------------------------

initFirebaseSync();
loadApiKey();
migrateCombinedLocations();
normalizeOrder();
render();
startArrivalWatcher();

showPage(
  sessionStorage.getItem(
    "delivery-helper-page"
  ) || "drive"
);
