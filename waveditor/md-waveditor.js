const editorCore = globalThis.MDWaveEditorCore;
if (!editorCore) {
  throw new Error("MDWaveEditorCore failed to load before md-waveditor.js.");
}

const {
  clamp,
  cloneAudioBuffer,
  createAudioBufferLike,
  extractAudioBufferSegment,
  insertAudioBufferSegment,
  removeAudioBufferSegment,
  overwriteAudioBufferSegment,
  encodeAudioBufferAsWAV,
  linearFadeGain,
  sCurveFadeGain,
  timeToMarkerSampleIndex,
  remapMarkersAfterRemovedSegment,
  remapMarkersAfterInsertedSegment,
  remapMarkersForTrimmedSegment,
  shuffleArray,
  getGridSliceRanges,
  findSliceIndexForSample,
} = editorCore;

const maxUndoSteps = 20;
const crossfadeLoopRangeRatio = 0.4;
const themeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
const editorDocumentFieldNames = [
  "audioID",
  "detail",
  "originalBuffer",
  "audioBuffer",
  "pausedAt",
  "baseWaveformDirty",
  "overviewWaveformDirty",
  "overlayDirty",
  "waveformPeaksCache",
  "overviewWaveformCache",
  "canvasMetrics",
  "overviewCanvasMetrics",
  "dragMode",
  "dragPlaybackMode",
  "draggedMarkerID",
  "selectionAnchor",
  "selectionStart",
  "selectionEnd",
  "markers",
  "nextMarkerID",
  "viewStart",
  "viewDuration",
  "loopEnabled",
  "zeroCrossingSelectionEnabled",
  "playbackMode",
  "playbackRangeStart",
  "playbackRangeEnd",
  "transportGeneration",
  "undoStack",
  "saveFileName",
];
const sharedSessionFieldNames = [
  "audioContext",
  "sourceNode",
  "isPlaying",
  "playStartContextTime",
  "playStartOffset",
  "animationFrameID",
  "isSelecting",
  "dragSurface",
  "directoryHandle",
  "clipboardBuffer",
  "documents",
  "activeDocumentID",
  "nextDocumentID",
];

function formatDurationSeconds(value) {
  const totalMilliseconds = Math.max(0, Math.floor((Number(value) || 0) * 1000));
  const minutes = Math.floor(totalMilliseconds / 60000);
  const seconds = Math.floor((totalMilliseconds % 60000) / 1000);
  const milliseconds = totalMilliseconds % 1000;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

function createEditorDocument(id = 1, options = {}) {
  return {
    id,
    audioID: options.audioID || 0,
    detail: options.detail || null,
    originalBuffer: options.originalBuffer || null,
    audioBuffer: options.audioBuffer || null,
    pausedAt: 0,
    baseWaveformDirty: true,
    overviewWaveformDirty: true,
    overlayDirty: true,
    waveformPeaksCache: null,
    overviewWaveformCache: null,
    canvasMetrics: null,
    overviewCanvasMetrics: null,
    dragMode: null,
    dragPlaybackMode: null,
    draggedMarkerID: null,
    selectionAnchor: null,
    selectionStart: null,
    selectionEnd: null,
    markers: [],
    nextMarkerID: 1,
    viewStart: 0,
    viewDuration: 0,
    loopEnabled: true,
    zeroCrossingSelectionEnabled: false,
    playbackMode: "loop",
    playbackRangeStart: 0,
    playbackRangeEnd: 0,
    transportGeneration: 0,
    undoStack: [],
    saveFileName: options.saveFileName || "edited.wav",
  };
}

function cloneDocumentFieldValue(fieldName, value) {
  if (fieldName === "markers") {
    return Array.isArray(value) ? value.map((marker) => ({ ...marker })) : [];
  }
  if (fieldName === "undoStack") {
    return Array.isArray(value) ? value.slice() : [];
  }
  return Array.isArray(value) ? value.slice() : value;
}

function captureRuntimeDocumentState(sourceState = state, existingDocument = null) {
  const nextDocument = existingDocument ? { ...existingDocument } : {};
  for (const fieldName of editorDocumentFieldNames) {
    const runtimeValue = fieldName === "saveFileName" && elements?.saveFileNameInput
      ? elements.saveFileNameInput.value
      : sourceState[fieldName];
    nextDocument[fieldName] = cloneDocumentFieldValue(fieldName, runtimeValue);
  }
  return nextDocument;
}

function applyDocumentStateToRuntime(documentState, targetState = state) {
  if (!documentState) {
    return;
  }
  for (const fieldName of editorDocumentFieldNames) {
    targetState[fieldName] = cloneDocumentFieldValue(fieldName, documentState[fieldName]);
  }
  if (targetState === state && elements?.saveFileNameInput) {
    elements.saveFileNameInput.value = targetState.saveFileName || "edited.wav";
  }
}

function getActiveDocument(targetState = state) {
  if (!targetState || !Array.isArray(targetState.documents) || targetState.documents.length === 0) {
    return null;
  }
  return (
    targetState.documents.find((document) => document.id === targetState.activeDocumentID) ||
    targetState.documents[0]
  );
}

function syncActiveDocumentFromRuntimeState(targetState = state) {
  const activeDocument = getActiveDocument(targetState);
  if (!activeDocument) {
    return null;
  }
  return Object.assign(activeDocument, captureRuntimeDocumentState(targetState, activeDocument));
}

function createInitialState() {
  const initialDocument = createEditorDocument(1);
  const initialState = {
    audioContext: null,
    audioID: 0,
    detail: null,
    originalBuffer: null,
    audioBuffer: null,
    sourceNode: null,
    isPlaying: false,
    playStartContextTime: 0,
    playStartOffset: 0,
    pausedAt: 0,
    animationFrameID: 0,
    baseWaveformDirty: true,
    overviewWaveformDirty: true,
    overlayDirty: true,
    waveformPeaksCache: null,
    overviewWaveformCache: null,
    canvasMetrics: null,
    overviewCanvasMetrics: null,
    isSelecting: false,
    dragMode: null,
    dragSurface: null,
    dragPlaybackMode: null,
    draggedMarkerID: null,
    selectionAnchor: null,
    selectionStart: null,
    selectionEnd: null,
    markers: [],
    nextMarkerID: 1,
    viewStart: 0,
    viewDuration: 0,
    directoryHandle: null,
    clipboardBuffer: null,
    loopEnabled: true,
    zeroCrossingSelectionEnabled: false,
    playbackMode: "loop",
    playbackRangeStart: 0,
    playbackRangeEnd: 0,
    transportGeneration: 0,
    undoStack: [],
    saveFileName: "edited.wav",
    documents: [],
    activeDocumentID: 0,
    nextDocumentID: 1,
  };
  initialState.documents = [
    Object.assign(initialDocument, captureRuntimeDocumentState(initialState, initialDocument)),
  ];
  initialState.activeDocumentID = initialDocument.id;
  initialState.nextDocumentID = initialDocument.id + 1;
  return initialState;
}

function getMDWaveEditorTemplateHTML(options = {}) {
  const exportSection = options.hideExport ? "" : String.raw`
  <section class="card shadow-sm mb-3">
    <div class="card-body">
      <div class="d-flex justify-content-between align-items-center gap-3 mb-3">
        <div>
          <h2 class="h5 mb-1">Export</h2>
          <p class="text-muted mb-0">
            WAV only. The editor refuses to overwrite an existing file.
          </p>
        </div>
        <button class="btn btn-outline-primary btn-sm" id="chooseFolderButton" type="button" data-ui-hint="Choose the folder where the edited WAV file will be saved.">
          <i class="bi bi-folder2-open" aria-hidden="true"></i>
          <span>Choose Folder</span>
        </button>
      </div>

      <div class="editor-save-grid">
        <div>
          <label class="form-label" for="saveDirectoryDisplay">Folder</label>
          <input class="form-control" id="saveDirectoryDisplay" type="text" placeholder="No folder selected" readonly data-ui-hint="Shows the folder currently selected for exporting the edited WAV file." />
        </div>
        <div>
          <label class="form-label" for="saveFileNameInput">File Name</label>
          <input class="form-control" id="saveFileNameInput" type="text" placeholder="edited.wav" data-ui-hint="Enter the file name to use when saving the edited WAV file." />
        </div>
        <div>
          <label class="form-label" for="exportChannelsSelect">Channels</label>
          <select class="form-select" id="exportChannelsSelect" data-ui-hint="Choose whether to export the edited WAV in mono or stereo.">
            <option value="1">Mono</option>
            <option value="2" selected>Stereo</option>
          </select>
        </div>
        <div>
          <label class="form-label" for="exportSampleRateSelect">Sample Rate</label>
          <select class="form-select" id="exportSampleRateSelect" data-ui-hint="Choose the sample rate for the exported WAV file.">
            <option value="44100">44.1 kHz</option>
            <option value="48000" selected>48 kHz</option>
          </select>
        </div>
      </div>

      <div class="d-flex flex-wrap align-items-center gap-2 mt-3">
        <button class="btn btn-success" id="saveButton" type="button" data-ui-hint="Render the current edits and save a new WAV file without overwriting an existing file.">
          <i class="bi bi-floppy" aria-hidden="true"></i>
          <span>Save WAV</span>
        </button>
        <span class="text-muted small" id="saveCapabilityHint"></span>
      </div>
    </div>
  </section>`;

  return String.raw`
  <div class="editor-document-tabs mb-3 d-none" id="editorDocumentTabs" aria-label="Open audio buffers"></div>

  <div class="alert alert-secondary py-2" id="audioFileStatus" role="status">
    Loading editor...
  </div>

  <section class="card shadow-sm mb-3">
    <div class="card-body">
      <div class="editor-toolbar mb-3">
        <div>
          <p class="editor-section-title">Transport</p>
          <div class="d-flex flex-wrap gap-2">
            <button class="btn btn-primary btn-sm" id="playPauseButton" type="button" data-ui-hint="Start playback from the playhead, or pause the current playback.">
              <i class="bi bi-play-fill" id="playPauseButtonIcon" aria-hidden="true"></i>
              <span class="visually-hidden" id="playPauseButtonLabel">Play</span>
            </button>
            <button class="btn btn-outline-primary btn-sm" id="loopToggleButton" type="button" data-ui-hint="Toggle loop mode for the current selection or the whole file.">
              <i class="bi bi-arrow-repeat" id="loopToggleButtonIcon" aria-hidden="true"></i>
              <span class="visually-hidden" id="loopToggleButtonLabel">Loop</span>
            </button>
            <button class="btn btn-outline-secondary btn-sm" id="resetPlayheadButton" type="button" data-ui-hint="Move the playhead back to the start of the current selection or file.">
              <i class="bi bi-skip-start-fill" aria-hidden="true"></i>
              <span class="visually-hidden">Reset Playhead</span>
            </button>
            <button class="btn btn-outline-secondary btn-sm" id="movePlayheadToEndButton" type="button" data-ui-hint="Move the playhead to the end of the file.">
              <i class="bi bi-skip-end-fill" aria-hidden="true"></i>
              <span class="visually-hidden">Move Playhead To End</span>
            </button>
          </div>
        </div>


        <div>
            <p class="editor-section-title">Markers</p>
            <div class="d-flex flex-wrap gap-2">
              <label class="d-inline-flex align-items-center gap-2 px-2 border rounded bg-body-tertiary" for="gridMarkerCountInput" data-ui-hint="Choose how many evenly spaced markers to add across the full file.">
                <span class="small text-uppercase text-muted">Grid</span>
                <input class="form-control form-control-sm" id="gridMarkerCountInput" type="number" min="1" step="1" value="16" style="width: 4.5rem;">
              </label>
              <button class="btn btn-outline-secondary btn-sm" id="addMarkerButton" type="button" data-ui-hint="Add a marker at the current playhead position.">
                <i class="bi bi-bookmark-plus" aria-hidden="true"></i>
                <span class="visually-hidden">Add Marker At Playhead</span>
              </button>
              <button class="btn btn-outline-secondary btn-sm" id="addSelectionMarkersButton" type="button" data-ui-hint="Add markers at the beginning and end of the current selection.">
                <i class="bi bi-braces-asterisk" aria-hidden="true"></i>
                <span class="visually-hidden">Add Selection Boundary Markers</span>
              </button>
              <button class="btn btn-outline-secondary btn-sm" id="addGridMarkersButton" type="button" data-ui-hint="Add evenly spaced markers across the current selection using the grid count. If there is no selection, use the full file.">
                <i class="bi bi-distribute-horizontal" aria-hidden="true"></i>
                <span class="visually-hidden">Add Grid Markers</span>
              </button>
              <button class="btn btn-outline-secondary btn-sm" id="shuffleSlicesButton" type="button" data-ui-hint="Divide the current selection into equal slices using the grid count and rearrange them in random order. If there is no selection, use the full file.">
                <i class="bi bi-shuffle" aria-hidden="true"></i>
                <span class="visually-hidden">Shuffle Slices</span>
              </button>
              <button class="btn btn-outline-secondary btn-sm" id="rotateSlicesLeftButton" type="button" data-ui-hint="Rotate the current selection slices one step to the left using the grid count. If there is no selection, use the full file.">
                <i class="bi bi-arrow-left-circle" aria-hidden="true"></i>
                <span class="visually-hidden">Rotate Slices Left</span>
              </button>
              <button class="btn btn-outline-secondary btn-sm" id="rotateSlicesRightButton" type="button" data-ui-hint="Rotate the current selection slices one step to the right using the grid count. If there is no selection, use the full file.">
                <i class="bi bi-arrow-right-circle" aria-hidden="true"></i>
                <span class="visually-hidden">Rotate Slices Right</span>
              </button>
              <button class="btn btn-outline-secondary btn-sm" id="clearMarkersButton" type="button" data-ui-hint="Remove all markers from the waveform.">
                <i class="bi bi-x-circle" aria-hidden="true"></i>
                <span class="visually-hidden">Remove All Markers</span>
              </button>
            </div>
        </div>

        <div>
          <p class="editor-section-title">Selection</p>
          <div class="d-flex flex-wrap gap-2">
            <button class="btn btn-outline-primary btn-sm" id="zoomInButton" type="button" data-ui-hint="Zoom in on the current view.">
              <i class="bi bi-zoom-in" aria-hidden="true"></i>
              <span class="visually-hidden">Zoom In</span>
            </button>
            <button class="btn btn-outline-primary btn-sm" id="zoomOutButton" type="button" data-ui-hint="Zoom out to see more of the waveform.">
              <i class="bi bi-zoom-out" aria-hidden="true"></i>
              <span class="visually-hidden">Zoom Out</span>
            </button>
            <button class="btn btn-outline-primary btn-sm" id="zoomSelectionButton" type="button" data-ui-hint="Fit the current selection into the waveform view.">
              <i class="bi bi-bounding-box-circles" aria-hidden="true"></i>
              <span class="visually-hidden">Zoom To Selection</span>
            </button>
            <button class="btn btn-outline-primary btn-sm" id="halfSelectionButton" type="button" data-ui-hint="Halve the current selection while keeping its left edge fixed.">
              <span>/2</span>
              <span class="visually-hidden">Half Selection</span>
            </button>
            <button class="btn btn-outline-primary btn-sm" id="doubleSelectionButton" type="button" data-ui-hint="Double the current selection while keeping its left edge fixed.">
              <span>*2</span>
              <span class="visually-hidden">Double Selection</span>
            </button>
            <button class="btn btn-outline-primary btn-sm" id="nudgeSelectionLeftButton" type="button" data-ui-hint="Move the current selection left by its own length.">
              <i class="bi bi-arrow-bar-left" aria-hidden="true"></i>
              <span class="visually-hidden">Nudge Left</span>
            </button>
            <button class="btn btn-outline-primary btn-sm" id="nudgeSelectionRightButton" type="button" data-ui-hint="Move the current selection right by its own length.">
              <i class="bi bi-arrow-bar-right" aria-hidden="true"></i>
              <span class="visually-hidden">Nudge Right</span>
            </button>
            <button class="btn btn-outline-primary btn-sm" id="fitButton" type="button" data-ui-hint="Show the full file in the waveform view.">
              <i class="bi bi-aspect-ratio" aria-hidden="true"></i>
              <span class="visually-hidden">Fit</span>
            </button>
            <button class="btn btn-outline-primary btn-sm" id="zeroCrossingToggleButton" type="button" data-ui-hint="Toggle zero-crossing snapping for selection edges.">
              <span>0X</span>
              <span class="visually-hidden">Zero-Crossing Selection</span>
            </button>
            <button class="btn btn-outline-secondary btn-sm" id="cutButton" type="button" data-ui-hint="Cut the current selection into the internal clipboard.">
              <i class="bi bi-scissors" aria-hidden="true"></i>
              <span class="visually-hidden">Cut</span>
            </button>
            <button class="btn btn-outline-secondary btn-sm" id="copyButton" type="button" data-ui-hint="Copy the current selection into the internal clipboard.">
              <i class="bi bi-copy" aria-hidden="true"></i>
              <span class="visually-hidden">Copy</span>
            </button>
            <button class="btn btn-outline-secondary btn-sm" id="pasteButton" type="button" data-ui-hint="Paste the internal clipboard at the playhead or over the current selection.">
              <i class="bi bi-clipboard-plus" aria-hidden="true"></i>
              <span class="visually-hidden">Paste</span>
            </button>
            <button class="btn btn-outline-secondary btn-sm" id="selectAllButton" type="button" data-ui-hint="Select the entire file.">
              <i class="bi bi-bounding-box-circles" aria-hidden="true"></i>
              <span class="visually-hidden">Select All</span>
            </button>
            <button class="btn btn-outline-secondary btn-sm" id="clearSelectionButton" type="button" data-ui-hint="Clear the current selection.">
              <i class="bi bi-x-square" aria-hidden="true"></i>
              <span class="visually-hidden">Clear Selection</span>
            </button>            
          </div>
        </div>

        <div>
          <p class="editor-section-title">Effects</p>
          <div class="d-flex flex-wrap gap-2">
            <button class="btn btn-outline-primary btn-sm" id="fadeInButton" type="button" data-ui-hint="Apply a fade in across the current selection.">
              <i class="bi bi-graph-up-arrow" aria-hidden="true"></i>
              <span class="visually-hidden">Fade In</span>
            </button>
            <button class="btn btn-outline-primary btn-sm" id="fadeOutButton" type="button" data-ui-hint="Apply a fade out across the current selection.">
              <i class="bi bi-graph-down-arrow" aria-hidden="true"></i>
              <span class="visually-hidden">Fade Out</span>
            </button>
            <button class="btn btn-outline-primary btn-sm" id="crossfadeLoopButton" type="button" data-ui-hint="Blend the end of the current selection into its beginning to make the loop point smoother. If there is no selection, use the whole file.">
              <i class="bi bi-intersect" aria-hidden="true"></i>
              <span class="visually-hidden">Crossfade Loop</span>
            </button>
            <button class="btn btn-outline-primary btn-sm" id="markerRegionFadeOutButton" type="button" data-ui-hint="Apply a short fade out to the end of each marker region, starting at about 90% of each region.">
              <i class="bi bi-bookmarks" aria-hidden="true"></i>
              <span class="visually-hidden">Fade Out Marker Regions</span>
            </button>
            <button class="btn btn-outline-primary btn-sm" id="markerRegionNormalizeButton" type="button" data-ui-hint="Normalize each marker region independently to full scale.">
              <i class="bi bi-bookmark-check" aria-hidden="true"></i>
              <span class="visually-hidden">Normalize Marker Regions</span>
            </button>
            <button class="btn btn-outline-primary btn-sm" id="normalizeButton" type="button" data-ui-hint="Normalize the current selection to full scale.">
              <i class="bi bi-soundwave" aria-hidden="true"></i>
              <span class="visually-hidden">Normalize</span>
            </button>
            <button class="btn btn-outline-primary btn-sm" id="channelConvertButton" type="button" data-ui-hint="Convert mono to stereo, or convert stereo to mono by choosing the left channel, right channel, or a mix of both.">
              <i class="bi bi-speaker" aria-hidden="true"></i>
              <span class="visually-hidden">Convert Mono Or Stereo</span>
            </button>
            <button class="btn btn-outline-primary btn-sm" id="reverseButton" type="button" data-ui-hint="Reverse the audio inside the current selection.">
              <i class="bi bi-arrow-left-right" aria-hidden="true"></i>
              <span class="visually-hidden">Reverse</span>
            </button>
            <button class="btn btn-outline-danger btn-sm" id="trimButton" type="button" data-ui-hint="Discard all audio outside the current selection.">
              <i class="bi bi-scissors" aria-hidden="true"></i>
              <span class="visually-hidden">Trim</span>
            </button>
            <button class="btn btn-outline-secondary btn-sm" id="undoButton" type="button" data-ui-hint="Undo the last destructive edit.">
              <i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i>
              <span class="visually-hidden">Undo</span>
            </button>
            <button class="btn btn-outline-secondary btn-sm" id="resetButton" type="button" data-ui-hint="Restore the editor to the original unedited file.">
              <i class="bi bi-arrow-clockwise" aria-hidden="true"></i>
              <span class="visually-hidden">Reset Edits</span>
            </button>
          </div>
        </div>
      </div>

      <div class="audio-file-waveform-stage border rounded">
        <canvas class="audio-file-waveform audio-file-waveform-base" id="audioFileWaveform" width="1200" height="240"></canvas>
        <canvas class="audio-file-waveform audio-file-waveform-overlay" id="audioFileOverlay" width="1200" height="240" data-ui-hint="Click or drag on the waveform to set the playhead, create a selection, or adjust selection handles."></canvas>
      </div>

      <div class="audio-file-overview-stage border rounded mt-2">
        <canvas class="audio-file-waveform audio-file-overview-base" id="audioFileOverview" width="1200" height="60"></canvas>
        <canvas class="audio-file-waveform audio-file-overview-overlay" id="audioFileOverviewOverlay" width="1200" height="60" data-ui-hint="Drag on the overview waveform to select any portion of the full file."></canvas>
      </div>

      <div class="row g-2 mt-2">
        <div class="col-md-4">
          <div class="editor-stat">
            <span class="editor-stat-label">Playhead</span>
            <p class="editor-stat-value mb-0" id="playheadInfo">0.000s / 0.000s</p>
          </div>
        </div>
        <div class="col-md-4">
          <div class="editor-stat">
            <span class="editor-stat-label">Selection</span>
            <p class="editor-stat-value mb-0" id="selectionInfo">No selection</p>
          </div>
        </div>
        <div class="col-md-4">
          <div class="editor-stat">
            <span class="editor-stat-label">View</span>
            <p class="editor-stat-value mb-0" id="viewInfo">0.000s to 0.000s</p>
          </div>
        </div>
      </div>
    </div>
  </section>
  ${exportSection}

  <div class="modal fade" id="stereoToMonoModal" tabindex="-1" aria-labelledby="stereoToMonoModalTitle" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content">
        <div class="modal-header">
          <h2 class="modal-title fs-5" id="stereoToMonoModalTitle">Convert Stereo To Mono</h2>
          <button class="btn-close" type="button" data-bs-dismiss="modal" aria-label="Close"></button>
        </div>
        <div class="modal-body">
          Choose which stereo content should be kept in the mono file.
        </div>
        <div class="modal-footer justify-content-center">
          <button class="btn btn-outline-primary" id="stereoToMonoLeftButton" type="button" data-mono-mode="left">Left</button>
          <button class="btn btn-outline-primary" id="stereoToMonoRightButton" type="button" data-mono-mode="right">Right</button>
          <button class="btn btn-primary" id="stereoToMonoMixButton" type="button" data-mono-mode="mix">Mix</button>
        </div>
      </div>
    </div>
  </div>

  <footer class="ui-hint-footer" aria-live="polite">
    <div class="container audio-file-shell ui-hint-footer-inner d-flex flex-column justify-content-center py-2">
      <span class="ui-hint-label">Hint</span>
      <p class="ui-hint-text" id="uiHintText">Hover or focus a control to see what it does.</p>
    </div>
  </footer>
`;
}

function deriveSuggestedSaveFileName(fileName) {
  const baseName = String(fileName || "edited").replace(/\.[^.]+$/, "") || "edited";
  return `${baseName}-edited.wav`;
}

function createLoadedDocumentFromAudioBuffer(documentID, decodedBuffer, options = {}) {
  if (!(decodedBuffer instanceof AudioBuffer)) {
    throw new Error("A decoded AudioBuffer is required.");
  }

  const originalBuffer = cloneAudioBuffer(options.originalBuffer || decodedBuffer);
  const audioBuffer = cloneAudioBuffer(decodedBuffer);
  const duration = audioBuffer.duration;
  const saveFileName = deriveSuggestedSaveFileName(
    options.suggestedFileName || options.fileName || "edited",
  );

  return Object.assign(
    createEditorDocument(documentID, {
      audioID: options.audioID || 0,
      detail: options.detail || null,
      originalBuffer,
      audioBuffer,
      saveFileName,
    }),
    {
      pausedAt: 0,
      viewStart: 0,
      viewDuration: duration,
      playbackRangeStart: 0,
      playbackRangeEnd: duration,
      saveFileName,
    },
  );
}

function isDocumentLoaded(documentState) {
  return Boolean(
    documentState &&
    (documentState.audioBuffer || documentState.originalBuffer || documentState.audioID || documentState.detail),
  );
}

function createEmptyEditorDocument(id = 1) {
  return createEditorDocument(id, {
    saveFileName: "edited.wav",
  });
}

function audioBuffersMatch(leftBuffer, rightBuffer) {
  if (!(leftBuffer instanceof AudioBuffer) || !(rightBuffer instanceof AudioBuffer)) {
    return false;
  }
  if (
    leftBuffer.length !== rightBuffer.length ||
    leftBuffer.numberOfChannels !== rightBuffer.numberOfChannels ||
    leftBuffer.sampleRate !== rightBuffer.sampleRate
  ) {
    return false;
  }

  for (let channel = 0; channel < leftBuffer.numberOfChannels; channel += 1) {
    const leftData = leftBuffer.getChannelData(channel);
    const rightData = rightBuffer.getChannelData(channel);
    for (let frame = 0; frame < leftData.length; frame += 1) {
      if (leftData[frame] !== rightData[frame]) {
        return false;
      }
    }
  }

  return true;
}

function isDocumentDirty(documentState) {
  if (!documentState?.audioBuffer || !documentState?.originalBuffer) {
    return false;
  }
  return !audioBuffersMatch(documentState.audioBuffer, documentState.originalBuffer);
}

function createDocumentSummary(documentState, targetState = state) {
  const detail = documentState.detail || null;
  return {
    id: documentState.id,
    isActive: documentState.id === targetState.activeDocumentID,
    audioID: documentState.audioID || 0,
    label:
      detail?.title ||
      detail?.fileName ||
      (isDocumentLoaded(documentState) ? documentState.saveFileName : "Untitled"),
  };
}

function getDocumentSummaries(targetState = state) {
  return targetState.documents.map((documentState) =>
    createDocumentSummary(documentState, targetState));
}

function ensureEditorTemplate(root) {
  if (root.querySelector("#audioFileStatus")) {
    return;
  }
  root.innerHTML = getMDWaveEditorTemplateHTML({
    hideExport: root.hasAttribute("hide-export"),
  });
}

function collectEditorElements(root = document) {
  const queryByID = (id) => root.querySelector(`#${id}`);
  return {
    documentTabs: queryByID("editorDocumentTabs"),
    status: queryByID("audioFileStatus"),
    waveform: queryByID("audioFileWaveform"),
    waveformOverlay: queryByID("audioFileOverlay"),
    overviewWaveform: queryByID("audioFileOverview"),
    overviewWaveformOverlay: queryByID("audioFileOverviewOverlay"),
    playPauseButton: queryByID("playPauseButton"),
    playPauseButtonIcon: queryByID("playPauseButtonIcon"),
    playPauseButtonLabel: queryByID("playPauseButtonLabel"),
    loopToggleButton: queryByID("loopToggleButton"),
    loopToggleButtonIcon: queryByID("loopToggleButtonIcon"),
    loopToggleButtonLabel: queryByID("loopToggleButtonLabel"),
    resetPlayheadButton: queryByID("resetPlayheadButton"),
    movePlayheadToEndButton: queryByID("movePlayheadToEndButton"),
    undoButton: queryByID("undoButton"),
    resetButton: queryByID("resetButton"),
    zoomInButton: queryByID("zoomInButton"),
    zoomOutButton: queryByID("zoomOutButton"),
    zoomSelectionButton: queryByID("zoomSelectionButton"),
    halfSelectionButton: queryByID("halfSelectionButton"),
    doubleSelectionButton: queryByID("doubleSelectionButton"),
    nudgeSelectionLeftButton: queryByID("nudgeSelectionLeftButton"),
    nudgeSelectionRightButton: queryByID("nudgeSelectionRightButton"),
    fitButton: queryByID("fitButton"),
    zeroCrossingToggleButton: queryByID("zeroCrossingToggleButton"),
    addMarkerButton: queryByID("addMarkerButton"),
    addSelectionMarkersButton: queryByID("addSelectionMarkersButton"),
    gridMarkerCountInput: queryByID("gridMarkerCountInput"),
    addGridMarkersButton: queryByID("addGridMarkersButton"),
    shuffleSlicesButton: queryByID("shuffleSlicesButton"),
    rotateSlicesLeftButton: queryByID("rotateSlicesLeftButton"),
    rotateSlicesRightButton: queryByID("rotateSlicesRightButton"),
    clearMarkersButton: queryByID("clearMarkersButton"),
    cutButton: queryByID("cutButton"),
    copyButton: queryByID("copyButton"),
    pasteButton: queryByID("pasteButton"),
    fadeInButton: queryByID("fadeInButton"),
    fadeOutButton: queryByID("fadeOutButton"),
    crossfadeLoopButton: queryByID("crossfadeLoopButton"),
    markerRegionFadeOutButton: queryByID("markerRegionFadeOutButton"),
    markerRegionNormalizeButton: queryByID("markerRegionNormalizeButton"),
    normalizeButton: queryByID("normalizeButton"),
    channelConvertButton: queryByID("channelConvertButton"),
    reverseButton: queryByID("reverseButton"),
    trimButton: queryByID("trimButton"),
    stereoToMonoModal: queryByID("stereoToMonoModal"),
    stereoToMonoLeftButton: queryByID("stereoToMonoLeftButton"),
    stereoToMonoRightButton: queryByID("stereoToMonoRightButton"),
    stereoToMonoMixButton: queryByID("stereoToMonoMixButton"),
    selectAllButton: queryByID("selectAllButton"),
    clearSelectionButton: queryByID("clearSelectionButton"),
    playheadInfo: queryByID("playheadInfo"),
    selectionInfo: queryByID("selectionInfo"),
    viewInfo: queryByID("viewInfo"),
    chooseFolderButton: queryByID("chooseFolderButton"),
    saveDirectoryDisplay: queryByID("saveDirectoryDisplay"),
    saveFileNameInput: queryByID("saveFileNameInput"),
    exportChannelsSelect: queryByID("exportChannelsSelect"),
    exportSampleRateSelect: queryByID("exportSampleRateSelect"),
    saveButton: queryByID("saveButton"),
    saveCapabilityHint: queryByID("saveCapabilityHint"),
    uiHintText: queryByID("uiHintText"),
  };
}

let state = null;
let elements = null;

const defaultUIHint = "Hover or focus a control to see what it does.";
const uiHintShortcuts = {
  playPauseButton: "Space",
  addMarkerButton: "M",
  zoomInButton: "= / +",
  zoomOutButton: "-",
  zoomSelectionButton: "Z",
  halfSelectionButton: "Arrow Down",
  doubleSelectionButton: "Arrow Up",
  nudgeSelectionLeftButton: "Arrow Left",
  nudgeSelectionRightButton: "Arrow Right",
  undoButton: "Ctrl/Cmd+Z",
  trimButton: "Ctrl/Cmd+T",
  cutButton: "Ctrl/Cmd+X",
  copyButton: "Ctrl/Cmd+C",
  pasteButton: "Ctrl/Cmd+V",
  fadeInButton: "I",
  fadeOutButton: "O",
  normalizeButton: "N",
  reverseButton: "R",
  selectAllButton: "Ctrl/Cmd+A",
};

class MDWaveEditorController {
  constructor(root = document.getElementById("audioFileEditor") || document.body) {
    this.root = root;
    this.state = createInitialState();
    this.elements = collectEditorElements(root);
  }

  activate() {
    state = this.state;
    elements = this.elements;
    return this;
  }

  run(callback, ...args) {
    this.activate();
    return callback(...args);
  }

  wrap(callback) {
    return (...args) => this.run(callback, ...args);
  }

  shouldHandleKeyEvent(event) {
    const target = event.target;
    return (
      !(target instanceof Node) ||
      target === document.body ||
      target === document.documentElement ||
      this.root.contains(target)
    );
  }

  init() {
    this.activate();
    attachWaveformInteractions(this);
    attachUIActions(this);
    initUIHints(this.root);
    initializeEditorUI();
    initAutoTheme(() => {
      this.run(requestFullRender);
    });
    this.run(requestFullRender);
  }
}

window.MDWaveEditorController = MDWaveEditorController;

class MDWaveEditorElement extends HTMLElement {
  connectedCallback() {
    if (this.controller) {
      return;
    }
    ensureEditorTemplate(this);
    this.controller = new MDWaveEditorController(this);
    this.controller.init();
  }

  ensureReady() {
    if (!this.controller) {
      this.connectedCallback();
    }
    return this.controller;
  }

  setStatus(message, level = "secondary") {
    return this.ensureReady().run(setStatus, message, level);
  }

  setSuggestedFileName(fileName) {
    return this.ensureReady().run(setSuggestedSaveFileName, fileName);
  }

  async loadSourceArrayBuffer(sourceArrayBuffer, options = {}) {
    return this.ensureReady().run(loadSourceArrayBufferIntoEditor, sourceArrayBuffer, options);
  }

  async loadAudioBuffer(audioBuffer, options = {}) {
    return this.ensureReady().run(loadAudioBufferIntoEditor, audioBuffer, options);
  }

  async addSourceArrayBuffer(sourceArrayBuffer, options = {}) {
    return this.ensureReady().run(addSourceArrayBufferAsDocument, sourceArrayBuffer, options);
  }

  async addAudioBuffer(audioBuffer, options = {}) {
    return this.ensureReady().run(addAudioBufferAsDocument, audioBuffer, options);
  }

  getDocuments() {
    return this.ensureReady().run(getDocumentSummaries);
  }

  getActiveDocumentId() {
    return this.ensureReady().run(() => state.activeDocumentID);
  }

  setActiveDocument(documentID) {
    return this.ensureReady().run(switchActiveDocument, documentID);
  }

  closeDocument(documentID) {
    return this.ensureReady().run(closeDocument, documentID);
  }

  getMarkers() {
    return this.ensureReady().run(() => cloneMarkers());
  }

  setMarkers(markers) {
    return this.ensureReady().run(applyMarkersFromAPI, markers);
  }

  getSelection() {
    return this.ensureReady().run(() => {
      const selection = getSortedSelection();
      return selection ? { ...selection } : null;
    });
  }

  setSelection(start, end, options = {}) {
    return this.ensureReady().run(() => {
      updateSelection(start, end, options);
      ensureSelectionVisible(getSortedSelection());
      updateTransportButtons();
      requestOverlayRender();
    });
  }

  clearSelection() {
    return this.ensureReady().run(() => {
      clearSelection();
      updateTransportButtons();
    });
  }

  getPlayhead() {
    return this.ensureReady().run(getCurrentPlaybackTime);
  }

  getAudioInfo() {
    return this.ensureReady().run(() => (
      state.audioBuffer
        ? {
            channels: state.audioBuffer.numberOfChannels,
            sampleRate: state.audioBuffer.sampleRate,
            duration: state.audioBuffer.duration,
            length: state.audioBuffer.length,
          }
        : null
    ));
  }

  async setPlayhead(time) {
    return this.ensureReady().run(seekTo, time);
  }

  async exportWAV(options = {}) {
    return this.ensureReady().run(exportEditedWAV, options);
  }

  async exportRegionWAV(startTime, endTime, options = {}) {
    return this.ensureReady().run(exportRegionWAV, startTime, endTime, options);
  }

  async exportImagePNG(options = {}) {
    return this.ensureReady().run(exportImagePNG, options);
  }

  undo() {
    return this.ensureReady().run(undoLastEdit);
  }
}

if (!customElements.get("md-waveditor")) {
  customElements.define("md-waveditor", MDWaveEditorElement);
}
window.MDWaveEditorElement = MDWaveEditorElement;

function resolveAutoTheme() {
  return themeMediaQuery.matches ? "dark" : "light";
}

function applyDocumentTheme() {
  const rootTheme = document.documentElement.getAttribute("data-bs-theme");
  const resolvedTheme = rootTheme === "auto" ? resolveAutoTheme() : rootTheme || "light";
  document.body.setAttribute("data-bs-theme", resolvedTheme);
  document.body.style.colorScheme = resolvedTheme;
}

function getCSSVariable(name, fallback = "") {
  const value = getComputedStyle(document.body).getPropertyValue(name).trim();
  return value || fallback;
}

function getEditorCanvasPalette() {
  return {
    emptyText: getCSSVariable("--editor-canvas-empty", "#6c757d"),
    lane: getCSSVariable("--editor-canvas-lane", "rgba(13, 110, 253, 0.35)"),
    divider: getCSSVariable("--editor-canvas-divider", "rgba(108, 117, 125, 0.25)"),
    label: getCSSVariable("--editor-canvas-label", "rgba(13, 110, 253, 0.8)"),
    waveform: getCSSVariable("--editor-canvas-waveform", "#0d6efd"),
    selectionFill: getCSSVariable("--editor-canvas-selection-fill", "rgba(255, 193, 7, 0.22)"),
    selectionStroke: getCSSVariable("--editor-canvas-selection-stroke", "rgba(255, 193, 7, 0.95)"),
    selectionHandle: getCSSVariable("--editor-canvas-selection-handle", "rgba(255, 193, 7, 0.98)"),
    playhead: getCSSVariable("--editor-canvas-playhead", "rgba(25, 135, 84, 0.98)"),
    gridStroke: getCSSVariable("--editor-canvas-grid-stroke", "rgba(108, 117, 125, 0.35)"),
    markerStroke: getCSSVariable("--editor-canvas-marker-stroke", "rgba(108, 117, 125, 0.95)"),
    markerHandle: getCSSVariable("--editor-canvas-marker-handle", "rgba(108, 117, 125, 0.98)"),
    viewFill: getCSSVariable("--editor-canvas-view-fill", "rgba(13, 110, 253, 0.12)"),
    viewStroke: getCSSVariable("--editor-canvas-view-stroke", "rgba(13, 110, 253, 0.7)"),
  };
}

function initAutoTheme(onThemeChange) {
  const handleThemeChange = () => {
    applyDocumentTheme();
    onThemeChange?.();
  };

  applyDocumentTheme();
  if (typeof themeMediaQuery.addEventListener === "function") {
    themeMediaQuery.addEventListener("change", handleThemeChange);
  } else {
    themeMediaQuery.addListener(handleThemeChange);
  }
}

function setStatus(message, level = "secondary") {
  elements.status.className = `alert alert-${level} py-2`;
  elements.status.textContent = message;
}

function getEditorHostElement() {
  return elements?.status?.closest("md-waveditor") || null;
}

function emitEditorEvent(name, detail) {
  const hostElement = getEditorHostElement();
  if (!hostElement) {
    return;
  }
  hostElement.dispatchEvent(new CustomEvent(name, {
    bubbles: true,
    detail,
  }));
}

function buildDocumentEventDetail() {
  const documents = getDocumentSummaries();
  return {
    documents,
    activeDocumentID: state.activeDocumentID,
    activeDocument: documents.find((documentState) => documentState.isActive) || null,
  };
}

function emitDocumentStateEvents(options = {}) {
  const detail = buildDocumentEventDetail();
  emitEditorEvent("documentschange", detail);
  if (options.activeChanged) {
    emitEditorEvent("documentchange", detail);
  }
}

function initUIHints(root = document) {
  let activeHoverTarget = null;
  let activeFocusTarget = null;
  const hintedElements = root.querySelectorAll("[data-ui-hint]");

  for (const element of hintedElements) {
    const shortcut = element.id ? uiHintShortcuts[element.id] : "";
    const baseHint = element.dataset.uiHint || "";
    const hint = shortcut ? `${baseHint} Shortcut: ${shortcut}.` : baseHint;
    if (hint) {
      element.dataset.uiHint = hint;
      element.setAttribute("title", hint);
    }
  }

  for (const button of root.querySelectorAll("button[data-ui-hint]")) {
    if (button.parentElement?.classList.contains("ui-hint-target")) {
      continue;
    }
    const wrapper = document.createElement("span");
    wrapper.className = "ui-hint-target";
    wrapper.dataset.uiHint = button.dataset.uiHint;
    wrapper.title = button.dataset.uiHint || "";
    button.parentNode.insertBefore(wrapper, button);
    wrapper.appendChild(button);
  }

  const getHintTarget = (node) => {
    if (!(node instanceof Element)) {
      return null;
    }
    const hintTarget = node.closest("[data-ui-hint]");
    return hintTarget && root.contains(hintTarget) ? hintTarget : null;
  };

  const renderHint = () => {
    const target = activeFocusTarget || activeHoverTarget;
    elements.uiHintText.textContent = target?.dataset.uiHint || defaultUIHint;
  };

  root.addEventListener("mouseover", (event) => {
    const nextTarget = getHintTarget(event.target);
    if (nextTarget === activeHoverTarget) {
      return;
    }
    activeHoverTarget = nextTarget;
    renderHint();
  });

  root.addEventListener("mouseout", (event) => {
    if (!activeHoverTarget) {
      return;
    }
    const relatedTarget = getHintTarget(event.relatedTarget);
    if (relatedTarget === activeHoverTarget) {
      return;
    }
    activeHoverTarget = relatedTarget;
    renderHint();
  });

  root.addEventListener("focusin", (event) => {
    activeFocusTarget = getHintTarget(event.target);
    renderHint();
  });

  root.addEventListener("focusout", (event) => {
    activeFocusTarget = getHintTarget(event.relatedTarget);
    renderHint();
  });

  renderHint();
}

function getCurrentBufferDuration() {
  return state.audioBuffer ? state.audioBuffer.duration : 0;
}

function getCurrentPlaybackTime() {
  if (!state.audioBuffer) {
    return 0;
  }
  if (!state.isPlaying || !state.audioContext) {
    return clamp(state.pausedAt, 0, state.audioBuffer.duration);
  }
  const elapsed = state.audioContext.currentTime - state.playStartContextTime;
  if (state.playbackMode === "loop") {
    const rangeDuration = Math.max(
      0.001,
      state.playbackRangeEnd - state.playbackRangeStart,
    );
    return clamp(
      state.playbackRangeStart +
        ((state.playStartOffset - state.playbackRangeStart + elapsed) % rangeDuration),
      state.playbackRangeStart,
      state.playbackRangeEnd,
    );
  }
  return clamp(state.playStartOffset + elapsed, 0, state.audioBuffer.duration);
}

function getActivePlaybackRange() {
  const duration = getCurrentBufferDuration();
  const selection = getSortedSelection();
  if (selection) {
    return selection;
  }
  return {
    start: 0,
    end: duration,
    duration,
  };
}

function getMinimumSelectionDuration() {
  if (!state.audioBuffer || state.audioBuffer.sampleRate <= 0) {
    return 0.001;
  }
  return 1 / state.audioBuffer.sampleRate;
}

function syncMarkersToBufferDuration() {
  if (!state.audioBuffer) {
    state.markers = [];
    state.draggedMarkerID = null;
    return;
  }

  const duration = getCurrentBufferDuration();
  state.markers = state.markers.map((marker) => ({
    ...marker,
    time: clamp(marker.time, 0, duration),
  }));

  if (
    state.draggedMarkerID !== null &&
    !state.markers.some((marker) => marker.id === state.draggedMarkerID)
  ) {
    state.draggedMarkerID = null;
  }
}

function addMarkerAtPlayhead() {
  if (!state.audioBuffer) {
    return;
  }

  syncMarkersToBufferDuration();
  const addedMarker = addMarkerAtTime(getCurrentPlaybackTime());
  if (!addedMarker) {
    setStatus("A marker already exists at the playhead.", "secondary");
    return;
  }
  requestOverlayRender();
  setStatus("Marker added at the playhead.", "secondary");
}

function addMarkerAtTime(time) {
  if (!state.audioBuffer) {
    return null;
  }

  const sampleRate = state.audioBuffer.sampleRate;
  const clampedTime = clamp(time, 0, getCurrentBufferDuration());
  const targetSample = clamp(
    Math.round(clampedTime * sampleRate),
    0,
    state.audioBuffer.length,
  );
  const hasMarkerAtSample = state.markers.some(
    (marker) =>
      clamp(Math.round(marker.time * sampleRate), 0, state.audioBuffer.length) === targetSample,
  );
  if (hasMarkerAtSample) {
    return null;
  }

  const marker = {
    id: state.nextMarkerID,
    time: clampedTime,
  };
  state.markers.push(marker);
  state.nextMarkerID += 1;
  return marker;
}

function addMarkersAtSelectionBoundaries() {
  if (!state.audioBuffer) {
    return;
  }

  syncMarkersToBufferDuration();
  const selection = getSortedSelection();
  if (!selection) {
    setStatus("Create a selection before adding selection boundary markers.", "warning");
    return;
  }

  const markersAdded =
    Number(Boolean(addMarkerAtTime(selection.start))) +
    Number(Boolean(addMarkerAtTime(selection.end)));
  if (markersAdded === 0) {
    setStatus("Markers already exist at both selection boundaries.", "secondary");
    return;
  }

  requestOverlayRender();
  setStatus(
    `Added ${markersAdded} selection boundary marker${markersAdded === 1 ? "" : "s"}.`,
    "secondary",
  );
}

function removeMarker(markerID) {
  const hadMarker = state.markers.some((marker) => marker.id === markerID);
  if (!hadMarker) {
    return;
  }

  state.markers = state.markers.filter((marker) => marker.id !== markerID);
  if (state.draggedMarkerID === markerID) {
    state.draggedMarkerID = null;
  }
  requestOverlayRender();
  setStatus("Marker removed.", "secondary");
}

function updateMarkerTime(markerID, time) {
  if (!state.audioBuffer) {
    return;
  }

  const nextTime = clamp(time, 0, getCurrentBufferDuration());
  state.markers = state.markers.map((marker) =>
    marker.id === markerID
      ? { ...marker, time: nextTime }
      : marker,
  );
  requestOverlayRender();
}

function cloneMarkers(markers = state.markers) {
  return markers.map((marker) => ({ ...marker }));
}

function addEvenlySpacedMarkers() {
  if (!state.audioBuffer) {
    setStatus("The editor source is not ready yet.", "warning");
    return;
  }

  const rawCount = Number(elements.gridMarkerCountInput.value);
  const markerCount = Math.max(0, Math.floor(rawCount));
  if (!Number.isFinite(rawCount) || markerCount < 1) {
    setStatus("Enter a marker count of at least 1.", "warning");
    return;
  }

  const selection = getSortedSelection();
  const regionStart = selection ? selection.start : 0;
  const regionEnd = selection ? selection.end : getCurrentBufferDuration();
  const regionDuration = Math.max(0, regionEnd - regionStart);
  if (regionDuration <= 0) {
    setStatus("Audio is too short for grid markers.", "warning");
    return;
  }

  const nextMarkers = cloneMarkers();
  const existingMarkerSamples = new Set(
    nextMarkers.map((marker) =>
      timeToMarkerSampleIndex(marker.time, state.audioBuffer.sampleRate, state.audioBuffer.length),
    ),
  );
  const markerSpacing = regionDuration / markerCount;
  let nextMarkerID = state.nextMarkerID;
  let addedCount = 0;

  for (let index = 0; index < markerCount; index += 1) {
    const markerTime = regionStart + markerSpacing * index;
    const markerSample = timeToMarkerSampleIndex(
      markerTime,
      state.audioBuffer.sampleRate,
      state.audioBuffer.length,
    );
    if (existingMarkerSamples.has(markerSample)) {
      continue;
    }
    nextMarkers.push({
      id: nextMarkerID,
      time: markerTime,
    });
    existingMarkerSamples.add(markerSample);
    nextMarkerID += 1;
    addedCount += 1;
  }

  if (addedCount === 0) {
    setStatus("No new grid markers were added.", "secondary");
    return;
  }

  pushUndoSnapshot();
  state.markers = nextMarkers;
  state.nextMarkerID = nextMarkerID;
  syncMarkersToBufferDuration();
  requestOverlayRender();
  updateTransportButtons();
  setStatus(
    `Added ${addedCount} evenly spaced marker${addedCount === 1 ? "" : "s"} ${selection ? "within the current selection" : "across the full file"}.`,
    "success",
  );
}

async function reorderGridSlices(buildOrder, successVerb) {
  if (!state.audioBuffer) {
    setStatus("The editor source is not ready yet.", "warning");
    return;
  }

  const rawCount = Number(elements.gridMarkerCountInput.value);
  const sliceCount = Math.max(0, Math.floor(rawCount));
  if (!Number.isFinite(rawCount) || sliceCount < 2) {
    setStatus("Enter at least 2 slices to shuffle the file.", "warning");
    return;
  }

  const selection = getSortedSelection();
  const selectionFrames = getSelectionFrameRange(selection);
  const regionStartFrame = selectionFrames ? selectionFrames.startFrame : 0;
  const regionEndFrame = selectionFrames ? selectionFrames.endFrame : state.audioBuffer.length;
  const regionLength = regionEndFrame - regionStartFrame;

  if (regionLength <= 1) {
    setStatus("Selection is too short for slice shuffling.", "warning");
    return;
  }
  if (sliceCount > regionLength) {
    setStatus("Slice count is too high for the current shuffle region. Reduce the grid value.", "warning");
    return;
  }

  const sliceRanges = getGridSliceRanges(sliceCount, regionLength).map((sliceRange) => ({
    startFrame: sliceRange.startFrame + regionStartFrame,
    endFrame: sliceRange.endFrame + regionStartFrame,
    frameLength: sliceRange.frameLength,
  }));
  const reorderedSliceOrder = buildOrder(sliceRanges.map((_, index) => index));
  if (!Array.isArray(reorderedSliceOrder) || reorderedSliceOrder.length !== sliceCount) {
    setStatus("Could not build the slice order.", "danger");
    return;
  }

  const nextBuffer = cloneAudioBuffer(state.audioBuffer);
  const destinationStartFrames = new Array(sliceCount).fill(0);
  let destinationCursor = regionStartFrame;
  for (const sourceSliceIndex of reorderedSliceOrder) {
    destinationStartFrames[sourceSliceIndex] = destinationCursor;
    destinationCursor += sliceRanges[sourceSliceIndex].frameLength;
  }

  for (let channel = 0; channel < state.audioBuffer.numberOfChannels; channel += 1) {
    const sourceData = state.audioBuffer.getChannelData(channel);
    const nextData = nextBuffer.getChannelData(channel);
    let writeCursor = regionStartFrame;
    for (const sourceSliceIndex of reorderedSliceOrder) {
      const sliceRange = sliceRanges[sourceSliceIndex];
      nextData.set(
        sourceData.subarray(sliceRange.startFrame, sliceRange.endFrame),
        writeCursor,
      );
      writeCursor += sliceRange.frameLength;
    }
  }

  const sampleRate = state.audioBuffer.sampleRate;
  const remappedMarkers = state.markers.map((marker) => {
    const markerSample = timeToMarkerSampleIndex(marker.time, sampleRate, state.audioBuffer.length);
    if (markerSample >= state.audioBuffer.length) {
      return { ...marker, time: nextBuffer.length / sampleRate };
    }
    if (markerSample < regionStartFrame || markerSample >= regionEndFrame) {
      return { ...marker };
    }

    const sliceIndex = findSliceIndexForSample(markerSample, sliceRanges);
    const sliceRange = sliceRanges[sliceIndex];
    const destinationStart = destinationStartFrames[sliceIndex];
    const offsetInSlice = markerSample - sliceRange.startFrame;
    return {
      ...marker,
      time: (destinationStart + offsetInSlice) / sampleRate,
    };
  });

  const restartMode = state.isPlaying ? state.playbackMode : null;
  const currentTime = getCurrentPlaybackTime();
  pushUndoSnapshot();
  state.audioBuffer = nextBuffer;
  state.markers = remappedMarkers;
  syncMarkersToBufferDuration();
  invalidateWaveformCache();
  state.pausedAt = clamp(currentTime, 0, getCurrentBufferDuration());

  if (restartMode) {
    await restartPlaybackAtTime(currentTime, restartMode);
  } else {
    requestFullRender();
  }

  setStatus(
    `${successVerb} ${sliceCount} equal slice${sliceCount === 1 ? "" : "s"} ` +
      `${selectionFrames ? "within the current selection" : "across the full file"}.`,
    "success",
  );
}

async function shuffleGridSlices() {
  await reorderGridSlices((sliceIndexes) => {
    let shuffledOrder = shuffleArray(sliceIndexes);
    if (sliceIndexes.length > 1 && shuffledOrder.every((sourceIndex, index) => sourceIndex === index)) {
      shuffledOrder = shuffleArray(shuffledOrder);
    }
    return shuffledOrder;
  }, "Shuffled");
}

async function rotateGridSlicesLeft() {
  await reorderGridSlices((sliceIndexes) => {
    if (sliceIndexes.length <= 1) {
      return sliceIndexes;
    }
    return sliceIndexes.slice(1).concat(sliceIndexes[0]);
  }, "Rotated left");
}

async function rotateGridSlicesRight() {
  await reorderGridSlices((sliceIndexes) => {
    if (sliceIndexes.length <= 1) {
      return sliceIndexes;
    }
    return [sliceIndexes[sliceIndexes.length - 1]].concat(sliceIndexes.slice(0, -1));
  }, "Rotated right");
}

function clearAllMarkers() {
  if (state.markers.length === 0) {
    setStatus("There are no markers to remove.", "secondary");
    return;
  }

  pushUndoSnapshot();
  state.markers = [];
  state.draggedMarkerID = null;
  requestOverlayRender();
  updateTransportButtons();
  setStatus("Removed all markers.", "secondary");
}

function findNearestZeroCrossingTime(time) {
  if (!state.audioBuffer || state.audioBuffer.length < 2) {
    return clamp(time, 0, getCurrentBufferDuration());
  }

  const channelData = state.audioBuffer.getChannelData(0);
  const sampleRate = state.audioBuffer.sampleRate;
  const maxIndex = channelData.length - 1;
  const targetIndex = clamp(Math.round(time * sampleRate), 0, maxIndex);
  const searchRadius = Math.min(maxIndex - 1, Math.max(64, Math.round(sampleRate * 0.05)));

  const crossingTimeAt = (index) => {
    const current = channelData[index];
    const next = channelData[index + 1];
    if (current === 0) {
      return index / sampleRate;
    }
    if (next === 0) {
      return (index + 1) / sampleRate;
    }
    const denominator = current - next;
    if (denominator === 0) {
      return index / sampleRate;
    }
    const ratio = clamp(current / denominator, 0, 1);
    return (index + ratio) / sampleRate;
  };

  let bestTime = clamp(time, 0, getCurrentBufferDuration());
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let offset = 0; offset <= searchRadius; offset++) {
    const leftIndex = targetIndex - offset;
    const rightIndex = targetIndex + offset;
    const candidates = offset === 0 ? [leftIndex] : [leftIndex, rightIndex];

    for (const index of candidates) {
      if (index < 0 || index >= maxIndex) {
        continue;
      }
      const current = channelData[index];
      const next = channelData[index + 1];
      const crossesZero =
        current === 0 ||
        next === 0 ||
        (current < 0 && next > 0) ||
        (current > 0 && next < 0);
      if (!crossesZero) {
        continue;
      }
      const crossingTime = crossingTimeAt(index);
      const distance = Math.abs(crossingTime - time);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestTime = crossingTime;
      }
    }

    if (bestDistance < Number.POSITIVE_INFINITY) {
      break;
    }
  }

  return bestTime;
}

function snapSelectionEdgeToZeroCrossing(time) {
  if (!state.zeroCrossingSelectionEnabled) {
    return clamp(time, 0, getCurrentBufferDuration());
  }
  return findNearestZeroCrossingTime(time);
}

function getSortedSelection() {
  if (state.selectionStart === null || state.selectionEnd === null) {
    return null;
  }
  const start = Math.min(state.selectionStart, state.selectionEnd);
  const end = Math.max(state.selectionStart, state.selectionEnd);
  if (end - start < getMinimumSelectionDuration()) {
    return null;
  }
  return {
    start,
    end,
    duration: end - start,
  };
}

function getSelectionOrFullRange() {
  const selection = getSortedSelection();
  if (selection) {
    return {
      ...selection,
      isFullFile: false,
    };
  }

  const duration = getCurrentBufferDuration();
  if (!state.audioBuffer || duration <= 0) {
    return null;
  }

  return {
    start: 0,
    end: duration,
    duration,
    isFullFile: true,
  };
}

function updateDerivedView() {
  syncMarkersToBufferDuration();
  const duration = getCurrentBufferDuration();
  if (duration <= 0) {
    elements.playheadInfo.textContent = "0:00.000 / 0:00.000";
    elements.selectionInfo.textContent = "No selection";
    elements.viewInfo.textContent = "0:00.000 to 0:00.000";
    return;
  }

  const playhead = getCurrentPlaybackTime();
  elements.playheadInfo.textContent = `${formatDurationSeconds(playhead)} / ${formatDurationSeconds(duration)}`;

  const selection = getSortedSelection();
  if (selection) {
    elements.selectionInfo.textContent =
      `${formatDurationSeconds(selection.start)} to ${formatDurationSeconds(selection.end)} ` +
      `(${formatDurationSeconds(selection.duration)})`;
  } else {
    elements.selectionInfo.textContent = "No selection";
  }

  const viewEnd = clamp(state.viewStart + state.viewDuration, 0, duration);
  elements.viewInfo.textContent =
    `${formatDurationSeconds(state.viewStart)} to ${formatDurationSeconds(viewEnd)}`;
}

function setButtonIconLabel(iconElement, labelElement, iconClass, label) {
  const nextIconClass = `bi ${iconClass}`;
  if (iconElement.className !== nextIconClass) {
    iconElement.className = nextIconClass;
  }
  if (labelElement.textContent !== label) {
    labelElement.textContent = label;
  }
}

function renderDocumentTabs() {
  if (!elements.documentTabs) {
    return;
  }

  const documentSummaries = getDocumentSummaries();
  elements.documentTabs.replaceChildren();
  const showTabs = documentSummaries.length > 1 || documentSummaries.some((documentState) =>
    isDocumentLoaded(state.documents.find((candidate) => candidate.id === documentState.id)),
  );
  elements.documentTabs.classList.toggle("d-none", !showTabs);

  if (!showTabs) {
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const documentState of documentSummaries) {
    const group = document.createElement("div");
    group.className = "btn-group editor-document-tab-group";

    const switchButton = document.createElement("button");
    const switchHint = `Switch to ${documentState.label}.`;
    switchButton.type = "button";
    switchButton.className =
      `btn btn-sm editor-document-tab ${documentState.isActive ? "btn-primary" : "btn-outline-secondary"}`;
    switchButton.dataset.documentId = String(documentState.id);
    switchButton.dataset.uiHint = switchHint;
    switchButton.title = switchHint;
    switchButton.textContent = documentState.label;
    switchButton.setAttribute("aria-pressed", documentState.isActive ? "true" : "false");
    group.appendChild(switchButton);

    const closeButton = document.createElement("button");
    const closeHint = `Close ${documentState.label}.`;
    closeButton.type = "button";
    closeButton.className =
      `btn btn-sm ${documentState.isActive ? "btn-primary" : "btn-outline-secondary"} editor-document-close`;
    closeButton.dataset.documentClose = String(documentState.id);
    closeButton.dataset.uiHint = closeHint;
    closeButton.title = closeHint;
    closeButton.setAttribute("aria-label", closeHint);
    closeButton.innerHTML = '<i class="bi bi-x-lg" aria-hidden="true"></i>';
    group.appendChild(closeButton);

    fragment.appendChild(group);
  }

  elements.documentTabs.appendChild(fragment);
}

function updateTransportButtons() {
  setButtonIconLabel(
    elements.playPauseButtonIcon,
    elements.playPauseButtonLabel,
    state.isPlaying ? "bi-pause-fill" : "bi-play-fill",
    state.isPlaying ? "Pause" : "Play",
  );
  setButtonIconLabel(
    elements.loopToggleButtonIcon,
    elements.loopToggleButtonLabel,
    "bi-arrow-repeat",
    "Loop",
  );
  elements.loopToggleButton.classList.toggle(
    "btn-primary",
    state.loopEnabled,
  );
  elements.loopToggleButton.classList.toggle(
    "btn-outline-primary",
    !state.loopEnabled,
  );
  elements.loopToggleButton.setAttribute("aria-pressed", state.loopEnabled ? "true" : "false");
  elements.zeroCrossingToggleButton.classList.toggle(
    "btn-primary",
    state.zeroCrossingSelectionEnabled,
  );
  elements.zeroCrossingToggleButton.classList.toggle(
    "btn-outline-primary",
    !state.zeroCrossingSelectionEnabled,
  );
  elements.zeroCrossingToggleButton.setAttribute(
    "aria-pressed",
    state.zeroCrossingSelectionEnabled ? "true" : "false",
  );
  const hasAudio = Boolean(state.audioBuffer);
  elements.playPauseButton.disabled = !hasAudio;
  elements.loopToggleButton.disabled = !hasAudio;
  elements.resetPlayheadButton.disabled = !hasAudio;
  elements.movePlayheadToEndButton.disabled = !hasAudio;
  elements.undoButton.disabled = state.undoStack.length === 0;
  elements.resetButton.disabled = !hasAudio;
  elements.zoomInButton.disabled = !hasAudio;
  elements.zoomOutButton.disabled = !hasAudio;
  elements.zoomSelectionButton.disabled = !hasAudio;
  elements.halfSelectionButton.disabled = !getSortedSelection();
  elements.doubleSelectionButton.disabled = !getSortedSelection();
  elements.nudgeSelectionLeftButton.disabled = !getSortedSelection();
  elements.nudgeSelectionRightButton.disabled = !getSortedSelection();
  elements.fitButton.disabled = !hasAudio;
  elements.zeroCrossingToggleButton.disabled = !hasAudio;
  elements.addMarkerButton.disabled = !hasAudio;
  elements.addSelectionMarkersButton.disabled = !getSortedSelection();
  elements.gridMarkerCountInput.disabled = !hasAudio;
  elements.addGridMarkersButton.disabled = !hasAudio;
  elements.shuffleSlicesButton.disabled = !hasAudio;
  elements.rotateSlicesLeftButton.disabled = !hasAudio;
  elements.rotateSlicesRightButton.disabled = !hasAudio;
  elements.clearMarkersButton.disabled = state.markers.length === 0;
  elements.cutButton.disabled = !getSortedSelection();
  elements.copyButton.disabled = !getSortedSelection();
  elements.pasteButton.disabled = !hasAudio || !state.clipboardBuffer;
  elements.fadeInButton.disabled = !hasAudio;
  elements.fadeOutButton.disabled = !hasAudio;
  elements.crossfadeLoopButton.disabled = !hasAudio;
  elements.markerRegionFadeOutButton.disabled = !hasAudio || state.markers.length === 0;
  elements.markerRegionNormalizeButton.disabled = !hasAudio || state.markers.length === 0;
  elements.normalizeButton.disabled = !hasAudio;
  elements.channelConvertButton.disabled = !hasAudio;
  elements.reverseButton.disabled = !hasAudio;
  elements.trimButton.disabled = !hasAudio;
  elements.selectAllButton.disabled = !hasAudio;
  elements.clearSelectionButton.disabled = !getSortedSelection();
  if (elements.saveButton) {
    elements.saveButton.disabled = !hasAudio || !state.directoryHandle;
  }
}

function timeToCanvasX(time, width) {
  return ((time - state.viewStart) / Math.max(0.001, state.viewDuration)) * width;
}

function getWaveformMetrics() {
  const canvas = elements.waveformOverlay;
  return {
    width: Math.max(1, Math.floor(canvas.clientWidth || canvas.width || 1)),
    height: Math.max(1, Math.floor(canvas.clientHeight || canvas.height || 1)),
    dpr: Math.max(1, window.devicePixelRatio || 1),
  };
}

function getOverviewWaveformMetrics() {
  const canvas = elements.overviewWaveformOverlay;
  return {
    width: Math.max(1, Math.floor(canvas.clientWidth || canvas.width || 1)),
    height: Math.max(1, Math.floor(canvas.clientHeight || canvas.height || 1)),
    dpr: Math.max(1, window.devicePixelRatio || 1),
  };
}

function ensureCanvasContext(canvas, metrics) {
  const targetWidth = Math.floor(metrics.width * metrics.dpr);
  const targetHeight = Math.floor(metrics.height * metrics.dpr);
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
  const context = canvas.getContext("2d");
  context.setTransform(metrics.dpr, 0, 0, metrics.dpr, 0, 0);
  return context;
}

function invalidateWaveformCache() {
  state.waveformPeaksCache = null;
  state.overviewWaveformCache = null;
  state.baseWaveformDirty = true;
  state.overviewWaveformDirty = true;
  state.overlayDirty = true;
}

function requestFullRender() {
  state.baseWaveformDirty = true;
  state.overviewWaveformDirty = true;
  state.overlayDirty = true;
  scheduleRender();
}

function requestOverlayRender() {
  state.overlayDirty = true;
  scheduleRender();
}

function getCachedWaveformPeaks(width) {
  if (!state.audioBuffer || width <= 0) {
    return null;
  }

  const cache = state.waveformPeaksCache;
  if (
    cache &&
    cache.audioBuffer === state.audioBuffer &&
    cache.viewStart === state.viewStart &&
    cache.viewDuration === state.viewDuration &&
    cache.width === width
  ) {
    return cache;
  }

  const duration = state.audioBuffer.duration;
  const channelCount = Math.max(1, state.audioBuffer.numberOfChannels);
  const viewEnd = clamp(state.viewStart + state.viewDuration, 0, duration);
  const startSample = Math.floor((state.viewStart / duration) * state.audioBuffer.length);
  const endSample = Math.ceil((viewEnd / duration) * state.audioBuffer.length);
  const visibleSamples = Math.max(1, endSample - startSample);
  const peaksByChannel = [];

  for (let channel = 0; channel < channelCount; channel++) {
    const channelData = state.audioBuffer.getChannelData(channel);
    const mins = new Float32Array(width);
    const maxs = new Float32Array(width);
    mins.fill(1);
    maxs.fill(-1);

    for (let x = 0; x < width; x++) {
      const sampleFrom = startSample + Math.floor((x / width) * visibleSamples);
      const sampleTo = startSample + Math.floor(((x + 1) / width) * visibleSamples);
      let min = 1;
      let max = -1;
      for (
        let sampleIndex = sampleFrom;
        sampleIndex < Math.max(sampleFrom + 1, sampleTo);
        sampleIndex++
      ) {
        const sample = channelData[Math.min(channelData.length - 1, sampleIndex)];
        if (sample < min) {
          min = sample;
        }
        if (sample > max) {
          max = sample;
        }
      }
      mins[x] = min;
      maxs[x] = max;
    }

    peaksByChannel.push({ mins, maxs });
  }

  state.waveformPeaksCache = {
    audioBuffer: state.audioBuffer,
    viewStart: state.viewStart,
    viewDuration: state.viewDuration,
    width,
    peaksByChannel,
  };
  return state.waveformPeaksCache;
}

function getCachedOverviewWaveformPeaks(width) {
  if (!state.audioBuffer || width <= 0) {
    return null;
  }

  const cache = state.overviewWaveformCache;
  if (
    cache &&
    cache.audioBuffer === state.audioBuffer &&
    cache.width === width
  ) {
    return cache;
  }

  const channelData = state.audioBuffer.getChannelData(0);
  const mins = new Float32Array(width);
  const maxs = new Float32Array(width);
  mins.fill(1);
  maxs.fill(-1);

  for (let x = 0; x < width; x++) {
    const sampleFrom = Math.floor((x / width) * channelData.length);
    const sampleTo = Math.floor(((x + 1) / width) * channelData.length);
    let min = 1;
    let max = -1;
    for (
      let sampleIndex = sampleFrom;
      sampleIndex < Math.max(sampleFrom + 1, sampleTo);
      sampleIndex++
    ) {
      const sample = channelData[Math.min(channelData.length - 1, sampleIndex)];
      if (sample < min) {
        min = sample;
      }
      if (sample > max) {
        max = sample;
      }
    }
    mins[x] = min;
    maxs[x] = max;
  }

  state.overviewWaveformCache = {
    audioBuffer: state.audioBuffer,
    width,
    mins,
    maxs,
  };
  return state.overviewWaveformCache;
}

function getVisibleSampleWindow() {
  if (!state.audioBuffer || state.audioBuffer.length === 0) {
    return null;
  }

  const duration = state.audioBuffer.duration;
  const viewEnd = clamp(state.viewStart + state.viewDuration, 0, duration);
  const startSample = Math.floor((state.viewStart / duration) * state.audioBuffer.length);
  const endSample = Math.ceil((viewEnd / duration) * state.audioBuffer.length);

  return {
    startSample,
    endSample,
    visibleSamples: Math.max(1, endSample - startSample),
  };
}

function drawSamplePolyline(context, channelData, sampleWindow, width, laneCenter, laneAmplitude) {
  const { startSample, endSample, visibleSamples } = sampleWindow;
  const denominator = Math.max(1, visibleSamples - 1);

  context.beginPath();
  context.lineWidth = 1.75;
  context.lineJoin = "round";
  context.lineCap = "round";

  for (let sampleIndex = startSample; sampleIndex < endSample; sampleIndex++) {
    const x =
      visibleSamples <= 1
        ? width / 2
        : ((sampleIndex - startSample) / denominator) * Math.max(0, width - 1);
    const y = laneCenter - channelData[sampleIndex] * laneAmplitude;
    if (sampleIndex === startSample) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  }
  context.stroke();

  const samplesPerPixel = visibleSamples / Math.max(1, width);
  if (samplesPerPixel > 1.5) {
    return;
  }

  const pointRadius = samplesPerPixel <= 0.5 ? 2 : 1.5;
  for (let sampleIndex = startSample; sampleIndex < endSample; sampleIndex++) {
    const x =
      visibleSamples <= 1
        ? width / 2
        : ((sampleIndex - startSample) / denominator) * Math.max(0, width - 1);
    const y = laneCenter - channelData[sampleIndex] * laneAmplitude;
    context.beginPath();
    context.arc(x, y, pointRadius, 0, Math.PI * 2);
    context.fill();
  }
}

function paintBaseWaveform(metrics) {
  const context = ensureCanvasContext(elements.waveform, metrics);
  context.clearRect(0, 0, metrics.width, metrics.height);
  const palette = getEditorCanvasPalette();

  if (!state.audioBuffer || state.audioBuffer.length === 0) {
    context.fillStyle = palette.emptyText;
    context.font = "14px ui-monospace, Menlo, monospace";
    context.fillText("NO AUDIO LOADED", 16, 24);
    return;
  }

  const channelCount = Math.max(1, state.audioBuffer.numberOfChannels);
  const laneHeight = metrics.height / channelCount;
  const sampleWindow = getVisibleSampleWindow();
  if (!sampleWindow) {
    return;
  }
  const samplesPerPixel = sampleWindow.visibleSamples / Math.max(1, metrics.width);
  const useSamplePolyline = samplesPerPixel <= 8;
  const peakCache = useSamplePolyline ? null : getCachedWaveformPeaks(metrics.width);
  if (!useSamplePolyline && !peakCache) {
    return;
  }

  for (let channel = 0; channel < channelCount; channel++) {
    const laneTop = channel * laneHeight;
    const laneCenter = laneTop + laneHeight / 2;
    const laneAmplitude = Math.max(8, laneHeight * 0.38);
    const channelData = state.audioBuffer.getChannelData(channel);

    context.beginPath();
    context.moveTo(0, laneCenter);
    context.lineTo(metrics.width, laneCenter);
    context.strokeStyle = palette.lane;
    context.stroke();

    if (channel > 0) {
      context.beginPath();
      context.moveTo(0, laneTop);
      context.lineTo(metrics.width, laneTop);
      context.strokeStyle = palette.divider;
      context.stroke();
    }

    context.fillStyle = palette.label;
    context.font = "12px ui-monospace, Menlo, monospace";
    context.fillText(`CH ${channel + 1}`, 10, laneTop + 16);

    context.strokeStyle = palette.waveform;
    context.fillStyle = palette.waveform;
    if (useSamplePolyline) {
      drawSamplePolyline(
        context,
        channelData,
        sampleWindow,
        metrics.width,
        laneCenter,
        laneAmplitude,
      );
      continue;
    }

    const peaks = peakCache.peaksByChannel[channel];
    context.lineWidth = 1;
    for (let x = 0; x < metrics.width; x++) {
      const top = laneCenter - peaks.maxs[x] * laneAmplitude;
      const bottom = laneCenter - peaks.mins[x] * laneAmplitude;
      context.beginPath();
      context.moveTo(x + 0.5, top);
      context.lineTo(x + 0.5, bottom);
      context.stroke();
    }
  }
}

function paintOverviewBaseWaveform(metrics) {
  const context = ensureCanvasContext(elements.overviewWaveform, metrics);
  context.clearRect(0, 0, metrics.width, metrics.height);
  const palette = getEditorCanvasPalette();

  if (!state.audioBuffer || state.audioBuffer.length === 0) {
    context.fillStyle = palette.emptyText;
    context.font = "12px ui-monospace, Menlo, monospace";
    context.fillText("OVERVIEW UNAVAILABLE", 12, 22);
    return;
  }

  const peakCache = getCachedOverviewWaveformPeaks(metrics.width);
  if (!peakCache) {
    return;
  }

  const centerY = metrics.height / 2;
  const amplitude = Math.max(6, metrics.height * 0.38);

  context.beginPath();
  context.moveTo(0, centerY);
  context.lineTo(metrics.width, centerY);
  context.strokeStyle = palette.lane;
  context.stroke();

  context.strokeStyle = palette.waveform;
  context.lineWidth = 1;
  for (let x = 0; x < metrics.width; x++) {
    const top = centerY - peakCache.maxs[x] * amplitude;
    const bottom = centerY - peakCache.mins[x] * amplitude;
    context.beginPath();
    context.moveTo(x + 0.5, top);
    context.lineTo(x + 0.5, bottom);
    context.stroke();
  }
}

function paintOverlay(metrics) {
  const context = ensureCanvasContext(elements.waveformOverlay, metrics);
  context.clearRect(0, 0, metrics.width, metrics.height);
  const palette = getEditorCanvasPalette();

  if (!state.audioBuffer || state.audioBuffer.length === 0) {
    updateDerivedView();
    updateTransportButtons();
    return;
  }

  const duration = state.audioBuffer.duration;
  const viewEnd = clamp(state.viewStart + state.viewDuration, 0, duration);
  const selection = getSortedSelection();
  if (selection) {
    const selectionStartX = timeToCanvasX(selection.start, metrics.width);
    const selectionEndX = timeToCanvasX(selection.end, metrics.width);
    const left = clamp(selectionStartX, 0, metrics.width);
    const right = clamp(selectionEndX, 0, metrics.width);
    const renderedWidth = Math.max(1, right - left);
    if (renderedWidth > 0) {
      context.fillStyle = palette.selectionFill;
      context.fillRect(left, 0, renderedWidth, metrics.height);
      context.strokeStyle = palette.selectionStroke;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(left, 0);
      context.lineTo(left, metrics.height);
      context.moveTo(left + renderedWidth, 0);
      context.lineTo(left + renderedWidth, metrics.height);
      context.stroke();

      const handleWidth = 1;
      context.fillStyle = palette.selectionHandle;
      context.fillRect(left - handleWidth / 2, 0, handleWidth, metrics.height);
      context.fillRect(left + renderedWidth - handleWidth / 2, 0, handleWidth, metrics.height);
    }
  }

  const rawGridCount = Number(elements.gridMarkerCountInput.value);
  const gridSliceCount = Math.max(0, Math.floor(rawGridCount));
  const gridRange = getSelectionOrFullRange();
  if (gridRange && gridSliceCount > 1) {
    context.beginPath();
    context.lineWidth = 1;
    context.strokeStyle = palette.gridStroke;
    for (let sliceIndex = 1; sliceIndex < gridSliceCount; sliceIndex += 1) {
      const markerTime = gridRange.start + (sliceIndex * gridRange.duration) / gridSliceCount;
      if (markerTime < state.viewStart || markerTime > viewEnd) {
        continue;
      }
      const markerX = timeToCanvasX(markerTime, metrics.width);
      context.moveTo(markerX, 0);
      context.lineTo(markerX, metrics.height);
    }
    context.stroke();
  }

  const markerHandleWidth = 8;
  const markerHandleHeight = 6;
  for (const marker of state.markers) {
    if (marker.time < state.viewStart || marker.time > viewEnd) {
      continue;
    }
    const markerX =
      ((marker.time - state.viewStart) / Math.max(0.001, state.viewDuration)) *
      metrics.width;
    context.beginPath();
    context.lineWidth = 1.5;
    context.strokeStyle = palette.markerStroke;
    context.moveTo(markerX, markerHandleHeight);
    context.lineTo(markerX, metrics.height);
    context.stroke();

    context.fillStyle = palette.markerHandle;
    context.fillRect(
      markerX - markerHandleWidth / 2,
      0,
      markerHandleWidth,
      markerHandleHeight,
    );
  }

  const playheadTime = getCurrentPlaybackTime();
  if (playheadTime >= state.viewStart && playheadTime <= viewEnd) {
    const playheadX =
      ((playheadTime - state.viewStart) / Math.max(0.001, state.viewDuration)) *
      metrics.width;
    context.beginPath();
    context.lineWidth = 2;
    context.strokeStyle = palette.playhead;
    context.moveTo(playheadX, 0);
    context.lineTo(playheadX, metrics.height);
    context.stroke();
  }

  updateDerivedView();
  updateTransportButtons();
}

function paintOverviewOverlay(metrics) {
  const context = ensureCanvasContext(elements.overviewWaveformOverlay, metrics);
  context.clearRect(0, 0, metrics.width, metrics.height);
  const palette = getEditorCanvasPalette();

  if (!state.audioBuffer || state.audioBuffer.length === 0) {
    return;
  }

  const duration = state.audioBuffer.duration;
  const selection = getSortedSelection();
  if (selection) {
    const left = clamp((selection.start / duration) * metrics.width, 0, metrics.width);
    const right = clamp((selection.end / duration) * metrics.width, 0, metrics.width);
    const renderedWidth = Math.max(1, right - left);
    context.fillStyle = palette.selectionFill;
    context.fillRect(left, 0, renderedWidth, metrics.height);
    context.strokeStyle = palette.selectionStroke;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(left, 0);
    context.lineTo(left, metrics.height);
    context.moveTo(left + renderedWidth, 0);
    context.lineTo(left + renderedWidth, metrics.height);
    context.stroke();
  }

  const viewStartX = clamp((state.viewStart / duration) * metrics.width, 0, metrics.width);
  const viewEndX = clamp(
    ((state.viewStart + state.viewDuration) / duration) * metrics.width,
    0,
    metrics.width,
  );
  const viewWidth = Math.max(1, viewEndX - viewStartX);
  context.fillStyle = palette.viewFill;
  context.fillRect(viewStartX, 0, viewWidth, metrics.height);
  context.strokeStyle = palette.viewStroke;
  context.lineWidth = 1.5;
  context.strokeRect(viewStartX + 0.75, 0.75, Math.max(0.5, viewWidth - 1.5), metrics.height - 1.5);

  context.beginPath();
  context.lineWidth = 1.25;
  context.strokeStyle = palette.markerStroke;
  for (const marker of state.markers) {
    const markerX = clamp((marker.time / duration) * metrics.width, 0, metrics.width);
    context.moveTo(markerX, 0);
    context.lineTo(markerX, metrics.height);
  }
  context.stroke();

  const playheadTime = getCurrentPlaybackTime();
  const playheadX = clamp((playheadTime / duration) * metrics.width, 0, metrics.width);
  context.beginPath();
  context.lineWidth = 2;
  context.strokeStyle = palette.playhead;
  context.moveTo(playheadX, 0);
  context.lineTo(playheadX, metrics.height);
  context.stroke();
}

function scheduleRender() {
  if (state.animationFrameID !== 0) {
    return;
  }
  state.animationFrameID = requestAnimationFrame(() => {
    state.animationFrameID = 0;

    const metrics = getWaveformMetrics();
    const overviewMetrics = getOverviewWaveformMetrics();
    const previousMetrics = state.canvasMetrics;
    const previousOverviewMetrics = state.overviewCanvasMetrics;
    if (
      !previousMetrics ||
      previousMetrics.width !== metrics.width ||
      previousMetrics.height !== metrics.height ||
      previousMetrics.dpr !== metrics.dpr
    ) {
      state.canvasMetrics = metrics;
      state.waveformPeaksCache = null;
      state.baseWaveformDirty = true;
      state.overlayDirty = true;
    } else {
      state.canvasMetrics = metrics;
    }

    if (
      !previousOverviewMetrics ||
      previousOverviewMetrics.width !== overviewMetrics.width ||
      previousOverviewMetrics.height !== overviewMetrics.height ||
      previousOverviewMetrics.dpr !== overviewMetrics.dpr
    ) {
      state.overviewCanvasMetrics = overviewMetrics;
      state.overviewWaveformCache = null;
      state.overviewWaveformDirty = true;
      state.overlayDirty = true;
    } else {
      state.overviewCanvasMetrics = overviewMetrics;
    }

    if (state.baseWaveformDirty) {
      paintBaseWaveform(metrics);
      state.baseWaveformDirty = false;
    }

    if (state.overviewWaveformDirty) {
      paintOverviewBaseWaveform(overviewMetrics);
      state.overviewWaveformDirty = false;
    }

    if (state.overlayDirty || state.isPlaying || state.isSelecting) {
      paintOverlay(metrics);
      paintOverviewOverlay(overviewMetrics);
      state.overlayDirty = false;
    }

    if (state.isPlaying || state.isSelecting) {
      state.overlayDirty = true;
      scheduleRender();
    }
  });
}

function renderWaveform() {
  requestFullRender();
}

function createUndoSnapshot() {
  if (!state.audioBuffer) {
    return null;
  }
  return {
    audioBuffer: cloneAudioBuffer(state.audioBuffer),
    markers: cloneMarkers(),
    nextMarkerID: state.nextMarkerID,
    selectionStart: state.selectionStart,
    selectionEnd: state.selectionEnd,
    viewStart: state.viewStart,
    viewDuration: state.viewDuration,
    pausedAt: state.pausedAt,
  };
}

function pushUndoSnapshot() {
  const snapshot = createUndoSnapshot();
  if (!snapshot) {
    return;
  }
  state.undoStack.push(snapshot);
  if (state.undoStack.length > maxUndoSteps) {
    state.undoStack.shift();
  }
  if (elements) {
    updateTransportButtons();
  }
}

function restoreUndoSnapshot(snapshot) {
  if (!snapshot) {
    return;
  }
  state.audioBuffer = cloneAudioBuffer(snapshot.audioBuffer);
  state.markers = cloneMarkers(snapshot.markers);
  state.nextMarkerID = snapshot.nextMarkerID;
  state.draggedMarkerID = null;
  state.selectionStart = snapshot.selectionStart;
  state.selectionEnd = snapshot.selectionEnd;
  state.viewStart = snapshot.viewStart;
  state.viewDuration = snapshot.viewDuration;
  state.pausedAt = clamp(snapshot.pausedAt, 0, getCurrentBufferDuration());
  syncMarkersToBufferDuration();
  syncActiveDocumentFromRuntimeState();
}

function startRenderLoop() {
  requestOverlayRender();
}

function stopRenderLoop() {
  if (state.animationFrameID !== 0) {
    cancelAnimationFrame(state.animationFrameID);
    state.animationFrameID = 0;
  }
}

function getOrCreateAudioContext() {
  if (!state.audioContext) {
    state.audioContext = new AudioContext();
  }
  return state.audioContext;
}

async function ensureRunningAudioContext() {
  const context = getOrCreateAudioContext();
  if (state.audioContext.state === "suspended") {
    await state.audioContext.resume();
  }
  return context;
}

function nextTransportGeneration() {
  state.transportGeneration += 1;
  return state.transportGeneration;
}

function stopPlayback(keepCurrentPosition = true, invalidatePendingActions = true) {
  const pausedAt = keepCurrentPosition && state.audioBuffer
    ? getCurrentPlaybackTime()
    : state.pausedAt;
  const sourceNode = state.sourceNode;

  if (invalidatePendingActions) {
    nextTransportGeneration();
  }

  state.sourceNode = null;
  state.isPlaying = false;

  if (keepCurrentPosition && state.audioBuffer) {
    state.pausedAt = pausedAt;
  }

  if (sourceNode) {
    sourceNode.onended = null;
    try {
      sourceNode.stop(0);
    } catch {
      // ignore stop errors for already-finished nodes
    }
    sourceNode.disconnect();
  }

  stopRenderLoop();
  requestOverlayRender();
}

async function playRangeFrom(
  offsetSeconds,
  rangeStart,
  rangeEnd,
  mode = "once",
  transportGeneration = nextTransportGeneration(),
) {
  if (!state.audioBuffer) {
    return;
  }

  const context = await ensureRunningAudioContext();
  if (transportGeneration !== state.transportGeneration) {
    return;
  }

  stopPlayback(false, false);
  if (transportGeneration !== state.transportGeneration) {
    return;
  }

  const safeRangeStart = clamp(rangeStart, 0, state.audioBuffer.duration);
  const safeRangeEnd = clamp(rangeEnd, safeRangeStart + 0.001, state.audioBuffer.duration);
  const safeOffset = clamp(offsetSeconds, safeRangeStart, safeRangeEnd);
  const sourceNode = context.createBufferSource();
  sourceNode.buffer = state.audioBuffer;
  if (mode === "loop") {
    sourceNode.loop = true;
    sourceNode.loopStart = safeRangeStart;
    sourceNode.loopEnd = safeRangeEnd;
  }
  sourceNode.connect(context.destination);

  state.sourceNode = sourceNode;
  state.isPlaying = true;
  state.playbackMode = mode;
  state.playStartOffset = safeOffset;
  state.playStartContextTime = context.currentTime;
  state.playbackRangeStart = safeRangeStart;
  state.playbackRangeEnd = safeRangeEnd;
  state.pausedAt = safeOffset;

  sourceNode.onended = () => {
    if (state.sourceNode !== sourceNode) {
      return;
    }
    state.sourceNode.disconnect();
    state.sourceNode = null;
    state.isPlaying = false;
    state.playbackMode = state.loopEnabled ? "loop" : "once";
    state.pausedAt = clamp(safeRangeStart, 0, state.audioBuffer.duration);
    if (safeRangeEnd >= state.audioBuffer.duration - 0.001 && safeRangeStart === 0) {
      state.pausedAt = 0;
    }
    stopRenderLoop();
    requestOverlayRender();
  };

  if (mode === "loop") {
    sourceNode.start(0, safeOffset);
  } else {
    sourceNode.start(0, safeOffset, safeRangeEnd - safeOffset);
  }
  startRenderLoop();
  requestOverlayRender();
}

async function playUsingActiveRange(mode = state.loopEnabled ? "loop" : "once") {
  if (!state.audioBuffer) {
    return;
  }

  const transportGeneration = nextTransportGeneration();
  const range = getActivePlaybackRange();
  let startOffset = range.start;

  if (state.pausedAt >= range.start && state.pausedAt < range.end) {
    startOffset = state.pausedAt;
  }

  await playRangeFrom(startOffset, range.start, range.end, mode, transportGeneration);
}

async function syncPlaybackToActiveRange(mode = state.playbackMode || "once") {
  if (!state.audioBuffer || !state.isPlaying) {
    return;
  }

  const transportGeneration = nextTransportGeneration();
  const range = getActivePlaybackRange();
  const currentTime = getCurrentPlaybackTime();
  const nextStart = clamp(currentTime, range.start, Math.max(range.start, range.end - 0.001));
  await playRangeFrom(nextStart, range.start, range.end, mode, transportGeneration);
}

async function restartPlaybackAtTime(playheadTime, mode = state.playbackMode || "once") {
  if (!state.audioBuffer) {
    return;
  }

  const transportGeneration = nextTransportGeneration();
  const range = getActivePlaybackRange();
  const nextStart = clamp(
    playheadTime,
    range.start,
    Math.max(range.start, range.end - 0.001),
  );
  await playRangeFrom(nextStart, range.start, range.end, mode, transportGeneration);
}

async function togglePlayPause() {
  if (!state.audioBuffer) {
    return;
  }

  if (state.isPlaying) {
    stopPlayback(true);
    return;
  }
  await playUsingActiveRange();
}

async function toggleLoopEnabled() {
  if (!state.audioBuffer) {
    return;
  }

  state.loopEnabled = !state.loopEnabled;
  state.playbackMode = state.loopEnabled ? "loop" : "once";

  if (state.isPlaying) {
    await syncPlaybackToActiveRange(state.playbackMode);
    return;
  }

  requestOverlayRender();
}

async function seekTo(seconds) {
  if (!state.audioBuffer) {
    return;
  }

  const safeTime = clamp(seconds, 0, state.audioBuffer.duration);
  if (state.isPlaying) {
    const transportGeneration = nextTransportGeneration();
    await playRangeFrom(
      safeTime,
      state.playbackRangeStart,
      state.playbackRangeEnd,
      state.playbackMode,
      transportGeneration,
    );
    return;
  }
  state.pausedAt = safeTime;
  requestOverlayRender();
}

async function resetPlayheadToRangeStart() {
  const range = getActivePlaybackRange();
  await seekTo(range.start);
}

function movePlayheadToFileEnd() {
  if (!state.audioBuffer) {
    return;
  }

  stopPlayback(false);
  state.pausedAt = getCurrentBufferDuration();
  requestOverlayRender();
}

function getMinimumViewDuration() {
  if (!state.audioBuffer || state.audioBuffer.sampleRate <= 0) {
    return 0.25;
  }
  return Math.min(getCurrentBufferDuration(), 1 / state.audioBuffer.sampleRate);
}

function setViewWindow(start, duration) {
  const totalDuration = getCurrentBufferDuration();
  if (totalDuration <= 0) {
    state.viewStart = 0;
    state.viewDuration = 0;
    return;
  }

  const minViewDuration = getMinimumViewDuration();
  const safeDuration = clamp(duration, minViewDuration, totalDuration);
  state.viewStart = clamp(start, 0, totalDuration - safeDuration);
  state.viewDuration = safeDuration;
  requestFullRender();
}

function zoomAround(center, factor) {
  const totalDuration = getCurrentBufferDuration();
  if (totalDuration <= 0) {
    return;
  }
  const minViewDuration = getMinimumViewDuration();
  const nextDuration = clamp(
    state.viewDuration * factor,
    minViewDuration,
    totalDuration,
  );
  setViewWindow(center - nextDuration / 2, nextDuration);
}

function zoomIn() {
  const selection = getSortedSelection();
  const zoomCenter = selection
    ? (selection.start + selection.end) / 2
    : getCurrentPlaybackTime();
  zoomAround(zoomCenter, 0.5);
}

function zoomOut() {
  const selection = getSortedSelection();
  const zoomCenter = selection
    ? (selection.start + selection.end) / 2
    : getCurrentPlaybackTime();
  zoomAround(zoomCenter, 2);
}

function zoomToSelection() {
  const selection = getSortedSelection();
  if (!selection) {
    setStatus("Create a selection before zooming to it.", "warning");
    return;
  }
  const paddedDuration = Math.max(selection.duration * 1.25, getMinimumViewDuration());
  setViewWindow(selection.start - (paddedDuration - selection.duration) / 2, paddedDuration);
}

function ensureSelectionVisible(selection) {
  if (!selection || !state.audioBuffer) {
    return;
  }

  const viewEnd = state.viewStart + state.viewDuration;
  if (selection.start >= state.viewStart && selection.end <= viewEnd) {
    return;
  }

  if (selection.duration <= state.viewDuration) {
    let nextViewStart = state.viewStart;
    if (selection.start < state.viewStart) {
      nextViewStart = selection.start;
    }
    if (selection.end > viewEnd) {
      nextViewStart = selection.end - state.viewDuration;
    }
    setViewWindow(nextViewStart, state.viewDuration);
    return;
  }

  const paddedDuration = Math.max(selection.duration * 1.1, getMinimumViewDuration());
  setViewWindow(selection.start - (paddedDuration - selection.duration) / 2, paddedDuration);
}

async function halveSelection() {
  const selection = getSortedSelection();
  if (!selection) {
    setStatus("Create a selection before halving it.", "warning");
    return;
  }

  const nextDuration = selection.duration / 2;
  if (nextDuration < 0.001) {
    setStatus("Selection is already too short to halve again.", "warning");
    return;
  }

  const nextStart = selection.start;
  const nextEnd = selection.start + nextDuration;
  updateSelection(nextStart, nextEnd);
  ensureSelectionVisible({
    start: nextStart,
    end: nextEnd,
    duration: nextEnd - nextStart,
  });

  state.pausedAt = clamp(
    state.pausedAt,
    nextStart,
    Math.max(nextStart, nextEnd - 0.001),
  );

  if (state.isPlaying) {
    await syncPlaybackToActiveRange(state.playbackMode);
  } else {
    requestOverlayRender();
  }

  setStatus("Selection length halved from the left edge.", "secondary");
}

async function doubleSelection() {
  const selection = getSortedSelection();
  if (!selection) {
    setStatus("Create a selection before doubling it.", "warning");
    return;
  }

  const duration = getCurrentBufferDuration();
  const nextStart = selection.start;
  const nextEnd = clamp(selection.start + selection.duration * 2, nextStart, duration);
  if (nextEnd - nextStart < selection.duration + 0.001) {
    setStatus("Selection already reaches the end of the file.", "warning");
    return;
  }

  updateSelection(nextStart, nextEnd);
  ensureSelectionVisible({
    start: nextStart,
    end: nextEnd,
    duration: nextEnd - nextStart,
  });

  state.pausedAt = clamp(
    state.pausedAt,
    nextStart,
    Math.max(nextStart, nextEnd - 0.001),
  );

  if (state.isPlaying) {
    await syncPlaybackToActiveRange(state.playbackMode);
  } else {
    requestOverlayRender();
  }

  setStatus("Selection length doubled from the left edge.", "secondary");
}

async function nudgeSelectionLeft() {
  const selection = getSortedSelection();
  if (!selection) {
    setStatus("Create a selection before nudging it.", "warning");
    return;
  }

  const nextStart = Math.max(0, selection.start - selection.duration);
  const nextEnd = nextStart + selection.duration;
  if (Math.abs(nextStart - selection.start) < 0.001) {
    setStatus("Selection is already at the start of the file.", "warning");
    return;
  }

  updateSelection(nextStart, nextEnd);
  ensureSelectionVisible({
    start: nextStart,
    end: nextEnd,
    duration: nextEnd - nextStart,
  });

  state.pausedAt = clamp(
    state.pausedAt,
    nextStart,
    Math.max(nextStart, nextEnd - 0.001),
  );

  if (state.isPlaying) {
    await syncPlaybackToActiveRange(state.playbackMode);
  } else {
    requestOverlayRender();
  }

  setStatus("Selection nudged left by its own length.", "secondary");
}

async function nudgeSelectionRight() {
  const selection = getSortedSelection();
  if (!selection) {
    setStatus("Create a selection before nudging it.", "warning");
    return;
  }

  const duration = getCurrentBufferDuration();
  const unclampedEnd = selection.end + selection.duration;
  const nextEnd = Math.min(duration, unclampedEnd);
  const nextStart = nextEnd - selection.duration;
  if (Math.abs(nextEnd - selection.end) < 0.001) {
    setStatus("Selection already reaches the end of the file.", "warning");
    return;
  }

  updateSelection(nextStart, nextEnd);
  ensureSelectionVisible({
    start: nextStart,
    end: nextEnd,
    duration: nextEnd - nextStart,
  });

  state.pausedAt = clamp(
    state.pausedAt,
    nextStart,
    Math.max(nextStart, nextEnd - 0.001),
  );

  if (state.isPlaying) {
    await syncPlaybackToActiveRange(state.playbackMode);
  } else {
    requestOverlayRender();
  }

  setStatus("Selection nudged right by its own length.", "secondary");
}

function fitView() {
  setViewWindow(0, getCurrentBufferDuration());
}

function timeFromPointerEvent(event) {
  const rect = elements.waveformOverlay.getBoundingClientRect();
  const ratio = rect.width > 0 ? clamp((event.clientX - rect.left) / rect.width, 0, 1) : 0;
  return state.viewStart + ratio * state.viewDuration;
}

function timeFromOverviewPointerEvent(event) {
  const rect = elements.overviewWaveformOverlay.getBoundingClientRect();
  const ratio = rect.width > 0 ? clamp((event.clientX - rect.left) / rect.width, 0, 1) : 0;
  return ratio * getCurrentBufferDuration();
}

function updateSelection(start, end, options = {}) {
  const { snapToZeroCrossing = state.zeroCrossingSelectionEnabled } = options;
  const nextStart = snapToZeroCrossing ? snapSelectionEdgeToZeroCrossing(start) : start;
  const nextEnd = snapToZeroCrossing ? snapSelectionEdgeToZeroCrossing(end) : end;
  state.selectionStart = clamp(nextStart, 0, getCurrentBufferDuration());
  state.selectionEnd = clamp(nextEnd, 0, getCurrentBufferDuration());
  requestOverlayRender();
}

function clearSelection() {
  state.selectionStart = null;
  state.selectionEnd = null;
  requestOverlayRender();
}

function selectAll() {
  const duration = getCurrentBufferDuration();
  if (duration <= 0) {
    return;
  }
  state.selectionStart = 0;
  state.selectionEnd = duration;
  state.pausedAt = 0;
  requestOverlayRender();
}

function toggleZeroCrossingSelection() {
  if (!state.audioBuffer) {
    return;
  }

  state.zeroCrossingSelectionEnabled = !state.zeroCrossingSelectionEnabled;
  const selection = getSortedSelection();
  if (state.zeroCrossingSelectionEnabled && selection) {
    updateSelection(selection.start, selection.end);
    return;
  }
  requestOverlayRender();
}

function getSelectionFrameRange(selection = getSortedSelection()) {
  if (!selection || !state.audioBuffer) {
    return null;
  }

  const startFrame = Math.max(0, Math.floor(selection.start * state.audioBuffer.sampleRate));
  const endFrame = Math.min(
    state.audioBuffer.length,
    Math.ceil(selection.end * state.audioBuffer.sampleRate),
  );

  if (endFrame <= startFrame) {
    return null;
  }

  return {
    startFrame,
    endFrame,
    frameLength: endFrame - startFrame,
  };
}

function updateViewForBufferChange() {
  const duration = getCurrentBufferDuration();
  state.viewDuration = clamp(
    state.viewDuration || duration,
    getMinimumViewDuration(),
    duration,
  );
  state.viewStart = clamp(state.viewStart, 0, Math.max(0, duration - state.viewDuration));
}

function captureClipboardFromSelection(selectionFrames) {
  if (!state.audioBuffer || !selectionFrames) {
    return null;
  }
  state.clipboardBuffer = extractAudioBufferSegment(
    state.audioBuffer,
    selectionFrames.startFrame,
    selectionFrames.endFrame,
  );
  updateTransportButtons();
  return state.clipboardBuffer;
}

async function copySelectionToClipboard() {
  const selectionFrames = getSelectionFrameRange();
  if (!selectionFrames || !state.audioBuffer) {
    setStatus("Select part of the waveform before copying.", "warning");
    return;
  }

  captureClipboardFromSelection(selectionFrames);
  setStatus("Copied the current selection to the internal clipboard.", "secondary");
}

async function cutSelectionToClipboard() {
  const selection = getSortedSelection();
  const selectionFrames = getSelectionFrameRange(selection);
  if (!selection || !selectionFrames || !state.audioBuffer) {
    setStatus("Select part of the waveform before cutting.", "warning");
    return;
  }

  const restartMode = state.isPlaying ? state.playbackMode : null;
  const currentTime = getCurrentPlaybackTime();
  captureClipboardFromSelection(selectionFrames);
  pushUndoSnapshot();

  state.audioBuffer = removeAudioBufferSegment(
    state.audioBuffer,
    selectionFrames.startFrame,
    selectionFrames.endFrame,
  );
  state.markers = remapMarkersAfterRemovedSegment(
    state.markers,
    selection.start,
    selection.end,
  );
  syncMarkersToBufferDuration();

  const removedDuration = selectionFrames.frameLength / state.audioBuffer.sampleRate;
  const nextPlayhead =
    currentTime <= selection.start
      ? currentTime
      : currentTime >= selection.end
        ? currentTime - removedDuration
        : selection.start;

  clearSelection();
  state.pausedAt = clamp(nextPlayhead, 0, getCurrentBufferDuration());
  updateViewForBufferChange();
  invalidateWaveformCache();

  if (restartMode) {
    await restartPlaybackAtTime(state.pausedAt, restartMode);
  } else {
    requestFullRender();
  }

  setStatus("Cut the current selection to the internal clipboard.", "success");
}

async function pasteClipboard() {
  if (!state.audioBuffer) {
    setStatus("The editor source is not ready yet.", "warning");
    return;
  }
  if (!state.clipboardBuffer) {
    setStatus("The internal clipboard is empty.", "warning");
    return;
  }

  const compatibleClipboardBuffer = await getClipboardBufferForCurrentDocument();
  if (!compatibleClipboardBuffer) {
    setStatus("The internal clipboard is empty.", "warning");
    return;
  }

  const restartMode = state.isPlaying ? state.playbackMode : null;
  const selection = getSortedSelection();
  const selectionFrames = getSelectionFrameRange(selection);
  pushUndoSnapshot();

  if (!selection || !selectionFrames) {
    const insertFrame = clamp(
      Math.floor(getCurrentPlaybackTime() * state.audioBuffer.sampleRate),
      0,
      state.audioBuffer.length,
    );
    const insertStart = insertFrame / state.audioBuffer.sampleRate;
    state.audioBuffer = insertAudioBufferSegment(
      state.audioBuffer,
      insertFrame,
      compatibleClipboardBuffer,
    );
    const insertedDuration = compatibleClipboardBuffer.length / state.audioBuffer.sampleRate;
    state.markers = remapMarkersAfterInsertedSegment(
      state.markers,
      insertStart,
      insertedDuration,
    );
    syncMarkersToBufferDuration();
    state.pausedAt = insertStart;
    updateSelection(insertStart, insertStart + insertedDuration, {
      snapToZeroCrossing: false,
    });
    ensureSelectionVisible(getSortedSelection());
    updateViewForBufferChange();
    invalidateWaveformCache();

    if (restartMode) {
      await restartPlaybackAtTime(insertStart, restartMode);
    } else {
      requestFullRender();
    }

    setStatus("Pasted the clipboard at the playhead.", "success");
    return;
  }

  const overwriteStart = selectionFrames.startFrame;
  const overwriteResult = overwriteAudioBufferSegment(
    state.audioBuffer,
    overwriteStart,
    compatibleClipboardBuffer,
    selectionFrames.frameLength,
  );
  const overwrittenDuration = overwriteResult.overwrittenLength / state.audioBuffer.sampleRate;

  if (overwriteResult.overwrittenLength <= 0) {
    setStatus("Selection is too short for pasting.", "warning");
    state.undoStack.pop();
    updateTransportButtons();
    return;
  }

  state.audioBuffer = overwriteResult.audioBuffer;
  state.pausedAt = selection.start;
  updateSelection(selection.start, selection.start + overwrittenDuration, {
    snapToZeroCrossing: false,
  });
  ensureSelectionVisible(getSortedSelection());
  updateViewForBufferChange();
  invalidateWaveformCache();

  if (restartMode) {
    await restartPlaybackAtTime(selection.start, restartMode);
  } else {
    requestFullRender();
  }

  setStatus("Pasted the clipboard over the current selection.", "success");
}

function getSelectionHandleHit(event) {
  const selection = getSortedSelection();
  if (!selection) {
    return null;
  }

  const rect = elements.waveformOverlay.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const pointerX = event.clientX - rect.left;
  const leftX = timeToCanvasX(selection.start, width);
  const rightX = timeToCanvasX(selection.end, width);
  const tolerance = 8;

  if (Math.abs(pointerX - leftX) <= tolerance) {
    return "handle-start";
  }
  if (Math.abs(pointerX - rightX) <= tolerance) {
    return "handle-end";
  }
  return null;
}

function getMarkerHandleHit(event) {
  if (!state.audioBuffer || state.markers.length === 0) {
    return null;
  }

  const rect = elements.waveformOverlay.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const pointerX = event.clientX - rect.left;
  const pointerY = event.clientY - rect.top;
  const handleWidth = 8;
  const handleHeight = 8;
  const viewEnd = clamp(state.viewStart + state.viewDuration, 0, getCurrentBufferDuration());

  for (let index = state.markers.length - 1; index >= 0; index -= 1) {
    const marker = state.markers[index];
    if (marker.time < state.viewStart || marker.time > viewEnd) {
      continue;
    }
    const markerX = timeToCanvasX(marker.time, width);
    const withinX = Math.abs(pointerX - markerX) <= handleWidth / 2 + 2;
    const withinY = pointerY >= 0 && pointerY <= handleHeight + 2;
    if (withinX && withinY) {
      return marker;
    }
  }

  return null;
}

function updateWaveformOverlayCursor(event = null) {
  if (state.draggedMarkerID !== null) {
    elements.waveformOverlay.style.cursor = "grabbing";
    return;
  }

  if (
    state.isSelecting &&
    state.dragSurface === "main" &&
    (state.dragMode === "handle-start" || state.dragMode === "handle-end")
  ) {
    elements.waveformOverlay.style.cursor = "grabbing";
    return;
  }

  if (event && getMarkerHandleHit(event)) {
    elements.waveformOverlay.style.cursor = "grab";
    return;
  }

  if (event && getSelectionHandleHit(event)) {
    elements.waveformOverlay.style.cursor = "grab";
    return;
  }

  elements.waveformOverlay.style.cursor = "";
}

function getMarkerBoundedSelectionAtTime(time) {
  if (!state.audioBuffer) {
    return null;
  }

  const duration = getCurrentBufferDuration();
  const clampedTime = clamp(time, 0, duration);
  const sortedMarkerTimes = state.markers
    .map((marker) => marker.time)
    .filter((markerTime) => Number.isFinite(markerTime))
    .sort((left, right) => left - right);

  let start = 0;
  let end = duration;
  for (const markerTime of sortedMarkerTimes) {
    if (markerTime <= clampedTime) {
      start = markerTime;
      continue;
    }
    end = markerTime;
    break;
  }

  if (end - start < getMinimumSelectionDuration()) {
    return null;
  }

  return {
    start,
    end,
  };
}

function getCurrentDocumentMarkerRegions() {
  if (!state.audioBuffer) {
    return [];
  }

  const duration = getCurrentBufferDuration();
  const minimumRegionDuration = 1 / state.audioBuffer.sampleRate;
  const sortedMarkerTimes = state.markers
    .map((marker) => Number(marker?.time))
    .filter((time) => Number.isFinite(time) && time > 0 && time < duration)
    .sort((left, right) => left - right);

  const boundaries = [0];
  for (const markerTime of sortedMarkerTimes) {
    if (Math.abs(markerTime - boundaries[boundaries.length - 1]) > minimumRegionDuration) {
      boundaries.push(markerTime);
    }
  }
  boundaries.push(duration);

  const regions = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    if (end - start > minimumRegionDuration) {
      regions.push({ start, end });
    }
  }
  return regions;
}

async function applyEffectToSelection(effectName, effectFn) {
  const selection = getSelectionOrFullRange();
  if (!selection || !state.audioBuffer) {
    setStatus("The editor source is not ready yet.", "warning");
    return;
  }

  const startFrame = Math.floor(selection.start * state.audioBuffer.sampleRate);
  const endFrame = Math.ceil(selection.end * state.audioBuffer.sampleRate);
  if (endFrame <= startFrame) {
    setStatus("Selection is too short for editing.", "warning");
    return;
  }

  pushUndoSnapshot();
  effectFn(startFrame, endFrame);
  invalidateWaveformCache();
  if (state.isPlaying) {
    await syncPlaybackToActiveRange(state.playbackMode);
  }
  requestFullRender();
  setStatus(
    `${effectName} applied to ${selection.isFullFile ? "the whole file" : "the current selection"}.`,
    "success",
  );
}

async function applyFadeIn() {
  await applyEffectToSelection("Fade in", (startFrame, endFrame) => {
    const selectionLength = Math.max(1, endFrame - startFrame);
    for (let channel = 0; channel < state.audioBuffer.numberOfChannels; channel++) {
      const channelData = state.audioBuffer.getChannelData(channel);
      for (let frame = startFrame; frame < endFrame; frame++) {
        const progress = (frame - startFrame) / selectionLength;
        const gain = sCurveFadeGain(progress);
        channelData[frame] *= gain;
      }
    }
  });
}

async function applyFadeOut() {
  await applyEffectToSelection("Fade out", (startFrame, endFrame) => {
    const selectionLength = Math.max(1, endFrame - startFrame);
    for (let channel = 0; channel < state.audioBuffer.numberOfChannels; channel++) {
      const channelData = state.audioBuffer.getChannelData(channel);
      for (let frame = startFrame; frame < endFrame; frame++) {
        const progress = (frame - startFrame) / selectionLength;
        const gain = 1 - sCurveFadeGain(progress);
        channelData[frame] *= gain;
      }
    }
  });
}

async function applyCrossfadeLoop() {
  await applyEffectToSelection("Crossfade loop", (startFrame, endFrame) => {
    const selectionLength = Math.max(1, endFrame - startFrame);
    const maxFadeLength = Math.max(1, Math.floor(selectionLength / 2));
    const relativeFadeLength = Math.max(1, Math.floor(selectionLength * crossfadeLoopRangeRatio));
    const fadeLength = Math.min(maxFadeLength, relativeFadeLength);
    const preBoundaryLength = Math.floor(fadeLength / 2);
    const postBoundaryLength = fadeLength - preBoundaryLength;

    for (let channel = 0; channel < state.audioBuffer.numberOfChannels; channel += 1) {
      const channelData = state.audioBuffer.getChannelData(channel);
      const blendedCrossfade = new Float32Array(fadeLength);

      for (let index = 0; index < fadeLength; index += 1) {
        const headFrame = startFrame + index;
        const tailFrame = endFrame - fadeLength + index;
        const progress = (index + 1) / fadeLength;
        const fadeOutGain = Math.cos(progress * Math.PI * 0.5);
        const fadeInGain = Math.sin(progress * Math.PI * 0.5);
        blendedCrossfade[index] =
          channelData[tailFrame] * fadeOutGain + channelData[headFrame] * fadeInGain;
      }

      for (let index = 0; index < preBoundaryLength; index += 1) {
        channelData[endFrame - preBoundaryLength + index] = blendedCrossfade[index];
      }

      for (let index = 0; index < postBoundaryLength; index += 1) {
        channelData[startFrame + index] = blendedCrossfade[preBoundaryLength + index];
      }
    }
  });
}

async function applyMarkerRegionFadeOut() {
  if (!state.audioBuffer) {
    setStatus("The editor source is not ready yet.", "warning");
    return;
  }

  const regions = getCurrentDocumentMarkerRegions();
  if (regions.length < 2) {
    setStatus("Add at least one marker before applying marker-region fade outs.", "warning");
    return;
  }

  const sampleRate = state.audioBuffer.sampleRate;
  pushUndoSnapshot();
  for (const region of regions) {
    const regionStartFrame = Math.floor(region.start * sampleRate);
    const regionEndFrame = Math.ceil(region.end * sampleRate);
    const regionLength = Math.max(1, regionEndFrame - regionStartFrame);
    const fadeStartFrame = Math.min(
      regionEndFrame - 1,
      regionStartFrame + Math.floor(regionLength * 0.9),
    );
    const fadeLength = Math.max(1, regionEndFrame - fadeStartFrame);

    for (let channel = 0; channel < state.audioBuffer.numberOfChannels; channel += 1) {
      const channelData = state.audioBuffer.getChannelData(channel);
      for (let frame = fadeStartFrame; frame < regionEndFrame; frame += 1) {
        const progress = (frame - fadeStartFrame) / fadeLength;
        const gain = 1 - sCurveFadeGain(progress);
        channelData[frame] *= gain;
      }
    }
  }

  invalidateWaveformCache();
  if (state.isPlaying) {
    await syncPlaybackToActiveRange(state.playbackMode);
  }
  requestFullRender();
  setStatus(
    `Applied short fade outs to ${regions.length} marker region${regions.length === 1 ? "" : "s"}.`,
    "success",
  );
}

async function applyMarkerRegionNormalize() {
  if (!state.audioBuffer) {
    setStatus("The editor source is not ready yet.", "warning");
    return;
  }

  const regions = getCurrentDocumentMarkerRegions();
  if (regions.length < 2) {
    setStatus("Add at least one marker before normalizing marker regions.", "warning");
    return;
  }

  const sampleRate = state.audioBuffer.sampleRate;
  pushUndoSnapshot();
  for (const region of regions) {
    const regionStartFrame = Math.floor(region.start * sampleRate);
    const regionEndFrame = Math.ceil(region.end * sampleRate);
    if (regionEndFrame <= regionStartFrame) {
      continue;
    }

    let peak = 0;
    for (let channel = 0; channel < state.audioBuffer.numberOfChannels; channel += 1) {
      const channelData = state.audioBuffer.getChannelData(channel);
      for (let frame = regionStartFrame; frame < regionEndFrame; frame += 1) {
        const amplitude = Math.abs(channelData[frame]);
        if (amplitude > peak) {
          peak = amplitude;
        }
      }
    }

    if (peak <= 0) {
      continue;
    }

    const gain = 1 / peak;
    for (let channel = 0; channel < state.audioBuffer.numberOfChannels; channel += 1) {
      const channelData = state.audioBuffer.getChannelData(channel);
      for (let frame = regionStartFrame; frame < regionEndFrame; frame += 1) {
        channelData[frame] = clamp(channelData[frame] * gain, -1, 1);
      }
    }
  }

  invalidateWaveformCache();
  if (state.isPlaying) {
    await syncPlaybackToActiveRange(state.playbackMode);
  }
  requestFullRender();
  setStatus(
    `Normalized ${regions.length} marker region${regions.length === 1 ? "" : "s"} independently.`,
    "success",
  );
}

async function applyNormalize() {
  await applyEffectToSelection("Normalize", (startFrame, endFrame) => {
    let peak = 0;
    for (let channel = 0; channel < state.audioBuffer.numberOfChannels; channel++) {
      const channelData = state.audioBuffer.getChannelData(channel);
      for (let frame = startFrame; frame < endFrame; frame++) {
        const amplitude = Math.abs(channelData[frame]);
        if (amplitude > peak) {
          peak = amplitude;
        }
      }
    }

    if (peak <= 0) {
      return;
    }

    const gain = 1 / peak;
    for (let channel = 0; channel < state.audioBuffer.numberOfChannels; channel++) {
      const channelData = state.audioBuffer.getChannelData(channel);
      for (let frame = startFrame; frame < endFrame; frame++) {
        channelData[frame] = clamp(channelData[frame] * gain, -1, 1);
      }
    }
  });
}

async function promptStereoToMonoMode() {
  if (!elements.stereoToMonoModal || !window.bootstrap?.Modal) {
    const response = window.prompt(
      "Convert stereo to mono by typing left, right, or mix.",
      "mix",
    );
    if (response === null) {
      return null;
    }

    const normalized = response.trim().toLowerCase();
    if (normalized === "left" || normalized === "l") {
      return "left";
    }
    if (normalized === "right" || normalized === "r") {
      return "right";
    }
    if (normalized === "mix" || normalized === "m") {
      return "mix";
    }
    return "";
  }

  const modal = window.bootstrap.Modal.getOrCreateInstance(elements.stereoToMonoModal);
  return new Promise((resolve) => {
    let settled = false;
    let pendingValue = null;

    const cleanup = () => {
      elements.stereoToMonoModal.removeEventListener("click", handleClick);
      elements.stereoToMonoModal.removeEventListener("hidden.bs.modal", handleHidden);
    };

    const finish = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(value);
    };

    const handleClick = (event) => {
      const target = event.target;
      const button = target instanceof Element
        ? target.closest("button[data-mono-mode]")
        : null;
      if (!(button instanceof HTMLButtonElement)) {
        return;
      }
      pendingValue = button.dataset.monoMode || "";
      modal.hide();
    };

    const handleHidden = () => {
      finish(pendingValue);
    };

    elements.stereoToMonoModal.addEventListener("click", handleClick);
    elements.stereoToMonoModal.addEventListener("hidden.bs.modal", handleHidden);
    modal.show();
  });
}

function buildStereoToMonoBuffer(sourceBuffer, mode) {
  const monoBuffer = new AudioBuffer({
    length: sourceBuffer.length,
    numberOfChannels: 1,
    sampleRate: sourceBuffer.sampleRate,
  });
  const monoData = monoBuffer.getChannelData(0);
  const leftChannel = sourceBuffer.getChannelData(0);
  const rightChannel = sourceBuffer.getChannelData(1);

  if (mode === "left") {
    monoData.set(leftChannel);
    return monoBuffer;
  }

  if (mode === "right") {
    monoData.set(rightChannel);
    return monoBuffer;
  }

  for (let frame = 0; frame < sourceBuffer.length; frame += 1) {
    monoData[frame] = (leftChannel[frame] + rightChannel[frame]) * 0.5;
  }

  return monoBuffer;
}

async function convertChannelFormat() {
  if (!state.audioBuffer) {
    setStatus("The editor source is not ready yet.", "warning");
    return;
  }

  if (state.audioBuffer.numberOfChannels === 1) {
    const restartMode = state.isPlaying ? state.playbackMode : null;
    const currentTime = getCurrentPlaybackTime();
    pushUndoSnapshot();
    state.audioBuffer = remapAudioBufferChannels(state.audioBuffer, 2);
    syncActiveDocumentFromRuntimeState();
    invalidateWaveformCache();

    if (restartMode) {
      await restartPlaybackAtTime(currentTime, restartMode);
    } else {
      requestFullRender();
    }

    setStatus("Converted the file from mono to stereo.", "success");
    return;
  }

  if (state.audioBuffer.numberOfChannels === 2) {
    const mode = await promptStereoToMonoMode();
    if (mode === null) {
      return;
    }
    if (!mode) {
      setStatus("Choose left, right, or mix to convert stereo to mono.", "warning");
      return;
    }

    const restartMode = state.isPlaying ? state.playbackMode : null;
    const currentTime = getCurrentPlaybackTime();
    pushUndoSnapshot();
    state.audioBuffer = buildStereoToMonoBuffer(state.audioBuffer, mode);
    syncActiveDocumentFromRuntimeState();
    invalidateWaveformCache();

    if (restartMode) {
      await restartPlaybackAtTime(currentTime, restartMode);
    } else {
      requestFullRender();
    }

    setStatus(`Converted the file from stereo to mono using the ${mode} channel.`, "success");
    return;
  }

  setStatus("Channel conversion currently supports mono or stereo files only.", "warning");
}

async function applyReverse() {
  await applyEffectToSelection("Reverse", (startFrame, endFrame) => {
    for (let channel = 0; channel < state.audioBuffer.numberOfChannels; channel++) {
      const channelData = state.audioBuffer.getChannelData(channel);
      let left = startFrame;
      let right = endFrame - 1;
      while (left < right) {
        const tmp = channelData[left];
        channelData[left] = channelData[right];
        channelData[right] = tmp;
        left += 1;
        right -= 1;
      }
    }
  });
}

async function applyTrim() {
  const selection = getSelectionOrFullRange();
  if (!selection || !state.audioBuffer) {
    setStatus("The editor source is not ready yet.", "warning");
    return;
  }

  const restartMode = state.isPlaying ? state.playbackMode : null;
  const sampleRate = state.audioBuffer.sampleRate;
  const startFrame = Math.max(0, Math.floor(selection.start * sampleRate));
  const endFrame = Math.min(
    state.audioBuffer.length,
    Math.ceil(selection.end * sampleRate),
  );
  const trimmedLength = Math.max(1, endFrame - startFrame);
  if (trimmedLength <= 0) {
    setStatus("Selection is too short for trimming.", "warning");
    return;
  }
  if (selection.isFullFile) {
    setStatus("Trim on the whole file does not change the audio.", "secondary");
    return;
  }

  pushUndoSnapshot();
  stopPlayback(false);

  const trimmedBuffer = new AudioBuffer({
    length: trimmedLength,
    numberOfChannels: state.audioBuffer.numberOfChannels,
    sampleRate,
  });

  for (let channel = 0; channel < state.audioBuffer.numberOfChannels; channel++) {
    const sourceData = state.audioBuffer.getChannelData(channel);
    const trimmedData = new Float32Array(trimmedLength);
    trimmedData.set(sourceData.subarray(startFrame, endFrame));
    trimmedBuffer.copyToChannel(trimmedData, channel);
  }

  state.audioBuffer = trimmedBuffer;
  state.markers = remapMarkersForTrimmedSegment(
    state.markers,
    selection.start,
    selection.end,
  );
  syncMarkersToBufferDuration();
  state.pausedAt = 0;
  state.selectionStart = null;
  state.selectionEnd = null;
  state.viewStart = 0;
  state.viewDuration = trimmedBuffer.duration;
  state.playbackRangeStart = 0;
  state.playbackRangeEnd = trimmedBuffer.duration;
  invalidateWaveformCache();

  if (restartMode) {
    await playUsingActiveRange(restartMode);
  }

  requestFullRender();
  setStatus("Trim applied. Audio outside the selection was discarded.", "success");
}

function resetEdits() {
  if (!state.originalBuffer) {
    return;
  }
  const restartMode = state.isPlaying ? state.playbackMode : null;
  const currentTime = getCurrentPlaybackTime();
  pushUndoSnapshot();
  state.audioBuffer = cloneAudioBuffer(state.originalBuffer);
  state.pausedAt = 0;
  clearSelection();
  fitView();
  invalidateWaveformCache();
  if (restartMode) {
    void restartPlaybackAtTime(currentTime, restartMode);
  } else {
    stopPlayback(false);
  }
  setStatus("Edits reset to the original audio.", "secondary");
}

async function undoLastEdit() {
  if (state.undoStack.length === 0) {
    return;
  }

  const restartMode = state.isPlaying ? state.playbackMode : null;
  const currentTime = getCurrentPlaybackTime();
  const snapshot = state.undoStack.pop();

  restoreUndoSnapshot(snapshot);
  invalidateWaveformCache();
  state.pausedAt = clamp(currentTime, 0, getCurrentBufferDuration());

  if (restartMode) {
    await restartPlaybackAtTime(currentTime, restartMode);
  } else {
    stopPlayback(false);
    requestFullRender();
  }

  setStatus("Undid the last edit.", "secondary");
}

async function chooseSaveDirectory() {
  if (!elements.chooseFolderButton || !elements.saveDirectoryDisplay) {
    setStatus("This editor host does not include export controls.", "warning");
    return;
  }
  if (typeof window.showDirectoryPicker !== "function") {
    setStatus("This browser does not support folder picking for safe exports.", "warning");
    return;
  }

  try {
    state.directoryHandle = await window.showDirectoryPicker({
      mode: "readwrite",
    });
    elements.saveDirectoryDisplay.value = state.directoryHandle.name;
    updateTransportButtons();
    setStatus("Export folder selected. Existing files will never be overwritten.", "secondary");
  } catch (error) {
    if (error && error.name === "AbortError") {
      return;
    }
    setStatus(`Failed to choose a folder: ${error.message}`, "danger");
  }
}

function initializeEditorUI() {
  renderDocumentTabs();
  if (!elements.chooseFolderButton || !elements.saveCapabilityHint) {
    updateTransportButtons();
    return;
  }
  if (typeof window.showDirectoryPicker !== "function") {
    elements.chooseFolderButton.disabled = true;
    elements.saveCapabilityHint.textContent =
      "A Chromium-style browser is required for safe folder-based export.";
  } else {
    elements.chooseFolderButton.disabled = false;
    elements.saveCapabilityHint.textContent =
      "Pick a folder first. Existing files are never overwritten.";
  }
  updateTransportButtons();
}

function setSuggestedSaveFileName(fileName) {
  const nextSaveFileName = deriveSuggestedSaveFileName(fileName);
  state.saveFileName = nextSaveFileName;
  if (elements?.saveFileNameInput) {
    elements.saveFileNameInput.value = nextSaveFileName;
  }
}

function applyLoadedAudioBuffer(decodedBuffer, options = {}) {
  if (!(decodedBuffer instanceof AudioBuffer)) {
    throw new Error("A decoded AudioBuffer is required.");
  }

  stopPlayback(false);
  const activeDocument = getActiveDocument();
  const documentID = activeDocument?.id || state.activeDocumentID || 1;
  const loadedDocument = createLoadedDocumentFromAudioBuffer(documentID, decodedBuffer, options);
  const documentIndex = state.documents.findIndex((documentState) => documentState.id === documentID);
  if (documentIndex >= 0) {
    state.documents[documentIndex] = loadedDocument;
  } else {
    state.documents.push(loadedDocument);
  }
  state.activeDocumentID = loadedDocument.id;
  applyDocumentStateToRuntime(loadedDocument);
  invalidateWaveformCache();
  setSuggestedSaveFileName(options.suggestedFileName || options.fileName || "edited");
  requestFullRender();
  updateTransportButtons();
  renderDocumentTabs();
  emitDocumentStateEvents({ activeChanged: true });
}

async function loadAudioBufferIntoEditor(decodedBuffer, options = {}) {
  applyLoadedAudioBuffer(decodedBuffer, options);
  setStatus(
    options.readyMessage ||
      "Editor ready. Drag on the waveform to select audio, zoom the view, apply effects, and export a new WAV file.",
    "success",
  );
}

async function loadSourceArrayBufferIntoEditor(sourceArrayBuffer, options = {}) {
  if (!(sourceArrayBuffer instanceof ArrayBuffer)) {
    throw new Error("A source ArrayBuffer is required.");
  }
  setStatus(options.loadingMessage || "Decoding audio source...", "secondary");
  const context = getOrCreateAudioContext();
  const decodedBuffer = await context.decodeAudioData(sourceArrayBuffer.slice(0));
  await loadAudioBufferIntoEditor(decodedBuffer, options);
}

async function addAudioBufferAsDocument(decodedBuffer, options = {}) {
  if (!(decodedBuffer instanceof AudioBuffer)) {
    throw new Error("A decoded AudioBuffer is required.");
  }

  const documentID = state.nextDocumentID;
  state.nextDocumentID += 1;
  const nextDocument = createLoadedDocumentFromAudioBuffer(documentID, decodedBuffer, options);
  state.documents.push(nextDocument);

  if (options.activate === false) {
    renderDocumentTabs();
    emitDocumentStateEvents();
    return createDocumentSummary(nextDocument);
  }

  return switchActiveDocument(documentID, {
    statusMessage: options.readyMessage || "Document loaded.",
    statusLevel: "success",
  });
}

async function addSourceArrayBufferAsDocument(sourceArrayBuffer, options = {}) {
  if (!(sourceArrayBuffer instanceof ArrayBuffer)) {
    throw new Error("A source ArrayBuffer is required.");
  }
  setStatus(options.loadingMessage || "Decoding audio source...", "secondary");
  const context = getOrCreateAudioContext();
  const decodedBuffer = await context.decodeAudioData(sourceArrayBuffer.slice(0));
  return addAudioBufferAsDocument(decodedBuffer, options);
}

async function resampleAudioBuffer(sourceBuffer, targetSampleRate) {
  if (!(sourceBuffer instanceof AudioBuffer)) {
    throw new Error("A source AudioBuffer is required for resampling.");
  }
  if (sourceBuffer.sampleRate === targetSampleRate) {
    return sourceBuffer;
  }

  const frameCount = Math.max(1, Math.round(sourceBuffer.duration * targetSampleRate));
  const offlineContext = new OfflineAudioContext(
    sourceBuffer.numberOfChannels,
    frameCount,
    targetSampleRate,
  );
  const sourceNode = offlineContext.createBufferSource();
  sourceNode.buffer = sourceBuffer;
  sourceNode.connect(offlineContext.destination);
  sourceNode.start(0);
  return offlineContext.startRendering();
}

function remapAudioBufferChannels(sourceBuffer, targetChannelCount) {
  if (!(sourceBuffer instanceof AudioBuffer)) {
    throw new Error("A source AudioBuffer is required for channel remapping.");
  }
  const safeTargetChannelCount = Math.max(1, Math.floor(targetChannelCount));
  if (sourceBuffer.numberOfChannels === safeTargetChannelCount) {
    return sourceBuffer;
  }

  const remappedBuffer = new AudioBuffer({
    length: sourceBuffer.length,
    numberOfChannels: safeTargetChannelCount,
    sampleRate: sourceBuffer.sampleRate,
  });

  if (safeTargetChannelCount === 1) {
    const mixedChannel = remappedBuffer.getChannelData(0);
    for (let sourceChannel = 0; sourceChannel < sourceBuffer.numberOfChannels; sourceChannel += 1) {
      const sourceData = sourceBuffer.getChannelData(sourceChannel);
      for (let frame = 0; frame < sourceBuffer.length; frame += 1) {
        mixedChannel[frame] += sourceData[frame];
      }
    }
    const normalization = 1 / sourceBuffer.numberOfChannels;
    for (let frame = 0; frame < sourceBuffer.length; frame += 1) {
      mixedChannel[frame] *= normalization;
    }
    return remappedBuffer;
  }

  for (let targetChannel = 0; targetChannel < safeTargetChannelCount; targetChannel += 1) {
    const sourceChannel = sourceBuffer.numberOfChannels === 1
      ? 0
      : Math.min(targetChannel, sourceBuffer.numberOfChannels - 1);
    remappedBuffer.copyToChannel(
      sourceBuffer.getChannelData(sourceChannel),
      targetChannel,
    );
  }

  return remappedBuffer;
}

async function getClipboardBufferForCurrentDocument() {
  if (!state.audioBuffer || !state.clipboardBuffer) {
    return null;
  }

  let compatibleClipboard = state.clipboardBuffer;
  compatibleClipboard = await resampleAudioBuffer(
    compatibleClipboard,
    state.audioBuffer.sampleRate,
  );
  compatibleClipboard = remapAudioBufferChannels(
    compatibleClipboard,
    state.audioBuffer.numberOfChannels,
  );
  return compatibleClipboard;
}

function closeDocument(documentID = state.activeDocumentID, options = {}) {
  const targetDocumentID = Number(documentID);
  const documentIndex = state.documents.findIndex((documentState) => documentState.id === targetDocumentID);
  if (documentIndex < 0) {
    throw new Error(`Unknown document id: ${documentID}`);
  }

  let targetDocument = state.documents[documentIndex];
  const wasActive = targetDocument.id === state.activeDocumentID;
  if (wasActive) {
    targetDocument = syncActiveDocumentFromRuntimeState() || targetDocument;
  }
  const targetLabel = createDocumentSummary(targetDocument).label;
  if (
    isDocumentDirty(targetDocument) &&
    options.confirm !== false &&
    !window.confirm(`Close ${targetLabel}? Unsaved edits in this tab will be lost.`)
  ) {
    return createDocumentSummary(getActiveDocument());
  }

  if (state.documents.length === 1) {
    stopPlayback(false);
    const blankDocumentID = state.nextDocumentID;
    state.nextDocumentID += 1;
    const blankDocument = createEmptyEditorDocument(blankDocumentID);
    state.documents = [blankDocument];
    state.activeDocumentID = blankDocument.id;
    applyDocumentStateToRuntime(blankDocument);
    invalidateWaveformCache();
    requestFullRender();
    updateTransportButtons();
    renderDocumentTabs();
    emitDocumentStateEvents({ activeChanged: true });
    if (options.statusMessage !== false) {
      setStatus(`Closed ${targetLabel}.`, options.statusLevel || "secondary");
    }
    return createDocumentSummary(blankDocument);
  }

  if (wasActive) {
    stopPlayback(false);
    syncActiveDocumentFromRuntimeState();
  }
  state.documents.splice(documentIndex, 1);

  if (wasActive) {
    const nextDocument = state.documents[Math.max(0, documentIndex - 1)] || state.documents[0];
    state.activeDocumentID = nextDocument.id;
    applyDocumentStateToRuntime(nextDocument);
  }

  invalidateWaveformCache();
  requestFullRender();
  updateTransportButtons();
  renderDocumentTabs();
  emitDocumentStateEvents({ activeChanged: wasActive });

  if (options.statusMessage !== false) {
    setStatus(`Closed ${targetLabel}.`, options.statusLevel || "secondary");
  }

  return createDocumentSummary(getActiveDocument());
}

function switchActiveDocument(documentID, options = {}) {
  const nextDocumentID = Number(documentID);
  const nextDocument = state.documents.find((documentState) => documentState.id === nextDocumentID);
  if (!nextDocument) {
    throw new Error(`Unknown document id: ${documentID}`);
  }
  if (nextDocument.id === state.activeDocumentID) {
    return createDocumentSummary(nextDocument);
  }

  stopPlayback(true);
  syncActiveDocumentFromRuntimeState();
  state.activeDocumentID = nextDocument.id;
  applyDocumentStateToRuntime(nextDocument);
  state.isSelecting = false;
  state.dragSurface = null;
  requestFullRender();
  updateTransportButtons();
  renderDocumentTabs();
  emitDocumentStateEvents({ activeChanged: true });

  if (options.statusMessage) {
    setStatus(options.statusMessage, options.statusLevel || "secondary");
  }

  return createDocumentSummary(nextDocument);
}

async function renderBufferForExport(sourceBuffer, targetChannelCount, targetSampleRate) {
  const duration = sourceBuffer.duration;
  const frameCount = Math.max(1, Math.ceil(duration * targetSampleRate));
  const offlineContext = new OfflineAudioContext(
    targetChannelCount,
    frameCount,
    targetSampleRate,
  );
  const sourceNode = offlineContext.createBufferSource();
  sourceNode.buffer = sourceBuffer;
  sourceNode.connect(offlineContext.destination);
  sourceNode.start(0);
  return offlineContext.startRendering();
}

function applyMarkersFromAPI(markers = []) {
  if (!state.audioBuffer) {
    state.markers = [];
    state.nextMarkerID = 1;
    updateTransportButtons();
    requestOverlayRender();
    return;
  }

  const duration = getCurrentBufferDuration();
  state.markers = markers.map((marker, index) => ({
    id: Number.isInteger(marker?.id) ? marker.id : index + 1,
    time: clamp(Number(marker?.time) || 0, 0, duration),
  }));
  state.nextMarkerID =
    state.markers.reduce((maxID, marker) => Math.max(maxID, marker.id), 0) + 1;
  syncMarkersToBufferDuration();
  updateTransportButtons();
  requestOverlayRender();
}

async function exportEditedWAV(options = {}) {
  if (!state.audioBuffer) {
    throw new Error("The editor source is not ready yet.");
  }

  const channelCount = Number(options.channels) === 1 ? 1 : 2;
  const sampleRate = Number(options.sampleRate) === 44100 ? 44100 : 48000;
  const bitDepth = Number(options.bitDepth) === 24 ? 24 : 16;
  const sampleLoops = Array.isArray(options.sampleLoops) ? options.sampleLoops : [];
  const renderedBuffer = await renderBufferForExport(state.audioBuffer, channelCount, sampleRate);
  return encodeAudioBufferAsWAV(renderedBuffer, { bitDepth, sampleLoops });
}

async function exportRegionWAV(startTime, endTime, options = {}) {
  if (!state.audioBuffer) {
    throw new Error("The editor source is not ready yet.");
  }

  const safeStart = clamp(Number(startTime) || 0, 0, getCurrentBufferDuration());
  const safeEnd = clamp(Number(endTime) || 0, safeStart, getCurrentBufferDuration());
  if (safeEnd - safeStart <= 0) {
    throw new Error("Region is too short for export.");
  }

  const startFrame = Math.floor(safeStart * state.audioBuffer.sampleRate);
  const endFrame = Math.ceil(safeEnd * state.audioBuffer.sampleRate);
  const regionBuffer = extractAudioBufferSegment(state.audioBuffer, startFrame, endFrame);
  const channelCount = Number(options.channels) === 1 ? 1 : 2;
  const sampleRate = Number(options.sampleRate) === 44100 ? 44100 : 48000;
  const bitDepth = Number(options.bitDepth) === 24 ? 24 : 16;
  const renderedBuffer = await renderBufferForExport(regionBuffer, channelCount, sampleRate);
  return encodeAudioBufferAsWAV(renderedBuffer, { bitDepth });
}

function renderAudioBufferAsImageCanvas(audioBuffer, options = {}) {
  const width = Math.max(1, Math.floor(Number(options.width) || 1024));
  const maxHeight = Math.max(1, Math.floor(Number(options.maxHeight) || 4096));
  const channelCount = Math.max(1, audioBuffer.numberOfChannels);
  const sampleStep = Math.max(
    1,
    Math.ceil((audioBuffer.length * channelCount) / (width * maxHeight)),
  );
  const rowsPerChannel = Math.max(1, Math.ceil(audioBuffer.length / (width * sampleStep)));
  const height = rowsPerChannel * channelCount;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas export is not available in this browser.");
  }

  const imageData = context.createImageData(width, height);
  const pixels = imageData.data;
  for (let channel = 0; channel < channelCount; channel += 1) {
    const channelData = audioBuffer.getChannelData(channel);
    const rowOffset = channel * rowsPerChannel;
    for (let row = 0; row < rowsPerChannel; row += 1) {
      for (let x = 0; x < width; x += 1) {
        const startFrame = (row * width + x) * sampleStep;
        let sampleSum = 0;
        let sampleCount = 0;
        for (
          let frame = startFrame;
          frame < Math.min(channelData.length, startFrame + sampleStep);
          frame += 1
        ) {
          sampleSum += channelData[frame];
          sampleCount += 1;
        }

        const sample = sampleCount > 0 ? sampleSum / sampleCount : 0;
        const value = Math.round(clamp((sample + 1) / 2, 0, 1) * 255);
        const pixelOffset = ((rowOffset + row) * width + x) * 4;
        pixels[pixelOffset] = value;
        pixels[pixelOffset + 1] = value;
        pixels[pixelOffset + 2] = value;
        pixels[pixelOffset + 3] = 255;
      }
    }
  }

  context.putImageData(imageData, 0, 0);
  return canvas;
}

function canvasToPNGBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error("Could not encode the waveform image."));
    }, "image/png");
  });
}

async function exportImagePNG(options = {}) {
  if (!state.audioBuffer) {
    throw new Error("The editor source is not ready yet.");
  }

  const canvas = renderAudioBufferAsImageCanvas(state.audioBuffer, options);
  return canvasToPNGBlob(canvas);
}

async function saveEditedAudio() {
  if (
    !elements.saveFileNameInput ||
    !elements.exportChannelsSelect ||
    !elements.exportSampleRateSelect
  ) {
    setStatus("This editor host does not include export controls.", "warning");
    return;
  }
  if (!state.audioBuffer) {
    setStatus("The editor source is not ready yet.", "warning");
    return;
  }
  if (!state.directoryHandle) {
    setStatus("Choose an export folder before saving.", "warning");
    return;
  }

  let fileName = elements.saveFileNameInput.value.trim();
  if (!fileName) {
    setStatus("Enter a file name for the exported WAV.", "warning");
    return;
  }
  if (fileName.includes("/") || fileName.includes("\\")) {
    setStatus("The file name must not include path separators. Choose the folder separately.", "warning");
    return;
  }
  if (!fileName.toLowerCase().endsWith(".wav")) {
    fileName += ".wav";
  }

  try {
    await state.directoryHandle.getFileHandle(fileName, {
      create: false,
    });
    setStatus("Refusing to overwrite an existing file. Choose a new file name.", "warning");
    return;
  } catch (error) {
    if (!error || error.name !== "NotFoundError") {
      setStatus(`Could not verify the export path: ${error.message}`, "danger");
      return;
    }
  }

  const channelCount = Number(elements.exportChannelsSelect.value) === 1 ? 1 : 2;
  const sampleRate =
    Number(elements.exportSampleRateSelect.value) === 44100 ? 44100 : 48000;

  try {
    setStatus("Rendering edited WAV...", "secondary");
    const wavData = await exportEditedWAV({
      channels: channelCount,
      sampleRate,
    });
    const fileHandle = await state.directoryHandle.getFileHandle(fileName, {
      create: true,
    });
    const writable = await fileHandle.createWritable({
      keepExistingData: false,
    });
    await writable.write(wavData);
    await writable.close();
    setStatus(`Saved ${fileName} without overwriting any existing file.`, "success");
  } catch (error) {
    setStatus(`Save failed: ${error.message}`, "danger");
  }
}

function attachWaveformInteractions(controller) {
  elements.waveformOverlay.addEventListener("mousemove", controller.wrap((event) => {
    updateWaveformOverlayCursor(event);
  }));

  elements.waveformOverlay.addEventListener("mouseleave", controller.wrap(() => {
    updateWaveformOverlayCursor();
  }));

  elements.waveformOverlay.addEventListener("mousedown", controller.wrap((event) => {
    if (!state.audioBuffer) {
      return;
    }

    const markerHit = getMarkerHandleHit(event);
    if (markerHit) {
      state.dragSurface = "main";
      state.dragMode = "marker-move";
      state.draggedMarkerID = markerHit.id;
      updateWaveformOverlayCursor();
      requestOverlayRender();
      return;
    }

    state.dragPlaybackMode = state.isPlaying ? state.playbackMode : null;

    const handleHit = getSelectionHandleHit(event);
    if (handleHit) {
      state.isSelecting = true;
      state.dragSurface = "main";
      state.dragMode = handleHit;
      updateWaveformOverlayCursor();
      startRenderLoop();
      requestOverlayRender();
      return;
    }

    state.isSelecting = true;
    state.dragSurface = "main";
    state.dragMode = "selection-new";
    state.selectionAnchor = timeFromPointerEvent(event);
    state.selectionStart = state.selectionAnchor;
    state.selectionEnd = state.selectionAnchor;
    startRenderLoop();
    requestOverlayRender();
  }));

  elements.waveformOverlay.addEventListener("dblclick", controller.wrap((event) => {
    if (!state.audioBuffer) {
      return;
    }
    const markerHit = getMarkerHandleHit(event);
    if (markerHit) {
      removeMarker(markerHit.id);
      return;
    }

    const boundedSelection = getMarkerBoundedSelectionAtTime(timeFromPointerEvent(event));
    if (!boundedSelection) {
      return;
    }

    updateSelection(boundedSelection.start, boundedSelection.end, {
      snapToZeroCrossing: false,
    });
    ensureSelectionVisible(getSortedSelection());
    if (state.isPlaying) {
      void syncPlaybackToActiveRange();
    } else {
      requestOverlayRender();
    }
  }));

  elements.overviewWaveformOverlay.addEventListener("mousedown", controller.wrap((event) => {
    if (!state.audioBuffer) {
      return;
    }

    state.dragPlaybackMode = state.isPlaying ? state.playbackMode : null;
    state.isSelecting = true;
    state.dragSurface = "overview";
    state.dragMode = "selection-new";
    state.selectionAnchor = timeFromOverviewPointerEvent(event);
    state.selectionStart = state.selectionAnchor;
    state.selectionEnd = state.selectionAnchor;
    startRenderLoop();
    requestOverlayRender();
  }));

  window.addEventListener("mousemove", controller.wrap((event) => {
    if (state.draggedMarkerID !== null) {
      updateWaveformOverlayCursor();
      updateMarkerTime(state.draggedMarkerID, timeFromPointerEvent(event));
      return;
    }
    if (!state.isSelecting) {
      return;
    }
    if (state.dragSurface === "overview") {
      updateSelection(state.selectionAnchor, timeFromOverviewPointerEvent(event));
      return;
    }
    const time = timeFromPointerEvent(event);
    if (state.dragMode === "handle-start") {
      updateWaveformOverlayCursor();
      const selection = getSortedSelection();
      if (selection) {
        updateSelection(time, selection.end);
      }
      return;
    }
    if (state.dragMode === "handle-end") {
      updateWaveformOverlayCursor();
      const selection = getSortedSelection();
      if (selection) {
        updateSelection(selection.start, time);
      }
      return;
    }
    updateSelection(state.selectionAnchor, time);
  }));

  window.addEventListener("mouseup", controller.wrap(async (event) => {
    if (state.draggedMarkerID !== null) {
      updateMarkerTime(state.draggedMarkerID, timeFromPointerEvent(event));
      state.draggedMarkerID = null;
      state.dragMode = null;
      state.dragSurface = null;
      updateWaveformOverlayCursor(event);
      requestOverlayRender();
      return;
    }

    if (!state.isSelecting) {
      return;
    }

    const playbackModeBeforeSelectionDrag = state.dragPlaybackMode;
    const dragSurfaceBeforeSelectionDrag = state.dragSurface;
    const wasNewSelection = state.dragMode === "selection-new";
    state.isSelecting = false;
    stopRenderLoop();
    if (state.dragSurface === "overview") {
      updateSelection(state.selectionAnchor, timeFromOverviewPointerEvent(event));
    } else if (state.dragMode === "handle-start") {
      const selection = getSortedSelection();
      if (selection) {
        updateSelection(timeFromPointerEvent(event), selection.end);
      }
    } else if (state.dragMode === "handle-end") {
      const selection = getSortedSelection();
      if (selection) {
        updateSelection(selection.start, timeFromPointerEvent(event));
      }
    } else {
      updateSelection(state.selectionAnchor, timeFromPointerEvent(event));
    }
    state.dragMode = null;
    state.dragSurface = null;
    state.dragPlaybackMode = null;
    const selection = getSortedSelection();
    if (!selection) {
      clearSelection();
      if (playbackModeBeforeSelectionDrag) {
        await syncPlaybackToActiveRange(playbackModeBeforeSelectionDrag);
      }
      if (wasNewSelection) {
        await seekTo(state.selectionAnchor);
      }
      return;
    }
    if (dragSurfaceBeforeSelectionDrag === "overview") {
      const paddedDuration = Math.max(
        selection.duration * 1.25,
        getMinimumViewDuration(),
      );
      setViewWindow(
        selection.start - (paddedDuration - selection.duration) / 2,
        paddedDuration,
      );
    } else {
      ensureSelectionVisible(selection);
    }
    if (playbackModeBeforeSelectionDrag) {
      await syncPlaybackToActiveRange(playbackModeBeforeSelectionDrag);
    }
    requestOverlayRender();
  }));
}

function handleEditorKeyDown(event) {
  const target = event.target;
  const isEditableTarget =
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable);

  if (isEditableTarget) {
    return;
  }

  if (event.repeat) {
    return;
  }

  const isPrimaryModifier = event.ctrlKey || event.metaKey;

  if (isPrimaryModifier && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "a") {
    event.preventDefault();
    selectAll();
    void syncPlaybackToActiveRange();
    return;
  }

  if (isPrimaryModifier && !event.shiftKey && !event.altKey) {
    switch (event.key.toLowerCase()) {
      case "c":
        event.preventDefault();
        void copySelectionToClipboard();
        return;
      case "x":
        event.preventDefault();
        void cutSelectionToClipboard();
        return;
      case "v":
        event.preventDefault();
        void pasteClipboard();
        return;
      case "z":
        event.preventDefault();
        void undoLastEdit();
        return;
      case "t":
        event.preventDefault();
        void applyTrim();
        return;
      default:
        break;
    }
  }

  if (event.metaKey || event.ctrlKey || event.altKey) {
    return;
  }

  switch (event.key) {
    case "=":
    case "+":
      event.preventDefault();
      zoomIn();
      break;
    case "-":
      event.preventDefault();
      zoomOut();
      break;
    case "ArrowLeft":
      event.preventDefault();
      void nudgeSelectionLeft();
      break;
    case "ArrowRight":
      event.preventDefault();
      void nudgeSelectionRight();
      break;
    case "ArrowUp":
      event.preventDefault();
      void doubleSelection();
      break;
    case "ArrowDown":
      event.preventDefault();
      void halveSelection();
      break;
    case " ":
    case "Spacebar":
      event.preventDefault();
      void togglePlayPause();
      break;
    case "n":
    case "N":
      event.preventDefault();
      void applyNormalize();
      break;
    case "i":
    case "I":
      event.preventDefault();
      void applyFadeIn();
      break;
    case "o":
    case "O":
      event.preventDefault();
      void applyFadeOut();
      break;
    case "r":
    case "R":
      event.preventDefault();
      void applyReverse();
      break;
    case "z":
    case "Z":
      event.preventDefault();
      zoomToSelection();
      break;
    case "m":
    case "M":
      event.preventDefault();
      if (getSortedSelection()) {
        addMarkersAtSelectionBoundaries();
      } else {
        addMarkerAtPlayhead();
      }
      break;
    default:
      break;
  }
}

function attachUIActions(controller) {
  if (elements.documentTabs) {
    elements.documentTabs.addEventListener("click", controller.wrap((event) => {
      const target = event.target;
      const closeButton = target instanceof Element
        ? target.closest("button[data-document-close]")
        : null;
      if (closeButton instanceof HTMLButtonElement) {
        event.stopPropagation();
        void closeDocument(Number(closeButton.dataset.documentClose));
        return;
      }
      const button = target instanceof Element
        ? target.closest("button[data-document-id]")
        : null;
      if (!(button instanceof HTMLButtonElement)) {
        return;
      }
      void switchActiveDocument(Number(button.dataset.documentId));
    }));
  }
  elements.playPauseButton.addEventListener("click", controller.wrap(() => {
    void togglePlayPause();
  }));
  elements.loopToggleButton.addEventListener("click", controller.wrap(() => {
    void toggleLoopEnabled();
  }));
  elements.resetPlayheadButton.addEventListener("click", controller.wrap(() => {
    void resetPlayheadToRangeStart();
  }));
  elements.movePlayheadToEndButton.addEventListener("click", controller.wrap(movePlayheadToFileEnd));
  elements.undoButton.addEventListener("click", controller.wrap(() => {
    void undoLastEdit();
  }));
  elements.resetButton.addEventListener("click", controller.wrap(resetEdits));
  elements.zoomInButton.addEventListener("click", controller.wrap(zoomIn));
  elements.zoomOutButton.addEventListener("click", controller.wrap(zoomOut));
  elements.zoomSelectionButton.addEventListener("click", controller.wrap(zoomToSelection));
  elements.halfSelectionButton.addEventListener("click", controller.wrap(() => {
    void halveSelection();
  }));
  elements.doubleSelectionButton.addEventListener("click", controller.wrap(() => {
    void doubleSelection();
  }));
  elements.nudgeSelectionLeftButton.addEventListener("click", controller.wrap(() => {
    void nudgeSelectionLeft();
  }));
  elements.nudgeSelectionRightButton.addEventListener("click", controller.wrap(() => {
    void nudgeSelectionRight();
  }));
  elements.fitButton.addEventListener("click", controller.wrap(fitView));
  elements.zeroCrossingToggleButton.addEventListener("click", controller.wrap(toggleZeroCrossingSelection));
  elements.addMarkerButton.addEventListener("click", controller.wrap(addMarkerAtPlayhead));
  elements.addSelectionMarkersButton.addEventListener("click", controller.wrap(addMarkersAtSelectionBoundaries));
  elements.addGridMarkersButton.addEventListener("click", controller.wrap(addEvenlySpacedMarkers));
  elements.shuffleSlicesButton.addEventListener("click", controller.wrap(() => {
    void shuffleGridSlices();
  }));
  elements.rotateSlicesLeftButton.addEventListener("click", controller.wrap(() => {
    void rotateGridSlicesLeft();
  }));
  elements.rotateSlicesRightButton.addEventListener("click", controller.wrap(() => {
    void rotateGridSlicesRight();
  }));
  elements.clearMarkersButton.addEventListener("click", controller.wrap(clearAllMarkers));
  elements.cutButton.addEventListener("click", controller.wrap(() => {
    void cutSelectionToClipboard();
  }));
  elements.copyButton.addEventListener("click", controller.wrap(() => {
    void copySelectionToClipboard();
  }));
  elements.pasteButton.addEventListener("click", controller.wrap(() => {
    void pasteClipboard();
  }));
  elements.fadeInButton.addEventListener("click", controller.wrap(() => {
    void applyFadeIn();
  }));
  elements.fadeOutButton.addEventListener("click", controller.wrap(() => {
    void applyFadeOut();
  }));
  elements.crossfadeLoopButton.addEventListener("click", controller.wrap(() => {
    void applyCrossfadeLoop();
  }));
  elements.markerRegionFadeOutButton.addEventListener("click", controller.wrap(() => {
    void applyMarkerRegionFadeOut();
  }));
  elements.markerRegionNormalizeButton.addEventListener("click", controller.wrap(() => {
    void applyMarkerRegionNormalize();
  }));
  elements.normalizeButton.addEventListener("click", controller.wrap(() => {
    void applyNormalize();
  }));
  elements.channelConvertButton.addEventListener("click", controller.wrap(() => {
    void convertChannelFormat();
  }));
  elements.reverseButton.addEventListener("click", controller.wrap(() => {
    void applyReverse();
  }));
  elements.trimButton.addEventListener("click", controller.wrap(() => {
    void applyTrim();
  }));
  elements.selectAllButton.addEventListener("click", controller.wrap(() => {
    selectAll();
    void syncPlaybackToActiveRange();
  }));
  elements.clearSelectionButton.addEventListener("click", controller.wrap(() => {
    clearSelection();
    void syncPlaybackToActiveRange();
  }));
  if (elements.chooseFolderButton) {
    elements.chooseFolderButton.addEventListener("click", controller.wrap(() => {
      void chooseSaveDirectory();
    }));
  }
  if (elements.saveButton) {
    elements.saveButton.addEventListener("click", controller.wrap(() => {
      void saveEditedAudio();
    }));
  }
  window.addEventListener("resize", controller.wrap(requestFullRender));
  window.addEventListener("keydown", (event) => {
    if (!controller.shouldHandleKeyEvent(event)) {
      return;
    }
    controller.run(handleEditorKeyDown, event);
  });
}
