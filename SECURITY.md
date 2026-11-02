# Security policy

## Report a vulnerability privately

Use GitHub's [private vulnerability reporting form](https://github.com/tattorba87/obsidian-edge-voice/security/advisories/new) when it is enabled. This sends the report to the repository maintainers rather than opening a public issue.

**Activation pending:** this repository is currently private, and GitHub's private vulnerability reporting feature is available for public repositories. The form above is not an active reporting channel yet. Steven owns the activation task below. Do not put vulnerability details, exploit instructions, secrets or personal vault contents in public issues, pull requests or discussions. If the form is unavailable, do not assume a report has reached the maintainer; an alternative private contact must be agreed with Steven before sharing sensitive details.

Include the affected plugin version or commit, Obsidian version, operating system, the expected and observed behaviour, reproduction steps and potential impact. Prefer a small synthetic note or PDF over a real vault. Redact credentials, personal paths and unrelated note contents from logs. Report suspected problems even if you cannot reproduce them on the latest version; say which version you tested.

## Scope

Security reports can cover:

- The Obsidian plugin, including note/PDF processing, playback and saved settings.
- `server.py`, its Python environment and the plugin/sidecar protocol.
- Setup, installation, dependency and model downloads, integrity checks and local storage handling.
- Dependency locks, build automation and the release process, including release artifact tampering.

Problems in upstream libraries or models that affect Edge Voice are relevant; identify the component and how it is used here. Ordinary feature requests and bugs without a security impact belong in regular issues. A scan without findings is not a guarantee that the application or its dependencies are secure.

## Maintainer action: enable private reporting

- [ ] **Steven:** once the repository is public, enable GitHub private vulnerability reporting before relying on this policy as a working external reporting route. This document does not authorize changing repository visibility or settings.
- [ ] Open **Settings → Security and quality → Advanced Security → Private vulnerability reporting → Enable**. GitHub documents the current controls in [Configuring private vulnerability reporting](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository).
- [ ] Verify that **Security → Advisories → Report a vulnerability** opens the private form for an appropriate reporting account, and arrange notifications so reports are seen.
- [ ] Remove the activation-pending notice above only after verification. If the repository remains private or the feature cannot be enabled, agree and publish a working private contact instead.
