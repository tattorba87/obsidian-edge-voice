/**
 * A short, soft chime that confirms a double tap: two notes rising when
 * reading starts or resumes, falling when it pauses or stops. Made with Web
 * Audio, so there's no sound file to ship.
 */

let context: AudioContext | undefined;

// E5 and B5: a fifth apart, which reads as a confirmation rather than an alert.
const LOW = 659.25;
const HIGH = 987.77;

export function playChime(direction: "up" | "down"): void {
	context ??= new AudioContext();
	const start = context.currentTime + 0.01;
	const notes = direction === "up" ? [LOW, HIGH] : [HIGH, LOW];
	notes.forEach((frequency, i) => note(context!, frequency, start + i * 0.09));
}

function note(context: AudioContext, frequency: number, at: number): void {
	const oscillator = context.createOscillator();
	oscillator.type = "sine";
	oscillator.frequency.value = frequency;
	const gain = context.createGain();
	gain.gain.setValueAtTime(0, at);
	gain.gain.linearRampToValueAtTime(0.12, at + 0.01);
	gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.28);
	oscillator.connect(gain).connect(context.destination);
	oscillator.start(at);
	oscillator.stop(at + 0.3);
}
