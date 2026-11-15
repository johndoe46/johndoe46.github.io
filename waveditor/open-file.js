const openFileHostState = {
  loadedFilesByDocumentId: Object.create(null),
  recordingSession: null,
};
const parseWAVSampleLoops = globalThis.MDWaveEditorCore?.parseWAVSampleLoops;

const imageAudioSampleRate = 48000;
const maxImageAudioSamples = imageAudioSampleRate * 30;
const spectrogramHopSize = 512;
const maxSpectrogramColumns = 1024;
const maxSpectrogramBins = 80;
const spectrogramMinFrequency = 55;
const spectrogramMaxFrequency = 9000;
const recorderWorkletModulePath = "md-waveditor-recorder-worklet.js";

function isWAVLikeFile(file) {
  const lowerName = String(file?.name || "").toLowerCase();
  const lowerType = String(file?.type || "").toLowerCase();
  return (
    lowerName.endsWith(".wav") ||
    lowerName.endsWith(".wave") ||
    lowerType === "audio/wav" ||
    lowerType === "audio/wave" ||
    lowerType === "audio/x-wav"
  );
}

function isImageFile(file) {
  const lowerName = String(file?.name || "").toLowerCase();
  const lowerType = String(file?.type || "").toLowerCase();
  return (
    lowerType.startsWith("image/") ||
    /\.(png|jpe?g|gif|webp|bmp)$/i.test(lowerName)
  );
}

function buildExportFileName(file) {
  const originalName = String(file?.name || "edited").trim() || "edited";
  const extensionMatch = originalName.match(/(\.[^.]+)$/);
  const originalExtension = extensionMatch ? extensionMatch[1] : "";
  const baseName = originalExtension
    ? originalName.slice(0, -originalExtension.length)
    : originalName;

  if (isWAVLikeFile(file)) {
    const wavExtension = originalExtension.toLowerCase() === ".wave" ? ".wave" : ".wav";
    return `${baseName}-edited${wavExtension}`;
  }

  return `${baseName}-edited.wav`;
}

function buildMarkerRegionFileNames(file, regionCount) {
  const editedFileName = buildExportFileName(file);
  const extensionMatch = editedFileName.match(/(\.[^.]+)$/);
  const extension = extensionMatch ? extensionMatch[1] : ".wav";
  const baseName = extensionMatch
    ? editedFileName.slice(0, -extension.length)
    : editedFileName;
  const digits = String(Math.max(1, regionCount)).length;
  return Array.from({ length: regionCount }, (_, index) =>
    `${baseName}-region-${String(index + 1).padStart(digits, "0")}${extension}`);
}

function buildExportImageFileName(file) {
  const editedFileName = buildExportFileName(file);
  const extensionMatch = editedFileName.match(/(\.[^.]+)$/);
  const baseName = extensionMatch
    ? editedFileName.slice(0, -extensionMatch[1].length)
    : editedFileName;
  return `${baseName}.png`;
}

function buildRecordingFileName() {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  return `recording-${year}${month}${day}-${hours}${minutes}${seconds}.wav`;
}

function getExportChannelCount(editorElement) {
  const audioInfo = typeof editorElement.getAudioInfo === "function"
    ? editorElement.getAudioInfo()
    : null;
  return audioInfo?.channels === 1 ? 1 : 2;
}

function triggerBrowserDownload(blob, fileName) {
  const downloadURL = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadURL;
  link.download = fileName;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(downloadURL);
  }, 1000);
}

function updateExportButtonState() {
  const exportButton = document.getElementById("exportLocalFileButton");
  const exportRegionsButton = document.getElementById("exportMarkerRegionsButton");
  const exportImageButton = document.getElementById("exportImageButton");
  const recordButton = document.getElementById("recordAudioButton");
  const editorElement = document.getElementById("localAudioEditor");
  if (
    !(exportButton instanceof HTMLButtonElement) ||
    !(exportRegionsButton instanceof HTMLButtonElement) ||
    !(exportImageButton instanceof HTMLButtonElement) ||
    !(recordButton instanceof HTMLButtonElement) ||
    !(editorElement instanceof HTMLElement)
  ) {
    return;
  }
  const activeDocumentID = typeof editorElement.getActiveDocumentId === "function"
    ? editorElement.getActiveDocumentId()
    : 0;
  const activeLoadedFile = activeDocumentID
    ? openFileHostState.loadedFilesByDocumentId[activeDocumentID] || null
    : null;
  const hasAudio = Boolean(
    activeLoadedFile &&
    typeof editorElement.getAudioInfo === "function" &&
    editorElement.getAudioInfo(),
  );
  exportButton.disabled = !hasAudio;
  exportRegionsButton.disabled = !hasAudio;
  exportImageButton.disabled = !hasAudio;
  recordButton.classList.toggle("btn-danger", Boolean(openFileHostState.recordingSession));
  recordButton.classList.toggle("btn-outline-danger", !openFileHostState.recordingSession);
}

function updateRecordingButtonState() {
  const recordButton = document.getElementById("recordAudioButton");
  const recordIcon = document.getElementById("recordAudioButtonIcon");
  const recordLabel = document.getElementById("recordAudioButtonLabel");
  if (
    !(recordButton instanceof HTMLButtonElement) ||
    !(recordIcon instanceof HTMLElement) ||
    !(recordLabel instanceof HTMLElement)
  ) {
    return;
  }

  const isRecording = Boolean(openFileHostState.recordingSession);
  recordIcon.className = isRecording ? "bi bi-stop-circle" : "bi bi-record-circle";
  recordLabel.textContent = isRecording ? "Stop" : "Record";
  recordButton.title = isRecording
    ? "Stop recording and load the captured raw PCM into a new editor tab."
    : "Record raw PCM audio from the microphone into a new editor tab.";
  recordButton.dataset.uiHint = isRecording
    ? "Stop recording and load the captured raw PCM into a new editor tab."
    : "Record raw PCM audio from the microphone into a new editor tab without using a lossy codec.";
}

function getActiveLoadedFile(editorElement) {
  if (!(editorElement instanceof HTMLElement) || typeof editorElement.getActiveDocumentId !== "function") {
    return null;
  }
  const activeDocumentID = editorElement.getActiveDocumentId();
  return activeDocumentID
    ? openFileHostState.loadedFilesByDocumentId[activeDocumentID] || null
    : null;
}

function updatePageTitle(editorElement) {
  const activeLoadedFile = getActiveLoadedFile(editorElement);
  document.title = activeLoadedFile ? `${activeLoadedFile.name} | Waveditor` : "Waveditor";
}

function blurOpenFileButtonAfterLoad() {
  const openButton = document.getElementById("openLocalFileButton");
  if (openButton instanceof HTMLButtonElement && document.activeElement === openButton) {
    openButton.blur();
  }
}

function blurRecordButtonAfterStop() {
  const recordButton = document.getElementById("recordAudioButton");
  if (recordButton instanceof HTMLButtonElement && document.activeElement === recordButton) {
    recordButton.blur();
  }
}

function storeLoadedFileForActiveDocument(editorElement, file) {
  if (!(editorElement instanceof HTMLElement) || typeof editorElement.getActiveDocumentId !== "function") {
    return;
  }
  const activeDocumentID = editorElement.getActiveDocumentId();
  if (!activeDocumentID) {
    return;
  }
  openFileHostState.loadedFilesByDocumentId[activeDocumentID] = file;
}

function syncLoadedFilesWithDocuments(editorElement) {
  if (!(editorElement instanceof HTMLElement) || typeof editorElement.getDocuments !== "function") {
    return;
  }
  const validDocumentIDs = new Set(
    editorElement.getDocuments().map((documentState) => String(documentState.id)),
  );
  for (const documentID of Object.keys(openFileHostState.loadedFilesByDocumentId)) {
    if (!validDocumentIDs.has(documentID)) {
      delete openFileHostState.loadedFilesByDocumentId[documentID];
    }
  }
}

function shouldReuseActiveDocument(editorElement) {
  if (!(editorElement instanceof HTMLElement)) {
    return false;
  }
  const hasAudio = typeof editorElement.getAudioInfo === "function" && editorElement.getAudioInfo();
  const documents = typeof editorElement.getDocuments === "function"
    ? editorElement.getDocuments()
    : [];
  return !hasAudio && documents.length <= 1;
}

function buildAudioBufferFromRecordingSession(recordingSession) {
  const channelCount = recordingSession.channelChunks.length;
  const frameCount = recordingSession.channelChunks[0]?.reduce(
    (totalFrames, chunk) => totalFrames + chunk.length,
    0,
  ) || 0;
  if (channelCount === 0 || frameCount === 0) {
    return null;
  }

  const audioBuffer = new AudioBuffer({
    length: frameCount,
    numberOfChannels: channelCount,
    sampleRate: recordingSession.sampleRate,
  });

  for (let channel = 0; channel < channelCount; channel += 1) {
    const channelData = audioBuffer.getChannelData(channel);
    let offset = 0;
    for (const chunk of recordingSession.channelChunks[channel]) {
      channelData.set(chunk, offset);
      offset += chunk.length;
    }
  }

  return audioBuffer;
}

function handleRecordingChunkMessage(event) {
  const recordingSession = openFileHostState.recordingSession;
  if (!recordingSession) {
    return;
  }

  const channels = Array.isArray(event?.data?.channels) ? event.data.channels : [];
  for (let channel = 0; channel < channels.length; channel += 1) {
    const chunk = channels[channel];
    if (!(chunk instanceof Float32Array)) {
      continue;
    }
    if (!recordingSession.channelChunks[channel]) {
      recordingSession.channelChunks[channel] = [];
    }
    recordingSession.channelChunks[channel].push(chunk);
  }
}

async function loadRecordedAudioBuffer(audioBuffer) {
  const editorElement = document.getElementById("localAudioEditor");
  if (!(editorElement instanceof HTMLElement)) {
    throw new Error("The local md-waveditor host element is missing.");
  }

  const fileName = buildRecordingFileName();
  const loadOptions = {
    fileName,
    suggestedFileName: fileName,
    readyMessage: "Recording loaded into a new editor tab.",
  };
  if (shouldReuseActiveDocument(editorElement)) {
    await editorElement.loadAudioBuffer(audioBuffer, loadOptions);
  } else {
    await editorElement.addAudioBuffer(audioBuffer, loadOptions);
  }
  storeLoadedFileForActiveDocument(editorElement, {
    name: fileName,
    type: "audio/wav",
  });
  updateExportButtonState();
  updatePageTitle(editorElement);
}

async function startRecording() {
  const editorElement = document.getElementById("localAudioEditor");
  if (!(editorElement instanceof HTMLElement)) {
    throw new Error("The local md-waveditor host element is missing.");
  }
  if (openFileHostState.recordingSession) {
    return stopRecording();
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    editorElement.setStatus("Microphone capture is not available in this browser.", "warning");
    return;
  }
  if (typeof AudioWorkletNode !== "function" || typeof AudioContext !== "function") {
    editorElement.setStatus("Raw PCM recording requires AudioWorklet support in this browser.", "warning");
    return;
  }

  try {
    const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const audioContext = new AudioContext({ sampleRate: imageAudioSampleRate });
    await audioContext.audioWorklet.addModule(recorderWorkletModulePath);

    const mediaSourceNode = audioContext.createMediaStreamSource(mediaStream);
    const recorderNode = new AudioWorkletNode(audioContext, "md-waveditor-recorder");
    const silentMonitorNode = audioContext.createGain();
    silentMonitorNode.gain.value = 0;
    recorderNode.port.onmessage = handleRecordingChunkMessage;

    mediaSourceNode.connect(recorderNode);
    recorderNode.connect(silentMonitorNode);
    silentMonitorNode.connect(audioContext.destination);
    await audioContext.resume();

    openFileHostState.recordingSession = {
      audioContext,
      mediaStream,
      mediaSourceNode,
      recorderNode,
      silentMonitorNode,
      sampleRate: audioContext.sampleRate,
      channelChunks: [],
    };
    updateRecordingButtonState();
    updateExportButtonState();
    editorElement.setStatus("Recording raw PCM from the microphone...", "danger");
  } catch (error) {
    editorElement.setStatus(`Recording failed to start: ${error.message}`, "danger");
  }
}

async function stopRecording() {
  const editorElement = document.getElementById("localAudioEditor");
  if (!(editorElement instanceof HTMLElement)) {
    throw new Error("The local md-waveditor host element is missing.");
  }

  const recordingSession = openFileHostState.recordingSession;
  if (!recordingSession) {
    return;
  }

  openFileHostState.recordingSession = null;
  updateRecordingButtonState();
  updateExportButtonState();

  try {
    recordingSession.mediaSourceNode?.disconnect?.();
    recordingSession.recorderNode?.disconnect?.();
    recordingSession.silentMonitorNode?.disconnect?.();
    recordingSession.mediaStream?.getTracks?.().forEach((track) => track.stop());
    if (recordingSession.audioContext?.state !== "closed") {
      await recordingSession.audioContext.close();
    }

    const audioBuffer = buildAudioBufferFromRecordingSession(recordingSession);
    if (!audioBuffer) {
      editorElement.setStatus("Recording stopped, but no audio was captured.", "warning");
      return;
    }

    await loadRecordedAudioBuffer(audioBuffer);
    blurRecordButtonAfterStop();
  } catch (error) {
    editorElement.setStatus(`Recording failed to stop cleanly: ${error.message}`, "danger");
  }
}

function toggleRecording() {
  return openFileHostState.recordingSession ? stopRecording() : startRecording();
}

function getImageInterpretationMode() {
  const select = document.getElementById("imageInterpretationSelect");
  return select instanceof HTMLSelectElement && select.value === "spectrogram"
    ? "spectrogram"
    : "waveform";
}

function createImageBitmapFromFile(file) {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file).catch(() => createImageElementFromFile(file));
  }

  return createImageElementFromFile(file);
}

function createImageElementFromFile(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectURL = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(objectURL);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectURL);
      reject(new Error("Could not decode the image file."));
    };
    image.src = objectURL;
  });
}

async function readImagePixels(file) {
  const image = await createImageBitmapFromFile(file);
  const imageWidth = image.width || image.naturalWidth || 0;
  const imageHeight = image.height || image.naturalHeight || 0;
  if (imageWidth <= 0 || imageHeight <= 0) {
    throw new Error("The image has no readable pixels.");
  }

  const totalPixels = imageWidth * imageHeight;
  const sampleStep = Math.max(1, Math.ceil(totalPixels / maxImageAudioSamples));
  const sampleCount = Math.max(1, Math.ceil(totalPixels / sampleStep));
  const canvas = document.createElement("canvas");
  canvas.width = imageWidth;
  canvas.height = imageHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("Canvas image decoding is not available in this browser.");
  }
  context.drawImage(image, 0, 0, imageWidth, imageHeight);
  if (typeof image.close === "function") {
    image.close();
  }

  return {
    width: imageWidth,
    height: imageHeight,
    pixels: context.getImageData(0, 0, imageWidth, imageHeight).data,
  };
}

function getPixelLuminance(pixels, pixelIndex) {
  const offset = pixelIndex * 4;
  const red = pixels[offset] || 0;
  const green = pixels[offset + 1] || 0;
  const blue = pixels[offset + 2] || 0;
  const alpha = (pixels[offset + 3] ?? 255) / 255;
  return ((0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255) * alpha;
}

function decodeImagePixelsAsWaveformAudioBuffer(imagePixels) {
  const { width, height, pixels } = imagePixels;
  const totalPixels = width * height;
  const sampleStep = Math.max(1, Math.ceil(totalPixels / maxImageAudioSamples));
  const sampleCount = Math.max(1, Math.ceil(totalPixels / sampleStep));
  const audioBuffer = new AudioBuffer({
    length: sampleCount,
    numberOfChannels: 1,
    sampleRate: imageAudioSampleRate,
  });
  const channelData = audioBuffer.getChannelData(0);

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const pixelIndex = Math.min(totalPixels - 1, sampleIndex * sampleStep);
    const luminance = getPixelLuminance(pixels, pixelIndex);
    channelData[sampleIndex] = (luminance * 2 - 1) * 0.85;
  }

  return audioBuffer;
}

function getSpectrogramPixelAmplitude(imagePixels, column, bin, columnCount, binCount) {
  const { width, height, pixels } = imagePixels;
  const sourceX = columnCount <= 1
    ? 0
    : Math.round((column / (columnCount - 1)) * (width - 1));
  const normalizedBin = binCount <= 1 ? 0 : bin / (binCount - 1);
  const sourceY = Math.round((1 - normalizedBin) * (height - 1));
  const luminance = getPixelLuminance(pixels, sourceY * width + sourceX);
  return Math.max(0, luminance - 0.03) ** 1.6;
}

function decodeImagePixelsAsSpectrogramAudioBuffer(imagePixels) {
  const columnCount = Math.max(1, Math.min(imagePixels.width, maxSpectrogramColumns));
  const binCount = Math.max(1, Math.min(imagePixels.height, maxSpectrogramBins));
  const frameCount = Math.max(1, columnCount * spectrogramHopSize);
  const amplitudes = new Float32Array(columnCount * binCount);
  const audioBuffer = new AudioBuffer({
    length: frameCount,
    numberOfChannels: 1,
    sampleRate: imageAudioSampleRate,
  });
  const channelData = audioBuffer.getChannelData(0);
  const phases = new Float64Array(binCount);
  const phaseSteps = new Float64Array(binCount);
  const frequencyRatio = spectrogramMaxFrequency / spectrogramMinFrequency;

  for (let bin = 0; bin < binCount; bin += 1) {
    const normalizedBin = binCount <= 1 ? 0 : bin / (binCount - 1);
    const frequency = spectrogramMinFrequency * (frequencyRatio ** normalizedBin);
    phaseSteps[bin] = (Math.PI * 2 * frequency) / imageAudioSampleRate;
  }

  for (let column = 0; column < columnCount; column += 1) {
    for (let bin = 0; bin < binCount; bin += 1) {
      amplitudes[column * binCount + bin] = getSpectrogramPixelAmplitude(
        imagePixels,
        column,
        bin,
        columnCount,
        binCount,
      );
    }
  }

  for (let column = 0; column < columnCount; column += 1) {
    for (let sampleOffset = 0; sampleOffset < spectrogramHopSize; sampleOffset += 1) {
      const outputIndex = column * spectrogramHopSize + sampleOffset;
      const columnProgress = sampleOffset / spectrogramHopSize;
      let sample = 0;

      for (let bin = 0; bin < binCount; bin += 1) {
        const currentAmplitude = amplitudes[column * binCount + bin];
        const nextAmplitude = amplitudes[Math.min(columnCount - 1, column + 1) * binCount + bin];
        const amplitude = currentAmplitude + (nextAmplitude - currentAmplitude) * columnProgress;
        sample += Math.sin(phases[bin]) * amplitude;
        phases[bin] = (phases[bin] + phaseSteps[bin]) % (Math.PI * 2);
      }

      channelData[outputIndex] = sample / Math.sqrt(binCount);
    }
  }

  let peak = 0;
  for (let index = 0; index < channelData.length; index += 1) {
    peak = Math.max(peak, Math.abs(channelData[index]));
  }
  if (peak > 0) {
    const gain = 0.9 / peak;
    for (let index = 0; index < channelData.length; index += 1) {
      channelData[index] *= gain;
    }
  }

  return audioBuffer;
}

async function decodeImageAsAudioBuffer(file, mode = getImageInterpretationMode()) {
  const imagePixels = await readImagePixels(file);
  return mode === "spectrogram"
    ? decodeImagePixelsAsSpectrogramAudioBuffer(imagePixels)
    : decodeImagePixelsAsWaveformAudioBuffer(imagePixels);
}

async function loadImageAsAudioFile(file) {
  const editorElement = document.getElementById("localAudioEditor");

  if (!(editorElement instanceof HTMLElement)) {
    throw new Error("The local md-waveditor host element is missing.");
  }

  const imageMode = getImageInterpretationMode();
  const modeLabel = imageMode === "spectrogram" ? "spectrogram" : "waveform samples";
  editorElement.setStatus(`Interpreting ${file.name} as ${modeLabel}...`, "secondary");

  try {
    const audioBuffer = await decodeImageAsAudioBuffer(file, imageMode);
    const loadOptions = {
      fileName: file.name,
      suggestedFileName: file.name,
      readyMessage:
        imageMode === "spectrogram"
          ? "Image interpreted as a mono spectrogram synthesis. Edit it like audio or export it as WAV."
          : "Image interpreted as mono waveform samples. Edit it like audio or export it as WAV.",
    };
    if (shouldReuseActiveDocument(editorElement)) {
      await editorElement.loadAudioBuffer(audioBuffer, loadOptions);
    } else {
      await editorElement.addAudioBuffer(audioBuffer, loadOptions);
    }
    storeLoadedFileForActiveDocument(editorElement, file);
    updateExportButtonState();
    updatePageTitle(editorElement);
    blurOpenFileButtonAfterLoad();
  } catch (error) {
    editorElement.setStatus(`Failed to interpret ${file.name} as audio: ${error.message}`, "danger");
  }
}

async function loadLocalAudioFile(file) {
  const editorElement = document.getElementById("localAudioEditor");

  if (!(editorElement instanceof HTMLElement)) {
    throw new Error("The local md-waveditor host element is missing.");
  }

  editorElement.setStatus(`Loading ${file.name}...`, "secondary");

  try {
    const sourceBuffer = await file.arrayBuffer();
    const importedLoopInfo =
      typeof parseWAVSampleLoops === "function" ? parseWAVSampleLoops(sourceBuffer) : null;
    const loadOptions = {
      fileName: file.name,
      suggestedFileName: file.name,
      loadingMessage: `Decoding ${file.name}...`,
      readyMessage:
        "Editor ready. Drag on the waveform to select audio, zoom the view, apply effects, or export the edited file.",
    };
    if (shouldReuseActiveDocument(editorElement)) {
      await editorElement.loadSourceArrayBuffer(sourceBuffer, loadOptions);
    } else {
      await editorElement.addSourceArrayBuffer(sourceBuffer, loadOptions);
    }
    const importedMarkers = buildMarkersFromWAVLoopInfo(importedLoopInfo);
    if (importedMarkers.length > 0) {
      editorElement.setMarkers(importedMarkers);
    }
    storeLoadedFileForActiveDocument(editorElement, file);
    updateExportButtonState();
    updatePageTitle(editorElement);
    blurOpenFileButtonAfterLoad();
  } catch (error) {
    editorElement.setStatus(`Failed to load ${file.name}: ${error.message}`, "danger");
  }
}

function loadLocalFile(file) {
  if (isImageFile(file)) {
    return loadImageAsAudioFile(file);
  }
  return loadLocalAudioFile(file);
}

function buildMarkersFromWAVLoopInfo(loopInfo) {
  const sampleRate = Number(loopInfo?.sampleRate) || 0;
  const loops = Array.isArray(loopInfo?.loops) ? loopInfo.loops : [];
  if (sampleRate <= 0 || loops.length === 0) {
    return [];
  }

  const boundarySamples = new Set();
  for (const loop of loops) {
    const loopStart = Math.max(0, Math.floor(Number(loop?.start) || 0));
    const loopEnd = Math.max(loopStart, Math.floor(Number(loop?.end) || 0));
    boundarySamples.add(loopStart);
    boundarySamples.add(loopEnd + 1);
  }

  return Array.from(boundarySamples)
    .sort((left, right) => left - right)
    .map((sampleIndex, index) => ({
      id: index + 1,
      time: sampleIndex / sampleRate,
    }));
}

async function exportEditedFile() {
  const editorElement = document.getElementById("localAudioEditor");
  if (!(editorElement instanceof HTMLElement)) {
    throw new Error("The local md-waveditor host element is missing.");
  }
  const activeLoadedFile = getActiveLoadedFile(editorElement);
  if (!activeLoadedFile) {
    editorElement.setStatus("Choose an audio file before exporting.", "warning");
    return;
  }

  try {
    const exportFileName = buildExportFileName(activeLoadedFile);
    const channels = getExportChannelCount(editorElement);
    const exportSampleRate = 48000;
    const wavBytes = await editorElement.exportWAV({
      channels,
      sampleRate: exportSampleRate,
      bitDepth: 24,
      sampleLoops: getExportSampleLoops(editorElement, exportSampleRate),
    });
    const blob = new Blob([wavBytes], { type: "audio/wav" });
    triggerBrowserDownload(blob, exportFileName);
    const formatNote = isWAVLikeFile(activeLoadedFile)
      ? "Exported edited WAV."
      : "Exported edited 24-bit 48 kHz WAV.";
    editorElement.setStatus(`${formatNote} Download started for ${exportFileName}.`, "success");
  } catch (error) {
    editorElement.setStatus(`Export failed: ${error.message}`, "danger");
  }
}

function getMarkerRegions(editorElement) {
  if (
    !(editorElement instanceof HTMLElement) ||
    typeof editorElement.getMarkers !== "function" ||
    typeof editorElement.getAudioInfo !== "function"
  ) {
    return [];
  }

  const audioInfo = editorElement.getAudioInfo();
  if (!audioInfo || audioInfo.duration <= 0) {
    return [];
  }

  const sortedMarkerTimes = editorElement.getMarkers()
    .map((marker) => Number(marker?.time))
    .filter((time) => Number.isFinite(time) && time > 0 && time < audioInfo.duration)
    .sort((left, right) => left - right);

  const boundaries = [0];
  for (const markerTime of sortedMarkerTimes) {
    if (Math.abs(markerTime - boundaries[boundaries.length - 1]) > (1 / audioInfo.sampleRate)) {
      boundaries.push(markerTime);
    }
  }
  boundaries.push(audioInfo.duration);

  const regions = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    if (end - start > (1 / audioInfo.sampleRate)) {
      regions.push({ start, end });
    }
  }
  return regions;
}

function getExportSampleLoops(editorElement, exportedSampleRate) {
  if (
    !(editorElement instanceof HTMLElement) ||
    typeof editorElement.getMarkers !== "function" ||
    typeof editorElement.getAudioInfo !== "function"
  ) {
    return [];
  }

  const audioInfo = editorElement.getAudioInfo();
  if (!audioInfo || audioInfo.duration <= 0) {
    return [];
  }

  const sortedMarkerTimes = editorElement.getMarkers()
    .map((marker) => Number(marker?.time))
    .filter((time) => Number.isFinite(time) && time >= 0 && time <= audioInfo.duration)
    .sort((left, right) => left - right);

  if (sortedMarkerTimes.length !== 2) {
    return [];
  }

  const targetSampleRate = Number(exportedSampleRate) > 0
    ? Number(exportedSampleRate)
    : audioInfo.sampleRate;
  const exportedFrameCount = Math.max(1, Math.ceil(audioInfo.duration * targetSampleRate));
  const loopStart = Math.max(
    0,
    Math.min(exportedFrameCount - 1, Math.round(sortedMarkerTimes[0] * targetSampleRate)),
  );
  const loopEndExclusive = Math.max(
    0,
    Math.min(exportedFrameCount, Math.round(sortedMarkerTimes[1] * targetSampleRate)),
  );
  const loopEnd = Math.max(loopStart, Math.min(exportedFrameCount - 1, loopEndExclusive - 1));
  if (loopEnd <= loopStart) {
    return [];
  }

  return [{
    identifier: 1,
    type: 0,
    start: loopStart,
    end: loopEnd,
    playCount: 0,
  }];
}

async function exportMarkerRegions() {
  const editorElement = document.getElementById("localAudioEditor");
  if (!(editorElement instanceof HTMLElement)) {
    throw new Error("The local md-waveditor host element is missing.");
  }
  const activeLoadedFile = getActiveLoadedFile(editorElement);
  if (!activeLoadedFile) {
    editorElement.setStatus("Choose an audio file before exporting marker regions.", "warning");
    return;
  }

  const regions = getMarkerRegions(editorElement);
  if (regions.length === 0 || (regions.length === 1 && regions[0].start === 0)) {
    editorElement.setStatus("Add at least one marker before exporting marker regions.", "warning");
    return;
  }

  try {
    const channels = getExportChannelCount(editorElement);
    const fileNames = buildMarkerRegionFileNames(activeLoadedFile, regions.length);
    for (let index = 0; index < regions.length; index += 1) {
      const region = regions[index];
      const wavBytes = await editorElement.exportRegionWAV(region.start, region.end, {
        channels,
        sampleRate: 48000,
        bitDepth: 24,
      });
      const blob = new Blob([wavBytes], { type: "audio/wav" });
      triggerBrowserDownload(blob, fileNames[index]);
    }
    editorElement.setStatus(
      `Started download for ${regions.length} marker region${regions.length === 1 ? "" : "s"}.`,
      "success",
    );
  } catch (error) {
    editorElement.setStatus(`Marker region export failed: ${error.message}`, "danger");
  }
}

async function exportEditedImage() {
  const editorElement = document.getElementById("localAudioEditor");
  if (!(editorElement instanceof HTMLElement)) {
    throw new Error("The local md-waveditor host element is missing.");
  }
  const activeLoadedFile = getActiveLoadedFile(editorElement);
  if (!activeLoadedFile) {
    editorElement.setStatus("Choose a file before exporting an image.", "warning");
    return;
  }

  try {
    const blob = await editorElement.exportImagePNG({
      width: 1024,
      maxHeight: 4096,
    });
    const fileName = buildExportImageFileName(activeLoadedFile);
    triggerBrowserDownload(blob, fileName);
    editorElement.setStatus(`Exported waveform image. Download started for ${fileName}.`, "success");
  } catch (error) {
    editorElement.setStatus(`Image export failed: ${error.message}`, "danger");
  }
}

function attachExternalHints() {
  const externalControls = Array.from(document.querySelectorAll("[data-ui-hint]"))
    .filter((element) => !element.closest("md-waveditor"));
  const hintText = document.getElementById("uiHintText");
  const defaultHint = "Hover or focus a control to see what it does.";

  if (!(hintText instanceof HTMLElement) || externalControls.length === 0) {
    return;
  }

  const renderHint = (activeHint) => {
    hintText.textContent = activeHint || defaultHint;
  };

  for (const control of externalControls) {
    const getHint = () => control.dataset.uiHint || control.title || "";
    const initialHint = getHint();
    if (initialHint) {
      control.title = initialHint;
    }

    control.addEventListener("mouseover", () => {
      renderHint(getHint());
    });
    control.addEventListener("mouseout", () => {
      renderHint("");
    });
    control.addEventListener("focus", () => {
      renderHint(getHint());
    });
    control.addEventListener("blur", () => {
      renderHint("");
    });
  }
}

function attachOpenFileActions() {
  const editorElement = document.getElementById("localAudioEditor");
  const openButton = document.getElementById("openLocalFileButton");
  const recordButton = document.getElementById("recordAudioButton");
  const exportButton = document.getElementById("exportLocalFileButton");
  const exportRegionsButton = document.getElementById("exportMarkerRegionsButton");
  const exportImageButton = document.getElementById("exportImageButton");
  const fileInput = document.getElementById("openLocalFileInput");

  if (
    !(editorElement instanceof HTMLElement) ||
    !(openButton instanceof HTMLButtonElement) ||
    !(recordButton instanceof HTMLButtonElement) ||
    !(exportButton instanceof HTMLButtonElement) ||
    !(exportRegionsButton instanceof HTMLButtonElement) ||
    !(exportImageButton instanceof HTMLButtonElement) ||
    !(fileInput instanceof HTMLInputElement)
  ) {
    return;
  }

  editorElement.setStatus("Choose an audio file, or an image file to interpret as audio.", "secondary");
  updateRecordingButtonState();
  updateExportButtonState();
  updatePageTitle(editorElement);

  openButton.addEventListener("click", () => {
    fileInput.click();
  });

  recordButton.addEventListener("click", () => {
    void toggleRecording();
  });

  exportButton.addEventListener("click", () => {
    void exportEditedFile();
  });

  exportRegionsButton.addEventListener("click", () => {
    void exportMarkerRegions();
  });

  exportImageButton.addEventListener("click", () => {
    void exportEditedImage();
  });

  fileInput.addEventListener("change", () => {
    const [file] = Array.from(fileInput.files || []);
    fileInput.value = "";
    if (!file) {
      return;
    }
    void loadLocalFile(file);
  });

  editorElement.addEventListener("documentchange", () => {
    syncLoadedFilesWithDocuments(editorElement);
    updateExportButtonState();
    updatePageTitle(editorElement);
  });

  editorElement.addEventListener("documentschange", () => {
    syncLoadedFilesWithDocuments(editorElement);
    updateExportButtonState();
    updatePageTitle(editorElement);
  });

  attachExternalHints();
}

window.MDWaveEditorOpenFileHost = Object.freeze({
  setLoadedFileForTest(fileLike) {
    const editorElement = document.getElementById("localAudioEditor");
    storeLoadedFileForActiveDocument(editorElement, fileLike);
    updateExportButtonState();
    updatePageTitle(editorElement);
  },
  startRecording,
  stopRecording,
  toggleRecording,
  exportEditedFile,
  exportMarkerRegions,
  exportEditedImage,
  loadLocalFile,
});

attachOpenFileActions();
