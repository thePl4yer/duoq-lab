# DuoQ Lab

Rocket-League-Dashboard für **Kate** (`76561198058377116`) und **P L 4 Y E R** (`76561198060138310`). Statische Website für GitHub Pages mit echter, lokaler `.replay`-Analyse über WebAssembly. Kein Server, kein API-Schlüssel und kein Upload zu Dritten für die Dateianalyse nötig.

## Start

Node.js 24 oder neuer:

```sh
npm install --ignore-scripts
npm test
npm run build
npm run dev
```

Dann `http://127.0.0.1:4173` öffnen. `dist/` ist die veröffentlichbare Website. Die WASM-Datei wird aus der exakt gepinnten MIT-Abhängigkeit `@rlrml/subtr-actor@1.5.1` kopiert. Die Website muss über HTTP(S) laufen; einfaches Öffnen von `index.html` als `file://` unterstützt keine Modul-Worker.

## Statistikansichten

* **Zusammen:** beide Steam-IDs im selben Team; beide haben dieselbe Match-Auswahl.
* **Solo:** genau einer der Spieler im Match; jeder hat seinen eigenen Nenner.
* **Overall:** alle eigenen Matches; einschließlich gemeinsamer Spiele und Begegnungen gegeneinander.

Datum und Spielmodus filtern die Statistikansicht. Die Bibliothek hat zusätzliche Tabellenfilter und eine Suchfunktion. Eigene Uploads können einzeln, mehrfach, per Drag-and-drop oder als Ordner ausgewählt werden. Dateien ohne eine der Ziel-IDs werden nach der Metadatenprüfung übersprungen.

Angezeigt werden Spiele, Siege, Niederlagen, Winrate, Tore, Vorlagen, Schüsse, Paraden, Demolierungen, zeitgewichtete Durchschnittsgeschwindigkeit, Supersonic-/Luft-Anteil, gesammelter Boost pro Minute, geklauter Boost sowie große/kleine geklaute Pads. Bumps untereinander werden aus Fahrzeugbewegungen geschätzt und mit ihrer Datenabdeckung dargestellt. Demolierungen sind separat.

„Boost geklaut“ meint Boost in der gegnerischen Hälfte, keinen einem bestimmten Mitspieler gehörenden Boost. Die zusätzliche Spaßstatistik „Kate schnappt PLAYER den Boost weg“ nutzt eine konservative Pad-Heuristik: tatsächliche Aufnahme durch Kate, PLAYER mit weniger als 50 Boost, innerhalb 800 uu, mit mehr als 300 uu/s und Richtungsübereinstimmung über 0,6 auf dasselbe Pad zufahrend, Zustandsalter höchstens 0,15 s. Nur bestätigte Standard-Pad-Geometrie; Hoops bleibt unbekannt, Dropshot ist nicht anwendbar. Die Anzeige ist eine beobachtete Untergrenze, kein Beleg für Absicht.

## Datenbasis vom 18.11.2026

362 lokale Replay-Dateien im Benutzerordner gefunden. 360 Metadaten lesbar: 355 mit mindestens einem Zielspieler, fünf ohne beide. Alle 355 Ziel-Replays wurden vollständig analysiert, ohne Analysefehler. 29 enthalten beide Spieler (28 gemeinsam, eines gegeneinander), 326 nur PLAYER. Keine Kate-Solo-Dateien vorhanden.

Zusätzlich fünf öffentliche, anhand beider Steam-IDs bestätigte Ballchasing-Replays (vier Hoops, ein Standard). Insgesamt **360 eindeutige Matches**: **33 zusammen**, **326 solo**, **eines gegeneinander**. Das ist eine Replay-Auswahl, keine vollständige Account-Historie. Gespeicherte Replays können Siege überrepräsentieren. Eine beschädigte Datei hat unbekannte Zugehörigkeit; eine weitere scheitert an einem nicht unterstützten Spieltyp. Ein Diagnoseordner konnte nicht gelesen werden. Es werden keine Original-Replays, absoluten lokalen Dateipfade oder fremden Spielerprofile ausgeliefert.

Das öffentliche Standard-Replay meldet unzuverlässige Boostdaten. Seine Boostwerte sind aus Boost-Aggregaten ausgeschlossen, seine Bewegungs- und Ergebniswerte bleiben enthalten.

## Aktuelle Tracker-Daten

Die Profile waren über direkte HTTP-Abrufe gesperrt, konnten anschließend im Browser ausgelesen werden. `data/tracker.json` enthält den datierten Snapshot vom 18.11.2026: aktuelle Ränge und MMR für Standard, 2v2, Hoops, Dropshot, Snow Day und Rumble, Saison-Matchzahlen und Lifetime-Siege. Die englische Website zeigt diese Werte getrennt von den Replay-Statistiken.

Tracker gruppiert Sitzungen; Zeitstempel sind Erfassungszeiten und keine Spielzeiten. Die sichtbaren Profile liefern keine gemeinsamen Match-IDs, Mitspielerlisten oder vollständigen passenden Niederlagenzahlen. Eine exakte gemeinsame/Solo-/Overall-Winrate kann deshalb daraus nicht ermittelt werden. Insbesondere dürfen Lifetime-Siege nicht durch aktuelle Saison-Matches geteilt werden. Replay-Winrates sind klar als Stichprobe beschriftet. Es gibt keinen automatischen Tracker-Sync; neue Snapshot-Werte erfordern Browser-Recherche oder einen Import. Manuelle Rangwerte und Tracker-JSON-Importe sind weiterhin möglich.

## Speicherung

Die ausgelieferte `data/seed.json` ist Teil der öffentlichen Website. Neue Replay-Dateien werden lokal im Browser analysiert. Bei aktivierter Option **Share analysed statistics publicly** werden ihre kompakten Auswertungen in der gemeinsamen D1-Bibliothek gespeichert und sind für alle Besucher sichtbar. Originaldateien werden nicht an den Server geschickt. Die API akzeptiert nur Statistiken für Kate und PLAYER, prüft Format und Größenlimits und ergänzt neue Match-IDs; bestehende Datensätze werden nicht überschrieben. Die gemeinsame Bibliothek wird beim Seitenaufruf geladen. Ist sie kurzzeitig nicht erreichbar, bleiben das mitgelieferte Dataset und lokale Analysen verfügbar; fehlgeschlagene Veröffentlichungen können erneut versucht werden.

Bei deaktivierter Freigabe bleibt ein Import in IndexedDB dieses Browsers. Manuelle Ränge sind ebenfalls browserlokal. JSON-Export und -Import dienen als Backup/Übertragung. Das Zurücksetzen des Browsers löscht keine bereits veröffentlichten Einträge. Die API-Implementierung und Migrationen liegen im benachbarten Projekt `duoq-api`; die GitHub-Pages-Oberfläche verwendet `src/shared-library.js`. Eigene Ballchasing-Detail-JSONs können importiert werden. Automatische Ballchasing-API-Abrufe und Dateidownloads benötigen einen persönlichen Schlüssel und sind nicht implementiert.

## GitHub Pages

Der Workflow `.github/workflows/pages.yml` installiert die gepinnte Abhängigkeit, führt die Statistiktests aus, baut `dist/` und veröffentlicht über GitHub Pages. Im Repository unter **Settings → Pages → Source: GitHub Actions** aktivieren. Relative Asset-Pfade unterstützen Projekt-URLs wie `https://<account>.github.io/duoq-lab/`.

## Quellen

* [subtr-actor](https://github.com/rlrml/subtr-actor), MIT, Version 1.5.1 (WASM-Parser und abgeleitete Ereignisse)
* [Ballchasing API-Dokumentation](https://ballchasing.com/doc/api)
* Öffentliche Replay-Quellen direkt in `data/seed.json` und in der Detailansicht
* [Kate auf Steam](https://steamcommunity.com/profiles/76561198058377116/)
* [PLAYER auf Steam](https://steamcommunity.com/id/JustAHonestGuy/)

Unabhängiges Fanprojekt. Rocket League® ist eine Marke der jeweiligen Rechteinhaber.
