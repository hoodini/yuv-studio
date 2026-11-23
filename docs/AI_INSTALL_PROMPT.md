# AI install prompt

Download the studio, paste one prompt, and your AI agent does the rest: it finds the zip, installs whatever is missing for your operating system (Node.js, ffmpeg, Python, the Whisper models, GPU support), builds and starts the studio, connects itself to it and checks that everything works.

**Where to paste it:** any AI agent that can run commands on your computer: Claude Code (the Code tab of the Claude desktop app, or the terminal), Codex, Cursor, Gemini CLI, or VS Code in agent mode. A chat that cannot run commands (claude.ai in the browser, ChatGPT on the web) cannot install anything.

**What it will ask you:** almost nothing. Your computer may ask you to approve an installer (Windows) or to type your password (macOS and Linux, for Homebrew or apt). It never asks for your API keys: you enter those in the studio itself, later, if you want narration or the AI agent.

**How long:** 10 to 30 minutes, mostly downloading. The Whisper models for captions are 1.5 to 3 GB.

````text
Install YUV.AI Studio on this computer and get it running, completely by yourself. It is a
video editor that runs in the browser, on this computer. Do every step yourself, check that
it worked, and fix what fails. Ask me only when you truly cannot continue without me (an
installer that needs my approval or password). Talk to me in the language I write to you in;
if this prompt is all I wrote, use the language of my operating system.

Rules: install only free software from the official sources below. Never ask me for API keys
or passwords in the chat; I enter keys in the studio myself. Do not open the studio to the
network: no firewall changes, no STUDIO_ALLOWED_HOSTS, no port forwarding.

1. Look around first and tell me in two lines what you found:
   - operating system, version and CPU (Windows, macOS Intel or Apple Silicon, Linux distro)
   - an NVIDIA GPU? (nvidia-smi)
   - what is already installed: node -v (need 22+), ffmpeg -version, ffprobe -version,
     Python 3.10-3.13, git, and Chrome, Edge or Chromium.

2. Find the studio:
   a. If the current folder, or ~/yuv-studio (Windows: %USERPROFILE%\yuv-studio), already has
      a package.json with "name": "yuv-studio", use it.
   b. Otherwise look for the newest yuv-studio-*.zip in Downloads (then Desktop) and extract it
      (Windows: Expand-Archive; macOS: ditto -x -k or unzip; a minimal Linux may have no unzip
      and no python3 yet: install unzip with the package manager first).
      The zip holds one folder; move its contents to ~/yuv-studio (Windows:
      %USERPROFILE%\yuv-studio). If ~/yuv-studio already exists, this is an update: keep its
      data/ folder and its .env file, replace everything else.
   c. Otherwise clone it there: git clone https://github.com/hoodini/yuv-studio.git

3. Install what is missing, without asking, using the system's package manager:
   - Windows (winget, add --accept-source-agreements --accept-package-agreements -e):
     OpenJS.NodeJS.LTS, Gyan.FFmpeg, Python.Python.3.12. Edge is built in.
     After installing, reload PATH in your shell:
     $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
   - macOS: Homebrew first if missing (from https://brew.sh; it asks me for my password,
     tell me so before), then: brew install node ffmpeg python@3.12, and
     brew install --cask google-chrome if there is no Chrome, Edge or Chromium.
   - Linux: apt, dnf or pacman for ffmpeg, python3, python3-venv and chromium. If the
     distro's Node is older than 22, install Node 22 LTS from nodejs.org or NodeSource.
   Check each one again after installing (node -v, ffmpeg -version, python --version).

4. Captions on this computer (Whisper):
   - In the studio folder: python -m venv .venv, then with that environment's pip:
     pip install --upgrade pip "faster-whisper>=1.1" opencv-python-headless onnxruntime
     (OpenCV is for the vertical reframe that follows the face, ONNX Runtime for background removal;
     with an NVIDIA GPU install onnxruntime-gpu instead of onnxruntime.)
   - NVIDIA GPU on Windows or Linux: also pip install nvidia-cublas-cu12 "nvidia-cudnn-cu12==9.*"
     in the same environment (the studio finds them there, no system CUDA needed).
   - Create .env from .env.example if there is none, and set in it:
     STUDIO_PYTHON=<full path to the python inside .venv>
     Without an NVIDIA GPU (and on every Mac), also set, so captions do not take forever:
     WHISPER_MODEL_EN=large-v3-turbo
     WHISPER_MODEL_AUTO=large-v3-turbo
   - Download the models now, so the first captions do not wait for them:
     .venv python -c "from faster_whisper import WhisperModel as W; W('ivrit-ai/whisper-large-v3-turbo-ct2', device='cpu', compute_type='int8'); W('<the WHISPER_MODEL_EN value, or large-v3>', device='cpu', compute_type='int8')"
   If any of this fails and you cannot fix it, go on: tell me at the end that captions can
   use an OpenAI, Groq or ElevenLabs key instead (Captions tab > settings in the studio).

5. Build: in the studio folder run npm install, then npm run build.

6. Start it in the background so it keeps running after you finish: npm start (Windows:
   start it in a separate minimized window). Wait until http://127.0.0.1:5177/api/health
   answers {"ok":true}. If port 5177 is taken by an older studio, stop that one first.

7. Make it easy to open again: put a launcher named "YUV.AI Studio" on my desktop that starts
   the studio from its folder (npm start) and opens http://127.0.0.1:5177 a few seconds later:
   a .cmd file on Windows, a .command file on macOS (chmod +x), a .desktop file on Linux.

8. Connect yourself to the studio over MCP, so I can ask you to edit videos:
   - Claude Code: claude mcp add --transport http --scope user yuv-studio http://127.0.0.1:5177/mcp
   - Codex, Cursor, VS Code, Gemini CLI or Claude Desktop: follow docs/MCP.md in the studio folder.
   Then call list_projects to confirm it answers. If you cannot add an MCP server where you
   run, skip this step and say so.

9. Check that it really works, with generated test media only:
   - ffmpeg -f lavfi -i testsrc2=s=1280x720:r=30:d=5 -f lavfi -i sine=f=440:d=5 -c:v libx264 -pix_fmt yuv420p -c:a aac test.mp4
   - Through MCP (or the REST API in docs/API.md): create a project "Install check", import
     test.mp4 onto the timeline, cut 1 to 2 seconds, add the title "It works" for 2 seconds,
     export with quality "draft". Check with ffprobe that the MP4 exists and is about 4 s long.
   - GET http://127.0.0.1:5177/api/settings and look at status: local should be true if step 4
     worked. Run one transcription of test.mp4 (POST /api/projects/<id>/transcribe with its
     assetId and language "en") to prove Whisper loads; it has no speech, so no words is fine.
   - Delete the "Install check" project and test.mp4.

10. Open http://127.0.0.1:5177 in my browser. Then tell me, short:
    - that it works, where it is installed, and how to open it again (the desktop launcher)
    - whether captions run on this computer (GPU or CPU) or need a cloud key
    - optional extras I can add in the studio myself: a Cartesia key for narration in my own
      voice (Voice tab), a key or a local model for the built-in AI agent (AI agent tab)
    - anything that failed, with the exact error and what I can do about it
````

## After it is installed

Ask the same agent to edit, for example:

```text
Import C:/Videos/raw.mp4 into a new project in YUV.AI Studio, remove the silences, add Hebrew
captions and tell me when it is ready for me to review in the browser.
```

```text
Make English captions for my Hebrew video "Talk" in YUV.AI Studio, keep the Hebrew ones too,
and export a 9:16 version.
```

To update later, run git pull in the studio folder (or download the new zip) and paste the same prompt: it keeps your projects and settings.
