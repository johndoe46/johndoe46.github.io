import { normalizeDetectedBpm } from "./timing.js";

function mixToMono(audioBuffer) {
  if (audioBuffer.numberOfChannels === 1) {
    return audioBuffer.getChannelData(0);
  }

  const mono = new Float32Array(audioBuffer.length);
  const channelCount = audioBuffer.numberOfChannels;

  for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
    const channelData = audioBuffer.getChannelData(channelIndex);
    for (let sampleIndex = 0; sampleIndex < audioBuffer.length; sampleIndex += 1) {
      mono[sampleIndex] += channelData[sampleIndex] / channelCount;
    }
  }

  return mono;
}

function buildEnvelope(channelData, windowSize, hopSize) {
  const frameCount = Math.max(0, Math.floor((channelData.length - windowSize) / hopSize));
  const envelope = new Float32Array(frameCount + 1);

  for (let frameIndex = 0; frameIndex <= frameCount; frameIndex += 1) {
    const start = frameIndex * hopSize;
    let total = 0;

    for (let sampleIndex = start; sampleIndex < start + windowSize; sampleIndex += 1) {
      total += Math.abs(channelData[sampleIndex] ?? 0);
    }

    envelope[frameIndex] = total / windowSize;
  }

  return envelope;
}

function buildOnsetEnvelope(envelope) {
  const onset = new Float32Array(envelope.length);

  for (let index = 1; index < envelope.length; index += 1) {
    onset[index] = Math.max(0, envelope[index] - envelope[index - 1]);
  }

  return onset;
}

export function estimateBpmFromChannelData(
  channelData,
  sampleRate,
  { minBpm = 70, maxBpm = 180, windowSize = 2048, hopSize = 1024 } = {},
) {
  if (!(channelData instanceof Float32Array) || channelData.length < windowSize * 4) {
    return null;
  }

  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error("Sample rate must be a positive number.");
  }

  const envelope = buildEnvelope(channelData, windowSize, hopSize);
  const onset = buildOnsetEnvelope(envelope);
  const envelopeRate = sampleRate / hopSize;
  const minLag = Math.max(1, Math.floor((envelopeRate * 60) / maxBpm));
  const maxLag = Math.max(minLag + 1, Math.ceil((envelopeRate * 60) / minBpm));
  const lagScores = new Map();

  let bestLag = 0;
  let bestScore = 0;
  let onsetEnergy = 0;

  for (let index = 0; index < onset.length; index += 1) {
    onsetEnergy += onset[index] * onset[index];
  }

  if (onsetEnergy === 0) {
    return null;
  }

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let score = 0;

    for (let index = lag; index < onset.length; index += 1) {
      score += onset[index] * onset[index - lag];
    }

    lagScores.set(lag, score);

    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  if (bestLag === 0) {
    return null;
  }

  const previousScore = lagScores.get(bestLag - 1) ?? bestScore;
  const nextScore = lagScores.get(bestLag + 1) ?? bestScore;
  const curvature = previousScore - (2 * bestScore) + nextScore;
  const interpolationOffset = curvature === 0
    ? 0
    : (0.5 * (previousScore - nextScore)) / curvature;
  const refinedLag = bestLag + Math.max(-0.5, Math.min(0.5, interpolationOffset));
  const rawBpm = (envelopeRate * 60) / refinedLag;
  const bpm = normalizeDetectedBpm(rawBpm, minBpm, maxBpm);
  const confidence = Math.min(1, bestScore / onsetEnergy);

  return {
    bpm,
    confidence,
  };
}

export async function detectBufferBpm(audioBuffer) {
  const monoChannel = mixToMono(audioBuffer);
  return estimateBpmFromChannelData(monoChannel, audioBuffer.sampleRate);
}
