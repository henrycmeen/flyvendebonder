(() => {
  const refs = {
    map: document.getElementById("map"),
    status: document.getElementById("status"),
    propertyLabel: document.getElementById("property-label"),
    propertyStatus: document.getElementById("property-status"),
    toggleProperty: document.getElementById("toggle-property"),
    refreshJobId: document.getElementById("refresh-jobid"),
    photoPanel: document.getElementById("photo-panel"),
    timeSlider: document.getElementById("time-slider"),
    dateMin: document.getElementById("date-min"),
    dateCurrent: document.getElementById("date-current"),
    dateMax: document.getElementById("date-max"),
    prevDay: document.getElementById("prev-day"),
    nextDay: document.getElementById("next-day"),
    playPause: document.getElementById("play-pause"),
    modeCumulative: document.getElementById("mode-cumulative"),
    photoStrip: document.getElementById("photo-strip"),
  };

  if (!refs.map || !refs.timeSlider || !refs.photoStrip) {
    return;
  }

  const state = {
    photos: [],
    dates: [],
    dayIndex: 0,
    activePhotoId: null,
    cumulative: true,
    map: null,
    clusterLayer: null,
    markersById: new Map(),
    playTimer: null,
    propertyOverlayEnabled: true,
    propertyJobId: null,
    propertyLayer: null,
    propertyFetchWarning: null,
  };

  const PROPERTY = {
    owner: "Roar Meen",
    komm: "3807",
    gnr: 70,
    bnr: 17,
    fnr: 0,
  };

  const JOBID_STORAGE_KEY = `gardskart_jobid_${PROPERTY.komm}_${PROPERTY.gnr}_${PROPERTY.bnr}_${PROPERTY.fnr}`;
  const JOBID_TTL_MS = 6 * 24 * 60 * 60 * 1000;

  const safeText = (value) => String(value || "").replace(/[&<>"']/g, (char) => {
    const chars = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return chars[char] || char;
  });

  const formatDate = (value) => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleDateString("nb-NO", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  const propertyIdString = () => `${PROPERTY.komm}-${PROPERTY.gnr}/${PROPERTY.bnr}/${PROPERTY.fnr}`;

  const setPropertyStatus = (text) => {
    if (refs.propertyStatus) refs.propertyStatus.textContent = text;
  };

  const readStoredJobId = () => {
    try {
      const raw = window.localStorage.getItem(JOBID_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.jobId || !parsed?.fetchedAt) return null;
      return parsed;
    } catch {
      return null;
    }
  };

  const writeStoredJobId = (jobId) => {
    try {
      window.localStorage.setItem(
        JOBID_STORAGE_KEY,
        JSON.stringify({ jobId, fetchedAt: Date.now() }),
      );
    } catch {
      // ignore storage failures
    }
  };

  const getParams = () => new URLSearchParams(window.location.search);

  const setParams = (updates) => {
    const params = getParams();
    Object.entries(updates).forEach(([key, value]) => {
      if (!value) params.delete(key);
      else params.set(key, value);
    });
    const query = params.toString();
    const next = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    window.history.replaceState({}, "", next);
  };

  const popupHtml = (feature) => {
    const props = feature.properties;
    return `
      <article class="popup">
        <img src="${safeText(props.thumbnail)}" alt="${safeText(props.title)}" loading="lazy" />
        <h4>${safeText(props.title)}</h4>
        <p>${safeText(formatDate(props.date))}</p>
      </article>
    `;
  };

  const setPanel = (feature) => {
    if (!feature) {
      refs.photoPanel.innerHTML = `
        <h2 class="photo-panel__title">Ingen treff</h2>
        <p class="photo-panel__meta">Ingen bilder i valgt tidsvisning.</p>
      `;
      return;
    }

    const props = feature.properties;
    refs.photoPanel.innerHTML = `
      <h2 class="photo-panel__title">${safeText(props.title)}</h2>
      <p class="photo-panel__meta">${safeText(formatDate(props.date))} · ${safeText(props.tags.join(", "))}</p>
      <img class="photo-panel__image" src="${safeText(props.image)}" alt="${safeText(props.title)}" loading="lazy" />
      <p class="photo-panel__caption">${safeText(props.caption)}</p>
    `;
  };

  const stopPlayback = () => {
    if (state.playTimer) {
      window.clearInterval(state.playTimer);
      state.playTimer = null;
    }
    refs.playPause.textContent = "Spill av";
  };

  const buildMarkers = (features) => {
    state.markersById.clear();
    state.clusterLayer.clearLayers();

    features.forEach((feature) => {
      const [lng, lat] = feature.geometry.coordinates;
      const marker = L.marker([lat, lng]);
      marker.bindPopup(popupHtml(feature), {
        closeButton: false,
        autoPanPadding: [24, 24],
      });
      marker.on("click", () => {
        focusPhoto(feature.properties.id, { panMap: false, updateUrl: true });
      });
      state.clusterLayer.addLayer(marker);
      state.markersById.set(feature.properties.id, marker);
    });
  };

  const currentDate = () => state.dates[state.dayIndex] || null;

  const visiblePhotos = () => {
    const selected = currentDate();
    if (!selected) return [];

    if (state.cumulative) {
      return state.photos.filter((feature) => feature.properties.date <= selected);
    }
    return state.photos.filter((feature) => feature.properties.date === selected);
  };

  const updateStrip = (features) => {
    refs.photoStrip.innerHTML = "";

    if (features.length === 0) {
      refs.photoStrip.innerHTML = '<li class="photo-strip__item"><button type="button">Ingen bilder</button></li>';
      return;
    }

    const sorted = [...features].sort((a, b) => String(a.properties.date).localeCompare(String(b.properties.date)));

    sorted.forEach((feature) => {
      const props = feature.properties;
      const item = document.createElement("li");
      item.className = "photo-strip__item";
      item.dataset.photoId = props.id;

      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("aria-label", `Vis ${props.title}`);
      button.innerHTML = `<img src="${safeText(props.thumbnail)}" alt="${safeText(props.title)}" loading="lazy" />`;
      button.addEventListener("click", () => {
        focusPhoto(props.id, { panMap: true, updateUrl: true });
      });

      item.appendChild(button);
      refs.photoStrip.appendChild(item);
    });
  };

  const markStripActive = () => {
    refs.photoStrip.querySelectorAll(".photo-strip__item").forEach((item) => {
      if (item.dataset.photoId === state.activePhotoId) item.classList.add("is-active");
      else item.classList.remove("is-active");
    });
  };

  const focusPhoto = (photoId, options = {}) => {
    const { panMap = true, updateUrl = true } = options;
    const feature = state.photos.find((candidate) => candidate.properties.id === photoId);
    const marker = state.markersById.get(photoId);
    if (!feature || !marker) return;

    state.activePhotoId = photoId;
    setPanel(feature);
    markStripActive();

    if (panMap) {
      state.map.setView(marker.getLatLng(), Math.max(14, state.map.getZoom()), { animate: true });
      marker.openPopup();
    }

    if (updateUrl) {
      setParams({
        date: currentDate(),
        photo: state.activePhotoId,
        mode: state.cumulative ? "cumulative" : "day",
      });
    }
  };

  const updateStatus = (count, selectedDate) => {
    const modeText = state.cumulative ? "t.o.m." : "kun";
    refs.status.textContent = `${count} bilder vist (${modeText} ${formatDate(selectedDate)})`;
  };

  const fitToFeatures = (features) => {
    if (features.length === 0) return;
    const bounds = L.latLngBounds(
      features.map((feature) => [feature.geometry.coordinates[1], feature.geometry.coordinates[0]]),
    );
    state.map.fitBounds(bounds.pad(0.2), { animate: true });
  };

  const renderForDay = (options = {}) => {
    const { keepView = false, updateUrl = true } = options;

    const selectedDate = currentDate();
    if (!selectedDate) {
      setPanel(null);
      refs.status.textContent = "Ingen datoer i datasettet.";
      return;
    }

    refs.timeSlider.value = String(state.dayIndex);
    refs.dateCurrent.textContent = formatDate(selectedDate);

    const visible = visiblePhotos();
    buildMarkers(visible);
    updateStrip(visible);
    updateStatus(visible.length, selectedDate);

    if (!keepView) {
      fitToFeatures(visible);
    }

    if (!visible.find((feature) => feature.properties.id === state.activePhotoId)) {
      state.activePhotoId = visible[visible.length - 1]?.properties.id || null;
    }

    if (state.activePhotoId) {
      focusPhoto(state.activePhotoId, { panMap: false, updateUrl: false });
    } else {
      setPanel(null);
    }

    if (updateUrl) {
      setParams({
        date: selectedDate,
        photo: state.activePhotoId,
        mode: state.cumulative ? "cumulative" : "day",
      });
    }
  };

  const propertyServiceUrl = () => {
    const params = new URLSearchParams({
      komm: PROPERTY.komm,
      gnr: String(PROPERTY.gnr),
      bnr: String(PROPERTY.bnr),
      fnr: String(PROPERTY.fnr),
    });
    return `https://kart17.nibio.no/gardskart_ws_04/gpiareastat?${params.toString()}`;
  };

  const fetchPropertyJobId = async () => {
    const response = await fetch(propertyServiceUrl());
    if (!response.ok) {
      throw new Error(`Kunne ikke hente jobId (${response.status}).`);
    }

    const payload = await response.json();
    const jobId = payload?.jobId;
    if (!jobId) {
      throw new Error("Mangler jobId i svar fra Gårdskart.");
    }

    const warning = payload?.nonfarmPropertyConfirmation?.dekWFSStatusDesc || null;
    state.propertyFetchWarning = warning;
    state.propertyJobId = jobId;
    writeStoredJobId(jobId);
    return jobId;
  };

  const ensurePropertyJobId = async (force = false) => {
    if (!force) {
      const cached = readStoredJobId();
      if (cached && Date.now() - Number(cached.fetchedAt) < JOBID_TTL_MS) {
        state.propertyJobId = cached.jobId;
        return cached.jobId;
      }
    }
    return fetchPropertyJobId();
  };

  const clearPropertyLayer = () => {
    if (state.propertyLayer && state.map.hasLayer(state.propertyLayer)) {
      state.map.removeLayer(state.propertyLayer);
    }
    state.propertyLayer = null;
  };

  const drawPropertyLayer = () => {
    clearPropertyLayer();
    if (!state.propertyOverlayEnabled || !state.propertyJobId) return;

    const layer = L.tileLayer.wms("https://wms.nibio.no/cgi-bin/gardskart", {
      layers: "eiendomsgrenser",
      styles: "default",
      format: "image/png",
      transparent: true,
      version: "1.3.0",
      jobid: state.propertyJobId,
      pane: "propertyPane",
      attribution: "NIBIO Gårdskart",
    });

    layer.on("load", () => {
      const warning = state.propertyFetchWarning ? ` (${state.propertyFetchWarning})` : "";
      setPropertyStatus(`Eiendomslag aktivt: ${propertyIdString()}${warning}`);
    });

    layer.on("tileerror", () => {
      setPropertyStatus("Eiendomslag feilet. Prøv «Forny jobId».");
    });

    state.propertyLayer = layer;
    layer.addTo(state.map);
  };

  const refreshPropertyLayer = async (force = false) => {
    if (!state.propertyOverlayEnabled) {
      clearPropertyLayer();
      setPropertyStatus("Eiendomslag er skrudd av.");
      return;
    }

    setPropertyStatus("Henter eiendomslag fra Gårdskart ...");
    try {
      await ensurePropertyJobId(force);
      drawPropertyLayer();
    } catch (error) {
      setPropertyStatus(
        `Klarte ikke å hente eiendomslag: ${error instanceof Error ? error.message : "ukjent feil"}`,
      );
    }
  };

  const loadData = async () => {
    const response = await fetch("./data/photos.geojson");
    if (!response.ok) throw new Error("Klarte ikke å laste photos.geojson.");

    const geojson = await response.json();
    return (geojson.features || [])
      .filter((feature) => feature?.properties?.date && feature?.geometry?.coordinates)
      .sort((a, b) => {
        const byDate = String(a.properties.date).localeCompare(String(b.properties.date));
        if (byDate !== 0) return byDate;
        return String(a.properties.id).localeCompare(String(b.properties.id));
      });
  };

  const initMap = (features) => {
    const first = features[0];
    const lat = first?.geometry?.coordinates?.[1] ?? 59.17;
    const lng = first?.geometry?.coordinates?.[0] ?? 9.66;

    state.map = L.map("map", {
      zoomControl: true,
      attributionControl: true,
    }).setView([lat, lng], 13);

    state.map.createPane("propertyPane");
    state.map.getPane("propertyPane").style.zIndex = "420";

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 20,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(state.map);

    state.clusterLayer = L.markerClusterGroup({
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      disableClusteringAtZoom: 16,
      maxClusterRadius: 48,
    });

    state.map.addLayer(state.clusterLayer);
    window.setTimeout(() => state.map.invalidateSize(), 50);
  };

  const initTimeline = () => {
    refs.timeSlider.min = "0";
    refs.timeSlider.max = String(Math.max(0, state.dates.length - 1));
    refs.timeSlider.value = String(state.dayIndex);

    refs.dateMin.textContent = formatDate(state.dates[0]);
    refs.dateMax.textContent = formatDate(state.dates[state.dates.length - 1]);

    refs.timeSlider.addEventListener("input", () => {
      stopPlayback();
      state.dayIndex = Number.parseInt(refs.timeSlider.value, 10) || 0;
      renderForDay();
    });

    refs.prevDay.addEventListener("click", () => {
      stopPlayback();
      state.dayIndex = Math.max(0, state.dayIndex - 1);
      renderForDay();
    });

    refs.nextDay.addEventListener("click", () => {
      stopPlayback();
      state.dayIndex = Math.min(state.dates.length - 1, state.dayIndex + 1);
      renderForDay();
    });

    refs.modeCumulative.addEventListener("change", () => {
      state.cumulative = refs.modeCumulative.checked;
      renderForDay({ keepView: true });
    });

    refs.playPause.addEventListener("click", () => {
      if (state.playTimer) {
        stopPlayback();
        return;
      }

      refs.playPause.textContent = "Pause";
      state.playTimer = window.setInterval(() => {
        if (state.dayIndex >= state.dates.length - 1) {
          stopPlayback();
          return;
        }
        state.dayIndex += 1;
        renderForDay();
      }, 1300);
    });
  };

  const initPropertyControls = () => {
    if (refs.propertyLabel) {
      refs.propertyLabel.textContent = `Eiendom: ${propertyIdString()} (${PROPERTY.owner})`;
    }

    if (refs.toggleProperty) {
      refs.toggleProperty.checked = true;
      refs.toggleProperty.addEventListener("change", () => {
        state.propertyOverlayEnabled = refs.toggleProperty.checked;
        refreshPropertyLayer(false);
      });
    }

    if (refs.refreshJobId) {
      refs.refreshJobId.addEventListener("click", async () => {
        refs.refreshJobId.disabled = true;
        try {
          await refreshPropertyLayer(true);
        } finally {
          refs.refreshJobId.disabled = false;
        }
      });
    }
  };

  const applyInitialParams = () => {
    const params = getParams();
    const mode = params.get("mode");
    if (mode === "day") {
      state.cumulative = false;
      refs.modeCumulative.checked = false;
    }

    const date = params.get("date");
    const photo = params.get("photo");

    if (date) {
      const index = state.dates.indexOf(date);
      if (index >= 0) state.dayIndex = index;
    } else {
      state.dayIndex = state.dates.length - 1;
    }

    if (photo) {
      state.activePhotoId = photo;
    }
  };

  const init = async () => {
    try {
      state.photos = await loadData();

      if (state.photos.length === 0) {
        refs.status.textContent = "Fant ingen gyldige punkter i datasettet.";
        return;
      }

      state.dates = [...new Set(state.photos.map((feature) => feature.properties.date))].sort();

      initMap(state.photos);
      initPropertyControls();
      await refreshPropertyLayer(false);
      applyInitialParams();
      initTimeline();
      renderForDay({ keepView: false, updateUrl: true });
    } catch (error) {
      refs.status.textContent = `Feil: ${error instanceof Error ? error.message : "ukjent feil"}`;
    }
  };

  init();
})();
