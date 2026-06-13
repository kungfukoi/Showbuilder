# NewtBuilder Checkpoint

Date: 2026-06-01

## Current Stable State

- The core NewtBuilder flow is working end to end: show setup, script package, image assets, production map, drawn masks, voice/audio review, preview/final render, optional finishing layers, AI thumbnail generation, and YouTube private draft upload.
- Navigation now uses a clear project hierarchy: Show Library, Show Dashboard, then Episode Workspace.
- Current tested episode: `Level 10 with Pip and Max - Stickers Episode`
- Current final render: `/outputs/final-renders/Level-10-with-Pip-and-Max---Stickers-Episode-683b2b04-3fa5-4d6d-9b7e-f72957f6d4bc-final.mp4`
- Current YouTube private draft: `https://youtu.be/IqsT6Boe6Ik`
- Current YouTube Studio edit link: `https://studio.youtube.com/video/IqsT6Boe6Ik/edit`
- Current selected YouTube thumbnail status: custom thumbnail set.
- Publishing is enabled for private draft upload only. NewtBuilder does not auto-public publish.

## Locked-In UI State

- NewtBuilder opens to a Show Library with saved show cards, previews, episode counts, rename/delete controls, and a `New Show` action.
- Opening a show now shows a Show Dashboard with saved episode cards, status labels, project thumbnails, and `Open Studio` / `Open Review` actions.
- The episode editor remains the existing Studio / Approvals workspace, entered from an episode card or `New Episode`.
- Main navigation is now `Studio` and `Approvals`.
- `Settings` is an icon-only top control next to the show rename/delete controls and before `New Episode`.
- `Studio` owns show identity, characters, script package, visual assets, and production map setup.
- `Approvals` owns render review, thumbnail review, YouTube prep, and final handoff.
- `Save Episode` stays on the Studio page and does not auto-navigate.
- YouTube Prep main actions are intentionally simple: `Save YouTube Prep`, `Check YouTube Status`, and `Open Studio`.
- Advanced YouTube/file actions are collapsed under `Advanced & files`: package export, duplicate private draft upload, metadata, upload text, and open draft.
- The YouTube completion view opens by default in Approvals after a draft exists and shows final video, thumbnail, draft, schedule status, final QA, and Studio handoff in one place.
- Approvals includes an optional Finishing Layers row after render readiness and before thumbnails.
- Settings shows YouTube privacy as `Private draft` only; public publishing remains outside the app.

## Locked-In Production State

- Fabric is restored as the default lip-sync model.
- Kling can still be toggled per dialogue shot when desired.
- Drawn speaker masks are the active masking workflow.
- Saved drawn masks auto-reuse across matching shots with the same image and speaker/character.
- Insert shots support generated video clips with simple trim controls and playback from in/out points.
- AI thumbnails use the selected render/stills and app-provided prompt information, and only the AI candidates are presented for final selection.
- Finishing Layers can add post-render image overlays, video/alpha-style overlays, and audio layers with start/duration controls, opacity/position/size, volume, and fades.
- Finishing Layers now has a compact Premiere-style timeline with a base video lane, overlay/audio lanes, a scrub-capable preview playhead, live visual overlay preview for image/video layers, draggable layer blocks, duplicate layer controls, and yellow trim handles for in/out edits.
- Video finishing layers store their source duration. Extending a video before the original source start marks the beginning as a held first-frame section; extending beyond the source end marks the ending as a held final-frame section. Both regions export as cloned frames.
- Finishing layer imports are now guarded against repeat uploads. Re-importing the same source file is skipped, and old accidental identical imports are collapsed in the editor; use Duplicate when an intentional second copy is needed.
- Export Finished Master preserves the original final render, writes a new finished master, and makes thumbnail generation, package export, and YouTube private draft upload prefer that master.

## YouTube Handoff Boundary

- NewtBuilder can upload a private YouTube draft and set the selected thumbnail.
- NewtBuilder can store target publish time, publish notes, and a local `ready to publish` state.
- NewtBuilder can check YouTube draft status after reconnecting YouTube with upload + read-only scopes.
- NewtBuilder should keep public publishing manual through YouTube Studio until multiple private draft uploads are proven reliable.

## Most Recent Cleanup

- Removed the stale standalone Promotion Prep panel from Approvals. Promotion drafting now lives only inside YouTube Prep, which avoids duplicate save/draft controls.
- Removed the unused campaign-prep component, validation helper, and orphan CSS from the frontend.
- README now describes reusable episode formats instead of short-only defaults.
- README now documents the Show/Episode project structure.
- `Save All Maps` was renamed to `Save Episode` to match the project hierarchy.
- YouTube status/upload scopes were renamed internally for clarity.
- YouTube upload output replacement now filters by output id instead of object identity.
- YouTube status check errors now give a clear reconnect instruction when the old OAuth token lacks read-only scope.
- Editing YouTube prep resets stale `ready to publish` state.
- Settings icon class handling and settings grid CSS were cleaned up.
- Promotion Prep now includes YouTube Community and pinned-comment drafts only, keeping the app focused on YouTube.
- Promotion templates are now show-level settings with tokens for title, hook, YouTube URL, show name, hashtags, and CTA.
- Promotion Prep now shows readiness badges for YouTube Community and pinned comment.
- Export Package now writes `promotion-packet.json` and `promotion-packet.txt` alongside the legacy campaign files. The packet fills saved `[YouTube link]` placeholders with the current private draft URL when one exists.
- Finishing Layers backend endpoints were added for layer asset upload, layer timeline save, and finished master export.
- Finished masters are now selected ahead of raw final renders for thumbnails, package export, and YouTube draft upload.
- External social posting hooks are intentionally deferred. The current completion target is full episode creation, AI thumbnail selection, and private YouTube draft upload.
- Current checks pass: `node --check server/index.js`, `npm run build`, API health, and browser UI verification.

## Recommended Next Step

- Finish YouTube-only hardening first: stable render package export, private draft upload, thumbnail set/retry, status checks, and manual Studio handoff.
- Keep non-YouTube social platform posting parked until the YouTube workflow has been proven across several client episodes.

Date: 2026-05-14

## Stable State

- Fresh episode setup, script upload, shot image upload, insert generation, ElevenLabs voice selection, preview render, and final render are working.
- Latest successful episode id: `db701e7c-269e-43a4-997e-822e8a41f384`
- Latest successful preview: `/outputs/previews/Newt-Shorts-Episode-d546964b-c3d0-419e-933d-f790e32ec33a.mp4`
- Latest successful final render: `/outputs/final-renders/Newt-Shorts-Episode-66e3b556-52ac-442a-bfa3-3ffc47a1e825-final.mp4`
- Publishing remains disabled for local testing.

## Locked-In Features

- Approval flow runs from the Approvals page.
- Main navigation is now Studio, Approvals, and Settings.
- Studio owns show identity, characters, script package, visual assets, and production map setup.
- Settings owns short format, automation toggles, creative defaults, and publishing defaults.
- Approvals now has a Render Readiness checklist for setup and review checks before preview/final render.
- Approvals now has a Thumbnail Review panel that generates AI candidates through Fal `openai/gpt-image-2/edit`, using a render frame plus uploaded shot assets as image-to-image references.
- The Thumbnail Review panel includes a user-editable Image 2 brief: dynamic super text, generation prompt, and provided episode information.
- Generating thumbnails replaces previous thumbnail candidates, and the app displays the current three AI candidates with click-to-select final thumbnail approval.
- Thumbnail Review is now collapsed by default, the still-frame selector was removed, and the latest local report summary was removed from the main Approvals view.
- Thumbnail and Preflight Checklist now use the same compact collapsible row format as Package Draft and Local Outputs; Preflight sits beneath the render review area.
- Approvals now has a Final Package row. Export Package copies the final video and selected thumbnail into `/outputs/packages/...` with `youtube-metadata.json` and `youtube-upload.txt`.
- Set `NEWTBUILDER_THUMBNAIL_PROVIDER=local` to use the old no-credit frame-grab fallback.
- `Build Preview` saves the production map before rendering.
- `Render Final` uses the approved preview/audio workflow.
- ElevenLabs voices are available from the app dropdown.
- Kling Avatar lip-sync runs through fal when configured.
- Insert-shot generation and trim controls are in place.
- Drawn speaker masks are the official masking workflow.
- A drawn mask is created from the shot thumbnail and is automatically reused for matching lines with the same shot image and speaker/character.

## Current Known Limitation

- Multi-character Kling Avatar scenes may still need masking because shared frames can animate more than the selected speaker.
- The current best workflow is manual drawn masks because it gives the user reliable control over exactly which character region Kling is allowed to show.

## Retired Mask Experiments

- Built-in split mattes, fal EVF-SAM automatic masks, and local soft garbage mattes were tested and removed from the active app flow.
- Those approaches were either too brittle, too slow, or too likely to cover the wrong region for the current episode-building needs.
- Existing old mask image assets can remain in saved episode data, but the app should guide new work through drawn masks only.

## Drawn Mask Workflow

- The Production Map now hides the old mask dropdown, invert toggle, mask checkbox, detect-mask button, and soft-matte button.
- Each dialogue line shows its assigned shot thumbnail and a single `Add Mask` / `Edit Mask` action.
- The mask editor lets the user brush or erase directly over the shot image, then creates a black/white PNG mask from the painted area.
- Brush sizing is based on the visible editor image, so large brush sizes cover large visible areas even when the source image is high resolution.
- Painted area means Kling animation is allowed there; everything unpainted stays as the clean still image.
- Saved drawn masks are auto-applied to matching lines that share the same shot image and speaker/character.
