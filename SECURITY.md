# Security policy

Report vulnerabilities through GitHub's [private reporting form](https://github.com/tattorba87/obsidian-edge-voice/security/advisories/new). If the form is unavailable, arrange a private contact with the maintainer before sharing sensitive details. Keep vulnerability details and exploit instructions out of public issues, pull requests and discussions.

Include the affected version, Obsidian version, operating system, reproduction steps and potential impact. Use synthetic notes or PDFs where possible, and redact secrets and personal vault contents from logs.

Reports are in scope for the Obsidian plugin; the `edge-voice-engine` package and its local stdin/stdout protocol; engine releases and their requirements files; the setup commands the plugin shows; voice and English ASR model downloads (`edge-voice-engine voices get`, `models get`); microphone capture and editor insertion; storage handling; and the build and release workflows, including upstream components that affect Edge Voice.

The plugin downloads and installs nothing. People run the setup and voice-download commands themselves. During reading and dictation, the engine runs offline and processes note/PDF text and microphone audio locally. Dictation audio is held only in memory and is not written to recordings or transcript logs. Managed ASR files are SHA-256 verified before native parsing; custom model folders are an explicit trust decision.

Plugin releases from 0.1.1 and engine releases from 0.3.0 carry artifact attestations; engine releases also list SHA-256 checksums (`SHA256SUMS`). Verify a download with `gh attestation verify <file> --repo tattorba87/obsidian-edge-voice`. A file that fails verification, or a release without them where one is expected, is worth reporting.
