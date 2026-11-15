import createTapageModule from './tapage.mjs';

// Parameter indices must match the ParamIndex enum in web/tapage_web.cpp.
const PARAM = Object.freeze({
  color: 0,
  shape: 1,
  sweep: 2,
  contour: 3,
  pitch: 4,
  fine: 5,
  decay: 6,
  drive: 7,
  wavefold: 8,
  punch: 9,
  gate: 10,
  mono: 11,
  lfoSpeed: 12,
  lfoMultiplier: 13,
  lfoFade: 14,
  lfoWave: 15,
  lfoDestination: 16,
  lfoDepth: 17,
  lfoReset: 18,
  lfoStartPhase: 19,
  velocityDestination: 20,
  velocityDepth: 21,
  outputChain: 22,
});

const DEFAULTS = Object.freeze({
  color: 10,
  shape: 16,
  sweep: 16,
  contour: 24,
  pitch: 0,
  fine: 0,
  decay: 40,
  drive: 0,
  wavefold: 0,
  punch: 0,
  gate: 0,
  mono: 0,
  lfoSpeed: 32,
  lfoMultiplier: 0,
  lfoFade: 0,
  lfoWave: 0,
  lfoDestination: 0,
  lfoDepth: 0,
  lfoReset: 0,
  lfoStartPhase: 0,
  velocityDestination: 0,
  velocityDepth: 0,
  outputChain: 0,
});

const state = { ...DEFAULTS };

const KNOB_DEFS = [
  { id: 'color', label: 'TIMBRE', min: 0, max: 127, group: 'voice' },
  { id: 'shape', label: 'STRUCTURE', min: 0, max: 127, group: 'voice' },
  { id: 'sweep', label: 'PITCH ENV', min: 0, max: 127, group: 'voice' },
  { id: 'contour', label: 'RESPONSE', min: 0, max: 127, group: 'voice' },
  { id: 'pitch', label: 'PITCH', min: -24, max: 24, group: 'voice', format: 'pitch' },
  { id: 'decay', label: 'DECAY', min: 0, max: 127, group: 'voice' },
  { id: 'drive', label: 'DRIVE', min: 0, max: 127, group: 'voice' },
  { id: 'wavefold', label: 'FOLD', min: 0, max: 127, group: 'voice' },
  { id: 'lfoSpeed', label: 'SPEED', min: -64, max: 63, group: 'mod', format: 'bipolar' },
  { id: 'lfoFade', label: 'FADE', min: -64, max: 63, group: 'mod', format: 'bipolar' },
  { id: 'lfoStartPhase', label: 'START PHASE', min: 0, max: 127, group: 'mod' },
  { id: 'lfoDepth', label: 'DEPTH', min: -64, max: 63, group: 'mod', format: 'bipolar' },
  { id: 'velocityDepth', label: 'VEL', min: 0, max: 127, group: 'mod' },
];

const LFO_MULTIPLIERS = [
  'X1', 'X2', 'X4', 'X8', 'X16', 'X32', 'X64', 'X128', 'X256', 'X512', 'X1K', 'X2K',
  '1', '2', '4', '8', '16', '32', '64', '128', '256', '512', '1K', '2K',
];

const LFO_WAVES = ['TRI', 'SINE', 'SQR', 'SAW', 'ENV', 'RAMP', 'RND'];

const LFO_DESTINATIONS = [
  'NONE', 'PITCH', 'FINE', 'DECAY', 'TIMBRE', 'STRUCT', 'PITCH ENV',
  'RESP', 'PUNCH', 'GATE', 'VOLUME', 'DRIVE', 'FOLD',
];

const VELOCITY_DESTINATIONS = [
  'NONE', 'TIMBRE', 'STRUCT', 'PITCH ENV', 'RESP', 'PITCH', 'FINE', 'DECAY',
  'VOLUME', 'PUNCH', 'GATE', 'LFO SPEED', 'LFO FADE', 'LFO DEPTH',
  'LFO START PHASE', 'DRIVE', 'FOLD',
];

const RANDOM_RANGES = {
  color: [0, 127],
  shape: [0, 127],
  sweep: [0, 127],
  contour: [0, 127],
  drive: [0, 127],
  wavefold: [0, 32], // the editor keeps randomized folding subtle
  punch: [0, 1],
  gate: [0, 1],
  lfoSpeed: [-64, 63],
  lfoFade: [-64, 63],
  lfoDepth: [-64, 63],
  lfoStartPhase: [0, 127],
  lfoMultiplier: [0, 23],
  lfoWave: [0, 6],
  lfoDestination: [0, 12],
  velocityDestination: [0, 16],
  velocityDepth: [0, 127],
};

const SVG_NS = 'http://www.w3.org/2000/svg';
const KNOB_START = -135;
const KNOB_END = 135;
const EXPORT_SAMPLE_RATE = 48000;
const EXPORT_PEAK_CEILING = Math.pow(10, -0.3 / 20); // -0.3 dBFS, the limiter ceiling
const NOTE_MIN = 24;    // C1
const NOTE_MAX = 96;    // C7
const NOTE_DEFAULT = 55; // G3
const VELOCITY_DEFAULT = 127;

const knobs = new Map();
const controls = new Map();

const dom = {
  voiceKnobs: document.getElementById('voiceKnobs'),
  modKnobs: document.getElementById('modKnobs'),
  modControls: document.getElementById('modControls'),
  noteKnobHost: document.getElementById('noteKnobHost'),
  velocityKnobHost: document.getElementById('velocityKnobHost'),
  performanceTempo: document.getElementById('performanceTempo'),
  performanceActions: document.getElementById('performanceActions'),
  perfButtons: document.getElementById('perfButtons'),
  power: document.getElementById('power'),
  audioLed: document.getElementById('audioLed'),
  audioStatus: document.getElementById('audioStatus'),
  footStatus: document.getElementById('footStatus'),
  scopeStatus: document.getElementById('scopeStatus'),
  monitor: document.getElementById('monitor'),
  monitorValue: document.getElementById('monitorValue'),
  presetSelect: document.getElementById('presetSelect'),
  presetPrev: document.getElementById('presetPrev'),
  presetNext: document.getElementById('presetNext'),
  presetMeta: document.getElementById('presetMeta'),
  preview: null,
  exportWav: null,
};

const canvas = document.getElementById('scope');
const context2d = canvas.getContext('2d');

let scopeSamples = new Float32Array(0);
let scopeWidth = 0;
let scopeHeight = 0;
let livePeak = 0;

let wasm = null;
let engine = 0;
let wasmReady = false;
let bootError = null;
let sampleRate = 48000;
let bpm = 120;

let audioContext = null;
let processorNode = null;
let audioRunning = false;
let startingAudio = null;
let monitorTarget = 0.72;
let monitorGain = 0.72;

let previewTimer = 0;
let previewNoteTimer = 0;
let previewLoopTimer = 0;
let previewHeldNote = null;
let previewLooping = false;
let exportingWav = false;
let selectedNote = NOTE_DEFAULT;
let selectedVelocity = VELOCITY_DEFAULT;

let factoryPresets = [];
let presetIndex = 0;

const ready = boot();
loadPresetBank();

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function formatValue(value, format) {
  const rounded = Math.round(value);

  if (format === 'pitch') {
    return (rounded >= 0 ? '+' : '-') + String(Math.abs(rounded)).padStart(2, '0');
  }

  if (format === 'bipolar') {
    return rounded < 0 ? '-' + String(-rounded).padStart(2, '0') : String(rounded).padStart(3, '0');
  }

  return String(rounded).padStart(3, '0');
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function midiNoteName(note) {
  return `${NOTE_NAMES[note % 12]}${Math.floor(note / 12) - 1}`;
}

function polar(cx, cy, radius, degrees) {
  const radians = ((degrees - 90) * Math.PI) / 180;
  return [cx + radius * Math.cos(radians), cy + radius * Math.sin(radians)];
}

function arcPath(cx, cy, radius, startAngle, endAngle) {
  const [x0, y0] = polar(cx, cy, radius, startAngle);
  const [x1, y1] = polar(cx, cy, radius, endAngle);
  const largeArc = Math.abs(endAngle - startAngle) > 180 ? 1 : 0;
  return `M ${x0.toFixed(3)} ${y0.toFixed(3)} A ${radius} ${radius} 0 ${largeArc} 1 ${x1.toFixed(3)} ${y1.toFixed(3)}`;
}

function setStatus(text, mode = '') {
  dom.audioStatus.textContent = text;
  dom.audioLed.classList.toggle('on', mode === 'on');
  dom.audioLed.classList.toggle('error', mode === 'error');
}

function setFoot(text, isError = false) {
  dom.footStatus.textContent = text;
  dom.footStatus.classList.toggle('error', isError);
}

// ---------------------------------------------------------------------------
// Knobs
// ---------------------------------------------------------------------------

function createKnob(def, options = {}) {
  const domId = `${def.id}Knob`;
  const defaultValue = options.defaultValue ?? DEFAULTS[def.id] ?? def.min;
  const formatText = options.formatValue ?? ((value) => formatValue(value, def.format));
  const handleChange = options.onChange ?? ((value) => setParam(def.id, value));
  const element = document.createElement('div');
  element.className = 'knob';
  element.id = domId;
  element.tabIndex = 0;
  element.setAttribute('role', 'slider');
  element.setAttribute('aria-label', `${def.label} knob`);
  element.setAttribute('aria-valuemin', String(def.min));
  element.setAttribute('aria-valuemax', String(def.max));
  element.setAttribute('aria-valuenow', String(defaultValue));

  let ticks = '';

  for (let i = 0; i <= 10; i += 1) {
    const angle = KNOB_START + ((KNOB_END - KNOB_START) * i) / 10;
    const [x1, y1] = polar(50, 50, 44.5, angle);
    const [x2, y2] = polar(50, 50, 48.5, angle);
    ticks += `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"/>`;
  }

  element.innerHTML = `
    <div class="knob-face">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <g class="knob-ticks">${ticks}</g>
        <path class="knob-track" d="${arcPath(50, 50, 40, KNOB_START, KNOB_END)}"/>
        <path class="knob-active" d=""/>
        <circle class="knob-ring" cx="50" cy="50" r="34"/>
        <circle class="knob-body" cx="50" cy="50" r="28"/>
        <circle class="knob-inner" cx="50" cy="50" r="22"/>
        <g class="knob-pointer-group">
          <line class="knob-pointer" x1="50" y1="21" x2="50" y2="37"/>
        </g>
      </svg>
    </div>
    <div class="knob-label">${def.label}</div>
    <output class="knob-value"></output>
  `;

  const activeArc = element.querySelector('.knob-active');
  const pointerGroup = element.querySelector('.knob-pointer-group');
  const valueOutput = element.querySelector('.knob-value');
  let value = defaultValue;
  let drag = null;

  const render = () => {
    const ratio = def.max === def.min ? 0 : (value - def.min) / (def.max - def.min);
    const angle = KNOB_START + ratio * (KNOB_END - KNOB_START);

    activeArc.setAttribute('d', ratio > 0.0005 ? arcPath(50, 50, 40, KNOB_START, angle) : '');
    pointerGroup.setAttribute('transform', `rotate(${angle.toFixed(2)} 50 50)`);
    valueOutput.textContent = formatText(value);
    element.setAttribute('aria-valuenow', String(value));
    element.setAttribute('aria-valuetext', formatText(value));
  };

  const setValue = (next, emit = false) => {
    const clamped = clamp(Math.round(next), def.min, def.max);

    if (clamped === value && !emit) {
      render();
      return;
    }

    value = clamped;
    render();

    if (emit) {
      handleChange(value);
    }
  };

  const finishDrag = () => {
    drag = null;
    element.classList.remove('dragging');
  };

  element.addEventListener('pointerdown', (event) => {
    if (event.button !== undefined && event.button !== 0) {
      return;
    }

    event.preventDefault();
    element.setPointerCapture(event.pointerId);
    drag = { pointerId: event.pointerId, y: event.clientY, value };
    element.classList.add('dragging');
  });

  element.addEventListener('pointermove', (event) => {
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const pixelsForFullRange = event.shiftKey ? 720 : 180;
    const range = def.max - def.min;
    const next = drag.value + ((drag.y - event.clientY) * range) / pixelsForFullRange;
    setValue(next, true);
  });

  element.addEventListener('pointerup', finishDrag);
  element.addEventListener('pointercancel', finishDrag);
  element.addEventListener('lostpointercapture', finishDrag);

  element.addEventListener('dblclick', () => {
    setValue(defaultValue, true);
  });

  element.addEventListener('wheel', (event) => {
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    setValue(value - Math.sign(event.deltaY) * step, true);
  }, { passive: false });

  element.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 10 : 1;
    let next = null;

    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        next = value + step;
        break;
      case 'ArrowDown':
      case 'ArrowLeft':
        next = value - step;
        break;
      case 'PageUp':
        next = value + 10;
        break;
      case 'PageDown':
        next = value - 10;
        break;
      case 'Home':
        next = def.min;
        break;
      case 'End':
        next = def.max;
        break;
      default:
        return;
    }

    event.preventDefault();
    setValue(next, true);
  });

  render();
  return { element, setValue };
}

function buildKnobs() {
  for (const def of KNOB_DEFS) {
    const knob = createKnob(def);
    knobs.set(def.id, knob);
    const container = def.group === 'mod' ? dom.modKnobs : dom.voiceKnobs;
    container.append(knob.element);
  }
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function createSelect(id, label, options) {
  const wrapper = document.createElement('label');
  wrapper.className = 'control';

  const caption = document.createElement('span');
  caption.className = 'control-label';
  caption.textContent = label;

  const select = document.createElement('select');
  select.setAttribute('aria-label', label);

  options.forEach((option, index) => {
    const item = document.createElement('option');
    item.value = String(index);
    item.textContent = option;
    select.append(item);
  });

  select.value = String(state[id]);
  select.addEventListener('change', () => setParam(id, Number(select.value)));

  wrapper.append(caption, select);
  dom.modControls.append(wrapper);

  return {
    element: wrapper,
    setValue(value) {
      select.value = String(value);
    },
  };
}

function createToggle(id, label, title) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'toggle';
  button.textContent = label;

  if (title) {
    button.title = title;
  }

  button.addEventListener('click', () => setParam(id, state[id] ? 0 : 1));

  const setValue = (value) => {
    const on = Boolean(value);
    button.classList.toggle('on', on);
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
  };

  setValue(state[id]);
  return { element: button, setValue };
}

function createActionButton(label, primary, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `btn${primary ? ' primary' : ''}`;
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function buildControls() {
  const reset = createToggle('lfoReset', 'RESET', 'Restart the LFO phase on note-on.');
  const resetWrapper = document.createElement('div');
  resetWrapper.className = 'control';
  const resetCaption = document.createElement('span');
  resetCaption.className = 'control-label';
  resetCaption.textContent = 'LFO RESET';
  resetWrapper.append(resetCaption, reset.element);
  dom.modControls.append(resetWrapper);
  controls.set('lfoReset', reset);

  const multiplier = createSelect('lfoMultiplier', 'MULTIPLIER', LFO_MULTIPLIERS);
  const wave = createSelect('lfoWave', 'WAVE', LFO_WAVES);
  const lfoDestination = createSelect('lfoDestination', 'LFO DEST', LFO_DESTINATIONS);
  const velocityDestination = createSelect('velocityDestination', 'VEL DEST', VELOCITY_DESTINATIONS);

  controls.set('lfoMultiplier', multiplier);
  controls.set('lfoWave', wave);
  controls.set('lfoDestination', lfoDestination);
  controls.set('velocityDestination', velocityDestination);
}

function buildPerformanceKnobs() {
  const noteKnob = createKnob(
    { id: 'note', label: 'NOTE', min: NOTE_MIN, max: NOTE_MAX },
    {
      defaultValue: NOTE_DEFAULT,
      formatValue: (value) => `${midiNoteName(value)} · ${String(value).padStart(3, '0')}`,
      onChange: (value) => {
        selectedNote = value;
        schedulePreview();
      },
    },
  );
  noteKnob.element.classList.add('performance-knob');
  noteKnob.element.title = 'MIDI note used by PREVIEW and WAV export.';
  dom.noteKnobHost.append(noteKnob.element);

  const velocityKnob = createKnob(
    { id: 'velocity', label: 'VELOCITY', min: 0, max: 127 },
    {
      defaultValue: VELOCITY_DEFAULT,
      onChange: (value) => {
        selectedVelocity = value;
        schedulePreview();
      },
    },
  );
  velocityKnob.element.classList.add('performance-knob');
  velocityKnob.element.title = 'Velocity used by PREVIEW and WAV export.';
  dom.velocityKnobHost.append(velocityKnob.element);

  selectedNote = NOTE_DEFAULT;
  selectedVelocity = VELOCITY_DEFAULT;
}

function buildPerformanceTempo() {
  const bpmWrapper = document.createElement('label');
  bpmWrapper.className = 'control performance-bpm';
  const bpmCaption = document.createElement('span');
  bpmCaption.className = 'control-label';
  bpmCaption.textContent = 'BPM';
  const bpmInput = document.createElement('input');
  bpmInput.type = 'number';
  bpmInput.id = 'bpm';
  bpmInput.min = '20';
  bpmInput.max = '300';
  bpmInput.step = '1';
  bpmInput.value = String(bpm);
  bpmInput.setAttribute('aria-label', 'Tempo in BPM');
  bpmInput.addEventListener('change', () => {
    bpm = clamp(Math.round(Number(bpmInput.value) || 120), 20, 300);
    bpmInput.value = String(bpm);

    if (wasmReady) {
      wasm._tapage_set_bpm(engine, bpm);
      schedulePreview();
    }
  });
  bpmWrapper.append(bpmCaption, bpmInput);
  dom.performanceTempo.append(bpmWrapper);
}

function buildPerformanceButtons() {
  const randomizeButton = createActionButton('RANDOMIZE', false, randomize);
  const previewButton = createActionButton('PREVIEW', true, togglePreviewLoop);
  const exportButton = createActionButton('EXPORT WAV', false, exportWav);

  previewButton.id = 'notePreview';
  previewButton.setAttribute('aria-pressed', 'false');
  previewButton.title = 'Loop the selected note and velocity with the current patch.';
  exportButton.id = 'exportWav';
  exportButton.title = 'Render the current patch at the selected note and velocity to a normalized 48 kHz mono WAV.';
  dom.preview = previewButton;
  dom.exportWav = exportButton;
  dom.performanceActions.append(randomizeButton, previewButton, exportButton);

  const punch = createToggle('punch', 'PUNCH', 'Transient / attack emphasis.');
  const gate = createToggle('gate', 'GATE', 'Hold the kick envelope until note-off.');
  const outputChain = createToggle('outputChain', 'COMP', 'Fixed EQ, compressor and peak limiter output chain.');

  dom.perfButtons.append(punch.element, gate.element, outputChain.element);
  dom.perfButtons.append(createActionButton('INIT', false, resetParameters));

  controls.set('punch', punch);
  controls.set('gate', gate);
  controls.set('outputChain', outputChain);
}

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

function setParam(id, value) {
  if (!(id in PARAM)) {
    return;
  }

  const next = Number.isFinite(Number(value)) ? Math.round(Number(value)) : DEFAULTS[id];
  state[id] = next;

  const knob = knobs.get(id);

  if (knob) {
    knob.setValue(next);
  }

  const control = controls.get(id);

  if (control) {
    control.setValue(next);
  }

  if (wasmReady) {
    wasm._tapage_set_param(engine, PARAM[id], next);
  }

  schedulePreview();
}

function applyAllParams() {
  if (!wasmReady) {
    return;
  }

  for (const [id, index] of Object.entries(PARAM)) {
    wasm._tapage_set_param(engine, index, state[id]);
  }

  wasm._tapage_set_bpm(engine, bpm);
}

function resetParameters() {
  presetIndex = 0;

  if (dom.presetSelect) {
    dom.presetSelect.value = '0';
  }

  for (const [id, value] of Object.entries(DEFAULTS)) {
    if (id !== 'mono') {
      setParam(id, value);
    }
  }

  releaseAllNotes();
  setFoot('INITIALIZED · CLICK POWER OR PRESS PREVIEW TO START');
}

async function loadPresetBank() {
  try {
    const response = await fetch(new URL('./presets.json', import.meta.url), { cache: 'no-cache' });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const bank = await response.json();
    factoryPresets = Array.isArray(bank.presets)
      ? bank.presets.filter((preset) => preset && typeof preset.name === 'string' && preset.values)
      : [];

    if (factoryPresets.length === 0) {
      throw new Error('the bank is empty');
    }

    for (let i = 0; i < factoryPresets.length; i += 1) {
      const option = document.createElement('option');
      option.value = String(i + 1);
      option.textContent = factoryPresets[i].name;
      dom.presetSelect.append(option);
    }

    dom.presetMeta.textContent = `${factoryPresets.length} STOCK PRESETS`;
  } catch (error) {
    console.warn('Could not load the stock preset bank.', error);
    dom.presetMeta.textContent = 'STOCK BANK UNAVAILABLE';
  }
}

function applyPresetIndex(index) {
  const selected = clamp(Math.round(index), 0, factoryPresets.length);

  if (selected === 0) {
    resetParameters();
    return;
  }

  const preset = factoryPresets[selected - 1];
  const values = { ...DEFAULTS, ...preset.values };
  presetIndex = selected;
  dom.presetSelect.value = String(selected);

  for (const id of Object.keys(PARAM)) {
    setParam(id, values[id] ?? DEFAULTS[id]);
  }

  setFoot(`PRESET · ${preset.name}`);
}

function stepPreset(delta) {
  const count = factoryPresets.length + 1;

  if (count <= 1) {
    return;
  }

  applyPresetIndex((presetIndex + delta + count) % count);
}

function randomize() {
  for (const [id, [minimum, maximum]] of Object.entries(RANDOM_RANGES)) {
    const value = minimum === 0 && maximum === 1
      ? (Math.random() < 0.5 ? 0 : 1)
      : Math.round(minimum + Math.random() * (maximum - minimum));

    setParam(id, value);
  }

  setFoot('RANDOMIZED · PITCH AND DECAY UNTOUCHED');
}

function exportFileName() {
  const preset = presetIndex > 0 ? factoryPresets[presetIndex - 1] : null;
  const rawName = preset ? preset.name : 'INIT';
  const safeName = rawName
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');

  return `Tapage-${safeName || 'INIT'}-${midiNoteName(selectedNote)}.wav`;
}

function encodeWav(samples, sampleRate) {
  const dataSize = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeAscii = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);          // fmt chunk size
  view.setUint16(20, 1, true);           // PCM
  view.setUint16(22, 1, true);           // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true);           // block align
  view.setUint16(34, 16, true);          // bits per sample
  writeAscii(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;

  for (let i = 0; i < samples.length; i += 1) {
    const clamped = clamp(samples[i], -1, 1);
    const value = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(offset, value, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function normaliseSamples(samples, ceiling) {
  let peak = 0;

  for (let i = 0; i < samples.length; i += 1) {
    const magnitude = Math.abs(samples[i]);

    if (Number.isFinite(magnitude) && magnitude > peak) {
      peak = magnitude;
    }
  }

  if (peak <= 1.0e-6) {
    return 0;
  }

  const gain = ceiling / peak;

  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = Number.isFinite(samples[i]) ? samples[i] * gain : 0;
  }

  return gain;
}

async function exportWav() {
  if (exportingWav || !dom.exportWav) {
    return;
  }

  exportingWav = true;

  const button = dom.exportWav;
  const originalLabel = button.textContent;
  button.disabled = true;
  button.classList.add('busy');
  button.textContent = 'RENDERING';
  setFoot('RENDERING WAV · 48 KHZ MONO');

  // Give the browser a frame to paint the busy state before the offline
  // render blocks the main thread.
  await new Promise((resolve) => setTimeout(resolve, 30));

  try {
    await ready;

    if (!wasmReady) {
      throw new Error('The DSP engine is not ready.');
    }

    const frames = wasm._tapage_export(engine, selectedNote, selectedVelocity / 127);
    const pointer = wasm._tapage_export_buffer(engine);

    if (frames <= 0 || !pointer) {
      throw new Error('The export produced no audio.');
    }

    const samples = wasm.HEAPF32.slice(pointer >>> 2, (pointer >>> 2) + frames);
    normaliseSamples(samples, EXPORT_PEAK_CEILING);
    const filename = exportFileName();
    downloadBlob(encodeWav(samples, EXPORT_SAMPLE_RATE), filename);
    setFoot(`EXPORTED ${filename} · ${(frames / EXPORT_SAMPLE_RATE).toFixed(2)} S · NORMALIZED`);
  } catch (error) {
    console.error(error);
    setFoot(`WAV EXPORT FAILED · ${error instanceof Error ? error.message : String(error)}`, true);
  } finally {
    exportingWav = false;
    button.disabled = false;
    button.classList.remove('busy');
    button.textContent = originalLabel;
  }
}

// ---------------------------------------------------------------------------
// Transport / audio
// ---------------------------------------------------------------------------

function ensureAudioContext() {
  if (audioContext) {
    return;
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) {
    throw new Error('This browser does not support the Web Audio API.');
  }

  audioContext = new AudioContextClass({ latencyHint: 'interactive' });
}

function processAudio(event) {
  const output = event.outputBuffer;
  const frames = output.length;
  const left = output.getChannelData(0);
  const right = output.numberOfChannels > 1 ? output.getChannelData(1) : null;

  if (!wasmReady || !engine) {
    left.fill(0);

    if (right) {
      right.fill(0);
    }

    return;
  }

  const pointer = wasm._tapage_render(engine, frames);

  if (!pointer) {
    left.fill(0);

    if (right) {
      right.fill(0);
    }

    return;
  }

  const heap = wasm.HEAPF32;
  const base = pointer >>> 2;
  monitorGain += (monitorTarget - monitorGain) * 0.08;
  const gain = monitorGain;
  let peak = 0;

  for (let i = 0; i < frames; i += 1) {
    let sample = heap[base + i] * gain;

    if (!Number.isFinite(sample)) {
      sample = 0;
    }

    left[i] = sample;

    if (right) {
      right[i] = sample;
    }

    const magnitude = sample < 0 ? -sample : sample;

    if (magnitude > peak) {
      peak = magnitude;
    }
  }

  if (peak > livePeak) {
    livePeak = peak;
  }
}

function startAudio() {
  if (audioRunning && audioContext && audioContext.state === 'running') {
    return Promise.resolve(true);
  }

  if (startingAudio) {
    return startingAudio;
  }

  startingAudio = (async () => {
    try {
      ensureAudioContext();

      await ready;

      if (!wasmReady) {
        return false;
      }

      if (audioContext.state !== 'running') {
        await audioContext.resume();
      }

      if (!processorNode) {
        if (typeof audioContext.createScriptProcessor !== 'function') {
          throw new Error('ScriptProcessor is not available in this browser.');
        }

        sampleRate = audioContext.sampleRate || 48000;
        wasm._tapage_prepare(engine, sampleRate);
        applyAllParams();

        processorNode = audioContext.createScriptProcessor(512, 1, 2);
        processorNode.onaudioprocess = processAudio;
        processorNode.connect(audioContext.destination);

        resizeScope();
        renderPreview();
      }

      audioRunning = true;
      setAudioUi(true);
      return true;
    } catch (error) {
      failAudio(error);
      return false;
    } finally {
      startingAudio = null;
    }
  })();

  return startingAudio;
}

function setAudioUi(running) {
  audioRunning = running;
  dom.power.classList.toggle('running', running);

  if (running) {
    dom.power.textContent = 'SUSPEND AUDIO';
    setStatus(`ONLINE · ${(sampleRate / 1000).toFixed(1)} KHZ`, 'on');
    setFoot('PREVIEW LOOPS THE SELECTED NOTE · CLICK AGAIN TO STOP');
  } else {
    dom.power.textContent = 'RESUME AUDIO';
    setStatus('SUSPENDED', '');
    setFoot('CLICK POWER OR PRESS PREVIEW TO START');
  }
}

function failAudio(error) {
  console.error(error);
  setStatus('AUDIO ERROR', 'error');
  setFoot(error instanceof Error ? error.message : String(error), true);
}

async function handlePower() {
  if (bootError) {
    return;
  }

  if (audioRunning && audioContext) {
    try {
      stopPreviewLoop();
      await audioContext.suspend();
      setAudioUi(false);
    } catch (error) {
      failAudio(error);
    }

    return;
  }

  await startAudio();
}

function schedulePreview() {
  if (!wasmReady) {
    return;
  }

  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, 70);
}

function renderPreview() {
  if (!wasmReady) {
    return;
  }

  const frames = Math.max(1, Math.round(sampleRate * 0.5));
  const pointer = wasm._tapage_preview(engine, frames, selectedNote, selectedVelocity / 127);

  if (!pointer) {
    return;
  }

  const heap = wasm.HEAPF32;
  const base = pointer >>> 2;
  scopeSamples = heap.slice(base, base + frames);

  let peak = 0;

  for (let i = 0; i < scopeSamples.length; i += 1) {
    const magnitude = Math.abs(scopeSamples[i]);

    if (magnitude > peak) {
      peak = magnitude;
    }
  }

  if (peak > 1.0e-6) {
    for (let i = 0; i < scopeSamples.length; i += 1) {
      scopeSamples[i] /= peak;
    }
  }
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

function updatePreviewButton() {
  if (!dom.preview) {
    return;
  }

  dom.preview.classList.toggle('on', previewLooping);
  dom.preview.setAttribute('aria-pressed', previewLooping ? 'true' : 'false');
  dom.preview.textContent = previewLooping ? 'STOP' : 'PREVIEW';
  dom.preview.title = previewLooping
    ? 'Stop the preview loop.'
    : 'Loop the selected note and velocity with the current patch.';
}

async function togglePreviewLoop() {
  if (previewLooping) {
    stopPreviewLoop();
    return;
  }

  previewLooping = true;
  updatePreviewButton();

  const started = await startAudio();

  if (!started || !wasmReady) {
    stopPreviewLoop();
    return;
  }

  // The button may have been toggled off while the audio context was starting.
  if (previewLooping) {
    triggerPreviewNote();
  }
}

function triggerPreviewNote() {
  if (!previewLooping || !wasmReady) {
    return;
  }

  const note = selectedNote;

  if (previewHeldNote !== null) {
    wasm._tapage_note_off(engine, previewHeldNote);
  }

  previewHeldNote = note;
  wasm._tapage_note_on(engine, note, selectedVelocity / 127);

  clearTimeout(previewNoteTimer);
  previewNoteTimer = setTimeout(() => {
    if (previewHeldNote === note) {
      wasm._tapage_note_off(engine, note);
      previewHeldNote = null;
    }
  }, 300);

  clearTimeout(previewLoopTimer);
  previewLoopTimer = setTimeout(triggerPreviewNote, 60000 / bpm);
}

function stopPreviewLoop() {
  previewLooping = false;
  clearTimeout(previewLoopTimer);
  clearTimeout(previewNoteTimer);
  previewLoopTimer = 0;
  previewNoteTimer = 0;

  if (wasmReady && previewHeldNote !== null) {
    wasm._tapage_note_off(engine, previewHeldNote);
  }

  previewHeldNote = null;
  updatePreviewButton();
}

function releaseAllNotes() {
  stopPreviewLoop();

  if (wasmReady && engine) {
    wasm._tapage_all_notes_off(engine);
  }
}

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

function resizeScope() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(2, Math.round(rect.width * dpr));
  const height = Math.max(2, Math.round(rect.height * dpr));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  scopeWidth = canvas.width;
  scopeHeight = canvas.height;
}

function drawScope() {
  if (!scopeWidth || !scopeHeight) {
    return;
  }

  const width = scopeWidth;
  const height = scopeHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const activity = clamp(livePeak * 2.5, 0, 1);

  context2d.clearRect(0, 0, width, height);

  const background = context2d.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, '#07181f');
  background.addColorStop(0.55, '#040d12');
  background.addColorStop(1, '#02090c');
  context2d.fillStyle = background;
  context2d.fillRect(0, 0, width, height);

  const inset = 14 * dpr;
  const innerWidth = width - inset * 2;
  const innerHeight = height - inset * 2;
  const centreY = height * 0.56;
  const amplitude = innerHeight * 0.42;

  context2d.lineWidth = Math.max(1, dpr * 0.75);
  context2d.strokeStyle = 'rgba(23, 78, 95, 0.55)';

  for (let i = 1; i < 6; i += 1) {
    const x = inset + (innerWidth * i) / 6;
    context2d.beginPath();
    context2d.moveTo(x, inset);
    context2d.lineTo(x, height - inset);
    context2d.stroke();
  }

  for (let i = 1; i < 4; i += 1) {
    const y = inset + (innerHeight * i) / 4;
    context2d.beginPath();
    context2d.moveTo(inset, y);
    context2d.lineTo(width - inset, y);
    context2d.stroke();
  }

  context2d.strokeStyle = `rgba(90, 184, 204, ${0.28 + activity * 0.22})`;
  context2d.beginPath();
  context2d.moveTo(inset, centreY);
  context2d.lineTo(width - inset, centreY);
  context2d.stroke();

  if (scopeSamples.length > 1 && innerWidth > 2) {
    context2d.beginPath();

    for (let x = 0; x < innerWidth; x += 1) {
      const index = Math.min(
        scopeSamples.length - 1,
        Math.floor((x / innerWidth) * scopeSamples.length),
      );
      const y = centreY - scopeSamples[index] * amplitude;
      const px = inset + x;

      if (x === 0) {
        context2d.moveTo(px, y);
      } else {
        context2d.lineTo(px, y);
      }
    }

    context2d.shadowBlur = (5 + activity * 10) * dpr;
    context2d.shadowColor = 'rgba(143, 230, 242, 0.65)';
    context2d.strokeStyle = `rgba(200, 248, 255, ${0.55 + activity * 0.4})`;
    context2d.lineWidth = 1.35 * dpr;
    context2d.stroke();
    context2d.shadowBlur = 0;
  }
}

let lastScopeStatus = '';

function animateScope() {
  livePeak *= 0.9;

  if (livePeak < 0.0005) {
    livePeak = 0;
  }

  const status = livePeak > 0.002 ? 'LIVE' : 'IDLE';

  if (status !== lastScopeStatus) {
    lastScopeStatus = status;
    dom.scopeStatus.textContent = status;
  }

  drawScope();
  requestAnimationFrame(animateScope);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
  try {
    wasm = await createTapageModule();
    engine = wasm._tapage_create();

    if (!engine) {
      throw new Error('Could not create the DSP engine.');
    }

    wasm._tapage_prepare(engine, sampleRate);
    wasm._tapage_set_bpm(engine, bpm);
    wasmReady = true;
    applyAllParams();
    setStatus('DSP READY', '');
    setFoot('CLICK POWER OR PRESS PREVIEW TO START');
    renderPreview();
  } catch (error) {
    bootError = error;
    console.error(error);
    wasmReady = false;
    setStatus('WASM ERROR', 'error');
    setFoot(error instanceof Error ? error.message : String(error), true);
    dom.power.disabled = true;
  }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

buildKnobs();
buildPerformanceKnobs();
buildPerformanceTempo();
buildControls();
buildPerformanceButtons();

dom.power.addEventListener('click', handlePower);

dom.presetSelect.addEventListener('change', () => {
  applyPresetIndex(Number(dom.presetSelect.value));
});

dom.presetPrev.addEventListener('click', () => stepPreset(-1));
dom.presetNext.addEventListener('click', () => stepPreset(1));

dom.monitor.addEventListener('input', () => {
  const amount = clamp(Number(dom.monitor.value) || 0, 0, 100);
  monitorTarget = amount / 100;
  dom.monitorValue.textContent = String(amount).padStart(3, '0');
});

window.addEventListener('blur', releaseAllNotes);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    releaseAllNotes();
  }
});

window.addEventListener('resize', resizeScope);
new ResizeObserver(resizeScope).observe(canvas);

resizeScope();
renderPreview();
setStatus('LOADING DSP', '');
requestAnimationFrame(animateScope);
