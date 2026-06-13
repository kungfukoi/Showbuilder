# NewtBuilder

NewtBuilder is a local show-and-episode builder for animated episodes. It is designed to sit next to NewtNode inside `Creative_AI_Tools` and grow into the automation layer for script-to-video, thumbnail, and YouTube publishing workflows.

## Current Build

- Show profiles with reusable episode format and production settings
- Show Library landing screen for opening saved shows or creating fresh ones
- Show Dashboard with episode cards for reopening saved episode projects
- Character voice cast setup using the same voice-list concept as Episode Builder
- Episode workspace with script paste/upload and asset upload
- PDF, TXT, and Markdown script upload
- Shot image library with role buckets for character one-shots, medium two-shots, wide shots, and insert shots
- 9:16 vertical and 16:9 landscape format selection
- Runtime and word-count analysis
- Beat planning from script text
- Automation toggles per show
- In-app approval gates
- YouTube metadata, package export, private draft upload, and draft status checks
- Optional Finishing Layers pass for simple post-render graphics, alpha/video overlays, and extra audio
- YouTube-only promotion prep with reusable Community/pinned-comment templates and promotion packet export
- Local JSON storage in `server/data`

## Episode Format Defaults

- Aspect ratio: `9:16`
- Resolution: `1080x1920`
- Runtime: estimated from script word count and show WPM settings
- Runtime is informational only; the app does not lock episodes to a micro-video length.
- Container: `mp4`
- Video codec: `h264`
- Audio codec: `aac`
- Audio sample rate: `48000`

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://127.0.0.1:5174`.

## Project Structure

- `Show`: the reusable project container for identity, cast, visual setup, defaults, automation, YouTube settings, and templates.
- `Episode`: a saved production inside a show, including script, production map, masks, generated media, finishing layers, thumbnails, and YouTube draft status.
- The app opens to the Show Library. Open a show to see its saved episodes, then open an episode to enter Studio and Approvals.

## YouTube Draft Upload

The app only uploads private YouTube drafts. Public publishing remains a later approval step.

Required environment variables:

```bash
YOUTUBE_CLIENT_ID=...
YOUTUBE_CLIENT_SECRET=...
NEWTBUILDER_ENABLE_PUBLISHING=true
```

Add this authorized redirect URI to the Google OAuth client:

```text
http://127.0.0.1:3334/api/youtube/oauth/callback
```

Then use `Connect YouTube` in the app. NewtBuilder saves the returned refresh token locally in `server/data/youtube-oauth.json`. You can also set `YOUTUBE_REFRESH_TOKEN` in `.env` manually if you prefer.

NewtBuilder requests YouTube upload access and read-only YouTube access. Upload access sends private drafts and thumbnails; read-only access lets the Draft Manager check privacy, upload, and processing status without publishing anything.

Insert-shot generation defaults to Seedance 2.0 reference-to-video so uploaded insert images guide character design and style without being forced as the literal first frame. Individual insert lines can still use first-frame or first/last-frame generation when exact keyframes matter.

Insert lines can also use `Video upload` mode. In that mode, the script/prompt/generate controls are inactive and the uploaded clip becomes the active preview and trim source.

Keep `NEWTBUILDER_ENABLE_PUBLISHING` unset or `false` while testing locally. The upload endpoint stays locked until that flag is enabled.

## Finishing Layers

After `Render Final`, Approvals includes an optional Finishing Layers panel. Use it for small final-pass additions without reopening the episode build:

- Add image overlays, transparent video/alpha-style graphic clips, or audio layers.
- Set start time, duration, opacity, position, size, volume, and simple audio fades.
- Use the compact layer timeline to preview layer placement, scrub the playhead, move clips, duplicate layers, and trim in/out points with the yellow edge handles.
- Video layers remember their original source duration. If a video layer is extended before the source starts or after the source ends, the extension is shown as a held-frame region and exports as a cloned first/last frame.
- Export Finished Master to create a new master file while preserving the original final render.
- Thumbnail generation, package export, and YouTube private draft upload prefer the finished master when one exists.

## YouTube Promotion Prep

Promotion Prep is inside YouTube Prep. It drafts and exports YouTube-focused copy without posting anything outside the app.

Reusable promotion templates live in Settings. Supported tokens:

```text
{{title}}
{{hook}}
{{youtube_url}}
{{show}}
{{hashtags}}
{{cta}}
```

Package export writes:

```text
promotion-packet.json
promotion-packet.txt
```

External social platform posting is intentionally parked for now. The current app flow stays focused on complete episode creation, thumbnail generation, YouTube prep, and private YouTube draft upload.

## Shot Speaking Tags

NewtBuilder binds visible characters with filename conventions. After upload, add an optional speaking tag to an image when that image is meant for a specific active speaker:

```text
@name
```

Rules:
- Use one tag per image.
- Use the speaking character's name, for example `@Max`, `@Pip`, or `@DetectiveCat`.
- Tags help choose the correct speaking variant and place the first-pass mask over the active speaker.
- Filename binding remains the source of truth for which characters are visible in the image.

## Shot Filename Binder

NewtBuilder can bind shot images by filename. Use uppercase role tokens and underscores:

```text
CU_MAX_01.png
CU_PIP_01.png
CU_GUEST_01.png
MS_MAX-PIP_01.png
MS_MAX-GUEST_01.png
MS_PIP-GUEST_01.png
WS_MAX-PIP_01.png
WS_MAX-PIP-GUEST_01.png
INS_TURTLE-WAVES_01.png
```

Rules:
- `CU` means single-character close-up.
- `MS` means medium/two-shot.
- `WS` means wide shot.
- `INS` means insert shot.
- Use only `MAX`, `PIP`, and `GUEST` as cast tokens. Do not use the guest character's specific name in dialogue shot filenames.
- Put the cast token immediately after the shot prefix, with multiple characters separated by hyphens.
- For `MS` and `WS` images, list cast tokens from left to right as they appear in the frame. Suggested masks use this order to place the first-pass matte over the speaking character.
- Hyphens are preferred between cast tokens, but `WS_MAX_PIP_GUEST_01.png` is also recognized.
- Specific guest names like `CAT` are treated as `GUEST` for compatibility, but `GUEST` is still the clearest token.
- Optional description/location/version text goes after the cast token.

Examples:
- `WS_MAX-PIP-GUEST_CLUBHOUSE_01.png`
- `MS_PIP-GUEST_TABLE_02.png`
- `CU_GUEST_REACTION_01.png`

## Remaining Integrations

The current backend has the main episode workflow wired. Remaining finishing work is mostly provider-account setup and production hardening:

- Add production logging, backup/export, and account-level rate-limit handling.
- Keep public YouTube publishing manual until deliberate scheduling controls are approved.
