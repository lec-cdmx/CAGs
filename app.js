/* =========================
   CONFIG (AJUSTA AQUÍ)
========================= */

// 1) Pega aquí tu URL del Apps Script (Web App /exec)
const API_BASE_URL = "https://script.google.com/macros/s/AKfycbzDfqRGeiUAiJNTEDQxFGUhiqsYo-5FanfjaY1vt0MAy2kbBDZSuIv1MSeZFw2yQ_HQ/exec";

// 2) Rango del calendario (incluyente)
const RANGE_START = new Date("2026-03-01T00:00:00-06:00"); // Dom 1 Mar 2026
const RANGE_END = new Date("2026-03-27T23:59:59-06:00"); // Vie 27 Mar 2026

// 3) Slots: duración y jornada "por defecto"
const SLOT_MINUTES = 45;

// Jornada base por día (0=Dom ... 6=Sáb). null => sin slots
const BASE_HOURS = {
  0: null,                             // Domingo: sin entrevistas
  1: { start: "09:00", end: "18:30" }, // Lunes
  2: { start: "09:00", end: "18:30" }, // Martes
  3: { start: "09:00", end: "17:30" }, // Miércoles
  4: { start: "09:00", end: "17:30" }, // Jueves
  5: { start: "09:00", end: "15:00" }, // Viernes
  6: null                              // Sábado: sin entrevistas
};

// 4) Bloqueos fijos
const BLOCKS = [
  { dow: 1, from: "18:30", to: "23:59" }, // Lunes 18:30+
  { dow: 3, from: "17:30", to: "23:59" }, // Miércoles 17:30+
  { dow: 4, from: "17:30", to: "23:59" }, // Jueves 17:30+
  { dow: 5, from: "15:00", to: "23:59" }, // Viernes 15:00+
  { dow: 1, from: "11:00", to: "13:00" }, // Lun 11-13
  { dow: 3, from: "11:00", to: "13:00" }, // Mié 11-13
  { dow: 4, from: "11:00", to: "13:00" }  // Jue 11-13
];

// 5) Capacidad por slot
const SLOT_CAPACITY = 2;

/* =========================
   UTILIDADES
========================= */

const $ = (sel) => document.querySelector(sel);

function pad(n){ return String(n).padStart(2,"0"); }

function toISODate(d){
  const y = d.getFullYear();
  const m = pad(d.getMonth()+1);
  const day = pad(d.getDate());
  return `${y}-${m}-${day}`;
}

function parseTimeHHMM(t){
  const [h,m] = t.split(":").map(Number);
  return h*60 + m;
}

function minutesToHHMM(mins){
  const h = Math.floor(mins/60);
  const m = mins%60;
  return `${pad(h)}:${pad(m)}`;
}

function addDays(d, n){
  const x = new Date(d);
  x.setDate(x.getDate()+n);
  return x;
}

function clampRange(d){
  if (d < RANGE_START) return new Date(RANGE_START);
  if (d > RANGE_END) return new Date(RANGE_END);
  return d;
}

function formatRangeTitle(viewStart){
  const meses = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
  return `${meses[viewStart.getMonth()]} ${viewStart.getFullYear()}`;
}

function inOverallRange(day){
  return day >= new Date(RANGE_START.toDateString()) && day <= new Date(RANGE_END.toDateString());
}

function overlapsBlock(dow, startMin, endMin){
  return BLOCKS.some(b => {
    if (b.dow !== dow) return false;
    const bFrom = parseTimeHHMM(b.from);
    const bTo = parseTimeHHMM(b.to);
    return startMin < bTo && endMin > bFrom;
  });
}

/* =========================
   GENERAR SLOTS "TEÓRICOS"
========================= */

function generateSlotsForDay(dateObj){
  const dow = dateObj.getDay();
  const base = BASE_HOURS[dow];
  if (!base) return [];

  const dayISO = toISODate(dateObj);
  const startMin = parseTimeHHMM(base.start);
  const endMin = parseTimeHHMM(base.end);

  const slots = [];
  for (let t = startMin; t + SLOT_MINUTES <= endMin; t += SLOT_MINUTES) {
    const slotStart = t;
    const slotEnd = t + SLOT_MINUTES;

    const blocked = overlapsBlock(dow, slotStart, slotEnd);
    const key = `${dayISO}T${minutesToHHMM(slotStart)}`; // slot_id

    slots.push({
      slot_id: key,
      date: dayISO,
      start: minutesToHHMM(slotStart),
      end: minutesToHHMM(slotEnd),
      blocked
    });
  }
  return slots;
}

/* =========================
   API (JSONP para evitar CORS en GitHub Pages)
========================= */

function jsonp(url){
  return new Promise((resolve, reject) => {
    const cb = `cb_${Date.now()}_${Math.floor(Math.random()*1e6)}`;
    const sep = url.includes("?") ? "&" : "?";
    const fullUrl = `${url}${sep}callback=${cb}`;

    const script = document.createElement("script");
    script.src = fullUrl;
    script.async = true;

    window[cb] = (data) => {
      cleanup();
      resolve(data);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("Fallo al cargar JSONP (script)."));
    };

    function cleanup(){
      delete window[cb];
      script.remove();
    }

    document.head.appendChild(script);
  });
}

async function apiGetState(rangeStartISO, rangeEndISO){
  // _t evita que el navegador o Google cacheen la respuesta
  const url = `${API_BASE_URL}?action=get&start=${encodeURIComponent(rangeStartISO)}&end=${encodeURIComponent(rangeEndISO)}&_t=${Date.now()}`;
  const data = await jsonp(url);
  if (!data || !data.ok) throw new Error(data?.error || "No se pudo cargar el estado de reservas.");
  return data;
}

async function apiBook(slot_id, fullName, matricula){
  // _t evita que el navegador o Google cacheen la respuesta
  const url =
    `${API_BASE_URL}?action=book` +
    `&slot_id=${encodeURIComponent(slot_id)}` +
    `&fullName=${encodeURIComponent(fullName)}` +
    `&matricula=${encodeURIComponent(matricula)}` +
    `&_t=${Date.now()}`;

  const data = await jsonp(url);
  if (!data || !data.ok) throw new Error(data?.error || "No se pudo completar la reserva.");
  return data;
}

/* =========================
   UI: CALENDARIO
========================= */

const DOW_LABELS = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];

let viewMonth = new Date("2026-03-01T00:00:00-06:00"); // inicia en marzo 2026
let cache = new Map(); // slot_id -> [{ fullName, matricula }]

function getMonthGridStart(d){
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const dow = first.getDay();
  return addDays(first, -dow);
}

function getMonthGridEnd(d){
  const last = new Date(d.getFullYear(), d.getMonth()+1, 0);
  const dow = last.getDay();
  return addDays(last, (6 - dow));
}

function setStatus(msg){
  $("#status").textContent = msg || "";
}

function slotClass(slot, bookings){
  if (slot.blocked) return "blocked";
  const n = bookings?.length || 0;
  if (n >= SLOT_CAPACITY) return "full";
  if (n === SLOT_CAPACITY - 1) return "almost";
  return "open";
}

function slotLabel(bookings){
  if (!bookings || bookings.length === 0) return "Sin reservas";
  return bookings.map(b => `${b.fullName} (${b.matricula})`).join("; ");
}

function renderCalendar(){
  $("#rangeTitle").textContent = formatRangeTitle(viewMonth);

  const cal = $("#calendar");
  cal.innerHTML = "";

  for (const lab of DOW_LABELS){
    const h = document.createElement("div");
    h.className = "dow";
    h.textContent = lab;
    cal.appendChild(h);
  }

  const gridStart = getMonthGridStart(viewMonth);
  const gridEnd = getMonthGridEnd(viewMonth);

  for (let day = new Date(gridStart); day <= gridEnd; day = addDays(day, 1)) {
    const dayBox = document.createElement("div");
    dayBox.className = "day";

    const inRange = inOverallRange(day);
    const isThisMonth = day.getMonth() === viewMonth.getMonth();

    const head = document.createElement("div");
    head.className = "day-header";

    const title = document.createElement("div");
    title.className = "day-title";
    title.textContent = `${day.getDate()}`;

    const badge = document.createElement("div");
    badge.className = "badge";
    badge.textContent = isThisMonth ? "" : "—";

    head.appendChild(title);
    head.appendChild(badge);
    dayBox.appendChild(head);

    if (!inRange){
      dayBox.style.opacity = 0.45;
      cal.appendChild(dayBox);
      continue;
    }

    const slots = generateSlotsForDay(day);

    if (slots.length === 0){
      const empty = document.createElement("div");
      empty.className = "subtle";
      empty.textContent = "Sin espacios";
      dayBox.appendChild(empty);
      cal.appendChild(dayBox);
      continue;
    }

    for (const slot of slots){
      const bookings = cache.get(slot.slot_id) || [];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `slot ${slotClass(slot, bookings)}`;
      btn.dataset.slotId = slot.slot_id;
      btn.dataset.slotMeta = `${slot.date} ${slot.start}–${slot.end}`;
      btn.innerHTML = `<strong>${slot.start}</strong> <span class="subtle">→ ${slot.end}</span>
                       <small>${slotLabel(bookings)}</small>`;

      const isBlocked = slot.blocked;
      const isFull = bookings.length >= SLOT_CAPACITY;

      if (isBlocked || isFull) {
        btn.disabled = true;
      } else {
        btn.addEventListener("click", () => openBookingModal(slot, bookings));
      }

      dayBox.appendChild(btn);
    }

    if (!isThisMonth) dayBox.style.opacity = 0.7;
    cal.appendChild(dayBox);
  }
}

/* =========================
   UI: MODAL
========================= */

let selectedSlot = null;

function openBookingModal(slot, bookings){
  selectedSlot = slot;
  $("#modalTitle").textContent = "Reservar espacio";
  const remaining = SLOT_CAPACITY - (bookings?.length || 0);
  $("#modalMeta").textContent = `${slot.date} ${slot.start}–${slot.end} · Lugares disponibles: ${remaining}`;
  $("#fullName").value = "";
  $("#matricula").value = "";
  $("#modalError").textContent = "";
  $("#bookingModal").showModal();
}

function closeBookingModal(){
  $("#bookingModal").close();
  selectedSlot = null;
}

/* =========================
   CARGA INICIAL + NAVEGACIÓN
========================= */

async function refreshDataForVisibleMonth(){
  const start = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
  const end = new Date(viewMonth.getFullYear(), viewMonth.getMonth()+1, 0);

  const startISO = toISODate(clampRange(start));
  const endISO = toISODate(clampRange(end));

  setStatus("Cargando disponibilidad...");
  const data = await apiGetState(startISO, endISO);

  cache = new Map();
  for (const row of (data.bookings || [])){
    if (!cache.has(row.slot_id)) cache.set(row.slot_id, []);
    cache.get(row.slot_id).push({ fullName: row.fullName, matricula: row.matricula });
  }

  setStatus("");
  renderCalendar();
}

function initNav(){
  $("#prevBtn").addEventListener("click", async () => {
    viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth()-1, 1);
    if (viewMonth < new Date(2026, 2, 1)) viewMonth = new Date(2026, 2, 1);
    await refreshDataForVisibleMonth();
  });

  $("#nextBtn").addEventListener("click", async () => {
    viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth()+1, 1);
    if (viewMonth > new Date(2026, 3, 1)) viewMonth = new Date(2026, 3, 1);
    await refreshDataForVisibleMonth();
  });
}

function initModal(){
  $("#cancelBtn").addEventListener("click", () => closeBookingModal());

  $("#bookingForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    $("#modalError").textContent = "";

    if (!selectedSlot) return;

    const fullName = $("#fullName").value.trim();
    const matricula = $("#matricula").value.trim();

    if (!fullName || !matricula) {
      $("#modalError").textContent = "Completa nombre y matrícula.";
      return;
    }

    try{
      $("#confirmBtn").disabled = true;
      await apiBook(selectedSlot.slot_id, fullName, matricula);
      closeBookingModal();
      await refreshDataForVisibleMonth();
    } catch(e){
      $("#modalError").textContent = e?.message || "Error al reservar.";
    } finally {
      $("#confirmBtn").disabled = false;
    }
  });
}

(async function main(){
  initNav();
  initModal();
  try{
    await refreshDataForVisibleMonth();
  } catch(e){
    setStatus(`No se pudo cargar el calendario: ${e?.message || e}`);
    console.error(e);
  }
})();
