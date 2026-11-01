# Welcome to the Edge Voice sandbox

This is a separate Obsidian, with its own vault and settings, for trying the plugin while you work on it. Your everyday Obsidian and its vaults are not touched. Each time you save a change in the repository, the plugin is rebuilt and reloaded here.

## Things to try

- Press the play button in the ribbon, or right-click a word and choose **Start text-to-speech here**.
- Read [[Markdown features]] in Source mode, Live Preview and Reading view, and switch between them while it reads.
- Listen to [[Numbers and units]] to hear how numbers, units and acronyms are said.
- Skip forward and back through [[A long note]], and switch to another note to see reading pause.
- Open the PDFs in the `PDFs` folder: headers, page numbers, margin stamps and footnotes are skipped.

## Commands, from the repository

| Command                           | What it does                                                            |
| --------------------------------- | ----------------------------------------------------------------------- |
| `bun run sandbox`                 | Build, open this sandbox, and reload the plugin on every change.        |
| `bun run sandbox --fresh`         | The same, with an engine installed from scratch, as a new user gets it. |
| `bun run sandbox --python <path>` | Use this Python for the engine, and remember it.                        |
| `bun run sandbox:reset`           | Put the sample notes and PDFs back as they were.                        |
| `bun run sandbox:errors`          | Show errors from this sandbox.                                          |
