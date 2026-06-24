(function () {
    "use strict";

    const LOCAL_STORAGE_CONFIG = "krachtlog-config-v3";
    const LOCAL_STORAGE_DATA = "krachtlog-data-v3";
    const ROUTINE_COLORS = { "Push": "#FF453A", "Pull A": "#FFD60A", "Pull B": "#30D158", "Legs": "#BF5AF2", "Arms": "#0A84FF" };

    function getRoutineColor(routine) { return ROUTINE_COLORS[routine] || "#8E8E93"; }
    function escapeHtml(str) { return String(str == null ? "" : str).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

    let config = { user: "", repo: "", token: "" };
    let entries = [];
    let cloudState = "unconfigured";
    let cloudErrorLog = "";
    let currentTab = "overzicht";

    let deleteConfirmationId = null;
    let selectedFilterRoutine = "all";
    let searchQuery = "";
    let activeChartExercise = "";

    let lastLoggedDate = getTodayDateString();
    let lastLoggedRoutine = "";
    let currentToastMessage = "";
    let toastTimeoutReference = null;

    function getTodayDateString() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }

    try {
        const storedConfig = localStorage.getItem(LOCAL_STORAGE_CONFIG);
        if (storedConfig) {
            config = JSON.parse(storedConfig);
            GitHubAPI.init(config);
        }
        const storedData = localStorage.getItem(LOCAL_STORAGE_DATA);
        if (storedData) entries = JSON.parse(storedData);
    } catch(e) { console.error("Cache laadfout", e); }

    function saveConfigToLocalStorage() { try { localStorage.setItem(LOCAL_STORAGE_CONFIG, JSON.stringify(config)); } catch(e){} }
    function saveEntriesToLocalStorage() { try { localStorage.setItem(LOCAL_STORAGE_DATA, JSON.stringify(entries)); } catch(e){} }

    function encodeUnicodeToBase64(stringToEncode) {
        return btoa(encodeURIComponent(stringToEncode).replace(/%([0-9A-F]{2})/g, (match, p1) => {
            return String.fromCharCode(parseInt(p1, 16));
        }));
    }

    async function syncDataFromCloud() {
        if (!config.user || !config.repo || !config.token) { cloudState = "unconfigured"; renderApplication(); return; }
        cloudState = "loading"; cloudErrorLog = ""; renderApplication();
        try {
            const response = await GitHubAPI.fetchDisconnect();
            if (!response) {
                cloudState = "error";
                cloudErrorLog = "Configfout: Ongeldige invoerparameters.";
                renderApplication();
                return;
            }

            if (response.status === 404) {
                const initResponse = await GitHubAPI.executeRequest("PUT", { message: "Initialiseer Logbestand", content: btoa(JSON.stringify(entries, null, 2)) });
                if (initResponse.ok) {
                    GitHubAPI.fileSha = (await initResponse.json()).content.sha;
                    cloudState = "synced";
                } else {
                    cloudState = "error";
                    cloudErrorLog = "Cloud initialisatie mislukt op GitHub.";
                }
            } else if (response.ok) {
                const payloadData = await response.json();
                GitHubAPI.fileSha = payloadData.sha;
                entries = JSON.parse(atob(payloadData.content.replace(/\s/g, '')));
                saveEntriesToLocalStorage(); cloudState = "synced";
            } else {
                cloudState = "error";
                cloudErrorLog = "GitHub server foutcode: " + response.status;
            }
        } catch(error) {
            cloudState = "error";
            cloudErrorLog = error instanceof Error ? error.message : String(error);
        }
        renderApplication();
    }

    async function pushDataToCloud(newEntriesList) {
        cloudState = "loading"; renderApplication();
        try {
            const base64Content = encodeUnicodeToBase64(JSON.stringify(newEntriesList, null, 2));
            const commitPayload = { message: "Update: " + getTodayDateString(), content: base64Content, sha: GitHubAPI.fileSha };
            const response = await GitHubAPI.executeRequest("PUT", commitPayload);
            if (response.ok) {
                GitHubAPI.fileSha = (await response.json()).content.sha;
                entries = newEntriesList;
                saveEntriesToLocalStorage();
                cloudState = "synced";
            } else {
                cloudState = "error";
                cloudErrorLog = "Push geweigerd door GitHub: status " + response.status;
            }
        } catch (error) {
            cloudState = "error";
            cloudErrorLog = error instanceof Error ? error.message : String(error);
            entries = newEntriesList;
            saveEntriesToLocalStorage();
        }
        renderApplication();
    }

    function processAnalytics(dataList) {
        const exerciseGroups = {}; dataList.forEach(item => { (exerciseGroups[item.exercise] = exerciseGroups[item.exercise] || []).push(item); });
        const recordMap = {}, progressCurves = {};
        Object.keys(exerciseGroups).forEach(exName => {
            const trackingMap = {}; exerciseGroups[exName].forEach(item => { trackingMap[item.date] = Math.max(trackingMap[item.date] || 0, item.weight); });
            const chronologicalDates = Object.keys(trackingMap).sort();
            let peakWeightValue = -Infinity, dataPointsCurve = [];
            chronologicalDates.forEach((dateString, idx) => {
                const weightOnDay = trackingMap[dateString];
                const achievedNewPR = idx === 0 || weightOnDay > peakWeightValue;
                if (achievedNewPR) recordMap[exName + "|" + dateString] = true;
                dataPointsCurve.push({ date: dateString, weight: weightOnDay, isPR: achievedNewPR });
                peakWeightValue = Math.max(peakWeightValue, weightOnDay);
            });
            progressCurves[exName] = dataPointsCurve;
        });
        return { prKeys: recordMap, exerciseSeries: progressCurves };
    }

    function formatHumanReadableDate(isoString) {
        if(!isoString) return ""; const parts = isoString.split('-');
        return new Date(parts[0], parts[1] - 1, parts[2]).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });
    }

    function triggerToast(messageText) {
        currentToastMessage = messageText; renderApplication();
        if (toastTimeoutReference) clearTimeout(toastTimeoutReference);
        toastTimeoutReference = setTimeout(() => { currentToastMessage = ""; const t = document.getElementById("toast"); if (t) t.style.display = "none"; }, 2200);
    }

    function generateAdvancedSVGChart(dataPoints) {
        if (!dataPoints || dataPoints.length === 0) return '<div class="empty">Geen progressiedata beschikbaar.</div>';
        const canvasW = 600, canvasH = 260, padLeft = 65, padRight = 30, padTop = 30, padBottom = 40;
        const weightValues = dataPoints.map(p => p.weight);
        const absoluteMinWeight = Math.max(0, Math.min(...weightValues) - 5);
        const absoluteMaxWeight = Math.max(...weightValues) + 5;
        const dataRange = (absoluteMaxWeight - absoluteMinWeight) || 1;
        const horizontalStepSize = dataPoints.length > 1 ? (canvasW - padLeft - padRight) / (dataPoints.length - 1) : 0;

        const calculateXCoordinate = index => padLeft + index * horizontalStepSize;
        const calculateYCoordinate = val => canvasH - padBottom - ((val - absoluteMinWeight) / dataRange) * (canvasH - padTop - padBottom);

        const polylinePointsString = dataPoints.map((p, i) => `${calculateXCoordinate(i)},${calculateYCoordinate(p.weight)}`).join(" ");
        const referenceGridWeights = [absoluteMinWeight, (absoluteMinWeight + absoluteMaxWeight) / 2, absoluteMaxWeight];

        const svgGridMarkup = referenceGridWeights.map(val => {
            const yPos = calculateYCoordinate(val);
            return `<line x1="${padLeft}" y1="${yPos}" x2="${canvasW - padRight}" y2="${yPos}" stroke="#2C2C32" stroke-dasharray="4"/>
                   <text x="${padLeft - 10}" y="${yPos + 4}" font-size="11" font-weight="600" class="text-steel" text-anchor="end">${Math.round(val)} kg</text>`;
        }).join("");

        const svgNodesMarkup = dataPoints.map((p, i) => {
            const xPos = calculateXCoordinate(i), yPos = calculateYCoordinate(p.weight);
            return `<circle cx="${xPos}" cy="${yPos}" r="6" class="${p.isPR ? 'bg-brass' : 'bg-rust'}" stroke="#16161A" stroke-width="2"/>
                   <text x="${xPos}" y="${yPos - 10}" font-size="11" font-weight="700" class="text-chalk" text-anchor="middle">${p.weight} kg</text>`;
        }).join("");

        const svgTimelineMarkup = dataPoints.map((p, i) => {
            if (i === 0 || i === dataPoints.length - 1 || dataPoints.length <= 5) {
                return `<text x="${calculateXCoordinate(i)}" y="${canvasH - 12}" font-size="11" class="text-steel" text-anchor="middle">${formatHumanReadableDate(p.date).split(' 20')[0]}</text>`;
            } return "";
        }).join("");

        return `<svg viewBox="0 0 ${canvasW} ${canvasH}" style="width:100%; height:auto; overflow:visible;">${svgGridMarkup}
               <polyline points="${polylinePointsString}" fill="none" stroke="#FF453A" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>${svgNodesMarkup}${svgTimelineMarkup}</svg>`;
    }

    function renderApplication() {
        const calculatedStats = processAnalytics(entries);
        const sortedDistinctExercises = [...Object.keys(calculatedStats.exerciseSeries)].sort();
        if (!activeChartExercise || sortedDistinctExercises.indexOf(activeChartExercise) === -1) activeChartExercise = sortedDistinctExercises[0] || "";

        let templateHTML = currentToastMessage ? `<div class="toast" id="toast">${escapeHtml(currentToastMessage)}</div>` : '';
        templateHTML += '<header><div class="wrap header-inner"><div class="brand"><h1>KrachtLog Pro</h1></div></div></header>';
        templateHTML += '<main class="wrap">';

        let statusColor = "#8E8E93", statusMessage = "Niet Verbonden";
        if (cloudState === "loading") { statusColor = "#FFD60A"; statusMessage = "Cloud Sync..."; }
        else if (cloudState === "synced") { statusColor = "#30D158"; statusMessage = "Beveiligde Cloud Actief"; }
        else if (cloudState === "error") { statusColor = "#FF453A"; statusMessage = "Sync Fout"; }

        templateHTML += `<div class="cloud-bar"><span style="width:10px; height:10px; border-radius:50%; background:${statusColor}; display:inline-block;"></span>${statusMessage}</div>`;
        if (cloudState === "error") templateHTML += `<div class="cloud-log border-error-log">${escapeHtml(cloudErrorLog)}</div>`;

        if (currentTab === "settings") templateHTML += generateSettingsTabHTML();
        else if (currentTab === "loggen") templateHTML += generateLogTabHTML(sortedDistinctExercises);
        else if (currentTab === "geschiedenis") templateHTML += generateHistoryTabHTML(calculatedStats);
        else templateHTML += generateDashboardTabHTML(calculatedStats, sortedDistinctExercises);

        templateHTML += '</main>';

        templateHTML += '<nav>';
        const tabDefinitions = [
            ["overzicht", "Dashboard", "📊"],
            ["loggen", "+ Set Log", "💪"],
            ["geschiedenis", "Historie", "⏱️"],
            ["settings", "Instellingen", "⚙️"]
        ];
        tabDefinitions.forEach(tabSpec => {
            templateHTML += `
                <button class="${currentTab === tabSpec[0] ? "tab-btn active" : "tab-btn"}" data-action="switch-tab" data-target-tab="${tabSpec[0]}">
                    <span class="nav-icon">${tabSpec[2]}</span>
                    <span>${tabSpec[1]}</span>
                </button>`;
        });
        templateHTML += '</nav>';

        document.getElementById("app").innerHTML = templateHTML;

        if (currentTab === "overzicht" && activeChartExercise) {
            const targetNode = document.getElementById("chart-container");
            if (targetNode) targetNode.innerHTML = generateAdvancedSVGChart(calculatedStats.exerciseSeries[activeChartExercise]);
        }
    }

    function generateDashboardTabHTML(stats, distinctExercises) {
        const uniqueLoggedDates = {}; entries.forEach(item => { uniqueLoggedDates[item.date] = true; });
        let html = `<div class="stat-grid">
            <div class="stat-card"><div class="stat-label">Sessies</div><div class="stat-value">${Object.keys(uniqueLoggedDates).length}</div></div>
            <div class="stat-card"><div class="stat-label">Oefeningen</div><div class="stat-value">${distinctExercises.length}</div></div>
            <div class="stat-card"><div class="stat-label">PR's</div><div class="stat-value text-brass">${Object.keys(stats.prKeys).length}</div></div>
        </div>`;

        html += '<div class="card"><h3 class="section-title">Laatste Complete Trainingssessie</h3>';
        const descendingDates = Object.keys(uniqueLoggedDates).sort().reverse();
        if (descendingDates.length > 0) {
            const mostRecentDate = descendingDates[0];
            const targetSessionEntries = entries.filter(item => item.date === mostRecentDate);
            const routineName = targetSessionEntries[0].routine || "Algemeen";
            html += `<div style="margin-bottom:12px; display:flex; align-items:center; gap:8px;"><span style="width:10px; height:10px; border-radius:50%; background:${getRoutineColor(routineName)};"></span>
                    <span style="font-weight:700; font-size:16px;" class="text-brass">${formatHumanReadableDate(mostRecentDate)} &ndash; ${escapeHtml(routineName)}</span></div>`;
            targetSessionEntries.forEach(entry => {
                html += `<div class="session-block"><div class="session-exercise">${escapeHtml(entry.exercise)}</div>
                        <div class="session-meta">${entry.weight} kg &times; ${entry.sets} sets &times; ${entry.reps} reps ${entry.notes ? ` <span class="text-steel" style="font-style:italic;">(${escapeHtml(entry.notes)})</span>` : ''}</div></div>`;
            });
        } else { html += '<div class="empty">Nog geen trainingen gelogd.</div>'; }
        html += '</div>';

        html += '<div class="card"><div class="flex between center-v" style="margin-bottom:14px;"><h3 class="section-title" style="margin:0;">Progressie Volger</h3>';
        if (distinctExercises.length > 0) {
            html += '<select id="chart-exercise-selector" style="width:auto; padding:8px 12px; font-size:14px;">';
            distinctExercises.forEach(ex => { html += `<option value="${escapeHtml(ex)}"${ex === activeChartExercise ? " selected" : ""}>${escapeHtml(ex)}</option>`; });
            html += '</select>';
        }
        html += '</div><div id="chart-container" class="chart-container"></div></div>';
        return html;
    }

    function generateLogTabHTML(distinctExercises) {
        const historicRoutinesMap = {}; entries.forEach(item => { if(item.routine) historicRoutinesMap[item.routine] = true; });
        const sortedRoutines = Object.keys(historicRoutinesMap).sort();

        let html = `<form id="exercise-logging-form" class="card"><h3 class="section-title">Nieuwe Trainingsset Vastleggen</h3>
            <div class="grid3" style="grid-template-columns: 1.2fr 1fr; margin-bottom:14px;">
                <div class="field"><label>Datum</label><input type="date" name="date" value="${escapeHtml(lastLoggedDate)}"></div>
                <div class="field"><label>Routine</label><input type="text" id="log-routine-input" list="dl-routines" name="routine" value="${escapeHtml(lastLoggedRoutine)}" placeholder="Kies of typ..."><datalist id="dl-routines">`;
        sortedRoutines.forEach(r => { html += `<option value="${escapeHtml(r)}">`; });
        html += '</datalist></div></div>';

        if (sortedRoutines.length > 0) {
            html += '<div style="margin-top:-6px; margin-bottom:12px;"><span class="stat-label" style="font-size:10px;">Snelselectie routine:</span><div class="pill-container">';
            sortedRoutines.forEach(r => { html += `<button type="button" class="pill pill-active-state" data-action="quick-fill-routine" data-value="${escapeHtml(r)}">${escapeHtml(r)}</button>`; });
            html += '</div></div>';
        }

        html += `<div class="field"><label>Oefening</label><input type="text" id="log-exercise-input" list="dl-exercises" name="exercise" placeholder="Kies of typ..." autocomplete="off"><datalist id="dl-exercises">`;
        distinctExercises.forEach(ex => { html += `<option value="${escapeHtml(ex)}">`; });
        html += '</datalist></div>';

        if (distinctExercises.length > 0) {
            let recentExercises = [];
            for (let i = entries.length - 1; i >= 0; i--) {
                if (recentExercises.indexOf(entries[i].exercise) === -1) recentExercises.push(entries[i].exercise);
                if (recentExercises.length >= 5) break;
            }
            if (recentExercises.length === 0) recentExercises = distinctExercises.slice(0, 5);

            html += '<div style="margin-top:-6px; margin-bottom:12px;"><span class="stat-label" style="font-size:10px;">Laatst gebruikte oefeningen:</span><div class="pill-container">';
            recentExercises.forEach(ex => { html += `<button type="button" class="pill pill-active-state" data-action="quick-fill-exercise" data-value="${escapeHtml(ex)}">${escapeHtml(ex)}</button>`; });
            html += '</div></div>';
        }

        html += `<div class="grid3" style="margin-bottom:16px;">
            <div class="field"><label>Gewicht (kg)</label><input type="number" step="0.25" name="weight" placeholder="0"></div>
            <div class="field"><label>Sets</label><input type="number" name="sets" value="3"></div>
            <div class="field"><label>Reps</label><input type="number" name="reps" value="10"></div>
        </div><div class="field" style="margin-bottom:18px;"><label>Notities</label><input type="text" name="notes" placeholder="Optioneel"></div>
        <div id="form-validation-error" style="display:none; color:#FF453A; font-size:14px; font-weight:600; margin-bottom:14px;"></div>
        <button type="submit" class="btn-primary">Opslaan in Cloud</button></form>`;
        return html;
    }

    function generateHistoryTabHTML(stats) {
        const historicRoutinesMap = {}; entries.forEach(item => { if(item.routine) historicRoutinesMap[item.routine] = true; });
        let html = `<div class="card" style="margin-bottom:14px; padding:12px;"><div class="grid3" style="grid-template-columns: 1fr 1.3fr; gap:8px;">
            <select id="history-routine-filter-node"><option value="all">Alle Sessies</option>`;
        Object.keys(historicRoutinesMap).sort().forEach(r => { html += `<option value="${escapeHtml(r)}"${r === selectedFilterRoutine ? " selected" : ""}>${escapeHtml(r)}</option>`; });
        html += `</select><input id="history-search-input-node" placeholder="Filter oefening..." value="${escapeHtml(searchQuery)}"></div></div>`;

        const recordsFiltered = entries.filter(item => {
            if (selectedFilterRoutine !== "all" && item.routine !== selectedFilterRoutine) return false;
            if (searchQuery.trim() && item.exercise.toLowerCase().indexOf(searchQuery.trim().toLowerCase()) === -1) return false;
            return true;
        });

        const dayContainers = {}; recordsFiltered.forEach(item => { (dayContainers[item.date] = dayContainers[item.date] || []).push(item); });
        const timelineSortedDates = Object.keys(dayContainers).sort().reverse();
        if (timelineSortedDates.length === 0) return html + '<div class="empty">Geen resultaten.</div>';

        timelineSortedDates.forEach(dateKey => {
            const subsetLogs = dayContainers[dateKey]; const sessionRoutineName = subsetLogs[0].routine || "Algemeen";
            html += `<div class="card" style="padding:14px 16px;"><div class="flex between center-v" style="border-bottom:1px solid #323238; padding-bottom:8px; margin-bottom:10px;">
                <div class="flex center-v"><span style="width:8px; height:8px; border-radius:50%; background:${getRoutineColor(sessionRoutineName)}; margin-right:8px;"></span>
                <b style="font-size:15px;">${formatHumanReadableDate(dateKey)}</b><span class="text-steel" style="font-size:13px; margin-left:8px; font-weight:600;">${escapeHtml(sessionRoutineName)}</span></div></div>`;

            subsetLogs.forEach(entry => {
                const hasDayPR = stats.prKeys[entry.exercise + "|" + entry.date];
                html += `<div class="flex between center-v" style="padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.02);">
                    <div><span style="font-size:15px; font-weight:600;">${escapeHtml(entry.exercise)}</span>${hasDayPR ? ' <span class="text-brass" style="font-size:11px; font-weight:800; background:#2C2512; padding:2px 6px; border-radius:4px; margin-left:4px;">★ PR</span>' : ''}
                    <div class="mono text-steel" style="font-size:13px; margin-top:2px;">${entry.weight} kg &times; ${entry.sets} &times; ${entry.reps} ${entry.notes ? `<i>(${escapeHtml(entry.notes)})</i>` : ''}</div></div>`;
                if (deleteConfirmationId === entry.id) {
                    html += `<div class="flex gap8"><button class="btn-danger" data-action="execute-delete" data-target-id="${entry.id}">Wissen</button><button class="btn-secondary" data-action="abort-delete">Nee</button></div>`;
                } else { html += `<button class="icon-btn" data-action="trigger-delete-flow" data-target-id="${entry.id}">✕</button>`; }
                html += '</div>';
            });
            html += '</div>';
        });
        return html;
    }

    function generateSettingsTabHTML() {
        return `<div class="card"><h3 class="section-title">GitHub API Connectie</h3>
            <div class="field"><label>Username</label><input type="text" id="input-cfg-user" value="${escapeHtml(config.user)}"></div>
            <div class="field"><label>Repository</label><input type="text" id="input-cfg-repo" value="${escapeHtml(config.repo)}"></div>
            <div class="field"><label>Token (PAT)</label><input type="password" id="input-cfg-token" value="${escapeHtml(config.token)}"></div>
            <button class="btn-primary" data-action="commit-settings" style="margin-top:6px;">Instellingen Opslaan</button>
            <hr style="border:none; border-top:1px solid #323238; margin:18px 0;"><button class="btn-secondary" data-action="purge-local-cache" style="width:100%; color:#FF453A; background:#1C1212;">Wipe Browser Cache & Herstart</button></div>`;
    }

    document.addEventListener("click", event => {
        const targetNode = event.target.closest("[data-action]"); if (!targetNode) return;
        const contextAction = targetNode.dataset.action;

        if (contextAction === "switch-tab") { currentTab = targetNode.dataset.targetTab; renderApplication(); }
        else if (contextAction === "commit-settings") {
            config.user = document.getElementById("input-cfg-user").value.trim();
            config.repo = document.getElementById("input-cfg-repo").value.trim();
            config.token = document.getElementById("input-cfg-token").value.trim();
            GitHubAPI.init(config);
            saveConfigToLocalStorage(); triggerToast("Instellingen opgeslagen."); syncDataFromCloud();
        }
        else if (contextAction === "purge-local-cache") {
            if(confirm("Lokalecache wissen? Dit start de app volledig schoon op.")) {
                localStorage.clear(); config = { user: "", repo: "", token: "" }; entries = []; GitHubAPI.fileSha = null; cloudState = "unconfigured";
                triggerToast("Cache gewist."); renderApplication();
            }
        }
        else if (contextAction === "quick-fill-routine") {
            const inputField = document.getElementById("log-routine-input"); if (inputField) inputField.value = targetNode.dataset.value;
        }
        else if (contextAction === "quick-fill-exercise") {
            const inputField = document.getElementById("log-exercise-input"); if (inputField) inputField.value = targetNode.dataset.value;
        }
        else if (contextAction === "trigger-delete-flow") { deleteConfirmationId = targetNode.dataset.targetId; renderApplication(); }
        else if (contextAction === "abort-delete") { deleteConfirmationId = null; renderApplication(); }
        else if (contextAction === "execute-delete") {
            const filteredEntries = entries.filter(x => x.id !== targetNode.dataset.targetId);
            deleteConfirmationId = null; pushDataToCloud(filteredEntries); triggerToast("Set verwijderd.");
        }
    });

    document.addEventListener("change", event => {
        if (event.target.id === "history-routine-filter-node") { selectedFilterRoutine = event.target.value; renderApplication(); }
        else if (event.target.id === "chart-exercise-selector") { activeChartExercise = event.target.value; renderApplication(); }
    });
    document.addEventListener("input", event => {
        if (event.target.id === "history-search-input-node") { searchQuery = event.target.value; renderApplication(); }
    });

    document.addEventListener("submit", event => {
        if (event.target.id !== "exercise-logging-form") return; event.preventDefault();
        const fields = event.target.elements;
        const date = fields["date"].value, routine = fields["routine"].value.trim(), exercise = fields["exercise"].value.trim();
        const weight = parseFloat(fields["weight"].value), sets = parseInt(fields["sets"].value, 10), reps = fields["reps"].value, notes = fields["notes"].value.trim();

        if (!date || !routine || !exercise || isNaN(weight)) {
            const err = document.getElementById("form-validation-error"); err.textContent = "Vul alle verplichte velden in."; err.style.display = "block"; return;
        }

        const generatedLog = { id: "set-" + Date.now(), date, routine, exercise, weight, sets, reps, notes };
        lastLoggedDate = date; lastLoggedRoutine = routine;
        const updatedList = [...entries, generatedLog];
        pushDataToCloud(updatedList); triggerToast("Opgeslagen!"); currentTab = "overzicht"; renderApplication();
    });

    syncDataFromCloud();
})();