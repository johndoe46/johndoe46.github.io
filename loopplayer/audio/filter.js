function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function interpolateExponentially(min, max, amount) {
  return min * ((max / min) ** amount);
}

export function getFilterSettings(controlValue, sampleRate = 48_000) {
  const normalizedControl = clamp(controlValue, -1, 1);
  const deadZone = 0.02;
  const nyquist = sampleRate / 2;
  const lowpassMin = 80;
  const lowpassMax = Math.min(18_000, nyquist * 0.92);
  const highpassMin = 30;
  const highpassMax = Math.min(12_000, nyquist * 0.75);

  if (Math.abs(normalizedControl) <= deadZone) {
    return {
      dryMix: 1,
      filterType: "lowpass",
      frequency: lowpassMax,
      label: "Flat",
      wetMix: 0,
    };
  }

  const directionAmount = (Math.abs(normalizedControl) - deadZone) / (1 - deadZone);
  const dryMix = 1 - directionAmount;
  const wetMix = directionAmount;

  if (normalizedControl < 0) {
    return {
      dryMix,
      filterType: "lowpass",
      frequency: interpolateExponentially(lowpassMax, lowpassMin, directionAmount),
      label: `LP ${Math.round(interpolateExponentially(lowpassMax, lowpassMin, directionAmount))}Hz`,
      wetMix,
    };
  }

  return {
    dryMix,
    filterType: "highpass",
    frequency: interpolateExponentially(highpassMin, highpassMax, directionAmount),
    label: `HP ${Math.round(interpolateExponentially(highpassMin, highpassMax, directionAmount))}Hz`,
    wetMix,
  };
}
