/**
 * <meeting-taxameter> – Web Component, die die laufenden Kosten eines Meetings zählt.
 *
 * Attribute:
 *   compact        Kompakte Anzeige (nur Betrag, Dauer, Start/Pause) – für das Mini-Fenster.
 *   storage-key    Schlüssel für localStorage (Standard: "meeting-taxameter-v1").
 *
 * Methoden:
 *   start(), pause(), toggle(), reset()
 *   useTimerWindow(win)   Timer an ein anderes Fenster hängen (z. B. das Picture-in-Picture-Fenster),
 *                         damit er nicht gedrosselt wird, wenn der Haupt-Tab im Hintergrund ist.
 *
 * Events:
 *   taxameter-change  detail: { cost, hourly, elapsedMs, running }
 */
(() => {
  const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
  const eur0 = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  const num2 = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const OVERHEAD = 1.21; // pauschale Arbeitgeberkosten
  const HOURS = 1700;    // produktive Arbeitsstunden pro Jahr (38,5-Std.-Woche abzgl. Urlaub/Feiertage)

  /* BAT/AOK-Neu, Monatsgrundvergütung Vollzeit, gültig ab 01.01.2026 (Stufen 1–7).
     Quelle: tarifvertrag-online.de (GdS-Tabelle), unverbindlich – maßgeblich ist der Tarifvertrag. */
  const AOK_VALID = "01.01.2026";
  const AOK = {
    16: [7856, 8773, 9897, 10523, 10869, 11168, 11419],
    15: [7292, 8134, 9170, 9736, 10060, 10331, 10566],
    14: [6735, 7499, 8434, 8953, 9246, 9494, 9702],
    13: [6194, 6856, 7669, 8120, 8375, 8591, 8771],
    12: [5705, 6274, 6973, 7363, 7577, 7764, 7921],
    11: [5390, 5878, 6476, 6808, 6995, 7150, 7287],
    10: [4882, 5300, 5816, 6097, 6258, 6394, 6506],
    9: [4523, 4878, 5318, 5559, 5694, 5812, 5905],
    8: [4198, 4498, 4873, 5080, 5196, 5292, 5376],
    7: [4029, 4255, 4533, 4685, 4770, 4843, 4907],
    6: [3805, 3998, 4239, 4340, 4418, 4479, 4533],
    5: [3612, 3755, 3934, 4006, 4063, 4107, 4153],
    4: [3445, 3561, 3699, 3749, 3787, 3831, 3864],
    3: [3299, 3394, 3509, 3544, 3578, 3610, 3635],
    2: [3144, 3223, 3317, 3340, 3369, 3396, 3416],
    1: [3027, 3096, 3185, 3196, 3224, 3248, 3267],
  };
  // Jahresbrutto = 12 Monate + 100 % Weihnachtsgeld + Urlaubsgeld (460 € VG 1–6, 320 € VG 7–16)
  const aokAnnual = (vg, stufe) => AOK[vg][stufe - 1] * 13 + (vg <= 6 ? 460 : 320);

  /* Berater: Richtwerte Jahresgesamtgehalt inkl. Bonus, Deutschland (grobe Marktwerte, anpassbar). */
  const CONSULTANTS = [
    ["consultant", "Consultant", 70000],
    ["senior-consultant", "Senior Consultant", 88000],
    ["manager", "Manager", 115000],
    ["senior-manager", "Senior Manager", 140000],
    ["director", "Director", 175000],
    ["partner", "Partner", 250000],
  ];

  function annualOf(r) {
    if (r.type && r.type.startsWith("aok-")) return aokAnnual(+r.type.slice(4), r.stufe || 4);
    const c = CONSULTANTS.find((c) => "cons-" + c[0] === r.type);
    return c ? c[2] : null;
  }
  const rateOf = (r) => { const a = annualOf(r); return a == null ? +r.rate || 0 : a / HOURS; };

  const TYPE_OPTIONS =
    `<option value="custom">Eigener Stundensatz</option>` +
    `<optgroup label="AOK · BAT/AOK-Neu">` +
    Object.keys(AOK).map(Number).sort((a, b) => b - a).map((vg) => `<option value="aok-${vg}">VG ${vg}</option>`).join("") +
    `</optgroup><optgroup label="Berater (Jahresgehalt)">` +
    CONSULTANTS.map(([id, label]) => `<option value="cons-${id}">${label}</option>`).join("") +
    `</optgroup>`;
  const STUFE_OPTIONS = [1, 2, 3, 4, 5, 6, 7].map((s) => `<option value="${s}">St. ${s}</option>`).join("");

  const DEFAULT_STATE = {
    roles: [
      { name: "Abteilungsleitung", count: 1, type: "aok-15", stufe: 4 },
      { name: "Referent:in", count: 3, type: "aok-11", stufe: 4 },
      { name: "Sachbearbeitung", count: 2, type: "aok-8", stufe: 4 },
      { name: "Externe Beratung", count: 1, type: "cons-senior-consultant" },
    ],
    overhead: false,
    accumulated: 0,
    runningSince: null,
  };

  const COMPARISONS = [
    [2.5, "ein Cappuccino"], [12, "eine Pizza Margherita"], [49, "ein Deutschlandticket-Monat"],
    [300, "eine Hotelnacht für alle"], [800, "ein neuer Büro-Laptop"],
    [1500, "ein Team-Event"], [3000, "eine Monatsmiete in München"],
  ];

  const CSS = `
  :host{
    --bg:#eef0f2; --panel:#fff; --line:#d5d9de; --fg:#1b2129; --muted:#5d6773;
    --meter:#14181d; --meter-fg:#ffb21a; --meter-dim:#8a6620; --accent:#d98a00; --accent-fg:#1b1200; --danger:#c43d2f;
    --f-display:"Sora","Segoe UI",system-ui,sans-serif;
    --f-body:"IBM Plex Sans","Segoe UI",system-ui,sans-serif;
    --f-num:"JetBrains Mono",ui-monospace,"SF Mono",Menlo,Consolas,monospace;
    display:block; font-family:var(--f-body); color:var(--fg); line-height:1.5;
  }
  @media (prefers-color-scheme: dark){ :host{
    --bg:#101317; --panel:#181c22; --line:#2b313a; --fg:#e6e9ed; --muted:#97a0ab;
    --meter:#07090b; --meter-dim:#7a5a1c; --accent:#f0a020; --danger:#ee6a5a; } }
  *{box-sizing:border-box}
  .wrap{display:flex;flex-direction:column;gap:16px}
  .meter{background:var(--meter);border-radius:14px;padding:20px;color:var(--meter-fg);display:flex;flex-direction:column;gap:12px}
  .top{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
  .lbl{font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;color:var(--meter-dim);font-weight:600}
  .status{display:inline-flex;align-items:center;gap:8px}
  .status i{width:9px;height:9px;border-radius:50%;background:var(--meter-dim)}
  .status.on{color:var(--meter-fg)} .status.on i{background:#ff4a3a;box-shadow:0 0 10px #ff4a3a;animation:blink 1.2s steps(2) infinite}
  @keyframes blink{50%{opacity:.25}}
  .total{font-family:var(--f-num);font-weight:700;font-size:clamp(2.4rem,10vw,4.6rem);line-height:1;font-variant-numeric:tabular-nums;text-shadow:0 0 18px #ffb21a40;white-space:nowrap}
  .total small{font-size:.45em;margin-left:.2em;color:var(--meter-dim)}
  .compare{font-size:.9rem;color:#d8c49a;min-height:1.4em}
  .stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;border-top:1px solid #ffffff14;padding-top:12px}
  .stats b{display:block;font-family:var(--f-num);font-size:1.1rem;font-variant-numeric:tabular-nums}
  .controls{display:flex;gap:10px;flex-wrap:wrap}
  button{font:inherit;cursor:pointer;border-radius:9px;border:1px solid var(--line);background:var(--panel);color:var(--fg);padding:9px 15px;font-weight:600}
  button:focus-visible,input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .primary{background:var(--accent);border-color:var(--accent);color:var(--accent-fg);min-width:130px}
  .ghost{background:transparent}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:10px}
  .card h2{font-family:var(--f-display);font-size:1rem;margin:0}
  .hint{color:var(--muted);font-size:.85rem;margin:0}
  .rows{display:flex;flex-direction:column;gap:8px}
  .row{display:grid;grid-template-columns:minmax(140px,1fr) 150px 74px 64px 96px 34px;
       grid-template-areas:"name type stufe count rate del";gap:8px;align-items:center}
  .row > :nth-child(1){grid-area:name} .row > :nth-child(2){grid-area:type} .row > :nth-child(3){grid-area:stufe}
  .row > :nth-child(4){grid-area:count} .row > :nth-child(5){grid-area:rate} .row > :nth-child(6){grid-area:del}
  .row.head{font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-weight:600}
  .row.head span:nth-child(4),.row.head span:nth-child(5){text-align:right}
  input,select{font:inherit;width:100%;min-width:0;padding:7px 9px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg)}
  select{padding-right:4px}
  select:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .invisible{visibility:hidden}
  input[type=number]{font-family:var(--f-num);text-align:right}
  input[readonly]{background:transparent;border-color:transparent;color:var(--muted)}
  .source{font-size:.78rem;color:var(--muted);margin:0}
  .del{padding:6px 0;width:34px;color:var(--muted);background:transparent;border-color:transparent;font-size:1.1rem}
  .del:hover{color:var(--danger)}
  .foot{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;border-top:1px solid var(--line);padding-top:10px}
  .foot b{font-family:var(--f-num)}
  .opt{display:flex;align-items:center;gap:8px;font-size:.9rem} .opt input{width:auto}
  @media (max-width:640px){
    .row{grid-template-columns:minmax(0,1fr) 70px 64px 84px 30px;
         grid-template-areas:"name name name name del" "type type stufe stufe stufe" "x x count rate rate";gap:6px;
         padding-bottom:8px;border-bottom:1px solid var(--line)}
    .row.head{display:none}
  }

  /* Kompakt-Modus für das Mini-Fenster */
  :host([compact]) .config, :host([compact]) .compare, :host([compact]) .extra, :host([compact]) slot[name=actions]{display:none}
  :host([compact]) .wrap{gap:10px;height:100%}
  :host([compact]) .meter{border-radius:0;padding:14px 16px;gap:8px;flex:1;justify-content:center}
  :host([compact]) .total{font-size:clamp(2rem,17vw,4rem)}
  :host([compact]) .stats{grid-template-columns:1fr 1fr;padding-top:8px}
  :host([compact]) .stat-people{display:none}
  :host([compact]) .controls{padding:0 16px 14px;gap:8px}
  :host([compact]) button{padding:7px 12px}
  :host([compact]) .primary{flex:1;min-width:0}
  @media (prefers-reduced-motion:reduce){ .status.on i{animation:none} }
  `;

  class MeetingTaxameter extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._timerWin = window;
      this._timer = null;
      this._state = structuredClone(DEFAULT_STATE);
      this.shadowRoot.innerHTML = `
        <style>${CSS}</style>
        <div class="wrap">
          <div class="meter">
            <div class="top">
              <span class="lbl">Bisherige Kosten</span>
              <span class="lbl status" part="status"><i></i><span data-r="statusText">Bereit</span></span>
            </div>
            <div class="total" data-r="total">0,00<small>€</small></div>
            <div class="compare" data-r="compare">&nbsp;</div>
            <div class="stats">
              <div><span class="lbl">Dauer</span><b data-r="elapsed">00:00:00</b></div>
              <div><span class="lbl">Pro Minute</span><b data-r="perMin">0,00 €</b></div>
              <div class="stat-people"><span class="lbl">Personen</span><b data-r="people">0</b></div>
            </div>
          </div>
          <div class="controls">
            <button class="primary" data-r="toggle">▶ Start</button>
            <button class="ghost" data-r="reset">Zurücksetzen</button>
            <button class="ghost extra" data-r="add5" title="Falls das Meeting schon lief">+5 Min. nachtragen</button>
            <slot name="actions"></slot>
          </div>
          <div class="card config">
            <h2>Teilnehmende</h2>
            <p class="hint">Typ wählen, der Stundensatz wird aus dem Jahresbrutto berechnet (÷ ${HOURS.toLocaleString("de-DE")} Arbeitsstunden).
              Für freie Werte „Eigener Stundensatz“ wählen.</p>
            <div class="rows" data-r="rows">
              <div class="row head"><span>Rolle</span><span>Typ</span><span>Stufe</span><span>Anzahl</span><span>€ / Std.</span><span></span></div>
            </div>
            <div><button class="ghost" data-r="addRow">+ Rolle hinzufügen</button></div>
            <div class="foot">
              <label class="opt"><input type="checkbox" data-r="overhead"> Arbeitgeberkosten +21 % einrechnen</label>
              <span>Summe: <b data-r="hourly">0 €</b> / Std.</span>
            </div>
            <p class="source">AOK: BAT/AOK-Neu-Tabelle ab ${AOK_VALID}, 12 Monate + Weihnachtsgeld (100 %) + Urlaubsgeld, unverbindlich.
              Berater: grobe Marktwerte für das Jahresgesamtgehalt inkl. Bonus in Deutschland.</p>
          </div>
        </div>`;
      this.$ = (name) => this.shadowRoot.querySelector(`[data-r="${name}"]`);
    }

    get storageKey() { return this.getAttribute("storage-key") || "meeting-taxameter-v2"; }

    connectedCallback() {
      if (this._initialized) { this._render(); return; }
      this._initialized = true;
      try {
        const s = JSON.parse(localStorage.getItem(this.storageKey));
        if (s && Array.isArray(s.roles)) this._state = { ...this._state, ...s };
      } catch (e) {}
      this.$("toggle").onclick = () => this.toggle();
      this.$("reset").onclick = () => this.reset();
      this.$("add5").onclick = () => { this._state.accumulated += 5 * 60000; this._save(); this._render(); };
      this.$("addRow").onclick = () => { this._state.roles.push({ name: "Neue Rolle", count: 1, type: "aok-10", stufe: 4 }); this._save(); this._renderRows(); this._render(); };
      this.$("overhead").checked = this._state.overhead;
      this.$("overhead").onchange = (e) => { this._state.overhead = e.target.checked; this._save(); this._render(); };
      // Änderungen aus einem anderen Tab übernehmen
      window.addEventListener("storage", (e) => {
        if (e.key !== this.storageKey || !e.newValue) return;
        try { this._state = { ...this._state, ...JSON.parse(e.newValue) }; this._renderRows(); this._render(); } catch (err) {}
      });
      this._renderRows();
      this.useTimerWindow(window);
    }

    /* ---------- öffentliche API ---------- */
    start() { if (!this._state.runningSince) { this._state.runningSince = Date.now(); this._save(); this._render(); } }
    pause() {
      if (this._state.runningSince) {
        this._state.accumulated += Date.now() - this._state.runningSince;
        this._state.runningSince = null; this._save(); this._render();
      }
    }
    toggle() { this._state.runningSince ? this.pause() : this.start(); }
    reset() { this._state.accumulated = 0; this._state.runningSince = null; this._save(); this._render(); }
    get running() { return !!this._state.runningSince; }

    useTimerWindow(win) {
      if (this._timer) this._timerWin.clearInterval(this._timer);
      this._timerWin = win;
      this._timer = win.setInterval(() => this._render(), 100);
      this._render();
    }

    /* ---------- intern ---------- */
    _save() { try { localStorage.setItem(this.storageKey, JSON.stringify(this._state)); } catch (e) {} }
    _hourly() { return this._state.roles.reduce((a, r) => a + (+r.count || 0) * rateOf(r), 0) * (this._state.overhead ? OVERHEAD : 1); }
    _people() { return this._state.roles.reduce((a, r) => a + (+r.count || 0), 0); }
    _elapsed() { return this._state.accumulated + (this._state.runningSince ? Date.now() - this._state.runningSince : 0); }

    _renderRows() {
      const box = this.$("rows");
      box.querySelectorAll(".row:not(.head)").forEach((n) => n.remove());
      this._state.roles.forEach((r, i) => {
        const row = document.createElement("div");
        row.className = "row";
        row.innerHTML = `<input aria-label="Rolle">
          <select aria-label="Mitarbeitertyp">${TYPE_OPTIONS}</select>
          <select aria-label="Erfahrungsstufe">${STUFE_OPTIONS}</select>
          <input aria-label="Anzahl" type="number" min="0" step="1">
          <input aria-label="Euro pro Stunde" type="number" min="0" step="5">
          <button class="del" aria-label="Rolle entfernen">×</button>`;
        const [n, c, rt] = row.querySelectorAll("input");
        const [typ, st] = row.querySelectorAll("select");
        if (!r.type) r.type = "custom"; // alte Einträge ohne Typ
        const sync = () => {
          const isAok = r.type.startsWith("aok-"), isCustom = r.type === "custom";
          st.classList.toggle("invisible", !isAok);
          st.disabled = !isAok;
          rt.readOnly = !isCustom;
          const a = annualOf(r);
          rt.value = isCustom ? r.rate ?? 0 : Math.round(rateOf(r) * 100) / 100;
          rt.title = a == null ? "" : `Jahresbrutto ${eur0.format(a)} ÷ ${HOURS.toLocaleString("de-DE")} Std.`;
        };
        n.value = r.name; c.value = r.count; typ.value = r.type; st.value = r.stufe || 4;
        sync();
        n.oninput = () => { r.name = n.value; this._save(); };
        c.oninput = () => { r.count = Math.max(0, +c.value || 0); this._save(); this._render(); };
        rt.oninput = () => { if (r.type !== "custom") return; r.rate = Math.max(0, +rt.value || 0); this._save(); this._render(); };
        typ.onchange = () => {
          if (typ.value === "custom") r.rate = Math.round(rateOf(r));
          r.type = typ.value;
          if (r.type.startsWith("aok-") && !r.stufe) r.stufe = 4;
          sync(); this._save(); this._render();
        };
        st.onchange = () => { r.stufe = +st.value; sync(); this._save(); this._render(); };
        row.querySelector(".del").onclick = () => { this._state.roles.splice(i, 1); this._save(); this._renderRows(); this._render(); };
        box.appendChild(row);
      });
    }

    _render() {
      const h = this._hourly(), ms = this._elapsed(), cost = (h * ms) / 3600000, on = this.running;
      const s = Math.floor(ms / 1000);
      this.$("total").innerHTML = num2.format(cost) + "<small>€</small>";
      this.$("elapsed").textContent = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((v) => String(v).padStart(2, "0")).join(":");
      this.$("perMin").textContent = eur.format(h / 60);
      this.$("people").textContent = this._people();
      this.$("hourly").textContent = eur0.format(h);
      let c = null; for (const x of COMPARISONS) if (cost >= x[0]) c = x;
      this.$("compare").textContent = c ? `Entspricht schon mehr als: ${c[1]} (${eur0.format(c[0])})` : " ";
      this.shadowRoot.querySelector(".status").classList.toggle("on", on);
      this.$("statusText").textContent = on ? "Läuft" : ms > 0 ? "Pausiert" : "Bereit";
      this.$("toggle").textContent = on ? "❚❚ Pause" : ms > 0 ? "▶ Weiter" : "▶ Start";
      this.dispatchEvent(new CustomEvent("taxameter-change", { detail: { cost, hourly: h, elapsedMs: ms, running: on } }));
    }
  }

  if (!customElements.get("meeting-taxameter")) customElements.define("meeting-taxameter", MeetingTaxameter);
})();
