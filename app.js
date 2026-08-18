
const STORAGE_KEY = "delivery-helper-v1";

let state = loadState();
let deferredPrompt = null;

const el = id => document.getElementById(id);
const dialog = el("customerDialog");
const form = el("customerForm");

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {
    customers: [
      {
        key: crypto.randomUUID(),
        id: "DEMO-101",
        name: "Demo customer",
        address: "Kalamata",
        phone1: "",
        phone2: "",
        lat: 37.0389,
        lng: 22.1142,
        serviceMin: 7,
        companyNotes: "Example only",
        myNotes: "Replace with a real customer later."
      }
    ],
    today: []
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  render();
}

function cleanPhone(p) {
  return String(p || "").replace(/[^\d+]/g, "");
}

function customerByKey(key) {
  return state.customers.find(c => c.key === key);
}

function todayItemByKey(key) {
  return state.today.find(x => x.customerKey === key);
}

function displayName(c) {
  return [c.id, c.name].filter(Boolean).join(" — ");
}

function coordsValid(c) {
  return Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lng));
}

function distanceKm(a, b) {
  const R = 6371;
  const rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lng - a.lng);
  const lat1 = rad(a.lat), lat2 = rad(b.lat);
  const h = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function openCall(phone) {
  const p = cleanPhone(phone);
  if (!p) return alert("No phone number saved.");
  location.href = `tel:${p}`;
}

function navigate(c) {
  let q = "";
  if (coordsValid(c)) q = `${c.lat},${c.lng}`;
  else if (c.address) q = encodeURIComponent(c.address);
  else return alert("No GPS coordinates or address saved.");
  location.href = `https://www.google.com/maps/dir/?api=1&destination=${q}`;
}

function addToToday(c) {
  if (!state.today.some(x => x.customerKey === c.key)) {
    state.today.push({
      customerKey: c.key,
      quantity: "",
      done: false,
      order: state.today.length
    });
    saveState();
  }
}

function removeFromToday(key) {
  state.today = state.today.filter(x => x.customerKey !== key);
  state.today.forEach((x, i) => x.order = i);
  saveState();
}

function markDone(key) {
  const t = todayItemByKey(key);
  if (!t) return;
  t.done = true;
  saveState();
}

function currentUndone() {
  return [...state.today]
    .sort((a,b) => a.order-b.order)
    .find(x => !x.done);
}

function render() {
  renderSummary();
  renderCarousel();
  renderToday();
  renderCustomers();
}

function renderSummary() {
  const total = state.today.length;
  const done = state.today.filter(x => x.done).length;
  el("routeSummary").textContent = `${total} stops today • ${done} delivered • ${Math.max(total-done,0)} remaining`;
}

function makeCard(t, idx, currentKey) {
  const c = customerByKey(t.customerKey);
  const node = el("cardTemplate").content.firstElementChild.cloneNode(true);
  if (!c) return node;
  if (c.key === currentKey) node.classList.add("current");
  node.querySelector(".stop-number").textContent = `STOP ${idx+1}`;
  node.querySelector(".stop-title").textContent = displayName(c);
  const parts = [];
  if (t.quantity) parts.push(`${t.quantity} units`);
  if (c.address) parts.push(c.address);
  if (coordsValid(c)) parts.push("GPS saved");
  node.querySelector(".stop-meta").textContent = parts.join(" • ");
  node.querySelector(".stop-notes").textContent = [c.companyNotes, c.myNotes].filter(Boolean).join("\n");
  const b1 = node.querySelector(".call1");
  const b2 = node.querySelector(".call2");
  b1.onclick = () => openCall(c.phone1);
  b2.onclick = () => openCall(c.phone2);
  if (!c.phone1) b1.disabled = true;
  if (!c.phone2) b2.disabled = true;
  node.querySelector(".nav").onclick = () => navigate(c);
  node.querySelector(".done").onclick = () => markDone(c.key);
  return node;
}

function renderCarousel() {
  const box = el("carousel");
  box.innerHTML = "";
  const items = [...state.today].sort((a,b)=>a.order-b.order).filter(x => !x.done);
  el("emptyRoute").style.display = items.length ? "none" : "block";
  const nextFive = items.slice(0,5);
  const currentKey = nextFive[0]?.customerKey;
  nextFive.forEach((t, i) => box.appendChild(makeCard(t, i, currentKey)));
}

function renderToday() {
  const box = el("todayList");
  box.innerHTML = "";
  const items = [...state.today].sort((a,b)=>a.order-b.order);
  if (!items.length) {
    box.innerHTML = `<div class="subtle">No stops in today's route.</div>`;
    return;
  }
  items.forEach((t, i) => {
    const c = customerByKey(t.customerKey);
    if (!c) return;
    const row = document.createElement("div");
    row.className = "row" + (t.done ? " done" : "");
    row.innerHTML = `
      <div class="row-main">
        <div class="row-title">${i+1}. ${escapeHtml(displayName(c))}</div>
        <div class="row-sub">${escapeHtml([t.quantity ? t.quantity+" units" : "", c.address || ""].filter(Boolean).join(" • "))}</div>
      </div>
      <div class="row-actions">
        <button data-act="call">📞</button>
        <button data-act="nav">🧭</button>
        <button data-act="done">${t.done ? "↩ Undo" : "✓ Done"}</button>
        <button data-act="remove">Remove</button>
      </div>`;
    row.querySelector('[data-act="call"]').onclick = () => openCall(c.phone1);
    row.querySelector('[data-act="nav"]').onclick = () => navigate(c);
    row.querySelector('[data-act="done"]').onclick = () => { t.done = !t.done; saveState(); };
    row.querySelector('[data-act="remove"]').onclick = () => removeFromToday(c.key);
    box.appendChild(row);
  });
}

function renderCustomers() {
  const q = el("searchInput").value.trim().toLowerCase();
  const box = el("customerList");
  box.innerHTML = "";
  const list = state.customers.filter(c => {
    const hay = [c.id,c.name,c.address,c.phone1,c.phone2,c.companyNotes,c.myNotes].join(" ").toLowerCase();
    return hay.includes(q);
  }).sort((a,b) => String(a.id).localeCompare(String(b.id)));
  list.forEach(c => {
    const inToday = state.today.some(x => x.customerKey === c.key);
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `
      <div class="row-main">
        <div class="row-title">${escapeHtml(displayName(c))}</div>
        <div class="row-sub">${escapeHtml([c.address || "", coordsValid(c) ? "📍 GPS" : "", c.phone1 || ""].filter(Boolean).join(" • "))}</div>
      </div>
      <div class="row-actions">
        <button data-act="edit">Edit</button>
        <button data-act="today">${inToday ? "In today ✓" : "+ Today"}</button>
      </div>`;
    row.querySelector('[data-act="edit"]').onclick = () => openCustomerDialog(c);
    row.querySelector('[data-act="today"]').onclick = () => {
      if (inToday) removeFromToday(c.key); else addToToday(c);
    };
    box.appendChild(row);
  });
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[ch]));
}

function openCustomerDialog(c=null) {
  form.reset();
  el("serviceMin").value = 7;
  el("quantity").value = "";
  if (c) {
    el("dialogTitle").textContent = "Edit customer";
    el("editKey").value = c.key;
    el("customerId").value = c.id || "";
    el("customerName").value = c.name || "";
    el("customerAddress").value = c.address || "";
    el("phone1").value = c.phone1 || "";
    el("phone2").value = c.phone2 || "";
    el("lat").value = c.lat ?? "";
    el("lng").value = c.lng ?? "";
    el("serviceMin").value = c.serviceMin ?? 7;
    el("companyNotes").value = c.companyNotes || "";
    el("myNotes").value = c.myNotes || "";
    const t = todayItemByKey(c.key);
    el("quantity").value = t?.quantity ?? "";
  } else {
    el("dialogTitle").textContent = "New customer";
    el("editKey").value = "";
  }
  dialog.showModal();
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const key = el("editKey").value || crypto.randomUUID();
  const existing = customerByKey(key);
  const obj = {
    key,
    id: el("customerId").value.trim(),
    name: el("customerName").value.trim(),
    address: el("customerAddress").value.trim(),
    phone1: el("phone1").value.trim(),
    phone2: el("phone2").value.trim(),
    lat: el("lat").value === "" ? null : Number(el("lat").value),
    lng: el("lng").value === "" ? null : Number(el("lng").value),
    serviceMin: Number(el("serviceMin").value || 0),
    companyNotes: el("companyNotes").value.trim(),
    myNotes: el("myNotes").value.trim()
  };
  if (existing) Object.assign(existing, obj); else state.customers.push(obj);

  const qty = el("quantity").value;
  if (qty !== "") {
    if (!todayItemByKey(key)) addToToday(obj);
    const t = todayItemByKey(key);
    if (t) t.quantity = qty;
  }
  dialog.close();
  saveState();
});

el("saveGpsBtn").onclick = () => {
  if (!navigator.geolocation) return alert("GPS is not available in this browser.");
  el("saveGpsBtn").textContent = "Getting GPS…";
  navigator.geolocation.getCurrentPosition(
    pos => {
      el("lat").value = pos.coords.latitude.toFixed(6);
      el("lng").value = pos.coords.longitude.toFixed(6);
      el("saveGpsBtn").textContent = "📍 GPS saved";
    },
    err => {
      alert("Could not get GPS: " + err.message);
      el("saveGpsBtn").textContent = "📍 Save current GPS";
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
};

el("newCustomerBtn").onclick = () => openCustomerDialog();
el("searchInput").oninput = renderCustomers;

el("completeCurrentBtn").onclick = () => {
  const cur = currentUndone();
  if (!cur) return alert("No remaining stop.");
  markDone(cur.customerKey);
};

el("resetTodayBtn").onclick = () => {
  if (!confirm("Clear today's route? Customer database will stay untouched.")) return;
  state.today = [];
  saveState();
};

el("optimizeBtn").onclick = () => {
  const pending = [...state.today].filter(x => !x.done);
  if (pending.length < 2) return;
  const usable = pending.filter(t => coordsValid(customerByKey(t.customerKey)));
  if (usable.length < 2) return alert("At least two remaining customers need saved GPS coordinates.");

  const done = [...state.today].filter(x => x.done).sort((a,b)=>a.order-b.order);
  let pool = usable.map(t => ({t, c: customerByKey(t.customerKey)}));

  let start = pool[0];
  const current = currentUndone();
  if (current && coordsValid(customerByKey(current.customerKey))) {
    start = pool.find(x => x.t.customerKey === current.customerKey) || start;
  }

  const ordered = [start];
  pool = pool.filter(x => x !== start);

  while (pool.length) {
    const last = ordered[ordered.length-1].c;
    let bestIdx = 0, bestDist = Infinity;
    pool.forEach((x, i) => {
      const d = distanceKm({lat:Number(last.lat),lng:Number(last.lng)}, {lat:Number(x.c.lat),lng:Number(x.c.lng)});
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    });
    ordered.push(pool.splice(bestIdx,1)[0]);
  }

  const noGps = pending.filter(t => !coordsValid(customerByKey(t.customerKey)));
  const seq = [...done, ...ordered.map(x=>x.t), ...noGps];
  seq.forEach((x,i)=>x.order=i);
  state.today = seq;
  saveState();
  alert("Route reordered using a simple nearest-neighbour GPS estimate. Use this as a starting point, not truck-grade routing.");
};

el("exportBtn").onclick = () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `delivery-helper-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};

el("importInput").onchange = async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const imported = JSON.parse(await file.text());
    if (!imported.customers || !imported.today) throw new Error("Invalid backup file");
    state = imported;
    saveState();
  } catch (err) {
    alert("Import failed: " + err.message);
  }
  e.target.value = "";
};

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  el("installBtn").classList.remove("hidden");
});
el("installBtn").onclick = async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  el("installBtn").classList.add("hidden");
};

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(()=>{});
}

render();
