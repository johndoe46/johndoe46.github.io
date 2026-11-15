import { detectBufferBpm } from "./audio/bpm-detector.js";
import { getFilterSettings } from "./audio/filter.js";
import {
  DEFAULT_BAR_BEAT_COUNT,
  TransportClock,
  clampBpm,
  computeLoopDurationSeconds,
  computePlaybackRate,
  estimateBeatCount,
  estimateBpmFromLoopLength,
  parseBeatCountFromFilename,
  quantizeTimeToSampleFrame,
} from "./audio/timing.js";
import { buildWaveformPeaks } from "./audio/waveform.js";
import { LoopSlotElement } from "./components/loop-slot.js";

const SLOT_COUNT = 8;
const START_LOOKAHEAD_SECONDS = 0.05;
const MASTER_IMMEDIATE_START_LEAD_SECONDS = 0.35;
const TRANSPORT_SCHEDULER_LOOKAHEAD_SECONDS = 0.35;
const TRANSPORT_SCHEDULER_INTERVAL_MS = 25;
const METRONOME_CLICK_DURATION_SECONDS = 0.03;
const FILTER_STAGE_COUNT = 3;

function positiveModulo(value, modulo) {
  return ((value % modulo) + modulo) % modulo;
}

class LoopPlayerSlot {
  constructor({ audioContext, element, slotNumber, transport }) {
    this.audioContext = audioContext;
    this.element = element;
    this.slotNumber = slotNumber;
    this.transport = transport;
    this.dryGainNode = this.audioContext.createGain();
    this.filterNodes = Array.from(
      { length: FILTER_STAGE_COUNT },
      () => this.audioContext.createBiquadFilter(),
    );
    this.gainNode = this.audioContext.createGain();
    this.wetGainNode = this.audioContext.createGain();
    this.filterControl = 0;
    this.gainNode.connect(this.audioContext.destination);
    this.gainNode.gain.value = 1;
    for (const filterNode of this.filterNodes) {
      filterNode.Q.value = 0.0001;
    }
    this.dryGainNode.connect(this.gainNode);
    for (let filterIndex = 0; filterIndex < this.filterNodes.length - 1; filterIndex += 1) {
      this.filterNodes[filterIndex].connect(this.filterNodes[filterIndex + 1]);
    }
    this.filterNodes.at(-1).connect(this.wetGainNode);
    this.wetGainNode.connect(this.gainNode);

    this.audioBuffer = null;
    this.sourceFile = null;
    this.currentFileName = "No file loaded";
    this.exportFileNameValue = "No file loaded";
    this.detectedBpm = null;
    this.loopBeatCount = null;
    this.clipStartBeatPosition = null;
    this.pendingStartTimer = null;
    this.pendingStopTimer = null;
    this.pendingStopTime = null;
    this.playbackActive = false;
    this.scheduledBarKeys = new Set();
    this.scheduledSources = new Set();
    this.scheduledSegments = new Map();
    this.state = "idle";

    this.element.updateView();
    this.setFilterControl(0);
    this.bindEvents();
  }

  get isPlaying() {
    return this.playbackActive;
  }

  get isReadyToStart() {
    return Boolean(this.audioBuffer && this.loopBeatCount);
  }

  get exportFile() {
    return this.sourceFile;
  }

  get exportBeatCount() {
    return this.loopBeatCount;
  }

  get exportFileName() {
    return this.exportFileNameValue;
  }

  get playbackRate() {
    if (!this.detectedBpm) {
      return null;
    }

    return computePlaybackRate(this.detectedBpm, this.transport.bpm);
  }

  bindEvents() {
    this.element.addEventListener("slot-file-change", async (event) => {
      const { file } = event.detail;
      if (file) {
        await this.loadFile(file);
      }
    });

    this.element.addEventListener("slot-transport-toggle", async () => {
      if (this.playbackActive) {
        this.requestStop();
      } else {
        await this.start();
      }
      this.onStateChange?.();
    });

    this.element.addEventListener("slot-volume-change", (event) => {
      this.setVolume(event.detail.volume);
    });

    this.element.addEventListener("slot-filter-change", (event) => {
      this.setFilterControl(event.detail.filterControl);
    });

    this.element.addEventListener("slot-beat-count-change", (event) => {
      this.setBeatCount(event.detail.beatCount);
    });

    this.element.addEventListener("slot-file-name-change", (event) => {
      this.setFileName(event.detail.fileName);
    });

    this.element.addEventListener("slot-clear", () => {
      this.clearSlot();
      this.onStateChange?.();
    });
  }

  async loadFile(file) {
    this.stop();
    this.element.updateWaveform(null);
    this.updatePlayhead(this.audioContext.currentTime);
    this.setState("loading", `Decoding ${file.name}...`);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer.slice(0));

      this.audioBuffer = audioBuffer;
      this.sourceFile = file;
      this.currentFileName = file.name;
      this.exportFileNameValue = file.name;
      this.element.updateWaveform(buildWaveformPeaks(audioBuffer));
      this.updatePlayhead(this.audioContext.currentTime);
      const filenameBeatCount = parseBeatCountFromFilename(file.name);

      let analysis = null;
      try {
        analysis = await detectBufferBpm(audioBuffer);
      } catch (error) {
        analysis = null;
      }

      if (filenameBeatCount) {
        this.loopBeatCount = filenameBeatCount;
        this.detectedBpm = estimateBpmFromLoopLength(audioBuffer.duration, this.loopBeatCount);
        this.setState(
          "ready",
          `Detected ${this.detectedBpm.toFixed(1)} BPM.`,
        );
      } else if (analysis?.bpm) {
        this.loopBeatCount = estimateBeatCount(audioBuffer.duration, analysis.bpm);
        this.detectedBpm = estimateBpmFromLoopLength(audioBuffer.duration, this.loopBeatCount);
        this.setState(
          "ready",
          `Detected ${this.detectedBpm.toFixed(1)} BPM.`,
        );
      } else {
        this.detectedBpm = null;
        this.loopBeatCount = null;
        this.setState("ready", "Tempo detection failed. Enter loop beats manually.");
      }

      this.onStateChange?.();
    } catch (error) {
      this.audioBuffer = null;
      this.sourceFile = null;
      this.currentFileName = "No file loaded";
      this.exportFileNameValue = "No file loaded";
      this.detectedBpm = null;
      this.loopBeatCount = null;
      this.element.updateWaveform(null);
      this.updatePlayhead(this.audioContext.currentTime);
      this.setState("error", error.message);
      this.onStateChange?.();
    }
  }

  setVolume(volume) {
    this.gainNode.gain.value = volume;
    this.render();
  }

  ensureDetectedBpm() {
    if (!this.detectedBpm && this.audioBuffer && this.loopBeatCount) {
      this.detectedBpm = estimateBpmFromLoopLength(this.audioBuffer.duration, this.loopBeatCount);
    }
  }

  setFileName(nextFileName) {
    if (!this.sourceFile) {
      return;
    }

    const normalized = String(nextFileName ?? "").trim();
    this.exportFileNameValue = normalized || this.currentFileName;
    this.render();
    this.onStateChange?.();
  }

  setFilterControl(filterControl) {
    this.filterControl = Math.min(1, Math.max(-1, filterControl));
    const settings = getFilterSettings(this.filterControl, this.audioContext.sampleRate);

    this.dryGainNode.gain.value = settings.dryMix;
    this.wetGainNode.gain.value = settings.wetMix;
    for (const filterNode of this.filterNodes) {
      filterNode.type = settings.filterType;
      filterNode.frequency.value = settings.frequency;
    }

    this.render();
  }

  setBeatCount(nextBeatCount) {
    if (!Number.isInteger(nextBeatCount) || nextBeatCount < 1) {
      this.setState("error", "Loop beats must be a whole number greater than 0.");
      return;
    }

    this.loopBeatCount = nextBeatCount;
    this.detectedBpm = estimateBpmFromLoopLength(this.audioBuffer.duration, nextBeatCount);

    if (this.playbackActive) {
      const requestTime = this.audioContext.currentTime + START_LOOKAHEAD_SECONDS;
      const restartTime = this.transport.isArmed && requestTime < this.transport.anchorTime
        ? this.transport.anchorTime
        : this.transport.scheduleNextBar(requestTime, DEFAULT_BAR_BEAT_COUNT);
      this.restartAt(restartTime);
      this.onStateChange?.();
      return;
    }

    this.setState("ready", "\u00a0");
  }

  async start() {
    this.ensureDetectedBpm();
    if (!this.isReadyToStart) {
      this.setState("error", "Load a loop before starting playback.");
      return;
    }

    await this.audioContext.resume();

    const requestTime = this.audioContext.currentTime + START_LOOKAHEAD_SECONDS;
    const startTime = this.transport.scheduleNextBar(requestTime, DEFAULT_BAR_BEAT_COUNT);
    this.startAt(startTime);
    this.onStateChange?.();
  }

  requestStop() {
    if (!this.playbackActive) {
      this.stop();
      return;
    }

    const requestTime = this.audioContext.currentTime + START_LOOKAHEAD_SECONDS;
    const stopTime = this.transport.isArmed && requestTime < this.transport.anchorTime
      ? this.transport.anchorTime
      : this.transport.scheduleNextBar(requestTime, DEFAULT_BAR_BEAT_COUNT);

    this.requestStopAt(stopTime);
  }

  startAt(startTime, { notifySchedule = true } = {}) {
    this.ensureDetectedBpm();
    if (!this.isReadyToStart || !this.detectedBpm) {
      return;
    }

    this.playbackActive = true;
    this.pendingStopTime = null;
    this.restartAt(startTime, { notifySchedule, resetPhase: true });
  }

  requestStopAt(stopTime) {
    this.pendingStopTime = stopTime;
    this.clearPendingStopTimer();
    this.scheduleStoppedState(stopTime);
    this.trimScheduledPlayback(stopTime);
    this.setState("stopping", "Stopping");
  }

  stop(atTime = this.audioContext.currentTime) {
    this.clearPendingStartTimer();
    this.clearPendingStopTimer();
    this.pendingStopTime = null;
    this.playbackActive = false;
    this.clipStartBeatPosition = null;
    this.cancelScheduledPlayback(atTime);

    this.setState("ready", "Stopped.");
    this.updatePlayhead(atTime);
  }

  clearSlot() {
    this.stop();
    this.audioBuffer = null;
    this.sourceFile = null;
    this.currentFileName = "No file loaded";
    this.exportFileNameValue = "No file loaded";
    this.detectedBpm = null;
    this.loopBeatCount = null;
    this.element.updateWaveform(null);
    this.updatePlayhead(this.audioContext.currentTime);
    this.setState("idle", "\u00a0");
  }

  restartAt(startTime, { notifySchedule = true, resetPhase = false } = {}) {
    if (!this.audioBuffer || !this.detectedBpm || !this.loopBeatCount) {
      return;
    }

    this.clearPendingStartTimer();
    this.clearPendingStopTimer();
    this.cancelScheduledPlayback(startTime);

    if (resetPhase || this.clipStartBeatPosition === null) {
      this.clipStartBeatPosition = Math.round(this.transport.getPositionBeats(startTime));
    }

    if (startTime > this.audioContext.currentTime + START_LOOKAHEAD_SECONDS) {
      this.setState("queued", "Queued");
    } else {
      this.setState("playing", `Playing in sync at ${this.transport.bpm.toFixed(0)} BPM.`);
    }

    if (this.pendingStopTime !== null) {
      this.scheduleStoppedState(this.pendingStopTime);
    }

    if (notifySchedule) {
      this.onScheduleRequest?.(startTime);
    }
  }

  scheduleBarSegment(barStartTime, barDuration, masterBeatPosition) {
    if (!this.playbackActive || !this.audioBuffer || !this.detectedBpm || !this.loopBeatCount) {
      return;
    }

    const originalStopTime = barStartTime + barDuration;
    const minimumStartTime = quantizeTimeToSampleFrame(
      this.audioContext.currentTime + START_LOOKAHEAD_SECONDS,
      this.audioContext.sampleRate,
    );

    if (this.pendingStopTime !== null && barStartTime >= this.pendingStopTime) {
      return;
    }

    if (originalStopTime <= minimumStartTime) {
      return;
    }

    const barKey = this.barKey(barStartTime);
    if (this.scheduledBarKeys.has(barKey)) {
      return;
    }

    this.scheduledBarKeys.add(barKey);
    const effectiveStartTime = Math.max(barStartTime, minimumStartTime);
    const effectiveStopTime = this.pendingStopTime === null
      ? originalStopTime
      : Math.min(originalStopTime, this.pendingStopTime);
    const effectiveMasterBeatPosition = effectiveStartTime === barStartTime
      ? masterBeatPosition
      : this.transport.getPositionBeats(effectiveStartTime);
    const playbackRate = this.playbackRate;
    const source = this.audioContext.createBufferSource();
    source.buffer = this.audioBuffer;
    source.loop = true;
    source.playbackRate.setValueAtTime(playbackRate, effectiveStartTime);
    source.connect(this.dryGainNode);
    source.connect(this.filterNodes[0]);

    const beatsIntoLoop = positiveModulo(
      effectiveMasterBeatPosition - this.clipStartBeatPosition,
      this.loopBeatCount,
    );
    const bufferOffsetSeconds = quantizeTimeToSampleFrame(
      computeLoopDurationSeconds(beatsIntoLoop, this.detectedBpm) % this.audioBuffer.duration,
      this.audioBuffer.sampleRate,
    );

    this.scheduledSources.add(source);
    this.scheduledSegments.set(source, {
      startTime: effectiveStartTime,
      stopTime: effectiveStopTime,
    });
    source.onended = () => {
      this.scheduledSources.delete(source);
      this.scheduledSegments.delete(source);
      this.scheduledBarKeys.delete(barKey);

      if (!this.playbackActive && this.scheduledSources.size === 0) {
        this.render();
        this.onStateChange?.();
      }
    };

    source.start(effectiveStartTime, bufferOffsetSeconds);
    source.stop(effectiveStopTime);

    if (effectiveStartTime > this.audioContext.currentTime + START_LOOKAHEAD_SECONDS) {
      this.schedulePlayingState(effectiveStartTime, source);
    }
  }

  syncToMaster(startTime) {
    if (!this.isPlaying) {
      this.render();
      return;
    }

    this.restartAt(startTime);
  }

  render() {
    const playbackRate = this.playbackRate;
    const filterSettings = getFilterSettings(this.filterControl, this.audioContext.sampleRate);
    const loopDuration = this.loopBeatCount
      ? computeLoopDurationSeconds(this.loopBeatCount, this.transport.bpm)
      : null;
    const transportButton = this.getTransportButtonState();

    this.element.updateView({
      beatCount: this.loopBeatCount,
      beatCountDisabled: !this.audioBuffer,
      detectedBpm: this.detectedBpm ? `${this.detectedBpm.toFixed(1)} BPM` : "Pending",
      fileName: this.exportFileNameValue,
      filterControl: this.filterControl,
      filterLabel: filterSettings.label,
      transportButtonDisabled: transportButton.disabled,
      transportButtonLabel: transportButton.label,
      transportButtonVariant: transportButton.variant,
      statusPill: this.stateLabel(),
      statusText: this.statusMessage(loopDuration),
      volume: this.gainNode.gain.value,
    });
    this.updatePlayhead(this.audioContext.currentTime);
  }

  setState(nextState, message) {
    this.state = nextState;
    this.message = message;
    this.render();
  }

  stateLabel() {
    switch (this.state) {
      case "loading":
        return "Loading";
      case "queued":
        return "Queued";
      case "stopping":
        return "Stopping";
      case "playing":
        return "Playing";
      case "ready":
        return "Ready";
      case "error":
        return "Error";
      default:
        return "Idle";
    }
  }

  statusMessage(loopDuration) {
    if (this.message && (this.state === "loading" || this.state === "error")) {
      return this.message;
    }

    if (this.state === "queued") {
      return this.message ?? "Waiting for the next bar.";
    }

    if (this.state === "stopping") {
      return this.message ?? "Stopping on the next bar.";
    }

    if (this.state === "playing" && loopDuration) {
      return `Length: ${loopDuration.toFixed(2)}s`;
    }

    if (this.state === "ready" && this.detectedBpm) {
      return this.message ?? "Ready to sync with the transport.";
    }

    return this.message ?? "\u00a0";
  }

  clearPendingStartTimer() {
    if (this.pendingStartTimer !== null) {
      window.clearTimeout(this.pendingStartTimer);
      this.pendingStartTimer = null;
    }
  }

  clearPendingStopTimer() {
    if (this.pendingStopTimer !== null) {
      window.clearTimeout(this.pendingStopTimer);
      this.pendingStopTimer = null;
    }
  }

  cancelScheduledPlayback(atTime) {
    for (const source of this.scheduledSources) {
      try {
        source.stop(atTime);
      } catch (error) {
        console.warn(`Slot ${this.slotNumber} could not stop cleanly.`, error);
      }
    }

    this.scheduledSources.clear();
    this.scheduledSegments.clear();
    this.scheduledBarKeys.clear();
  }

  trimScheduledPlayback(stopTime) {
    for (const [source, segment] of this.scheduledSegments.entries()) {
      if (segment.stopTime > stopTime || segment.startTime >= stopTime) {
        try {
          source.stop(stopTime);
        } catch (error) {
          console.warn(`Slot ${this.slotNumber} could not queue a clean stop.`, error);
        }
      }
    }
  }

  schedulePlayingState(startTime, source) {
    this.clearPendingStartTimer();

    const delayMilliseconds = Math.max(
      0,
      ((startTime - this.audioContext.currentTime) * 1000) - 16,
    );

    this.pendingStartTimer = window.setTimeout(() => {
      this.pendingStartTimer = null;

      if (this.playbackActive && this.scheduledSources.has(source)) {
        this.setState("playing", `Playing in sync at ${this.transport.bpm.toFixed(0)} BPM.`);
        this.onStateChange?.();
      }
    }, delayMilliseconds);
  }

  scheduleStoppedState(stopTime) {
    const delayMilliseconds = Math.max(
      0,
      ((stopTime - this.audioContext.currentTime) * 1000) - 16,
    );

    this.pendingStopTimer = window.setTimeout(() => {
      this.pendingStopTimer = null;
      this.pendingStopTime = null;
      this.playbackActive = false;
      this.clipStartBeatPosition = null;
      this.setState("ready", "Stopped.");
      this.onStateChange?.();
    }, delayMilliseconds);
  }

  barKey(barStartTime) {
    return barStartTime.toFixed(6);
  }

  updatePlayhead(atTime) {
    this.element.updatePlayhead(this.getPlayheadSnapshot(atTime));
  }

  getPlayheadSnapshot(atTime) {
    if (!this.audioBuffer || !this.detectedBpm || !this.loopBeatCount) {
      return {
        progress: 0,
        active: false,
        label: "Idle",
      };
    }

    if (!this.playbackActive || !this.transport.isActive) {
      return {
        progress: 0,
        active: false,
        label: `Beat 0.00 / ${this.loopBeatCount}`,
      };
    }

    const beatsIntoLoop = positiveModulo(
      this.transport.getPositionBeats(atTime) - this.clipStartBeatPosition,
      this.loopBeatCount,
    );
    return {
      progress: beatsIntoLoop / this.loopBeatCount,
      active: this.transport.isRunning,
      label: `Beat ${beatsIntoLoop.toFixed(2)} / ${this.loopBeatCount}`,
    };
  }

  getTransportButtonState() {
    if (this.state === "loading" || !this.audioBuffer || !this.detectedBpm || !this.loopBeatCount) {
      return {
        disabled: true,
        label: "Start",
        variant: "secondary",
      };
    }

    if (this.state === "stopping") {
      return {
        disabled: true,
        label: "Stopping...",
        variant: "outline-secondary",
      };
    }

    if (this.playbackActive) {
      return {
        disabled: false,
        label: "Stop",
        variant: "outline-secondary",
      };
    }

    if (this.state === "queued") {
      return {
        disabled: false,
        label: "Stop",
        variant: "outline-secondary",
      };
    }

    return {
      disabled: false,
      label: "Start",
      variant: "primary",
    };
  }
}

class LoopLabApp {
  constructor() {
    this.exportWavsButton = document.querySelector("#export-wavs");
    this.masterTransportButton = document.querySelector("#master-transport");
    this.metronomeToggle = document.querySelector("#metronome-enabled");
    this.masterBpmInput = document.querySelector("#master-bpm");
    this.slotGrid = document.querySelector("#slot-grid");

    const masterBpm = clampBpm(Number(this.masterBpmInput.value));
    const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
    this.audioContext = new AudioContextClass();
    this.metronomeEnabled = this.metronomeToggle.checked;
    this.transport = new TransportClock({ bpm: masterBpm });
    this.metronomeGainNode = this.audioContext.createGain();
    this.metronomeGainNode.connect(this.audioContext.destination);
    this.metronomeGainNode.gain.value = 0.2;
    this.playheadAnimationFrameId = null;
    this.transportSchedulerId = null;
    this.nextBarStartTime = null;
    this.nextBarBeatPosition = null;
    this.nextMetronomeBeatTime = null;
    this.nextMetronomeBeatPosition = null;
    this.lastMasterTransportPressAt = 0;
    this.slots = [];

    this.applySystemTheme();
    this.renderSlots();
    this.bindEvents();
    this.renderMasterTransportButton();
    this.renderExportButton();
    this.renderPlayheads();
  }

  applySystemTheme() {
    document.documentElement.setAttribute("data-bs-theme", "dark");
  }

  renderSlots() {
    for (let slotNumber = 1; slotNumber <= SLOT_COUNT; slotNumber += 1) {
      const column = document.createElement("div");
      column.className = "col-12 col-sm-6 col-xl-3";

      const element = document.createElement("loop-slot");
      element.dataset.slotNumber = String(slotNumber);
      element.setAttribute("role", "group");
      element.setAttribute("aria-label", `Loop slot ${slotNumber}`);
      column.append(element);
      this.slotGrid.append(column);

      const slot = new LoopPlayerSlot({
        audioContext: this.audioContext,
        element,
        slotNumber,
        transport: this.transport,
      });

      slot.onStateChange = () => {
        this.syncTransportState();
        this.renderMasterTransportButton();
        this.renderExportButton();
        this.syncPlayheadAnimation();
        this.renderPlayheads();
      };
      slot.onScheduleRequest = (startTime) => {
        this.primeTransportSchedule(startTime);
      };

      this.slots.push(slot);
    }
  }

  bindEvents() {
    this.exportWavsButton.addEventListener("click", () => {
      this.exportLoadedWavs();
    });

    const triggerMasterTransport = () => {
      this.lastMasterTransportPressAt = window.performance.now();
      void this.toggleMasterTransport().catch((error) => {
        console.error("Master transport toggle failed.", error);
      });
    };

    this.masterTransportButton.addEventListener("touchstart", (event) => {
      event.preventDefault();
      triggerMasterTransport();
    });

    this.masterTransportButton.addEventListener("mousedown", (event) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      triggerMasterTransport();
    });

    this.masterTransportButton.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      event.preventDefault();
      triggerMasterTransport();
    });

    this.masterTransportButton.addEventListener("click", () => {
      const elapsed = window.performance.now() - this.lastMasterTransportPressAt;
      if (elapsed < 400) {
        return;
      }

      triggerMasterTransport();
    });

    this.masterBpmInput.addEventListener("change", () => {
      this.handleMasterBpmChange();
    });

    this.metronomeToggle.addEventListener("change", async () => {
      this.metronomeEnabled = this.metronomeToggle.checked;
      await this.audioContext.resume();

      if (this.metronomeEnabled && !this.transport.isActive) {
        const startTime = this.transport.scheduleNextBar(
          this.audioContext.currentTime + START_LOOKAHEAD_SECONDS,
          DEFAULT_BAR_BEAT_COUNT,
        );
        this.primeTransportSchedule(startTime);
      } else if (this.metronomeEnabled && this.transport.isActive) {
        this.resetMetronomeSchedule(this.audioContext.currentTime + START_LOOKAHEAD_SECONDS);
        this.startTransportScheduler();
        this.schedulerTick();
      } else if (!this.metronomeEnabled && !this.slots.some((slot) => slot.isPlaying)) {
        this.transport.stop();
        this.stopTransportScheduler();
      }
    });
  }

  handleMasterBpmChange() {
    const nextBpm = clampBpm(Number(this.masterBpmInput.value));
    this.masterBpmInput.value = String(nextBpm);

    const effectiveTime = this.audioContext.currentTime + START_LOOKAHEAD_SECONDS;
    this.transport.setBpm(nextBpm, effectiveTime);
    const restartTime = this.transport.isArmed && effectiveTime < this.transport.anchorTime
      ? this.transport.anchorTime
      : this.transport.scheduleNextBar(effectiveTime, DEFAULT_BAR_BEAT_COUNT);
    this.primeTransportSchedule(restartTime);

    for (const slot of this.slots) {
      slot.syncToMaster(restartTime);
    }
  }

  syncTransportState() {
    const anyPlaying = this.slots.some((slot) => slot.isPlaying);
    if (!anyPlaying && !this.metronomeEnabled) {
      this.transport.stop();
      this.stopTransportScheduler();
    }
  }

  hasMasterTransportAction() {
    return this.slots.some((slot) => slot.isPlaying || slot.audioBuffer);
  }

  renderMasterTransportButton() {
    const anyPlaying = this.slots.some((slot) => slot.isPlaying);
    const isAvailable = this.hasMasterTransportAction();

    this.masterTransportButton.setAttribute("aria-disabled", isAvailable ? "false" : "true");
    this.masterTransportButton.textContent = anyPlaying ? "Stop" : "Start";
    this.masterTransportButton.className = anyPlaying
      ? "btn btn-outline-secondary btn-sm master-transport-button"
      : "btn btn-primary btn-sm master-transport-button";

  }

  async toggleMasterTransport() {
    const activeSlots = this.slots.filter((slot) => slot.isPlaying);
    if (activeSlots.length) {
      const requestTime = this.audioContext.currentTime + START_LOOKAHEAD_SECONDS;
      const stopTime = this.transport.isArmed && requestTime < this.transport.anchorTime
        ? this.transport.anchorTime
        : this.transport.scheduleNextBar(requestTime, DEFAULT_BAR_BEAT_COUNT);

      for (const slot of activeSlots) {
        slot.requestStopAt(stopTime);
      }

      this.renderMasterTransportButton();
      this.syncPlayheadAnimation();
      this.renderPlayheads();
      return;
    }

    const readySlots = this.slots.filter((slot) => slot.isReadyToStart);
    if (!readySlots.length) {
      return;
    }

    try {
      await this.audioContext.resume();

      const transportWasActive = this.transport.isActive;
      const requestTime = this.audioContext.currentTime + (
        transportWasActive ? START_LOOKAHEAD_SECONDS : MASTER_IMMEDIATE_START_LEAD_SECONDS
      );
      const startTime = transportWasActive
        ? this.transport.scheduleNextBar(requestTime, DEFAULT_BAR_BEAT_COUNT)
        : this.transport.start(
          quantizeTimeToSampleFrame(requestTime, this.audioContext.sampleRate),
        );

      for (const slot of readySlots) {
        slot.startAt(startTime, { notifySchedule: false });
      }

      this.renderMasterTransportButton();
      this.syncPlayheadAnimation();
      this.renderPlayheads();

      if (transportWasActive) {
        this.primeTransportSchedule(startTime);
      } else {
        const firstBarDuration = computeLoopDurationSeconds(DEFAULT_BAR_BEAT_COUNT, this.transport.bpm);
        for (const slot of readySlots) {
          slot.scheduleBarSegment(startTime, firstBarDuration, 0);
        }
        this.primeImmediateTransportSchedule(startTime);
      }
    } catch (error) {
      console.error("Master transport start failed.", error);
    }
  }

  renderExportButton() {
    this.exportWavsButton.disabled = this.getLoadedExportItems().length === 0;
  }

  getLoadedExportItems() {
    return this.slots
      .map((slot) => ({
        beatCount: slot.exportBeatCount,
        file: slot.exportFile,
        fileName: slot.exportFileName,
      }))
      .filter(({ file }) => file instanceof File);
  }

  buildExportFilename(fileName, beatCount) {
    if (!Number.isInteger(beatCount) || beatCount < 1) {
      return fileName;
    }

    const existingBeatCount = parseBeatCountFromFilename(fileName);
    if (existingBeatCount === beatCount) {
      return fileName;
    }

    const extensionIndex = fileName.lastIndexOf(".");
    if (extensionIndex <= 0) {
      return `${fileName}_${beatCount}beats`;
    }

    const baseName = fileName.slice(0, extensionIndex);
    const extension = fileName.slice(extensionIndex);
    return `${baseName}_${beatCount}beats${extension}`;
  }

  exportLoadedWavs() {
    const items = this.getLoadedExportItems();
    if (!items.length) {
      return;
    }

    for (const { file, beatCount, fileName } of items) {
      const downloadUrl = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = this.buildExportFilename(fileName, beatCount);
      link.click();
      window.setTimeout(() => {
        URL.revokeObjectURL(downloadUrl);
      }, 1000);
    }
  }

  primeTransportSchedule(startTime) {
    this.nextBarStartTime = quantizeTimeToSampleFrame(startTime, this.audioContext.sampleRate);
    this.nextBarBeatPosition = Math.round(this.transport.getPositionBeats(this.nextBarStartTime));
    this.resetMetronomeSchedule(this.nextBarStartTime);
    this.startTransportScheduler();
    this.schedulerTick();
  }

  primeImmediateTransportSchedule(startTime) {
    this.nextBarBeatPosition = DEFAULT_BAR_BEAT_COUNT;
    this.nextBarStartTime = quantizeTimeToSampleFrame(
      this.transport.getTimeForBeat(this.nextBarBeatPosition),
      this.audioContext.sampleRate,
    );
    this.nextMetronomeBeatPosition = 0;
    this.nextMetronomeBeatTime = quantizeTimeToSampleFrame(startTime, this.audioContext.sampleRate);
    this.startTransportScheduler();
    this.schedulerTick();
  }

  startTransportScheduler() {
    if (this.transportSchedulerId !== null) {
      return;
    }

    this.transportSchedulerId = window.setInterval(() => {
      this.schedulerTick();
    }, TRANSPORT_SCHEDULER_INTERVAL_MS);
  }

  stopTransportScheduler() {
    if (this.transportSchedulerId !== null) {
      window.clearInterval(this.transportSchedulerId);
      this.transportSchedulerId = null;
    }

    this.nextBarStartTime = null;
    this.nextBarBeatPosition = null;
    this.nextMetronomeBeatTime = null;
    this.nextMetronomeBeatPosition = null;
  }

  resetMetronomeSchedule(atTime) {
    if (!this.transport.isActive) {
      this.nextMetronomeBeatTime = null;
      this.nextMetronomeBeatPosition = null;
      return;
    }

    const requestedTime = quantizeTimeToSampleFrame(atTime, this.audioContext.sampleRate);
    let beatPosition = Math.ceil(this.transport.getPositionBeats(requestedTime));
    let beatTime = quantizeTimeToSampleFrame(
      this.transport.getTimeForBeat(beatPosition),
      this.audioContext.sampleRate,
    );

    if (beatTime < requestedTime) {
      beatPosition += 1;
      beatTime = quantizeTimeToSampleFrame(
        this.transport.getTimeForBeat(beatPosition),
        this.audioContext.sampleRate,
      );
    }

    this.nextMetronomeBeatPosition = beatPosition;
    this.nextMetronomeBeatTime = beatTime;
  }

  schedulerTick() {
    const activeSlots = this.slots.filter((slot) => slot.isPlaying);
    if ((!activeSlots.length && !this.metronomeEnabled) || !this.transport.isActive) {
      this.stopTransportScheduler();
      return;
    }

    const previousTransportState = this.transport.state;
    this.transport.syncState(this.audioContext.currentTime);
    if (previousTransportState !== this.transport.state) {
      this.renderPlayheads();
    }

    if (this.nextBarStartTime === null) {
      this.nextBarStartTime = quantizeTimeToSampleFrame(
        this.transport.anchorTime,
        this.audioContext.sampleRate,
      );
    }

    if (this.nextBarBeatPosition === null) {
      this.nextBarBeatPosition = Math.round(this.transport.getPositionBeats(this.nextBarStartTime));
    }

    if (this.nextMetronomeBeatTime === null) {
      this.nextMetronomeBeatTime = this.nextBarStartTime;
    }

    if (this.nextMetronomeBeatPosition === null) {
      this.nextMetronomeBeatPosition = this.nextBarBeatPosition;
    }

    const barDuration = computeLoopDurationSeconds(DEFAULT_BAR_BEAT_COUNT, this.transport.bpm);
    const scheduleLimit = this.audioContext.currentTime + TRANSPORT_SCHEDULER_LOOKAHEAD_SECONDS;

    while (this.metronomeEnabled && this.nextMetronomeBeatTime <= scheduleLimit) {
      this.scheduleMetronomeClick(this.nextMetronomeBeatTime, this.nextMetronomeBeatPosition);
      this.nextMetronomeBeatPosition += 1;
      this.nextMetronomeBeatTime = quantizeTimeToSampleFrame(
        this.transport.getTimeForBeat(this.nextMetronomeBeatPosition),
        this.audioContext.sampleRate,
      );
    }

    while (this.nextBarStartTime <= scheduleLimit) {
      for (const slot of activeSlots) {
        slot.scheduleBarSegment(this.nextBarStartTime, barDuration, this.nextBarBeatPosition);
      }

      this.nextBarBeatPosition += DEFAULT_BAR_BEAT_COUNT;
      this.nextBarStartTime = quantizeTimeToSampleFrame(
        this.transport.getTimeForBeat(this.nextBarBeatPosition),
        this.audioContext.sampleRate,
      );
    }
  }

  scheduleMetronomeClick(beatTime, beatPosition) {
    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();
    const beatInBar = positiveModulo(beatPosition, DEFAULT_BAR_BEAT_COUNT);
    const isDownbeat = beatInBar === 0;

    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(isDownbeat ? 1760 : 1320, beatTime);

    gainNode.gain.setValueAtTime(0.0001, beatTime);
    gainNode.gain.exponentialRampToValueAtTime(isDownbeat ? 0.22 : 0.12, beatTime + 0.001);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, beatTime + METRONOME_CLICK_DURATION_SECONDS);

    oscillator.connect(gainNode);
    gainNode.connect(this.metronomeGainNode);

    oscillator.start(beatTime);
    oscillator.stop(beatTime + METRONOME_CLICK_DURATION_SECONDS);
  }

  syncPlayheadAnimation() {
    const shouldAnimate = this.transport.isActive && this.slots.some((slot) => slot.isPlaying);
    if (shouldAnimate && this.playheadAnimationFrameId === null) {
      this.playheadAnimationFrameId = window.requestAnimationFrame(() => {
        this.tickPlayheads();
      });
      return;
    }

    if (!shouldAnimate && this.playheadAnimationFrameId !== null) {
      window.cancelAnimationFrame(this.playheadAnimationFrameId);
      this.playheadAnimationFrameId = null;
    }
  }

  tickPlayheads() {
    this.playheadAnimationFrameId = null;
    this.renderPlayheads();
    this.syncPlayheadAnimation();
  }

  renderPlayheads() {
    const atTime = this.audioContext.currentTime;
    for (const slot of this.slots) {
      slot.updatePlayhead(atTime);
    }
  }
}

window.addEventListener("DOMContentLoaded", () => {
  new LoopLabApp();
});
