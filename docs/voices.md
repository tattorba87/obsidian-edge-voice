# Voices

Kokoro voices (`kokoro_*`, the default is `kokoro_af_bella`) sound the most natural and synthesize about twice as fast as they play, even on a 2020 Intel i5. Piper voices (`piper_*`) are faster still, so reading starts sooner. Pick one under Settings → Edge Voice → Voice, which lists the voices on your computer. To get another, choose it under _Get another voice_ (grouped, with sizes and links to hear them). The download command appears below the instructions; click **Copy command**, run it in your terminal, then click **Check again**. In a terminal, `edge-voice-engine voices list` shows every voice in a table, and `voices get` takes several at once:

```sh
~/.edge-voice/engine/bin/edge-voice-engine voices get kokoro_af_heart kokoro_bf_emma
```

American and British voices both work; choosing a British voice reads with British English's pronunciation. With `--faster` on Apple silicon, Kokoro voices are fetched for the faster engine too.

<!-- voices:start -->

Hear them first: [Kokoro voices](https://huggingface.co/spaces/hexgrad/Kokoro-TTS), [Piper voices](https://rhasspy.github.io/piper-samples/).
The first Kokoro voice is about 109 MB (it brings Kokoro's model); each one after that is under 1 MB. Piper voices are 42 MB to 89 MB each.

**Recommended** (Kokoro's best-graded voices, then Piper's high-quality public-domain ones):

| Voice             | Accent           | Engine              | ID                          | Faster engine |
| ----------------- | ---------------- | ------------------- | --------------------------- | ------------- |
| Heart (female)    | American English | Kokoro              | `kokoro_af_heart`           | yes           |
| Bella (female)    | American English | Kokoro              | `kokoro_af_bella`           | yes           |
| Emma (female)     | British English  | Kokoro              | `kokoro_bf_emma`            | yes           |
| Michael (male)    | American English | Kokoro              | `kokoro_am_michael`         | yes           |
| George (male)     | British English  | Kokoro              | `kokoro_bm_george`          | yes           |
| Nicole (female)   | American English | Kokoro              | `kokoro_af_nicole`          | yes           |
| Fenrir (male)     | American English | Kokoro              | `kokoro_am_fenrir`          | yes           |
| LJSpeech (female) | American English | Piper, high quality | `piper_en_US-ljspeech-high` |               |
| Cori (female)     | British English  | Piper, high quality | `piper_en_GB-cori-high`     |               |

<details><summary>The other 57 voices</summary>

| Voice                     | Accent           | Engine                | ID                                         | Faster engine |
| ------------------------- | ---------------- | --------------------- | ------------------------------------------ | ------------- |
| Adam (male)               | American English | Kokoro                | `kokoro_am_adam`                           | yes           |
| Alloy (female)            | American English | Kokoro                | `kokoro_af_alloy`                          | yes           |
| Aoede (female)            | American English | Kokoro                | `kokoro_af_aoede`                          | yes           |
| Echo (male)               | American English | Kokoro                | `kokoro_am_echo`                           | yes           |
| Eric (male)               | American English | Kokoro                | `kokoro_am_eric`                           | yes           |
| Jessica (female)          | American English | Kokoro                | `kokoro_af_jessica`                        | yes           |
| Kore (female)             | American English | Kokoro                | `kokoro_af_kore`                           | yes           |
| Liam (male)               | American English | Kokoro                | `kokoro_am_liam`                           | yes           |
| Nova (female)             | American English | Kokoro                | `kokoro_af_nova`                           | yes           |
| Onyx (male)               | American English | Kokoro                | `kokoro_am_onyx`                           | yes           |
| Puck (male)               | American English | Kokoro                | `kokoro_am_puck`                           | yes           |
| River (female)            | American English | Kokoro                | `kokoro_af_river`                          | yes           |
| Santa (male)              | American English | Kokoro                | `kokoro_am_santa`                          | yes           |
| Sarah (female)            | American English | Kokoro                | `kokoro_af_sarah`                          | yes           |
| Sky (female)              | American English | Kokoro                | `kokoro_af_sky`                            | yes           |
| Alice (female)            | British English  | Kokoro                | `kokoro_bf_alice`                          | yes           |
| Daniel (male)             | British English  | Kokoro                | `kokoro_bm_daniel`                         | yes           |
| Fable (male)              | British English  | Kokoro                | `kokoro_bm_fable`                          | yes           |
| Isabella (female)         | British English  | Kokoro                | `kokoro_bf_isabella`                       | yes           |
| Lewis (male)              | British English  | Kokoro                | `kokoro_bm_lewis`                          | yes           |
| Lily (female)             | British English  | Kokoro                | `kokoro_bf_lily`                           | yes           |
| ARCTIC                    | American English | Piper, medium quality | `piper_en_US-arctic-medium`                |               |
| Amy (female)              | American English | Piper, low quality    | `piper_en_US-amy-low`                      |               |
| Amy (female)              | American English | Piper, medium quality | `piper_en_US-amy-medium`                   |               |
| Bryce (male)              | American English | Piper, medium quality | `piper_en_US-bryce-medium`                 |               |
| Danny (male)              | American English | Piper, low quality    | `piper_en_US-danny-low`                    |               |
| HFC (female)              | American English | Piper, medium quality | `piper_en_US-hfc_female-medium`            |               |
| HFC (male)                | American English | Piper, medium quality | `piper_en_US-hfc_male-medium`              |               |
| Joe (male)                | American English | Piper, medium quality | `piper_en_US-joe-medium`                   |               |
| John (male)               | American English | Piper, medium quality | `piper_en_US-john-medium`                  |               |
| Kathleen (female)         | American English | Piper, low quality    | `piper_en_US-kathleen-low`                 |               |
| Kristin (female)          | American English | Piper, medium quality | `piper_en_US-kristin-medium`               |               |
| Kusal (male)              | American English | Piper, medium quality | `piper_en_US-kusal-medium`                 |               |
| L2-ARCTIC                 | American English | Piper, medium quality | `piper_en_US-l2arctic-medium`              |               |
| LJSpeech (female)         | American English | Piper, medium quality | `piper_en_US-ljspeech-medium`              |               |
| Lessac (female)           | American English | Piper, high quality   | `piper_en_US-lessac-high`                  |               |
| Lessac (female)           | American English | Piper, low quality    | `piper_en_US-lessac-low`                   |               |
| Lessac (female)           | American English | Piper, medium quality | `piper_en_US-lessac-medium`                |               |
| LibriTTS                  | American English | Piper, high quality   | `piper_en_US-libritts-high`                |               |
| LibriTTS-R                | American English | Piper, medium quality | `piper_en_US-libritts_r-medium`            |               |
| Norman (male)             | American English | Piper, medium quality | `piper_en_US-norman-medium`                |               |
| Reza Ibrahim (male)       | American English | Piper, medium quality | `piper_en_US-reza_ibrahim-medium`          |               |
| Ryan (male)               | American English | Piper, high quality   | `piper_en_US-ryan-high`                    |               |
| Ryan (male)               | American English | Piper, low quality    | `piper_en_US-ryan-low`                     |               |
| Ryan (male)               | American English | Piper, medium quality | `piper_en_US-ryan-medium`                  |               |
| Saikat                    | American English | Piper                 | `piper_en_US-saikat`                       |               |
| Sam                       | American English | Piper, medium quality | `piper_en_US-sam-medium`                   |               |
| Alan (male)               | British English  | Piper, low quality    | `piper_en_GB-alan-low`                     |               |
| Alan (male)               | British English  | Piper, medium quality | `piper_en_GB-alan-medium`                  |               |
| Alba (female)             | British English  | Piper, medium quality | `piper_en_GB-alba-medium`                  |               |
| Aru                       | British English  | Piper, medium quality | `piper_en_GB-aru-medium`                   |               |
| Cori (female)             | British English  | Piper, medium quality | `piper_en_GB-cori-medium`                  |               |
| Jenny (female)            | British English  | Piper, medium quality | `piper_en_GB-jenny_dioco-medium`           |               |
| Northern English (male)   | British English  | Piper, medium quality | `piper_en_GB-northern_english_male-medium` |               |
| Semaine                   | British English  | Piper, medium quality | `piper_en_GB-semaine-medium`               |               |
| Southern English (female) | British English  | Piper, low quality    | `piper_en_GB-southern_english_female-low`  |               |
| VCTK                      | British English  | Piper, medium quality | `piper_en_GB-vctk-medium`                  |               |

</details>

Voices have their own licences: Kokoro's are Apache 2.0; each Piper voice's licence is in its [model card](https://huggingface.co/rhasspy/piper-voices). A few Piper voices (such as Lessac and Ryan) were trained on recordings licensed for research or non-commercial use only; check the model card before using one for anything commercial.

<!-- voices:end -->
