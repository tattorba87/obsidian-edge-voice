# Testing a beta with BRAT

Edge Voice sometimes publishes a beta as a GitHub **prerelease** (for example `0.3.0-beta.1`) before a stable release. Betas never reach normal Community plugin updates: you opt in with Obsidian's [BRAT](https://tfthacker.com/brat-quick-guide) plugin. Current betas, if any, are on the [releases page](https://github.com/tattorba87/obsidian-edge-voice/releases) marked **Pre-release**.

## Install a beta

1. Use a **separate test vault**, not your everyday notes. A beta keeps the plugin ID `edge-voice`, so it replaces the stable plugin's files in the vault where you install it.
2. Install BRAT from Community plugins.
3. Run **BRAT: Add a beta plugin with frozen version based on a release tag**, enter `tattorba87/obsidian-edge-voice`, and choose the exact beta tag.
4. Enable Edge Voice in that vault. If the beta's release notes say it needs a newer speech engine, run the setup commands Edge Voice shows; BRAT installs plugin files only, never Python, the engine, voices or models.

## Go back to stable

Remove Edge Voice from BRAT's list, then reinstall it from Community plugins (or install the stable release's tag through BRAT). Obsidian may not move from a beta to the stable release with the same number on its own. Your settings are in the vault's `.obsidian/plugins/edge-voice/data.json`; keep a copy if you want to carry them back.

## Reporting

Open an [issue](https://github.com/tattorba87/obsidian-edge-voice/issues) with the beta tag, your OS, Obsidian version and engine version (Settings → Edge Voice → Advanced → Speech engine).

Maintainers publish betas and promote them to stable as described in [CONTRIBUTING.md](../CONTRIBUTING.md#public-beta-releases-through-brat).
