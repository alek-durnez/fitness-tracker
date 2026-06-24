# KrachtLog

Een snelle, native-feeling Progressieve Web App (PWA) om je fitness- en krachttraining progressie naadloos bij te houden. Ontworpen voor mobiel (iOS-stijl navigatie), maar werkt net zo vloeiend op desktop. 

De app is volledig **serverless**: al je trainingsdata wordt veilig opgeslagen in je eigen, besloten GitHub repository via de GitHub REST API. Geen externe database of betaalde cloud nodig.

---

## Features

* **iOS-Style Bottom Navigation:** Altijd binnen handbereik van je duim tijdens een zware sessie.
* **Volledig Serverless (Cloud Sync):** Directe synchronisatie met een JSON-bestand (`gym-data.json`) in je eigen GitHub repo.
* **Progressie Grafieken:** Automatisch gegenereerde, responsieve SVG-lijngrafieken die je PR's (Persoonlijke Records) visualiseren per oefening.
* **Slimme UI Hulpmiddelen:** Snelselectie-chips voor je meest recente oefeningen en routines zodat je minder hoeft te typen tijdens het trainen.
* **Offline-First Caching:** Slaat je configuratie en logs op in `localStorage` zodat de app razendsnel opstart.
* **Veilig & Privacy-vriendelijk:** Geen tracking, geen analytics en jij bent de volledige eigenaar van je eigen data.

---

## rojectstructuur

Het project is modulair opgebouwd voor maximale onderhoudbaarheid in moderne IDE's zoals WebStorm:

```text
krachtlog-pro/
│
├── index.html          # De minimalistische HTML-basis
├── css/
│   └── style.css       # Donkere, moderne iOS-stijl CSS (met safe-area support)
└── js/
    ├── api.js          # De data-laag verantwoordelijk voor de GitHub API communicatie
    └── app.js          # De core applicatielogica, state management en UI-rendering
