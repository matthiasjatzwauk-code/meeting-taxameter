# Meeting-Taxameter

Zählt live, was das laufende Meeting kostet. Der Zähler läuft als Mini-Fenster
(Picture-in-Picture) über Teams und lässt sich als Fenster mit allen teilen.

## Dateien

| Datei | Zweck |
|---|---|
| `meeting-taxameter.js` | Die Web Component `<meeting-taxameter>`, ohne Abhängigkeiten |
| `index.html` | Seite mit Komponente und Knopf „Mini-Fenster öffnen“ |

## Lokal testen

```bash
python3 -m http.server 8765 --directory meeting-taxameter
```

Dann in **Chrome oder Edge** `http://localhost:8765` öffnen.

## In Teams benutzen

1. Seite in Chrome oder Edge öffnen und Rollen, Anzahl und Stundensätze eintragen.
2. **Mini-Fenster öffnen** klicken. Das Fenster bleibt über allen anderen Fenstern, auch über Teams.
3. Im Meeting **Start** drücken.
4. Damit alle den Betrag sehen: in Teams **Teilen → Fenster** und dann das Mini-Fenster wählen.

Firefox und Safari können kein Mini-Fenster, das im Vordergrund bleibt. Dort öffnet der Knopf ein normales kleines Fenster.

## Hosting auf GitHub Pages

1. Neues Repository anlegen und die beiden Dateien hochladen.
2. **Settings → Pages → Branch: main / root** einstellen.
3. Nach etwa einer Minute ist die Seite unter `https://<benutzername>.github.io/<repo>/` erreichbar.

Jeder andere statische Webserver funktioniert genauso, zum Beispiel ein Intranet-Server oder Azure Static Web Apps.

## Mitarbeitertypen und Stundensätze

Jede Zeile hat einen **Typ**. Daraus wird der Stundensatz berechnet:
**Jahresbrutto ÷ 1.700 produktive Stunden**, also 38,5-Std.-Woche abzüglich Urlaub und Feiertage.
Mit „Arbeitgeberkosten +21 %“ kommen die Sozialabgaben des Arbeitgebers pauschal dazu.

**AOK · BAT/AOK-Neu (VG 1–16, Stufe 1–7)**
- Grundlage ist die Monatsgrundvergütung ab 01.01.2026 (GdS-Tabelle, Quelle: tarifvertrag-online.de).
- Jahresbrutto = 12 × Monatswert + 100 % Weihnachtsgeld + Urlaubsgeld (460 € in VG 1–6, 320 € in VG 7–16).
- Zulagen, Zuschläge und Besitzstände sind nicht enthalten. Die Werte sind unverbindlich.
- Pflegen kannst du die Tabelle in `meeting-taxameter.js` in der Konstante `AOK`.
  Die laufende Tabelle gilt bis 31.03.2027, danach müssen die Werte aktualisiert werden.

**Berater (Jahresgesamtgehalt inkl. Bonus, grobe Marktwerte Deutschland)**

| Level | Jahresgehalt | ≈ € / Std. |
|---|---|---|
| Consultant | 70.000 € | 41 € |
| Senior Consultant | 88.000 € | 52 € |
| Manager | 115.000 € | 68 € |
| Senior Manager | 140.000 € | 82 € |
| Director | 175.000 € | 103 € |
| Partner | 250.000 € | 147 € |

Diese Werte sind Schätzungen. Die Spannen unterscheiden sich stark je nach Haus (Strategie, Big Four, Mittelstand).
Anpassen kannst du sie in der Konstante `CONSULTANTS`.
Hinweis: Für die Kosten aus Sicht der AOK wäre bei externen Beratern der **Tagessatz** realistischer als das Gehalt.

**Eigener Stundensatz:** Ein freier Wert, der von Hand eingetragen wird.

## Komponente woanders einbauen

```html
<script src="meeting-taxameter.js"></script>
<meeting-taxameter></meeting-taxameter>          <!-- volle Ansicht -->
<meeting-taxameter compact></meeting-taxameter>  <!-- nur Betrag + Start/Pause -->
```

Die Komponente bietet die Methoden `start()`, `pause()`, `toggle()` und `reset()`.
Sie meldet das Event `taxameter-change` mit `{ cost, hourly, elapsedMs, running }`.
Die Einstellungen liegen im `localStorage` des Browsers.

## Später: echte Teams-App

Dieselbe Komponente kann in eine Teams-Meeting-App gepackt werden, als Seitenpanel und
Anzeige auf der Meeting-Bühne, mit Live Share für einen gemeinsamen Stand. Voraussetzung:
In Teams unter *Apps → Apps verwalten → App hochladen* gibt es die Option „Benutzerdefinierte App hochladen“,
oder die IT gibt die App frei.
