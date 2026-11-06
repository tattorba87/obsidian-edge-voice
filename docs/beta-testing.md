# BRAT beta testing before the stable release

BRAT can install this STT work without distributing it through normal Community plugin updates. The [official developer guide](https://github.com/TfTHacker/obsidian42-brat/blob/main/BRAT-DEVELOPER-GUIDE.md) supports prerelease assets, versions such as `0.2.0-beta.1`, and selection of a specific release. BRAT 1.1+ uses release assets; it does not need a root `manifest-beta.json`.

## Public beta, separate from stable updates

The maintainer has chosen a **public GitHub prerelease in `tattorba87/obsidian-edge-voice`**. Testers opt in through BRAT. There is no private repository or token setup. Keep the default branch's manifest at the published stable version until the general release is ready: **do not merge the experimental 0.2.0 metadata into main just to distribute a beta**. The beta tag points to the reviewed feature-branch commit instead.

GitHub prerelease assets will be publicly downloadable. Publishing a beta is a separate authorized step; the local packager creates files only. Available beta tags are listed on the [releases page](https://github.com/tattorba87/obsidian-edge-voice/releases).

## Prepare assets locally

After the checks in CONTRIBUTING.md pass:

```sh
bun run package:beta 0.2.0-beta.1
```

This builds `.scratch/beta/0.2.0-beta.1/` containing `main.js`, `manifest.json`, `styles.css`, `LICENSE`, `SHA256SUMS` and beta notes. Only the packaged manifest gets the beta version. Root manifest/package/versions files stay untouched. Existing output directories are refused. It does not commit, tag, upload or create a release.

When the maintainer authorizes beta publication, create the release in `tattorba87/obsidian-edge-voice` from the reviewed feature-branch commit with **matching tag, title and manifest version**, for example `0.2.0-beta.1`; mark it **prerelease**, leave **Set as latest release** off, and attach the prepared assets. Keep any required source/notices accessible to testers. The dedicated **BRAT beta release** workflow builds, checks, attests and publishes these assets only when its publish input is enabled. Run it against the reviewed feature branch after the engine is available. Do not use `bun run release` or the stable Release workflow for a beta: those have different commit/tag/publication behavior. No publishing command is run by the local packager.

## Engine delivery is separate

BRAT updates plugin files only. STT still needs **engine 0.4.0** and an explicitly downloaded English model. The standard 0.4.0 setup URLs are not available until that engine is published. For this machine, use the existing [isolated branch-engine setup](experimental-dictation.md). Do not invite additional testers with instructions that point at a nonexistent release.

For the public beta, the **Engine release** workflow now offers a **prerelease** checkbox. Once engine publication is explicitly authorized, run it against the reviewed feature-branch commit with **publish** and **prerelease** enabled. It publishes `engine-0.4.0` as a prerelease, retains the normal checksums/attestations, and keeps `latest=false`. Verify the published platform setup commands and `models get` before making the BRAT beta available. This supplies the exact engine URLs already used by the beta plugin without changing the stable plugin's manifest or listing. Workflow outcomes must be checked before offering the beta to testers.

BRAT does not install Python, the engine or models; testers run the setup commands themselves. If the beta requires an engine fix later, increment the engine version and regenerate/review the pinned release rather than replacing immutable assets under an existing tag.

## Tester installation and rollback

1. Use a **disposable test vault** and install BRAT from Community plugins. Back up any notes/settings you intend to test.
2. Use **BRAT: Add a beta plugin with frozen version based on a release tag**, enter `tattorba87/obsidian-edge-voice` and select the exact beta tag. This avoids accidentally following unrelated releases. See the [official quick guide](https://tfthacker.com/brat-quick-guide).
3. Enable Edge Voice in that vault. Select the separate test Python environment under Advanced, get a model with its manual command, then enable dictation.
4. To move to another beta, deliberately change the tracked version in BRAT. To return to stable, install the exact stable release through BRAT or reinstall stable in a test vault, then remove BRAT's tracking entry. Keep a backup of `data.json` if carrying settings back. Do not assume Obsidian will automatically downgrade or promote a prerelease to the same base stable number; the BRAT developer guide documents version-comparison limitations.

The beta keeps the plugin ID `edge-voice`: it replaces the stable plugin's files **within the vault where it is installed**. It is not a second independent plugin and should not be installed over everyday work merely to try it. The separate test vault avoids changing the stable installation.

Before any beta upload, finish Claude review, real microphone acceptance, the chosen platform checks, model/media/license review and engine delivery. The local packager establishes reproducible plugin assets; it does not assert that those release gates are complete.
