const MIN_BPM = 60;
const MAX_BPM = 220;
export const DEFAULT_BAR_BEAT_COUNT = 4;

function assertPositiveFinite(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }
}

function assertNonNegativeFinite(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number.`);
  }
}

export function clampBpm(bpm) {
  assertPositiveFinite(bpm, "BPM");
  return Math.min(MAX_BPM, Math.max(MIN_BPM, bpm));
}

export function normalizeDetectedBpm(bpm, min = 70, max = 180) {
  assertPositiveFinite(bpm, "Detected BPM");

  let normalized = bpm;
  while (normalized < min) {
    normalized *= 2;
  }
  while (normalized > max) {
    normalized /= 2;
  }

  return normalized;
}

export function estimateBeatCount(durationSeconds, bpm) {
  assertPositiveFinite(durationSeconds, "Duration");
  assertPositiveFinite(bpm, "BPM");

  const rawBeats = (durationSeconds * bpm) / 60;
  const roundedBeatCount = Math.max(1, Math.round(rawBeats));
  const roundedError = Math.abs(rawBeats - roundedBeatCount);

  let bestPowerOfTwoBeatCount = 1;
  while (bestPowerOfTwoBeatCount < rawBeats) {
    bestPowerOfTwoBeatCount *= 2;
  }

  const lowerPowerOfTwoBeatCount = Math.max(1, bestPowerOfTwoBeatCount / 2);
  const powerOfTwoCandidates = [
    lowerPowerOfTwoBeatCount,
    bestPowerOfTwoBeatCount,
  ];

  let selectedPowerOfTwoBeatCount = powerOfTwoCandidates[0];
  let selectedPowerOfTwoError = Math.abs(rawBeats - selectedPowerOfTwoBeatCount);

  for (const candidate of powerOfTwoCandidates.slice(1)) {
    const candidateError = Math.abs(rawBeats - candidate);
    if (candidateError < selectedPowerOfTwoError) {
      selectedPowerOfTwoBeatCount = candidate;
      selectedPowerOfTwoError = candidateError;
    }
  }

  if (selectedPowerOfTwoError <= roundedError + 0.75) {
    return selectedPowerOfTwoBeatCount;
  }

  return roundedBeatCount;
}

export function estimateBpmFromLoopLength(durationSeconds, beatCount) {
  assertPositiveFinite(durationSeconds, "Duration");
  assertPositiveFinite(beatCount, "Beat count");
  return (beatCount * 60) / durationSeconds;
}

export function parseBeatCountFromFilename(filename) {
  if (typeof filename !== "string" || filename.length === 0) {
    return null;
  }

  const match = filename.match(/(?:^|[^0-9])(\d+)\s*beats?\b/i);
  if (!match) {
    return null;
  }

  const beatCount = Number(match[1]);
  return Number.isInteger(beatCount) && beatCount > 0 ? beatCount : null;
}

export function quantizeTimeToSampleFrame(timeSeconds, sampleRate) {
  assertNonNegativeFinite(timeSeconds, "Time");
  assertPositiveFinite(sampleRate, "Sample rate");
  return Math.round(timeSeconds * sampleRate) / sampleRate;
}

export function computePlaybackRate(originalBpm, masterBpm) {
  assertPositiveFinite(originalBpm, "Original BPM");
  assertPositiveFinite(masterBpm, "Master BPM");
  return masterBpm / originalBpm;
}

export function computeLoopDurationSeconds(beatCount, bpm) {
  assertNonNegativeFinite(beatCount, "Beat count");
  assertPositiveFinite(bpm, "BPM");
  return (beatCount * 60) / bpm;
}

export function computeBufferOffsetSeconds(loopOffsetSeconds, playbackRate, bufferDurationSeconds) {
  assertPositiveFinite(playbackRate, "Playback rate");
  assertPositiveFinite(bufferDurationSeconds, "Buffer duration");

  if (!Number.isFinite(loopOffsetSeconds) || loopOffsetSeconds < 0) {
    throw new Error("Loop offset must be a non-negative number.");
  }

  const offset = (loopOffsetSeconds * playbackRate) % bufferDurationSeconds;
  return offset < 0 ? offset + bufferDurationSeconds : offset;
}

export class TransportClock {
  constructor({ bpm = 120 } = {}) {
    this.bpm = clampBpm(bpm);
    this.state = "stopped";
    this.anchorTime = 0;
    this.anchorBeat = 0;
  }

  get isActive() {
    return this.state !== "stopped";
  }

  get isArmed() {
    return this.state === "armed";
  }

  get isRunning() {
    return this.state === "running";
  }

  syncState(atTime) {
    if (this.state === "armed" && atTime >= this.anchorTime) {
      this.state = "running";
    }
  }

  start(atTime, beatPosition = 0) {
    assertPositiveFinite(atTime, "Start time");
    this.state = "running";
    this.anchorTime = atTime;
    this.anchorBeat = beatPosition;
    return this.anchorTime;
  }

  scheduleNextBar(atTime, barBeatCount = DEFAULT_BAR_BEAT_COUNT) {
    assertPositiveFinite(atTime, "Start time");
    assertPositiveFinite(barBeatCount, "Bar beat count");

    if (!this.isActive) {
      this.state = "armed";
      this.anchorTime = atTime + computeLoopDurationSeconds(barBeatCount, this.bpm);
      this.anchorBeat = 0;
      return this.anchorTime;
    }

    if (this.isArmed && atTime < this.anchorTime) {
      return this.anchorTime;
    }

    this.syncState(atTime);
    const currentBeat = this.getPositionBeats(atTime);
    const nextBarBeat = (Math.floor(currentBeat / barBeatCount) + 1) * barBeatCount;
    const beatsUntilNextBar = nextBarBeat - currentBeat;

    return atTime + computeLoopDurationSeconds(beatsUntilNextBar, this.bpm);
  }

  stop() {
    this.state = "stopped";
    this.anchorTime = 0;
    this.anchorBeat = 0;
  }

  setBpm(nextBpm, effectiveTime = 0) {
    const clamped = clampBpm(nextBpm);

    if (this.isRunning) {
      const beatPosition = this.getPositionBeats(effectiveTime);
      this.anchorBeat = beatPosition;
      this.anchorTime = effectiveTime;
    }

    this.bpm = clamped;
  }

  getPositionBeats(atTime = 0) {
    if (!this.isActive) {
      return 0;
    }

    if (this.isArmed && atTime <= this.anchorTime) {
      return 0;
    }

    this.syncState(atTime);
    return this.anchorBeat + (((atTime - this.anchorTime) * this.bpm) / 60);
  }

  getLoopOffsetSeconds(loopBeatCount, atTime) {
    assertPositiveFinite(loopBeatCount, "Loop beat count");
    assertPositiveFinite(atTime, "Offset time");

    const beatsIntoLoop = this.getPositionBeats(atTime) % loopBeatCount;
    return computeLoopDurationSeconds(beatsIntoLoop, this.bpm);
  }

  getTimeForBeat(beatPosition) {
    if (!this.isActive) {
      throw new Error("Transport must be active to convert beats into time.");
    }

    return this.anchorTime + (((beatPosition - this.anchorBeat) * 60) / this.bpm);
  }
}
