(() => {
  const refs = {
    chapters: document.getElementById("chapters"),
    chapterDescription: document.getElementById("kapittel-beskrivelse"),
    photoList: document.getElementById("photo-list"),
    countVisible: document.getElementById("count-visible"),
    photoCard: document.getElementById("photo-card"),
    map: document.getElementById("map"),
  };

  if (!refs.chapters || !refs.photoList || !refs.map) {
    return;
  }

  const state = {
    story: null,
    photos: [],
    activeChapter: null,
    activePhotoId: null,
    map: null,
    clusterLayer: null,
    markersById: new Map(),
  };

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

  const getParams = () => new URLSearchParams(window.location.search);

  const setParams = (updates) => {
    const params = getParams();
    Object.entries(updates).forEach(([key, value]) => {
      if (!value) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    });
    const query = params.toString();
    const next = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    window.history.replaceState({}, "", next);
  };

  const formatDate = (value) => {
    if (!value) return "Ukjent dato";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleDateString("nb-NO", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  const chapterBySlug = (slug) => state.story.chapters.find((chapter) => chapter.slug === slug);

  const filterPhotos = (chapterSlug) => {
    if (!chapterSlug) return state.photos;
    return state.photos.filter((feature) => feature.properties.chapter === chapterSlug);
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

  const setPhotoCard = (feature) => {
    const props = feature.properties;
    refs.photoCard.innerHTML = `
      <h3 class="photo-card__title">${safeText(props.title)}</h3>
      <p class="photo-card__meta">${safeText(formatDate(props.date))} · ${safeText(props.tags.join(", "))}</p>
      <img class="photo-card__image" src="${safeText(props.image)}" alt="${safeText(props.title)}" loading="lazy" />
      <p class="photo-card__caption">${safeText(props.caption)}</p>
    `;
  };

  const setActivePhotoInList = () => {
    const items = refs.photoList.querySelectorAll(".photo-item");
    items.forEach((item) => {
      if (item.dataset.photoId === state.activePhotoId) {
        item.classList.add("is-active");
      } else {
        item.classList.remove("is-active");
      }
    });
  };

  const focusPhoto = (photoId, options = {}) => {
    const { panMap = true, updateUrl = true } = options;
    if (!photoId) return;

    const feature = state.photos.find((candidate) => candidate.properties.id === photoId);
    const marker = state.markersById.get(photoId);
    if (!feature || !marker) return;

    state.activePhotoId = photoId;
    setPhotoCard(feature);
    setActivePhotoInList();

    if (panMap) {
      state.map.setView(marker.getLatLng(), Math.max(state.map.getZoom(), 14), {
        animate: true,
      });
      marker.openPopup();
    }

    if (updateUrl) {
      setParams({ chapter: state.activeChapter, photo: state.activePhotoId });
    }
  };

  const buildPhotoList = (features) => {
    refs.photoList.innerHTML = "";

    if (features.length === 0) {
      refs.photoList.innerHTML = "<li>Ingen funn i dette kapittelet.</li>";
      return;
    }

    const sorted = [...features].sort((a, b) => {
      return String(a.properties.date).localeCompare(String(b.properties.date));
    });

    sorted.forEach((feature) => {
      const props = feature.properties;
      const item = document.createElement("li");
      item.className = "photo-item";
      item.dataset.photoId = props.id;

      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("aria-label", `Vis ${props.title} i kartet`);
      button.innerHTML = `
        <img class="photo-thumb" src="${safeText(props.thumbnail)}" alt="" loading="lazy" />
        <span>
          <p class="photo-title">${safeText(props.title)}</p>
          <p class="photo-meta">${safeText(formatDate(props.date))}</p>
          <p class="photo-caption">${safeText(props.caption)}</p>
        </span>
      `;

      button.addEventListener("click", () => {
        focusPhoto(props.id, { panMap: true, updateUrl: true });
      });

      item.appendChild(button);
      refs.photoList.appendChild(item);
    });

    setActivePhotoInList();
  };

  const clearMarkers = () => {
    state.markersById.clear();
    if (!state.clusterLayer) return;
    state.clusterLayer.clearLayers();
  };

  const buildMarkers = (features) => {
    clearMarkers();

    features.forEach((feature) => {
      const [lng, lat] = feature.geometry.coordinates;
      const marker = L.marker([lat, lng]);
      marker.bindPopup(popupHtml(feature), { closeButton: false, autoPanPadding: [30, 30] });
      marker.on("click", () => {
        focusPhoto(feature.properties.id, { panMap: false, updateUrl: true });
      });

      state.clusterLayer.addLayer(marker);
      state.markersById.set(feature.properties.id, marker);
    });

    refs.countVisible.textContent = String(features.length);
  };

  const setChapterDescription = (chapter) => {
    if (!chapter) {
      refs.chapterDescription.textContent = "Viser alle kapitler samlet.";
      return;
    }
    refs.chapterDescription.textContent = chapter.description;
  };

  const setActiveChapterButton = () => {
    const buttons = refs.chapters.querySelectorAll(".chapter-btn");
    buttons.forEach((button) => {
      const isAll = !state.activeChapter && button.dataset.slug === "";
      const isChapter = button.dataset.slug === state.activeChapter;
      if (isAll || isChapter) {
        button.classList.add("is-active");
        button.setAttribute("aria-current", "true");
      } else {
        button.classList.remove("is-active");
        button.removeAttribute("aria-current");
      }
    });
  };

  const drawChapter = (slug, options = {}) => {
    const { updateUrl = true } = options;

    const chapter = chapterBySlug(slug);
    state.activeChapter = chapter ? chapter.slug : null;

    const filtered = filterPhotos(state.activeChapter);
    buildMarkers(filtered);
    buildPhotoList(filtered);
    setChapterDescription(chapter);
    setActiveChapterButton();

    if (chapter && chapter.focus) {
      state.map.setView([chapter.focus.lat, chapter.focus.lng], chapter.focus.zoom || 13, {
        animate: true,
      });
    } else if (filtered.length > 0) {
      const bounds = L.latLngBounds(
        filtered.map((feature) => [feature.geometry.coordinates[1], feature.geometry.coordinates[0]]),
      );
      state.map.fitBounds(bounds.pad(0.2));
    }

    const firstId = filtered[0]?.properties.id || null;
    if (!filtered.find((item) => item.properties.id === state.activePhotoId)) {
      state.activePhotoId = firstId;
    }
    if (state.activePhotoId) {
      focusPhoto(state.activePhotoId, { panMap: false, updateUrl: false });
    }

    if (updateUrl) {
      setParams({ chapter: state.activeChapter, photo: state.activePhotoId });
    }
  };

  const renderChapters = () => {
    refs.chapters.innerHTML = "";

    const allButton = document.createElement("button");
    allButton.type = "button";
    allButton.className = "chapter-btn";
    allButton.dataset.slug = "";
    allButton.innerHTML = `
      <span class="chapter-btn__title">Alle kapitler</span>
      <span class="chapter-btn__desc">Vis hele datasettet i ett kartbilde.</span>
    `;
    allButton.addEventListener("click", () => drawChapter(null));
    refs.chapters.appendChild(allButton);

    state.story.chapters.forEach((chapter) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chapter-btn";
      button.dataset.slug = chapter.slug;
      button.innerHTML = `
        <span class="chapter-btn__title">${safeText(chapter.title)}</span>
        <span class="chapter-btn__desc">${safeText(chapter.description)}</span>
      `;
      button.addEventListener("click", () => drawChapter(chapter.slug));
      refs.chapters.appendChild(button);
    });
  };

  const loadData = async () => {
    const [storyResponse, photosResponse] = await Promise.all([
      fetch("./data/story.json"),
      fetch("./data/photos.geojson"),
    ]);

    if (!storyResponse.ok || !photosResponse.ok) {
      throw new Error("Kunne ikke laste datafiler for demoen.");
    }

    const [story, photosGeoJson] = await Promise.all([storyResponse.json(), photosResponse.json()]);
    return {
      story,
      photos: photosGeoJson.features || [],
    };
  };

  const initMap = (story) => {
    const start = story.chapters[0]?.focus || { lat: 59.41, lng: 9.22, zoom: 12 };

    state.map = L.map("map", {
      zoomControl: true,
      attributionControl: true,
    }).setView([start.lat, start.lng], start.zoom || 12);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(state.map);

    state.clusterLayer = L.markerClusterGroup({
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      disableClusteringAtZoom: 16,
    });

    state.map.addLayer(state.clusterLayer);
    window.setTimeout(() => state.map.invalidateSize(), 0);
  };

  const init = async () => {
    try {
      const { story, photos } = await loadData();
      state.story = story;
      state.photos = photos;

      initMap(story);
      renderChapters();

      const params = getParams();
      const chapterParam = params.get("chapter");
      const photoParam = params.get("photo");

      const chapterExists = chapterParam && chapterBySlug(chapterParam);
      const selectedChapter = chapterExists ? chapterParam : story.chapters[0]?.slug || null;

      drawChapter(selectedChapter, { updateUrl: false });

      if (photoParam) {
        const existsInDataset = state.photos.find((feature) => feature.properties.id === photoParam);
        if (existsInDataset) {
          if (existsInDataset.properties.chapter !== state.activeChapter) {
            drawChapter(existsInDataset.properties.chapter, { updateUrl: false });
          }
          focusPhoto(photoParam, { panMap: true, updateUrl: false });
        }
      }

      setParams({ chapter: state.activeChapter, photo: state.activePhotoId });
    } catch (error) {
      refs.chapters.innerHTML = `<p>Feil ved lasting av demo-data: ${safeText(error.message)}</p>`;
      refs.photoList.innerHTML = "";
      refs.countVisible.textContent = "0";
    }
  };

  init();
})();
