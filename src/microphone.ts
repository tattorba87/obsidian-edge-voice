import { Microphone } from "./dictation";

/** AudioWorklet keeps capture off the editor thread. No audio is written to disk. */
export async function captureMicrophone(
	receive: (samples: Float32Array, rate: number) => void,
	ended: () => void,
): Promise<Microphone> {
	const media = await navigator.mediaDevices.getUserMedia({
		audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
		video: false,
	});
	let context: AudioContext | undefined;
	let node: AudioWorkletNode | undefined;
	let source: MediaStreamAudioSourceNode | undefined;
	const stop = () => {
		if (node) node.port.onmessage = null;
		source?.disconnect();
		node?.disconnect();
		for (const track of media.getTracks()) {
			track.onended = null;
			track.stop();
		}
		if (context) void context.close();
	};
	const url = URL.createObjectURL(
		new Blob(
			[
				`
class EdgeVoiceMicrophone extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.port.onmessage = (event) => { if (event.data === "start") this.recording = true; };
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (input && this.recording) this.port.postMessage(input.slice());
    return true;
  }
}
registerProcessor('edge-voice-microphone', EdgeVoiceMicrophone);
`,
			],
			{ type: "application/javascript" },
		),
	);
	try {
		context = new AudioContext();
		await context.audioWorklet.addModule(url);
		await context.resume();
		node = new AudioWorkletNode(context, "edge-voice-microphone", { numberOfOutputs: 1 });
		const rate = context.sampleRate;
		node.port.onmessage = (event: MessageEvent<Float32Array>) => receive(event.data, rate);
		source = context.createMediaStreamSource(media);
		// The processor emits silence; connecting it keeps the graph running without feedback.
		source.connect(node).connect(context.destination);
		for (const track of media.getTracks()) track.onended = ended;
		return { start: () => node?.port.postMessage("start"), stop };
	} catch (error) {
		stop();
		throw error;
	} finally {
		URL.revokeObjectURL(url);
	}
}
