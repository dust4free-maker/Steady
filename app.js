// Steady — local AI sobriety/habit coach. 100% client-side: localStorage + WebLLM (WebGPU).
import * as webllm from "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.79/+esm";

// ---------- CONFIG ----------
const MODEL_ID = "Llama-3.2-1B-Instruct-q4f16_1-MLC"; // alt: "Phi-3.5-mini-instruct-q4f16_1-MLC" (smarter, ~2.4GB)
const FREE_DAILY_LIMIT = 5;                            // free coach messages per day
const KEY = "steady:v1";
const $ = s => document.querySelector(s);
const todayStr = () => new Date().toLocaleDateString("en-CA"); // local YYYY-MM-DD

// ---------- STORE (localStorage; swap for IndexedDB later if data grows) ----------
const defaults = { habit: "", startedAt: null, dailyCost: 0, currency: "$", checkins: [], slips: 0, usage: { date: "", count: 0 } };
let state = { ...defaults, ...(JSON.parse(localStorage.getItem(KEY) || "null") || {}) };
const save = () => localStorage.setItem(KEY, JSON.stringify(state));

// ---------- ENTITLEMENTS: the ONLY place that decides free vs. paid ----------
// To add a paid unlock: make isPro() verify a license (Stripe/Lemon Squeezy/Gumroad key
// checked against a serverless function, or a signed token) and call upgrade() from your checkout.
const Pro = {
  isPro: () => localStorage.getItem("steady:pro") === "1", // TODO: replace with real license check
  remaining() {
    if (this.isPro()) return Infinity;
    return state.usage.date === todayStr() ? Math.max(0, FREE_DAILY_LIMIT - state.usage.count) : FREE_DAILY_LIMIT;
  },
  consume() {
    if (this.isPro()) return;
    if (state.usage.date !== todayStr()) state.usage = { date: todayStr(), count: 0 };
    state.usage.count++; save();
  },
  upgrade() { alert("Hook your checkout here, then set localStorage 'steady:pro' = '1' after verifying payment."); }
};

// ---------- STREAK + MONEY ----------
function elapsed() {
  if (!state.startedAt) return null;
  const ms = Math.max(0, Date.now() - new Date(state.startedAt).getTime());
  return { ms, d: Math.floor(ms / 864e5), h: Math.floor(ms / 36e5) % 24, m: Math.floor(ms / 6e4) % 60 };
}
const money = () => { const e = elapsed(); return e ? (e.ms / 864e5) * state.dailyCost : 0; };
const fmt = n => state.currency + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---------- UI ----------
function show(tab) {
  document.querySelectorAll("section").forEach(s => s.classList.toggle("on", s.id === "tab-" + tab));
  document.querySelectorAll("nav button").forEach(b => b.classList.toggle("on", b.dataset.t === tab));
  if (tab === "coach") renderQuota();
}
document.querySelectorAll("nav button").forEach(b => b.onclick = () => show(b.dataset.t));

function tick() {
  const e = elapsed(); if (!e) return;
  $("#d-time").innerHTML = `${e.d}<small>d</small>${e.h}<small>h</small>${e.m}<small>m</small>`;
  $("#d-money").textContent = fmt(money());
}
function render() {
  const has = !!state.startedAt;
  $("#setup").hidden = has; $("#dash").hidden = !has;
  if (!has) return;
  $("#d-habit").textContent = state.habit ? `Free from ${state.habit}` : "Time free";
  $("#d-sub").textContent = state.slips ? `Restarts so far: ${state.slips}` : "Every minute counts.";
  $("#d-checks").textContent = state.checkins.length;
  $("#e-cost").value = state.dailyCost; $("#e-cur").value = state.currency;
  const days = [...Array(7)].map((_, i) => { const d = new Date(Date.now() - (6 - i) * 864e5).toLocaleDateString("en-CA"); return state.checkins.find(c => c.date === d); });
  $("#d-week").textContent = days.map(c => c ? "●" : "○").join("  ") + "   (● = checked in)";
  $("#c-list").innerHTML = "";
  state.checkins.slice(-7).reverse().forEach(c => {
    const el = document.createElement("div"); el.className = "card";
    el.textContent = `${c.date} · mood ${c.mood}/5 · craving ${c.craving}/10${c.note ? " — " + c.note : ""}`;
    $("#c-list").append(el);
  });
  tick();
}
$("#s-start").value = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
$("#s-save").onclick = () => {
  state.habit = $("#s-habit").value.trim();
  state.startedAt = new Date($("#s-start").value || Date.now()).toISOString();
  state.dailyCost = parseFloat($("#s-cost").value) || 0;
  save(); render();
};
$("#e-save").onclick = () => { state.dailyCost = parseFloat($("#e-cost").value) || 0; state.currency = $("#e-cur").value || "$"; save(); render(); };
$("#relapse").onclick = () => {
  if (!confirm("Restart your streak from now? Your check-ins stay. One slip isn't failure.")) return;
  state.startedAt = new Date().toISOString(); state.slips++; save(); render();
};

// check-in
let mood = 0;
document.querySelectorAll("#moods button").forEach(b => b.onclick = () => {
  mood = +b.dataset.m; document.querySelectorAll("#moods button").forEach(x => x.classList.toggle("sel", x === b));
});
$("#c-craving").oninput = e => $("#c-val").textContent = e.target.value;
$("#c-save").onclick = () => {
  if (!mood) return alert("Pick a mood first.");
  const entry = { date: todayStr(), mood, craving: +$("#c-craving").value, note: $("#c-note").value.trim() };
  state.checkins = state.checkins.filter(c => c.date !== entry.date).concat(entry).slice(-90);
  save(); $("#c-note").value = ""; render();
};

// ---------- COACH ----------
let enginePromise = null, history = [], busy = false;
function loadEngine() {
  if (enginePromise) return enginePromise;
  if (!navigator.gpu) { $("#load-msg").textContent = "This browser has no WebGPU. Try Chrome on Android 12+, desktop Chrome/Edge, or Safari 18+."; return Promise.reject(new Error("no webgpu")); }
  $("#load-btn").disabled = true;
  enginePromise = webllm.CreateMLCEngine(MODEL_ID, {
    initProgressCallback: r => { $("#load-msg").textContent = r.text; $("#load-bar").style.width = Math.round(r.progress * 100) + "%"; }
  }).then(e => { $("#load").hidden = true; return e; })
    .catch(err => { enginePromise = null; $("#load-btn").disabled = false; $("#load-msg").textContent = "Load failed: " + err.message; throw err; });
  return enginePromise;
}
$("#load-btn").onclick = () => loadEngine().catch(() => {});

// Everything the coach knows comes from this function — local data only.
function coachSystemPrompt() {
  const e = elapsed(), recent = state.checkins.slice(-5).map(c => `${c.date}: mood ${c.mood}/5, craving ${c.craving}/10${c.note ? ", note: " + c.note : ""}`).join("\n") || "none yet";
  return `You are Steady, a warm, brief, non-judgmental sobriety and habit coach. Reply in 2-5 short sentences. Offer one concrete next step (e.g. delay 10 minutes, drink water, walk, call a friend). Never shame. Never give medical advice; for medical danger or self-harm, urge contacting emergency services or 988 (US).
User's goal: ${state.habit || "not set"}.
Streak: ${e ? `${e.d} days, ${e.h} hours, ${e.m} minutes` : "not started"}. Restarts: ${state.slips}.
Money saved: ${fmt(money())} (${fmt(state.dailyCost)}/day).
Recent check-ins:\n${recent}`;
}
function renderQuota() { const r = Pro.remaining(); $("#quota").textContent = Pro.isPro() ? "Unlimited coach" : `${r} free message${r === 1 ? "" : "s"} left today`; }
function bubble(cls, text) { const d = document.createElement("div"); d.className = "b " + cls; d.textContent = text; $("#log").append(d); d.scrollIntoView({ block: "end" }); return d; }

async function send(text, { sos = false } = {}) {
  if (busy || !text) return;
  if (!sos && Pro.remaining() === 0) { bubble("a", "You've used today's free messages. Unlock unlimited coaching to keep talking."); if (confirm("Unlock unlimited coach?")) Pro.upgrade(); return; }
  busy = true; bubble("u", text);
  const out = bubble("a", "…");
  try {
    const engine = await loadEngine();
    if (!sos) Pro.consume(); // SOS messages are never rationed
    history.push({ role: "user", content: text });
    const stream = await engine.chat.completions.create({
      messages: [{ role: "system", content: coachSystemPrompt() }, ...history.slice(-8)],
      stream: true, temperature: 0.7, max_tokens: 220
    });
    let full = "";
    for await (const chunk of stream) { full += chunk.choices[0]?.delta?.content || ""; out.textContent = full; out.scrollIntoView({ block: "end" }); }
    history.push({ role: "assistant", content: full });
  } catch (e) { out.textContent = "Coach unavailable: " + e.message; }
  busy = false; renderQuota();
}
$("#chat").onsubmit = e => { e.preventDefault(); const t = $("#msg").value.trim(); $("#msg").value = ""; send(t); };
$("#sos").onclick = () => {
  show("coach");
  send("I'm having a strong craving right now. Help me get through the next 10 minutes.", { sos: true });
};

// ---------- BOOT ----------
render(); setInterval(tick, 1000);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");
