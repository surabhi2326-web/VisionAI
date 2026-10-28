/* Wires UI to ModelManager, ImageUpload and Camera. */
document.addEventListener("DOMContentLoaded", () => {
  const cfg = window.VISIONAI_CONFIG;
  const $ = (id) => document.getElementById(id);
  const icons = () => window.lucide && lucide.createIcons();
  icons();

  const mm = new ModelManager(cfg);
  
const wildwatchMode = cfg.modelType === "wildwatch";

if (wildwatchMode) {
  mm.info = {
    classNames: cfg.classNames,
    inputSize: "128 × 128 px",
    type: "WildWatch 27-class Keras model",
  };

  mm.url = "Local Flask API";
}

  const els = {
    status: $("model-status"),
    statusText: $("model-status-text"),
    banner: $("banner"),
    analyze: $("analyze-btn"),
    analyzeLabel: $("analyze-label"),
    hint: $("analyze-hint"),
    preview: $("preview"),
    previewImg: $("preview-img"),
    dropzone: $("dropzone"),
    topEmpty: $("top-empty"),
    topEmptyText: $("top-empty-text"),
    top: $("top-result"),
    bars: $("bars"),
    info: $("model-info"),
    history: $("history"),
    clear: $("clear-history"),
    dialog: $("settings-dialog"),
    form: $("model-form"),
    urlInput: $("model-url"),
    urlErr: $("model-url-error"),
    loadBtn: $("load-model-btn"),
  };
  let currentUrl = null,
    history = [],
    busyAnalyze = false,
    camera = null;

  /* ---------- helpers ---------- */
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const pct = (p) => (p * 100).toFixed(1) + "%";
  function banner(msg, tone, action) {
    els.banner.replaceChildren(el("span", null, msg));
    if (action) {
      const b = el("button", "btn btn--ghost", action.label);
      b.addEventListener("click", action.fn);
      els.banner.append(b);
    }
    els.banner.dataset.tone = tone || "error";
    els.banner.hidden = false;
  }
  const hideBanner = () => {
    els.banner.hidden = true;
  };
  const openSettings = () => {
    els.urlErr.hidden = true;
    els.dialog.showModal();
    els.urlInput.focus();
  };

  function resetResults(text) {
    els.top.hidden = true;
    els.topEmpty.hidden = false;
    els.topEmptyText.textContent =
      text || "Results appear here after you analyze an image.";
    els.bars.replaceChildren(el("li", "empty-line", "No predictions yet."));
  }

  function renderInfo(inferMs) {
    const rows = [
      [
        "Status",
        {
          none: "No model configured",
          loading: "Loading…",
          ready: "Connected",
          error: "Failed to load",
        }[mm.state],
      ],

      ["Model type", mm.info?.type || "Google Teachable Machine image model"],
    ];
    if (mm.url)
      rows.push([
        "Model URL",
        mm.url
          .replace(/^https?:\/\//, "")
          .replace(/^(.{34}).{4,}(.{14})$/, "$1…$2"),
      ]);
    if (mm.info) {
      rows.push(
        ["Classes", String(mm.info.classNames.length)],
        ["Class names", mm.info.classNames.join(", ")],
        ["Input size", mm.info.inputSize || "Not available"],
      );
    }
    rows.push([
      "Last inference",
      inferMs != null ? inferMs + " ms" : "Not available",
    ]);
    els.info.replaceChildren(
      ...rows.flatMap(([k, v]) => [el("dt", null, k), el("dd", null, v)]),
    );
  }

  function updateControls() {
    const hasImage =
      !!els.previewImg.getAttribute("src") && !els.preview.hidden;
    const ready = mm.state === "ready";
    els.analyze.disabled = !(ready && hasImage) || busyAnalyze;
    els.hint.textContent = !ready
      ? mm.state === "loading"
        ? "Model is loading…"
        : "Load a model in Settings to begin."
      : !hasImage
        ? "Choose or capture an image to analyze."
        : "Ready to analyze.";
    els.loadBtn.disabled = mm.state === "loading" || busyAnalyze;
  }

  /* ---------- model state ---------- */
  mm.addEventListener("state", () => {
    const s = mm.state;
    els.status.dataset.state =
      s === "ready"
        ? "connected"
        : s === "loading"
          ? "loading"
          : "disconnected";
    els.statusText.textContent =
      s === "ready"
        ? "Connected"
        : s === "loading"
          ? "Loading"
          : "Disconnected";
    renderInfo();
    updateControls();
  });

  async function loadModel(raw) {
    els.urlErr.hidden = true;
    hideBanner();
    let url;
    try {
      const r = await fetch("/api/validate-model-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: raw }),
      });
      const d = await r.json();
      if (!d.ok) {
        els.urlErr.textContent = d.error;
        els.urlErr.hidden = false;
        return false;
      }
      url = d.url;
    } catch (e) {
      els.urlErr.textContent =
        "Couldn't reach the Flask server to validate the URL. Is it still running?";
      els.urlErr.hidden = false;
      return false;
    }
    if (url === mm.url && mm.state === "ready") {
      els.dialog.close();
      return true;
    }
    els.loadBtn.querySelector("svg") &&
      els.loadBtn.querySelector("svg").classList.add("spin");
    try {
      await mm.load(url);
      resetResults();
      clearHistory();
      renderInfo();
      els.dialog.close();
      banner(`Model loaded with ${mm.info.classNames.length} classes.`, "info");
      setTimeout(hideBanner, 3500);
      return true;
    } catch (e) {
      els.urlErr.textContent = e.message;
      els.urlErr.hidden = false;
      return false;
    } finally {
      els.loadBtn.querySelector("svg") &&
        els.loadBtn.querySelector("svg").classList.remove("spin");
      updateControls();
    }
  }

  /* ---------- image input ---------- */
  function showImage(url) {
    resetResults(url ? "Ready — select Analyze image." : undefined);
    if (url) {
      els.previewImg.src = url;
      els.preview.hidden = false;
      els.dropzone.hidden = true;
    } else {
      els.previewImg.removeAttribute("src");
      els.preview.hidden = true;
      els.dropzone.hidden = false;
    }
    if (url) hideBanner();
    updateControls();
  }
  const upload = new ImageUpload({
    dropzone: els.dropzone,
    input: $("file-input"),
    maxMb: cfg.maxUploadMb,
    onChange: showImage,
    onError: (m) => banner(m, "error"),
  });
  $("replace-btn").addEventListener("click", () => upload.browse());
  $("remove-btn").addEventListener("click", () => upload.clear());

  /* ---------- camera ---------- */
  const camEls = {
    open: $("camera-open"),
    cap: $("camera-capture"),
    close: $("camera-close"),
    video: $("camera-video"),
    empty: $("camera-empty"),
    note: $("camera-note"),
  };
  camera = new Camera({
    video: camEls.video,
    onState: (on) => {
      camEls.video.classList.toggle("on", on);
      camEls.empty.hidden = on;
      camEls.open.hidden = on;
      camEls.cap.hidden = !on;
      camEls.close.hidden = !on;
    },
    onCapture: (f) => {
      upload.setFile(f);
      setTab("upload");
    },
    onError: (code, m) => {
      camEls.note.textContent = m;
      camEls.note.hidden = false;
      banner(m, "warn", {
        label: "Upload instead",
        fn: () => {
          setTab("upload");
          upload.browse();
        },
      });
    },
  });
  camEls.open.addEventListener("click", () => {
    camEls.note.hidden = true;
    camera.open();
  });
  camEls.cap.addEventListener("click", () => camera.capture());
  camEls.close.addEventListener("click", () => camera.close());
  function setTab(t) {
    const cam = t === "camera";
    $("pane-camera").hidden = !cam;
    $("pane-upload").hidden = cam;
    if (cam) {
      els.preview.hidden = true;
    } else {
      camera.close();
      els.preview.hidden = !upload.url;
      els.dropzone.hidden = !!upload.url;
    }
    $("tab-upload").classList.toggle("is-active", !cam);
    $("tab-camera").classList.toggle("is-active", cam);
    $("tab-upload").setAttribute("aria-pressed", String(!cam));
    $("tab-camera").setAttribute("aria-pressed", String(cam));
    updateControls();
  }
  $("tab-upload").addEventListener("click", () => setTab("upload"));
  $("tab-camera").addEventListener("click", () => setTab("camera"));
  window.addEventListener("pagehide", () => {
    camera.close();
    upload.clear(true);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) camera.close();
  });
  async function predictWildWatch(source) {
    const canvas = document.createElement("canvas");

    const width = source.videoWidth || source.naturalWidth || source.width;
    const height = source.videoHeight || source.naturalHeight || source.height;

    if (!width || !height) {
      throw new Error("The selected image is not ready.");
    }

    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Could not prepare the image.");
    }

    context.drawImage(source, 0, 0, width, height);

    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.9),
    );

    if (!blob) {
      throw new Error("Could not convert the image.");
    }

    const formData = new FormData();
    formData.append("image", blob, "wildwatch-image.jpg");

    const response = await fetch("/api/predict", {
      method: "POST",
      body: formData,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "WildWatch prediction failed.");
    }

    return {
      predictions: data.predictions,
      topPrediction: data.topPrediction,
      inferenceTimeMs: data.inferenceTimeMs,
    };
  }

  /* ---------- analysis ---------- */
  function renderResult(r) {
    const t = r.topPrediction,
      lvl = mm.confidenceLevel(t.probability);
    els.topEmpty.hidden = true;
    els.top.hidden = false;
    $("top-name").textContent = t.className;
    $("top-pct").textContent = pct(t.probability);
    const b = $("top-badge");
    b.dataset.level = lvl;
    b.textContent = {
      high: "High confidence",
      moderate: "Moderate confidence",
      low: "Low confidence",
    }[lvl];
    $("top-advice").textContent =
      lvl === "low"
        ? "The model is unsure. Try a clearer, closer, better-lit image, or check that this kind of image was in its training classes."
        : "";
    const items = r.predictions.map((p) => {
      const li = el("li"),
        meta = el("div", "bar__meta"),
        track = el("div", "bar__track"),
        fill = el("div", "bar__fill");
      meta.append(
        el("span", "bar__name", p.className),
        el("span", "bar__pct", pct(p.probability)),
      );
      track.append(fill);
      li.append(meta, track);
      fill.dataset.w = (p.probability * 100).toFixed(2);
      return li;
    });
    els.bars.replaceChildren(...items);
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        els.bars
          .querySelectorAll(".bar__fill")
          .forEach((f) => (f.style.width = f.dataset.w + "%")),
      ),
    );
    lvl === "low" &&
      banner(
        "Low-confidence result — treat this prediction with caution.",
        "warn",
      );
  }

  function thumb(img) {
    const c = document.createElement("canvas"),
      s = 104;
    c.width = c.height = s;
    const m = Math.min(img.naturalWidth, img.naturalHeight);
    c.getContext("2d").drawImage(
      img,
      (img.naturalWidth - m) / 2,
      (img.naturalHeight - m) / 2,
      m,
      m,
      0,
      0,
      s,
      s,
    );
    return c.toDataURL("image/jpeg", 0.7);
  }
  function renderHistory() {
    els.clear.disabled = !history.length;
    if (!history.length)
      return els.history.replaceChildren(
        el("li", "empty-line", "Nothing analyzed in this session."),
      );
    els.history.replaceChildren(
      ...history.map((h) => {
        const li = el("li"),
          img = el("img"),
          txt = el("div", "history__text");
        img.src = h.thumb;
        img.alt = "Analyzed image thumbnail";
        txt.append(
          el("strong", null, h.name),
          el("span", null, `${pct(h.p)} · ${h.time}`),
        );
        li.append(img, txt);
        return li;
      }),
    );
  }
  function clearHistory() {
    history = [];
    renderHistory();
  }
  els.clear.addEventListener("click", clearHistory);

  els.analyze.addEventListener("click", async () => {
    if (busyAnalyze) return;
    if (mm.state === "none") {
      banner("No model configured.", "warn", {
        label: "Open settings",
        fn: openSettings,
      });
      return;
    }
    busyAnalyze = true;
    hideBanner();
    resetResults("Analyzing…");
    els.analyzeLabel.textContent = "Analyzing…";
    updateControls();
    try {
      const img = els.previewImg;
      if (!img.complete || !img.naturalWidth) await img.decode();
      const r = wildwatchMode
        ? await predictWildWatch(img)
        : await mm.predict(img);
      renderResult(r);
      renderInfo(r.inferenceTimeMs);
      history.unshift({
        thumb: thumb(img),
        name: r.topPrediction.className,
        p: r.topPrediction.probability,
        time: new Date().toLocaleTimeString(),
      });
      history = history.slice(0, 6);
      renderHistory();
    } catch (e) {
      resetResults("No result — the analysis failed.");
      banner(e.message || "Prediction failed.", "error", {
        label: "Try again",
        fn: () => els.analyze.click(),
      });
    } finally {
      busyAnalyze = false;
      els.analyzeLabel.textContent = "Analyze image";
      updateControls();
    }
  });

  /* ---------- settings dialog ---------- */
  $("open-settings").addEventListener("click", openSettings);
  els.dialog
    .querySelectorAll("[data-close]")
    .forEach((b) => b.addEventListener("click", () => els.dialog.close()));
  els.dialog.addEventListener("click", (e) => {
    if (e.target === els.dialog) els.dialog.close();
  });
  els.form.addEventListener("submit", (e) => {
    e.preventDefault();
    loadModel(els.urlInput.value);
  });

  /* ---------- init ---------- */
  renderInfo();
  renderHistory();
  updateControls();
  
if (wildwatchMode) {
  $("open-settings").hidden = true;
  mm._set("ready");

  banner("WildWatch model is connected to the Flask prediction API.", "info");
} else if (!(window.tf && window.tmImage)) {
  window.addEventListener("load", () => {
    if (!window.tmImage) {
      banner(
        "The AI libraries failed to load (CDN blocked or offline).",
        "error",
        {
          label: "Reload",
          fn: () => location.reload(),
        },
      );
    }
  });
} else if (cfg.defaultModelUrl) {
  loadModel(cfg.defaultModelUrl).then((ok) => {
    if (!ok) openSettings();
  });
} else {
  banner(
    "No model configured yet. Add a Teachable Machine model URL to start.",
    "info",
    {
      label: "Add model",
      fn: openSettings,
    },
  );
}

});
