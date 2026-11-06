# Community listing update kit

The text and images for Edge Voice's [Community directory listing](https://community.obsidian.md/plugins/edge-voice). Editing these files doesn't change the live listing: copy them into the listing editor after each release that changes what Edge Voice does.

## Copy-ready text

- [short-description.txt](short-description.txt): paste the entire single line into **Short description**. It also matches `manifest.json` and `package.json`. Keep it at 250 characters or fewer, end with a period and avoid emoji, following [Obsidian's description requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins).
- [long-description.md](long-description.md): paste the file's contents into **Long description** and preview the rendered result. It uses absolute links so it works outside GitHub. Its media links point at the default branch, so they work once a release is merged.

## Where to update

1. Sign in at [community.obsidian.md](https://community.obsidian.md) with the account that owns Edge Voice.
2. From the profile's **Plugins** page, choose **Edge Voice** under **Your entries**.
3. Select **Edit listing**. Replace the short and long descriptions with these files, retain the appropriate free payment type/categories, and upload screenshots as below.
4. Preview the descriptions and open every video, image, setup and license link. Confirm that the released plugin and engine version match what the text promises. Select **Save** only when ready to make it public.
5. If a published release is missing, the entry's **… → Check for new releases** requests a check. A **Review branch** preview can be run before a release.

These steps follow [Obsidian's current listing management guide](https://docs.obsidian.md/community-directory/manage-entry), checked 2026-11-05. The README seeds a listing on submission, but an existing entry's short/long descriptions are editable separately; don't assume changing GitHub's README replaces your edited listing.

## Screenshots and videos

The directory permits **up to five desktop images, 1200×800, JPEG/PNG/WebP, up to 5 MB each**. This plugin is desktop-only; don't upload mobile screenshots. Suggested five-image set:

| Order | File under `docs/media/`   | Purpose / caption                                                                          |
| ----- | -------------------------- | ------------------------------------------------------------------------------------------ |
| 1     | `listing-reading-note.png` | Read a note aloud with sentence and word highlighting.                                     |
| 2     | `listing-reading-pdf.png`  | Read PDFs with sentence and word highlighting.                                             |
| 3     | `dictation-dark.png`       | Dictate English locally into Markdown; the microphone and Dictating bars respond to input. |
| 4     | `dictation-light.png`      | The same microphone and playback controls in the light theme.                              |
| 5     | `dictation-settings.png`   | Choose a local model, separate shortcut, optional sounds, casing and inactivity timeout.   |

Keep the attribution near reused TTS PDF frames and STT media, as in the long description and [media credits](../media/README.md). `dictation-dark.mp4` and `dictation-light.mp4` have sound; the GIFs are silent. GIFs/video belong in the long description, not the screenshot upload slots. The description links to the repository's video files; if you upload them as GitHub attachments later, replace only those URLs with the returned permanent links. Keep source credits.

The existing TTS demo and STT demo are distinct. The STT video uses a real recognizer with a licensed recording routed as input; it is not a person speaking live into a microphone. See the reproducibility and QA notes in [media/README.md](../media/README.md).

The README banner is `docs/media/banner-tts-stt.png`. It shows an edited Obsidian crystal, which [Obsidian's brand guidelines](https://obsidian.md/brand) ask people not to make; the maintainer chose to keep it. It isn't a 1200×800 screenshot, so don't use it in the gallery slots.
