#!/usr/bin/env python3
"""Run one Creatify Aurora lip-sync job through fal_client."""

from __future__ import annotations

import json
import os
import sys

import fal_client
from fal_client.client import FalClientHTTPError


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: fal_aurora_runner.py <payload.json>", file=sys.stderr)
        return 2

    with open(sys.argv[1], "r", encoding="utf-8") as handle:
        payload = json.load(handle)

    if os.environ.get("FAL_KEY") and not os.environ.get("FAL_API_KEY"):
        os.environ["FAL_API_KEY"] = os.environ["FAL_KEY"]

    image_url = fal_client.upload_file(payload["image_path"])
    audio_url = fal_client.upload_file(payload["audio_path"])
    arguments = {
        "image_url": image_url,
        "audio_url": audio_url,
        "prompt": payload.get("prompt") or "",
        "guidance_scale": payload.get("guidance_scale", 1),
        "audio_guidance_scale": payload.get("audio_guidance_scale", 2),
        "resolution": payload.get("resolution") or "720p",
    }

    model = payload.get("model") or "fal-ai/creatify/aurora"
    try:
        result = fal_client.subscribe(model, arguments=arguments, with_logs=True)
    except FalClientHTTPError as error:
        detail = {
            "message": str(error),
            "status_code": error.status_code,
        }
        try:
            detail["response"] = error.response.json()
        except Exception:
            detail["response"] = error.response.text
        print(json.dumps({"error": detail}), file=sys.stderr)
        return 1

    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
