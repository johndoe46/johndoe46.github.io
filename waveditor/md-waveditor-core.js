(function attachMDWaveEditorCore(globalObject) {
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function cloneAudioBuffer(sourceBuffer) {
    const clone = new AudioBuffer({
      length: sourceBuffer.length,
      numberOfChannels: sourceBuffer.numberOfChannels,
      sampleRate: sourceBuffer.sampleRate,
    });
    for (let channel = 0; channel < sourceBuffer.numberOfChannels; channel += 1) {
      clone.copyToChannel(sourceBuffer.getChannelData(channel), channel);
    }
    return clone;
  }

  function createAudioBufferLike(sourceBuffer, length) {
    return new AudioBuffer({
      length,
      numberOfChannels: sourceBuffer.numberOfChannels,
      sampleRate: sourceBuffer.sampleRate,
    });
  }

  function extractAudioBufferSegment(sourceBuffer, startFrame, endFrame) {
    const safeStart = clamp(Math.floor(startFrame), 0, sourceBuffer.length);
    const safeEnd = clamp(Math.ceil(endFrame), safeStart, sourceBuffer.length);
    const segmentLength = Math.max(0, safeEnd - safeStart);
    const segmentBuffer = createAudioBufferLike(sourceBuffer, segmentLength);

    for (let channel = 0; channel < sourceBuffer.numberOfChannels; channel += 1) {
      const sourceData = sourceBuffer.getChannelData(channel);
      segmentBuffer.copyToChannel(sourceData.subarray(safeStart, safeEnd), channel);
    }

    return segmentBuffer;
  }

  function insertAudioBufferSegment(sourceBuffer, insertFrame, insertBuffer) {
    const safeInsertFrame = clamp(Math.floor(insertFrame), 0, sourceBuffer.length);
    const nextBuffer = createAudioBufferLike(
      sourceBuffer,
      sourceBuffer.length + insertBuffer.length,
    );

    for (let channel = 0; channel < sourceBuffer.numberOfChannels; channel += 1) {
      const nextData = nextBuffer.getChannelData(channel);
      const sourceData = sourceBuffer.getChannelData(channel);
      const insertData = insertBuffer.getChannelData(channel);

      nextData.set(sourceData.subarray(0, safeInsertFrame), 0);
      nextData.set(insertData, safeInsertFrame);
      nextData.set(sourceData.subarray(safeInsertFrame), safeInsertFrame + insertBuffer.length);
    }

    return nextBuffer;
  }

  function removeAudioBufferSegment(sourceBuffer, startFrame, endFrame) {
    const safeStart = clamp(Math.floor(startFrame), 0, sourceBuffer.length);
    const safeEnd = clamp(Math.ceil(endFrame), safeStart, sourceBuffer.length);
    const removedLength = Math.max(0, safeEnd - safeStart);
    const nextBuffer = createAudioBufferLike(
      sourceBuffer,
      Math.max(1, sourceBuffer.length - removedLength),
    );

    for (let channel = 0; channel < sourceBuffer.numberOfChannels; channel += 1) {
      const nextData = nextBuffer.getChannelData(channel);
      const sourceData = sourceBuffer.getChannelData(channel);
      nextData.set(sourceData.subarray(0, safeStart), 0);
      nextData.set(sourceData.subarray(safeEnd), safeStart);
    }

    return nextBuffer;
  }

  function overwriteAudioBufferSegment(sourceBuffer, startFrame, overwriteBuffer, maxFrames) {
    const nextBuffer = cloneAudioBuffer(sourceBuffer);
    const safeStart = clamp(Math.floor(startFrame), 0, sourceBuffer.length);
    const overwriteLength = Math.min(
      overwriteBuffer.length,
      Math.max(0, maxFrames),
      sourceBuffer.length - safeStart,
    );

    for (let channel = 0; channel < sourceBuffer.numberOfChannels; channel += 1) {
      const nextData = nextBuffer.getChannelData(channel);
      const overwriteData = overwriteBuffer.getChannelData(channel);
      nextData.set(overwriteData.subarray(0, overwriteLength), safeStart);
    }

    return {
      audioBuffer: nextBuffer,
      overwrittenLength: overwriteLength,
    };
  }

  function parseWAVSampleLoops(arrayBuffer) {
    if (!(arrayBuffer instanceof ArrayBuffer) || arrayBuffer.byteLength < 12) {
      return { sampleRate: 0, loops: [] };
    }

    const view = new DataView(arrayBuffer);
    const readString = (offset, length) => {
      let value = "";
      for (let index = 0; index < length; index += 1) {
        value += String.fromCharCode(view.getUint8(offset + index));
      }
      return value;
    };

    if (readString(0, 4) !== "RIFF" || readString(8, 4) !== "WAVE") {
      return { sampleRate: 0, loops: [] };
    }

    let sampleRate = 0;
    let loops = [];
    let offset = 12;

    while (offset + 8 <= view.byteLength) {
      const chunkID = readString(offset, 4);
      const chunkSize = view.getUint32(offset + 4, true);
      const chunkDataOffset = offset + 8;
      if (chunkDataOffset + chunkSize > view.byteLength) {
        break;
      }

      if (chunkID === "fmt " && chunkSize >= 16) {
        sampleRate = view.getUint32(chunkDataOffset + 4, true);
      } else if (chunkID === "smpl" && chunkSize >= 36) {
        const loopCount = view.getUint32(chunkDataOffset + 28, true);
        const samplerDataSize = view.getUint32(chunkDataOffset + 32, true);
        const loopsOffset = chunkDataOffset + 36 + samplerDataSize;
        const maxLoops = Math.floor(Math.max(0, chunkSize - 36 - samplerDataSize) / 24);
        const safeLoopCount = Math.min(loopCount, maxLoops);
        loops = [];
        for (let index = 0; index < safeLoopCount; index += 1) {
          const loopOffset = loopsOffset + index * 24;
          loops.push({
            identifier: view.getUint32(loopOffset, true),
            type: view.getUint32(loopOffset + 4, true),
            start: view.getUint32(loopOffset + 8, true),
            end: view.getUint32(loopOffset + 12, true),
            fraction: view.getUint32(loopOffset + 16, true),
            playCount: view.getUint32(loopOffset + 20, true),
          });
        }
      }

      offset += 8 + chunkSize + (chunkSize % 2);
    }

    return { sampleRate, loops };
  }

  function encodeAudioBufferAsWAV(buffer, options = {}) {
    const bitDepth = Number(options.bitDepth) === 24 ? 24 : 16;
    const bytesPerSample = bitDepth / 8;
    const blockAlign = buffer.numberOfChannels * bytesPerSample;
    const byteRate = buffer.sampleRate * blockAlign;
    const dataSize = buffer.length * blockAlign;
    const dataPaddingSize = dataSize % 2;
    const sampleLoops = Array.isArray(options.sampleLoops)
      ? options.sampleLoops
        .map((loop, index) => {
          const maxSampleIndex = Math.max(0, buffer.length - 1);
          const loopStart = clamp(Math.floor(Number(loop?.start) || 0), 0, maxSampleIndex);
          const loopEnd = clamp(Math.floor(Number(loop?.end) || 0), loopStart, maxSampleIndex);
          if (loopEnd <= loopStart) {
            return null;
          }
          return {
            identifier: clamp(
              Math.floor(Number(loop?.identifier) || (index + 1)),
              0,
              0xffffffff,
            ),
            type: clamp(Math.floor(Number(loop?.type) || 0), 0, 0xffffffff),
            start: loopStart,
            end: loopEnd,
            fraction: clamp(Math.floor(Number(loop?.fraction) || 0), 0, 0xffffffff),
            playCount: clamp(Math.floor(Number(loop?.playCount) || 0), 0, 0xffffffff),
          };
        })
        .filter(Boolean)
      : [];
    const smplChunkDataSize = sampleLoops.length > 0 ? 36 + sampleLoops.length * 24 : 0;
    const smplChunkPaddingSize = smplChunkDataSize % 2;
    const smplChunkTotalSize = sampleLoops.length > 0
      ? 8 + smplChunkDataSize + smplChunkPaddingSize
      : 0;
    const riffSize = 4 + (8 + 16) + (8 + dataSize + dataPaddingSize) + smplChunkTotalSize;
    const wavBuffer = new ArrayBuffer(8 + riffSize);
    const view = new DataView(wavBuffer);

    const writeString = (offset, value) => {
      for (let index = 0; index < value.length; index += 1) {
        view.setUint8(offset + index, value.charCodeAt(index));
      }
    };

    writeString(0, "RIFF");
    view.setUint32(4, riffSize, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, buffer.numberOfChannels, true);
    view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(36, "data");
    view.setUint32(40, dataSize, true);

    let offset = 44;
    for (let sampleIndex = 0; sampleIndex < buffer.length; sampleIndex += 1) {
      for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        const sample = clamp(buffer.getChannelData(channel)[sampleIndex], -1, 1);
        if (bitDepth === 24) {
          let intSample = sample < 0
            ? Math.round(sample * 8388608)
            : Math.round(sample * 8388607);
          if (intSample < 0) {
            intSample += 16777216;
          }
          view.setUint8(offset, intSample & 0xff);
          view.setUint8(offset + 1, (intSample >> 8) & 0xff);
          view.setUint8(offset + 2, (intSample >> 16) & 0xff);
        } else {
          const intSample = sample < 0 ? sample * 32768 : sample * 32767;
          view.setInt16(offset, Math.round(intSample), true);
        }
        offset += bytesPerSample;
      }
    }

    offset += dataPaddingSize;

    if (sampleLoops.length > 0) {
      writeString(offset, "smpl");
      view.setUint32(offset + 4, smplChunkDataSize, true);
      view.setUint32(offset + 8, 0, true);
      view.setUint32(offset + 12, 0, true);
      view.setUint32(offset + 16, Math.round(1000000000 / buffer.sampleRate), true);
      view.setUint32(offset + 20, 60, true);
      view.setUint32(offset + 24, 0, true);
      view.setUint32(offset + 28, 0, true);
      view.setUint32(offset + 32, 0, true);
      view.setUint32(offset + 36, sampleLoops.length, true);
      view.setUint32(offset + 40, 0, true);

      let loopOffset = offset + 44;
      for (const sampleLoop of sampleLoops) {
        view.setUint32(loopOffset, sampleLoop.identifier, true);
        view.setUint32(loopOffset + 4, sampleLoop.type, true);
        view.setUint32(loopOffset + 8, sampleLoop.start, true);
        view.setUint32(loopOffset + 12, sampleLoop.end, true);
        view.setUint32(loopOffset + 16, sampleLoop.fraction, true);
        view.setUint32(loopOffset + 20, sampleLoop.playCount, true);
        loopOffset += 24;
      }
    }

    return wavBuffer;
  }

  function linearFadeGain(progress) {
    return clamp(progress, 0, 1);
  }

  function sCurveFadeGain(progress) {
    const safeProgress = clamp(progress, 0, 1);
    return safeProgress * safeProgress * (3 - 2 * safeProgress);
  }

  function timeToMarkerSampleIndex(time, sampleRate = 1, bufferLength = 0) {
    return clamp(Math.round(time * sampleRate), 0, bufferLength);
  }

  function remapMarkersAfterRemovedSegment(markers, startTime, endTime) {
    const removedDuration = Math.max(0, endTime - startTime);
    return markers.flatMap((marker) => {
      if (marker.time >= startTime && marker.time < endTime) {
        return [];
      }
      if (marker.time >= endTime) {
        return [{ ...marker, time: Math.max(0, marker.time - removedDuration) }];
      }
      return [{ ...marker }];
    });
  }

  function remapMarkersAfterInsertedSegment(markers, insertTime, insertedDuration) {
    if (insertedDuration <= 0) {
      return markers.map((marker) => ({ ...marker }));
    }
    return markers.map((marker) =>
      marker.time >= insertTime
        ? { ...marker, time: marker.time + insertedDuration }
        : { ...marker },
    );
  }

  function remapMarkersForTrimmedSegment(markers, startTime, endTime) {
    return markers.flatMap((marker) => {
      if (marker.time < startTime || marker.time >= endTime) {
        return [];
      }
      return [{ ...marker, time: Math.max(0, marker.time - startTime) }];
    });
  }

  function shuffleArray(values) {
    const nextValues = values.slice();
    for (let index = nextValues.length - 1; index > 0; index -= 1) {
      const randomIndex = Math.floor(Math.random() * (index + 1));
      const currentValue = nextValues[index];
      nextValues[index] = nextValues[randomIndex];
      nextValues[randomIndex] = currentValue;
    }
    return nextValues;
  }

  function getGridSliceRanges(sliceCount, totalLength) {
    return Array.from({ length: sliceCount }, (_, index) => {
      const startFrame = Math.floor((index * totalLength) / sliceCount);
      const endFrame = Math.floor(((index + 1) * totalLength) / sliceCount);
      return {
        startFrame,
        endFrame,
        frameLength: endFrame - startFrame,
      };
    });
  }

  function findSliceIndexForSample(sampleIndex, sliceRanges) {
    for (let index = 0; index < sliceRanges.length; index += 1) {
      const sliceRange = sliceRanges[index];
      if (sampleIndex >= sliceRange.startFrame && sampleIndex < sliceRange.endFrame) {
        return index;
      }
    }
    return sliceRanges.length - 1;
  }

  globalObject.MDWaveEditorCore = Object.freeze({
    ...(globalObject.MDWaveEditorCore || {}),
    clamp,
    cloneAudioBuffer,
    createAudioBufferLike,
    extractAudioBufferSegment,
    insertAudioBufferSegment,
    removeAudioBufferSegment,
    overwriteAudioBufferSegment,
    parseWAVSampleLoops,
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
  });
})(globalThis);
