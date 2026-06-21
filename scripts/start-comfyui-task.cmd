@echo off
chcp 65001 > nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
cd /d D:\_AI\Comfyui_1_0_4\ComfyUI
"D:\_AI\Comfyui_1_0_4\ComfyUI\.venv\Scripts\python.exe" main.py --listen 127.0.0.1 --port 8189 > C:\dev\NewtBuilder\.newtbuilder_logs\comfyui.log 2> C:\dev\NewtBuilder\.newtbuilder_logs\comfyui.err.log
