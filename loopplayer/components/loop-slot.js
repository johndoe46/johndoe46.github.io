const template = (slotNumber) => `
  <article class="slot-card card h-100 border-0 rounded-4">
    <div class="card-body p-4">
      <div class="slot-layout">
        <aside class="volume-rail" aria-label="Volume control">
          <span class="volume-rail-label">Vol</span>
          <div class="volume-range-shell" data-role="volume-range-shell">
            <input
              class="form-range volume-range-vertical"
              id="volume-input-${slotNumber}"
              type="range"
              min="0"
              max="100"
              step="1"
              value="100"
              data-role="volume-input"
              aria-label="Volume"
            >
          </div>
        </aside>

        <div class="slot-main">
          <input
            class="visually-hidden"
            id="file-input-${slotNumber}"
            type="file"
            accept=".wav,.wave,audio/wav,audio/wave,audio/x-wav,audio/x-pn-wav,audio/*"
            data-role="file-input"
          >

          <dl class="slot-meta mb-4">
            <div>
              <dt>Detected BPM</dt>
              <dd data-role="detected-bpm">Pending</dd>
            </div>
            <div>
              <dt>Loop Beats</dt>
              <dd>
                <div class="input-group input-group-sm">
                  <input
                    class="form-control"
                    id="beat-count-input-${slotNumber}"
                    type="number"
                    min="1"
                    step="1"
                    value=""
                    placeholder="Pending"
                    data-role="beat-count-input"
                  >
                  <span class="input-group-text">beats</span>
                </div>
              </dd>
            </div>
          </dl>

          <div class="waveform-shell mb-4">
            <div class="d-flex justify-content-between align-items-center mb-2 gap-2">
              <input
                class="form-control form-control-sm waveform-file-name"
                type="text"
                value="No file loaded"
                data-role="file-name-input"
                aria-label="Loop name"
                disabled
              >
              <button
                class="btn btn-link btn-sm waveform-clear-button"
                type="button"
                data-role="clear-button"
                aria-label="Empty slot"
                disabled
              >
                x
              </button>
            </div>
            <button
              class="waveform-button"
              type="button"
              data-role="waveform-button"
              aria-label="Load loop file"
            >
              <canvas class="waveform-canvas rounded-3" data-role="waveform-canvas"></canvas>
              <span class="waveform-hint small text-body-secondary">Click to load .wav</span>
            </button>
          </div>

          <div class="mb-4">
            <input
              class="form-range"
              id="filter-input-${slotNumber}"
              type="range"
              min="-100"
              max="100"
              step="1"
              value="0"
              data-role="filter-input"
            >
            <div class="d-flex justify-content-between small text-body-secondary">
              <span>LP</span>
              <span class="filter-value" data-role="filter-value">Flat</span>
              <span>HP</span>
            </div>
          </div>

          <div class="d-flex gap-2 mb-3">
            <button class="btn btn-primary flex-fill" type="button" data-role="transport-button">Start</button>
          </div>

          <p class="small text-body-secondary mb-0" data-role="status-text">
            &nbsp;
          </p>
        </div>
      </div>
    </div>
  </article>
`;

export class LoopSlotElement extends HTMLElement {
  connectedCallback() {
    if (!this.dataset.slotNumber) {
      throw new Error("loop-slot requires a slot number.");
    }

    if (!this.hasChildNodes()) {
      this.innerHTML = template(this.dataset.slotNumber);
    }

    this.refs = {
      beatCountInput: this.querySelector('[data-role="beat-count-input"]'),
      detectedBpm: this.querySelector('[data-role="detected-bpm"]'),
      clearButton: this.querySelector('[data-role="clear-button"]'),
      fileInput: this.querySelector('[data-role="file-input"]'),
      fileNameInput: this.querySelector('[data-role="file-name-input"]'),
      filterInput: this.querySelector('[data-role="filter-input"]'),
      filterValue: this.querySelector('[data-role="filter-value"]'),
      statusText: this.querySelector('[data-role="status-text"]'),
      transportButton: this.querySelector('[data-role="transport-button"]'),
      volumeInput: this.querySelector('[data-role="volume-input"]'),
      volumeRangeShell: this.querySelector('[data-role="volume-range-shell"]'),
      waveformButton: this.querySelector('[data-role="waveform-button"]'),
      waveformCanvas: this.querySelector('[data-role="waveform-canvas"]'),
    };

    this.waveformPeaks = null;
    this.beatCount = null;
    this.beatCountDraft = "";
    this.fileNameDraft = "";
    this.isEditingBeatCount = false;
    this.isEditingFileName = false;
    this.playheadProgress = 0;
    this.playheadActive = false;

    if (typeof ResizeObserver === "function") {
      this.resizeObserver = new ResizeObserver(() => {
        this.syncVolumeRange();
        this.redrawWaveform();
      });
      this.resizeObserver.observe(this.refs.waveformCanvas);
      this.resizeObserver.observe(this.refs.volumeRangeShell);
    }

    this.bindEvents();
    this.syncVolumeRange();
    this.redrawWaveform();
  }

  disconnectedCallback() {
    this.resizeObserver?.disconnect();
  }

  bindEvents() {
    this.refs.waveformButton.addEventListener("click", () => {
      this.resetInlineEditState();
      this.refs.fileInput.click();
    });

    this.refs.fileInput.addEventListener("change", (event) => {
      this.resetInlineEditState();
      const [file] = event.target.files;
      this.dispatchEvent(new CustomEvent("slot-file-change", {
        bubbles: true,
        detail: { file },
      }));
      event.target.value = "";
    });

    this.refs.clearButton.addEventListener("click", () => {
      this.resetInlineEditState();
      this.dispatchEvent(new CustomEvent("slot-clear", { bubbles: true }));
    });

    this.refs.fileNameInput.addEventListener("focus", (event) => {
      this.isEditingFileName = true;
      this.fileNameDraft = event.target.value;
    });

    this.refs.fileNameInput.addEventListener("input", (event) => {
      this.isEditingFileName = true;
      this.fileNameDraft = event.target.value;
    });

    this.refs.fileNameInput.addEventListener("change", (event) => {
      this.fileNameDraft = event.target.value;
      this.emitFileNameChange(event.target.value);
    });

    this.refs.fileNameInput.addEventListener("blur", () => {
      this.isEditingFileName = false;
      this.emitFileNameChange(this.refs.fileNameInput.value);
      this.fileNameDraft = "";
    });

    this.refs.transportButton.addEventListener("click", () => {
      this.dispatchEvent(new CustomEvent("slot-transport-toggle", { bubbles: true }));
    });

    this.refs.volumeInput.addEventListener("input", (event) => {
      const volume = Number(event.target.value) / 100;
      this.dispatchEvent(new CustomEvent("slot-volume-change", {
        bubbles: true,
        detail: { volume },
      }));
    });

    this.refs.filterInput.addEventListener("input", (event) => {
      const filterControl = Number(event.target.value) / 100;
      this.dispatchEvent(new CustomEvent("slot-filter-change", {
        bubbles: true,
        detail: { filterControl },
      }));
    });

    this.refs.beatCountInput.addEventListener("focus", (event) => {
      this.isEditingBeatCount = true;
      this.beatCountDraft = event.target.value;
    });

    this.refs.beatCountInput.addEventListener("input", (event) => {
      this.isEditingBeatCount = true;
      this.beatCountDraft = event.target.value;
      this.emitBeatCountChange(event.target.value);
    });

    this.refs.beatCountInput.addEventListener("change", (event) => {
      this.beatCountDraft = event.target.value;
      this.emitBeatCountChange(event.target.value);
    });

    this.refs.beatCountInput.addEventListener("blur", () => {
      this.isEditingBeatCount = false;
      this.beatCountDraft = "";
      this.refs.beatCountInput.value = this.beatCount ? String(this.beatCount) : "";
    });
  }

  emitBeatCountChange(rawValue) {
    const beatCount = Number(rawValue);
    if (!Number.isInteger(beatCount) || beatCount < 1) {
      return;
    }

    this.dispatchEvent(new CustomEvent("slot-beat-count-change", {
      bubbles: true,
      detail: { beatCount },
    }));
  }

  emitFileNameChange(rawValue) {
    this.dispatchEvent(new CustomEvent("slot-file-name-change", {
      bubbles: true,
      detail: { fileName: rawValue },
    }));
  }

  resetInlineEditState() {
    this.isEditingBeatCount = false;
    this.beatCountDraft = "";
    this.isEditingFileName = false;
    this.fileNameDraft = "";
  }

  updateView({
    beatCount = null,
    beatCountDisabled = true,
    detectedBpm = "Pending",
    fileName = "No file loaded",
    filterControl = 0,
    filterLabel = "Flat",
    transportButtonDisabled = false,
    transportButtonLabel = "Start",
    transportButtonVariant = "primary",
    statusPill = "Idle",
    statusText = "\u00a0",
    volume = 1,
  } = {}) {
    this.beatCount = Number.isInteger(beatCount) && beatCount > 0 ? beatCount : null;
    this.refs.beatCountInput.disabled = beatCountDisabled;
    if (!this.isEditingBeatCount) {
      this.refs.beatCountInput.value = beatCount ? String(beatCount) : "";
    }
    this.refs.clearButton.disabled = fileName === "No file loaded";
    this.refs.fileNameInput.disabled = fileName === "No file loaded";
    this.refs.detectedBpm.textContent = detectedBpm;
    if (!this.isEditingFileName) {
      this.refs.fileNameInput.value = fileName;
    }
    this.refs.filterInput.value = String(Math.round(filterControl * 100));
    this.refs.filterValue.textContent = filterLabel;
    this.refs.transportButton.disabled = transportButtonDisabled;
    this.refs.transportButton.textContent = transportButtonLabel;
    this.refs.transportButton.className = `btn btn-${transportButtonVariant} flex-fill`;
    this.refs.statusText.textContent = statusText;
    this.refs.volumeInput.value = String(Math.round(volume * 100));
    this.redrawWaveform();
  }

  updateWaveform(peaks) {
    this.waveformPeaks = peaks ?? null;
    this.redrawWaveform();
  }

  updatePlayhead({ progress = 0, active = false, label = "Idle" } = {}) {
    this.playheadProgress = Math.min(1, Math.max(0, progress));
    this.playheadActive = active;
    this.redrawWaveform();
  }

  syncVolumeRange() {
    const shell = this.refs?.volumeRangeShell;
    const input = this.refs?.volumeInput;
    if (!shell || !input) {
      return;
    }

    const span = Math.max(0, Math.floor(shell.clientHeight));
    if (span > 0) {
      input.style.width = `${span}px`;
    }
  }

  redrawWaveform() {
    const canvas = this.refs?.waveformCanvas;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");
    const width = Math.max(1, Math.floor((canvas.clientWidth || 320) * (window.devicePixelRatio || 1)));
    const height = Math.max(1, Math.floor((canvas.clientHeight || 120) * (window.devicePixelRatio || 1)));

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const styles = getComputedStyle(this);
    const accent = styles.getPropertyValue("--slot-accent").trim() || "#1f6f78";
    const border = styles.getPropertyValue("--hero-border").trim() || "rgba(26, 40, 56, 0.12)";
    const bodyColor = styles.getPropertyValue("--bs-body-color").trim() || "#1a2838";
    const bodyBackground = styles.getPropertyValue("--bs-body-bg").trim() || "#ffffff";

    context.clearRect(0, 0, width, height);
    context.fillStyle = bodyBackground;
    context.fillRect(0, 0, width, height);
    context.strokeStyle = border;
    context.strokeRect(0.5, 0.5, width - 1, height - 1);

    if (this.waveformPeaks?.length && this.beatCount && this.beatCount > 1) {
      const beatSpacing = width / this.beatCount;

      for (let beatIndex = 1; beatIndex < this.beatCount; beatIndex += 1) {
        const x = Math.max(0.5, Math.min(width - 0.5, (beatIndex * beatSpacing) + 0.5));
        const isBarLine = beatIndex % 4 === 0;

        context.strokeStyle = isBarLine ? accent : bodyColor;
        context.globalAlpha = isBarLine ? 0.22 : 0.12;
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, height);
        context.stroke();
      }

      context.globalAlpha = 1;
    }

    if (this.waveformPeaks?.length) {
      const centerY = height / 2;
      const stepX = width / this.waveformPeaks.length;

      context.strokeStyle = accent;
      context.lineWidth = Math.max(1, stepX * 0.72);
      context.lineCap = "round";
      context.beginPath();

      for (let index = 0; index < this.waveformPeaks.length; index += 1) {
        const peak = this.waveformPeaks[index];
        const x = (index * stepX) + (stepX / 2);
        const amplitude = Math.max(2, peak * ((height / 2) - 8));
        context.moveTo(x, centerY - amplitude);
        context.lineTo(x, centerY + amplitude);
      }

      context.stroke();
    } else {
      context.fillStyle = bodyColor;
      context.globalAlpha = 0.6;
      context.font = `${Math.max(12, Math.floor(height * 0.12))}px ui-monospace, Menlo, monospace`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText("LOAD A LOOP TO RENDER", width / 2, height / 2);
      context.globalAlpha = 1;
    }

    if (this.playheadActive || this.waveformPeaks?.length) {
      const playheadX = Math.max(0, Math.min(width - 1, this.playheadProgress * width));
      context.strokeStyle = bodyColor;
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(playheadX, 0);
      context.lineTo(playheadX, height);
      context.stroke();
    }
  }
}

customElements.define("loop-slot", LoopSlotElement);
