function assertPositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
}

export function buildWaveformPeaks(audioBuffer, sampleCount = 160) {
  if (!audioBuffer || typeof audioBuffer.length !== "number" || typeof audioBuffer.numberOfChannels !== "number") {
    throw new Error("A valid audio buffer is required.");
  }

  assertPositiveInteger(sampleCount, "Sample count");

  const peaks = new Float32Array(sampleCount);
  let maxPeak = 0;

  for (let bucketIndex = 0; bucketIndex < sampleCount; bucketIndex += 1) {
    const start = Math.floor((bucketIndex * audioBuffer.length) / sampleCount);
    const end = Math.max(start + 1, Math.floor(((bucketIndex + 1) * audioBuffer.length) / sampleCount));
    let bucketPeak = 0;

    for (let channelIndex = 0; channelIndex < audioBuffer.numberOfChannels; channelIndex += 1) {
      const channelData = audioBuffer.getChannelData(channelIndex);

      for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
        bucketPeak = Math.max(bucketPeak, Math.abs(channelData[sampleIndex] ?? 0));
      }
    }

    peaks[bucketIndex] = bucketPeak;
    maxPeak = Math.max(maxPeak, bucketPeak);
  }

  if (maxPeak === 0) {
    return peaks;
  }

  for (let bucketIndex = 0; bucketIndex < peaks.length; bucketIndex += 1) {
    peaks[bucketIndex] /= maxPeak;
  }

  return peaks;
}
