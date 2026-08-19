const STORAGE_KEY = "delivery-helper-v1";
const API_KEY_STORAGE = "delivery-helper-ors-key";

const ORS_OPTIMIZATION_URL =
  "https://api.heigit.org/vroom/v0";


let state = loadState();

let deferredPrompt = null;


const el =
  id => document.getElementById(id);


const dialog =
  el("customerDialog");


const form =
  el("customerForm");



// ----------------------------------------------------
// DATA
// ----------------------------------------------------

function loadState() {

  try {

    const raw =
      localStorage.getItem(
        STORAGE_KEY
      );


    if (raw) {

      return JSON.parse(raw);

    }

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

  return [
    c.id,
    c.name
  ]
    .filter(Boolean)
    .join(" — ");

}



function coordsValid(c) {

  return (
    Number.isFinite(Number(c?.lat)) &&
    Number.isFinite(Number(c?.lng))
  );

}



function escapeHtml(s) {

  return String(
    s ?? ""
  ).replace(
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



function cleanPhone(p) {

  return String(
    p || ""
  ).replace(
    /[^\d+]/g,
    ""
  );

}



// ----------------------------------------------------
// PHONE + NAVIGATION
// ----------------------------------------------------

function openCall(phone) {

  const p =
    cleanPhone(phone);


  if (!p) {

    alert(
      "No phone number saved."
    );

    return;

  }


  location.href =
    `tel:${p}`;

}



function navigate(c) {

  let destination = "";


  if (coordsValid(c)) {

    destination =
      `${c.lat},${c.lng}`;

  } else if (c.address) {

    destination =
      c.address;

  } else {

    alert(
      "No GPS coordinates or address saved."
    );

    return;

  }


  location.href =
    "https://www.google.com/maps/dir/?api=1&destination=" +
    encodeURIComponent(destination);

}



// ----------------------------------------------------
// TODAY ROUTE
// ----------------------------------------------------

function addToToday(c) {

  if (
    state.today.some(
      x =>
        x.customerKey === c.key
    )
  ) {

    return;

  }


  state.today.push({

    customerKey:
      c.key,

    quantity:
      "",

    done:
      false,

    order:
      state.today.length

  });


  saveState();

}



function removeFromToday(key) {

  state.today =
    state.today.filter(
      x =>
        x.customerKey !== key
    );


  state.today.forEach(
    (x, i) =>
      x.order = i
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

    .find(
      x => !x.done
    );

}



// ----------------------------------------------------
// RENDER
// ----------------------------------------------------

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



function makeCard(
  t,
  idx,
  currentKey
) {

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


  if (c.address) {

    parts.push(
      c.address
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
      c.companyNotes,
      c.myNotes
    ]
      .filter(Boolean)
      .join("\n");


  const call1 =
    node.querySelector(
      ".call1"
    );


  const call2 =
    node.querySelector(
      ".call2"
    );


  call1.onclick =
    () =>
      openCall(c.phone1);


  call2.onclick =
    () =>
      openCall(c.phone2);


  if (!c.phone1) {

    call1.disabled = true;

  }


  if (!c.phone2) {

    call2.disabled = true;

  }


  node.querySelector(
    ".nav"
  ).onclick =
    () =>
      navigate(c);


  node.querySelector(
    ".done"
  ).onclick =
    () =>
      markDone(c.key);


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
    items.slice(
      0,
      5
    );


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
        (t.done ? " done" : "");


      row.innerHTML = `

        <div class="row-main">

          <div class="row-title">

            ${i + 1}.
            ${escapeHtml(
              displayName(c)
            )}

          </div>

          <div class="row-sub">

            ${escapeHtml(
              [
                t.quantity
                  ? t.quantity + " units"
                  : "",

                c.address || "",

                gps
              ]
                .filter(Boolean)
                .join(" • ")
            )}

          </div>

        </div>


        <div class="row-actions">

          <button data-act="call">
            📞
          </button>

          <button data-act="nav">
            🧭
          </button>

          <button data-act="done">

            ${t.done
              ? "↩ Undo"
              : "✓ Done"}

          </button>

          <button data-act="remove">
            Remove
          </button>

        </div>
      `;


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

      .filter(c => {

        const hay =
          [
            c.id,
            c.name,
            c.address,
            c.phone1,
            c.phone2,
            c.companyNotes,
            c.myNotes
          ]
            .join(" ")
            .toLowerCase();


        return hay.includes(q);

      })

      .sort(
        (a, b) =>
          String(a.id)
            .localeCompare(
              String(b.id)
            )
      );


  list.forEach(c => {

    const inToday =
      state.today.some(
        x =>
          x.customerKey ===
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

          ${escapeHtml(
            displayName(c)
          )}

        </div>

        <div class="row-sub">

          ${escapeHtml(
            [
              c.address || "",
              gps,
              c.phone1 || ""
            ]
              .filter(Boolean)
              .join(" • ")
          )}

        </div>

      </div>


      <div class="row-actions">

        <button data-act="edit">
          Edit
        </button>

        <button data-act="today">

          ${inToday
            ? "In today ✓"
            : "+ Today"}

        </button>

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
      () => {

        if (inToday) {

          removeFromToday(
            c.key
          );

        } else {

          addToToday(c);

        }

      };


    box.appendChild(row);

  });

}



// ----------------------------------------------------
// ADDRESS LOOKUP
// ----------------------------------------------------

async function findAddressLocation() {

  const address =
    el("customerAddress")
      .value
      .trim();


  if (!address) {

    alert(
      "Enter an address, village or landmark first."
    );

    return;

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


    if (
      !results.length
    ) {

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
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    el("lat").value !== "" &&
    el("lng").value !== ""
  ) {

    q =
      `${lat},${lng}`;

  } else {

    q =
      el("customerAddress")
        .value
        .trim();

  }


  if (!q) {

    alert(
      "No location entered."
    );

    return;

  }


  window.open(
    "https://www.google.com/maps/search/?api=1&query=" +
    encodeURIComponent(q),
    "_blank",
    "noopener"
  );

}



// ----------------------------------------------------
// CUSTOMER FORM
// ----------------------------------------------------

function openCustomerDialog(
  c = null
) {

  form.reset();


  el("serviceMin")
    .value = 7;


  el("quantity")
    .value = "";


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


    el("customerAddress")
      .value =
        c.address || "";


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
        c.serviceMin ?? 7;


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


    const today =
      todayItemByKey(
        c.key
      );


    el("quantity")
      .value =
        today?.quantity ?? "";

  } else {

    el("dialogTitle")
      .textContent =
        "New customer";


    el("editKey")
      .value = "";

  }


  dialog.showModal();

}



form.addEventListener(
  "submit",
  event => {

    event.preventDefault();


    const key =
      el("editKey").value ||
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

      address:
        el("customerAddress")
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
            .value || 7
        ),

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


    const quantity =
      el("quantity").value;


    if (
      quantity !== ""
    ) {

      let today =
        todayItemByKey(key);


      if (!today) {

        today = {

          customerKey:
            key,

          quantity,

          done:
            false,

          order:
            state.today.length

        };


        state.today.push(
          today
        );

      } else {

        today.quantity =
          quantity;

      }

    }


    dialog.close();

    saveState();

  }
);



// ----------------------------------------------------
// PHYSICAL GPS
// ----------------------------------------------------

el("saveGpsBtn")
  .onclick = () => {

    if (
      !navigator.geolocation
    ) {

      alert(
        "GPS is not available."
      );

      return;

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


          const accuracy =
            Math.round(
              pos.coords
                .accuracy || 0
            );


          el("locationStatus")
            .textContent =
              `🟢 Verified truck position • GPS ±${accuracy} m`;


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

          timeout:
            15000,

          maximumAge:
            0
        }

      );

  };



// ----------------------------------------------------
// BUILD ROUTE FROM IDS
// ----------------------------------------------------

el("buildRouteBtn")
  .onclick = () => {

    const text =
      el("routeInput")
        .value
        .trim();


    if (!text) {

      alert(
        "Enter at least one customer ID."
      );

      return;

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


    lines.forEach(line => {

      const parts =
        line
          .split(/[\s,;]+/)
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


      const customer =
        state.customers.find(
          c =>
            String(c.id)
              .trim()
              .toLowerCase() ===
            id.toLowerCase()
        );


      if (!customer) {

        missing.push(id);

        return;

      }


      let today =
        todayItemByKey(
          customer.key
        );


      if (today) {

        already.push(id);

      } else {

        today = {

          customerKey:
            customer.key,

          quantity,

          done:
            false,

          order:
            state.today.length

        };


        state.today.push(
          today
        );


        added.push(id);

      }


      if (
        quantity !== ""
      ) {

        today.quantity =
          quantity;

      }

    });


    saveState();


    let message =
      `${added.length} customers added.`;


    if (
      already.length
    ) {

      message +=
        ` ${already.length} already in route.`;

    }


    if (
      missing.length
    ) {

      message +=
        ` ⚠️ Unknown IDs: ${missing.join(", ")}`;

    }


    el("routeBuildResult")
      .textContent =
        message;

  };



// ----------------------------------------------------
// OPENROUTESERVICE API KEY
// ----------------------------------------------------

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
  .onclick = () => {

    const key =
      el("apiKeyInput")
        .value
        .trim();


    if (!key) {

      alert(
        "Paste your API key first."
      );

      return;

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
  .onclick = () => {

    const input =
      el("apiKeyInput");


    input.type =
      input.type ===
      "password"
        ? "text"
        : "password";

};



// ----------------------------------------------------
// REAL ROAD OPTIMIZATION
// ----------------------------------------------------

async function optimizeRealRoute() {

  const key =
    localStorage.getItem(
      API_KEY_STORAGE
    );


  if (!key) {

    alert(
      "Save your openrouteservice API key first."
    );

    return;

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

    alert(
      "You need at least 2 remaining stops."
    );

    return;

  }


  const missingGps =
    pending.filter(
      item => {

        const customer =
          customerByKey(
            item.customerKey
          );


        return !coordsValid(
          customer
        );

      }
    );


  if (
    missingGps.length
  ) {

    const ids =
      missingGps
        .map(
          item =>
            customerByKey(
              item.customerKey
            )?.id
        )
        .filter(Boolean);


    alert(
      "These customers have no GPS location:\n\n" +
      ids.join(", ")
    );


    return;

  }


  if (
    !navigator.geolocation
  ) {

    alert(
      "Current GPS is not available."
    );

    return;

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
      await new Promise(
        (resolve, reject) => {

          navigator.geolocation
            .getCurrentPosition(

              resolve,

              reject,

              {
                enableHighAccuracy:
                  true,

                timeout:
                  15000,

                maximumAge:
                  0
              }

            );

        }
      );


    const start = [

      position.coords
        .longitude,

      position.coords
        .latitude

    ];


    button.textContent =
      "Optimizing roads…";


    el("optimizerStatus")
      .textContent =
        "Calculating best road order…";


    const jobToCustomer =
      new Map();


    const jobs =
      pending.map(
        (item, index) => {

          const customer =
            customerByKey(
              item.customerKey
            );


          const jobId =
            index + 1;


          jobToCustomer.set(
            jobId,
            item.customerKey
          );


          return {

            id:
              jobId,

            location: [

              Number(
                customer.lng
              ),

              Number(
                customer.lat
              )

            ],

            service:
              Math.max(
                0,
                Math.round(
                  Number(
                    customer.serviceMin ||
                    7
                  ) * 60
                )
              )

          };

        }
      );


    const requestBody = {

      jobs,

      vehicles: [

        {

          id:
            1,

          profile:
            "driving-car",

          start:
            start

        }

      ]

    };


    const response =
      await fetch(
        ORS_OPTIMIZATION_URL,
        {

          method:
            "POST",

          headers: {

            "Authorization":
              key,

            "Content-Type":
              "application/json",

            "Accept":
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

      console.error(
        result
      );


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


    const route =
      result.routes[0];


    const orderedKeys =
      route.steps

        .filter(
          step =>
            step.type ===
            "job"
        )

        .map(
          step =>
            jobToCustomer.get(
              step.job
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


    const newOrder = [

      ...done,

      ...optimized

    ];


    newOrder.forEach(
      (item, index) =>
        item.order =
          index
    );


    state.today =
      newOrder;


    saveState();


    const km =
      Number(
        route.distance || 0
      ) / 1000;


    const minutes =
      Math.round(
        Number(
          route.duration || 0
        ) / 60
      );


    const accuracy =
      Math.round(
        position.coords
          .accuracy || 0
      );


    el("optimizerStatus")
      .textContent =
        `✓ Optimized from current truck position • ${km.toFixed(1)} km • about ${minutes} min including service time • GPS ±${accuracy} m`;


  } catch (error) {

    console.error(
      error
    );


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
      "🚚 Optimize route";

  }

}



el("optimizeBtn")
  .onclick =
    optimizeRealRoute;



// ----------------------------------------------------
// OTHER BUTTONS
// ----------------------------------------------------

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
  .onclick = () => {

    const current =
      currentUndone();


    if (!current) {

      alert(
        "No remaining stop."
      );

      return;

    }


    markDone(
      current.customerKey
    );

  };


el("resetTodayBtn")
  .onclick = () => {

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
        "Route not optimized yet.";

  };



// ----------------------------------------------------
// BACKUP
// ----------------------------------------------------

el("exportBtn")
  .onclick = () => {

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
      "delivery-helper-backup-" +
      new Date()
        .toISOString()
        .slice(0, 10) +
      ".json";


    a.click();


    URL.revokeObjectURL(
      a.href
    );

  };



el("importInput")
  .onchange =
    async event => {

      const file =
        event.target
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


        saveState();


      } catch (error) {

        alert(
          "Import failed: " +
          error.message
        );

      }


      event.target
        .value = "";

    };



// ----------------------------------------------------
// INSTALL / SERVICE WORKER
// ----------------------------------------------------

window.addEventListener(
  "beforeinstallprompt",
  event => {

    event.preventDefault();


    deferredPrompt =
      event;


    el("installBtn")
      .classList
      .remove("hidden");

  }
);



el("installBtn")
  .onclick =
    async () => {

      if (
        !deferredPrompt
      ) {

        return;

      }


      deferredPrompt.prompt();


      await deferredPrompt
        .userChoice;


      deferredPrompt =
        null;


      el("installBtn")
        .classList
        .add("hidden");

    };



if (
  "serviceWorker" in
  navigator
) {

  navigator
    .serviceWorker
    .register("./sw.js")
    .catch(
      console.error
    );

}



// ----------------------------------------------------
// START
// ----------------------------------------------------

loadApiKey();

render();
