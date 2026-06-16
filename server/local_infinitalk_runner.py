#!/usr/bin/env python3
"""Run one InfiniteTalk job from a local InfiniteTalk checkout."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path


def truthy(value: str | None) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def compact(text: str, limit: int = 4000) -> str:
    clean = " ".join(str(text or "").split())
    if len(clean) <= limit:
        return clean
    return clean[-limit:]


def path_for_json(value: str) -> str:
    return str(Path(value).resolve()).replace("\\", "/")


def four_n_plus_one_at_most(value: int, minimum: int = 41, maximum: int = 81) -> int:
    safe = max(minimum, min(maximum, int(value or minimum)))
    return max(minimum, safe - ((safe - 1) % 4))


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: local_infinitalk_runner.py <payload.json>", file=sys.stderr)
        return 2

    payload_path = Path(sys.argv[1]).resolve()
    with payload_path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)

    repo_dir_value = (
        payload.get("repo_dir")
        or os.environ.get("LOCAL_INFINITALK_REPO_DIR")
        or os.environ.get("NEWTBUILDER_INFINITALK_REPO_DIR")
        or os.environ.get("INFINITALK_REPO_DIR")
        or ""
    )
    if not repo_dir_value:
        print(
            json.dumps(
                {
                    "error": "Set LOCAL_INFINITALK_REPO_DIR to the local MeiGen-AI/InfiniteTalk checkout."
                }
            ),
            file=sys.stderr,
        )
        return 1
    repo_dir = Path(repo_dir_value).expanduser()
    repo_dir = repo_dir.resolve()
    script_path = Path(
        payload.get("script_path")
        or os.environ.get("LOCAL_INFINITALK_SCRIPT")
        or repo_dir / "generate_infinitetalk.py"
    ).resolve()
    if not script_path.exists():
        print(json.dumps({"error": f"InfiniteTalk script not found: {script_path}"}), file=sys.stderr)
        return 1

    output_path = Path(payload["output_path"]).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    save_file = str(output_path.with_suffix("")) if output_path.suffix.lower() == ".mp4" else str(output_path)
    final_video_path = Path(f"{save_file}.mp4")

    run_dir = payload_path.parent / f"local-infinitalk-{payload_path.stem}"
    run_dir.mkdir(parents=True, exist_ok=True)
    input_json_path = run_dir / "input.json"
    input_data = {
        "prompt": payload.get("prompt") or ".",
        "cond_video": path_for_json(payload["image_path"]),
        "cond_audio": {"person1": path_for_json(payload["audio_path"])},
    }
    with input_json_path.open("w", encoding="utf-8") as handle:
        json.dump(input_data, handle, indent=2)

    resolution = str(payload.get("resolution") or "720p").strip().lower()
    size = "infinitetalk-480" if resolution == "480p" else "infinitetalk-720"
    max_frame_num = max(41, int(payload.get("num_frames") or 145))
    configured_frame_num = payload.get("frame_num") or os.environ.get("LOCAL_INFINITALK_FRAME_NUM")
    frame_num = four_n_plus_one_at_most(
        int(configured_frame_num or max_frame_num),
        minimum=41,
        maximum=min(81, max_frame_num),
    )

    python = (
        payload.get("python")
        or os.environ.get("LOCAL_INFINITALK_PYTHON")
        or os.environ.get("INFINITALK_PYTHON")
        or sys.executable
    )
    ckpt_dir = payload.get("ckpt_dir") or os.environ.get("LOCAL_INFINITALK_CKPT_DIR") or repo_dir / "weights" / "Wan2.1-I2V-14B-480P"
    wav2vec_dir = payload.get("wav2vec_dir") or os.environ.get("LOCAL_INFINITALK_WAV2VEC_DIR") or repo_dir / "weights" / "chinese-wav2vec2-base"
    infinitalk_dir = (
        payload.get("infinitalk_dir")
        or os.environ.get("LOCAL_INFINITALK_DIR")
        or repo_dir / "weights" / "InfiniteTalk" / "single" / "infinitetalk.safetensors"
    )
    sample_steps = int(payload.get("sample_steps") or os.environ.get("LOCAL_INFINITALK_SAMPLE_STEPS") or 40)
    motion_frame = int(payload.get("motion_frame") or os.environ.get("LOCAL_INFINITALK_MOTION_FRAME") or 9)
    mode = str(payload.get("mode") or os.environ.get("LOCAL_INFINITALK_MODE") or "streaming").strip().lower()
    if mode not in {"clip", "streaming"}:
        mode = "streaming"

    cmd = [
        str(python),
        str(script_path),
        "--ckpt_dir",
        str(Path(ckpt_dir).expanduser()),
        "--wav2vec_dir",
        str(Path(wav2vec_dir).expanduser()),
        "--infinitetalk_dir",
        str(Path(infinitalk_dir).expanduser()),
        "--input_json",
        str(input_json_path),
        "--size",
        size,
        "--sample_steps",
        str(sample_steps),
        "--mode",
        mode,
        "--motion_frame",
        str(motion_frame),
        "--frame_num",
        str(frame_num),
        "--max_frame_num",
        str(max_frame_num),
        "--save_file",
        save_file,
        "--audio_save_dir",
        str(run_dir / "audio"),
    ]

    seed = payload.get("seed")
    if seed is not None:
        cmd.extend(["--base_seed", str(int(seed))])
    text_guide = payload.get("sample_text_guide_scale") or os.environ.get("LOCAL_INFINITALK_TEXT_GUIDE_SCALE")
    if text_guide:
        cmd.extend(["--sample_text_guide_scale", str(text_guide)])
    audio_guide = payload.get("sample_audio_guide_scale") or os.environ.get("LOCAL_INFINITALK_AUDIO_GUIDE_SCALE")
    if audio_guide:
        cmd.extend(["--sample_audio_guide_scale", str(audio_guide)])
    quant = payload.get("quant") or os.environ.get("LOCAL_INFINITALK_QUANT")
    if quant:
        cmd.extend(["--quant", str(quant)])
    quant_dir = payload.get("quant_dir") or os.environ.get("LOCAL_INFINITALK_QUANT_DIR")
    if quant_dir:
        cmd.extend(["--quant_dir", str(Path(quant_dir).expanduser())])
    lora_dir = payload.get("lora_dir") or os.environ.get("LOCAL_INFINITALK_LORA_DIR")
    if lora_dir:
        cmd.extend(["--lora_dir", *[part for part in str(lora_dir).split(os.pathsep) if part]])
    if truthy(str(payload.get("use_teacache", "")) or os.environ.get("LOCAL_INFINITALK_USE_TEACACHE")):
        cmd.append("--use_teacache")
    if truthy(str(payload.get("use_apg", "")) or os.environ.get("LOCAL_INFINITALK_USE_APG")):
        cmd.append("--use_apg")
    if truthy(str(payload.get("low_vram", "")) or os.environ.get("LOCAL_INFINITALK_LOW_VRAM")):
        cmd.extend(["--num_persistent_param_in_dit", "0"])
    t5_cpu = payload.get("t5_cpu")
    if (t5_cpu is not None and truthy(str(t5_cpu))) or (t5_cpu is None and truthy(os.environ.get("LOCAL_INFINITALK_T5_CPU"))):
        cmd.append("--t5_cpu")

    env = os.environ.copy()
    env["PYTHONPATH"] = str(repo_dir) + os.pathsep + env.get("PYTHONPATH", "")
    start = time.time()
    try:
        completed = subprocess.run(
            cmd,
            cwd=str(repo_dir),
            env=env,
            text=True,
            capture_output=True,
            timeout=int(payload.get("timeout_seconds") or os.environ.get("LOCAL_INFINITALK_TIMEOUT_SECONDS") or 7200),
            check=False,
        )
    except subprocess.TimeoutExpired as error:
        print(
            json.dumps(
                {
                    "error": "Local InfiniteTalk timed out.",
                    "stdout": compact(error.stdout or ""),
                    "stderr": compact(error.stderr or ""),
                }
            ),
            file=sys.stderr,
        )
        return 1

    if completed.returncode != 0:
        print(
            json.dumps(
                {
                    "error": f"Local InfiniteTalk exited with code {completed.returncode}.",
                    "stdout": compact(completed.stdout),
                    "stderr": compact(completed.stderr),
                }
            ),
            file=sys.stderr,
        )
        return completed.returncode or 1

    if not final_video_path.exists():
        print(
            json.dumps(
                {
                    "error": f"Local InfiniteTalk completed but did not create {final_video_path}.",
                    "stdout": compact(completed.stdout),
                    "stderr": compact(completed.stderr),
                }
            ),
            file=sys.stderr,
        )
        return 1

    print(
        json.dumps(
            {
                "video": {"path": str(final_video_path), "url": ""},
                "backend": "local",
                "model": "local-infinitalk",
                "size": size,
                "frame_num": frame_num,
                "max_frame_num": max_frame_num,
                "elapsed_seconds": round(time.time() - start, 3),
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
