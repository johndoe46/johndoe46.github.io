class MDWaveEditorRecorderProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const inputChannels = inputs[0];
    if (!inputChannels || inputChannels.length === 0) {
      return true;
    }

    const chunk = inputChannels.map((channelData) => new Float32Array(channelData));
    this.port.postMessage(
      {
        type: "chunk",
        channels: chunk,
      },
      chunk.map((channelData) => channelData.buffer),
    );

    return true;
  }
}

registerProcessor("md-waveditor-recorder", MDWaveEditorRecorderProcessor);
