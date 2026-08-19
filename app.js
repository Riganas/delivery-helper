const STORAGE_KEY = "delivery-helper-v1";
const API_KEY_STORAGE = "delivery-helper-ors-key";

const ORS_OPTIMIZATION_URL = "https://api.heigit.org/vroom/v0";
const ORS_DIRECTIONS_URL =
  "https://api.heigit.org/openrouteservice/v2/directions/driving-car/geojson";

let state = loadState();
let deferredPrompt = null;
let editingDeliveryKey = null;
let routeMap = null;
let routeMapLayer = null;

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

  if (coordsValid(c)) {
    destination =
      `${c.lat},${c.lng}`;
  } else if (
    c.deliveryAddress ||
    c.address
  ) {
    destination =
      c.deliveryAddress ||
      c.address;
  } else {
    return alert(
      "No GPS coordinates or delivery address saved."
    );
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
    eta: null
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

function markDone(key) {
  const item =
    todayItemByKey(key);

  if (!item) return;

  item.done = true;
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
  state.today.forEach(
    item => item.eta = null
  );

  if (message) {
    el("optimizerStatus")
      .textContent = message;
  }
}

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

function render() {
  renderSummary();
  renderCarousel();
  renderToday();
  renderCustomers();
}

function renderSummary() {
  const total =
    state.today.length;

  const done =
    state.today.filter(
      x => x.done
    ).length;

  el("routeSummary")
    .textContent =
      `${total} stops today • ${done} delivered • ${Math.max(total - done, 0)} remaining`;
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
    `STOP ${idx + 1}`;

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

  if (
    c.locationSource ===
    "verified"
  ) {
    parts.push(
      "🟢 Verified GPS"
    );
  } else if (
    coordsValid(c)
  ) {
    parts.push(
      "🟡 Approximate GPS"
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

  const nextFive =
    items.slice(0, 5);

  const currentKey =
    nextFive[0]
      ?.customerKey;

  nextFive.forEach(
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
          "🟢 Verified GPS";
      } else if (
        coordsValid(c)
      ) {
        gps =
          "🟡 Approximate GPS";
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
          <button data-act="details">Schedule</button>
          <button data-act="call">📞</button>
          <button data-act="nav">🧭</button>
          <button data-act="done">${t.done ? "↩ Undo" : "✓ Done"}</button>
          <button data-act="remove">Remove</button>
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

      row.querySelector(
        '[data-act="done"]'
      ).onclick =
        () => {
          t.done =
            !t.done;
          saveState();
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

      let gps = "";

      if (
        c.locationSource ===
        "verified"
      ) {
        gps =
          "🟢 Verified";
      } else if (
        coordsValid(c)
      ) {
        gps =
          "🟡 Approximate";
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
              eta: null
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
          "Experienced-driver order preserved. Use Numbered map to inspect it, or Optimize only if you want a suggestion.";
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
// REAL ROUTE OPTIMIZATION (OPTIONAL SUGGESTION)
// ---------------------------------------------------

async function optimizeRealRoute() {
  const key =
    localStorage.getItem(
      API_KEY_STORAGE
    );

  if (!key) {
    return alert(
      "Save your openrouteservice API key first."
    );
  }

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
      "You need at least 2 remaining stops."
    );
  }

  const missingGps =
    pending.filter(
      t =>
        !coordsValid(
          customerByKey(
            t.customerKey
          )
        )
    );

  if (
    missingGps.length
  ) {
    return alert(
      "These customers have no GPS location:\n\n" +
      missingGps
        .map(
          t =>
            customerByKey(
              t.customerKey
            )?.id
        )
        .filter(Boolean)
        .join(", ")
    );
  }

  const button =
    el("optimizeBtn");

  button.disabled = true;
  button.textContent =
    "Getting truck GPS…";

  el("optimizerStatus")
    .textContent =
      "Getting your current position…";

  try {
    const position =
      await getCurrentPosition();

    const start = [
      position.coords.longitude,
      position.coords.latitude
    ];

    button.textContent =
      "Optimizing roads…";

    el("optimizerStatus")
      .textContent =
        "Calculating a suggested road order…";

    const jobToKey =
      new Map();

    const jobs =
      pending.map(
        (item, index) => {
          const c =
            customerByKey(
              item.customerKey
            );

          const jobId =
            index + 1;

          jobToKey.set(
            jobId,
            item.customerKey
          );

          const job = {
            id: jobId,

            description:
              displayName(c),

            location: [
              Number(c.lng),
              Number(c.lat)
            ],

            service:
              Math.max(
                0,
                Math.round(
                  Number(
                    c.serviceMin ??
                    12
                  ) * 60
                )
              )
          };

          const windows =
            allowedWindowsForStop(
              c,
              item
            );

          if (
            windows.length
          ) {
            job.time_windows =
              windows;
          }

          return job;
        }
      );

    const requestBody = {
      jobs,

      vehicles: [
        {
          id: 1,
          profile:
            "driving-car",
          start
        }
      ]
    };

    const response =
      await fetch(
        ORS_OPTIMIZATION_URL,
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
            JSON.stringify(
              requestBody
            )
        }
      );

    const result =
      await response.json();

    if (!response.ok) {
      throw new Error(
        result?.error ||
        result?.message ||
        `API error ${response.status}`
      );
    }

    if (
      !result.routes ||
      !result.routes.length
    ) {
      throw new Error(
        "Optimizer returned no route."
      );
    }

    if (
      result.unassigned?.length
    ) {
      const failed =
        result.unassigned
          .map(
            x =>
              customerByKey(
                jobToKey.get(x.id)
              )?.id ||
              x.id
          );

      throw new Error(
        "These deliveries could not be assigned: " +
        failed.join(", ")
      );
    }

    const route =
      result.routes[0];

    const orderedKeys =
      route.steps
        .filter(
          step =>
            step.type === "job"
        )
        .map(
          step =>
            jobToKey.get(
              step.job ??
              step.id
            )
        )
        .filter(Boolean);

    if (
      orderedKeys.length !==
      pending.length
    ) {
      throw new Error(
        "Not every customer was assigned by the optimizer."
      );
    }

    const done =
      [...state.today]
        .filter(
          x => x.done
        )
        .sort(
          (a, b) =>
            a.order - b.order
        );

    const optimized =
      orderedKeys.map(
        key =>
          state.today.find(
            item =>
              item.customerKey ===
              key &&
              !item.done
          )
      );

    state.today = [
      ...done,
      ...optimized
    ];

    normalizeOrder();

    invalidateEtas();
    saveState();

    el("optimizerStatus")
      .textContent =
        "✓ Suggested order applied. Inspect the Numbered map and use ↑ ↓ for any practical correction, then Recalculate ETA.";

    if (
      routeMapDialog.open
    ) {
      await drawNumberedMap(
        position
      );
    }

  } catch (error) {
    console.error(error);

    el("optimizerStatus")
      .textContent =
        "⚠ Optimization failed: " +
        error.message;

    alert(
      "Optimization failed:\n\n" +
      error.message
    );
  } finally {
    button.disabled = false;
    button.textContent =
      "✨ Suggest optimized order";
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

  const pending =
    [...state.today]
      .sort(
        (a, b) =>
          a.order - b.order
      )
      .filter(
        x => !x.done
      );

  if (!pending.length) {
    throw new Error(
      "There are no remaining stops."
    );
  }

  const missingGps =
    pending.filter(
      item =>
        !coordsValid(
          customerByKey(
            item.customerKey
          )
        )
    );

  if (missingGps.length) {
    throw new Error(
      "Missing GPS for: " +
      missingGps
        .map(
          item =>
            customerByKey(
              item.customerKey
            )?.id
        )
        .filter(Boolean)
        .join(", ")
    );
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
              false
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
// ETA FOR THE FINAL MANUAL ORDER
// ---------------------------------------------------

async function recalculateEtaForCurrentOrder() {
  const button =
    el("recalcEtaBtn");

  button.disabled = true;
  button.textContent =
    "Calculating…";

  el("optimizerStatus")
    .textContent =
      "Calculating ETA for the exact current order…";

  try {
    const position =
      await getCurrentPosition();

    const {
      feature,
      pending
    } =
      await fetchDirectionsForCurrentOrder(
        position
      );

    const segments =
      feature?.properties?.segments ||
      [];

    if (
      segments.length !==
      pending.length
    ) {
      throw new Error(
        "The route response did not contain one road segment per stop."
      );
    }

    let clock =
      Math.floor(
        Date.now() / 1000
      );

    let totalWait = 0;

    for (
      let i = 0;
      i < pending.length;
      i++
    ) {
      const item =
        pending[i];

      const c =
        customerByKey(
          item.customerKey
        );

      const travelSeconds =
        Number(
          segments[i]?.duration ||
          0
        );

      let arrival =
        clock +
        travelSeconds;

      const windows =
        allowedWindowsForStop(
          c,
          item
        );

      const adjusted =
        adjustArrivalToWindows(
          arrival,
          windows
        );

      if (!adjusted) {
        throw new Error(
          "Current manual order misses the allowed time for customer " +
          c.id +
          "."
        );
      }

      arrival =
        adjusted.arrival;

      totalWait +=
        adjusted.wait;

      item.eta =
        arrival;

      clock =
        arrival +
        Math.max(
          0,
          Math.round(
            Number(
              c.serviceMin ??
              12
            ) * 60
          )
        );
    }

    saveState();

    const last =
      pending.at(-1);

    const km =
      Number(
        feature?.properties?.summary?.distance ||
        0
      ) / 1000;

    el("optimizerStatus")
      .textContent =
        `✓ ETA recalculated for this exact order • ${km.toFixed(1)} km • last ETA ~${hhmmFromEpoch(last?.eta)}${totalWait ? ` • waiting ${Math.round(totalWait / 60)} min for time windows` : ""}`;

  } catch (error) {
    console.error(error);

    el("optimizerStatus")
      .textContent =
        "⚠ ETA calculation failed: " +
        error.message;

    alert(
      "ETA calculation failed:\n\n" +
      error.message
    );
  } finally {
    button.disabled = false;
    button.textContent =
      "⏱ Recalculate ETA";
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

function numberedIcon(number) {
  return L.divIcon({
    className:
      "number-marker",
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
                index + 1
              )
          }
        );

      marker.bindPopup(
        `<b>${index + 1}. ${escapeHtml(displayName(c))}</b><br>` +
        `${escapeHtml(item.quantity ? item.quantity + " units" : "")}` +
        `${item.eta ? `<br>ETA ~${escapeHtml(hhmmFromEpoch(item.eta))}` : ""}`
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
      `${ordered.length} numbered stops • exact current order`;

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

    routeMap.fitBounds(
      roadLayer
        .getBounds()
        .pad(.08)
    );

    el("routeMapStatus")
      .textContent =
        `${ordered.length} numbered stops • actual road path for the current order`;

  } catch (error) {
    console.warn(
      "Road line unavailable:",
      error
    );

    el("routeMapStatus")
      .textContent =
        `${ordered.length} numbered stops • sequence shown; road line unavailable`;
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
      "./sw.js"
    )
    .catch(
      console.error
    );
}


// ---------------------------------------------------
// START
// ---------------------------------------------------

loadApiKey();
normalizeOrder();
render();
