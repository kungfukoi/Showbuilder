# Puppet Lip-Sync ComfyUI Workflow Pack

These workflows are for local ComfyUI Desktop testing of puppet-style audio-driven animation.
Open them from ComfyUI with `Workflow > Open`, then replace the sample image/audio inputs with files from your local `ComfyUI/input` folder.

## Workflows

| File | Model | Source | Why test it |
| --- | --- | --- | --- |
| `echomimic-v3-flash-workflow.json` | EchoMimic V3 Flash | `smthemex/ComfyUI_EchoMimic` | First puppet-style test. Lower-step/lower-VRAM path, good for quick iteration. |
| `echomimic-v3-workflow.json` | EchoMimic V3 | `smthemex/ComfyUI_EchoMimic` | Higher-quality EchoMimic V3 path when the flash result is promising. |
| `fantasy-talking-i2v-workflow.json` | FantasyTalking | `kijai/ComfyUI-WanVideoWrapper` | Promptable talking portrait/body motion, useful for more acted puppet performance. |
| `longcat-avatar-audio-image-to-video-workflow.json` | LongCat Video Avatar | `kijai/ComfyUI-WanVideoWrapper` | Newer avatar model aimed at audio-driven stylized/human animation. |

## Required Custom Nodes

- EchoMimic workflows: `https://github.com/smthemex/ComfyUI_EchoMimic`
- FantasyTalking and LongCat workflows: `https://github.com/kijai/ComfyUI-WanVideoWrapper`
- You will probably also need ComfyUI video/audio utility nodes already referenced by each workflow. Use ComfyUI Manager's missing-node installer after opening the workflow.

## MultiTalk Status

I did not include a MultiTalk JSON because I could not find a current importable MultiTalk workflow in Kijai's public `example_workflows` folder. The current WanVideoWrapper repo does include `multitalk/` implementation code, but its example workflow list contains FantasyTalking, InfiniteTalk, LongCat, SkyReels talking avatar, and others rather than a MultiTalk workflow file.

Practical path for testing now:

1. Test `longcat-avatar-audio-image-to-video-workflow.json` as the likely successor/closest local avatar route.
2. Keep an eye on `https://github.com/kijai/ComfyUI-WanVideoWrapper/tree/main/example_workflows` for a future MultiTalk workflow.
3. If a MultiTalk JSON appears, drop it in this folder and add it to `manifest.json`.

## Test Order

1. `echomimic-v3-flash-workflow.json`
2. `echomimic-v3-workflow.json`
3. `longcat-avatar-audio-image-to-video-workflow.json`
4. `fantasy-talking-i2v-workflow.json`

For NewtBuilder's puppet style, EchoMimic should be the fastest signal. LongCat/FantasyTalking are heavier but may produce more complete character motion.
