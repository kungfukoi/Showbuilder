import "dotenv/config";

import cors from "cors";
import express from "express";
import multer from "multer";
import path from "node:path";
import http from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rm, writeFile, stat } from "node:fs/promises";
import { promisify } from "node:util";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const falFabricRunnerPath = path.join(__dirname, "fal_fabric_runner.py");
const falKlingAvatarRunnerPath = path.join(__dirname, "fal_kling_avatar_runner.py");
const falAuroraRunnerPath = path.join(__dirname, "fal_aurora_runner.py");
const falInfiniteTalkRunnerPath = path.join(__dirname, "fal_infinitalk_runner.py");
const localInfiniteTalkRunnerPath = path.join(__dirname, "local_infinitalk_runner.py");
const defaultComfyUiStartScriptPath = path.join(rootDir, "scripts", process.platform === "win32" ? "start-comfyui-task.cmd" : "start-comfyui-task.sh");
const dataDir = path.join(__dirname, "data");
const uploadsDir = path.join(rootDir, "uploads");
const outputsDir = path.join(rootDir, "outputs");
const logsDir = path.join(rootDir, ".newtbuilder_logs");
const showsPath = path.join(dataDir, "shows.json");
const episodesPath = path.join(dataDir, "episodes.json");
const jobsPath = path.join(dataDir, "jobs.json");
const voicesPath = path.join(dataDir, "voices-cache.json");
const youtubeAuthPath = path.join(dataDir, "youtube-oauth.json");
const port = Number(process.env.PORT || 3334);
const execFileRawAsync = promisify(execFile);
function execFileAsync(command, args = [], options = {}) {
  return execFileRawAsync(command, args, { windowsHide: true, ...options });
}
const publishingEnabled = String(process.env.NEWTBUILDER_ENABLE_PUBLISHING || "").toLowerCase() === "true";
const configuredShortsThumbnailFrameSeconds = Number(process.env.YOUTUBE_SHORTS_THUMBNAIL_SECONDS || 0.75);
const shortsThumbnailFrameSeconds = Number.isFinite(configuredShortsThumbnailFrameSeconds)
  ? Math.min(3, Math.max(0.2, configuredShortsThumbnailFrameSeconds))
  : 0.75;
const elevenLabsApiKey = process.env.ELEVEN_API_KEY || process.env.XI_API_KEY || "";
const falApiKey = process.env.FAL_KEY || process.env.FAL_API_KEY || "";
const openAiApiKey = process.env.OPENAI_API_KEY || "";
const insertTrimDefaultSeconds = 2;
const autoSpeakerMaskVersion = "auto-speaker-mask-v2";
const youtubeScopeList = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly"
];
const youtubeScopes = youtubeScopeList.join(" ");
const youtubeUploadScope = "https://www.googleapis.com/auth/youtube.upload";
const youtubeReadScope = "https://www.googleapis.com/auth/youtube.readonly";
const youtubeOAuthStates = new Map();
let comfyUiAutoStartPromise = null;
const comfyUiProgressEntries = new Map();
const ffmpegPath = resolveMediaToolCommand("FFMPEG_PATH", "ffmpeg", [
  path.join(rootDir, "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"),
  "C:/dev/tools/ffmpeg-8.1.1-essentials_build/bin/ffmpeg.exe",
  "C:/dev/Newt_Node/node_modules/ffmpeg-static/ffmpeg.exe"
]);
const ffprobePath = resolveMediaToolCommand("FFPROBE_PATH", "ffprobe", [
  "C:/dev/tools/ffmpeg-8.1.1-essentials_build/bin/ffprobe.exe",
  path.join(path.dirname(ffmpegPath), process.platform === "win32" ? "ffprobe.exe" : "ffprobe")
]);
const realEsrganPath = resolveMediaToolCommand("REALESRGAN_NCNN_PATH", "realesrgan-ncnn-vulkan", [
  "C:/dev/tools/realesrgan-ncnn-vulkan/realesrgan-ncnn-vulkan.exe",
  path.join(rootDir, "tools", "realesrgan-ncnn-vulkan", process.platform === "win32" ? "realesrgan-ncnn-vulkan.exe" : "realesrgan-ncnn-vulkan")
]);

const app = express();

await Promise.all([
  mkdir(dataDir, { recursive: true }),
  mkdir(uploadsDir, { recursive: true }),
  mkdir(outputsDir, { recursive: true })
]);

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, uploadsDir),
  filename: (_req, file, callback) => {
    const extension = path.extname(file.originalname);
    const basename = path
      .basename(file.originalname, extension)
      .replace(/[^a-z0-9_-]+/gi, "-")
      .slice(0, 80) || "script";
    callback(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}-${basename}${extension || ".txt"}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 1024 * 1024 * 1024,
    files: 12
  }
});

const approvalTemplates = [
  {
    id: "script_plan",
    title: "Script Plan",
    stage: "Planning",
    actionLabel: "Approve Plan",
    requiresHumanApproval: true
  },
  {
    id: "voice_audio",
    title: "Voice & Audio",
    stage: "Audio",
    actionLabel: "Approve Audio",
    requiresHumanApproval: true
  },
  {
    id: "render_preview",
    title: "Episode Render",
    stage: "Render",
    actionLabel: "Approve Render",
    requiresHumanApproval: true
  }
];

const automationDefaults = {
  parseScript: true,
  generateVoices: false,
  renderEpisode: false,
  generateInsertVideos: false,
  generateThumbnails: true,
  draftYoutubeMetadata: true,
  uploadYoutube: false,
  draftSocialCampaign: true,
  postSocialCampaign: false
};

const promotionTemplateDefaults = {
  youtubeCommunity: "{{title}}\n\n{{hook}}\n\nWatch here: {{youtube_url}}\n\n{{hashtags}}",
  pinnedComment: "Thanks for watching {{title}}. What moment stood out to you? Subscribe for the next episode."
};

const campaignPlatformLimits = {
  youtubeCommunity: 1500,
  pinnedComment: 500
};

const shortFormatDefaults = {
  aspectRatio: "9:16",
  resolution: "1080x1920",
  wordsPerMinute: 145,
  fps: 30,
  container: "mp4",
  videoCodec: "h264",
  audioCodec: "aac",
  audioSampleRate: 48000
};

const standardFormatResolutions = {
  "9:16": new Set(["540x960", "720x1280", "1080x1920", "1440x2560", "2160x3840"]),
  "16:9": new Set(["960x540", "1280x720", "1920x1080", "2560x1440", "3840x2160"])
};
const lipSyncInputPromptMaxLength = 2400;
const lipSyncFullPromptMaxLength = 3600;
const animationStrengthDefault = 1;
const defaultComfyUiInfiniteTalkNegativePrompt = [
  "pupils",
  "irises",
  "eyeballs",
  "sclera",
  "human eyes",
  "realistic eyes",
  "CG eyes",
  "3D eyes",
  "cartoon eyes",
  "animated eyes",
  "anime eyes",
  "cute eyes",
  "round cartoon eyes",
  "drawn eyeballs",
  "plastic eyes",
  "wet eyes",
  "white eyes",
  "eye whites",
  "catchlights in eyes",
  "eye reflections",
  "glass eyes",
  "eyelids opening over eyeballs",
  "realistic human facial anatomy",
  "naturalistic facial motion",
  "bright tones",
  "overexposed",
  "static",
  "blurred details",
  "subtitles",
  "style",
  "works",
  "paintings",
  "images",
  "overall gray",
  "worst quality",
  "low quality",
  "JPEG compression residue",
  "ugly",
  "incomplete",
  "extra fingers",
  "poorly drawn hands",
  "poorly drawn faces",
  "deformed",
  "disfigured",
  "misshapen limbs",
  "fused fingers",
  "still picture",
  "messy background",
  "three legs",
  "many people in the background",
  "walking backwards"
].join(", ");

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use("/uploads", express.static(uploadsDir));
app.use("/outputs", express.static(outputsDir));

app.get("/api/health", async (_req, res) => {
  const youtube = await youtubeOAuthStatus();
  const comfyUi = await comfyUiHealthStatus();
  res.json({
    ok: true,
    app: "NewtBuilder",
    server: {
      baseUrl: `http://127.0.0.1:${port}`,
      port
    },
    dataDirectory: dataDir,
    outputDirectory: outputsDir,
    features: {
      shortsThumbnailUploadFrame: true,
      shortsThumbnailFrameSeconds
    },
    integrations: {
      youtube: youtube.connected,
      openai: Boolean(process.env.OPENAI_API_KEY),
      elevenlabs: Boolean(elevenLabsApiKey),
      fal: Boolean(falApiKey),
      infinitalkLocal: localInfiniteTalkConfigured(),
      comfyui: comfyUi.reachable,
      infinitalkComfyUi: comfyUi.reachable && comfyUiInfiniteTalkConfigured()
    },
    comfyUi,
    safety: {
      publishingEnabled,
      mode: publishingEnabled ? "publishing-capable" : "local-test-only",
      youtubeDraftOnly: true
    },
    youtube
  });
});

app.get("/api/episodes/:id/comfyui-progress", (req, res) => {
  cleanupComfyUiProgressEntries();
  const episodeId = String(req.params.id || "").trim();
  const items = [...comfyUiProgressEntries.values()]
    .filter((entry) => entry.episodeId === episodeId)
    .sort((a, b) => Date.parse(b.updatedAt || b.startedAt || "") - Date.parse(a.updatedAt || a.startedAt || ""));
  res.json({ items });
});

app.post("/api/system/choose-folder", async (req, res) => {
  try {
    const selectedPath = await selectFolderWithDialog({
      title: String(req.body?.title || "Choose folder"),
      defaultPath: String(req.body?.defaultPath || "")
    });
    res.json({ path: selectedPath });
  } catch (error) {
    if (error.code === "DIALOG_CANCELED") {
      return res.json({ path: "", canceled: true });
    }
    res.status(400).json({ error: cleanErrorMessage(error) });
  }
});

app.post("/api/system/newtbuilder/restart", async (_req, res) => {
  res.json({ ok: true, message: "NewtBuilder backend restart requested." });
  scheduleNewtBuilderRestart();
});

app.post("/api/system/comfyui/restart", async (_req, res) => {
  try {
    const comfyUi = await restartComfyUiBackend();
    const youtube = await youtubeOAuthStatus();
    const health = {
      ok: true,
      app: "NewtBuilder",
      server: {
        baseUrl: `http://127.0.0.1:${port}`,
        port
      },
      dataDirectory: dataDir,
      outputDirectory: outputsDir,
      features: {
        shortsThumbnailUploadFrame: true,
        shortsThumbnailFrameSeconds
      },
      integrations: {
        youtube: youtube.connected,
        openai: Boolean(process.env.OPENAI_API_KEY),
        elevenlabs: Boolean(elevenLabsApiKey),
        fal: Boolean(falApiKey),
        infinitalkLocal: localInfiniteTalkConfigured(),
        comfyui: comfyUi.reachable,
        infinitalkComfyUi: comfyUi.reachable && comfyUiInfiniteTalkConfigured()
      },
      comfyUi,
      safety: {
        publishingEnabled,
        mode: publishingEnabled ? "publishing-capable" : "local-test-only",
        youtubeDraftOnly: true
      },
      youtube
    };
    res.json({ ok: true, message: "ComfyUI restarted.", health });
  } catch (error) {
    const comfyUi = await comfyUiHealthStatus().catch(() => null);
    res.status(400).json({ error: cleanErrorMessage(error), comfyUi });
  }
});

app.get("/api/youtube/connect-url", async (_req, res) => {
  if (!youtubeOAuthClientConfigured()) {
    return res.status(400).json({
      error: "Add YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET before connecting YouTube."
    });
  }

  const state = randomUUID();
  youtubeOAuthStates.set(state, Date.now());
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", process.env.YOUTUBE_CLIENT_ID || "");
  authUrl.searchParams.set("redirect_uri", youtubeRedirectUri());
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", youtubeScopes);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("include_granted_scopes", "true");
  authUrl.searchParams.set("state", state);

  res.json({
    authUrl: authUrl.toString(),
    redirectUri: youtubeRedirectUri(),
    scope: youtubeScopes
  });
});

app.get("/api/youtube/oauth/callback", async (req, res) => {
  try {
    const error = String(req.query.error || "");
    if (error) {
      throw new Error(`Google OAuth returned: ${error}`);
    }
    const state = String(req.query.state || "");
    const stateCreatedAt = youtubeOAuthStates.get(state);
    youtubeOAuthStates.delete(state);
    if (!stateCreatedAt || Date.now() - stateCreatedAt > 10 * 60 * 1000) {
      throw new Error("OAuth state expired. Start the YouTube connection again from NewtBuilder.");
    }
    const code = String(req.query.code || "");
    if (!code) {
      throw new Error("Google did not return an OAuth authorization code.");
    }

    const token = await exchangeYouTubeAuthorizationCode(code);
    const existing = await readYouTubeOAuth();
    const refreshToken = token.refresh_token || existing.refreshToken || "";
    if (!refreshToken) {
      throw new Error("Google did not return a refresh token. Try connecting again and make sure consent is accepted.");
    }

    const stored = {
      refreshToken,
      scope: token.scope || youtubeScopes,
      tokenType: token.token_type || "Bearer",
      connectedAt: new Date().toISOString()
    };
    await writeFile(youtubeAuthPath, JSON.stringify(stored, null, 2));
    res.type("html").send(youtubeOAuthHtml("YouTube connected", "YouTube is connected for private draft uploads. Return to NewtBuilder to continue.", true));
  } catch (error) {
    res.status(400).type("html").send(youtubeOAuthHtml("YouTube connection failed", cleanErrorMessage(error)));
  }
});

app.get("/api/voices", async (_req, res) => {
  if (elevenLabsApiKey) {
    try {
      const voices = await fetchElevenLabsVoices();
      if (voices.length) {
        const voiceOptions = withDemoVoiceOptions(voices);
        await writeFile(voicesPath, JSON.stringify({ voices: voiceOptions, cachedAt: new Date().toISOString() }, null, 2));
        return res.json({ voices: voiceOptions, source: "elevenlabs" });
      }
    } catch {
      // Fall through to cached/demo voices.
    }
  }

  const cached = await readJson(voicesPath, null);
  if (cached?.voices?.length) {
    return res.json({ voices: withDemoVoiceOptions(cached.voices), source: "cache" });
  }

  res.json({
    source: "demo",
    voices: demoVoiceOptions()
  });
});

app.get("/api/shows", async (_req, res) => {
  res.json(await readShows());
});

app.post("/api/shows", async (req, res) => {
  const shows = await readShows();
  const now = new Date().toISOString();
  const requestedId = cleanId(req.body.id);
  const existing = requestedId ? shows.find((show) => show.id === requestedId) : null;
  const show = normalizeShow({
    ...(existing || {}),
    ...req.body,
    id: requestedId || existing?.id || randomUUID(),
    createdAt: existing?.createdAt || now,
    updatedAt: now
  });

  const nextShows = [show, ...shows.filter((item) => item.id !== show.id)];
  await writeShows(nextShows);
  res.json(show);
});

app.patch("/api/shows/:id", async (req, res) => {
  const shows = await readShows();
  const current = shows.find((show) => show.id === req.params.id);
  if (!current) {
    return res.status(404).json({ error: "Show not found." });
  }

  const updated = normalizeShow({
    ...current,
    ...req.body,
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString()
  });
  const propagated = propagateShowFormatToEpisodes(await readEpisodes(), updated);
  await writeShows([updated, ...shows.filter((show) => show.id !== updated.id)]);
  if (propagated.changedCount) {
    await writeEpisodes(propagated.episodes);
  }
  res.json(updated);
});

app.delete("/api/shows/:id", async (req, res) => {
  const shows = await readShows();
  const current = shows.find((show) => show.id === req.params.id);
  if (!current) {
    return res.status(404).json({ error: "Show not found." });
  }

  const episodes = await readEpisodes();
  const deletedEpisodes = episodes.filter((episode) => episode.showId === current.id);
  const nextEpisodes = episodes.filter((episode) => episode.showId !== current.id);
  for (const episode of deletedEpisodes) {
    for (const asset of episode.assets || []) {
      await deleteStoredUploadIfUnreferenced(asset.storedFileName, nextEpisodes);
    }
  }

  const nextShows = shows.filter((show) => show.id !== current.id);
  const safeShows = nextShows.length ? nextShows : [defaultShow()];
  await writeShows(safeShows);
  await writeEpisodes(nextEpisodes);
  res.json({
    deletedShowId: current.id,
    shows: safeShows,
    episodes: nextEpisodes
  });
});

app.get("/api/episodes", async (req, res) => {
  const episodes = await readEpisodes();
  const showId = String(req.query.showId || "");
  res.json(sortEpisodesForShelf(showId ? episodes.filter((episode) => episode.showId === showId) : episodes));
});

app.patch("/api/episodes/reorder", async (req, res) => {
  const episodes = await readEpisodes();
  const showId = cleanId(req.body?.showId);
  const requestedIds = Array.isArray(req.body?.episodeIds) ? req.body.episodeIds.map(cleanId).filter(Boolean) : [];
  if (!showId || !requestedIds.length) {
    return res.status(400).json({ error: "Send a showId and ordered episodeIds to reorder episodes." });
  }

  const showEpisodes = sortEpisodesForShelf(episodes.filter((episode) => episode.showId === showId));
  const showEpisodeIds = new Set(showEpisodes.map((episode) => episode.id));
  const orderedIds = [
    ...requestedIds.filter((id) => showEpisodeIds.has(id)),
    ...showEpisodes.map((episode) => episode.id).filter((id) => !requestedIds.includes(id))
  ];
  const orderById = new Map(orderedIds.map((id, index) => [id, index]));
  const updatedEpisodes = episodes.map((episode) =>
    episode.showId === showId && orderById.has(episode.id)
      ? normalizeEpisode({ ...episode, sortOrder: orderById.get(episode.id) })
      : episode
  );

  await writeEpisodes(updatedEpisodes);
  res.json({
    episodes: sortEpisodesForShelf(updatedEpisodes.filter((episode) => episode.showId === showId)),
    allEpisodes: sortEpisodesForShelf(updatedEpisodes)
  });
});

app.get("/api/episodes/:id", async (req, res) => {
  const episode = (await readEpisodes()).find((item) => item.id === req.params.id);
  if (!episode) {
    return res.status(404).json({ error: "Episode not found." });
  }
  res.json(episode);
});

app.post("/api/episodes", async (req, res) => {
  const shows = await readShows();
  const show = shows.find((item) => item.id === req.body.showId) || shows[0];
  if (!show) {
    return res.status(400).json({ error: "Create a show before creating an episode." });
  }

  const now = new Date().toISOString();
  const episodes = await readEpisodes();
  const episode = normalizeEpisode({
    id: randomUUID(),
    showId: show.id,
    title: String(req.body.title || nextEpisodeTitle(show)).trim(),
    sortOrder: nextEpisodeSortOrder(episodes, show.id),
    createdAt: now,
    updatedAt: now,
    scriptText: String(req.body.scriptText || ""),
    status: "draft",
    currentStage: "Planning",
    format: show.shortFormat,
    automation: show.automation,
    approvals: buildApprovals(show.automation),
    assets: [],
    productionMap: [],
    plan: emptyPlan(),
    drafts: emptyDrafts(show),
    outputs: [],
    jobLog: []
  });

  await writeEpisodes([episode, ...episodes]);
  res.json(episode);
});

app.post("/api/episodes/:id/duplicate", async (req, res) => {
  const shows = await readShows();
  const episodes = await readEpisodes();
  const current = episodes.find((item) => item.id === req.params.id);
  if (!current) {
    return res.status(404).json({ error: "Episode not found." });
  }

  const show = shows.find((item) => item.id === current.showId) || shows[0];
  const duplicate = await duplicateEpisodeForNextScript({
    episode: current,
    show,
    episodes: episodes.filter((item) => item.showId === current.showId),
    title: req.body?.title,
    sortOrder: nextEpisodeSortOrder(episodes, current.showId)
  });

  await writeEpisodes([duplicate, ...episodes]);
  res.json(duplicate);
});

app.patch("/api/episodes/:id", async (req, res) => {
  const shows = await readShows();
  const episodes = await readEpisodes();
  const current = episodes.find((item) => item.id === req.params.id);
  if (!current) {
    return res.status(404).json({ error: "Episode not found." });
  }
  const show = shows.find((item) => item.id === current.showId) || shows[0];
  const productionMapChanged =
    Array.isArray(req.body.productionMap) &&
    String(req.body.productionMapEditedAt || "") &&
    String(req.body.productionMapEditedAt || "") !== String(current.productionMapEditedAt || "");
  const approvals = productionMapChanged
    ? resetRenderApproval(current.approvals, "Production map changed after render review.")
    : Array.isArray(req.body.approvals)
      ? req.body.approvals
      : current.approvals;

  const requestedFormat =
    req.body.format && typeof req.body.format === "object" && !Array.isArray(req.body.format)
      ? req.body.format
      : {};
  const format = normalizeShortFormat({
    ...(show?.shortFormat || {}),
    ...(current.format || {}),
    ...requestedFormat
  });

  const updated = await ensureAutomaticSpeakerMasksForEpisode(normalizeEpisode({
    ...current,
    ...req.body,
    approvals,
    id: current.id,
    showId: current.showId,
    createdAt: current.createdAt,
    format,
    updatedAt: new Date().toISOString()
  }), show);
  await writeEpisodes([updated, ...episodes.filter((item) => item.id !== updated.id)]);
  res.json(updated);
});

app.post("/api/episodes/:id/script", upload.single("script"), async (req, res) => {
  const episodes = await readEpisodes();
  const current = episodes.find((item) => item.id === req.params.id);
  if (!current) {
    return res.status(404).json({ error: "Episode not found." });
  }
  if (!req.file) {
    return res.status(400).json({ error: "No script uploaded." });
  }

  let scriptText = "";
  try {
    scriptText = await extractScriptText(req.file);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Could not read uploaded script." });
  }

  const updated = normalizeEpisode({
    ...current,
    scriptText,
    assets: [
      ...current.assets,
      {
        id: randomUUID(),
        type: "script",
        shotRole: "script",
        roleLabel: "Script",
        fileName: req.file.originalname,
        storedFileName: req.file.filename,
        localUrl: `/uploads/${req.file.filename}`,
        createdAt: new Date().toISOString()
      }
    ],
    updatedAt: new Date().toISOString()
  });

  await writeEpisodes([updated, ...episodes.filter((item) => item.id !== updated.id)]);
  res.json(updated);
});

app.post("/api/episodes/:id/assets", upload.array("assets", 24), async (req, res) => {
  const episodes = await readEpisodes();
  const current = episodes.find((item) => item.id === req.params.id);
  if (!current) {
    return res.status(404).json({ error: "Episode not found." });
  }
  const files = Array.isArray(req.files) ? req.files : [];
  const now = new Date().toISOString();
  const requestedShotRole = sanitizeShotRole(req.body.role || "general");
  const requestedRoleLabel = String(req.body.roleLabel || labelForShotRole(requestedShotRole)).trim();
  const assets = files.map((file) => {
    const shotRole = requestedShotRole;
    return {
      id: randomUUID(),
      type: mediaTypeForMime(file.mimetype),
      shotRole,
      roleLabel: requestedRoleLabel,
      fileName: file.originalname,
      storedFileName: file.filename,
      mimeType: file.mimetype || "application/octet-stream",
      localUrl: `/uploads/${file.filename}`,
      createdAt: now
    };
  });

  const updated = normalizeEpisode({
    ...current,
    assets: [...current.assets, ...assets],
    updatedAt: now
  });
  await writeEpisodes([updated, ...episodes.filter((item) => item.id !== updated.id)]);
  res.json(updated);
});

app.patch("/api/episodes/:id/assets/:assetId", async (req, res) => {
  const episodes = await readEpisodes();
  const current = episodes.find((item) => item.id === req.params.id);
  if (!current) {
    return res.status(404).json({ error: "Episode not found." });
  }

  const assetId = req.params.assetId;
  const asset = current.assets.find((item) => item.id === assetId);
  if (!asset) {
    return res.status(404).json({ error: "Asset not found." });
  }

  const hasSpeakingTag =
    Object.prototype.hasOwnProperty.call(req.body || {}, "speakingTag") ||
    Object.prototype.hasOwnProperty.call(req.body || {}, "characterTags") ||
    Object.prototype.hasOwnProperty.call(req.body?.metadata || {}, "speakingTag") ||
    Object.prototype.hasOwnProperty.call(req.body?.metadata || {}, "characterTags");
  const speakingTag = sanitizeSpeakingTag(
    hasSpeakingTag
      ? req.body?.speakingTag ??
          req.body?.characterTags ??
          req.body?.metadata?.speakingTag ??
          req.body?.metadata?.characterTags ??
          ""
      : asset.metadata?.speakingTag ?? asset.metadata?.characterTags ?? ""
  );
  const hasLipSyncModel =
    Object.prototype.hasOwnProperty.call(req.body || {}, "lipSyncModel") ||
    Object.prototype.hasOwnProperty.call(req.body?.metadata || {}, "lipSyncModel");
  const hasLipSyncPrompt =
    Object.prototype.hasOwnProperty.call(req.body || {}, "lipSyncPrompt") ||
    Object.prototype.hasOwnProperty.call(req.body?.metadata || {}, "lipSyncPrompt");
  const hasAnimationStrength =
    Object.prototype.hasOwnProperty.call(req.body || {}, "animationStrength") ||
    Object.prototype.hasOwnProperty.call(req.body?.metadata || {}, "animationStrength");
  const previousAnimationStrength = animationStrengthForAsset(asset);
  const requestedAnimationStrength = hasAnimationStrength
    ? normalizeOptionalAnimationStrength(req.body?.animationStrength ?? req.body?.metadata?.animationStrength)
    : null;
  const nextAnimationStrength = hasAnimationStrength
    ? requestedAnimationStrength ?? defaultAnimationStrength()
    : previousAnimationStrength;
  const animationStrengthChanged = hasAnimationStrength && nextAnimationStrength !== previousAnimationStrength;
  const hasShotRole =
    Object.prototype.hasOwnProperty.call(req.body || {}, "shotRole") ||
    Object.prototype.hasOwnProperty.call(req.body || {}, "role") ||
    Object.prototype.hasOwnProperty.call(req.body?.metadata || {}, "shotRole");
  const requestedShotRole = hasShotRole
    ? sanitizeShotRole(req.body?.shotRole ?? req.body?.role ?? req.body?.metadata?.shotRole)
    : "";
  const nextShotRole = requestedShotRole && requestedShotRole !== "mask" ? requestedShotRole : sanitizeShotRole(asset.shotRole || "general");
  const nextRoleLabel = hasShotRole ? labelForShotRole(nextShotRole) : asset.roleLabel;
  const updatedAssets = current.assets.map((item) =>
    item.id === assetId
      ? normalizeAsset({
          ...item,
          ...(hasShotRole
            ? {
                shotRole: nextShotRole,
                roleLabel: nextRoleLabel
              }
            : {}),
          metadata: {
            ...(item.metadata || {}),
            ...(hasSpeakingTag ? { speakingTag } : {}),
            ...(hasLipSyncModel
              ? { lipSyncModel: sanitizeOptionalLipSyncModel(req.body?.lipSyncModel ?? req.body?.metadata?.lipSyncModel) }
              : {}),
            ...(hasLipSyncPrompt
              ? {
                  lipSyncPrompt: compactText(
                    String(req.body?.lipSyncPrompt ?? req.body?.metadata?.lipSyncPrompt ?? "").trim(),
                    lipSyncInputPromptMaxLength
                  )
                }
              : {}),
            ...(hasAnimationStrength ? { animationStrength: requestedAnimationStrength } : {})
          }
        })
      : item
  );

  const removedAutoMaskIds = new Set(
    hasSpeakingTag || hasShotRole
      ? current.assets
          .filter(
            (item) =>
              item.shotRole === "mask" &&
              item.metadata?.kind === "speaker-auto-mask" &&
              cleanId(item.metadata?.sourceImageAssetId) === assetId
          )
          .map((item) => item.id)
      : []
  );
  const remainingAssets = updatedAssets.filter((item) => !removedAutoMaskIds.has(item.id));

  const shows = await readShows();
  const show = shows.find((item) => item.id === current.showId) || shows[0];
  const updatedAsset = remainingAssets.find((item) => item.id === assetId) || asset;
  const characters = new Map((show?.characters || []).map((character) => [character.id, character]));
  let productionMap = clearMaskAssetsFromProductionMap(current.productionMap, removedAutoMaskIds);
  if (animationStrengthChanged) {
    productionMap = productionMap.map((line, index) => {
      const normalized = normalizeProductionLine(line, index);
      if (
        normalized.lineType === "insert" ||
        normalized.assetId !== assetId ||
        normalizeOptionalAnimationStrength(normalized.animationStrengthOverride) !== null
      ) {
        return normalized;
      }
      const provider = lipSyncModelForLine(normalized, {
        imageAsset: updatedAsset,
        character: characters.get(normalized.characterId),
        show
      });
      if (provider !== "infinitalk") return normalized;
      return normalizeProductionLine(
        {
          ...normalized,
          videoStatus: "pending",
          videoTake: null,
          videoTakes: [],
          videoError: "",
          videoWarning: ""
        },
        index
      );
    });
  }
  const updated = await ensureAutomaticSpeakerMasksForEpisode(normalizeEpisode({
    ...current,
    approvals: (hasSpeakingTag || hasLipSyncModel || hasLipSyncPrompt || hasShotRole || hasAnimationStrength)
      ? resetRenderApproval(current.approvals, "Cast Visual defaults changed after render review.")
      : current.approvals,
    assets: remainingAssets,
    productionMap,
    jobLog: appendLog(
      current.jobLog,
      hasShotRole
        ? `Updated shot type for ${asset.fileName}.`
        : hasSpeakingTag
          ? `Updated speaking tag for ${asset.fileName}.`
          : hasAnimationStrength
            ? `Updated animation strength for ${asset.fileName}.`
            : `Updated Cast Visual defaults for ${asset.fileName}.`
    ),
    updatedAt: new Date().toISOString()
  }), show);
  await writeEpisodes([updated, ...episodes.filter((item) => item.id !== updated.id)]);
  res.json(updated);
});

app.post("/api/episodes/:id/assets/:assetId/lipsync-prompt", async (req, res) => {
  const episodes = await readEpisodes();
  const current = episodes.find((item) => item.id === req.params.id);
  if (!current) {
    return res.status(404).json({ error: "Episode not found." });
  }

  const assetId = req.params.assetId;
  const asset = current.assets.find((item) => item.id === assetId);
  if (!asset) {
    return res.status(404).json({ error: "Asset not found." });
  }
  if (asset.type !== "image" || asset.shotRole === "mask") {
    return res.status(400).json({ error: "Only Cast Visual image assets can generate a lip-sync prompt." });
  }

  const shows = await readShows();
  const show = shows.find((item) => item.id === current.showId) || shows[0] || defaultShow();
  const provider =
    sanitizeOptionalLipSyncModel(req.body?.provider || req.body?.lipSyncModel || req.body?.metadata?.lipSyncModel) ||
    sanitizeOptionalLipSyncModel(asset.metadata?.lipSyncModel) ||
    sanitizeLipSyncModel(show.production?.defaultLipSyncModel || defaultLipSyncModel());
  const prompt = await generateCastVisualLipSyncPrompt({ asset, show, provider });
  const now = new Date().toISOString();
  const updatedAssets = current.assets.map((item) =>
    item.id === assetId
      ? normalizeAsset({
          ...item,
          metadata: {
            ...(item.metadata || {}),
            lipSyncPrompt: prompt,
            lipSyncPromptSource: "openai-vision",
            lipSyncPromptModel: provider,
            lipSyncPromptGeneratedAt: now
          }
        })
      : item
  );
  const updated = normalizeEpisode({
    ...current,
    approvals: resetRenderApproval(current.approvals, "Cast Visual prompt changed after render review."),
    assets: updatedAssets,
    jobLog: appendLog(current.jobLog, `Generated Cast Visual prompt for ${asset.fileName}.`),
    updatedAt: now
  });
  await writeEpisodes([updated, ...episodes.filter((item) => item.id !== updated.id)]);
  res.json({
    episode: updated,
    asset: updated.assets.find((item) => item.id === assetId),
    prompt
  });
});

app.delete("/api/episodes/:id/assets/:assetId", async (req, res) => {
  const episodes = await readEpisodes();
  const current = episodes.find((item) => item.id === req.params.id);
  if (!current) {
    return res.status(404).json({ error: "Episode not found." });
  }

  const asset = current.assets.find((item) => item.id === req.params.assetId);
  if (!asset) {
    return res.status(404).json({ error: "Asset not found." });
  }

  const updated = normalizeEpisode({
    ...current,
    approvals: resetRenderApproval(current.approvals, "Episode asset changed after render review."),
    assets: current.assets.filter((item) => item.id !== req.params.assetId),
    productionMap: clearAssetFromProductionMap(current.productionMap, req.params.assetId),
    jobLog: appendLog(current.jobLog, `Deleted asset: ${asset.fileName}`),
    updatedAt: new Date().toISOString()
  });
  const nextEpisodes = [updated, ...episodes.filter((item) => item.id !== updated.id)];
  await deleteStoredUploadIfUnreferenced(asset.storedFileName, nextEpisodes);
  await writeEpisodes(nextEpisodes);
  res.json(updated);
});

app.post("/api/episodes/:id/build-plan", async (req, res) => {
  const shows = await readShows();
  const episodes = await readEpisodes();
  const current = episodes.find((item) => item.id === req.params.id);
  if (!current) {
    return res.status(404).json({ error: "Episode not found." });
  }
  const show = shows.find((item) => item.id === current.showId) || shows[0];
  const scriptText = String(req.body.scriptText ?? current.scriptText ?? "");
  const format = normalizeShortFormat({
    ...(show?.shortFormat || {}),
    ...(current.format || {}),
    ...(req.body.format || {})
  });
  const plan = analyzeScript(scriptText, show);
  const productionMap = createProductionMap({
    scriptText,
    show,
    format,
    assets: current.assets,
    currentProductionMap: current.productionMap
  });
  const drafts = createDrafts({ episode: current, show, plan, scriptText });
  const updated = await ensureAutomaticSpeakerMasksForEpisode(normalizeEpisode({
    ...current,
    scriptText,
    format,
    plan,
    productionMap,
    productionMapEditedAt: "",
    drafts,
    status: plan.wordCount ? "planned" : "draft",
    currentStage: "Planning",
    approvals: resetRenderApproval(refreshApprovals(current.approvals, show.automation), "Script plan changed after render review."),
    jobLog: appendLog(current.jobLog, "Script plan and production map refreshed."),
    updatedAt: new Date().toISOString()
  }), show);

  await writeEpisodes([updated, ...episodes.filter((item) => item.id !== updated.id)]);
  res.json(updated);
});

app.patch("/api/episodes/:id/production-map", async (req, res) => {
  const episodes = await readEpisodes();
  const current = episodes.find((item) => item.id === req.params.id);
  if (!current) {
    return res.status(404).json({ error: "Episode not found." });
  }

  const shows = await readShows();
  const show = shows.find((item) => item.id === current.showId) || shows[0];
  const format = normalizeShortFormat({
    ...(show?.shortFormat || {}),
    ...(current.format || {})
  });
  const productionMapEditedAt = String(req.body.productionMapEditedAt ?? current.productionMapEditedAt ?? "");
  const approvals =
    productionMapEditedAt && productionMapEditedAt !== String(current.productionMapEditedAt || "")
      ? resetRenderApproval(current.approvals, "Production map changed after render review.")
      : current.approvals;
  const updated = await ensureAutomaticSpeakerMasksForEpisode(normalizeEpisode({
    ...current,
    approvals,
    format,
    productionMap: normalizeProductionMapForFormat(
      Array.isArray(req.body.productionMap) ? req.body.productionMap : current.productionMap,
      format
    ),
    productionMapEditedAt,
    jobLog: appendLog(current.jobLog, "Production map saved."),
    updatedAt: new Date().toISOString()
  }), show);
  await writeEpisodes([updated, ...episodes.filter((item) => item.id !== updated.id)]);
  res.json(updated);
});

app.post("/api/episodes/:id/lines/:lineId/drawn-mask", async (req, res) => {
  const episodes = await readEpisodes();
  const current = episodes.find((item) => item.id === req.params.id);
  if (!current) {
    return res.status(404).json({ error: "Episode not found." });
  }
  const submittedMap = Array.isArray(req.body?.productionMap) ? req.body.productionMap : current.productionMap;
  const baseProductionMap = (Array.isArray(submittedMap) ? submittedMap : []).map((item, index) =>
    normalizeProductionLine(item, index)
  );
  const lineIndex = baseProductionMap.findIndex((line) => line.id === req.params.lineId);
  if (lineIndex < 0) {
    return res.status(404).json({ error: "Production line not found." });
  }

  const requestedLine = req.body?.line && typeof req.body.line === "object" ? req.body.line : {};
  const line = normalizeProductionLine(
    { ...baseProductionMap[lineIndex], ...requestedLine, id: req.params.lineId },
    lineIndex
  );
  if (line.lineType === "insert") {
    return res.status(400).json({ error: "Insert lines do not use speaker masks." });
  }

  const assets = Array.isArray(current.assets) ? current.assets.map(normalizeAsset) : [];
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const imageAsset = assetById.get(line.assetId);
  const imagePath = resolveAssetPath(imageAsset);
  if (!imagePath) {
    return res.status(400).json({ error: "Choose a shot image before creating a mask." });
  }
  const workingMap = baseProductionMap.map((item, index) =>
    index === lineIndex ? line : normalizeProductionLine(item, index)
  );

  try {
    const generated = await generateDrawnSpeakerMaskForLine({
      line,
      imagePath,
      maskDataUrl: String(req.body?.maskDataUrl || "")
    });
    const nextAssets = [...assets, generated.asset];
    const nextMap = applySpeakerMaskToMatchingLines(workingMap, line, generated.asset.id);
    const appliedLineCount = nextMap.filter(
      (item, index) => item.maskAssetId === generated.asset.id && workingMap[index]?.maskAssetId !== generated.asset.id
    ).length;
    const updated = normalizeEpisode({
      ...current,
      approvals: resetRenderApproval(current.approvals, `Line ${line.index} mask changed after render review.`),
      assets: nextAssets,
      productionMap: nextMap,
      jobLog: appendLog(
        current.jobLog,
        `Created drawn speaker mask for line ${line.index}${appliedLineCount > 1 ? ` and applied it to ${appliedLineCount - 1} matching lines` : ""}.`
      ),
      updatedAt: new Date().toISOString()
    });
    await writeEpisodes([updated, ...episodes.filter((item) => item.id !== updated.id)]);
    res.json({
      episode: updated,
      line: updated.productionMap[lineIndex],
      asset: generated.asset,
      appliedLineCount
    });
  } catch (error) {
    const updated = normalizeEpisode({
      ...current,
      jobLog: appendLog(current.jobLog, `Drawn speaker mask failed for line ${line.index}: ${cleanErrorMessage(error)}`),
      updatedAt: new Date().toISOString()
    });
    await writeEpisodes([updated, ...episodes.filter((item) => item.id !== updated.id)]);
    res.status(500).json({ error: cleanErrorMessage(error), episode: updated });
  }
});

app.post("/api/episodes/:id/audio-lines/:lineId/regenerate", async (req, res) => {
  const episodes = await readEpisodes();
  const current = episodes.find((item) => item.id === req.params.id);
  if (!current) {
    return res.status(404).json({ error: "Episode not found." });
  }

  const lineIndex = (current.productionMap || []).findIndex((line) => line.id === req.params.lineId);
  if (lineIndex < 0) {
    return res.status(404).json({ error: "Production line not found." });
  }

  const audioRunId = randomUUID();
  const audioDir = path.join(outputsDir, "audio-review", current.id);
  const tempDir = path.join(outputsDir, "tmp", `audio-review-${audioRunId}`);

  try {
    await Promise.all([mkdir(audioDir, { recursive: true }), mkdir(tempDir, { recursive: true })]);
    const requestedLine = req.body?.line && typeof req.body.line === "object" ? req.body.line : {};
    const nextMap = (current.productionMap || []).map((line, index) =>
      normalizeProductionLine(index === lineIndex ? { ...line, ...requestedLine, id: req.params.lineId } : line, index)
    );
    const line = nextMap[lineIndex];
    const clipFileName = `line-${String(line.index).padStart(3, "0")}-${safeFileSegment(line.speaker)}-${audioRunId.slice(0, 8)}.wav`;
    const clipPath = path.join(audioDir, clipFileName);
    const generatedAudio = await writeLineSpeechWav({
      filePath: clipPath,
      line,
      tempDir,
      previousText: nextMap[lineIndex - 1]?.text || "",
      nextText: nextMap[lineIndex + 1]?.text || ""
    });
    const audioTake = createAudioTake({
      line,
      filePath: clipPath,
      localUrl: `/outputs/audio-review/${current.id}/${clipFileName}`,
      generatedAudio,
      source: "line-regenerate"
    });
    nextMap[lineIndex] = normalizeProductionLine(
      {
        ...line,
        audioStatus: "pending",
        audioTake,
        videoStatus: "pending",
        videoTake: null,
        videoTakes: []
      },
      lineIndex
    );

    const updated = normalizeEpisode({
      ...current,
      approvals: resetRenderApproval(current.approvals, `Line ${line.index} audio changed after render review.`),
      productionMap: nextMap,
      jobLog: appendLog(current.jobLog, `Audio regenerated for line ${line.index}.`),
      updatedAt: new Date().toISOString()
    });
    await writeEpisodes([updated, ...episodes.filter((item) => item.id !== updated.id)]);
    res.json({ episode: updated, line: updated.productionMap[lineIndex] });
  } catch (error) {
    res.status(500).json({ error: cleanErrorMessage(error) });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

app.patch("/api/episodes/:id/audio-lines/:lineId/review", async (req, res) => {
  const episodes = await readEpisodes();
  const current = episodes.find((item) => item.id === req.params.id);
  if (!current) {
    return res.status(404).json({ error: "Episode not found." });
  }

  const lineIndex = (current.productionMap || []).findIndex((line) => line.id === req.params.lineId);
  if (lineIndex < 0) {
    return res.status(404).json({ error: "Production line not found." });
  }

  const status = sanitizeAudioStatus(req.body?.status);
  const productionMap = (current.productionMap || []).map((line, index) =>
    index === lineIndex ? normalizeProductionLine({ ...line, audioStatus: status }, index) : normalizeProductionLine(line, index)
  );
  const updated = normalizeEpisode({
    ...current,
    approvals: resetRenderApproval(current.approvals, `Line ${productionMap[lineIndex].index} audio review changed.`),
    productionMap,
    jobLog: appendLog(current.jobLog, `Line ${productionMap[lineIndex].index} audio marked ${status}.`),
    updatedAt: new Date().toISOString()
  });
  await writeEpisodes([updated, ...episodes.filter((item) => item.id !== updated.id)]);
  res.json({ episode: updated, line: updated.productionMap[lineIndex] });
});

app.post("/api/episodes/:id/insert-lines/:lineId/generate-video", async (req, res) => {
  const shows = await readShows();
  const episodes = await readEpisodes();
  const current = episodes.find((item) => item.id === req.params.id);
  if (!current) {
    return res.status(404).json({ error: "Episode not found." });
  }

  const lineIndex = (current.productionMap || []).findIndex((line) => line.id === req.params.lineId);
  if (lineIndex < 0) {
    return res.status(404).json({ error: "Production line not found." });
  }

  const show = shows.find((item) => item.id === current.showId) || shows[0];
  const format = normalizeShortFormat({
    ...(show?.shortFormat || {}),
    ...(current.format || {})
  });
  const assets = Array.isArray(current.assets) ? current.assets.map(normalizeAsset) : [];
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const line = normalizeProductionLine(
    req.body?.line && typeof req.body.line === "object"
      ? { ...current.productionMap[lineIndex], ...req.body.line, id: req.params.lineId }
      : current.productionMap[lineIndex],
    lineIndex
  );
  if (line.lineType !== "insert") {
    return res.status(400).json({ error: "Only INSERT production lines can generate insert videos." });
  }
  if (line.insertVideoMode === "upload") {
    return res.status(400).json({ error: "Video upload mode uses the Upload Video button instead of generation." });
  }

  const imageAsset = assetById.get(line.assetId);
  const endImageAsset = assetById.get(line.insertEndAssetId);
  if (!resolveAssetPath(imageAsset)) {
    return res.status(400).json({ error: "Choose an insert image before generating video." });
  }
  if (line.insertVideoMode === "first_last_frame" && !resolveAssetPath(endImageAsset)) {
    return res.status(400).json({ error: "Choose a last-frame image before generating first/last-frame video." });
  }

  try {
    const manifestLine = {
      ...line,
      image: imageAsset
        ? {
            assetId: imageAsset.id,
            fileName: imageAsset.fileName,
            localUrl: imageAsset.localUrl
          }
        : null,
      imagePath: resolveAssetPath(imageAsset),
      endImage: endImageAsset
        ? {
            assetId: endImageAsset.id,
            fileName: endImageAsset.fileName,
            localUrl: endImageAsset.localUrl
          }
        : null,
      endImagePath: resolveAssetPath(endImageAsset),
      durationSeconds: insertVideoDurationSeconds(line)
    };
    const videoTake = await generateInsertVideoForLine({ episode: current, line: manifestLine, format });
    const defaultOutPoint = defaultInsertVideoOutPoint(line, videoTake);
    const productionMap = (current.productionMap || []).map((item, index) =>
      index === lineIndex
        ? normalizeProductionLine(
            {
              ...line,
              videoStatus: "generated",
              videoTake,
              videoInSeconds: line.videoInSeconds || 0,
              videoOutSeconds: Number(line.videoOutSeconds) > Number(line.videoInSeconds || 0) ? line.videoOutSeconds : defaultOutPoint
            },
            index
          )
        : normalizeProductionLine(item, index)
    );
    const updated = normalizeEpisode({
      ...current,
      approvals: resetRenderApproval(current.approvals, `Line ${line.index} insert video changed after render review.`),
      productionMap,
      jobLog: appendLog(current.jobLog, `Insert video generated for line ${line.index}.`),
      updatedAt: new Date().toISOString()
    });
    await writeEpisodes([updated, ...episodes.filter((item) => item.id !== updated.id)]);
    res.json({ episode: updated, line: updated.productionMap[lineIndex] });
  } catch (error) {
    const productionMap = (current.productionMap || []).map((item, index) =>
      index === lineIndex ? normalizeProductionLine({ ...line, videoStatus: "failed", videoTake: null }, index) : normalizeProductionLine(item, index)
    );
    const updated = normalizeEpisode({
      ...current,
      approvals: resetRenderApproval(current.approvals, `Line ${line.index} insert video failed after render review.`),
      productionMap,
      jobLog: appendLog(current.jobLog, `Insert video failed for line ${line.index}: ${cleanErrorMessage(error)}`),
      updatedAt: new Date().toISOString()
    });
    await writeEpisodes([updated, ...episodes.filter((item) => item.id !== updated.id)]);
    res.status(500).json({ error: cleanErrorMessage(error), episode: updated });
  }
});

app.post("/api/episodes/:id/insert-lines/:lineId/upload-video", upload.single("video"), async (req, res) => {
  const shows = await readShows();
  const episodes = await readEpisodes();
  const current = episodes.find((item) => item.id === req.params.id);
  if (!current) {
    return res.status(404).json({ error: "Episode not found." });
  }

  const lineIndex = (current.productionMap || []).findIndex((line) => line.id === req.params.lineId);
  if (lineIndex < 0) {
    return res.status(404).json({ error: "Production line not found." });
  }
  if (!req.file) {
    return res.status(400).json({ error: "Choose a video clip to upload." });
  }
  if (!isVideoUploadFile(req.file)) {
    await deleteStoredUpload(req.file.filename);
    return res.status(400).json({ error: "Insert shot uploads must be video files." });
  }

  const show = shows.find((item) => item.id === current.showId) || shows[0];
  const format = normalizeShortFormat({
    ...(show?.shortFormat || {}),
    ...(current.format || {})
  });
  const requestedLine = parseJsonObject(req.body?.line);
  const line = normalizeProductionLine(
    requestedLine ? { ...current.productionMap[lineIndex], ...requestedLine, id: req.params.lineId } : current.productionMap[lineIndex],
    lineIndex
  );
  if (line.lineType !== "insert") {
    await deleteStoredUpload(req.file.filename);
    return res.status(400).json({ error: "Only INSERT production lines can use uploaded insert videos." });
  }

  try {
    const videoTake = await createUploadedInsertVideoTake({
      episode: current,
      line,
      format,
      uploadedFile: req.file
    });
    const defaultOutPoint = defaultInsertVideoOutPoint(line, videoTake);
    const productionMap = (current.productionMap || []).map((item, index) =>
      index === lineIndex
        ? normalizeProductionLine(
            {
              ...line,
              insertVideoMode: "upload",
              videoStatus: "generated",
              videoTake,
              videoInSeconds: 0,
              videoOutSeconds: defaultOutPoint
            },
            index
          )
        : normalizeProductionLine(item, index)
    );
    const updated = normalizeEpisode({
      ...current,
      approvals: resetRenderApproval(current.approvals, `Line ${line.index} uploaded insert video changed after render review.`),
      productionMap,
      jobLog: appendLog(current.jobLog, `Uploaded custom insert video for line ${line.index}: ${req.file.originalname}`),
      updatedAt: new Date().toISOString()
    });
    await writeEpisodes([updated, ...episodes.filter((item) => item.id !== updated.id)]);
    res.json({ episode: updated, line: updated.productionMap[lineIndex] });
  } catch (error) {
    await deleteStoredUpload(req.file.filename);
    res.status(400).json({ error: cleanErrorMessage(error) });
  }
});

app.post("/api/episodes/:id/dialogue-lines/:lineId/generate-video", async (req, res) => {
  const shows = await readShows();
  const episodes = await readEpisodes();
  const current = episodes.find((item) => item.id === req.params.id);
  if (!current) {
    return res.status(404).json({ error: "Episode not found." });
  }

  const lineIndex = (current.productionMap || []).findIndex((line) => line.id === req.params.lineId);
  if (lineIndex < 0) {
    return res.status(404).json({ error: "Production line not found." });
  }

  const show = shows.find((item) => item.id === current.showId) || shows[0];
  const requestedLine = req.body?.line && typeof req.body.line === "object" ? req.body.line : {};
  const nextMap = (current.productionMap || []).map((line, index) =>
    normalizeProductionLine(index === lineIndex ? { ...line, ...requestedLine, id: req.params.lineId } : line, index)
  );
  let generationEpisode = normalizeEpisode({
    ...current,
    productionMap: nextMap
  });
  let generationMap = nextMap;
  let line = nextMap[lineIndex];
  if (line.lineType === "insert") {
    return res.status(400).json({ error: "Insert lines use the insert video generator instead." });
  }

  const runId = randomUUID();
  const tempDir = path.join(outputsDir, "tmp", `dialogue-video-${runId}`);

  try {
    await mkdir(tempDir, { recursive: true });
    generationEpisode = await ensureAutomaticSpeakerMasksForEpisode(generationEpisode, show);
    generationMap = generationEpisode.productionMap || nextMap;
    line = generationMap[lineIndex] || line;

    const manifest = buildRenderManifest({
      previewId: `dialogue-video-${runId}`,
      episode: generationEpisode,
      show,
      createdAt: new Date().toISOString()
    });
    const manifestLine = manifest.lines.find((item) => item.id === req.params.lineId);
    if (!manifestLine) {
      throw new Error("Production line was not found in the render manifest.");
    }
    if (!manifestLine.imagePath) {
      throw new Error(`Line ${line.index} needs an assigned image before shot video can render.`);
    }

    const reusableTake = reusableAudioTakeForLine(manifestLine);
    if (!reusableTake) {
      throw new Error(`Line ${line.index} needs a current audio review clip before shot video can render.`);
    }
    const audioPath = audioTakeFilePath(reusableTake);
    if (!audioPath) {
      throw new Error(`Line ${line.index} audio review clip is missing from disk.`);
    }
    manifestLine.durationSeconds = reusableTake.durationSeconds || manifestLine.durationSeconds;
    manifestLine.audioTake = reusableTake;
    manifestLine.audio = {
      ...reusableTake,
      filePath: audioPath
    };
    manifest.lines = [manifestLine];
    refreshManifestTiming(manifest);

    const provider = lipSyncModelForLine(manifestLine);
    if (!lipSyncProviderAvailable(provider, manifestLine, manifest)) {
      const providerConfig = lipSyncProviderConfig(provider, { line: manifestLine, manifest });
      const message = `${providerConfig.label} is not configured for line ${line.index}. ${lipSyncProviderUnavailableMessage(provider, manifestLine, manifest)}`;
      const updated = normalizeEpisode({
        ...generationEpisode,
        productionMap: generationMap.map((item, index) =>
          index === lineIndex
            ? normalizeProductionLine({ ...item, videoStatus: "failed", videoError: message }, index)
            : normalizeProductionLine(item, index)
        ),
        jobLog: appendLog(generationEpisode.jobLog, `Shot video not started for line ${line.index}: ${message}`),
        updatedAt: new Date().toISOString()
      });
      await writeEpisodes([updated, ...episodes.filter((item) => item.id !== updated.id)]);
      return res.status(409).json({ error: message, episode: updated, line: updated.productionMap[lineIndex] });
    }

    await renderLipSyncClipsForManifest({ episode: generationEpisode, manifest, tempDir, forceRegenerate: true });
    const videoTake = normalizeVideoTake(manifestLine.lipSyncTake || manifestLine.videoTake);
    if (!videoTake?.localUrl) {
      throw new Error(`Line ${line.index} did not produce a shot video.`);
    }

    const productionMap = generationMap.map((item, index) =>
      index === lineIndex
        ? normalizeProductionLine(
            {
              ...line,
              audioTake: reusableTake,
              videoStatus: "generated",
              videoTake,
              videoTakes: normalizeVideoTakes([videoTake, ...(line.videoTakes || [])], videoTake),
              videoError: "",
              videoWarning: ""
            },
            index
          )
        : normalizeProductionLine(item, index)
    );
    const updated = normalizeEpisode({
      ...generationEpisode,
      approvals: resetRenderApproval(generationEpisode.approvals, `Line ${line.index} shot video changed after render review.`),
      productionMap,
      jobLog: appendLog(generationEpisode.jobLog, `Shot video generated for line ${line.index}.`),
      updatedAt: new Date().toISOString()
    });
    await writeEpisodes([updated, ...episodes.filter((item) => item.id !== updated.id)]);
    res.json({ episode: updated, line: updated.productionMap[lineIndex] });
  } catch (error) {
    const message = cleanErrorMessage(error);
    const productionMap = generationMap.map((item, index) =>
      index === lineIndex
        ? normalizeProductionLine(
            {
              ...line,
              videoStatus: "failed",
              videoTake: line.videoTake || null,
              videoTakes: line.videoTakes || [],
              videoError: message
            },
            index
          )
        : normalizeProductionLine(item, index)
    );
    const updated = normalizeEpisode({
      ...generationEpisode,
      approvals: resetRenderApproval(generationEpisode.approvals, `Line ${line.index} shot video failed after render review.`),
      productionMap,
      jobLog: appendLog(generationEpisode.jobLog, `Shot video failed for line ${line.index}: ${message}`),
      updatedAt: new Date().toISOString()
    });
    await writeEpisodes([updated, ...episodes.filter((item) => item.id !== updated.id)]);
    res.status(500).json({ error: message, episode: updated, line: updated.productionMap[lineIndex] });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

app.patch("/api/episodes/:id/dialogue-lines/:lineId/video-take", async (req, res) => {
  const episodes = await readEpisodes();
  const current = episodes.find((item) => item.id === req.params.id);
  if (!current) {
    return res.status(404).json({ error: "Episode not found." });
  }

  const lineIndex = (current.productionMap || []).findIndex((line) => line.id === req.params.lineId);
  if (lineIndex < 0) {
    return res.status(404).json({ error: "Production line not found." });
  }

  const requestedTakeId = cleanId(req.body?.takeId);
  const requestedLocalUrl = String(req.body?.localUrl || "").trim();
  const productionMap = (current.productionMap || []).map((line, index) => normalizeProductionLine(line, index));
  const line = productionMap[lineIndex];
  if (line.lineType === "insert") {
    return res.status(400).json({ error: "Insert lines do not use dialogue lip-sync take selection." });
  }

  const takes = normalizeVideoTakes(line.videoTakes, line.videoTake);
  const selectedTake = takes.find((take) => {
    if (requestedTakeId && take.id === requestedTakeId) return true;
    if (requestedLocalUrl && [take.localUrl, take.proxyLocalUrl, take.fileName].includes(requestedLocalUrl)) return true;
    return false;
  });
  if (!selectedTake) {
    return res.status(404).json({ error: `Video take was not found for line ${line.index}.` });
  }
  if (!videoTakeFilePath(selectedTake)) {
    return res.status(409).json({ error: `The selected video take for line ${line.index} is missing from disk.` });
  }

  productionMap[lineIndex] = normalizeProductionLine(
    {
      ...line,
      videoStatus: "generated",
      videoTake: selectedTake,
      videoTakes: normalizeVideoTakes(takes, selectedTake),
      videoError: "",
      videoWarning: selectedTake.warning || ""
    },
    lineIndex
  );

  const updated = normalizeEpisode({
    ...current,
    approvals: resetRenderApproval(current.approvals, `Line ${line.index} selected shot video take changed after render review.`),
    productionMap,
    jobLog: appendLog(current.jobLog, `Selected shot video take for line ${line.index}.`),
    updatedAt: new Date().toISOString()
  });
  await writeEpisodes([updated, ...episodes.filter((item) => item.id !== updated.id)]);
  res.json({ episode: updated, line: updated.productionMap[lineIndex] });
});

app.post("/api/episodes/:id/approvals/:gateId", async (req, res) => {
  const episodes = await readEpisodes();
  const current = episodes.find((item) => item.id === req.params.id);
  if (!current) {
    return res.status(404).json({ error: "Episode not found." });
  }

  const status = ["pending", "approved", "blocked", "auto"].includes(req.body.status)
    ? req.body.status
    : "approved";
  const approvals = current.approvals.map((gate) =>
    gate.id === req.params.gateId
      ? {
          ...gate,
          status,
          approvedAt: status === "approved" || status === "auto" ? new Date().toISOString() : "",
          note: String(req.body.note || gate.note || "")
        }
      : gate
  );
  const updated = normalizeEpisode({
    ...current,
    approvals,
    currentStage: nextCurrentStage(approvals),
    status: deriveEpisodeStatus(approvals, current.status),
    jobLog: appendLog(current.jobLog, `${approvalTitle(req.params.gateId)} set to ${status}.`),
    updatedAt: new Date().toISOString()
  });

  await writeEpisodes([updated, ...episodes.filter((item) => item.id !== updated.id)]);
  res.json(updated);
});

app.post("/api/episodes/:id/run", async (req, res) => {
  const shows = await readShows();
  const episodes = await readEpisodes();
  const current = episodes.find((item) => item.id === req.params.id);
  if (!current) {
    return res.status(404).json({ error: "Episode not found." });
  }
  const show = shows.find((item) => item.id === current.showId) || shows[0];
  const { job, report, outputs = [], productionMap } = await createPipelineJob({ episode: current, show });
  const jobs = await readJobs();
  await writeJobs([job, ...jobs].slice(0, 200));

  const updated = normalizeEpisode({
    ...current,
    approvals: outputs.some((output) => ["preview_video", "audio_mix", "render_manifest"].includes(output.type))
      ? resetRenderApproval(current.approvals, "Preview rebuilt after render review.")
      : current.approvals,
    status:
      job.status === "waiting_for_approval"
        ? "waiting"
        : job.status === "blocked"
          ? "blocked"
          : job.status === "local_preview_ready"
            ? "preview_ready"
            : "queued",
    currentStage: job.currentStage,
    productionMap: productionMap || current.productionMap,
    outputs: outputs.length ? [...outputs, ...(current.outputs || [])] : current.outputs,
    jobLog: appendLog(current.jobLog, `${job.summary} Report: ${report.localUrl}`),
    updatedAt: new Date().toISOString()
  });
  await writeEpisodes([updated, ...episodes.filter((item) => item.id !== updated.id)]);
  res.json({ episode: updated, job, report });
});

app.post("/api/episodes/:id/final-render", async (req, res) => {
  const shows = await readShows();
  const episodes = await readEpisodes();
  const current = episodes.find((item) => item.id === req.params.id);
  if (!current) {
    return res.status(404).json({ error: "Episode not found." });
  }
  const show = shows.find((item) => item.id === current.showId) || shows[0];

  try {
    const regenerateVideos = req.body?.regenerateVideos !== false;
    const finalRender = await createFinalRender({ episode: current, show, regenerateVideos });
    const lipSyncWarnings = finalRender.manifest?.lipSync?.warnings || [];
    const lipSyncStatus = Boolean(finalRender.manifest?.lipSync?.clips?.length)
      ? lipSyncWarnings.length
        ? "warning"
        : "rendered"
      : lipSyncWarnings.length
        ? "warning"
        : "skipped";
    const lipSyncSummary = lipSyncWarnings.length
      ? ` ${lipSyncWarnings.length} lip-sync warning${lipSyncWarnings.length === 1 ? "" : "s"}; still images were used where needed.`
      : "";
    const job = {
      id: randomUUID(),
      episodeId: current.id,
      showId: show.id,
      status: "final_render_ready",
      currentStage: "Final Render Ready",
      createdAt: new Date().toISOString(),
      summary: `${regenerateVideos ? "Final local render created with regenerated shot videos." : "Final local render rebuilt from existing shot videos."}${lipSyncSummary} No publishing was attempted.`,
      steps: [
        { id: "audio_mix", label: "Build final audio mix from current shot audio", enabled: true, status: "rendered" },
        {
          id: "lipsync",
          label: regenerateVideos
            ? "Regenerate Fabric/Kling/Aurora/InfiniteTalk lip-sync clips"
            : "Reuse existing lip-sync clips and generate missing clips",
          enabled: Boolean(finalRender.manifest?.lipSync?.enabled),
          status: lipSyncStatus
        },
        { id: "visual_render", label: "Render final video", enabled: true, status: "rendered" },
        { id: "publishing", label: "Publishing", enabled: false, status: "local-only" }
      ]
    };
    const jobs = await readJobs();
    await writeJobs([job, ...jobs].slice(0, 200));
    const updated = normalizeEpisode({
      ...current,
      status: "final_render_ready",
      currentStage: "Final Render Ready",
      productionMap: finalRender.productionMap || current.productionMap,
      outputs: [...finalRender.outputs, ...(current.outputs || [])],
      jobLog: appendLog(current.jobLog, `${job.summary} Output: ${finalRender.video.localUrl}`),
      updatedAt: new Date().toISOString()
    });
    await writeEpisodes([updated, ...episodes.filter((item) => item.id !== updated.id)]);
    res.json({ episode: updated, job, finalRender });
  } catch (error) {
    const message = cleanErrorMessage(error);
    const job = {
      id: randomUUID(),
      episodeId: current.id,
      showId: show.id,
      status: "final_render_failed",
      currentStage: "Final Render Failed",
      createdAt: new Date().toISOString(),
      summary: `Final render failed: ${message}`,
      steps: [
        { id: "audio_mix", label: "Build final audio mix from current shot audio", enabled: true, status: "checked" },
        {
          id: "lipsync",
          label: "Generate Fabric/Kling/Aurora/InfiniteTalk lip-sync clips",
          enabled: !lipSyncDisabled(),
          status: "failed"
        },
        { id: "visual_render", label: "Render final video", enabled: true, status: "blocked" },
        { id: "publishing", label: "Publishing", enabled: false, status: "local-only" }
      ]
    };
    const jobs = await readJobs();
    await writeJobs([job, ...jobs].slice(0, 200));
    const updated = normalizeEpisode({
      ...current,
      status: "render_failed",
      currentStage: "Final Render Failed",
      jobLog: appendLog(current.jobLog, job.summary),
      updatedAt: new Date().toISOString()
    });
    await writeEpisodes([updated, ...episodes.filter((item) => item.id !== updated.id)]);
    res.status(400).json({ error: message, episode: updated, job });
  }
});

app.post("/api/episodes/:id/upscale-video", async (req, res) => {
  const episodes = await readEpisodes();
  const current = episodes.find((item) => item.id === req.params.id);
  if (!current) {
    return res.status(404).json({ error: "Episode not found." });
  }

  try {
    const upscaled = await upscaleVideoForEpisode({ episode: current, options: req.body || {} });
    const updated = normalizeEpisode({
      ...current,
      outputs: [upscaled.output, ...(current.outputs || []).filter((output) => output.id !== upscaled.output.id)],
      jobLog: appendLog(
        current.jobLog,
        `Upscaled video with Real-ESRGAN ${upscaled.output.model || ""}: ${upscaled.output.resolution || upscaled.output.name}.`
      ),
      updatedAt: new Date().toISOString()
    });
    await writeEpisodes([updated, ...episodes.filter((item) => item.id !== updated.id)]);
    res.json({ episode: updated, output: upscaled.output, sourceOutput: upscaled.sourceOutput });
  } catch (error) {
    const message = cleanErrorMessage(error);
    const updated = normalizeEpisode({
      ...current,
      jobLog: appendLog(current.jobLog, `Video upscale failed: ${message}`),
      updatedAt: new Date().toISOString()
    });
    await writeEpisodes([updated, ...episodes.filter((item) => item.id !== updated.id)]);
    res.status(400).json({ error: message, episode: updated });
  }
});

app.post("/api/episodes/:id/finishing-layers/assets", upload.array("assets", 12), async (req, res) => {
  const episodes = await readEpisodes();
  const current = episodes.find((item) => item.id === req.params.id);
  if (!current) {
    return res.status(404).json({ error: "Episode not found." });
  }
  const files = Array.isArray(req.files) ? req.files : [];
  if (!files.length) {
    return res.status(400).json({ error: "Choose at least one finishing layer file." });
  }

  try {
    const baseOutput = baseFinalVideoOutput(current);
    const baseDuration = baseOutput?.durationSeconds || (baseOutput ? await probeDuration(outputFilePath(baseOutput)) : 0);
    const uploadedLayers = (
      await Promise.all(files.map((file) => finishingLayerFromUpload(file, baseDuration)))
    ).filter(Boolean);
    if (!uploadedLayers.length) {
      throw new Error("Finishing layers support image, video, and audio files.");
    }
    const currentLayers = finishingLayersFromRequestOrEpisode(req, current);
    const seenLayerKeys = new Set(currentLayers.map(finishingLayerImportKey).filter(Boolean));
    const createdLayers = [];
    let skippedCount = 0;
    for (const layer of uploadedLayers) {
      const key = finishingLayerImportKey(layer);
      if (key && seenLayerKeys.has(key)) {
        skippedCount += 1;
        continue;
      }
      if (key) seenLayerKeys.add(key);
      createdLayers.push(layer);
    }
    if (!createdLayers.length) {
      const updated = normalizeEpisode({
        ...current,
        drafts: {
          ...(current.drafts || {}),
          finishingLayers: currentLayers
        },
        jobLog: appendLog(
          current.jobLog,
          `Skipped ${skippedCount} duplicate finishing layer import${skippedCount === 1 ? "" : "s"}.`
        ),
        updatedAt: new Date().toISOString()
      });
      await writeEpisodes([updated, ...episodes.filter((item) => item.id !== updated.id)]);
      return res.json({ episode: updated, layers: [], skippedCount });
    }
    const updated = normalizeEpisode({
      ...current,
      drafts: {
        ...(current.drafts || {}),
        finishingLayers: [...currentLayers, ...createdLayers]
      },
      jobLog: appendLog(
        current.jobLog,
        skippedCount
          ? `Added ${createdLayers.length} finishing layer${createdLayers.length === 1 ? "" : "s"}; skipped ${skippedCount} duplicate${skippedCount === 1 ? "" : "s"}.`
          : `Added ${createdLayers.length} finishing layer${createdLayers.length === 1 ? "" : "s"}.`
      ),
      updatedAt: new Date().toISOString()
    });
    await writeEpisodes([updated, ...episodes.filter((item) => item.id !== updated.id)]);
    res.json({ episode: updated, layers: createdLayers, skippedCount });
  } catch (error) {
    res.status(400).json({ error: cleanErrorMessage(error) });
  }
});

app.post("/api/episodes/:id/finishing/music", async (req, res) => {
  const episodes = await readEpisodes();
  const current = episodes.find((item) => item.id === req.params.id);
  if (!current) {
    return res.status(404).json({ error: "Episode not found." });
  }
  if (!elevenLabsApiKey) {
    return res.status(400).json({ error: "ElevenLabs API key is not configured." });
  }

  try {
    const music = await generateElevenVideoMusicLayer({ episode: current, brief: req.body || {} });
    const currentLayers = finishingLayersFromRequestOrEpisode(req, current);
    const updated = normalizeEpisode({
      ...current,
      drafts: {
        ...(current.drafts || {}),
        finishingLayers: [...currentLayers, music.layer]
      },
      outputs: [music.output, ...(current.outputs || [])],
      jobLog: appendLog(current.jobLog, `Generated ElevenLabs music layer: ${music.layer.fileName}.`),
      updatedAt: new Date().toISOString()
    });
    await writeEpisodes([updated, ...episodes.filter((item) => item.id !== updated.id)]);
    res.json({ episode: updated, layer: music.layer, output: music.output });
  } catch (error) {
    const message = cleanErrorMessage(error);
    const updated = normalizeEpisode({
      ...current,
      jobLog: appendLog(current.jobLog, `ElevenLabs music generation failed: ${message}`),
      updatedAt: new Date().toISOString()
    });
    await writeEpisodes([updated, ...episodes.filter((item) => item.id !== updated.id)]);
    res.status(400).json({ error: message, episode: updated });
  }
});

app.post("/api/episodes/:id/finishing/laugh-track", async (req, res) => {
  const episodes = await readEpisodes();
  const current = episodes.find((item) => item.id === req.params.id);
  if (!current) {
    return res.status(404).json({ error: "Episode not found." });
  }
  if (!elevenLabsApiKey) {
    return res.status(400).json({ error: "ElevenLabs API key is not configured." });
  }

  try {
    const currentLayers = finishingLayersFromRequestOrEpisode(req, current);
    const laughTrack = await generateElevenLaughTrackLayer({ episode: current, brief: req.body || {}, currentLayers });
    const generatedLayers = Array.isArray(laughTrack.layers) && laughTrack.layers.length
      ? laughTrack.layers
      : [laughTrack.layer].filter(Boolean);
    const updated = normalizeEpisode({
      ...current,
      drafts: {
        ...(current.drafts || {}),
        finishingLayers: [...currentLayers, ...generatedLayers]
      },
      outputs: [laughTrack.output, ...(current.outputs || [])],
      jobLog: appendLog(
        current.jobLog,
        generatedLayers.length === 0
          ? "Generated ElevenLabs laugh track audio, but no new cue placements were available."
          : generatedLayers.length > 1
          ? `Generated ElevenLabs laugh track and placed ${generatedLayers.length} cues.`
          : `Generated ElevenLabs laugh track layer: ${generatedLayers[0]?.fileName || laughTrack.output.fileName}.`
      ),
      updatedAt: new Date().toISOString()
    });
    await writeEpisodes([updated, ...episodes.filter((item) => item.id !== updated.id)]);
    res.json({ episode: updated, layer: generatedLayers[0] || null, layers: generatedLayers, output: laughTrack.output });
  } catch (error) {
    const message = cleanErrorMessage(error);
    const updated = normalizeEpisode({
      ...current,
      jobLog: appendLog(current.jobLog, `ElevenLabs laugh track generation failed: ${message}`),
      updatedAt: new Date().toISOString()
    });
    await writeEpisodes([updated, ...episodes.filter((item) => item.id !== updated.id)]);
    res.status(400).json({ error: message, episode: updated });
  }
});

app.post("/api/episodes/:id/finishing/applause-track", async (req, res) => {
  const episodes = await readEpisodes();
  const current = episodes.find((item) => item.id === req.params.id);
  if (!current) {
    return res.status(404).json({ error: "Episode not found." });
  }
  if (!elevenLabsApiKey) {
    return res.status(400).json({ error: "ElevenLabs API key is not configured." });
  }

  try {
    const currentLayers = finishingLayersFromRequestOrEpisode(req, current);
    const applauseTrack = await generateElevenApplauseTrackLayer({ episode: current, brief: req.body || {}, currentLayers });
    const generatedLayers = Array.isArray(applauseTrack.layers) && applauseTrack.layers.length
      ? applauseTrack.layers
      : [applauseTrack.layer].filter(Boolean);
    const updated = normalizeEpisode({
      ...current,
      drafts: {
        ...(current.drafts || {}),
        finishingLayers: [...currentLayers, ...generatedLayers]
      },
      outputs: [applauseTrack.output, ...(current.outputs || [])],
      jobLog: appendLog(
        current.jobLog,
        generatedLayers.length === 0
          ? "Generated ElevenLabs applause track audio, but no new cue placements were available."
          : generatedLayers.length > 1
          ? `Generated ElevenLabs applause track and placed ${generatedLayers.length} cues.`
          : `Generated ElevenLabs applause track layer: ${generatedLayers[0]?.fileName || applauseTrack.output.fileName}.`
      ),
      updatedAt: new Date().toISOString()
    });
    await writeEpisodes([updated, ...episodes.filter((item) => item.id !== updated.id)]);
    res.json({ episode: updated, layer: generatedLayers[0] || null, layers: generatedLayers, output: applauseTrack.output });
  } catch (error) {
    const message = cleanErrorMessage(error);
    const updated = normalizeEpisode({
      ...current,
      jobLog: appendLog(current.jobLog, `ElevenLabs applause track generation failed: ${message}`),
      updatedAt: new Date().toISOString()
    });
    await writeEpisodes([updated, ...episodes.filter((item) => item.id !== updated.id)]);
    res.status(400).json({ error: message, episode: updated });
  }
});

app.patch("/api/episodes/:id/finishing-layers", async (req, res) => {
  const episodes = await readEpisodes();
  const current = episodes.find((item) => item.id === req.params.id);
  if (!current) {
    return res.status(404).json({ error: "Episode not found." });
  }
  const layers = normalizeFinishingLayers(req.body?.layers);
  const updated = normalizeEpisode({
    ...current,
    drafts: {
      ...(current.drafts || {}),
      finishingLayers: layers
    },
    jobLog: appendLog(current.jobLog, "Saved finishing layer timeline."),
    updatedAt: new Date().toISOString()
  });
  await writeEpisodes([updated, ...episodes.filter((item) => item.id !== updated.id)]);
  res.json({ episode: updated, layers });
});

app.post("/api/episodes/:id/finishing/export", async (req, res) => {
  const shows = await readShows();
  const episodes = await readEpisodes();
  const current = episodes.find((item) => item.id === req.params.id);
  if (!current) {
    return res.status(404).json({ error: "Episode not found." });
  }
  const show = shows.find((item) => item.id === current.showId) || shows[0];

  try {
    const layers = normalizeFinishingLayers(req.body?.layers || current.drafts?.finishingLayers);
    const episodeForExport = normalizeEpisode({
      ...current,
      drafts: {
        ...(current.drafts || {}),
        finishingLayers: layers
      }
    });
    const finishedMaster = await exportFinishedMaster({ episode: episodeForExport, show, layers });
    const updated = normalizeEpisode({
      ...episodeForExport,
      status: "finished_master_ready",
      currentStage: "Finished Master Ready",
      outputs: [finishedMaster.output, ...(episodeForExport.outputs || []).filter((output) => output.type !== "finished_master")],
      jobLog: appendLog(episodeForExport.jobLog, `Finished master exported: ${finishedMaster.output.localUrl}`),
      updatedAt: new Date().toISOString()
    });
    await writeEpisodes([updated, ...episodes.filter((item) => item.id !== updated.id)]);
    res.json({ episode: updated, finishedMaster });
  } catch (error) {
    res.status(400).json({ error: cleanErrorMessage(error) });
  }
});

app.post("/api/episodes/:id/thumbnails/generate", async (req, res) => {
  const shows = await readShows();
  const episodes = await readEpisodes();
  const current = episodes.find((item) => item.id === req.params.id);
  if (!current) {
    return res.status(404).json({ error: "Episode not found." });
  }
  const show = shows.find((item) => item.id === current.showId) || shows[0];

  try {
    const thumbnailBrief = sanitizeThumbnailBrief(req.body?.thumbnailBrief || req.body?.brief);
    const thumbnails = await generateThumbnailCandidates({ episode: current, show, thumbnailBrief });
    const updated = normalizeEpisode({
      ...current,
      drafts: {
        ...(current.drafts || {}),
        selectedThumbnailOutputId: "",
        thumbnailBrief
      },
      outputs: [...thumbnails.outputs, ...(current.outputs || []).filter((output) => output.type !== "thumbnail_image")],
      jobLog: appendLog(
        current.jobLog,
        `Generated ${thumbnails.outputs.length} ${thumbnails.provider || "local"} thumbnail candidate${thumbnails.outputs.length === 1 ? "" : "s"}.`
      ),
      updatedAt: new Date().toISOString()
    });
    await writeEpisodes([updated, ...episodes.filter((item) => item.id !== updated.id)]);
    res.json({ episode: updated, thumbnails });
  } catch (error) {
    res.status(400).json({ error: cleanErrorMessage(error) });
  }
});

app.patch("/api/episodes/:id/thumbnails/:thumbnailId/select", async (req, res) => {
  const episodes = await readEpisodes();
  const current = episodes.find((item) => item.id === req.params.id);
  if (!current) {
    return res.status(404).json({ error: "Episode not found." });
  }
  const selected = (current.outputs || []).find(
    (output) => output.type === "thumbnail_image" && output.id === req.params.thumbnailId
  );
  if (!selected) {
    return res.status(404).json({ error: "Thumbnail candidate not found." });
  }

  const updated = normalizeEpisode({
    ...current,
    drafts: {
      ...(current.drafts || {}),
      selectedThumbnailOutputId: selected.id,
      selectedThumbnail: {
        id: selected.id,
        name: selected.name || selected.fileName || "Selected thumbnail",
        fileName: selected.fileName || "",
        localUrl: selected.localUrl || "",
        provider: selected.provider || "",
        selectedAt: new Date().toISOString()
      }
    },
    outputs: (current.outputs || []).map((output) =>
      output.type === "thumbnail_image"
        ? {
            ...output,
            isSelected: output.id === selected.id
          }
        : output
    ),
    jobLog: appendLog(current.jobLog, `Selected final thumbnail: ${selected.name || selected.fileName}`),
    updatedAt: new Date().toISOString()
  });
  await writeEpisodes([updated, ...episodes.filter((item) => item.id !== updated.id)]);
  res.json({ episode: updated, thumbnail: selected });
});

app.post("/api/episodes/:id/package/export", async (req, res) => {
  const shows = await readShows();
  const episodes = await readEpisodes();
  const current = episodes.find((item) => item.id === req.params.id);
  if (!current) {
    return res.status(404).json({ error: "Episode not found." });
  }
  const show = shows.find((item) => item.id === current.showId) || shows[0];

  try {
    const requestedDrafts = req.body?.drafts && typeof req.body.drafts === "object" ? req.body.drafts : null;
    const episodeForPackage = normalizeEpisode({
      ...current,
      drafts: requestedDrafts ? { ...(current.drafts || {}), ...requestedDrafts } : current.drafts
    });
    const uploadPackage = await exportUploadPackage({ episode: episodeForPackage, show });
    const updated = normalizeEpisode({
      ...episodeForPackage,
      outputs: [uploadPackage.output, ...(episodeForPackage.outputs || []).filter((output) => output.type !== "package_export")],
      jobLog: appendLog(episodeForPackage.jobLog, `Exported final package: ${uploadPackage.output.fileName}`),
      updatedAt: new Date().toISOString()
    });
    await writeEpisodes([updated, ...episodes.filter((item) => item.id !== updated.id)]);
    res.json({ episode: updated, package: uploadPackage });
  } catch (error) {
    res.status(400).json({ error: cleanErrorMessage(error) });
  }
});

app.post("/api/episodes/:id/package/save-as", async (req, res) => {
  const shows = await readShows();
  const episodes = await readEpisodes();
  const current = episodes.find((item) => item.id === req.params.id);
  if (!current) {
    return res.status(404).json({ error: "Episode not found." });
  }
  const show = shows.find((item) => item.id === current.showId) || shows[0] || defaultShow();

  try {
    const parentPath = normalizePackageParentPath(req.body?.parentPath || req.body?.folderPath);
    if (!parentPath) {
      throw new Error("Choose a folder before saving an episode package.");
    }
    const savedPackage = await writeNewtBuilderEpisodePackage({ episode: current, show, parentPath });
    const output = {
      id: `${randomUUID()}-episode-package`,
      type: "episode_package",
      name: "NewtBuilder episode package",
      fileName: savedPackage.packageName,
      packagePath: savedPackage.packagePath,
      manifestPath: savedPackage.manifestPath,
      createdAt: savedPackage.exportedAt
    };
    const updated = normalizeEpisode({
      ...current,
      outputs: [output, ...(current.outputs || [])],
      jobLog: appendLog(current.jobLog, `Episode package saved to ${savedPackage.packagePath}.`),
      updatedAt: savedPackage.exportedAt
    });
    await writeEpisodes([updated, ...episodes.filter((item) => item.id !== updated.id)]);
    res.json({ episode: updated, package: savedPackage });
  } catch (error) {
    res.status(400).json({ error: cleanErrorMessage(error) });
  }
});

app.get("/api/episodes/:id/launch-readiness", async (req, res) => {
  const shows = await readShows();
  const episodes = await readEpisodes();
  const current = episodes.find((item) => item.id === req.params.id);
  if (!current) {
    return res.status(404).json({ error: "Episode not found." });
  }
  const show = shows.find((item) => item.id === current.showId) || shows[0];

  try {
    const readiness = await buildLaunchReadiness({ episode: current, show });
    res.json(readiness);
  } catch (error) {
    res.status(400).json({ error: cleanErrorMessage(error) });
  }
});

app.post("/api/episodes/:id/youtube/upload-draft", async (req, res) => {
  const shows = await readShows();
  const episodes = await readEpisodes();
  const current = episodes.find((item) => item.id === req.params.id);
  if (!current) {
    return res.status(404).json({ error: "Episode not found." });
  }
  const show = shows.find((item) => item.id === current.showId) || shows[0];

  try {
    if (!publishingEnabled) {
      throw new Error("YouTube upload is locked. Set NEWTBUILDER_ENABLE_PUBLISHING=true when you are ready to send private drafts to YouTube.");
    }
    if (!(await youtubeOAuthConfigured())) {
      throw new Error("YouTube OAuth is not configured. Add YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET, then use Connect YouTube.");
    }

    const requestedDrafts = req.body?.drafts && typeof req.body.drafts === "object" ? req.body.drafts : null;
    const episodeForUpload = normalizeEpisode({
      ...current,
      drafts: requestedDrafts ? { ...(current.drafts || {}), ...requestedDrafts } : current.drafts
    });
    const readiness = await buildLaunchReadiness({ episode: episodeForUpload, show });
    if (!readiness.canUploadPrivateDraft) {
      const details = readiness.blockers
        .slice(0, 4)
        .map((check) => check.label)
        .join(", ");
      throw new Error(`Launch readiness failed before upload.${details ? ` Fix: ${details}.` : ""}`);
    }
    const uploadResult = await uploadYouTubePrivateDraft({ episode: episodeForUpload, show });
    const output = {
      id: `${uploadResult.uploadId}-youtube`,
      type: "youtube_upload",
      name: "YouTube private draft",
      videoId: uploadResult.videoId,
      localUrl: uploadResult.watchUrl,
      watchUrl: uploadResult.watchUrl,
      studioUrl: uploadResult.studioUrl,
      privacyStatus: "private",
      requestedPrivacyStatus: uploadResult.requestedPrivacyStatus || "private",
      metadataTitle: uploadResult.metadata?.youtube?.title || "",
      plannedPublishAt: uploadResult.metadata?.youtube?.plannedPublishAt || "",
      publishNotes: uploadResult.metadata?.youtube?.publishNotes || "",
      thumbnailSet: Boolean(uploadResult.thumbnailSet),
      thumbnailWarning: uploadResult.thumbnailWarning || "",
      shortsThumbnailApplied: Boolean(uploadResult.shortsThumbnailApplied),
      shortsThumbnailFrameSeconds: uploadResult.shortsThumbnailFrameSeconds || 0,
      uploadVideoFileName: uploadResult.uploadVideoFileName || "",
      createdAt: uploadResult.createdAt
    };
    const updated = normalizeEpisode({
      ...episodeForUpload,
      outputs: [output, ...(episodeForUpload.outputs || []).filter((item) => item.type !== "youtube_upload")],
      jobLog: appendLog(
        episodeForUpload.jobLog,
        `Uploaded private YouTube draft: ${uploadResult.watchUrl}${
          uploadResult.metadata?.youtube?.shortsThumbnail
            ? uploadResult.shortsThumbnailApplied
              ? ` Shorts thumbnail frame added (${uploadResult.shortsThumbnailFrameSeconds || shortsThumbnailFrameSeconds}s).`
              : " Shorts thumbnail frame was requested but not confirmed."
            : ""
        }${
          uploadResult.thumbnailWarning ? ` Thumbnail warning: ${uploadResult.thumbnailWarning}` : ""
        }`
      ),
      updatedAt: new Date().toISOString()
    });
    const job = {
      id: randomUUID(),
      episodeId: current.id,
      showId: show.id,
      status: "youtube_private_draft_ready",
      currentStage: "YouTube Private Draft Ready",
      createdAt: output.createdAt,
      summary: `Private YouTube draft uploaded. Video ID: ${uploadResult.videoId}${
        uploadResult.shortsThumbnailApplied ? " Shorts thumbnail frame added." : ""
      }`,
      steps: [
        { id: "youtube_video", label: "Upload video as private draft", enabled: true, status: "uploaded" },
        {
          id: "youtube_shorts_thumbnail",
          label: "Add Shorts thumbnail frame",
          enabled: Boolean(uploadResult.metadata?.youtube?.shortsThumbnail),
          status: uploadResult.shortsThumbnailApplied ? "uploaded" : "skipped"
        },
        { id: "youtube_thumbnail", label: "Set thumbnail", enabled: true, status: uploadResult.thumbnailSet ? "uploaded" : "warning" }
      ]
    };
    const jobs = await readJobs();
    await writeJobs([job, ...jobs].slice(0, 200));
    await writeEpisodes([updated, ...episodes.filter((item) => item.id !== updated.id)]);
    res.json({ episode: updated, job, upload: uploadResult });
  } catch (error) {
    res.status(400).json({ error: cleanErrorMessage(error) });
  }
});

app.post("/api/episodes/:id/youtube/retry-thumbnail", async (req, res) => {
  const shows = await readShows();
  const episodes = await readEpisodes();
  const current = episodes.find((item) => item.id === req.params.id);
  if (!current) {
    return res.status(404).json({ error: "Episode not found." });
  }
  const show = shows.find((item) => item.id === current.showId) || shows[0];

  try {
    if (!publishingEnabled) {
      throw new Error("YouTube upload is locked. Set NEWTBUILDER_ENABLE_PUBLISHING=true when you are ready to send private drafts to YouTube.");
    }
    if (!(await youtubeOAuthConfigured())) {
      throw new Error("YouTube OAuth is not configured. Add YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET, then use Connect YouTube.");
    }

    const youtubeOutput = (current.outputs || []).find((output) => output.type === "youtube_upload" && output.videoId);
    if (!youtubeOutput?.videoId) {
      throw new Error("Upload a private YouTube draft before retrying the thumbnail.");
    }
    const selectedThumbnail = selectedThumbnailOutput(current);
    const thumbnailPath = outputFilePath(selectedThumbnail);
    if (!thumbnailPath) {
      throw new Error("Select a final thumbnail before retrying the YouTube thumbnail.");
    }

    const retryId = randomUUID();
    const tempDir = path.join(outputsDir, "tmp", `youtube-thumbnail-${retryId}`);
    await mkdir(tempDir, { recursive: true });

    let thumbnailSet = false;
    let thumbnailWarning = "";
    try {
      const accessToken = await youtubeAccessToken();
      const thumbnail = await prepareYouTubeThumbnail({ thumbnailPath, tempDir });
      await setYouTubeThumbnail({
        accessToken,
        videoId: youtubeOutput.videoId,
        thumbnailPath: thumbnail.filePath,
        mimeType: thumbnail.mimeType
      });
      thumbnailSet = true;
      thumbnailWarning = thumbnail.converted ? "Thumbnail was converted to a YouTube-safe JPEG under 2MB before upload." : "";
    } catch (error) {
      thumbnailWarning = cleanErrorMessage(error);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }

    const updatedYoutubeOutput = {
      ...youtubeOutput,
      thumbnailSet,
      thumbnailWarning,
      updatedAt: new Date().toISOString()
    };
    const updated = normalizeEpisode({
      ...current,
      outputs: [updatedYoutubeOutput, ...(current.outputs || []).filter((output) => output.id !== youtubeOutput.id)],
      jobLog: appendLog(
        current.jobLog,
        thumbnailSet
          ? `Updated YouTube thumbnail for private draft: ${youtubeOutput.watchUrl || youtubeOutput.localUrl || youtubeOutput.videoId}`
          : `YouTube thumbnail retry warning: ${thumbnailWarning}`
      ),
      updatedAt: new Date().toISOString()
    });
    const job = {
      id: randomUUID(),
      episodeId: current.id,
      showId: show.id,
      status: thumbnailSet ? "youtube_thumbnail_ready" : "youtube_thumbnail_warning",
      currentStage: thumbnailSet ? "YouTube Thumbnail Ready" : "YouTube Thumbnail Warning",
      createdAt: updatedYoutubeOutput.updatedAt,
      summary: thumbnailSet
        ? `YouTube thumbnail set for video ID: ${youtubeOutput.videoId}`
        : `YouTube thumbnail retry warning: ${thumbnailWarning}`,
      steps: [{ id: "youtube_thumbnail", label: "Set thumbnail", enabled: true, status: thumbnailSet ? "uploaded" : "warning" }]
    };
    const jobs = await readJobs();
    await writeJobs([job, ...jobs].slice(0, 200));
    await writeEpisodes([updated, ...episodes.filter((item) => item.id !== updated.id)]);
    res.json({
      episode: updated,
      job,
      upload: {
        videoId: youtubeOutput.videoId,
        watchUrl: youtubeOutput.watchUrl || youtubeOutput.localUrl || `https://youtu.be/${youtubeOutput.videoId}`,
        studioUrl: youtubeOutput.studioUrl || `https://studio.youtube.com/video/${youtubeOutput.videoId}/edit`,
        thumbnailSet,
        thumbnailWarning
      }
    });
  } catch (error) {
    res.status(400).json({ error: cleanErrorMessage(error) });
  }
});

app.post("/api/episodes/:id/youtube/check-status", async (req, res) => {
  const shows = await readShows();
  const episodes = await readEpisodes();
  const current = episodes.find((item) => item.id === req.params.id);
  if (!current) {
    return res.status(404).json({ error: "Episode not found." });
  }
  const show = shows.find((item) => item.id === current.showId) || shows[0];

  try {
    if (!(await youtubeOAuthConfigured())) {
      throw new Error("YouTube OAuth is not configured. Add YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET, then use Connect YouTube.");
    }
    const youtubeOutput = (current.outputs || []).find((output) => output.type === "youtube_upload" && output.videoId);
    if (!youtubeOutput?.videoId) {
      throw new Error("Upload a private YouTube draft before checking YouTube status.");
    }

    const accessToken = await youtubeAccessToken();
    const youtubeStatus = await fetchYouTubeVideoStatus({ accessToken, videoId: youtubeOutput.videoId });
    const checkedAt = new Date().toISOString();
    const updatedYoutubeOutput = {
      ...youtubeOutput,
      youtubeStatus: {
        ...youtubeStatus,
        checkedAt
      },
      privacyStatus: youtubeStatus.privacyStatus || youtubeOutput.privacyStatus || "private",
      updatedAt: checkedAt
    };
    const updated = normalizeEpisode({
      ...current,
      outputs: [updatedYoutubeOutput, ...(current.outputs || []).filter((output) => output.id !== youtubeOutput.id)],
      jobLog: appendLog(
        current.jobLog,
        `Checked YouTube draft status: ${youtubeStatus.privacyStatus || "unknown privacy"}, ${youtubeStatus.uploadStatus || "unknown upload status"}`
      ),
      updatedAt: checkedAt
    });
    const job = {
      id: randomUUID(),
      episodeId: current.id,
      showId: show.id,
      status: "youtube_status_checked",
      currentStage: "YouTube Status Checked",
      createdAt: checkedAt,
      summary: `YouTube status checked for video ID: ${youtubeOutput.videoId}`,
      steps: [{ id: "youtube_status", label: "Check YouTube draft status", enabled: true, status: "checked" }]
    };
    const jobs = await readJobs();
    await writeJobs([job, ...jobs].slice(0, 200));
    await writeEpisodes([updated, ...episodes.filter((item) => item.id !== updated.id)]);
    res.json({ episode: updated, job, youtubeStatus: updatedYoutubeOutput.youtubeStatus });
  } catch (error) {
    res.status(400).json({ error: cleanErrorMessage(error) });
  }
});

app.post("/api/episodes/:id/audio/rebuild-mix", async (req, res) => {
  const shows = await readShows();
  const episodes = await readEpisodes();
  const current = episodes.find((item) => item.id === req.params.id);
  if (!current) {
    return res.status(404).json({ error: "Episode not found." });
  }
  const show = shows.find((item) => item.id === current.showId) || shows[0];
  const reportId = randomUUID();

  try {
    let report = await writeLocalBuildReport({ reportId, episode: current, show, blockedGate: null });
    const preview = await createLocalPreview({ previewId: reportId, episode: current, show, renderVideo: false });
    report = await attachPreviewToReport(report, preview);
    const productionMap = attachAudioTakesToProductionMap(current.productionMap, preview.manifest.lines);
    const outputs = [
      ...preview.outputs,
      {
        id: reportId,
        type: "build_report",
        name: report.fileName,
        localUrl: report.localUrl,
        createdAt: report.createdAt
      }
    ];
    const updated = normalizeEpisode({
      ...current,
      productionMap,
      status: current.status,
      currentStage: current.currentStage,
      outputs: [...outputs, ...(current.outputs || [])],
      jobLog: appendLog(current.jobLog, `Audio review mix rebuilt. Report: ${report.localUrl}`),
      updatedAt: new Date().toISOString()
    });
    const job = {
      id: randomUUID(),
      episodeId: current.id,
      showId: show.id,
      status: "audio_mix_ready",
      currentStage: updated.currentStage,
      createdAt: new Date().toISOString(),
      summary: "Audio review mix rebuilt. No publishing was attempted.",
      steps: [{ id: "audio_review", label: "Rebuild audio mix", enabled: true, status: "rendered" }]
    };
    const jobs = await readJobs();
    await writeJobs([job, ...jobs].slice(0, 200));
    await writeEpisodes([updated, ...episodes.filter((item) => item.id !== updated.id)]);
    res.json({ episode: updated, job, report });
  } catch (error) {
    res.status(400).json({ error: cleanErrorMessage(error) });
  }
});

app.post("/api/episodes/:id/audio/regenerate-all", async (req, res) => {
  const shows = await readShows();
  const episodes = await readEpisodes();
  const current = episodes.find((item) => item.id === req.params.id);
  if (!current) {
    return res.status(404).json({ error: "Episode not found." });
  }
  const show = shows.find((item) => item.id === current.showId) || shows[0];
  const format = normalizeShortFormat({
    ...(show?.shortFormat || {}),
    ...(current.format || {})
  });
  const reportId = randomUUID();

  try {
    const submittedMap = Array.isArray(req.body?.productionMap) ? req.body.productionMap : current.productionMap;
    const productionMapEditedAt = String(req.body?.productionMapEditedAt ?? current.productionMapEditedAt ?? "");
    const clearedProductionMap = normalizeProductionMapForFormat(submittedMap, format).map((line, index) =>
      clearAudioForFullRegeneration(line, index)
    );
    const episodeForAudio = normalizeEpisode({
      ...current,
      format,
      productionMap: clearedProductionMap,
      productionMapEditedAt,
      approvals: resetRenderApproval(current.approvals, "All dialogue audio changed after render review."),
      updatedAt: new Date().toISOString()
    });

    let report = await writeLocalBuildReport({ reportId, episode: episodeForAudio, show, blockedGate: null });
    const preview = await createLocalPreview({ previewId: reportId, episode: episodeForAudio, show, renderVideo: false });
    report = await attachPreviewToReport(report, preview);
    const productionMap = attachAudioTakesToProductionMap(episodeForAudio.productionMap, preview.manifest.lines);
    const outputs = [
      ...preview.outputs,
      {
        id: reportId,
        type: "build_report",
        name: report.fileName,
        localUrl: report.localUrl,
        createdAt: report.createdAt
      }
    ];
    const updated = normalizeEpisode({
      ...episodeForAudio,
      productionMap,
      status: current.status,
      currentStage: current.currentStage,
      outputs: [...outputs, ...(current.outputs || [])],
      jobLog: appendLog(current.jobLog, `All dialogue audio regenerated. Report: ${report.localUrl}`),
      updatedAt: new Date().toISOString()
    });
    const job = {
      id: randomUUID(),
      episodeId: current.id,
      showId: show.id,
      status: "audio_regenerated",
      currentStage: updated.currentStage,
      createdAt: new Date().toISOString(),
      summary: "All dialogue audio regenerated and the audio review mix was rebuilt. No publishing was attempted.",
      steps: [{ id: "audio_regenerate", label: "Regenerate all dialogue audio", enabled: true, status: "rendered" }]
    };
    const jobs = await readJobs();
    await writeJobs([job, ...jobs].slice(0, 200));
    await writeEpisodes([updated, ...episodes.filter((item) => item.id !== updated.id)]);
    res.json({ episode: updated, job, report });
  } catch (error) {
    res.status(400).json({ error: cleanErrorMessage(error) });
  }
});

app.get("/api/jobs", async (_req, res) => {
  res.json(await readJobs());
});

function scheduleNewtBuilderRestart() {
  const timer = setTimeout(() => {
    let launched = false;
    const launchReplacement = () => {
      if (launched) return;
      launched = true;
      try {
        const child = spawnNewtBuilderBackendProcess();
        console.log(`NewtBuilder replacement backend launched as PID ${child.pid}.`);
        const exitTimer = setTimeout(() => process.exit(0), 150);
      } catch (error) {
        launched = false;
        console.error("NewtBuilder restart failed before replacement launch:", error);
      }
    };

    const server = globalThis.newtBuilderApiServer;
    if (server && typeof server.close === "function") {
      server.close(() => {
        const launchTimer = setTimeout(launchReplacement, 250);
      });
      const fallbackTimer = setTimeout(launchReplacement, 1500);
      return;
    }

    launchReplacement();
  }, 350);
}

function spawnNewtBuilderBackendProcess() {
  mkdirSync(logsDir, { recursive: true });
  const outFd = openSync(path.join(logsDir, "newtbuilder-restart.out.log"), "a");
  const errFd = openSync(path.join(logsDir, "newtbuilder-restart.err.log"), "a");
  try {
    const child = spawn(process.execPath, [__filename], {
      cwd: rootDir,
      detached: true,
      stdio: ["ignore", outFd, errFd],
      windowsHide: true,
      env: sanitizedRestartEnv()
    });
    child.unref();
    return child;
  } catch (error) {
    closeFdQuietly(outFd);
    closeFdQuietly(errFd);
    throw error;
  } finally {
    closeFdQuietly(outFd);
    closeFdQuietly(errFd);
  }
}

function sanitizedRestartEnv() {
  const env = {};
  const seen = new Set();
  let pathValue = "";
  for (const [key, value] of Object.entries(process.env)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey === "path") {
      pathValue = pathValue || value;
      continue;
    }
    if (seen.has(lowerKey)) continue;
    seen.add(lowerKey);
    env[key] = value;
  }
  if (pathValue) {
    env[process.platform === "win32" ? "Path" : "PATH"] = pathValue;
  }
  env.PYTHONUTF8 = env.PYTHONUTF8 || "1";
  env.PYTHONIOENCODING = env.PYTHONIOENCODING || "utf-8";
  env.NEWTBUILDER_RESTARTED_AT = new Date().toISOString();
  return env;
}

async function restartComfyUiBackend() {
  const target = comfyUiConnectionTarget();
  if (target.port === port) {
    throw new Error("COMFYUI_BASE_URL is using the NewtBuilder API port. Set ComfyUI to a different port before rebooting it.");
  }
  await stopProcessListeningOnPort(target.port);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const launched = await launchComfyUiBackend();
  const status = await waitForComfyUiReachable(comfyUiAutoStartTimeoutMs(120000));
  if (!status.reachable) {
    throw new Error(`ComfyUI launched via ${launched.mode}, but ${status.baseUrl} did not answer. ${status.error || ""}`.trim());
  }
  return {
    ...status,
    launched,
    restartedAt: new Date().toISOString()
  };
}

async function stopProcessListeningOnPort(portNumber) {
  const portValue = Number(portNumber);
  if (!Number.isFinite(portValue) || portValue <= 0) return;
  if (process.platform === "win32") {
    const script = `
$ErrorActionPreference = 'SilentlyContinue'
$ids = Get-NetTCPConnection -LocalPort ${Math.round(portValue)} -State Listen | Select-Object -ExpandProperty OwningProcess -Unique
foreach ($id in $ids) {
  if ($id -and $id -ne $PID) {
    Stop-Process -Id $id -Force
  }
}
`;
    await execFileAsync(powershellCommand(), ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
      windowsHide: true,
      timeout: 30000
    });
    return;
  }

  const shell = process.env.SHELL || "/bin/sh";
  const command = `pids=$(lsof -ti tcp:${Math.round(portValue)} -sTCP:LISTEN 2>/dev/null || true); if [ -n "$pids" ]; then kill $pids; fi`;
  await execFileAsync(shell, ["-lc", command], { timeout: 30000 }).catch(() => {});
}

async function selectFolderWithDialog({ title = "Choose folder", defaultPath = "" } = {}) {
  if (process.platform === "win32") return selectFolderWithWindowsDialog({ title, defaultPath });
  if (process.platform === "darwin") return selectFolderWithMacDialog({ title, defaultPath });
  return selectFolderWithLinuxDialog({ title, defaultPath });
}

async function selectFolderWithWindowsDialog({ title, defaultPath }) {
  const selectedPath = existingDirectoryPath(defaultPath);
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = ${powershellStringLiteral(title)}
$dialog.ShowNewFolderButton = $true
$selectedPath = ${powershellStringLiteral(selectedPath)}
if ($selectedPath -and (Test-Path -LiteralPath $selectedPath)) {
  $dialog.SelectedPath = $selectedPath
}
$result = $dialog.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
  Write-Output $dialog.SelectedPath
  exit 0
}
exit 2
`;
  return runFolderDialogCommand(powershellCommand(), ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script]);
}

async function selectFolderWithMacDialog({ title, defaultPath }) {
  const selectedPath = existingDirectoryPath(defaultPath);
  const script = selectedPath
    ? `POSIX path of (choose folder with prompt ${JSON.stringify(title)} default location POSIX file ${JSON.stringify(selectedPath)})`
    : `POSIX path of (choose folder with prompt ${JSON.stringify(title)})`;
  return runFolderDialogCommand("osascript", ["-e", script]);
}

async function selectFolderWithLinuxDialog({ title, defaultPath }) {
  const selectedPath = existingDirectoryPath(defaultPath) || rootDir;
  try {
    return await runFolderDialogCommand("zenity", ["--file-selection", "--directory", "--title", title, "--filename", selectedPath]);
  } catch (error) {
    if (error.code === "DIALOG_CANCELED") throw error;
    return runFolderDialogCommand("kdialog", ["--getexistingdirectory", selectedPath]);
  }
}

async function runFolderDialogCommand(command, args) {
  try {
    const { stdout } = await execFileAsync(command, args, { windowsHide: false, timeout: 120000 });
    const selectedPath = String(stdout || "").trim();
    if (!selectedPath) {
      const canceled = new Error("Folder selection canceled.");
      canceled.code = "DIALOG_CANCELED";
      throw canceled;
    }
    return selectedPath;
  } catch (error) {
    if (error.code === "DIALOG_CANCELED" || error.code === 2) {
      const canceled = new Error("Folder selection canceled.");
      canceled.code = "DIALOG_CANCELED";
      throw canceled;
    }
    throw error;
  }
}

function existingDirectoryPath(value) {
  const candidate = String(value || "").trim();
  if (!candidate) return "";
  const resolved = path.resolve(candidate);
  return existsSync(resolved) ? resolved : "";
}

function powershellCommand() {
  if (process.platform !== "win32") return "pwsh";
  const configured = String(process.env.POWERSHELL_PATH || "").trim();
  if (configured) return configured;
  const candidates = [
    "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
    "C:/Windows/Sysnative/WindowsPowerShell/v1.0/powershell.exe",
    "powershell.exe"
  ];
  return candidates.find((candidate) => candidate === "powershell.exe" || existsSync(candidate)) || "powershell.exe";
}

function resolveMediaToolCommand(envKey, commandName, candidates = []) {
  const configured = String(process.env[envKey] || "").trim();
  if (configured) return configured;
  const selected = candidates.find((candidate) => {
    const text = String(candidate || "").trim();
    return text && existsSync(path.resolve(text));
  });
  return selected || commandName;
}

function powershellStringLiteral(value) {
  return `'${String(value || "").replace(/'/g, "''")}'`;
}

app.use((error, _req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  const status = Number(error?.status || error?.statusCode || 500);
  const message = cleanErrorMessage(error) || "NewtBuilder backend error.";
  res.status(status >= 400 && status < 600 ? status : 500).json({ error: message });
});

globalThis.newtBuilderApiServer = http.createServer(app).listen(port, "127.0.0.1", () => {
  console.log(`NewtBuilder API listening on http://127.0.0.1:${port}`);
});

async function readShows() {
  const shows = await readJson(showsPath, null);
  if (Array.isArray(shows) && shows.length) {
    return shows.map(normalizeShow);
  }
  const seeded = [defaultShow()];
  await writeShows(seeded);
  return seeded;
}

async function writeShows(shows) {
  await writeFile(showsPath, JSON.stringify(shows.map(normalizeShow), null, 2));
}

async function readEpisodes() {
  const episodes = await readJson(episodesPath, []);
  return Array.isArray(episodes) ? episodes.map(normalizeEpisode) : [];
}

async function writeEpisodes(episodes) {
  await writeFile(episodesPath, JSON.stringify(episodes.map(normalizeEpisode), null, 2));
}

function episodeShelfOrderValue(episode) {
  const sortOrder = Number(episode?.sortOrder);
  if (Number.isFinite(sortOrder)) return sortOrder;
  const timestamp = Date.parse(episode?.createdAt || episode?.updatedAt || "");
  return Number.isFinite(timestamp) ? -timestamp : Number.MAX_SAFE_INTEGER;
}

function episodeTimestampValue(episode) {
  const timestamp = Date.parse(episode?.updatedAt || episode?.createdAt || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sortEpisodesForShelf(episodes = []) {
  return [...episodes].sort((a, b) => {
    const showCompare = String(a.showId || "").localeCompare(String(b.showId || ""));
    if (showCompare) return showCompare;
    return (
      episodeShelfOrderValue(a) - episodeShelfOrderValue(b) ||
      episodeTimestampValue(b) - episodeTimestampValue(a) ||
      String(a.title || "").localeCompare(String(b.title || ""))
    );
  });
}

function nextEpisodeSortOrder(episodes = [], showId = "") {
  const showEpisodes = (Array.isArray(episodes) ? episodes : []).filter((episode) => episode.showId === showId);
  if (!showEpisodes.length) return 0;
  return Math.min(...showEpisodes.map(episodeShelfOrderValue)) - 1;
}

async function readJobs() {
  const jobs = await readJson(jobsPath, []);
  return Array.isArray(jobs) ? jobs : [];
}

async function writeJobs(jobs) {
  await writeFile(jobsPath, JSON.stringify(jobs, null, 2));
}

function parseJsonObject(value) {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function deleteStoredUpload(storedFileName) {
  const filePath = uploadPathForStoredFileName(storedFileName);
  if (!filePath) return;
  await rm(filePath, { force: true });
}

async function deleteStoredUploadIfUnreferenced(storedFileName, episodes = []) {
  if (!uploadFileNameFromStored(storedFileName)) return;
  if (storedUploadReferencedByEpisodes(storedFileName, episodes)) return;
  await deleteStoredUpload(storedFileName);
}

function uploadPathForStoredFileName(storedFileName) {
  const safeName = uploadFileNameFromStored(storedFileName);
  if (!safeName) return "";
  const uploadsRoot = path.resolve(uploadsDir);
  const filePath = path.resolve(uploadsRoot, safeName);
  return filePath.startsWith(`${uploadsRoot}${path.sep}`) ? filePath : "";
}

function uploadFileNameFromStored(storedFileName) {
  return path.basename(String(storedFileName || "").trim());
}

function uploadFileNameFromAsset(asset = {}) {
  const storedName = uploadFileNameFromStored(asset.storedFileName);
  if (storedName) return storedName;
  const localUrl = String(asset.localUrl || "").trim();
  return localUrl.startsWith("/uploads/") ? path.basename(localUrl) : "";
}

function storedUploadReferencedByEpisodes(storedFileName, episodes = []) {
  const targetName = uploadFileNameFromStored(storedFileName);
  if (!targetName) return false;
  return (Array.isArray(episodes) ? episodes : []).some((episode) =>
    (episode.assets || []).some((asset) => uploadFileNameFromAsset(asset) === targetName)
  );
}

async function cloneStoredUploadForDuplicate(asset = {}) {
  const sourcePath = uploadPathForStoredFileName(asset.storedFileName) || localProjectFilePath(asset.localUrl);
  if (!sourcePath || !existsSync(sourcePath)) return {};

  const extension = path.extname(asset.fileName || asset.storedFileName || sourcePath) || ".bin";
  const basename =
    path
      .basename(asset.fileName || asset.storedFileName || "asset", path.extname(asset.fileName || asset.storedFileName || ""))
      .replace(/[^a-z0-9_-]+/gi, "-")
      .slice(0, 80) || "asset";

  for (let guard = 0; guard < 20; guard += 1) {
    const storedFileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}-${basename}${extension}`;
    const targetPath = uploadPathForStoredFileName(storedFileName);
    if (!targetPath || existsSync(targetPath)) continue;
    await copyFile(sourcePath, targetPath);
    return {
      storedFileName,
      localUrl: `/uploads/${storedFileName}`
    };
  }

  return {};
}

function clearAssetFromProductionMap(productionMap = [], assetId) {
  return (Array.isArray(productionMap) ? productionMap : []).map((line) => ({
    ...line,
    assetId: line.assetId === assetId ? "" : line.assetId,
    maskAssetId: line.maskAssetId === assetId ? "" : line.maskAssetId,
    insertEndAssetId: line.insertEndAssetId === assetId ? "" : line.insertEndAssetId
  }));
}

function clearMaskAssetsFromProductionMap(productionMap = [], maskAssetIds = new Set()) {
  if (!maskAssetIds?.size) return productionMap;
  return (Array.isArray(productionMap) ? productionMap : []).map((line) => {
    if (!maskAssetIds.has(line.maskAssetId)) return line;
    return {
      ...line,
      maskAssetId: "",
      needsMask: false,
      invertMask: false
    };
  });
}

function applySpeakerMaskToMatchingLines(productionMap = [], targetLine, maskAssetId) {
  const normalizedTarget = normalizeProductionLine(targetLine);
  return (Array.isArray(productionMap) ? productionMap : []).map((item, index) => {
    const line = normalizeProductionLine(item, index);
    if (!productionLinesShareSpeakerMask(line, normalizedTarget)) return line;
    return normalizeProductionLine(
      {
        ...line,
        needsMask: true,
        maskAssetId,
        maskAutoApplyDisabled: false,
        maskRefreshToken: String(targetLine.maskRefreshToken || line.maskRefreshToken || "").trim(),
        invertMask: false
      },
      index
    );
  });
}

function productionLinesShareSpeakerMask(line, targetLine) {
  if (!line || !targetLine) return false;
  if (line.lineType === "insert" || targetLine.lineType === "insert") return false;
  if (!line.assetId || line.assetId !== targetLine.assetId) return false;
  const leftCharacter = cleanId(line.characterId);
  const rightCharacter = cleanId(targetLine.characterId);
  if (leftCharacter && rightCharacter) return leftCharacter === rightCharacter;
  return keyForMatch(line.speaker) === keyForMatch(targetLine.speaker);
}

function speakerMaskReuseKey(line) {
  const characterId = cleanId(line?.characterId);
  if (characterId) return `character:${characterId}`;
  const speakerKey = keyForMatch(line?.speaker);
  return speakerKey ? `speaker:${speakerKey}` : `speaker-type:${speakerTypeFor(line?.speaker)}`;
}

function lineCanUseSpeakerMask(line, asset) {
  if (!line || line.lineType === "insert" || !asset) return false;
  const shotRole = sanitizeShotRole(line.shotRole || effectiveAssetShotRole(asset));
  const assetShotRole = effectiveAssetShotRole(asset);
  return ["medium_two_shot", "wide_shot"].includes(shotRole) || ["medium_two_shot", "wide_shot"].includes(assetShotRole);
}

function lineExpectsSpeakerMask(line, asset) {
  if (!lineCanUseSpeakerMask(line, asset)) return false;
  return assetShotBinding(asset).roles.length > 1;
}

function speakerMaskMatchesLine(maskAsset, line) {
  if (!maskAsset || !line) return false;
  if (
    maskAsset.metadata?.kind === "speaker-auto-mask" &&
    String(maskAsset.metadata?.postProcessVersion || "") !== autoSpeakerMaskVersion
  ) {
    return false;
  }
  const lineRefreshToken = String(line.maskRefreshToken || "").trim();
  const assetRefreshToken = String(maskAsset.metadata?.maskRefreshToken || "").trim();
  return (
    cleanId(maskAsset.metadata?.sourceImageAssetId) === cleanId(line.assetId) &&
    String(maskAsset.metadata?.speakerMaskKey || "") === speakerMaskReuseKey(line) &&
    (lineRefreshToken ? assetRefreshToken === lineRefreshToken : !assetRefreshToken)
  );
}

async function ensureAutomaticSpeakerMasksForEpisode(episode, show = null) {
  const working = normalizeEpisode(episode);
  let assets = Array.isArray(working.assets) ? working.assets.map(normalizeAsset) : [];
  let productionMap = Array.isArray(working.productionMap)
    ? working.productionMap.map((line, index) => normalizeProductionLine(line, index))
    : [];
  let createdCount = 0;

  for (const line of productionMap) {
    const assetById = new Map(assets.map((asset) => [asset.id, asset]));
    const imageAsset = assetById.get(line.assetId);
    if (line.maskAutoApplyDisabled) continue;
    if (!lineExpectsSpeakerMask(line, imageAsset)) continue;

    const selectedMask = assetById.get(line.maskAssetId);
    if (speakerMaskMatchesLine(selectedMask, line)) continue;

    const matchingMask = assets.find(
      (asset) =>
        asset.shotRole === "mask" &&
        speakerMaskMatchesLine(asset, line)
    );
    if (matchingMask) {
      productionMap = applySpeakerMaskToMatchingLines(productionMap, line, matchingMask.id);
      continue;
    }

    const generated = await generateAutomaticSpeakerMaskForLine({ line, imageAsset, show });
    if (!generated?.asset) continue;
    assets = [...assets, generated.asset];
    productionMap = applySpeakerMaskToMatchingLines(productionMap, line, generated.asset.id);
    createdCount += 1;
  }

  return normalizeEpisode({
    ...working,
    assets,
    productionMap,
    jobLog: createdCount
      ? appendLog(working.jobLog, `Created ${createdCount} automatic speaker mask${createdCount === 1 ? "" : "s"}.`)
      : working.jobLog
  });
}

async function readJson(filePath, fallback) {
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function normalizeShow(show) {
  return {
    id: cleanId(show.id) || randomUUID(),
    name: String(show.name || "New Show").trim() || "New Show",
    description: String(show.description || "").trim(),
    createdAt: show.createdAt || new Date().toISOString(),
    updatedAt: show.updatedAt || new Date().toISOString(),
    shortFormat: normalizeShortFormat(show.shortFormat),
    creative: {
      audience: "general viewers",
      visualStyle: "expressive cinematic animated episodes",
      tone: "curious, funny, fast-moving",
      thumbnailStyle: "bold character moment, clean text, strong expression",
      musicPolicy: "royalty-free or cleared music only",
      defaultCta: "Follow for the next episode.",
      recurringHashtags: ["#animatedseries", "#episode"],
      ...(show.creative || {})
    },
    production: {
      ...(show.production || {}),
      defaultLipSyncModel: sanitizeLipSyncModel(show.production?.defaultLipSyncModel || defaultLipSyncModel()),
      infiniteTalkBackend: sanitizeInfiniteTalkBackend(show.production?.infiniteTalkBackend || defaultInfiniteTalkBackend()),
      defaultExpressiveBodyMotion: Boolean(show.production?.defaultExpressiveBodyMotion),
      defaultInsertTrimSeconds: Number(show.production?.defaultInsertTrimSeconds || insertTrimDefaultSeconds)
    },
    automation: {
      ...automationDefaults,
      ...(show.automation || {})
    },
    platforms: {
      youtube: {
        enabled: true,
        privacyStatus: "private",
        categoryId: "24",
        notifySubscribers: false,
        madeForKids: false,
        containsSyntheticMedia: true,
        defaultTags: ["animated series", "episode"],
        ...(show.platforms?.youtube || {})
      },
      social: {
        enabledTargets: [],
        defaultLinkStrategy: "youtube",
        ...(show.platforms?.social || {}),
        templates: normalizePromotionTemplates(show.platforms?.social?.templates)
      }
    },
    characters: Array.isArray(show.characters)
      ? show.characters.map((character) => ({
          id: character.id || randomUUID(),
          name: String(character.name || "Character").trim(),
          role: String(character.role || "").trim(),
          voiceId: String(character.voiceId || "").trim(),
          visualNotes: String(character.visualNotes || "").trim()
        }))
      : [
          {
            id: randomUUID(),
            name: "Lead",
            role: "Main character",
            voiceId: "",
            visualNotes: "Primary face for recurring episodes"
          }
        ]
  };
}

function normalizeEpisode(episode) {
  const sortOrder = Number(episode.sortOrder);
  const format = normalizeShortFormat(episode.format);
  const assets = Array.isArray(episode.assets) ? episode.assets.map(normalizeAsset) : [];
  const productionMap = Array.isArray(episode.productionMap)
    ? applyStoredSpeakerMasks(normalizeProductionMapForFormat(episode.productionMap, format), assets)
    : [];
  const drafts = {
    ...emptyDrafts(defaultShow()),
    ...(episode.drafts || {}),
    thumbnailBrief: sanitizeThumbnailBrief(episode.drafts?.thumbnailBrief || {}),
    finishingLayers: normalizeFinishingLayers(episode.drafts?.finishingLayers)
  };
  return {
    id: cleanId(episode.id) || randomUUID(),
    showId: cleanId(episode.showId),
    title: String(episode.title || "Untitled Episode").trim() || "Untitled Episode",
    sortOrder: Number.isFinite(sortOrder) ? sortOrder : null,
    status: String(episode.status || "draft"),
    currentStage: String(episode.currentStage || "Planning"),
    createdAt: episode.createdAt || new Date().toISOString(),
    updatedAt: episode.updatedAt || new Date().toISOString(),
    scriptText: String(episode.scriptText || ""),
    format,
    automation: {
      ...automationDefaults,
      ...(episode.automation || {})
    },
    approvals: Array.isArray(episode.approvals) ? episode.approvals : buildApprovals(episode.automation),
    assets,
    productionMap,
    productionMapEditedAt: String(episode.productionMapEditedAt || ""),
    plan: episode.plan || emptyPlan(),
    drafts,
    outputs: Array.isArray(episode.outputs) ? episode.outputs : [],
    jobLog: Array.isArray(episode.jobLog) ? episode.jobLog.slice(0, 25) : []
  };
}

function shortFormatKey(format = {}) {
  const normalized = normalizeShortFormat(format);
  return JSON.stringify({
    aspectRatio: normalized.aspectRatio,
    resolution: normalized.resolution,
    fps: Number(normalized.fps || 0),
    wordsPerMinute: Number(normalized.wordsPerMinute || 0),
    container: normalized.container || "",
    videoCodec: normalized.videoCodec || "",
    audioCodec: normalized.audioCodec || "",
    audioSampleRate: Number(normalized.audioSampleRate || 0)
  });
}

function videoTakeMatchesFormat(take, format = {}) {
  const normalizedTake = normalizeVideoTake(take);
  if (!normalizedTake) return false;
  if (normalizedTake.source === "user-upload") return true;
  const targetFormat = normalizeShortFormat(format);
  const targetDimensions = parseResolution(targetFormat.resolution, targetFormat.aspectRatio);
  const takeDimensions = parseResolution(normalizedTake.resolution, normalizedTake.aspectRatio || targetFormat.aspectRatio);
  const takeWidth = Number(normalizedTake.width || takeDimensions.width || 0);
  const takeHeight = Number(normalizedTake.height || takeDimensions.height || 0);
  const takeResolution = normalizeResolutionValue(normalizedTake.resolution || `${takeWidth}x${takeHeight}`);
  return (
    normalizedTake.aspectRatio === targetFormat.aspectRatio &&
    takeResolution === targetFormat.resolution &&
    takeWidth === targetDimensions.width &&
    takeHeight === targetDimensions.height
  );
}

function propagateLineFormat(line, format, index = 0) {
  const normalized = normalizeProductionLine(line, index);
  const originalTakes = normalizeVideoTakes(normalized.videoTakes, normalized.videoTake);
  const keptTakes = originalTakes.filter((take) => videoTakeMatchesFormat(take, format));
  const activeTake = videoTakeMatchesFormat(normalized.videoTake, format) ? normalizeVideoTake(normalized.videoTake) : null;
  const staleTakeCount = originalTakes.length - keptTakes.length + (normalized.videoTake && !activeTake && !originalTakes.length ? 1 : 0);
  if (!staleTakeCount && activeTake) {
    return {
      line: normalizeProductionLine(
        {
          ...normalized,
          videoTake: activeTake,
          videoTakes: normalizeVideoTakes(keptTakes, activeTake)
        },
        index
      ),
      staleTakeCount: 0
    };
  }
  return {
    line: normalizeProductionLine(
      {
        ...normalized,
        videoStatus: activeTake ? normalized.videoStatus : "pending",
        videoTake: activeTake,
        videoTakes: normalizeVideoTakes(keptTakes, activeTake),
        videoError: activeTake ? normalized.videoError : "",
        videoWarning: activeTake ? normalized.videoWarning : ""
      },
      index
    ),
    staleTakeCount
  };
}

function propagateShowFormatToEpisodes(episodes = [], show = {}) {
  const nextFormat = normalizeShortFormat(show.shortFormat);
  const formatNote = `Show format changed to ${nextFormat.resolution} ${nextFormat.aspectRatio} at ${nextFormat.fps} fps.`;
  let changedCount = 0;
  const propagatedEpisodes = (Array.isArray(episodes) ? episodes : []).map((episode) => {
    const normalized = normalizeEpisode(episode);
    if (normalized.showId !== show.id) return normalized;

    const formatChanged = shortFormatKey(normalized.format) !== shortFormatKey(nextFormat);
    let staleTakeCount = 0;
    const productionMap = normalized.productionMap.map((line, index) => {
      const propagated = propagateLineFormat(line, nextFormat, index);
      staleTakeCount += propagated.staleTakeCount;
      return propagated.line;
    });
    if (!formatChanged && !staleTakeCount) return normalized;

    const staleNote = staleTakeCount
      ? ` Cleared ${staleTakeCount} generated shot video take${staleTakeCount === 1 ? "" : "s"} that no longer matched the show format.`
      : "";
    const note = formatChanged
      ? formatNote
      : `Show format reconciled episode shots to ${nextFormat.resolution} ${nextFormat.aspectRatio} at ${nextFormat.fps} fps.`;
    changedCount += 1;

    return normalizeEpisode({
      ...normalized,
      format: nextFormat,
      productionMap,
      approvals: resetRenderApproval(normalized.approvals, note),
      updatedAt: show.updatedAt || new Date().toISOString(),
      jobLog: appendLog(normalized.jobLog, `${note}${staleNote}`)
    });
  });
  return { episodes: propagatedEpisodes, changedCount };
}

async function duplicateEpisodeForNextScript({ episode, show, episodes = [], title = "", sortOrder = null }) {
  const source = normalizeEpisode(episode);
  const now = new Date().toISOString();
  const reusableAssets = source.assets.filter((asset) => asset.type !== "script");
  const assetIdMap = new Map(reusableAssets.map((asset) => [asset.id, randomUUID()]));
  const assets = await Promise.all(reusableAssets.map(async (asset) => {
    const clonedUpload = await cloneStoredUploadForDuplicate(asset);
    return normalizeAsset({
      ...asset,
      ...clonedUpload,
      id: assetIdMap.get(asset.id) || randomUUID(),
      metadata: remapDuplicateAssetMetadata(asset.metadata, assetIdMap),
      createdAt: now
    });
  }));
  const automation = {
    ...automationDefaults,
    ...source.automation
  };

  return normalizeEpisode({
    ...source,
    id: randomUUID(),
    title: String(title || "").trim() || nextEpisodeDuplicateTitle(source.title, episodes),
    sortOrder: Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : nextEpisodeSortOrder(episodes, source.showId),
    status: "draft",
    currentStage: "Script",
    createdAt: now,
    updatedAt: now,
    scriptText: "",
    automation,
    approvals: buildApprovals(automation),
    assets,
    productionMap: [],
    productionMapEditedAt: "",
    plan: emptyPlan(),
    drafts: emptyDrafts(show || defaultShow()),
    outputs: [],
    jobLog: appendLog([], `Duplicated setup from "${source.title}". Add a new script to build this episode.`)
  });
}

function nextEpisodeDuplicateTitle(title = "", episodes = []) {
  const existingTitles = new Set(
    (Array.isArray(episodes) ? episodes : [])
      .map((episode) => String(episode?.title || "").trim().toLowerCase())
      .filter(Boolean)
  );
  const base = String(title || "Untitled Episode").trim() || "Untitled Episode";
  let candidate = incrementEpisodeTitle(base) || `${base} Copy`;
  let copyNumber = 2;
  for (let guard = 0; existingTitles.has(candidate.toLowerCase()) && guard < 100; guard += 1) {
    const nextCandidate = incrementEpisodeTitle(candidate);
    if (nextCandidate && nextCandidate !== candidate) {
      candidate = nextCandidate;
    } else {
      candidate = `${base} Copy ${copyNumber}`;
      copyNumber += 1;
    }
  }
  return candidate;
}

function incrementEpisodeTitle(title = "") {
  const text = String(title || "").trim();
  const matches = [...text.matchAll(/\b(episode\s*)(\d+)\b/gi)];
  const match = matches[matches.length - 1];
  if (!match) return "";
  const digits = match[2];
  const nextNumber = String((Number(digits) || 0) + 1).padStart(digits.length, "0");
  return `${text.slice(0, match.index)}${match[1]}${nextNumber}${text.slice(match.index + match[0].length)}`;
}

function remapDuplicateAssetMetadata(metadata = {}, idMap = new Map()) {
  const remapped = {};
  for (const [key, value] of Object.entries(metadata || {})) {
    remapped[key] = typeof value === "string" && idMap.has(value) ? idMap.get(value) : value;
  }
  return remapped;
}

function defaultShow() {
  return normalizeShow({
    id: "default-show",
    name: "Newt Shorts",
    description: "A repeatable animated episode format.",
    shortFormat: {
      ...shortFormatDefaults,
      aspectRatio: "16:9",
      resolution: "1920x1080"
    },
    characters: [
      {
        id: "character-max",
        name: "Max",
        role: "Main",
        voiceId: "demo_max",
        visualNotes: ""
      },
      {
        id: "character-pip",
        name: "Pip",
        role: "Main",
        voiceId: "demo_pip",
        visualNotes: ""
      },
      {
        id: "character-guest",
        name: "Guest",
        role: "guest",
        voiceId: "demo_guest",
        visualNotes: "Any script speaker who is not Max or Pip maps here by default."
      }
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
}

function buildApprovals(automation = automationDefaults) {
  const autoGateMap = {
    script_plan: Boolean(automation.parseScript),
    voice_audio: Boolean(automation.generateVoices),
    render_preview: Boolean(automation.renderEpisode)
  };

  return approvalTemplates.map((template) => ({
    ...template,
    status: autoGateMap[template.id] ? "auto" : "pending",
    approvedAt: autoGateMap[template.id] ? new Date().toISOString() : "",
    note: ""
  }));
}

function refreshApprovals(currentApprovals = [], automation = automationDefaults) {
  const currentById = new Map(currentApprovals.map((gate) => [gate.id, gate]));
  return buildApprovals(automation).map((gate) => {
    const current = currentById.get(gate.id);
    if (!current) return gate;
    if (current.status === "approved" || current.status === "blocked") return current;
    return { ...gate, note: current.note || "" };
  });
}

function emptyPlan() {
  return {
    wordCount: 0,
    estimatedSeconds: 0,
    lengthStatus: "empty",
    beatCount: 0,
    beats: [],
    lineCount: 0,
    warnings: [],
    suggestions: []
  };
}

function emptyDrafts(show) {
  return {
    youtube: {
      title: "",
      description: "",
      tags: show.platforms?.youtube?.defaultTags || [],
      privacyStatus: "private",
      categoryId: show.platforms?.youtube?.categoryId || "24",
      notifySubscribers: Boolean(show.platforms?.youtube?.notifySubscribers),
      madeForKids: Boolean(show.platforms?.youtube?.madeForKids),
      containsSyntheticMedia: show.platforms?.youtube?.containsSyntheticMedia !== false,
      shortsThumbnail: false,
      plannedPublishAt: "",
      publishNotes: "",
      readyToPublish: false,
      readyToPublishAt: "",
      handoffChecklist: {
        titleReady: false,
        descriptionReady: false,
        thumbnailReady: false,
        studioChecked: false,
        approvalReady: false,
        scheduledManually: false
      },
      promotion: {
        communityPost: "",
        pinnedComment: ""
      }
    },
    thumbnails: [],
    thumbnailBrief: sanitizeThumbnailBrief({}),
    finishingLayers: [],
    ui: {
      panelState: {}
    },
    social: []
  };
}

function analyzeScript(scriptText, show) {
  const format = show.shortFormat || shortFormatDefaults;
  const dialogueLines = parseDialogueLines(scriptText);
  const analysisText = dialogueLines.length ? dialogueLines.map((line) => line.text).join("\n") : scriptText;
  const words = analysisText.trim().match(/\b[\w'-]+\b/g) || [];
  const textLines = scriptText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const estimatedSeconds = Math.max(0, Math.round((words.length / Number(format.wordsPerMinute || 145)) * 60));
  const lengthStatus = words.length ? "estimated" : "empty";
  const paragraphs = scriptText
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  const rawBeats = dialogueLines.length
    ? dialogueLines.map((line) => `${line.speaker}: ${line.text}`)
    : paragraphs.length > 1
      ? paragraphs
      : textLines;
  const beats = rawBeats.slice(0, 12).map((text, index) => ({
    id: `beat-${index + 1}`,
    label: beatLabel(index, rawBeats.length),
    text: compactText(stripSpeakerPrefix(text), 190),
    estimatedSeconds: Math.max(4, Math.round(estimatedSeconds / Math.max(rawBeats.length, 1)))
  }));

  const warnings = [];
  const suggestions = [];
  if (!words.length) {
    warnings.push("Add or upload a script before building the episode.");
  }
  return {
    wordCount: words.length,
    estimatedSeconds,
    lengthStatus,
    beatCount: beats.length,
    beats,
    lineCount: dialogueLines.length || textLines.length,
    warnings,
    suggestions
  };
}

function createProductionMap({ scriptText, show, format = show?.shortFormat, assets = [], currentProductionMap = [] }) {
  const productionLines = parseProductionScriptLines(scriptText);
  const dialogueTotal = productionLines.filter((line) => line.lineType !== "insert").length;
  const wideIndexes = wideShotIndexes(dialogueTotal);
  const currentLines = Array.isArray(currentProductionMap)
    ? currentProductionMap.map((line, index) => normalizeProductionLine(line, index))
    : [];
  const currentById = new Map(currentLines.map((line) => [line.id, line]));
  const currentByKey = new Map(currentLines.map((line) => [productionLineKey(line), line]));

  let dialogueIndex = -1;
  let previousDialogueSpeakerType = "";
  const activeCastRoles = new Set(baseCastRolesForShow(show));
  return productionLines.map((line, index) => {
    const id = `line-${index + 1}-${hashSegment(`${line.speaker}:${line.text}`)}`;
    const previous = currentById.get(id) || currentByKey.get(productionLineKey(line));
    const isInsert = line.lineType === "insert";
    if (!isInsert) dialogueIndex += 1;
    const speakerType = speakerTypeFor(line.speaker);
    if (!isInsert) activeCastRoles.add(speakerType);
    const character = findCharacterForSpeaker(line.speaker, show);
    const shotRole = isInsert
      ? "insert_shot"
      : previous?.shotRole || inferShotRole(line, dialogueIndex, dialogueTotal, wideIndexes);
    const desiredRoles = desiredAssetRolesForLine({
      shotRole,
      speakerType,
      activeCastRoles: [...activeCastRoles],
      previousSpeakerType: previousDialogueSpeakerType
    });
    const assetId = previous?.assetId
      ? previous.assetId
      : previous?.assetAutoAssignDisabled
        ? ""
        : bestAssetForProductionLine({
            assets,
            character,
            speaker: line.speaker,
            shotRole,
            speakerType,
            desiredRoles
          });
    const canReusePreviousMask = !isInsert && previous?.assetId && previous.assetId === assetId;
    const maskAssetId = canReusePreviousMask ? previous.maskAssetId : "";
    const needsMask = Boolean(maskAssetId);

    const mappedLine = normalizeProductionLine(
      {
        ...line,
        id,
        index: index + 1,
        lineType: isInsert ? "insert" : "dialogue",
        characterId: isInsert ? "" : previous?.characterId || character?.id || "",
        voiceId: isInsert ? "" : productionVoiceId({ previous, character, speakerType, show }),
        audioTags: line.audioTags || previous?.audioTags || "",
        expressiveBodyMotion:
          previous?.expressiveBodyMotion ?? Boolean(show.production?.defaultExpressiveBodyMotion),
        lipSyncModel: previous?.lipSyncModel || previous?.lipSyncModelOverride || "",
        lipSyncModelOverride: previous?.lipSyncModelOverride || "",
        animationStrengthOverride: previous?.animationStrengthOverride ?? null,
        shotRole,
        assetId,
        assetAutoAssignDisabled: !assetId && Boolean(previous?.assetAutoAssignDisabled),
        maskAssetId,
        maskAutoApplyDisabled: Boolean(previous?.maskAutoApplyDisabled),
        maskRefreshToken: String(previous?.maskRefreshToken || "").trim(),
        needsMask,
        invertMask: false,
        notes: previous?.notes || "",
        groupId: previous?.groupId || "",
        groupTitle: previous?.groupTitle || "",
        estimatedSeconds: isInsert ? estimateInsertSeconds(line.text) : estimateLineSeconds(line.text, show),
        videoStatus: previous?.videoStatus || "pending",
        videoTake: previous?.videoTake || null,
        videoTakes: previous?.videoTakes || (previous?.videoTake ? [previous.videoTake] : []),
        videoInSeconds: previous?.videoInSeconds || 0,
        videoOutSeconds: previous?.videoOutSeconds || 0
      },
      index
    );
    if (!isInsert) previousDialogueSpeakerType = speakerType;
    return mappedLine;
  });
}

function productionVoiceId({ previous, character, speakerType, show }) {
  const previousVoice = String(previous?.voiceId || "").trim();
  const characterVoice = String(character?.voiceId || "").trim();
  const previousCharacterId = String(previous?.characterId || "");
  const characterId = String(character?.id || "");
  const previousWasDemo = previousVoice.toLowerCase().startsWith("demo_");
  const previousBelongedToOtherCharacter = previousCharacterId && characterId && previousCharacterId !== characterId;
  const currentCharacterVoiceIds = new Set((show?.characters || []).map((item) => String(item.voiceId || "").trim()).filter(Boolean));
  const previousIsNotCurrentCastVoice = previousVoice && currentCharacterVoiceIds.size > 0 && !currentCharacterVoiceIds.has(previousVoice);

  if (characterVoice && (!previousVoice || previousWasDemo || previousBelongedToOtherCharacter || previousIsNotCurrentCastVoice)) {
    return characterVoice;
  }
  return previousVoice || characterVoice || defaultVoiceForSpeakerType(speakerType);
}

function parseDialogueLines(scriptText) {
  return parseProductionScriptLines(scriptText).filter((line) => line.lineType !== "insert");
}

function parseProductionScriptLines(scriptText) {
  const lines = String(scriptText || "")
    .split(/\r?\n/)
    .map((line, index) => ({ raw: line.trim(), sourceLine: index + 1 }))
    .filter((line) => line.raw);
  const productionLines = [];

  for (const line of lines) {
    const cleaned = line.raw.replace(/^\d+\.\s*/, "").replace(/^[-*]\s*/, "").trim();
    const prefixed = splitLeadingAudioTags(cleaned);
    const match = prefixed.text.match(/^([A-Za-z][A-Za-z0-9 ._'()&-]{0,48})\s*:\s*(.+)$/);
    if (!match) continue;

    const speaker = sanitizeSpeaker(match[1]);
    const dialogueText = splitLeadingAudioTags(match[2]);
    const audioTags = mergeAudioTags(prefixed.audioTags, dialogueText.audioTags);
    const text = String(dialogueText.text || "").trim();
    if (!speaker || !text) continue;

    const speakerKey = keyForMatch(speaker);
    if (speakerKey === "insert") {
      productionLines.push({
        id: "",
        index: productionLines.length + 1,
        lineType: "insert",
        speaker: "INSERT",
        text,
        audioTags: "",
        sourceLine: line.sourceLine
      });
      continue;
    }

    if (isMetadataLabel(speaker) && !isExplicitDialogueSpeakerLabel(match[1], speaker)) continue;

    productionLines.push({
      id: "",
      index: productionLines.length + 1,
      lineType: "dialogue",
      speaker,
      text,
      audioTags,
      sourceLine: line.sourceLine
    });
  }

  return productionLines;
}

function splitLeadingAudioTags(value) {
  let text = String(value || "").trim();
  const tags = [];

  while (true) {
    const match = text.match(/^\[([^\]\r\n]{1,60})\]\s*/);
    if (!match) break;
    tags.push(`[${match[1].trim()}]`);
    text = text.slice(match[0].length).trimStart();
  }

  return {
    audioTags: sanitizeAudioTags(tags.join(" ")),
    text: text.trim()
  };
}

function sanitizeAudioTags(value) {
  const matches = String(value || "").match(/\[[^\]\r\n]{1,60}\]/g) || [];
  return uniqueStrings(
    matches
      .map((tag) => tag.replace(/\s+/g, " ").trim())
      .filter((tag) => /^\[[^\]\r\n]{1,60}\]$/.test(tag))
  ).join(" ");
}

function mergeAudioTags(...values) {
  return sanitizeAudioTags(values.filter(Boolean).join(" "));
}

function speechTextForElevenLine(line) {
  return [sanitizeAudioTags(line.audioTags), String(line.text || "").trim()].filter(Boolean).join(" ") || " ";
}

function plainSpeechText(line) {
  return String(line.text || "").replace(/^\s*(?:\[[^\]\r\n]{1,60}\]\s*)+/, "").trim() || " ";
}

function sanitizeSpeaker(value) {
  return String(value || "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isMetadataLabel(label) {
  const key = keyForMatch(label);
  return new Set([
    "title",
    "episode",
    "logline",
    "targetlength",
    "runtime",
    "format",
    "characters",
    "character",
    "location",
    "setting",
    "guest",
    "problem",
    "rule",
    "lesson",
    "theme",
    "notes",
    "note",
    "shot",
    "visual",
    "sfx",
    "music",
    "thumbnail",
    "caption",
    "cta",
    "scene",
    "beat",
    "act"
  ]).has(key);
}

function isExplicitDialogueSpeakerLabel(rawLabel, speaker) {
  const speakerKey = keyForMatch(speaker);
  if (speakerKey !== "guest") return false;
  const label = String(rawLabel || "").replace(/\([^)]*\)/g, "").trim();
  return label === "GUEST";
}

function normalizeProductionLine(line, index = 0) {
  const lineIndex = Number(line.index);
  const maskAssetId = cleanId(line.maskAssetId);
  const videoTake = normalizeVideoTake(line.videoTake);
  return {
    id: cleanId(line.id) || `line-${index + 1}`,
    index: Number.isFinite(lineIndex) && lineIndex > 0 ? lineIndex : index + 1,
    lineType: sanitizeLineType(line.lineType),
    speaker: String(line.speaker || "").trim(),
    characterId: cleanId(line.characterId),
    voiceId: String(line.voiceId || "").trim(),
    text: String(line.text || "").trim(),
    audioTags: sanitizeAudioTags(line.audioTags),
    expressiveBodyMotion: Boolean(line.expressiveBodyMotion),
    audienceCue: normalizeAudienceCue(line.audienceCue),
    lipSyncModel: sanitizeOptionalLipSyncModel(line.lipSyncModel),
    lipSyncModelOverride: sanitizeOptionalLipSyncModel(line.lipSyncModelOverride),
    animationStrengthOverride: normalizeOptionalAnimationStrength(line.animationStrengthOverride),
    shotRole: sanitizeShotRole(line.shotRole || "character_one_shot"),
    assetId: cleanId(line.assetId),
    assetAutoAssignDisabled: Boolean(line.assetAutoAssignDisabled),
    maskAssetId,
    maskAutoApplyDisabled: Boolean(line.maskAutoApplyDisabled),
    maskRefreshToken: compactText(String(line.maskRefreshToken || "").trim(), 80),
    needsMask: Boolean(line.needsMask || maskAssetId),
    invertMask: Boolean(line.invertMask),
    audioStatus: sanitizeAudioStatus(line.audioStatus),
    audioTake: normalizeAudioTake(line.audioTake),
    videoStatus: sanitizeVideoStatus(line.videoStatus),
    videoTake,
    videoTakes: normalizeVideoTakes(line.videoTakes, videoTake),
    videoError: compactText(String(line.videoError || "").trim(), 600),
    videoWarning: compactText(String(line.videoWarning || "").trim(), 600),
    insertVideoMode: sanitizeInsertVideoMode(line.insertVideoMode),
    insertEndAssetId: cleanId(line.insertEndAssetId),
    videoPrompt: String(line.videoPrompt || "").trim(),
    lipSyncPromptOverride: compactText(String(line.lipSyncPromptOverride || "").trim(), lipSyncFullPromptMaxLength),
    lipSyncFullPromptOverride: compactText(String(line.lipSyncFullPromptOverride || "").trim(), lipSyncFullPromptMaxLength),
    lipSyncInputPromptOverride: compactText(String(line.lipSyncInputPromptOverride || "").trim(), lipSyncInputPromptMaxLength),
    lipSyncInputPromptLocked: line.lipSyncInputPromptLocked !== false,
    videoInSeconds: Math.max(0, roundSeconds(line.videoInSeconds)),
    videoOutSeconds: Math.max(0, roundSeconds(line.videoOutSeconds)),
    notes: String(line.notes || "").trim(),
    groupId: cleanId(line.groupId),
    groupTitle: compactText(String(line.groupTitle || "").trim(), 80),
    estimatedSeconds: Math.max(1, Math.round(Number(line.estimatedSeconds) || 1)),
    sourceLine: Number.isFinite(Number(line.sourceLine)) ? Number(line.sourceLine) : 0
  };
}

function sanitizeAudienceCueMode(value) {
  const normalized = String(value || "auto").trim().toLowerCase();
  if (["force", "laugh", "add", "on", "yes", "true"].includes(normalized)) return "force";
  if (["none", "off", "no", "false", "never", "skip"].includes(normalized)) return "none";
  return "auto";
}

function normalizeAudienceCue(cue = {}) {
  const source = cue && typeof cue === "object" && !Array.isArray(cue) ? cue : {};
  const rawIntensity = Number(source.intensity ?? source.laughIntensity);
  const rawDuration = Number(source.durationSeconds ?? source.laughDurationSeconds);
  const rawOffset = Number(source.offsetSeconds ?? source.laughOffsetSeconds);
  return {
    laugh: sanitizeAudienceCueMode(source.laugh ?? source.laughMode ?? source.mode),
    intensity: Number.isFinite(rawIntensity) ? roundSeconds(clampNumber(rawIntensity, 0, 1)) : null,
    durationSeconds: Number.isFinite(rawDuration) && rawDuration > 0 ? roundSeconds(clampNumber(rawDuration, 0.5, 30)) : null,
    offsetSeconds: Number.isFinite(rawOffset) ? roundSeconds(clampNumber(rawOffset, -0.2, 2)) : null
  };
}

function normalizeProductionMapForFormat(productionMap = [], format = {}) {
  return (Array.isArray(productionMap) ? productionMap : []).map((line, index) => {
    const normalized = normalizeProductionLine(line, index);
    if (normalized.lineType === "insert") return normalized;
    return normalizeProductionLine(
      {
        ...normalized,
        needsMask: Boolean(normalized.maskAssetId),
        invertMask: false
      },
      index
    );
  });
}

function clearAudioForFullRegeneration(line, index = 0) {
  const normalized = normalizeProductionLine(line, index);
  const nextLine = {
    ...normalized,
    audioStatus: "pending",
    audioTake: null
  };
  if (normalized.lineType !== "insert") {
    nextLine.videoStatus = "pending";
    nextLine.videoTake = null;
    nextLine.videoTakes = [];
    nextLine.videoError = "";
    nextLine.videoWarning = "";
  }
  return normalizeProductionLine(nextLine, index);
}

function applyStoredSpeakerMasks(productionMap = [], assets = []) {
  const normalizedAssets = Array.isArray(assets) ? assets.map(normalizeAsset) : [];
  const assetById = new Map(normalizedAssets.map((asset) => [asset.id, asset]));
  const maskAssets = normalizedAssets.filter((asset) => asset.shotRole === "mask" && asset.metadata?.speakerMaskKey);
  const maskById = new Map(maskAssets.map((asset) => [asset.id, asset]));
  return (Array.isArray(productionMap) ? productionMap : []).map((line, index) => {
    const normalized = normalizeProductionLine(line, index);
    if (normalized.lineType === "insert") return normalizeProductionLine({ ...normalized, needsMask: false }, index);

    const imageAsset = assetById.get(normalized.assetId);
    const canUseMask = lineCanUseSpeakerMask(normalized, imageAsset);
    const expectsMask = lineExpectsSpeakerMask(normalized, imageAsset);
    if (!canUseMask) {
      return normalizeProductionLine({ ...normalized, needsMask: false, maskAssetId: "", invertMask: false }, index);
    }
    if (normalized.maskAutoApplyDisabled) {
      return normalizeProductionLine({ ...normalized, needsMask: false, maskAssetId: "", invertMask: false }, index);
    }

    const existingMask = maskById.get(normalized.maskAssetId);
    const matchingMask = speakerMaskMatchesLine(existingMask, normalized)
      ? existingMask
      : maskAssets.find((asset) => speakerMaskMatchesLine(asset, normalized));

    return normalizeProductionLine(
      {
        ...normalized,
        needsMask: Boolean(expectsMask || matchingMask),
        maskAssetId: matchingMask?.id || "",
        invertMask: Boolean(matchingMask && normalized.invertMask)
      },
      index
    );
  });
}

function sanitizeLineType(type) {
  return type === "insert" ? "insert" : "dialogue";
}

function sanitizeAudioStatus(status) {
  return ["pending", "approved", "hold"].includes(status) ? status : "pending";
}

function sanitizeVideoStatus(status) {
  return ["pending", "generated", "cached", "approved", "hold", "failed"].includes(status) ? status : "pending";
}

function sanitizeInsertVideoMode(mode) {
  const value = String(mode || "").trim().toLowerCase();
  if (["upload", "video_upload", "video-upload", "uploaded", "custom_video", "custom-video"].includes(value)) return "upload";
  if (["first_frame", "first-frame", "start_frame", "start-frame", "image_to_video"].includes(value)) return "first_frame";
  if (["first_last_frame", "first-last-frame", "first_last", "start_end", "keyframes"].includes(value)) return "first_last_frame";
  return "reference";
}

function sanitizeLipSyncModel(model) {
  const value = String(model || "").trim().toLowerCase();
  if (["kling", "fal-kling-avatar", "kling-avatar"].includes(value)) return "kling";
  if (["aurora", "creatify", "creatify-aurora", "fal-aurora", "fal-ai/creatify/aurora"].includes(value)) return "aurora";
  if (["infinitalk", "infinite-talk", "infinite talk", "fal-infinitalk", "fal-ai/infinitalk"].includes(value)) return "infinitalk";
  return "fabric";
}

function sanitizeOptionalLipSyncModel(model) {
  const value = String(model || "").trim().toLowerCase();
  if (!value || ["default", "inherit", "visual-default", "cast-default", "none"].includes(value)) return "";
  return sanitizeLipSyncModel(value);
}

function sanitizeInfiniteTalkBackend(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["comfyui", "comfy-ui", "comfy", "comfy ui"].includes(normalized)) return "comfyui";
  if (["local", "localhost", "self-hosted", "self_hosted", "offline"].includes(normalized)) return "local";
  return "fal";
}

function normalizeAudioTake(take) {
  if (!take || typeof take !== "object") return null;
  const localUrl = String(take.localUrl || "").trim();
  const fileName = path.basename(String(take.fileName || localUrl.split("/").pop() || "").trim());
  if (!localUrl && !fileName) return null;
  return {
    id: cleanId(take.id) || randomUUID(),
    fileName,
    localUrl,
    mode: String(take.mode || "").trim(),
    voiceName: String(take.voiceName || "").trim(),
    voiceId: String(take.voiceId || "").trim(),
    warning: String(take.warning || "").trim(),
    durationSeconds: roundSeconds(take.durationSeconds),
    signature: String(take.signature || "").trim(),
    source: String(take.source || "").trim(),
    generatedAt: String(take.generatedAt || "").trim()
  };
}

function normalizeVideoTake(take) {
  if (!take || typeof take !== "object") return null;
  const localUrl = String(take.localUrl || "").trim();
  const fileName = path.basename(String(take.fileName || localUrl.split("/").pop() || "").trim());
  const proxyLocalUrl = String(take.proxyLocalUrl || "").trim();
  const proxyFileName = path.basename(String(take.proxyFileName || proxyLocalUrl.split("/").pop() || "").trim());
  const width = Math.max(0, Math.round(Number(take.width) || 0));
  const height = Math.max(0, Math.round(Number(take.height) || 0));
  const resolution = String(take.resolution || (width && height ? `${width}x${height}` : "")).trim();
  const aspectRatio = String(take.aspectRatio || (width && height ? (width > height ? "16:9" : "9:16") : "")).trim();
  if (!localUrl && !fileName) return null;
  return {
    id: cleanId(take.id) || randomUUID(),
    fileName,
    localUrl,
    proxyFileName,
    proxyLocalUrl,
    remoteUrl: String(take.remoteUrl || "").trim(),
    model: String(take.model || "").trim(),
    prompt: String(take.prompt || "").trim(),
    seed: Number.isFinite(Number(take.seed)) ? Number(take.seed) : null,
    warning: String(take.warning || "").trim(),
    durationSeconds: roundSeconds(take.durationSeconds),
    signature: String(take.signature || "").trim(),
    source: String(take.source || "").trim(),
    width,
    height,
    resolution,
    aspectRatio,
    generatedAt: String(take.generatedAt || "").trim()
  };
}

function normalizeVideoTakes(takes = [], activeTake = null) {
  const normalizedTakes = [];
  const seen = new Set();
  const sourceTakes = Array.isArray(takes) ? takes : [];
  for (const candidate of [...sourceTakes, activeTake]) {
    const take = normalizeVideoTake(candidate);
    if (!take) continue;
    const key = take.id || take.localUrl || take.proxyLocalUrl || take.fileName;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    normalizedTakes.push(take);
  }
  return normalizedTakes.slice(0, 24);
}

function productionLineKey(line) {
  return `${line.lineType || "dialogue"}:${keyForMatch(line.speaker)}:${keyForMatch(line.text).slice(0, 140)}`;
}

function findCharacterForSpeaker(speaker, show) {
  const characters = Array.isArray(show?.characters) ? show.characters : [];
  const speakerKey = keyForMatch(speaker);
  if (!speakerKey) return null;
  const speakerType = speakerTypeFor(speaker);
  if (speakerType === "max" || speakerType === "pip") {
    return characters.find((character) => keyForMatch(character.name) === speakerType) || null;
  }
  return (
    characters.find((character) => keyForMatch(character.name) === speakerKey) ||
    characters.find((character) => speakerKey.includes(keyForMatch(character.name)) || keyForMatch(character.name).includes(speakerKey)) ||
    characters.find((character) => keyForMatch(character.role) === speakerKey) ||
    characters.find((character) => keyForMatch(character.role) === "guest") ||
    characters.find((character) => !["max", "pip"].includes(keyForMatch(character.name))) ||
    null
  );
}

function inferShotRole(line, index, total, wideIndexes = wideShotIndexes(total)) {
  const speakerKey = keyForMatch(line.speaker);
  const textKey = keyForMatch(line.text);
  if (wideIndexes.has(index)) return "wide_shot";
  if (speakerKey.includes("club") || speakerKey.includes("crowd") || textKey.includes("everyone") || textKey.includes("allof")) {
    return "wide_shot";
  }
  if (/\s(&|and)\s/i.test(` ${line.speaker} `)) return "medium_two_shot";
  if (index === 0 || index === total - 1) return "character_one_shot";
  return "character_one_shot";
}

function bestAssetForProductionLine({ assets = [], character, speaker, shotRole, speakerType, desiredRoles = [] }) {
  const imageAssets = assets.filter((asset) => asset.type === "image");
  const roleAssets = imageAssets.filter((asset) => effectiveAssetShotRole(asset) === shotRole);
  const speakerTaggedAssets = imageAssets.filter((asset) => assetSpeakingRoles(asset).includes(speakerType));
  const speakerTaggedRoleAssets = roleAssets.filter((asset) => assetSpeakingRoles(asset).includes(speakerType));
  const boundMatches = roleAssets
    .map((asset) => ({ asset, binding: assetShotBinding(asset) }))
    .filter(({ binding }) => binding.roles.length > 0)
    .map(({ asset, binding }) => ({
      asset,
      score: scoreBoundShotAsset({
        binding,
        speakingRoles: assetSpeakingRoles(asset),
        shotRole,
        speakerType,
        desiredRoles
      })
    }))
    .filter(({ score }) => score > Number.NEGATIVE_INFINITY)
    .sort((a, b) => b.score - a.score);
  if (boundMatches.length) return boundMatches[0].asset.id || "";
  if (speakerTaggedRoleAssets.length) return speakerTaggedRoleAssets[0].id || "";
  if (speakerTaggedAssets.length) return speakerTaggedAssets[0].id || "";

  const hasBoundAssetsForRole = roleAssets.some((asset) => assetShotBinding(asset).roles.length > 0);
  if (hasBoundAssetsForRole) return "";

  const speakingTagged = roleAssets.find((asset) => assetSpeakingRoles(asset).includes(speakerType));
  return (speakingTagged || roleAssets[0] || imageAssets[0])?.id || "";
}

function baseCastRolesForShow(show) {
  const characters = Array.isArray(show?.characters) ? show.characters : [];
  const roles = new Set();
  for (const character of characters) {
    const role = speakerTypeFor(character.name || character.role);
    if (role) roles.add(role);
  }
  if (!roles.size) {
    roles.add("max");
    roles.add("pip");
  }
  return [...roles];
}

function desiredAssetRolesForLine({ shotRole, speakerType, activeCastRoles = [], previousSpeakerType = "" }) {
  if (shotRole === "character_one_shot") return [speakerType];
  if (shotRole === "wide_shot") return uniqueRoleList(activeCastRoles.length ? activeCastRoles : [speakerType]);
  if (shotRole === "medium_two_shot") {
    const roles = [speakerType];
    if (previousSpeakerType && previousSpeakerType !== speakerType) roles.push(previousSpeakerType);
    if (roles.length < 2) {
      const partner = activeCastRoles.find((role) => role !== speakerType);
      if (partner) roles.push(partner);
    }
    return uniqueRoleList(roles).slice(0, 2);
  }
  return [];
}

function scoreBoundShotAsset({ binding, speakingRoles = [], shotRole, speakerType, desiredRoles = [] }) {
  if (binding.shotRole && binding.shotRole !== shotRole) return Number.NEGATIVE_INFINITY;
  const roles = uniqueRoleList(binding.roles);
  const activeSpeakers = uniqueRoleList(speakingRoles);
  const desired = uniqueRoleList(desiredRoles);
  if (!roles.length) return Number.NEGATIVE_INFINITY;
  if (activeSpeakers.length && !activeSpeakers.includes(speakerType)) return Number.NEGATIVE_INFINITY;
  if (!roles.includes(speakerType)) return Number.NEGATIVE_INFINITY;

  if (shotRole === "character_one_shot") {
    return 120 + (activeSpeakers.includes(speakerType) ? 30 : 0);
  }

  const desiredBonus = desired.includes(speakerType) ? 20 : 0;
  return 100 + desiredBonus + (activeSpeakers.includes(speakerType) ? 30 : 0);
}

function effectiveAssetShotRole(asset) {
  const storedRole = sanitizeShotRole(asset?.shotRole || asset?.role || "");
  if (storedRole && storedRole !== "general") return storedRole;
  return storedRole || "general";
}

function assetShotBinding(asset) {
  const shotRole = effectiveAssetShotRole(asset);
  return {
    prefix: shotRolePrefixForRole(shotRole),
    shotRole,
    roles: assetSpeakingRoles(asset)
  };
}

function shotRolePrefixForRole(role) {
  return {
    character_one_shot: "CU",
    medium_two_shot: "MS",
    wide_shot: "WS",
    insert_shot: "INS",
    mask: "MASK"
  }[role] || "";
}

function assetSpeakingRoles(asset) {
  return parseCharacterTagRoles(asset?.metadata?.speakingTag || asset?.metadata?.characterTags);
}

function parseCharacterTagRoles(value) {
  const text = String(value || "");
  const tagged = [...text.matchAll(/@([A-Za-z0-9_-]{1,48})/g)].map((match) => match[1]);
  const fallback = tagged.length
    ? []
    : text
        .split(/[,\s]+/)
        .map((part) => part.replace(/^@/, ""))
        .filter(Boolean);
  return uniqueRoleList(tagged.length ? tagged : fallback);
}

function sanitizeSpeakingTag(value) {
  const tagged = [...String(value || "").matchAll(/@([A-Za-z0-9_-]{1,48})/g)].map((match) => match[1]);
  const fallback = tagged.length
    ? tagged
    : String(value || "")
        .split(/[,\s]+/)
        .map((part) => part.trim().replace(/^@/, ""))
        .filter(Boolean);
  return uniqueRoleList(fallback)
    .slice(0, 8)
    .map((role) => `@${role.slice(0, 48)}`)
    .join(" ");
}

function shotFilenameBinding(fileName) {
  const stem = path.basename(String(fileName || ""), path.extname(String(fileName || "")));
  const parts = stem
    .toUpperCase()
    .replace(/\s+/g, "_")
    .split("_")
    .filter(Boolean);
  const prefix = parts[0] || "";
  const shotRole = {
    CU: "character_one_shot",
    MS: "medium_two_shot",
    WS: "wide_shot",
    INS: "insert_shot",
    MASK: "mask"
  }[prefix] || "";
  const roles = rolesFromFilenameParts(parts.slice(1));
  return {
    prefix,
    shotRole,
    roles
  };
}

function rolesFromFilenameParts(parts = []) {
  const roles = [];
  for (const part of parts) {
    const partRoles = rolesFromFilenameSegment(part);
    if (!partRoles.length && roles.length) break;
    roles.push(...partRoles);
  }
  return uniqueRoleList(roles);
}

function rolesFromFilenameSegment(segment) {
  const rawTokens = String(segment || "")
    .toUpperCase()
    .replace(/\bAND\b/g, "-")
    .split(/[-+&]+/)
    .filter(Boolean);
  const roles = [];
  for (const token of rawTokens) {
    if (token === "ALL") {
      roles.push("max", "pip", "guest");
    } else if (token === "MAX") {
      roles.push("max");
    } else if (token === "PIP" || token === "POP") {
      roles.push("pip");
    } else if (token === "GUEST" || isGuestNameToken(token)) {
      roles.push("guest");
    }
  }
  return uniqueRoleList(roles);
}

function isGuestNameToken(token) {
  return (
    Boolean(token) &&
    !/^\d+$/.test(token) &&
    !new Set([
      "TALKING",
      "SPEAKING",
      "SHOT",
      "WIDE",
      "MEDIUM",
      "CU",
      "MS",
      "WS",
      "INSERT",
      "INS",
      "LEFT",
      "RIGHT",
      "CENTER",
      "MIDDLE",
      "MID",
      "VERT",
      "VERTICAL",
      "PORTRAIT",
      "HORZ",
      "HORIZ",
      "HORIZONTAL",
      "LANDSCAPE",
      "TABLE",
      "ROOM",
      "CLUBHOUSE",
      "REACTION",
      "BACKGROUND",
      "BG",
      "FG"
    ]).has(token)
  );
}

function uniqueRoleList(roles = []) {
  return [...new Set((Array.isArray(roles) ? roles : []).map((role) => speakerTypeFor(role)).filter(Boolean))];
}

function speakerTypeFor(speaker) {
  const key = keyForMatch(speaker);
  if (!key) return "";
  if (key === "max") return "max";
  if (key === "pip" || key === "pop") return "pip";
  return key;
}

function defaultVoiceForSpeakerType(type) {
  return {
    max: "demo_max",
    pip: "demo_pip",
    guest: "demo_guest"
  }[type] || "demo_guest";
}

function wideShotIndexes(total) {
  const indexes = new Set();
  if (total <= 0) return indexes;
  indexes.add(0);
  if (total > 1) indexes.add(total - 1);
  const middleCount = total >= 24 ? 3 : total >= 12 ? 2 : total >= 6 ? 1 : 0;
  for (let step = 1; step <= middleCount; step += 1) {
    const position = Math.round((step / (middleCount + 1)) * (total - 1));
    if (position > 0 && position < total - 1) {
      indexes.add(position);
    }
  }
  return indexes;
}

function fileStartsWithShotPrefix(fileName, shotRole) {
  const name = String(fileName || "").toLowerCase();
  const prefixes = {
    character_one_shot: ["cu_", "cu-", "cu "],
    medium_two_shot: ["ms_", "ms-", "ms ", "ts_", "ts-", "2s_", "2s-"],
    wide_shot: ["ws_", "ws-", "ws "],
    insert_shot: ["ins_", "ins-", "insert_", "insert-"],
    mask: ["mask_", "mask-", "matte_", "matte-"]
  }[shotRole] || [];
  return prefixes.some((prefix) => name.startsWith(prefix));
}

function estimateLineSeconds(text, show) {
  const words = String(text || "").match(/\b[\w'-]+\b/g) || [];
  const wpm = Number(show?.shortFormat?.wordsPerMinute || shortFormatDefaults.wordsPerMinute);
  return Math.max(1, Math.round((words.length / wpm) * 60));
}

function estimateInsertSeconds(text) {
  const words = String(text || "").match(/\b[\w'-]+\b/g) || [];
  return Math.min(6, Math.max(4, Math.round(words.length / 2)));
}

function keyForMatch(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function hashSegment(value) {
  let hash = 0;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function normalizePromotionTemplates(templates = {}) {
  return {
    ...promotionTemplateDefaults,
    ...(templates && typeof templates === "object" ? templates : {})
  };
}

function renderPromotionTemplate(template, context) {
  const values = context || {};
  return String(template || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, token) => values[token] ?? "");
}

function clampPreservingLines(value, maxLength) {
  const text = String(value || "").trim();
  if (!maxLength || text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function hydrateYouTubeLink(value, watchUrl) {
  const text = String(value || "").trim();
  if (!watchUrl) return text;
  return text.replaceAll("[YouTube link]", watchUrl).replaceAll("{{youtube_url}}", watchUrl);
}

function promotionTemplateContext({ title, hook, description = "", show, watchUrl = "[YouTube link]" }) {
  const hashtags = normalizeHashtags(show?.creative?.recurringHashtags || []);
  return {
    title: String(title || "").trim() || "New episode",
    show: String(show?.name || "").trim() || "NewtBuilder",
    hook: String(hook || "").trim() || "A new episode is ready to watch.",
    description: String(description || "").trim(),
    youtube_url: watchUrl || "[YouTube link]",
    cta: String(show?.creative?.defaultCta || "").trim() || "Follow for the next episode.",
    hashtags: hashtags.join(" ")
  };
}

function renderYouTubePromotionCopy(platformId, { title, hook, description = "", show, watchUrl = "[YouTube link]" }) {
  const templates = normalizePromotionTemplates(show?.platforms?.social?.templates);
  const text = renderPromotionTemplate(
    templates[platformId],
    promotionTemplateContext({ title, hook, description, show, watchUrl })
  );
  return clampPreservingLines(text, campaignPlatformLimits[platformId] || 1500);
}

function createYoutubePromotionCopy({ title, hook, show }) {
  const cleanTitle = String(title || "").trim() || "New episode";
  const cleanHook = String(hook || "").trim() || "A new episode is ready to watch.";
  return {
    communityPost: renderYouTubePromotionCopy("youtubeCommunity", { title: cleanTitle, hook: cleanHook, show }),
    pinnedComment: renderYouTubePromotionCopy("pinnedComment", { title: cleanTitle, hook: cleanHook, show })
  };
}

function createDrafts({ episode, show, plan, scriptText }) {
  const title = cleanTitle(episode.title || firstMeaningfulLine(scriptText) || `${show.name} Episode`);
  const hashtags = normalizeHashtags(show.creative?.recurringHashtags || []);
  const cta = show.creative?.defaultCta || "Follow for the next episode.";
  const tags = uniqueStrings([
    ...(show.platforms?.youtube?.defaultTags || []),
    show.name,
    "animated series",
    "episode"
  ]).slice(0, 15);
  const hook = plan.beats?.[0]?.text || "An animated episode.";

  return {
    youtube: {
      title: title.slice(0, 95),
      description: `${hook}\n\n${cta}\n\n${hashtags.join(" ")}`.trim(),
      tags,
      privacyStatus: "private",
      categoryId: show.platforms?.youtube?.categoryId || "24",
      notifySubscribers: Boolean(show.platforms?.youtube?.notifySubscribers),
      madeForKids: Boolean(show.platforms?.youtube?.madeForKids),
      containsSyntheticMedia: show.platforms?.youtube?.containsSyntheticMedia !== false,
      plannedPublishAt: "",
      publishNotes: "",
      readyToPublish: false,
      readyToPublishAt: "",
      handoffChecklist: {
        titleReady: false,
        descriptionReady: false,
        thumbnailReady: false,
        studioChecked: false,
        approvalReady: false,
        scheduledManually: false
      },
      promotion: createYoutubePromotionCopy({ title, hook, show })
    },
    thumbnails: [
      {
        id: "thumb-1",
        label: "Character Hook",
        prompt: `${show.creative?.thumbnailStyle}. Show the main character at the strongest emotional moment from: ${hook}`
      },
      {
        id: "thumb-2",
        label: "Story Tension",
        prompt: `High-contrast video thumbnail, one readable phrase, visual tension from: ${title}`
      },
      {
        id: "thumb-3",
        label: "Clean Tease",
        prompt: `Minimal bold thumbnail for ${show.name}, expressive face, simple background, title mood: ${title}`
      }
    ],
    social: []
  };
}

async function createPipelineJob({ episode, show }) {
  const blockedGate = null;
  const steps = [
    { id: "parse", label: "Parse script", enabled: show.automation.parseScript },
    { id: "voice", label: "Generate audio", enabled: show.automation.generateVoices },
    { id: "insert_video", label: "Generate insert videos", enabled: show.automation.generateInsertVideos },
    { id: "render", label: "Render episode", enabled: show.automation.renderEpisode },
    { id: "thumbnail", label: "Create thumbnails", enabled: show.automation.generateThumbnails },
    { id: "youtube", label: "Prepare YouTube", enabled: show.automation.draftYoutubeMetadata || show.automation.uploadYoutube },
    { id: "marketing", label: "Prepare YouTube promotion packet", enabled: show.automation.draftSocialCampaign }
  ];
  const reportId = randomUUID();
  let report = await writeLocalBuildReport({ reportId, episode, show, blockedGate });
  const outputs = [{
    id: reportId,
    type: "build_report",
    name: report.fileName,
    localUrl: report.localUrl,
    createdAt: report.createdAt
  }];

  let preview = null;
  let finalRender = null;
  let productionMap = null;
  if (report.renderReady) {
    preview = await createLocalPreview({ previewId: reportId, episode, show });
    report = await attachPreviewToReport(report, preview);
    outputs.unshift(...preview.outputs);
    productionMap = attachAudioTakesToProductionMap(episode.productionMap, preview.manifest.lines);

    if (show.automation.renderEpisode) {
      const episodeForFinal = normalizeEpisode({
        ...episode,
        productionMap,
        outputs: [...outputs, ...(episode.outputs || [])]
      });
      finalRender = await createFinalRender({ episode: episodeForFinal, show, regenerateVideos: true });
      outputs.unshift(...finalRender.outputs);
      productionMap = finalRender.productionMap || productionMap;
    }
  }

  return {
    report,
    outputs,
    productionMap,
    job: {
    id: randomUUID(),
    episodeId: episode.id,
    showId: show.id,
    status: report.overall === "fail" ? "blocked" : finalRender?.video ? "final_render_ready" : preview?.video ? "local_preview_ready" : "local_test_passed",
    currentStage: finalRender?.video ? "Final Render Ready" : preview?.video ? "Preview Ready" : report.renderReady ? "Ready for Render Integration" : "Package Review",
    createdAt: new Date().toISOString(),
    summary:
      report.overall === "fail"
        ? "Local test found required fixes. No publishing was attempted."
        : finalRender?.video
          ? "Final local render created by automation. No publishing was attempted."
          : preview?.video
          ? "Local preview rendered. No publishing was attempted."
          : "Local test passed for current NewtBuilder workflow. No publishing was attempted.",
    steps: steps.map((step) => ({
      ...step,
      status:
        step.id === "render" && (finalRender?.video || preview?.video)
          ? "rendered"
          : step.id === "youtube" || step.id === "marketing"
            ? "local-only"
            : step.enabled
              ? "validated"
              : "manual"
    }))
    }
  };
}

async function writeLocalBuildReport({ reportId, episode, show, blockedGate }) {
  const createdAt = new Date().toISOString();
  const reportDir = path.join(outputsDir, "build-reports");
  await mkdir(reportDir, { recursive: true });
  const fileName = `${safeFileSegment(episode.title)}-${reportId}.json`;
  const localUrl = `/outputs/build-reports/${fileName}`;
  const assets = Array.isArray(episode.assets) ? episode.assets : [];
  const imageAssets = assets.filter((asset) => asset.type === "image");
  const roleCounts = {};
  for (const asset of assets) {
    const role = asset.shotRole || "general";
    roleCounts[role] = (roleCounts[role] || 0) + 1;
  }
  const characters = Array.isArray(show.characters) ? show.characters : [];
  const format = normalizeShortFormat({
    ...(show?.shortFormat || {}),
    ...(episode.format || {})
  });
  const voiceCount = characters.filter((character) => String(character.voiceId || "").trim()).length;
  const approvals = Array.isArray(episode.approvals) ? episode.approvals : [];
  const pendingPreRenderApprovals = approvals.filter(
    (gate) => isPreRenderApproval(gate.id) && (gate.status === "pending" || gate.status === "blocked")
  );
  const pendingPublishApprovals = approvals.filter((gate) => gate.status === "pending" || gate.status === "blocked");
  const renderApproval = approvals.find((gate) => gate.id === "render_preview");
  const renderApproved = !renderApproval || renderApproval.status === "approved" || renderApproval.status === "auto";
  const productionMap = applyStoredSpeakerMasks(normalizeProductionMapForFormat(episode.productionMap, format), assets);
  const dialogueProductionLines = productionMap.filter((line) => line.lineType !== "insert");
  const voicedLines = dialogueProductionLines.filter((line) => line.voiceId).length;
  const visualLines = productionMap.filter((line) => line.assetId).length;
  const maskIssues = productionMap.filter((line) => line.needsMask && !line.maskAssetId);

  const checks = [
    buildCheck("script", "Script text is present", Boolean(String(episode.scriptText || "").trim())),
    buildCheck("plan", "Script plan has been generated", Number(episode.plan?.wordCount || 0) > 0),
    buildCheck(
      "dialogue_map",
      "Script lines are mapped for production",
      !String(episode.scriptText || "").trim() || productionMap.length > 0,
      `${productionMap.length} production lines mapped`
    ),
    buildCheck(
      "line_voice_assignments",
      "Dialogue lines have voice assignments",
      dialogueProductionLines.length === 0 || voicedLines === dialogueProductionLines.length,
      `${voicedLines}/${dialogueProductionLines.length} dialogue lines have a voice`,
      "warning"
    ),
    buildCheck(
      "line_visual_assignments",
      "Dialogue lines have shot image assignments",
      productionMap.length === 0 || visualLines === productionMap.length,
      `${visualLines}/${productionMap.length} dialogue lines have an image`,
      "warning"
    ),
    buildCheck(
      "line_mask_assignments",
      "Wide or group shot masks are assigned when requested",
      maskIssues.length === 0,
      maskIssues.length ? `${maskIssues.length} lines need a mask asset` : "No missing masks",
      "warning"
    ),
    buildCheck(
      "runtime",
      "Length estimate is available",
      Number(episode.plan?.estimatedSeconds || 0) > 0,
      Number(episode.plan?.estimatedSeconds || 0)
        ? `${episode.plan.estimatedSeconds} seconds from ${episode.plan.wordCount || 0} words`
        : "No length estimate",
      "warning"
    ),
    buildCheck(
      "format",
      "Aspect ratio and resolution are supported",
      ["9:16", "16:9"].includes(episode.format?.aspectRatio),
      `${episode.format?.aspectRatio || "unknown"} / ${episode.format?.resolution || "unknown"}`
    ),
    buildCheck(
      "voice_cast",
      "Character voices are assigned",
      characters.length > 0 && voiceCount === characters.length,
      `${voiceCount}/${characters.length} characters have voice IDs`,
      characters.length > 0 && voiceCount > 0 ? "warning" : "fail"
    ),
    buildCheck(
      "visual_library",
      "Visual source images are uploaded",
      imageAssets.length > 0,
      `${imageAssets.length} image assets uploaded`,
      "warning"
    ),
    buildCheck(
      "wide_or_character_visuals",
      "At least one wide shot or character one-shot exists",
      Boolean(roleCounts.wide_shot || roleCounts.character_one_shot),
      `Role counts: ${JSON.stringify(roleCounts)}`,
      "warning"
    ),
    buildCheck(
      "approvals",
      "Approval gates",
      true,
      pendingPreRenderApprovals.length
        ? `${pendingPreRenderApprovals.length} pre-render approval${pendingPreRenderApprovals.length === 1 ? "" : "s"} pending; automation can still render locally`
        : "Approvals are clear"
    ),
    buildCheck(
      "render_review",
      "Episode Render approval records preview review",
      true,
      renderApproved ? "Preview review approval is complete." : "Preview approval is optional before local render.",
      "warning"
    ),
    buildCheck(
      "youtube_publish_lock",
      "YouTube upload is locked for local testing",
      true,
      publishingEnabled ? "Publishing is enabled, but local preview does not upload." : "NEWTBUILDER_ENABLE_PUBLISHING is not enabled"
    ),
    buildCheck(
      "youtube_only_promotion",
      "Promotion prep is YouTube-only",
      true,
      "This build exports YouTube Community and pinned-comment copy only."
    )
  ];

  const requiredFailures = checks.filter((check) => check.status === "fail");
  const mapReady =
    productionMap.length === 0 ||
    (voicedLines === dialogueProductionLines.length && visualLines === productionMap.length && maskIssues.length === 0);
  const renderReady =
    requiredFailures.length === 0 &&
    imageAssets.length > 0 &&
    characters.length > 0 &&
    voiceCount === characters.length &&
    mapReady;
  const report = {
    id: reportId,
    createdAt,
    mode: "local-test-only",
    overall: requiredFailures.length ? "fail" : "pass",
    renderReady,
    localUrl,
    fileName,
    publishing: {
      enabled: publishingEnabled,
      youtubeUploadAttempted: false,
      externalPostAttempted: false
    },
    episode: {
      id: episode.id,
      title: episode.title,
      format,
      wordCount: episode.plan?.wordCount || 0,
      estimatedSeconds: episode.plan?.estimatedSeconds || 0,
      lengthStatus: episode.plan?.lengthStatus || (Number(episode.plan?.estimatedSeconds || 0) > 0 ? "estimated" : "unknown")
    },
    show: {
      id: show.id,
      name: show.name,
      characterCount: characters.length,
      voicedCharacterCount: voiceCount
    },
    assets: {
      total: assets.length,
      images: imageAssets.length,
      roleCounts
    },
    productionMap: {
      dialogueLines: productionMap.length,
      voicedLines,
      visualLines,
      missingMaskLines: maskIssues.length
    },
    approvals: {
      blockedGate: blockedGate?.title || "",
      pending: pendingPreRenderApprovals.map((gate) => ({ id: gate.id, title: gate.title, status: gate.status })),
      pendingPublish: pendingPublishApprovals.map((gate) => ({ id: gate.id, title: gate.title, status: gate.status }))
    },
    checks
  };

  await writeFile(path.join(reportDir, fileName), JSON.stringify(report, null, 2));
  return report;
}

function isPreRenderApproval(id) {
  return ["script_plan", "voice_audio"].includes(id);
}

function preRenderBlockedGate(approvals = []) {
  return (Array.isArray(approvals) ? approvals : []).find(
    (gate) => isPreRenderApproval(gate.id) && (gate.status === "pending" || gate.status === "blocked")
  );
}

async function createLocalPreview({ previewId, episode, show, reuseOnly = false, renderVideo = true }) {
  const createdAt = new Date().toISOString();
  const manifest = buildRenderManifest({
    previewId,
    episode,
    show,
    createdAt,
    reuseExistingVideoTakes: true,
    preferLatestVideoTakes: true
  });
  const audioDir = path.join(outputsDir, "audio", previewId);
  const manifestDir = path.join(outputsDir, "render-manifests");
  const tempDir = path.join(outputsDir, "tmp", previewId);
  await Promise.all([
    mkdir(audioDir, { recursive: true }),
    mkdir(manifestDir, { recursive: true }),
    mkdir(tempDir, { recursive: true })
  ]);

  for (let lineIndex = 0; lineIndex < manifest.lines.length; lineIndex += 1) {
    const line = manifest.lines[lineIndex];
    if (line.lineType === "insert" && show.automation?.generateInsertVideos && line.imagePath && !line.videoTake) {
      try {
        const videoTake = await generateInsertVideoForLine({ episode, line, format: manifest.format });
        line.videoTake = videoTake;
        line.videoStatus = "generated";
        line.videoOutSeconds =
          Number(line.videoOutSeconds) > Number(line.videoInSeconds || 0)
            ? line.videoOutSeconds
            : defaultInsertVideoOutPoint(line, videoTake);
        line.videoPath = videoTakeFilePath(videoTake);
      } catch (error) {
        line.videoStatus = "failed";
        line.videoWarning = cleanErrorMessage(error);
      }
    }

    const reusableTake = reusableAudioTakeForLine(line);
    if (reusableTake) {
      const filePath = audioTakeFilePath(reusableTake);
      line.durationSeconds = reusableTake.durationSeconds || line.durationSeconds;
      line.audioTake = reusableTake;
      line.audio = {
        ...reusableTake,
        filePath
      };
      continue;
    }

    if (reuseOnly) {
      throw new Error(`Audio review clip is missing or stale for line ${line.index}. Regenerate that line first.`);
    }

    const clipFileName = `line-${String(line.index).padStart(3, "0")}-${safeFileSegment(line.speaker)}.wav`;
    const clipPath = path.join(audioDir, clipFileName);
    const generatedAudio =
      line.lineType === "insert"
        ? await writeSilentSpeechWav({ filePath: clipPath, durationSeconds: line.durationSeconds })
        : await writeLineSpeechWav({
            filePath: clipPath,
            line,
            tempDir,
            previousText: manifest.lines[lineIndex - 1]?.text || "",
            nextText: manifest.lines[lineIndex + 1]?.text || ""
          });
    const audioTake = createAudioTake({
      line,
      filePath: clipPath,
      localUrl: `/outputs/audio/${previewId}/${clipFileName}`,
      generatedAudio,
      source: "preview-render"
    });
    line.durationSeconds = generatedAudio.durationSeconds;
    line.audioTake = audioTake;
    line.audioStatus = "pending";
    line.audio = {
      ...audioTake,
      filePath: clipPath
    };
  }
  refreshManifestTiming(manifest);

  const mixFileName = "episode-mix.wav";
  const mixPath = path.join(audioDir, mixFileName);
  await writeEpisodeSpeechMix({ filePath: mixPath, lines: manifest.lines, tempDir });
  manifest.audio = {
    mode: summarizeAudioMode(manifest.lines),
    fileName: mixFileName,
    localUrl: `/outputs/audio/${previewId}/${mixFileName}`,
    durationSeconds: await probeDuration(mixPath),
    warnings: manifest.lines
      .filter((line) => line.audio?.warning)
      .map((line) => `Line ${line.index}: ${line.audio.warning}`)
  };

  let video = null;
  if (renderVideo) {
    try {
      video = await renderPreviewVideo({ previewId, manifest, mixPath });
      manifest.video = video;
    } catch (error) {
      manifest.renderError = error.message || "Preview render failed.";
    }
  }

  const manifestFileName = `${safeFileSegment(episode.title)}-${previewId}.json`;
  const manifestPath = path.join(manifestDir, manifestFileName);
  manifest.fileName = manifestFileName;
  manifest.localUrl = `/outputs/render-manifests/${manifestFileName}`;
  await writeFile(manifestPath, JSON.stringify(stripPrivateManifestFields(manifest), null, 2));

  const outputs = [
    {
      id: `${previewId}-manifest`,
      type: "render_manifest",
      name: manifestFileName,
      localUrl: manifest.localUrl,
      createdAt
    },
    {
      id: `${previewId}-audio`,
      type: "audio_mix",
      name: mixFileName,
      localUrl: manifest.audio.localUrl,
      createdAt
    }
  ];

  if (video) {
    outputs.unshift({
      id: `${previewId}-video`,
      type: "preview_video",
      name: video.fileName,
      localUrl: video.localUrl,
      createdAt,
      width: video.width,
      height: video.height,
      resolution: video.resolution,
      durationSeconds: video.durationSeconds
    });
  }

  return { manifest: stripPrivateManifestFields(manifest), video, outputs };
}

async function createFinalRender({ episode, show, regenerateVideos = true }) {
  const renderId = randomUUID();
  const createdAt = new Date().toISOString();
  const manifest = buildRenderManifest({
    previewId: renderId,
    episode,
    show,
    createdAt,
    reuseExistingVideoTakes: !regenerateVideos
  });
  const recoveredAudioTakes = new Map();
  manifest.mode = "local-production-render";
  manifest.renderNote =
    "Final local render with approved audio and per-shot Fabric/Kling/Aurora/InfiniteTalk lip-sync clips when their selected backend is configured. No publishing was attempted.";
  const audioDir = path.join(outputsDir, "final-audio", renderId);
  const manifestDir = path.join(outputsDir, "render-manifests");
  const tempDir = path.join(outputsDir, "tmp", `final-${renderId}`);
  await Promise.all([
    mkdir(audioDir, { recursive: true }),
    mkdir(manifestDir, { recursive: true }),
    mkdir(tempDir, { recursive: true })
  ]);

  for (const line of manifest.lines) {
    let reusableTake = reusableAudioTakeForLine(line);
    if (!reusableTake) {
      reusableTake = await recoverAudioTakeForLineFromManifests({ episode, line });
      if (reusableTake) {
        line.audioTake = reusableTake;
        recoveredAudioTakes.set(line.id, reusableTake);
      }
    }
    if (!reusableTake) {
      throw new Error(`Audio review clip is missing or stale for line ${line.index}. Rebuild audio before final render.`);
    }
    const filePath = audioTakeFilePath(reusableTake);
    line.durationSeconds = reusableTake.durationSeconds || line.durationSeconds;
    line.audioTake = reusableTake;
    line.audio = {
      ...reusableTake,
      filePath
    };
  }
  refreshManifestTiming(manifest);

  const mixFileName = "episode-final-mix.wav";
  const mixPath = path.join(audioDir, mixFileName);
  await writeEpisodeSpeechMix({ filePath: mixPath, lines: manifest.lines, tempDir });
  manifest.audio = {
    mode: summarizeAudioMode(manifest.lines),
    fileName: mixFileName,
    localUrl: `/outputs/final-audio/${renderId}/${mixFileName}`,
    durationSeconds: await probeDuration(mixPath),
    warnings: manifest.lines
      .filter((line) => line.audio?.warning)
      .map((line) => `Line ${line.index}: ${line.audio.warning}`)
  };

  await renderLipSyncClipsForManifest({
    episode,
    manifest,
    tempDir,
    forceRegenerate: regenerateVideos
  });
  const video = await renderFinalVideo({ renderId, manifest, mixPath });
  manifest.video = video;

  const manifestFileName = `${safeFileSegment(episode.title)}-${renderId}-final.json`;
  const manifestPath = path.join(manifestDir, manifestFileName);
  manifest.fileName = manifestFileName;
  manifest.localUrl = `/outputs/render-manifests/${manifestFileName}`;
  await writeFile(manifestPath, JSON.stringify(stripPrivateManifestFields(manifest), null, 2));

  return {
    manifest: stripPrivateManifestFields(manifest),
    video,
    productionMap: attachAudioTakesToProductionMap(episode.productionMap, manifest.lines),
    outputs: [
      {
        id: `${renderId}-final-video`,
        type: "final_video",
        name: video.fileName,
        localUrl: video.localUrl,
        createdAt,
        width: video.width,
        height: video.height,
        resolution: video.resolution,
        durationSeconds: video.durationSeconds
      },
      {
        id: `${renderId}-final-manifest`,
        type: "final_render_manifest",
        name: manifestFileName,
        localUrl: manifest.localUrl,
        createdAt
      },
      {
        id: `${renderId}-final-audio`,
        type: "final_audio_mix",
        name: mixFileName,
        localUrl: manifest.audio.localUrl,
        createdAt
      }
    ]
  };
}

function buildRenderManifest({ previewId, episode, show, createdAt, reuseExistingVideoTakes = false, preferLatestVideoTakes = false }) {
  const format = normalizeShortFormat({
    ...(show?.shortFormat || {}),
    ...(episode.format || {})
  });
  const { width, height } = parseResolution(format.resolution, format.aspectRatio);
  const assets = Array.isArray(episode.assets) ? episode.assets.map(normalizeAsset) : [];
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const characters = new Map((show.characters || []).map((character) => [character.id, character]));
  const infiniteTalkBackend = infiniteTalkBackendForShow(show);
  let cursor = 0;

  const lines = normalizeProductionMapForFormat(episode.productionMap, format).map((line, index) => {
    const normalized = normalizeProductionLine(line, index);
    const imageAsset = assetById.get(normalized.assetId);
    const endImageAsset = assetById.get(normalized.insertEndAssetId);
    const maskAsset = resolveMaskAsset(normalized.maskAssetId, assetById);
    const maskPath = resolveAssetPath(maskAsset);
    const character = characters.get(normalized.characterId);
    const visualLipSyncModel = sanitizeOptionalLipSyncModel(imageAsset?.metadata?.lipSyncModel);
    const visualLipSyncPrompt = lineLipSyncInputPrompt(normalized, imageAsset);
    const visualAnimationStrength = animationStrengthForAsset(imageAsset);
    const resolvedAnimationStrength = animationStrengthForLine(normalized, imageAsset);
    const resolvedLipSyncModel = lipSyncModelForLine(normalized, { imageAsset, character, show });
    const videoTake = reusableVideoTakeForLine(normalized, imageAsset, endImageAsset, format, maskAsset, {
      show,
      character,
      reuseExistingVideoTake: reuseExistingVideoTakes,
      preferLatestVideoTake: preferLatestVideoTakes
    });
    const durationSeconds =
      normalized.lineType === "insert"
        ? insertPlaybackDurationSeconds(normalized, videoTake)
        : Math.max(1.2, Number(normalized.estimatedSeconds || 0) + 0.2);
    const startSeconds = cursor;
    cursor += durationSeconds;

    return {
      id: normalized.id,
      index: normalized.index,
      lineType: normalized.lineType,
      speaker: normalized.speaker,
      character: character?.name || normalized.speaker,
      voiceId: normalized.voiceId,
      text: normalized.text,
      audioTags: normalized.audioTags,
      expressiveBodyMotion: Boolean(normalized.expressiveBodyMotion),
      audienceCue: normalized.audienceCue,
      lipSyncModel: resolvedLipSyncModel,
      lipSyncModelOverride: sanitizeOptionalLipSyncModel(normalized.lipSyncModel || normalized.lipSyncModelOverride),
      animationStrength: resolvedAnimationStrength,
      animationStrengthOverride: normalizeOptionalAnimationStrength(normalized.animationStrengthOverride),
      infiniteTalkBackend,
      visualLipSyncModel,
      visualLipSyncPrompt,
      visualAnimationStrength,
      audioStatus: normalized.audioStatus,
      audioTake: normalized.audioTake,
      videoStatus: normalized.videoStatus,
      videoTake,
      insertVideoMode: normalized.insertVideoMode,
      insertEndAssetId: normalized.insertEndAssetId,
      videoPrompt: normalized.videoPrompt,
      lipSyncPromptOverride: normalized.lipSyncPromptOverride,
      lipSyncFullPromptOverride: normalized.lipSyncFullPromptOverride,
      lipSyncInputPromptOverride: normalized.lipSyncInputPromptOverride,
      lipSyncInputPromptLocked: normalized.lipSyncInputPromptLocked,
      videoInSeconds: normalized.videoInSeconds,
      videoOutSeconds: normalized.videoOutSeconds,
      shotRole: normalized.shotRole,
      startSeconds: roundSeconds(startSeconds),
      durationSeconds: roundSeconds(durationSeconds),
      needsMask: Boolean(maskPath),
      invertMask: normalized.invertMask,
      image: imageAsset
        ? {
            assetId: imageAsset.id,
            fileName: imageAsset.fileName,
            localUrl: imageAsset.localUrl,
            shotRole: effectiveAssetShotRole(imageAsset),
            speakingTag: imageAsset.metadata?.speakingTag || imageAsset.metadata?.characterTags || "",
            speakingRoles: assetSpeakingRoles(imageAsset),
            lipSyncModel: visualLipSyncModel,
            lipSyncPrompt: visualLipSyncPrompt,
            animationStrength: visualAnimationStrength
          }
        : null,
      imagePath: resolveAssetPath(imageAsset),
      endImage: endImageAsset
        ? {
            assetId: endImageAsset.id,
            fileName: endImageAsset.fileName,
            localUrl: endImageAsset.localUrl
          }
        : null,
      endImagePath: resolveAssetPath(endImageAsset),
      mask: maskPath && maskAsset
        ? {
            assetId: maskAsset.id,
            fileName: maskAsset.fileName,
            localUrl: maskAsset.localUrl
          }
        : null,
      maskPath,
      videoPath: videoTake ? videoTakeFilePath(videoTake) : ""
    };
  });

  return {
    id: previewId,
    createdAt,
    mode: "local-static-preview",
    renderNote: "Static shot preview with generated spoken dialogue audio. This is a voiced timing preview, not final lip-sync.",
    episode: {
      id: episode.id,
      title: episode.title
    },
    show: {
      id: show.id,
      name: show.name,
      production: {
        infiniteTalkBackend
      }
    },
    format: {
      ...format,
      width,
      height
    },
    totalSeconds: roundSeconds(cursor),
    lines
  };
}

function resolveMaskAsset(maskAssetId, assetById) {
  if (!maskAssetId) return null;
  return assetById.get(maskAssetId) || null;
}

async function renderLipSyncClipsForManifest({
  episode,
  manifest,
  tempDir,
  allowStillFallback = allowLipSyncStillFallback(),
  forceRegenerate = false
}) {
  const dialogueLines = manifest.lines.filter((line) => line.lineType !== "insert");
  const outputWidth = Number(manifest.format.width || parseResolution(manifest.format.resolution, manifest.format.aspectRatio).width);
  const outputHeight = Number(manifest.format.height || parseResolution(manifest.format.resolution, manifest.format.aspectRatio).height);
  const outputResolution = `${outputWidth}x${outputHeight}`;
  const selectedModels = [...new Set(dialogueLines.map((line) => lipSyncModelForLine(line)))];
  const selectedBackends = [...new Set(dialogueLines
    .filter((line) => lipSyncModelForLine(line) === "infinitalk")
    .map((line) => infiniteTalkBackendForLine(line, manifest)))];
  const disabledBySetting = lipSyncDisabled();
  manifest.lipSync = {
    provider: "per-shot",
    enabled: !disabledBySetting && dialogueLines.some((line) => lipSyncProviderAvailable(lipSyncModelForLine(line), line, manifest)),
    defaultModel: selectedModels[0] || defaultLipSyncModel(),
    models: selectedModels,
    infiniteTalkBackend: selectedBackends[0] || infiniteTalkBackendForLine({}, manifest),
    infiniteTalkBackends: selectedBackends,
    mode: "image-audio-prompt",
    clips: [],
    warnings: []
  };

  if (!dialogueLines.length) return;
  if (disabledBySetting) {
    const message = "Lip-sync rendering is disabled by NEWTBUILDER_LIPSYNC_ENABLED.";
    const missingReviewedClips = dialogueLines.filter((line) => !line.videoPath);
    if (missingReviewedClips.length && !allowStillFallback) {
      throw new Error(`${message} Set NEWTBUILDER_ALLOW_LIPSYNC_FALLBACK=true to render still/source media instead.`);
    }
    manifest.lipSync.warnings.push(
      missingReviewedClips.length ? message : `${message} Reusing reviewed shot video clips already recorded on the production map.`
    );
    if (missingReviewedClips.length) return;
  }

  for (const line of dialogueLines) {
    const provider = lipSyncModelForLine(line);
    const providerConfig = lipSyncProviderConfig(provider, { line, manifest });
    const outputFolder = providerConfig.outputFolder;
    const source = providerConfig.source;
    const modelId = providerConfig.modelId;
    const providerLabel = providerConfig.label;
    const lipSyncDir = path.join(outputsDir, outputFolder, episode.id);
    const rawDir = path.join(lipSyncDir, "raw");
    await Promise.all([
      mkdir(lipSyncDir, { recursive: true }),
      mkdir(rawDir, { recursive: true })
    ]);

    if (!line.imagePath) {
      throw new Error(`Line ${line.index} needs an assigned image before ${providerLabel} lip-sync can render.`);
    }
    if (!line.audio?.filePath) {
      throw new Error(`Line ${line.index} needs approved audio before ${providerLabel} lip-sync can render.`);
    }
    if (line.needsMask && !line.maskPath) {
      throw new Error(`Line ${line.index} needs a mask for the assigned wide shot.`);
    }

    const prompt = lipSyncPromptForLine(line, provider);
    const existingTake = normalizeVideoTake(line.videoTake || line.lipSyncTake);
    if (!forceRegenerate && line.videoPath && existingTake?.localUrl) {
      const durationSeconds = (await probeDuration(line.videoPath)) || existingTake.durationSeconds || line.durationSeconds;
      const take = normalizeVideoTake({
        ...existingTake,
        durationSeconds,
        width: existingTake.width || outputWidth,
        height: existingTake.height || outputHeight,
        resolution: existingTake.resolution || outputResolution,
        aspectRatio: existingTake.aspectRatio || manifest.format.aspectRatio || ""
      });
      line.lipSyncTake = take;
      line.videoTake = take;
      line.videoStatus = line.videoStatus === "failed" ? "cached" : line.videoStatus || "cached";
      manifest.lipSync.clips.push({
        lineIndex: line.index,
        speaker: line.speaker,
        localUrl: take.localUrl,
        durationSeconds,
        cached: true,
        provider,
        backend: providerConfig.backend || "",
        model: take.model || modelId,
        resolution: take.resolution || outputResolution,
        aspectRatio: take.aspectRatio || manifest.format.aspectRatio || "",
        masked: Boolean(line.needsMask && line.maskPath),
        invertMask: Boolean(line.invertMask),
        expressiveBodyMotion: Boolean(line.expressiveBodyMotion),
        animationStrength: animationStrengthForLine(line)
      });
      continue;
    }

    const signature = lineLipSyncSignature(line, manifest.format, { provider, modelId, prompt });
    const signatureHash = forceRegenerate
      ? `${signatureHashFor(signature)}-${randomUUID().slice(0, 8)}`
      : signatureHashFor(signature);
    const lineLabel = `line-${String(line.index).padStart(3, "0")}-${safeFileSegment(line.speaker)}`;
    const fileName = `${lineLabel}-${signatureHash}.mp4`;
    const filePath = path.join(lipSyncDir, fileName);
    const localUrl = `/outputs/${outputFolder}/${episode.id}/${fileName}`;
    const cachedDuration = existsSync(filePath) ? await probeDuration(filePath) : 0;
    const masked = Boolean(line.needsMask && line.maskPath);
    const infiniteTalkMultiPerson = infiniteTalkMultiPersonPlanForLine(line);
    const useInfiniteTalkMultiPerson = provider === "infinitalk" && infiniteTalkMultiPerson.enabled;
    const useHardMaskComposite = masked && !useInfiniteTalkMultiPerson;
    let durationSeconds = cachedDuration;
    let remoteUrl = "";
    let cached = !forceRegenerate && cachedDuration > 0;

    try {
      if (!cached) {
        if (!lipSyncProviderAvailable(provider, line, manifest)) {
          throw new Error(`${providerLabel} clip for line ${line.index} is not cached. ${lipSyncProviderUnavailableMessage(provider, line, manifest)}`);
        }
        const rawPath = path.join(rawDir, `${lineLabel}-${signatureHash}-raw.mp4`);
        if (provider === "infinitalk" && masked && infiniteTalkMaskMode() === "multi" && !useInfiniteTalkMultiPerson) {
          throw new Error(
            `InfiniteTalk multi-person masking could not start for line ${line.index}: ${infiniteTalkMultiPerson.reason}. ` +
              "Use a medium/wide shot asset with exactly two speaking tags such as @mary @bob, or set NEWTBUILDER_INFINITALK_MASK_MODE=composite to use the old still-composite mask."
          );
        }
        const lipSyncInputPath = useHardMaskComposite
          ? await prepareLipSyncInputImage({ line, tempDir, signatureHash })
          : line.imagePath;
        const lipSyncAudioPath = lipSyncMinimumAudioSeconds(provider) > 0
          ? await prepareLipSyncAudio({ line, tempDir, signatureHash, provider })
          : line.audio.filePath;
        const result = await runLipSyncProvider({
          provider,
          imagePath: lipSyncInputPath,
          audioPath: lipSyncAudioPath,
          prompt,
          line,
          format: manifest.format,
          tempDir,
          rawPath,
          manifest,
          infiniteTalkMultiPerson: useInfiniteTalkMultiPerson ? infiniteTalkMultiPerson : null
        });
        const localResultPath = localVideoPath(result);
        if (localResultPath) {
          const resolvedLocalResultPath = path.resolve(localResultPath);
          if (!existsSync(resolvedLocalResultPath)) {
            throw new Error(`${providerLabel} returned a local video path that does not exist for line ${line.index}.`);
          }
          if (resolvedLocalResultPath !== path.resolve(rawPath)) {
            await copyFile(resolvedLocalResultPath, rawPath);
          }
        } else {
          remoteUrl = falVideoUrl(result);
          if (!remoteUrl) {
            throw new Error(`${providerLabel} did not return a video URL for line ${line.index}.`);
          }
          await downloadRemoteFile(remoteUrl, rawPath, `${providerLabel} lip-sync clip`);
        }
        const rawDurationSeconds = await probeDuration(rawPath);
        if (useHardMaskComposite) {
          await compositeLipSyncClipWithMask({
            lipSyncPath: rawPath,
            stillPath: line.imagePath,
            maskPath: line.maskPath,
            outputPath: filePath,
            invertMask: line.invertMask,
            fps: Number(manifest.format.fps || 30),
            durationSeconds: rawDurationSeconds || line.durationSeconds,
            width: outputWidth,
            height: outputHeight
          });
        } else {
          await normalizeLipSyncClip({
            sourcePath: rawPath,
            outputPath: filePath,
            fps: Number(manifest.format.fps || 30),
            width: outputWidth,
            height: outputHeight
          });
        }
        durationSeconds = await probeDuration(filePath);
      }

      const take = normalizeVideoTake({
        id: `${line.id || lineLabel}-${provider}-${signatureHash}`,
        fileName,
        localUrl,
        remoteUrl,
        model: modelId,
        prompt: compactText(prompt || providerConfig.promptSummary, lipSyncPromptLengthForProvider(provider)),
        warning: "",
        durationSeconds,
        signature,
        source,
        width: outputWidth,
        height: outputHeight,
        resolution: outputResolution,
        aspectRatio: manifest.format.aspectRatio || "",
        generatedAt: cached ? "" : new Date().toISOString()
      });
      line.lipSyncTake = take;
      line.videoTake = take;
      line.videoPath = filePath;
      line.videoStatus = cached ? "cached" : "generated";
      manifest.lipSync.clips.push({
        lineIndex: line.index,
        speaker: line.speaker,
        localUrl,
        durationSeconds,
        cached,
        provider,
        backend: providerConfig.backend || "",
        model: modelId,
        resolution: outputResolution,
        aspectRatio: manifest.format.aspectRatio || "",
        masked,
        hardMaskComposite: useHardMaskComposite,
        infiniteTalkMultiPerson: useInfiniteTalkMultiPerson ? infiniteTalkMultiPerson : null,
        invertMask: Boolean(line.invertMask),
        expressiveBodyMotion: Boolean(line.expressiveBodyMotion),
        animationStrength: animationStrengthForLine(line)
      });
    } catch (error) {
      const message = compactText(String(error?.message || error || `Unknown ${providerLabel} error`).replace(/\s+/g, " "), 700);
      if (!allowStillFallback) {
        throw new Error(
          `${providerLabel} lip-sync failed for line ${line.index}; rendering stopped before falling back to still/source media. ${message} Set NEWTBUILDER_ALLOW_LIPSYNC_FALLBACK=true to allow still fallback.`
        );
      }
      manifest.lipSync.warnings.push(`Line ${line.index}: ${providerLabel} failed; using the still image. ${message}`);
      line.videoPath = "";
      line.videoStatus = "lip_sync_failed";
    }
  }
}

function resolveAssetPath(asset) {
  if (!asset) return "";
  if (asset.storedFileName) {
    const filePath = path.resolve(uploadsDir, path.basename(asset.storedFileName));
    if (filePath.startsWith(`${path.resolve(uploadsDir)}${path.sep}`) && existsSync(filePath)) {
      return filePath;
    }
  }
  const localUrl = String(asset.localUrl || "");
  if (localUrl.startsWith("/uploads/")) {
    const filePath = path.resolve(rootDir, localUrl.slice(1));
    if (filePath.startsWith(`${path.resolve(uploadsDir)}${path.sep}`) && existsSync(filePath)) return filePath;
  }
  return "";
}

async function renderPreviewVideo({ previewId, manifest, mixPath }) {
  const previewDir = path.join(outputsDir, "previews");
  const tempDir = path.join(outputsDir, "tmp", previewId);
  await Promise.all([
    mkdir(previewDir, { recursive: true }),
    mkdir(tempDir, { recursive: true })
  ]);

  const linesWithMedia = manifest.lines.filter((line) => line.videoPath || line.imagePath);
  if (!linesWithMedia.length) {
    throw new Error("No image- or video-backed lines available for preview render.");
  }

  const fileName = `${safeFileSegment(manifest.episode.title)}-${previewId}.mp4`;
  const outputPath = path.join(previewDir, fileName);
  const fps = Number(manifest.format.fps || 30);
  const width = Number(manifest.format.width || 1920);
  const height = Number(manifest.format.height || 1080);
  const videoTailHoldSeconds = 0.35;
  const mediaInputArgs = linesWithMedia.flatMap((line, index) => {
    const segmentDuration = line.durationSeconds + (index === linesWithMedia.length - 1 ? videoTailHoldSeconds : 0);
    if (line.videoPath) {
      return ["-i", line.videoPath];
    }
    return [
      "-loop",
      "1",
      "-framerate",
      String(fps),
      "-t",
      segmentDuration.toFixed(3),
      "-i",
      line.imagePath
    ];
  });
  const mediaFilters = linesWithMedia.map((line, index) => {
    const segmentDuration = line.durationSeconds + (index === linesWithMedia.length - 1 ? videoTailHoldSeconds : 0);
    const trimStart = line.videoPath ? insertVideoInPoint(line) : 0;
    const sourcePadding = line.videoPath ? `tpad=stop_mode=clone:stop_duration=${segmentDuration.toFixed(3)},` : "";
    const trimFilter = line.videoPath
      ? `trim=start=${trimStart.toFixed(3)}:duration=${segmentDuration.toFixed(3)},`
      : `trim=duration=${segmentDuration.toFixed(3)},`;
    const fitFilters = line.videoPath
      ? [
          `scale=${width}:${height}:force_original_aspect_ratio=increase`,
          `crop=${width}:${height}:x=(in_w-out_w)/2:y=(in_h-out_h)/2`
        ]
      : finalStillFitFilters({ width, height });
    return [
      `[${index}:v]`,
      ...fitFilters.map((filter) => `${filter},`),
      "setsar=1,",
      `fps=${fps},`,
      "format=yuv420p,",
      sourcePadding,
      trimFilter,
      "setpts=PTS-STARTPTS",
      `[v${index}]`
    ].join("");
  });
  const concatInputs = linesWithMedia.map((_, index) => `[v${index}]`).join("");
  const filterComplex = `${mediaFilters.join(";")};${concatInputs}concat=n=${linesWithMedia.length}:v=1:a=0[vout]`;
  const audioInputIndex = linesWithMedia.length;

  await execFileAsync(
    ffmpegPath,
    [
      "-y",
      ...mediaInputArgs,
      "-i",
      mixPath,
      "-filter_complex",
      filterComplex,
      "-map",
      "[vout]",
      "-map",
      `${audioInputIndex}:a:0`,
      "-shortest",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      outputPath
    ],
    { timeout: 180000, maxBuffer: 20 * 1024 * 1024 }
  );

  return {
    id: `${previewId}-video`,
    type: "preview_video",
    fileName,
    localUrl: `/outputs/previews/${fileName}`,
    width,
    height,
    resolution: `${width}x${height}`,
    durationSeconds: await probeDuration(outputPath)
  };
}

async function renderFinalVideo({ renderId, manifest, mixPath }) {
  const finalDir = path.join(outputsDir, "final-renders");
  const tempDir = path.join(outputsDir, "tmp", `final-${renderId}`);
  await Promise.all([
    mkdir(finalDir, { recursive: true }),
    mkdir(tempDir, { recursive: true })
  ]);

  const linesWithMedia = manifest.lines.filter((line) => line.videoPath || line.imagePath);
  if (!linesWithMedia.length) {
    throw new Error("No image- or video-backed lines available for final render.");
  }

  const fileName = `${safeFileSegment(manifest.episode.title)}-${renderId}-final.mp4`;
  const outputPath = path.join(finalDir, fileName);
  const fps = Number(manifest.format.fps || 30);
  const width = Number(manifest.format.width || 1920);
  const height = Number(manifest.format.height || 1080);
  const videoTailHoldSeconds = 0.35;
  const mediaInputArgs = linesWithMedia.flatMap((line, index) => {
    const segmentDuration = line.durationSeconds + (index === linesWithMedia.length - 1 ? videoTailHoldSeconds : 0);
    if (line.videoPath) {
      return ["-i", line.videoPath];
    }
    return [
      "-loop",
      "1",
      "-framerate",
      String(fps),
      "-t",
      segmentDuration.toFixed(3),
      "-i",
      line.imagePath
    ];
  });
  const mediaFilters = linesWithMedia.map((line, index) => {
    const segmentDuration = line.durationSeconds + (index === linesWithMedia.length - 1 ? videoTailHoldSeconds : 0);
      const trimStart = line.videoPath && line.lineType === "insert" ? insertVideoInPoint(line) : 0;
      const sourcePadding = line.videoPath ? `tpad=stop_mode=clone:stop_duration=${segmentDuration.toFixed(3)},` : "";
      const trimFilter = line.videoPath
        ? `trim=start=${trimStart.toFixed(3)}:duration=${segmentDuration.toFixed(3)},`
        : `trim=duration=${segmentDuration.toFixed(3)},`;
      const fitFilters = line.videoPath
        ? [
            `scale=${width}:${height}:force_original_aspect_ratio=increase`,
            `crop=${width}:${height}:x=(in_w-out_w)/2:y=(in_h-out_h)/2`
          ]
        : finalStillFitFilters({ width, height });
      return [
        `[${index}:v]`,
        ...fitFilters.map((filter) => `${filter},`),
        "setsar=1,",
        `fps=${fps},`,
        "format=yuv420p,",
        sourcePadding,
        trimFilter,
        "setpts=PTS-STARTPTS",
        `[v${index}]`
      ].join("");
  });
  const concatInputs = linesWithMedia.map((_, index) => `[v${index}]`).join("");
  const filterComplex = `${mediaFilters.join(";")};${concatInputs}concat=n=${linesWithMedia.length}:v=1:a=0[vout]`;
  const audioInputIndex = linesWithMedia.length;

  await execFileAsync(
    ffmpegPath,
    [
      "-y",
      ...mediaInputArgs,
      "-i",
      mixPath,
      "-filter_complex",
      filterComplex,
      "-map",
      "[vout]",
      "-map",
      `${audioInputIndex}:a:0`,
      "-shortest",
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "-movflags",
      "+faststart",
      outputPath
    ],
    { timeout: 300000, maxBuffer: 30 * 1024 * 1024 }
  );

  return {
    id: `${renderId}-final-video`,
    type: "final_video",
    fileName,
    localUrl: `/outputs/final-renders/${fileName}`,
    width,
    height,
    resolution: `${width}x${height}`,
    durationSeconds: await probeDuration(outputPath)
  };
}

async function generateThumbnailCandidates({ episode, show, thumbnailBrief = {} }) {
  const provider = String(process.env.NEWTBUILDER_THUMBNAIL_PROVIDER || "fal").toLowerCase();
  if (provider !== "local" && falApiKey) {
    return generateAiThumbnailCandidates({ episode, show, thumbnailBrief });
  }
  return generateFrameThumbnailCandidates({ episode, show, thumbnailBrief });
}

async function generateFrameThumbnailCandidates({ episode, show, thumbnailBrief = {} }) {
  const sourceOutput = latestVideoOutputForThumbnail(episode);
  const sourcePath = outputFilePath(sourceOutput);
  if (!sourcePath) {
    throw new Error("Build a preview or final render before generating thumbnails.");
  }

  const runId = randomUUID();
  const thumbnailDir = path.join(outputsDir, "thumbnails", episode.id);
  const tempDir = path.join(outputsDir, "tmp", `thumb-${runId}`);
  await Promise.all([mkdir(thumbnailDir, { recursive: true }), mkdir(tempDir, { recursive: true })]);

  const duration = Number(sourceOutput.durationSeconds || (await probeDuration(sourcePath)) || 0);
  const vertical = episode.format?.aspectRatio === "9:16";
  const width = vertical ? 1080 : 1280;
  const height = vertical ? 1920 : 720;
  const title = thumbnailTitleText({ episode, show, thumbnailBrief });
  const variants = thumbnailVariants({ title, show });
  const outputs = [];

  try {
    for (const variant of variants) {
      const timestamp = thumbnailTimestamp(duration, variant.position);
      const textPath = path.join(tempDir, `${variant.id}.txt`);
      await writeFile(textPath, variant.text);
      const fileName = `${safeFileSegment(episode.title)}-${runId.slice(0, 8)}-${variant.id}.png`;
      const outputPath = path.join(thumbnailDir, fileName);
      await renderThumbnailCandidate({
        sourcePath,
        outputPath,
        framePath: path.join(tempDir, `${variant.id}-frame.png`),
        textPath,
        timestamp,
        width,
        height,
        variant
      });
      const actualDimensions = await readImageDimensions(outputPath);
      const outputWidth = actualDimensions.width || width;
      const outputHeight = actualDimensions.height || height;
      outputs.push({
        id: `${runId}-${variant.id}`,
        type: "thumbnail_image",
        name: variant.label,
        fileName,
        localUrl: `/outputs/thumbnails/${episode.id}/${fileName}`,
        width: outputWidth,
        height: outputHeight,
        resolution: `${outputWidth}x${outputHeight}`,
        sourceOutputId: sourceOutput.id || "",
        sourceOutputType: sourceOutput.type || "",
        timestampSeconds: roundSeconds(timestamp),
        prompt: variant.prompt,
        createdAt: new Date().toISOString()
      });
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }

  return { sourceOutput, outputs };
}

async function generateAiThumbnailCandidates({ episode, show, thumbnailBrief = {} }) {
  if (!falApiKey) {
    throw new Error("fal API key is not configured.");
  }

  const runId = randomUUID();
  const thumbnailDir = path.join(outputsDir, "thumbnails", episode.id);
  const tempDir = path.join(outputsDir, "tmp", `ai-thumb-${runId}`);
  await Promise.all([mkdir(thumbnailDir, { recursive: true }), mkdir(tempDir, { recursive: true })]);

  const sourceOutput = latestVideoOutputForThumbnail(episode);
  const sourcePath = outputFilePath(sourceOutput);
  const vertical = episode.format?.aspectRatio === "9:16";
  const width = vertical ? 1080 : 1920;
  const height = vertical ? 1920 : 1080;
  const title = thumbnailTitleText({ episode, show, thumbnailBrief });
  const variants = thumbnailVariants({ title, show });
  const outputs = [];

  try {
    const referencePaths = [];
    if (sourcePath) {
      const duration = Number(sourceOutput.durationSeconds || (await probeDuration(sourcePath)) || 0);
      const framePath = path.join(tempDir, "render-reference.jpg");
      await extractThumbnailReferenceFrame({
        sourcePath,
        outputPath: framePath,
        timestamp: thumbnailTimestamp(duration, thumbnailBriefStillPosition(thumbnailBrief.stillFrame)),
        width,
        height
      });
      referencePaths.push(framePath);
    }

    const assetReferences = await thumbnailReferenceAssetPaths({ episode, tempDir });
    referencePaths.push(...assetReferences);
    if (!referencePaths.length) {
      throw new Error("Upload shot images or build a render before generating AI thumbnails.");
    }

    const imageUrls = await Promise.all(referencePaths.slice(0, 5).map((filePath) => imageDataUri(filePath)));
    for (const variant of variants) {
      const prompt = aiThumbnailPrompt({ episode, show, variant, title, vertical, thumbnailBrief });
      const result = await runFalGptImageThumbnail({
        imageUrls,
        prompt,
        width,
        height
      });
      const remoteUrl = result?.images?.[0]?.url || "";
      if (!remoteUrl) {
        throw new Error("fal GPT Image 2 response did not include an image URL.");
      }
      const fileName = `${safeFileSegment(episode.title)}-${runId.slice(0, 8)}-${variant.id}-ai.png`;
      const outputPath = path.join(thumbnailDir, fileName);
      await downloadRemoteFile(remoteUrl, outputPath, "AI thumbnail");
      const actualDimensions = await readImageDimensions(outputPath);
      const outputWidth = actualDimensions.width || result?.images?.[0]?.width || width;
      const outputHeight = actualDimensions.height || result?.images?.[0]?.height || height;
      outputs.push({
        id: `${runId}-${variant.id}-ai`,
        type: "thumbnail_image",
        name: `${variant.label} AI`,
        fileName,
        localUrl: `/outputs/thumbnails/${episode.id}/${fileName}`,
        width: outputWidth,
        height: outputHeight,
        resolution: `${outputWidth}x${outputHeight}`,
        sourceOutputId: sourceOutput?.id || "",
        sourceOutputType: sourceOutput?.type || "",
        prompt,
        provider: "fal-gpt-image-2-edit",
        remoteUrl,
        createdAt: new Date().toISOString()
      });
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }

  return { sourceOutput, outputs, provider: "AI" };
}

function latestVideoOutputForThumbnail(episode) {
  const outputs = Array.isArray(episode.outputs) ? episode.outputs : [];
  return (
    outputs.find((output) => output.type === "upscaled_video" && outputFilePath(output)) ||
    outputs.find((output) => output.type === "finished_master" && outputFilePath(output)) ||
    outputs.find((output) => output.type === "final_video" && outputFilePath(output)) ||
    outputs.find((output) => output.type === "preview_video" && outputFilePath(output)) ||
    null
  );
}

function latestVideoOutputForUpscale(episode, sourceOutputId = "") {
  const outputs = Array.isArray(episode.outputs) ? episode.outputs : [];
  const requestedId = cleanId(sourceOutputId);
  if (requestedId) {
    const requested = outputs.find((output) => output.id === requestedId && outputFilePath(output));
    if (requested) return requested;
  }
  return (
    outputs.find((output) => output.type === "finished_master" && outputFilePath(output)) ||
    outputs.find((output) => output.type === "final_video" && outputFilePath(output)) ||
    outputs.find((output) => output.type === "preview_video" && outputFilePath(output)) ||
    null
  );
}

async function upscaleVideoForEpisode({ episode, options = {} }) {
  const sourceOutput = latestVideoOutputForUpscale(episode, options.sourceOutputId);
  const sourcePath = outputFilePath(sourceOutput);
  if (!sourcePath) {
    throw new Error("Build a preview or final render before upscaling.");
  }
  if (!existsSync(realEsrganPath)) {
    throw new Error(`Real-ESRGAN is not installed at ${realEsrganPath}. Set REALESRGAN_NCNN_PATH to the executable path.`);
  }

  const sourceDimensions = await probeMediaDimensions(sourcePath);
  const target = sanitizeUpscaleTargetResolution(options.targetResolution || process.env.NEWTBUILDER_UPSCALE_DEFAULT_TARGET, sourceDimensions);
  const model = sanitizeUpscaleModel(options.model || process.env.NEWTBUILDER_UPSCALE_DEFAULT_MODEL);
  const scale = upscaleScaleForTarget(sourceDimensions, target, model);
  const runId = randomUUID();
  const outputDir = path.join(outputsDir, "upscaled-videos", episode.id);
  const tempDir = path.join(outputsDir, "tmp", `upscale-${runId}`);
  const fileName = `${safeFileSegment(episode.title)}-${runId.slice(0, 8)}-${target.width}x${target.height}-upscaled.mp4`;
  const outputPath = path.join(outputDir, fileName);
  const progressContext = upscaleProgressContext({ episode, sourceOutput, target, model });

  setComfyUiProgress(progressContext, {
    status: "queued",
    phase: "preparing",
    percent: 2,
    message: `Preparing ${target.width} x ${target.height} Real-ESRGAN upscale from ${sourceOutput?.name || sourceOutput?.fileName || "the latest video"}.`
  });

  await Promise.all([mkdir(outputDir, { recursive: true }), mkdir(tempDir, { recursive: true })]);
  try {
    await runRealEsrganVideoUpscale({
      sourcePath,
      outputPath,
      tempDir,
      target,
      model,
      scale,
      progressContext
    });
    completeComfyUiProgress(progressContext, {
      phase: "complete",
      message: `Upscaled video ready at ${target.width} x ${target.height}.`
    });
  } catch (error) {
    failComfyUiProgress(progressContext, error, {
      message: "Upscale failed."
    });
    throw error;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }

  const actualDimensions = await probeMediaDimensions(outputPath);
  const width = actualDimensions.width || target.width;
  const height = actualDimensions.height || target.height;
  return {
    sourceOutput,
    output: {
      id: `${runId}-upscaled-video`,
      type: "upscaled_video",
      name: `${target.width} x ${target.height} Real-ESRGAN upscale`,
      fileName,
      localUrl: `/outputs/upscaled-videos/${episode.id}/${fileName}`,
      width,
      height,
      resolution: `${width}x${height}`,
      durationSeconds: await probeDuration(outputPath),
      provider: "Real-ESRGAN ncnn Vulkan",
      model,
      scale,
      sourceOutputId: sourceOutput.id || "",
      sourceOutputType: sourceOutput.type || "",
      sourceLocalUrl: sourceOutput.localUrl || "",
      createdAt: new Date().toISOString()
    }
  };
}

async function runRealEsrganVideoUpscale({ sourcePath, outputPath, tempDir, target, model, scale, progressContext = null }) {
  const inputFramesDir = path.join(tempDir, "frames");
  const upscaledFramesDir = path.join(tempDir, "upscaled");
  await Promise.all([mkdir(inputFramesDir, { recursive: true }), mkdir(upscaledFramesDir, { recursive: true })]);

  const fps = await probeVideoFrameRate(sourcePath);
  if (progressContext) {
    setComfyUiProgress(progressContext, {
      status: "running",
      phase: "extracting_frames",
      percent: 6,
      message: "Extracting source video frames for upscale."
    });
  }
  await execFileAsync(
    ffmpegPath,
    [
      "-y",
      "-i",
      sourcePath,
      "-vsync",
      "0",
      path.join(inputFramesDir, "frame%08d.png")
    ],
    { timeout: 30 * 60 * 1000, maxBuffer: 24 * 1024 * 1024 }
  );
  const sourceFrameCount = await countFrameFiles(inputFramesDir);
  if (!sourceFrameCount) {
    throw new Error("Upscale failed because ffmpeg did not extract any source frames.");
  }
  if (progressContext) {
    setComfyUiProgress(progressContext, {
      status: "running",
      phase: "upscaling_frames",
      percent: 12,
      value: 0,
      max: sourceFrameCount,
      message: `Extracted ${sourceFrameCount} frames. Starting Real-ESRGAN ${model}.`
    });
  }

  await runRealEsrganFramesWithProgress({
    inputFramesDir,
    upscaledFramesDir,
    model,
    scale,
    progressContext,
    frameCount: sourceFrameCount
  });

  const hasAudio = await probeHasAudio(sourcePath);
  const fitFilters = [
    `scale=${target.width}:${target.height}:force_original_aspect_ratio=increase`,
    `crop=${target.width}:${target.height}:x=(in_w-out_w)/2:y=(in_h-out_h)/2`,
    "setsar=1",
    "format=yuv420p"
  ].join(",");
  const args = [
    "-y",
    "-framerate",
    fps.toFixed(6),
    "-i",
    path.join(upscaledFramesDir, "frame%08d.png"),
    "-i",
    sourcePath,
    "-vf",
    fitFilters,
    "-map",
    "0:v:0"
  ];
  if (hasAudio) args.push("-map", "1:a:0", "-c:a", "copy");
  args.push("-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-shortest", outputPath);
  if (progressContext) {
    setComfyUiProgress(progressContext, {
      status: "running",
      phase: "rebuilding_video",
      percent: 92,
      value: sourceFrameCount,
      max: sourceFrameCount,
      message: "Rebuilding the upscaled MP4 and preserving the source audio."
    });
  }
  await execFileAsync(ffmpegPath, args, {
    timeout: 45 * 60 * 1000,
    maxBuffer: 32 * 1024 * 1024
  });
  if (progressContext) {
    setComfyUiProgress(progressContext, {
      status: "running",
      phase: "verifying_output",
      percent: 98,
      message: "Verifying the upscaled video output."
    });
  }
}

async function runRealEsrganFramesWithProgress({ inputFramesDir, upscaledFramesDir, model, scale, progressContext, frameCount }) {
  const timeoutMs = boundedEnvNumber("NEWTBUILDER_UPSCALE_TIMEOUT_MS", 2 * 60 * 60 * 1000, 60000, 12 * 60 * 60 * 1000);
  const args = [
    "-i",
    inputFramesDir,
    "-o",
    upscaledFramesDir,
    "-m",
    path.join(path.dirname(realEsrganPath), "models"),
    "-n",
    model,
    "-s",
    String(scale),
    "-f",
    "png"
  ];

  await new Promise((resolve, reject) => {
    const child = spawn(realEsrganPath, args, {
      cwd: path.dirname(realEsrganPath),
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let lastDone = 0;

    const updateProgress = async (force = false) => {
      if (!progressContext || settled) return;
      const done = Math.max(lastDone, await countFrameFiles(upscaledFramesDir));
      if (!force && done === lastDone) return;
      lastDone = done;
      const percent = Math.min(90, Math.max(14, Math.round(14 + (done / Math.max(frameCount, 1)) * 76)));
      setComfyUiProgress(progressContext, {
        status: "running",
        phase: "upscaling_frames",
        percent,
        value: done,
        max: frameCount,
        message: `Upscaled ${done} of ${frameCount} frames with Real-ESRGAN ${model}.`
      });
    };

    const clear = () => {
      settled = true;
      clearInterval(progressTimer);
      clearTimeout(timeoutTimer);
    };

    const fail = (error) => {
      clear();
      reject(error);
    };

    const progressTimer = setInterval(() => {
      updateProgress().catch(() => {});
    }, 1000);
    const timeoutTimer = setTimeout(() => {
      child.kill();
      fail(new Error(`Real-ESRGAN upscale timed out after ${Math.round(timeoutMs / 60000)} minutes.`));
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout = tailProcessText(stdout, chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = tailProcessText(stderr, chunk);
    });
    child.once("error", fail);
    child.once("close", async (code) => {
      if (settled) return;
      await updateProgress(true).catch(() => {});
      clear();
      if (code !== 0) {
        reject(new Error(`Real-ESRGAN exited with code ${code}.${stderr || stdout ? ` ${compactText(stderr || stdout, 500)}` : ""}`));
        return;
      }
      resolve();
    });
  });
}

async function countFrameFiles(dir) {
  try {
    const entries = await readdir(dir);
    return entries.filter((entry) => /\.(png|jpe?g|webp)$/i.test(entry)).length;
  } catch {
    return 0;
  }
}

function tailProcessText(existing, chunk, maxLength = 6000) {
  const next = `${existing || ""}${String(chunk || "")}`;
  return next.length > maxLength ? next.slice(-maxLength) : next;
}

function sanitizeUpscaleModel(value) {
  const normalized = String(value || "").trim();
  if (["realesrgan-x4plus", "realesrgan-x4plus-anime"].includes(normalized)) return normalized;
  return "realesr-animevideov3";
}

function sanitizeUpscaleTargetResolution(value, sourceDimensions = {}) {
  const match = normalizeResolutionValue(value).match(/^(\d+)x(\d+)$/);
  if (match) {
    return { width: Number(match[1]), height: Number(match[2]) };
  }
  const width = Math.max(16, Math.round(Number(sourceDimensions.width || 0) * 2));
  const height = Math.max(16, Math.round(Number(sourceDimensions.height || 0) * 2));
  return { width, height };
}

function upscaleScaleForTarget(sourceDimensions = {}, target = {}, model = "") {
  if (["realesrgan-x4plus", "realesrgan-x4plus-anime"].includes(model)) return 4;
  const sourceWidth = Math.max(1, Number(sourceDimensions.width) || 1);
  const sourceHeight = Math.max(1, Number(sourceDimensions.height) || 1);
  const ratio = Math.max(Number(target.width || 0) / sourceWidth, Number(target.height || 0) / sourceHeight, 2);
  return Math.min(4, Math.max(2, Math.ceil(ratio)));
}

function outputFilePath(output) {
  const localUrl = String(output?.localUrl || "");
  if (!localUrl.startsWith("/outputs/")) return "";
  const filePath = path.resolve(rootDir, `.${localUrl}`);
  const outputRoot = path.resolve(outputsDir);
  if (!filePath.startsWith(`${outputRoot}${path.sep}`) || !existsSync(filePath)) return "";
  return filePath;
}

function localProjectFilePath(localUrl) {
  const url = String(localUrl || "");
  if (!url.startsWith("/uploads/") && !url.startsWith("/outputs/")) return "";
  const filePath = path.resolve(rootDir, `.${url}`);
  const uploadRoot = path.resolve(uploadsDir);
  const outputRoot = path.resolve(outputsDir);
  const allowed =
    filePath.startsWith(`${uploadRoot}${path.sep}`) ||
    filePath.startsWith(`${outputRoot}${path.sep}`);
  if (!allowed || !existsSync(filePath)) return "";
  return filePath;
}

function finishingLayerFilePath(layer) {
  if (layer?.storedFileName) {
    const uploadPath = path.resolve(uploadsDir, path.basename(layer.storedFileName));
    if (uploadPath.startsWith(`${path.resolve(uploadsDir)}${path.sep}`) && existsSync(uploadPath)) return uploadPath;
  }
  return localProjectFilePath(layer?.localUrl);
}

async function generateElevenVideoMusicLayer({ episode, brief = {} }) {
  const sourceOutput = latestFinalVideoOutput(episode);
  const sourcePath = outputFilePath(sourceOutput);
  if (!sourcePath) {
    throw new Error("Render the final video before generating music.");
  }

  const sourceStats = await stat(sourcePath);
  if (sourceStats.size > 200 * 1024 * 1024) {
    throw new Error("ElevenLabs Video-to-Music supports video inputs up to 200MB.");
  }

  const sourceDuration = Number(sourceOutput.durationSeconds || (await probeDuration(sourcePath)) || 0);
  if (sourceDuration > 600) {
    throw new Error("ElevenLabs Video-to-Music supports video inputs up to 600 seconds.");
  }

  const musicId = randomUUID();
  const musicDir = path.join(outputsDir, "music");
  await mkdir(musicDir, { recursive: true });

  const outputFormat = String(process.env.ELEVEN_MUSIC_OUTPUT_FORMAT || "").trim();
  const url = new URL("https://api.elevenlabs.io/v1/music/video-to-music");
  if (outputFormat) url.searchParams.set("output_format", outputFormat);

  const description = compactText(
    String(
      brief.description ||
        "Instrumental background music that follows the video's energy, supports dialogue, and stays light enough for spoken lines to remain clear."
    ).trim(),
    1000
  );
  const tags = musicTagsFromInput(brief.tags || "warm, playful, cinematic, light, instrumental");
  const sourceBytes = await readFile(sourcePath);
  const form = new FormData();
  form.append("videos", new Blob([sourceBytes], { type: "video/mp4" }), path.basename(sourcePath));
  if (description) form.append("description", description);
  tags.forEach((tag) => form.append("tags", tag));
  form.append("model_id", process.env.ELEVEN_MUSIC_MODEL_ID || "music_v1");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": elevenLabsApiKey,
      Accept: audioMimeTypeForElevenOutputFormat(outputFormat)
    },
    body: form,
    signal:
      typeof AbortSignal !== "undefined" && AbortSignal.timeout
        ? AbortSignal.timeout(Number(process.env.ELEVEN_MUSIC_TIMEOUT_MS || 300000))
        : undefined
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`ElevenLabs Video-to-Music returned ${response.status}${detail ? `: ${compactText(detail, 180)}` : ""}`);
  }

  const contentType = String(response.headers.get("content-type") || audioMimeTypeForElevenOutputFormat(outputFormat));
  const extension = extensionForGeneratedAudio({ contentType, outputFormat });
  const fileName = `${safeFileSegment(episode.title)}-${musicId.slice(0, 8)}-eleven-music.${extension}`;
  const outputPath = path.join(musicDir, fileName);
  const audioBytes = Buffer.from(await response.arrayBuffer());
  await writeFile(outputPath, audioBytes);

  const audioDuration = Number((await probeDuration(outputPath)) || 0);
  const layerDuration = Math.min(sourceDuration || audioDuration || 3, audioDuration || sourceDuration || 3);
  const layer = normalizeFinishingLayer({
    id: `${musicId}-music-layer`,
    type: "audio",
    name: "ElevenLabs music bed",
    fileName,
    storedFileName: "",
    mimeType: contentType,
    localUrl: `/outputs/music/${fileName}`,
    enabled: true,
    startSeconds: 0,
    durationSeconds: layerDuration,
    sourceDurationSeconds: audioDuration,
    sourceFileSize: audioBytes.length,
    volume: clampNumber(brief.volume ?? 0.28, 0, 2),
    fadeInSeconds: 1,
    fadeOutSeconds: 1.25,
    createdAt: new Date().toISOString()
  });
  const output = {
    id: `${musicId}-music`,
    type: "music_bed",
    name: "ElevenLabs music bed",
    fileName,
    localUrl: `/outputs/music/${fileName}`,
    sourceFinalVideoId: sourceOutput.id || "",
    sourceFinalVideoName: sourceOutput.name || sourceOutput.fileName || "",
    description,
    tags,
    modelId: process.env.ELEVEN_MUSIC_MODEL_ID || "music_v1",
    outputFormat: outputFormat || "default",
    durationSeconds: audioDuration,
    createdAt: new Date().toISOString()
  };
  return { layer, output };
}

function audienceReactionProfile(kind, value) {
  const energy = Math.round(clampNumber(value ?? (kind === "applause" ? 60 : 55), 0, 100));
  const normalized = energy / 100;
  const high = energy >= 75;
  const low = energy <= 30;
  const medium = !high && !low;
  const label = high ? "high energy" : low ? "low energy" : "medium energy";
  const laugh = kind === "laugh";
  return {
    kind,
    energy,
    normalized,
    label,
    prompt:
      laugh
        ? high
          ? "Audience energy: high. Big responsive studio laughs, lively crowd texture, occasional delighted whoops, clean comedy timing, no applause and no spoken words."
          : low
            ? "Audience energy: low. Sparse natural chuckles, restrained audience response, intimate room feel, no applause and no spoken words."
            : "Audience energy: medium. Natural late-night studio laughs, warm chuckles, responsive but not overwhelming, no applause and no spoken words."
        : high
          ? "Audience energy: high. Strong enthusiastic applause, dense clapping, light cheering, celebratory room energy, no laughter and no spoken words."
          : low
            ? "Audience energy: low. Polite restrained applause, small studio audience, short clean claps, no laughter and no spoken words."
            : "Audience energy: medium. Warm studio applause, clean clapping, light crowd excitement, no laughter and no spoken words.",
    scoreThreshold: laugh ? 1.55 - normalized * 0.45 : 1.35 - normalized * 0.25,
    minCueDuration: laugh ? (low ? 0.55 : 0.75) : low ? 0.75 : 1,
    minSpacing: laugh ? Math.max(1.25, 2.6 - normalized * 1.1) : Math.max(3.5, 6.4 - normalized * 2.0),
    postLineDelay: laugh ? Math.max(0.04, 0.16 - normalized * 0.08) : Math.max(0.08, 0.2 - normalized * 0.08),
    fadeInSeconds: laugh ? (high ? 0.08 : medium ? 0.12 : 0.16) : high ? 0.12 : medium ? 0.18 : 0.24,
    fadeOutSeconds: laugh ? (high ? 0.42 : medium ? 0.35 : 0.28) : high ? 0.72 : medium ? 0.55 : 0.42
  };
}

function audienceReactionPrompt({ kind, description, profile }) {
  const base = String(description || "").replace(/\s+/g, " ").trim();
  const guardrails =
    kind === "laugh"
      ? "Generate only audience laughter and chuckles. Avoid applause, music, speech, words, narration, and sound logos."
      : "Generate only audience applause. Avoid laughter, music, speech, words, narration, and sound logos.";
  return [base, profile.prompt, guardrails].filter(Boolean).join(" ");
}

function audienceCueFadeOutSeconds(profile, durationSeconds, placement = null) {
  const duration = Math.max(0.1, Number(durationSeconds) || 0.1);
  const intensity = placement ? clampNumber(placement.intensity ?? 0.5, 0, 1) : 0.5;
  const baseFade = placement?.cueKind === "laugh" || profile.kind === "laugh"
    ? profile.fadeOutSeconds * (0.85 + intensity * 0.65)
    : profile.fadeOutSeconds;
  return roundSeconds(clampNumber(duration * 0.18, baseFade * 0.65, Math.max(baseFade, 1.2)));
}

async function generateElevenLaughTrackLayer({ episode, brief = {}, currentLayers = [] }) {
  const sourceOutput = latestFinalVideoOutput(episode);
  const sourcePath = outputFilePath(sourceOutput);
  if (!sourcePath) {
    throw new Error("Render the final video before generating a laugh track.");
  }

  const sourceDuration = Number(sourceOutput.durationSeconds || (await probeDuration(sourcePath)) || 0);
  const laughTrackId = randomUUID();
  const laughTrackDir = path.join(outputsDir, "laugh-tracks");
  await mkdir(laughTrackDir, { recursive: true });

  const outputFormat = String(process.env.ELEVEN_LAUGH_TRACK_OUTPUT_FORMAT || process.env.ELEVEN_SOUND_EFFECTS_OUTPUT_FORMAT || "").trim();
  const modelId =
    String(process.env.ELEVEN_LAUGH_TRACK_MODEL_ID || process.env.ELEVEN_SOUND_EFFECTS_MODEL_ID || "eleven_text_to_sound_v2").trim() ||
    "eleven_text_to_sound_v2";
  const url = new URL("https://api.elevenlabs.io/v1/sound-generation");
  if (outputFormat) url.searchParams.set("output_format", outputFormat);

  const energyProfile = audienceReactionProfile("laugh", brief.energy ?? 55);
  const description = compactText(
    audienceReactionPrompt({
      kind: "laugh",
      description:
        brief.description ||
        "Warm studio audience laugh track for a late-night comedy monologue: natural laughs, small chuckles, no words, no applause.",
      profile: energyProfile
    }),
    1000
  );
  const requestedDuration = clampNumber(brief.durationSeconds ?? Math.min(8, sourceDuration || 8), 0.5, 30);
  const promptInfluence = clampNumber(brief.promptInfluence ?? 0.35, 0, 1);
  const body = {
    text: description,
    duration_seconds: requestedDuration,
    prompt_influence: promptInfluence,
    model_id: modelId
  };
  if (Object.prototype.hasOwnProperty.call(brief, "loop")) {
    body.loop = Boolean(brief.loop);
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": elevenLabsApiKey,
      "Content-Type": "application/json",
      Accept: audioMimeTypeForElevenOutputFormat(outputFormat)
    },
    body: JSON.stringify(body),
    signal:
      typeof AbortSignal !== "undefined" && AbortSignal.timeout
        ? AbortSignal.timeout(Number(process.env.ELEVEN_LAUGH_TRACK_TIMEOUT_MS || process.env.ELEVEN_SOUND_EFFECTS_TIMEOUT_MS || 180000))
        : undefined
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`ElevenLabs sound effects returned ${response.status}${detail ? `: ${compactText(detail, 180)}` : ""}`);
  }

  const contentType = String(response.headers.get("content-type") || audioMimeTypeForElevenOutputFormat(outputFormat));
  const extension = extensionForGeneratedAudio({ contentType, outputFormat });
  const fileName = `${safeFileSegment(episode.title)}-${laughTrackId.slice(0, 8)}-eleven-laugh-track.${extension}`;
  const outputPath = path.join(laughTrackDir, fileName);
  const audioBytes = Buffer.from(await response.arrayBuffer());
  await writeFile(outputPath, audioBytes);

  const audioDuration = Number((await probeDuration(outputPath)) || 0);
  const autoPlace = brief.autoPlace !== false;
  const autoCueCount = brief.autoCueCount !== false;
  const maxCues = Math.round(clampNumber(brief.maxCues ?? 100, 1, 100));
  const cueDuration = clampNumber(
    brief.cueDurationSeconds ?? Math.min(2.4, audioDuration || requestedDuration),
    0.5,
    Math.max(0.5, audioDuration || requestedDuration)
  );
  const startNudgeSeconds = roundSeconds(clampNumber(brief.startNudgeSeconds ?? -0.1, -0.5, 1));
  const fallbackLayerDuration = Math.min(sourceDuration || audioDuration || requestedDuration, audioDuration || requestedDuration);
  const cueTimeline = autoPlace ? await laughTrackTimelineLinesForEpisode(episode) : { lines: [], totalSeconds: 0 };
  const currentCueExclusions = audienceCueExclusionsForGeneration({ episode, layers: currentLayers, kind: "laugh" });
  const productionCueExclusions = autoPlace ? productionMapAudienceCueExclusions(cueTimeline.lines, "laugh") : [];
  const cueExclusions = [...currentCueExclusions, ...productionCueExclusions];
  const forcedCueResult = autoPlace
    ? forcedAudienceCuePlacementsForLines({
        lines: cueTimeline.lines,
        totalDuration: sourceDuration || cueTimeline.totalSeconds,
        cueDuration,
        energy: energyProfile.energy,
        startNudgeSeconds,
        cueExclusions: currentCueExclusions
      })
    : { placements: [], warning: "" };
  const scriptPlacements = autoPlace
    ? await scriptCueDirectorPlacementsForEpisode({
        episode,
        kind: "laugh",
        baseDuration: sourceDuration,
        cueDuration,
        maxCues,
        energy: energyProfile.energy,
        autoCueCount,
        startNudgeSeconds,
        cueExclusions
      })
    : { placements: [], warning: "", source: "" };
  const directedPlacements = autoPlace && scriptPlacements.placements.length
    ? scriptPlacements
    : autoPlace && String(process.env.NEWTBUILDER_ALLOW_LAUGH_AUDIO_CUE_FALLBACK || "").toLowerCase() === "true"
      ? await audioCueDirectorPlacementsForEpisode({
        episode,
        kind: "laugh",
        baseDuration: sourceDuration,
        cueDuration,
        maxCues,
        energy: energyProfile.energy,
        autoCueCount,
        startNudgeSeconds,
        cueExclusions
      })
      : {
        placements: [],
        warning: scriptPlacements.warning || "Script cue director found no punchlines; no laugh cues were placed.",
        source: scriptPlacements.source || "openai-script-punchline-director"
      };
  const allowLaughHeuristicFallback =
    String(process.env.NEWTBUILDER_ALLOW_LAUGH_HEURISTIC_FALLBACK || "").toLowerCase() === "true" || !openAiApiKey;
  const placements = autoPlace && directedPlacements.placements.length
    ? directedPlacements.placements
    : autoPlace && allowLaughHeuristicFallback
      ? await laughTrackPlacementsForEpisode({
        episode,
        baseDuration: sourceDuration,
        cueDuration,
        maxCues,
        energy: energyProfile.energy,
        autoCueCount,
        startNudgeSeconds,
        cueExclusions
      })
    : [];
  const effectiveAutoPlacements = placements;
  const mergedPlacements = autoPlace
    ? mergeAudienceCuePlacements({
        forcedPlacements: forcedCueResult.placements,
        autoPlacements: effectiveAutoPlacements,
        maxCues
      })
    : placements;
  const placementSource = forcedCueResult.placements.length
    ? directedPlacements.placements.length
      ? `production-map-laugh-marker + ${directedPlacements.source}`
      : "production-map-laugh-marker"
    : directedPlacements.placements.length
    ? directedPlacements.source
    : autoPlace && allowLaughHeuristicFallback
      ? "script-heuristic"
      : directedPlacements.source || "openai-script-punchline-director";
  const placementWarning = [forcedCueResult.warning, directedPlacements.warning].filter(Boolean).join(" ");
  const effectivePlacements = mergedPlacements.length
    ? mergedPlacements
    : autoPlace
      ? []
      : [
        {
          startSeconds: 0,
          durationSeconds: fallbackLayerDuration,
          lineIndex: 0,
          reason: "Manual placement."
        }
      ];
  const layers = effectivePlacements.map((placement, index) =>
    normalizeFinishingLayer({
      id: `${laughTrackId}-laugh-track-layer-${index + 1}`,
      type: "audio",
      name: placement.lineIndex
        ? `ElevenLabs laugh track - line ${placement.lineIndex}`
        : "ElevenLabs laugh track",
      fileName,
      storedFileName: "",
      mimeType: contentType,
      localUrl: `/outputs/laugh-tracks/${fileName}`,
      cueKind: "laugh",
      cueLineId: placement.lineId || "",
      cueLineIndex: placement.lineIndex || 0,
      cueScore: placement.score || 0,
      cueReason: placement.reason || "",
      cueIntensity: placement.intensity || 0,
      cueConfidence: placement.confidence || 0,
      cueSource: placement.source || placementSource,
      cueStartNudgeSeconds: startNudgeSeconds,
      enabled: true,
      startSeconds: placement.startSeconds,
      durationSeconds: placement.durationSeconds,
      sourceDurationSeconds: audioDuration || requestedDuration,
      sourceFileSize: audioBytes.length,
      volume: audienceCueVolume(brief.volume ?? 0.22, placement, "laugh"),
      fadeInSeconds: audienceCueFadeInSeconds(energyProfile, placement),
      fadeOutSeconds: audienceCueFadeOutSeconds(energyProfile, placement.durationSeconds, placement),
      createdAt: new Date().toISOString()
    })
  );
  const output = {
    id: `${laughTrackId}-laugh-track`,
    type: "laugh_track",
    name: "ElevenLabs laugh track",
    fileName,
    localUrl: `/outputs/laugh-tracks/${fileName}`,
    sourceFinalVideoId: sourceOutput.id || "",
    sourceFinalVideoName: sourceOutput.name || sourceOutput.fileName || "",
    description,
    modelId,
    outputFormat: outputFormat || "default",
    durationSeconds: audioDuration || requestedDuration,
    promptInfluence,
    energy: energyProfile.energy,
    energyLabel: energyProfile.label,
    autoPlaced: autoPlace,
    autoCueCount,
    startNudgeSeconds,
    placementSource,
    placementWarning,
    excludedCueCount: cueExclusions.length,
    placements: effectivePlacements,
    createdAt: new Date().toISOString()
  };
  return { layer: layers[0] || null, layers, output };
}

async function generateElevenApplauseTrackLayer({ episode, brief = {}, currentLayers = [] }) {
  const sourceOutput = latestFinalVideoOutput(episode);
  const sourcePath = outputFilePath(sourceOutput);
  if (!sourcePath) {
    throw new Error("Render the final video before generating applause.");
  }

  const sourceDuration = Number(sourceOutput.durationSeconds || (await probeDuration(sourcePath)) || 0);
  const applauseTrackId = randomUUID();
  const applauseTrackDir = path.join(outputsDir, "applause-tracks");
  await mkdir(applauseTrackDir, { recursive: true });

  const outputFormat = String(process.env.ELEVEN_APPLAUSE_TRACK_OUTPUT_FORMAT || process.env.ELEVEN_SOUND_EFFECTS_OUTPUT_FORMAT || "").trim();
  const modelId =
    String(process.env.ELEVEN_APPLAUSE_TRACK_MODEL_ID || process.env.ELEVEN_SOUND_EFFECTS_MODEL_ID || "eleven_text_to_sound_v2").trim() ||
    "eleven_text_to_sound_v2";
  const url = new URL("https://api.elevenlabs.io/v1/sound-generation");
  if (outputFormat) url.searchParams.set("output_format", outputFormat);

  const energyProfile = audienceReactionProfile("applause", brief.energy ?? 60);
  const description = compactText(
    audienceReactionPrompt({
      kind: "applause",
      description:
        brief.description ||
        "Warm studio audience applause for a late-night show: clean clapping, light cheering, no laughter, no words, no music.",
      profile: energyProfile
    }),
    1000
  );
  const requestedDuration = clampNumber(brief.durationSeconds ?? Math.min(10, sourceDuration || 10), 0.5, 30);
  const promptInfluence = clampNumber(brief.promptInfluence ?? 0.35, 0, 1);
  const body = {
    text: description,
    duration_seconds: requestedDuration,
    prompt_influence: promptInfluence,
    model_id: modelId
  };
  if (Object.prototype.hasOwnProperty.call(brief, "loop")) {
    body.loop = Boolean(brief.loop);
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": elevenLabsApiKey,
      "Content-Type": "application/json",
      Accept: audioMimeTypeForElevenOutputFormat(outputFormat)
    },
    body: JSON.stringify(body),
    signal:
      typeof AbortSignal !== "undefined" && AbortSignal.timeout
        ? AbortSignal.timeout(Number(process.env.ELEVEN_APPLAUSE_TRACK_TIMEOUT_MS || process.env.ELEVEN_SOUND_EFFECTS_TIMEOUT_MS || 180000))
        : undefined
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`ElevenLabs sound effects returned ${response.status}${detail ? `: ${compactText(detail, 180)}` : ""}`);
  }

  const contentType = String(response.headers.get("content-type") || audioMimeTypeForElevenOutputFormat(outputFormat));
  const extension = extensionForGeneratedAudio({ contentType, outputFormat });
  const fileName = `${safeFileSegment(episode.title)}-${applauseTrackId.slice(0, 8)}-eleven-applause-track.${extension}`;
  const outputPath = path.join(applauseTrackDir, fileName);
  const audioBytes = Buffer.from(await response.arrayBuffer());
  await writeFile(outputPath, audioBytes);

  const audioDuration = Number((await probeDuration(outputPath)) || 0);
  const autoPlace = brief.autoPlace !== false;
  const autoCueCount = brief.autoCueCount !== false;
  const maxCues = Math.round(clampNumber(brief.maxCues ?? 12, 1, 100));
  const cueDuration = clampNumber(
    brief.cueDurationSeconds ?? Math.min(3.2, audioDuration || requestedDuration),
    0.5,
    Math.max(0.5, audioDuration || requestedDuration)
  );
  const fallbackLayerDuration = Math.min(sourceDuration || audioDuration || requestedDuration, audioDuration || requestedDuration);
  const cueExclusions = audienceCueExclusionsForGeneration({ episode, layers: currentLayers, kind: "applause" });
  const directedPlacements = autoPlace
    ? await audioCueDirectorPlacementsForEpisode({
        episode,
        kind: "applause",
        baseDuration: sourceDuration,
        cueDuration,
        maxCues,
        energy: energyProfile.energy,
        autoCueCount,
        cueExclusions
      })
    : { placements: [], warning: "", source: "" };
  const placements = autoPlace && directedPlacements.placements.length
    ? directedPlacements.placements
    : autoPlace
      ? await applauseTrackPlacementsForEpisode({
        episode,
        baseDuration: sourceDuration,
        cueDuration,
        maxCues,
        energy: energyProfile.energy,
        autoCueCount,
        cueExclusions
      })
    : [];
  const placementSource = directedPlacements.placements.length
    ? directedPlacements.source
    : autoPlace
      ? "script-heuristic"
      : "manual";
  const placementWarning = directedPlacements.warning || "";
  const effectivePlacements = placements.length
    ? placements
    : autoPlace
      ? []
      : [
        {
          startSeconds: 0,
          durationSeconds: fallbackLayerDuration,
          lineIndex: 0,
          reason: "Manual placement."
        }
      ];
  const layers = effectivePlacements.map((placement, index) =>
    normalizeFinishingLayer({
      id: `${applauseTrackId}-applause-track-layer-${index + 1}`,
      type: "audio",
      name: placement.lineIndex
        ? `ElevenLabs applause track - line ${placement.lineIndex}`
        : "ElevenLabs applause track",
      fileName,
      storedFileName: "",
      mimeType: contentType,
      localUrl: `/outputs/applause-tracks/${fileName}`,
      cueKind: "applause",
      cueLineId: placement.lineId || "",
      cueLineIndex: placement.lineIndex || 0,
      cueScore: placement.score || 0,
      cueReason: placement.reason || "",
      cueIntensity: placement.intensity || 0,
      cueConfidence: placement.confidence || 0,
      cueSource: placement.source || placementSource,
      enabled: true,
      startSeconds: placement.startSeconds,
      durationSeconds: placement.durationSeconds,
      sourceDurationSeconds: audioDuration || requestedDuration,
      sourceFileSize: audioBytes.length,
      volume: audienceCueVolume(brief.volume ?? 0.24, placement, "applause"),
      fadeInSeconds: audienceCueFadeInSeconds(energyProfile, placement),
      fadeOutSeconds: audienceCueFadeOutSeconds(energyProfile, placement.durationSeconds, placement),
      createdAt: new Date().toISOString()
    })
  );
  const output = {
    id: `${applauseTrackId}-applause-track`,
    type: "applause_track",
    name: "ElevenLabs applause track",
    fileName,
    localUrl: `/outputs/applause-tracks/${fileName}`,
    sourceFinalVideoId: sourceOutput.id || "",
    sourceFinalVideoName: sourceOutput.name || sourceOutput.fileName || "",
    description,
    modelId,
    outputFormat: outputFormat || "default",
    durationSeconds: audioDuration || requestedDuration,
    promptInfluence,
    energy: energyProfile.energy,
    energyLabel: energyProfile.label,
    autoPlaced: autoPlace,
    autoCueCount,
    placementSource,
    placementWarning,
    excludedCueCount: cueExclusions.length,
    placements: effectivePlacements,
    createdAt: new Date().toISOString()
  };
  return { layer: layers[0] || null, layers, output };
}

function audienceCueExclusionsForGeneration({ episode, layers = [], kind = "laugh" }) {
  const cueKind = kind === "applause" ? "applause" : "laugh";
  const exclusionsByKey = new Map();

  function addExclusion(source, cue, fallbackReason) {
    const normalized = {
      lineId: cleanId(cue?.cueLineId || cue?.lineId),
      lineIndex: Math.max(0, Math.round(Number(cue?.cueLineIndex ?? cue?.lineIndex) || 0)),
      startSeconds: roundSeconds(cue?.startSeconds),
      reason: fallbackReason
    };
    const keys = audienceCueKeys(normalized);
    for (const key of keys) {
      if (!exclusionsByKey.has(key)) {
        exclusionsByKey.set(key, {
          ...normalized,
          source,
          reason: fallbackReason
        });
      }
    }
  }

  for (const layer of normalizeFinishingLayers(layers)) {
    if (layer.cueKind !== cueKind) continue;
    addExclusion("timeline", layer, "already on timeline");
  }

  return [...exclusionsByKey.values()];
}

function audienceCueKeys(cue) {
  const keys = [];
  const lineId = cleanId(cue?.cueLineId || cue?.lineId);
  const lineIndex = Math.max(0, Math.round(Number(cue?.cueLineIndex ?? cue?.lineIndex) || 0));
  if (lineId) keys.push(`lineId:${lineId}`);
  if (lineIndex) keys.push(`lineIndex:${lineIndex}`);
  return keys;
}

function audienceCueExclusionKeySet(cueExclusions = []) {
  const keys = new Set();
  for (const cue of Array.isArray(cueExclusions) ? cueExclusions : []) {
    for (const key of audienceCueKeys(cue)) keys.add(key);
  }
  return keys;
}

function audienceCueIsExcluded(cue, exclusionKeys) {
  if (!exclusionKeys?.size) return false;
  return audienceCueKeys(cue).some((key) => exclusionKeys.has(key));
}

function audienceCueModeForLine(line, kind = "laugh") {
  if (kind !== "laugh") return "auto";
  return normalizeAudienceCue(line?.audienceCue).laugh;
}

function productionMapAudienceCueExclusions(lines = [], kind = "laugh") {
  const exclusions = [];
  for (const line of timelineDialogueLines(lines)) {
    const mode = audienceCueModeForLine(line, kind);
    if (mode === "auto") continue;
    exclusions.push({
      lineId: line.id || "",
      lineIndex: Number(line.index) || 0,
      startSeconds: roundSeconds(line.startSeconds),
      source: "production_map",
      reason: mode === "force" ? "handled by production-map laugh marker" : "blocked by production-map no-laugh marker"
    });
  }
  return exclusions;
}

function fittedAudienceCueForLine({ line, totalDuration, requestedCueDuration, profile, startNudgeSeconds = 0 }) {
  const lineStart = Number(line.audioStartSeconds ?? line.startSeconds ?? 0);
  const lineDuration = Number(line.durationSeconds || 0);
  const lineEnd = Number(line.audioEndSeconds ?? (lineStart + lineDuration));
  const startSeconds = roundSeconds(Math.max(0, lineEnd + profile.postLineDelay + clampNumber(startNudgeSeconds, -0.5, 1)));
  const endLimit = Number(totalDuration || 0);
  const availableSeconds = roundSeconds(endLimit - startSeconds);
  if (availableSeconds < Math.min(profile.minCueDuration, 0.25)) return null;
  return {
    startSeconds,
    durationSeconds: roundSeconds(Math.max(Math.min(requestedCueDuration, availableSeconds), Math.min(profile.minCueDuration, availableSeconds))),
    availableSeconds
  };
}

function forcedAudienceCuePlacementsForLines({ lines = [], totalDuration = 0, cueDuration = 2.4, energy = 55, startNudgeSeconds = 0, cueExclusions = [] }) {
  const profile = audienceReactionProfile("laugh", energy);
  const dialogueLines = timelineDialogueLines(lines);
  const exclusionKeys = audienceCueExclusionKeySet(cueExclusions);
  const requestedCueDuration = clampNumber(cueDuration, profile.minCueDuration, 30);
  const placements = [];
  const skipped = [];

  for (const line of dialogueLines) {
    const audienceCue = normalizeAudienceCue(line.audienceCue);
    if (audienceCue.laugh !== "force") continue;
    if (audienceCueIsExcluded({ lineId: line.id || "", lineIndex: Number(line.index) || 0 }, exclusionKeys)) continue;

    const lineStart = Number(line.audioStartSeconds ?? line.startSeconds ?? 0);
    const lineDuration = Number(line.durationSeconds || 0);
    const lineEnd = Number(line.audioEndSeconds ?? (lineStart + lineDuration));
    const offsetSeconds = Number.isFinite(audienceCue.offsetSeconds)
      ? audienceCue.offsetSeconds
      : profile.postLineDelay + clampNumber(startNudgeSeconds, -0.5, 1);
    const startSeconds = roundSeconds(Math.max(0, lineEnd + offsetSeconds));
    const availableSeconds = roundSeconds(Number(totalDuration || 0) - startSeconds);
    if (availableSeconds < Math.min(profile.minCueDuration, 0.25)) {
      skipped.push(Number(line.index) || 0);
      continue;
    }

    const intensity = Number.isFinite(audienceCue.intensity) ? audienceCue.intensity : Math.max(0.52, profile.normalized);
    const shapedDuration = audienceCue.durationSeconds || requestedCueDuration * (0.58 + intensity * 0.72);
    placements.push({
      startSeconds,
      durationSeconds: roundSeconds(clampNumber(shapedDuration, profile.minCueDuration, Math.min(availableSeconds, requestedCueDuration * 1.75))),
      lineId: line.id || "",
      lineIndex: Number(line.index) || 0,
      score: roundSeconds(profile.scoreThreshold + 1.2),
      confidence: 1,
      intensity,
      energy: profile.energy,
      energyLabel: profile.label,
      reason: compactText(String(line.text || "Production-map laugh marker.").trim(), 160),
      source: "production-map-laugh-marker"
    });
  }

  return {
    placements,
    warning: skipped.length
      ? `Production-map laugh marker could not fit after line${skipped.length === 1 ? "" : "s"} ${skipped.join(", ")}. Add tail time or shorten the cue.`
      : ""
  };
}

function mergeAudienceCuePlacements({ forcedPlacements = [], autoPlacements = [], maxCues = 100 }) {
  const selected = [];
  const keys = new Set();
  const addPlacement = (placement, force = false) => {
    if (!placement) return;
    const placementKeys = audienceCueKeys(placement);
    if (placementKeys.some((key) => keys.has(key))) return;
    if (!force && selected.length >= Math.max(0, Math.round(Number(maxCues) || 0))) return;
    selected.push(placement);
    for (const key of placementKeys) keys.add(key);
  };

  for (const placement of forcedPlacements) addPlacement(placement, true);
  for (const placement of autoPlacements) addPlacement(placement, false);
  return selected.sort((a, b) => a.startSeconds - b.startSeconds);
}

async function scriptCueDirectorPlacementsForEpisode({
  episode,
  kind = "laugh",
  baseDuration = 0,
  cueDuration = 2.4,
  maxCues = 100,
  energy = 55,
  autoCueCount = true,
  startNudgeSeconds = 0,
  cueExclusions = []
}) {
  const source = kind === "applause" ? "openai-script-applause-director" : "openai-script-punchline-director";
  if (!openAiApiKey || String(process.env.NEWTBUILDER_DISABLE_SCRIPT_CUE_DIRECTOR || "").toLowerCase() === "true") {
    return { placements: [], warning: "", source };
  }

  const timeline = await laughTrackTimelineLinesForEpisode(episode);
  const lines = timeline.lines;
  if (!lines.length) {
    return {
      placements: [],
      warning: "Script cue director skipped because no timed dialogue lines were found.",
      source
    };
  }

  const totalDuration = Number(baseDuration) || Number(timeline.totalSeconds) || 0;
  if (!totalDuration) {
    return {
      placements: [],
      warning: "Script cue director skipped because the final timeline duration could not be measured.",
      source
    };
  }

  try {
    const response = await runOpenAiScriptCueDirector({
      episode,
      kind,
      lines,
      totalDuration,
      cueDuration,
      maxCues,
      energy,
      autoCueCount,
      startNudgeSeconds,
      cueExclusions
    });
    const placements = validateAudioCueDirectorPlacements({
      response,
      lines,
      totalDuration,
      kind,
      cueDuration,
      maxCues,
      energy,
      source,
      startNudgeSeconds,
      cueExclusions
    });
    const expectedCueCount = Math.round(
      Number(response?.expectedCueCount ?? response?.expectedCount ?? response?.cueCount ?? response?.punchlineCount ?? 0)
    );
    const countWarning =
      expectedCueCount > 0 && placements.length !== Math.min(expectedCueCount, Math.round(clampNumber(maxCues, 1, 100)))
        ? `Script cue director found ${expectedCueCount} ${kind === "laugh" ? "punchline" : "applause"} cue${expectedCueCount === 1 ? "" : "s"} but ${placements.length} could be placed after timing and timeline exclusions.`
        : "";
    return {
      placements,
      warning: placements.length ? countWarning : "Script cue director returned no usable punchline placements; trying audio cue director.",
      source
    };
  } catch (error) {
    return {
      placements: [],
      warning: `Script cue director failed; trying audio cue director. ${cleanErrorMessage(error)}`,
      source
    };
  }
}

async function runOpenAiScriptCueDirector({
  episode,
  kind,
  lines,
  totalDuration,
  cueDuration,
  maxCues,
  energy,
  autoCueCount,
  startNudgeSeconds,
  cueExclusions = []
}) {
  const model =
    String(
      process.env.NEWTBUILDER_SCRIPT_CUE_DIRECTOR_MODEL ||
        process.env.NEWTBUILDER_CUE_DIRECTOR_TEXT_MODEL ||
        "gpt-4.1-mini"
    ).trim() || "gpt-4.1-mini";
  const prompt = scriptCueDirectorPrompt({
    episode,
    kind,
    lines,
    totalDuration,
    cueDuration,
    maxCues,
    energy,
    autoCueCount,
    startNudgeSeconds,
    cueExclusions
  });
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: prompt
            }
          ]
        }
      ],
      max_output_tokens: 2200
    }),
    signal:
      typeof AbortSignal !== "undefined" && AbortSignal.timeout
        ? AbortSignal.timeout(Number(process.env.NEWTBUILDER_SCRIPT_CUE_DIRECTOR_TIMEOUT_MS || 90000))
        : undefined
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`OpenAI script cue director returned ${response.status}${detail ? `: ${compactText(detail, 240)}` : ""}`);
  }

  const payload = await response.json();
  const parsed = parseResponseJsonObject(extractOpenAiResponseText(payload));
  if (!parsed || !Array.isArray(parsed.cues)) {
    throw new Error("OpenAI script cue director did not return a JSON object with a cues array.");
  }
  return parsed;
}

function scriptCueDirectorPrompt({ episode, kind, lines, totalDuration, cueDuration, maxCues, energy, autoCueCount, cueExclusions = [] }) {
  const profile = audienceReactionProfile(kind, energy);
  const dialogueLines = timelineDialogueLines(lines).map((line, index, allLines) => {
    const startSeconds = roundSeconds(line.startSeconds);
    const durationSeconds = roundSeconds(line.durationSeconds);
    const cueScoreLine = kind === "applause" ? applauseTrackLineScore : laughTrackLineScore;
    return {
      lineIndex: Number(line.index) || 0,
      lineId: line.id || "",
      speaker: compactText(line.speaker || line.character || "", 60),
      audioStartSeconds: roundSeconds(line.audioStartSeconds ?? startSeconds),
      audioEndSeconds: roundSeconds(line.audioEndSeconds ?? startSeconds + durationSeconds),
      previousText: compactText(line.previousText || "", 220),
      text: compactText(line.text || "", 420),
      nextText: compactText(line.nextText || "", 220),
      scriptCueScore: roundSeconds(cueScoreLine(line, index, allLines.length, allLines))
    };
  });
  const excludedCues = (Array.isArray(cueExclusions) ? cueExclusions : []).map((cue) => ({
    lineIndex: Number(cue.lineIndex) || 0,
    lineId: cue.lineId || "",
    reason: cue.reason || "already generated"
  }));
  const laughInstructions = [
    "Select EVERY line that functions as a punchline, button, tag, callback payoff, absurd reversal, escalation payoff, or joke-closing beat.",
    "A cue belongs on the payoff line, not the setup line before it.",
    "If a joke spans several short lines, select the final payoff line where the audience would laugh.",
    "Do not select topic headings, setup questions, exposition, transitions, or lines that merely continue the setup.",
    "For a late-night monologue, include dry/ironic punchlines and short deadpan buttons even if the wording is subtle.",
    "The audience laugh will be placed immediately after the selected line's audioEndSeconds by NewtBuilder."
  ];
  const applauseInstructions = [
    "Select applause-worthy lines only: greeting/opening, big reveal, segment transition, strong closing thanks, or celebratory declaration.",
    "Do not select ordinary jokes that should get laughter rather than applause.",
    "The applause will be placed immediately after the selected line's audioEndSeconds by NewtBuilder."
  ];

  return [
    "You are NewtBuilder's script punchline director for finishing-layer audience cues.",
    "Your job is line selection, not timestamp calculation.",
    "Return JSON only. Do not use markdown.",
    `Schema: {"expectedCueCount":0,"cues":[{"lineIndex":1,"lineId":"exact lineId from Timed dialogue lines JSON","quote":"short exact payoff quote","durationSeconds":1.2,"intensity":0.0,"confidence":0.0,"reason":"why this exact line is the payoff"}]}`,
    `Cue kind: ${kind}`,
    `Episode title: ${compactText(episode?.title || "Untitled Episode", 120)}`,
    `Energy setting: ${profile.label} (${profile.energy}/100)`,
    `Preferred cue duration seconds: ${roundSeconds(cueDuration)}`,
    `maxCues: ${Math.round(maxCues)}. This is only a safety cap. ${autoCueCount ? "For laughter, return every genuine punchline up to the cap. This is an exact count task, not a rough density estimate." : "Return up to maxCues, but skip weak cues."}`,
    "Do not choose excluded cue lines. Excluded cue lines are already visible on the current timeline or controlled by Production Map laugh markers.",
    "expectedCueCount must equal cues.length after exclusions.",
    "Copy lineId exactly from the selected Timed dialogue line. lineIndex must be the visible 1-based lineIndex field from that same object; do not zero-base or renumber.",
    "Do not return a conservative sample. Build the complete cue map: if the script has 10 punchlines, return exactly 10 cue objects.",
    ...(kind === "applause" ? applauseInstructions : laughInstructions),
    "Set confidence below 0.55 for weak or debatable candidates. Strong punchlines should be 0.78 or higher.",
    "Set intensity based on how big the audience response should be: 0.2 small chuckle, 0.5 normal laugh, 0.8 big laugh/applause.",
    `Total duration seconds: ${roundSeconds(totalDuration)}`,
    `Excluded cue lines JSON: ${JSON.stringify(excludedCues)}`,
    `Timed dialogue lines JSON: ${JSON.stringify(dialogueLines)}`
  ].join("\n");
}

async function audioCueDirectorPlacementsForEpisode({
  episode,
  kind = "laugh",
  baseDuration = 0,
  cueDuration = 2.4,
  maxCues = 12,
  energy = 55,
  autoCueCount = true,
  startNudgeSeconds = 0,
  cueExclusions = []
}) {
  const source = "openai-audio-cue-director";
  if (!openAiApiKey || String(process.env.NEWTBUILDER_DISABLE_CUE_DIRECTOR || "").toLowerCase() === "true") {
    return { placements: [], warning: "", source };
  }

  const audioOutput = latestFinalAudioOutput(episode);
  const audioPath = outputFilePath(audioOutput);
  if (!audioPath) {
    return {
      placements: [],
      warning: "Cue director skipped because the clean final audio mix was not found.",
      source
    };
  }

  const timeline = await laughTrackTimelineLinesForEpisode(episode);
  const lines = timeline.lines;
  if (!lines.length) {
    return {
      placements: [],
      warning: "Cue director skipped because no timed dialogue lines were found.",
      source
    };
  }

  const totalDuration =
    Number(baseDuration) ||
    Number(timeline.totalSeconds) ||
    Number(audioOutput?.durationSeconds) ||
    Number(await probeDuration(audioPath)) ||
    0;
  if (!totalDuration) {
    return {
      placements: [],
      warning: "Cue director skipped because the final timeline duration could not be measured.",
      source
    };
  }

  try {
    const response = await runOpenAiAudioCueDirector({
      episode,
      kind,
      audioPath,
      lines,
      totalDuration,
      cueDuration,
      maxCues,
      energy,
      autoCueCount,
      startNudgeSeconds,
      cueExclusions
    });
    const placements = validateAudioCueDirectorPlacements({
      response,
      lines,
      totalDuration,
      kind,
      cueDuration,
      maxCues,
      energy,
      source,
      startNudgeSeconds,
      cueExclusions
    });
    return {
      placements,
      warning: placements.length ? "" : "Cue director returned no usable cue placements; using script heuristic.",
      source
    };
  } catch (error) {
    return {
      placements: [],
      warning: `Cue director failed; using script heuristic. ${cleanErrorMessage(error)}`,
      source
    };
  }
}

async function runOpenAiAudioCueDirector({
  episode,
  kind,
  audioPath,
  lines,
  totalDuration,
  cueDuration,
  maxCues,
  energy,
  autoCueCount,
  startNudgeSeconds,
  cueExclusions = []
}) {
  const prepared = await prepareOpenAiCueDirectorAudio(audioPath);
  try {
    const audioStat = await stat(prepared.filePath);
    const maxBytes = Math.round(
      clampNumber(
        process.env.NEWTBUILDER_CUE_DIRECTOR_MAX_AUDIO_BYTES || 22 * 1024 * 1024,
        1024 * 1024,
        80 * 1024 * 1024
      )
    );
    if (audioStat.size > maxBytes) {
      throw new Error(`Cue director audio is too large after preparation (${Math.round(audioStat.size / 1024 / 1024)} MB).`);
    }

    const model =
      String(process.env.NEWTBUILDER_CUE_DIRECTOR_MODEL || process.env.OPENAI_CUE_DIRECTOR_MODEL || "gpt-audio-1.5").trim() ||
      "gpt-audio-1.5";
    const prompt = audioCueDirectorPrompt({
      episode,
      kind,
      lines,
      totalDuration,
      cueDuration,
      maxCues,
      energy,
      autoCueCount,
      cueExclusions
    });
    const audioBytes = await readFile(prepared.filePath);
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "input_audio",
                input_audio: {
                  data: audioBytes.toString("base64"),
                  format: prepared.format
                }
              }
            ]
          }
        ]
      }),
      signal:
        typeof AbortSignal !== "undefined" && AbortSignal.timeout
          ? AbortSignal.timeout(Number(process.env.NEWTBUILDER_CUE_DIRECTOR_TIMEOUT_MS || 180000))
          : undefined
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`OpenAI cue director returned ${response.status}${detail ? `: ${compactText(detail, 240)}` : ""}`);
    }

    const payload = await response.json();
    const text = extractOpenAiChatResponseText(payload);
    const parsed = parseResponseJsonObject(text);
    if (!parsed || !Array.isArray(parsed.cues)) {
      throw new Error("OpenAI cue director did not return a JSON object with a cues array.");
    }
    return parsed;
  } finally {
    if (prepared.cleanupDir) {
      await rm(prepared.cleanupDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function prepareOpenAiCueDirectorAudio(audioPath) {
  const tempDir = path.join(outputsDir, "tmp", `cue-director-${randomUUID()}`);
  const preparedPath = path.join(tempDir, "final-audio-director.mp3");
  await mkdir(tempDir, { recursive: true });
  try {
    await execFileAsync(
      ffmpegPath,
      [
        "-y",
        "-i",
        audioPath,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-b:a",
        "64k",
        preparedPath
      ],
      { timeout: 180000, maxBuffer: 20 * 1024 * 1024 }
    );
    return { filePath: preparedPath, format: "mp3", cleanupDir: tempDir };
  } catch {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    const ext = path.extname(audioPath).toLowerCase().replace(".", "");
    return {
      filePath: audioPath,
      format: ext === "mp3" ? "mp3" : "wav",
      cleanupDir: ""
    };
  }
}

function audioCueDirectorPrompt({ episode, kind, lines, totalDuration, cueDuration, maxCues, energy, autoCueCount, cueExclusions = [] }) {
  const profile = audienceReactionProfile(kind, energy);
  const scoredDialogueLines = timelineDialogueLines(lines);
  const cueScoreLine = kind === "applause" ? applauseTrackLineScore : laughTrackLineScore;
  const dialogueLines = scoredDialogueLines.map((line, index) => {
    const startSeconds = roundSeconds(line.startSeconds);
    const durationSeconds = roundSeconds(line.durationSeconds);
    const audioStartSeconds = roundSeconds(line.audioStartSeconds ?? startSeconds);
    const audioEndSeconds = roundSeconds(line.audioEndSeconds ?? startSeconds + durationSeconds);
    return {
      lineIndex: Number(line.index) || 0,
      lineId: line.id || "",
      speaker: compactText(line.speaker || line.character || "", 60),
      startSeconds,
      endSeconds: roundSeconds(startSeconds + durationSeconds),
      audioStartSeconds,
      audioEndSeconds,
      durationSeconds,
      visualStartSeconds: roundSeconds(line.visualStartSeconds ?? startSeconds),
      visualEndSeconds: roundSeconds(line.visualEndSeconds ?? startSeconds + durationSeconds),
      visualStartFrame: Math.max(0, Math.round(Number(line.visualStartFrame) || 0)),
      visualEndFrame: Math.max(0, Math.round(Number(line.visualEndFrame) || 0)),
      framesPerSecond: Math.max(1, Math.round(Number(line.framesPerSecond) || 30)),
      sourceTrimStartSeconds: roundSeconds(line.sourceTrimStartSeconds || 0),
      sourceTrimEndSeconds: roundSeconds(line.sourceTrimEndSeconds || 0),
      assemblyCutStartFrames: Math.max(0, Math.round(Number(line.assemblyCutStartFrames) || 0)),
      assemblyCutEndFrames: Math.max(0, Math.round(Number(line.assemblyCutEndFrames) || 0)),
      scriptCueScore: roundSeconds(cueScoreLine(line, index, scoredDialogueLines.length, scoredDialogueLines)),
      text: compactText(line.text || "", 320)
    };
  });
  const cueLabel = kind === "laugh" ? "audience laughter" : "audience applause";
  const excludedCues = (Array.isArray(cueExclusions) ? cueExclusions : []).map((cue) => ({
    lineIndex: Number(cue.lineIndex) || 0,
    lineId: cue.lineId || "",
    startSeconds: roundSeconds(cue.startSeconds || 0),
    reason: cue.reason || "already generated"
  }));
  const selectionGuidance =
    kind === "laugh"
      ? [
          "For laughter, choose only real punchlines, tags, absurd reversals, callbacks, or clearly funny payoffs.",
          "Avoid setup lines, topic-introduction lines, exposition, and lines that merely continue a sentence.",
          "The start time is the most important choice: begin immediately after the punchline lands, usually 0.04 to 0.35 seconds after that line ends."
        ]
      : [
          "For applause, choose only true show applause moments: greeting/opening, segment transitions, reveals, strong closing thanks, or applause-worthy declarations.",
          "Avoid placing applause on ordinary jokes unless the audience would naturally clap rather than laugh.",
          "The start time should be just after the applause-worthy phrase lands, usually 0.08 to 0.45 seconds after that line ends."
        ];

  return [
    "You are NewtBuilder's first-pass cue director for a finished late-night style episode.",
    "Analyze the attached clean final VO/audio mix together with the exact script timing JSON.",
    `Your job is to choose where generated ${cueLabel} clips should begin, how long they should last, and how strong each cue should be.`,
    "Return JSON only. Do not use markdown.",
    `Schema: {"cues":[{"lineIndex":1,"lineId":"optional","startSeconds":0.0,"durationSeconds":1.2,"intensity":0.0,"confidence":0.0,"reason":"short reason"}]}`,
    `The maxCues value is a hard ceiling, not a target. ${autoCueCount ? "Infer the natural cue count from the episode." : "Use up to maxCues, but still skip weak cues."}`,
    "Do not choose excluded cues. Excluded cues are already on the timeline or controlled by Production Map laugh markers.",
    "scriptCueScore is a rough helper from the script. Prefer high scores when the audio performance agrees, but do not use low-confidence moments just to fill the cap.",
    "Use audioEndSeconds as the payoff landing point for timing. The visual fields describe the already-assembled video after source frames were trimmed/padded.",
    "If assemblyCutStartFrames or assemblyCutEndFrames are nonzero, account for the fact that those source frames are not visible in the final assembled video.",
    "It is acceptable for a cue to overlap the next spoken line after it starts. Do not wait for silence if that makes the cue late.",
    "Never start a cue before the selected line's payoff has landed.",
    "Use intensity from 0.0 to 1.0. Use confidence from 0.0 to 1.0. Prefer fewer high-confidence cues over many questionable cues.",
    ...selectionGuidance,
    `Episode title: ${compactText(episode?.title || "Untitled Episode", 120)}`,
    `Cue kind: ${kind}`,
    `Energy setting: ${profile.label} (${profile.energy}/100)`,
    `Total duration seconds: ${roundSeconds(totalDuration)}`,
    `Preferred individual cue duration seconds: ${roundSeconds(cueDuration)}`,
    `maxCues: ${Math.round(maxCues)}`,
    `Excluded cue lines JSON: ${JSON.stringify(excludedCues)}`,
    `Timed dialogue lines JSON: ${JSON.stringify(dialogueLines)}`
  ].join("\n");
}

const cueLineMatchStopwords = new Set([
  "about",
  "after",
  "again",
  "already",
  "because",
  "being",
  "could",
  "exact",
  "from",
  "have",
  "into",
  "line",
  "only",
  "payoff",
  "punchline",
  "reason",
  "should",
  "that",
  "their",
  "there",
  "these",
  "this",
  "where",
  "which",
  "with",
  "would"
]);

function cueLineMatchTokens(text = "") {
  return String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .map((token) => token.replace(/^'+|'+$/g, ""))
    .filter((token) => token.length >= 4 && !cueLineMatchStopwords.has(token));
}

function cueLineMatchScore(cue, line) {
  const cueText = [
    cue?.quote,
    cue?.lineText,
    cue?.text,
    cue?.punchline,
    cue?.reason
  ]
    .filter(Boolean)
    .join(" ");
  const cueTokens = cueLineMatchTokens(cueText);
  if (!cueTokens.length) return 0;
  const lineTokens = new Set(cueLineMatchTokens(line?.text || ""));
  if (!lineTokens.size) return 0;
  const uniqueCueTokens = [...new Set(cueTokens)];
  const matches = uniqueCueTokens.filter((token) => lineTokens.has(token)).length;
  return matches / uniqueCueTokens.length;
}

function resolveCueDirectorLine({ cue, byId, byIndex, scriptDirectorSource = false }) {
  const lineId = String(cue?.lineId || cue?.id || "").trim();
  if (!scriptDirectorSource && lineId && byId.has(lineId)) {
    return byId.get(lineId);
  }

  const lineIndex = Math.round(Number(cue?.lineIndex ?? cue?.lineNumber ?? cue?.index ?? 0));
  const candidateIndexes = scriptDirectorSource
    ? [lineIndex, lineIndex + 1, lineIndex - 1, lineIndex + 2, lineIndex - 2]
    : [lineIndex];
  const candidates = [];
  const idLine = lineId ? byId.get(lineId) : null;
  if (idLine) {
    candidates.push({
      line: idLine,
      matchScore: cueLineMatchScore(cue, idLine),
      indexDistance: Math.abs((Number(idLine.index) || lineIndex) - lineIndex),
      idMatch: true
    });
  }
  for (const index of candidateIndexes) {
    const line = byIndex.get(index);
    if (line && !candidates.some((candidate) => candidate.line === line)) {
      candidates.push({
        line,
        matchScore: cueLineMatchScore(cue, line),
        indexDistance: Math.abs(index - lineIndex),
        idMatch: Boolean(lineId && String(line.id || "") === lineId)
      });
    }
  }
  if (!candidates.length) return null;

  const best = candidates.sort(
    (a, b) =>
      b.matchScore - a.matchScore ||
      Number(b.idMatch) - Number(a.idMatch) ||
      a.indexDistance - b.indexDistance ||
      Number(a.line.startSeconds || 0) - Number(b.line.startSeconds || 0)
  )[0];
  const direct = candidates.find((candidate) => Number(candidate.line.index) === lineIndex);
  if (!scriptDirectorSource || !direct) return best.line;
  if (best.matchScore > 0 && direct.matchScore <= 0 && !best.idMatch) return best.line;
  return best.matchScore >= Math.max(0.34, direct.matchScore + 0.18) ? best.line : direct.line;
}

function validateAudioCueDirectorPlacements({
  response,
  lines,
  totalDuration,
  kind,
  cueDuration,
  maxCues,
  energy,
  source,
  startNudgeSeconds = 0,
  cueExclusions = []
}) {
  const profile = audienceReactionProfile(kind, energy);
  const scriptDirectorSource = String(source || "").includes("script-");
  const dialogueLines = timelineDialogueLines(lines);
  const byIndex = new Map(dialogueLines.map((line) => [Number(line.index) || 0, line]));
  const byId = new Map(dialogueLines.map((line) => [String(line.id || ""), line]).filter(([id]) => id));
  const exclusionKeys = audienceCueExclusionKeySet(cueExclusions);
  const requestedCueDuration = clampNumber(cueDuration, profile.minCueDuration, 30);
  const cap = Math.round(clampNumber(maxCues, 1, 100));
  const minConfidence = boundedEnvNumber(
    kind === "laugh" ? "NEWTBUILDER_CUE_DIRECTOR_LAUGH_MIN_CONFIDENCE" : "NEWTBUILDER_CUE_DIRECTOR_APPLAUSE_MIN_CONFIDENCE",
    scriptDirectorSource ? (kind === "laugh" ? 0.5 : 0.55) : kind === "laugh" ? 0.58 : 0.55,
    0,
    1
  );
  const rawCues = Array.isArray(response?.cues) ? response.cues : [];
  const candidates = rawCues
    .map((cue) => {
      const lineIndex = Math.round(Number(cue?.lineIndex ?? cue?.lineNumber ?? cue?.index ?? 0));
      const line = resolveCueDirectorLine({ cue, byId, byIndex, scriptDirectorSource });
      if (!line) return null;
      if (audienceCueIsExcluded({ lineId: line.id || "", lineIndex: Number(line.index) || lineIndex }, exclusionKeys)) return null;

      const confidence = clampNumber(
        Number.isFinite(Number(cue?.confidence)) ? Number(cue.confidence) : 0.7,
        0,
        1
      );
      if (confidence < minConfidence) return null;
      const cueScoreLine = kind === "applause" ? applauseTrackLineScore : laughTrackLineScore;
      const scriptScore = cueScoreLine(line, Number(line.timelineIndex) || 0, dialogueLines.length, dialogueLines);
      const scriptFloor = profile.scoreThreshold - (kind === "laugh" ? 0.55 : 0.35);
      if (!scriptDirectorSource && scriptScore < scriptFloor && confidence < 0.86) return null;

      const intensity = clampNumber(
        Number.isFinite(Number(cue?.intensity ?? cue?.strength)) ? Number(cue?.intensity ?? cue?.strength) : confidence,
        0,
        1
      );
      const lineStart = Number(line.audioStartSeconds ?? line.startSeconds ?? 0);
      const lineEnd = Number(line.audioEndSeconds ?? (lineStart + Number(line.durationSeconds || 0)));
      const startNudge = clampNumber(startNudgeSeconds, -0.5, 1);
      const targetDelay = profile.postLineDelay + startNudge;
      const earliestStart = roundSeconds(Math.max(0, lineEnd + Math.min(targetDelay, 0.04)));
      const useModelStart = String(process.env.NEWTBUILDER_CUE_DIRECTOR_USE_MODEL_START || "").toLowerCase() === "true";
      const rawStart = Number(cue?.startSeconds);
      let startSeconds = lineEnd + targetDelay;
      if (useModelStart && Number.isFinite(rawStart)) {
        const latestReasonableStart = roundSeconds(lineEnd + (kind === "laugh" ? 0.75 : 1.1) + Math.max(0, startNudge));
        startSeconds = rawStart < earliestStart || rawStart > latestReasonableStart ? startSeconds : rawStart;
      }
      const latestStart = Math.max(earliestStart, Number(totalDuration || 0) - 0.1);
      startSeconds = roundSeconds(clampNumber(startSeconds, earliestStart, latestStart));

      const availableSeconds = roundSeconds(Number(totalDuration || 0) - startSeconds);
      if (availableSeconds < Math.min(profile.minCueDuration, 0.25)) return null;

      const rawDuration = Number(cue?.durationSeconds ?? cue?.lengthSeconds);
      const shapedDuration = requestedCueDuration * (kind === "laugh" ? 0.58 + intensity * 0.72 : 0.72 + intensity * 0.55);
      const maxDuration = Math.max(
        profile.minCueDuration,
        Math.min(availableSeconds, requestedCueDuration * (kind === "laugh" ? 1.75 : 1.6))
      );
      const durationSeconds = roundSeconds(
        clampNumber(Number.isFinite(rawDuration) ? rawDuration : shapedDuration, profile.minCueDuration, maxDuration)
      );

      return {
        startSeconds,
        durationSeconds,
        lineId: line.id || "",
        lineIndex: Number(line.index) || 0,
        score: roundSeconds(profile.scoreThreshold + confidence * 1.25),
        confidence,
        intensity,
        energy: profile.energy,
        energyLabel: profile.label,
        reason: compactText(String(cue?.reason || line.text || "").trim(), 160),
        source
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.confidence - a.confidence || b.intensity - a.intensity || a.startSeconds - b.startSeconds);

  const minSpacing = scriptDirectorSource
    ? kind === "laugh"
      ? 0.35
      : 1.2
    : kind === "laugh"
      ? Math.min(profile.minSpacing, 1.15)
      : Math.min(profile.minSpacing, 2.75);
  const selected = [];
  for (const candidate of candidates) {
    if (selected.some((placement) => placement.lineIndex === candidate.lineIndex)) continue;
    if (selected.some((placement) => Math.abs(placement.startSeconds - candidate.startSeconds) < minSpacing)) continue;
    selected.push(candidate);
    if (selected.length >= cap) break;
  }

  return selected.sort((a, b) => a.startSeconds - b.startSeconds);
}

async function laughTrackPlacementsForEpisode({ episode, baseDuration = 0, cueDuration = 2.4, maxCues = 12, energy = 55, autoCueCount = true, startNudgeSeconds = 0, cueExclusions = [] }) {
  const timeline = await laughTrackTimelineLinesForEpisode(episode);
  const lines = timeline.lines;
  if (!lines.length) return [];
  const totalDuration = Number(baseDuration) || Number(timeline.totalSeconds) || 0;
  return selectLaughTrackPlacements({
    lines,
    baseDuration: totalDuration,
    cueDuration,
    maxCues,
    energy,
    autoCueCount,
    startNudgeSeconds,
    cueExclusions
  });
}

async function applauseTrackPlacementsForEpisode({ episode, baseDuration = 0, cueDuration = 3.2, maxCues = 12, energy = 60, autoCueCount = true, cueExclusions = [] }) {
  const timeline = await laughTrackTimelineLinesForEpisode(episode);
  const lines = timeline.lines;
  if (!lines.length) return [];
  const totalDuration = Number(baseDuration) || Number(timeline.totalSeconds) || 0;
  return selectApplauseTrackPlacements({
    lines,
    baseDuration: totalDuration,
    cueDuration,
    maxCues,
    energy,
    autoCueCount,
    cueExclusions
  });
}

async function laughTrackTimelineLinesForEpisode(episode) {
  const manifestOutputs = (Array.isArray(episode.outputs) ? episode.outputs : [])
    .filter((output) => output.type === "final_render_manifest" && outputFilePath(output))
    .sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""));

  for (const output of manifestOutputs) {
    const manifest = await readJson(outputFilePath(output), null);
    const lines = Array.isArray(manifest?.lines) ? manifest.lines : [];
    if (lines.length) {
      const assemblyTiming = assemblyTimingForManifestLines(manifest);
      return {
        source: "final_render_manifest",
        totalSeconds: Number(manifest.totalSeconds || manifest.video?.durationSeconds || 0),
        lines: lines.map((line, index) => {
          const timing = assemblyTiming.get(line.id || `line-${index + 1}`) || {};
          return {
            id: line.id || `line-${index + 1}`,
            index: Number(line.index) || index + 1,
            lineType: sanitizeLineType(line.lineType),
            speaker: String(line.speaker || "").trim(),
            character: String(line.character || "").trim(),
            text: String(line.text || "").trim(),
            audienceCue: normalizeAudienceCue(line.audienceCue),
            startSeconds: Math.max(0, roundSeconds(line.startSeconds)),
            durationSeconds: Math.max(0.35, roundSeconds(line.durationSeconds || 0.35)),
            ...timing
          };
        })
      };
    }
  }

  let cursor = 0;
  const fallbackLines = normalizeProductionMapForFormat(episode.productionMap, episode.format).map((line, index) => {
    const durationSeconds = Math.max(0.35, Number(line.audioTake?.durationSeconds || line.estimatedSeconds || 2));
    const startSeconds = cursor;
    cursor += durationSeconds;
    return {
      id: line.id || `line-${index + 1}`,
      index: Number(line.index) || index + 1,
      lineType: line.lineType,
      speaker: String(line.speaker || "").trim(),
      character: String(line.character || "").trim(),
      text: line.text,
      audienceCue: normalizeAudienceCue(line.audienceCue),
      startSeconds: roundSeconds(startSeconds),
      durationSeconds: roundSeconds(durationSeconds)
    };
  });

  return {
    source: "production_map",
    totalSeconds: roundSeconds(cursor),
    lines: fallbackLines
  };
}

function assemblyTimingForManifestLines(manifest) {
  const lines = Array.isArray(manifest?.lines) ? manifest.lines : [];
  const fps = Number(manifest?.format?.fps || 30);
  const frameDuration = fps > 0 ? 1 / fps : 1 / 30;
  const mediaLines = lines.filter((line) => line.videoTake || line.image || line.videoPath || line.imagePath || line.image?.localUrl);
  const timing = new Map();
  let visualCursor = 0;

  mediaLines.forEach((line, index) => {
    const durationSeconds = Math.max(0.35, Number(line.durationSeconds) || 0.35);
    const tailHoldSeconds = index === mediaLines.length - 1 ? 0.35 : 0;
    const visualSegmentDurationSeconds = roundSeconds(durationSeconds + tailHoldSeconds);
    const sourceDurationSeconds = Number(line.videoTake?.durationSeconds || 0);
    const sourceTrimStartSeconds = line.lineType === "insert" ? insertVideoInPoint(line) : 0;
    const sourceTrimEndSeconds = sourceDurationSeconds
      ? Math.max(sourceTrimStartSeconds, sourceTrimStartSeconds + visualSegmentDurationSeconds)
      : 0;
    const audioStartSeconds = Math.max(0, roundSeconds(line.startSeconds));
    const audioEndSeconds = roundSeconds(audioStartSeconds + durationSeconds);
    const visualStartSeconds = roundSeconds(visualCursor);
    const visualEndSeconds = roundSeconds(visualCursor + visualSegmentDurationSeconds);
    const startFrame = Math.max(0, Math.round(visualStartSeconds / frameDuration));
    const endFrame = Math.max(startFrame, Math.round(visualEndSeconds / frameDuration));
    timing.set(line.id || `line-${index + 1}`, {
      audioStartSeconds,
      audioEndSeconds,
      visualStartSeconds,
      visualEndSeconds,
      visualSegmentDurationSeconds,
      sourceTrimStartSeconds: roundSeconds(sourceTrimStartSeconds),
      sourceTrimEndSeconds: roundSeconds(sourceTrimEndSeconds),
      sourceDurationSeconds: roundSeconds(sourceDurationSeconds),
      framesPerSecond: fps,
      visualStartFrame: startFrame,
      visualEndFrame: endFrame,
      assemblyCutStartFrames: Math.max(0, Math.round(sourceTrimStartSeconds * fps)),
      assemblyCutEndFrames: sourceDurationSeconds
        ? Math.max(0, Math.round((sourceDurationSeconds - sourceTrimStartSeconds - visualSegmentDurationSeconds) * fps))
        : 0
    });
    visualCursor += visualSegmentDurationSeconds;
  });

  return timing;
}

function timelineDialogueLines(lines = []) {
  const sortedLines = (Array.isArray(lines) ? lines : [])
    .filter((line) => line.lineType !== "insert" && String(line.text || "").trim())
    .map((line, index) => ({
      ...line,
      sequenceIndex: index,
      startSeconds: Math.max(0, Number(line.startSeconds || 0)),
      durationSeconds: Math.max(0.1, Number(line.durationSeconds || 0.1))
    }))
    .sort((a, b) => a.startSeconds - b.startSeconds || a.sequenceIndex - b.sequenceIndex);

  return sortedLines.map((line, index) => ({
      ...line,
      timelineIndex: index,
      wordCount: audienceCueWordCount(line.text),
      wordsPerSecond: roundSeconds(audienceCueWordCount(line.text) / Math.max(0.1, Number(line.durationSeconds || 0.1))),
      nextGapSeconds: roundSeconds(
        index < sortedLines.length - 1
          ? Math.max(
              0,
              Number(sortedLines[index + 1].startSeconds || 0) -
                (Number(line.startSeconds || 0) + Number(line.durationSeconds || 0))
            )
          : 0
      ),
      previousGapSeconds: roundSeconds(
        index > 0
          ? Math.max(
              0,
              Number(line.startSeconds || 0) -
                (Number(sortedLines[index - 1].startSeconds || 0) + Number(sortedLines[index - 1].durationSeconds || 0))
            )
          : 0
      ),
      previousText: index > 0 ? String(sortedLines[index - 1].text || "") : "",
      nextText: index < sortedLines.length - 1 ? String(sortedLines[index + 1].text || "") : ""
    }));
}

function audienceCueIntensity({ score, profile }) {
  const floor = profile.scoreThreshold - 0.55;
  const ceiling = profile.scoreThreshold + 1.45;
  return roundSeconds(clampNumber((Number(score) - floor) / Math.max(0.1, ceiling - floor), 0.18, 1));
}

function audienceCueDuration({ requestedCueDuration, availableSeconds, profile, score }) {
  const intensity = audienceCueIntensity({ score, profile });
  const requested = Math.max(profile.minCueDuration, Number(requestedCueDuration) || profile.minCueDuration);
  const shaped = requested * (0.48 + intensity * 0.72);
  return roundSeconds(clampNumber(shaped, profile.minCueDuration, Math.min(availableSeconds, requested * 1.25)));
}

function audienceCueVolume(baseVolume, placement, kind = "laugh") {
  const base = clampNumber(baseVolume, 0, 2);
  const intensity = clampNumber(placement?.intensity ?? 0.5, 0, 1);
  const multiplier = kind === "applause" ? 0.78 + intensity * 0.38 : 0.72 + intensity * 0.5;
  return roundSeconds(clampNumber(base * multiplier, 0, 2));
}

function audienceCueFadeInSeconds(profile, placement) {
  const intensity = clampNumber(placement?.intensity ?? 0.5, 0, 1);
  return roundSeconds(clampNumber(profile.fadeInSeconds * (1.2 - intensity * 0.45), 0.04, 0.25));
}

function selectAudienceReactionPlacements({
  lines = [],
  baseDuration = 0,
  cueDuration = 2.4,
  maxCues = 4,
  energy = 55,
  kind = "laugh",
  scoreLine,
  autoCueCount = false,
  startNudgeSeconds = 0,
  cueExclusions = []
}) {
  const profile = audienceReactionProfile(kind, energy);
  const totalDuration =
    Number(baseDuration) ||
    Math.max(0, ...((Array.isArray(lines) ? lines : []).map((line) => Number(line.startSeconds || 0) + Number(line.durationSeconds || 0))));
  const dialogueLines = timelineDialogueLines(lines);
  if (!dialogueLines.length) return [];

  if (!Number.isFinite(totalDuration) || totalDuration <= 0) return [];

  const requestedCueDuration = clampNumber(cueDuration, profile.minCueDuration, 30);
  const requestedMaxCues = Math.round(clampNumber(maxCues, 1, 100));
  const minSpacing = profile.minSpacing;
  const exclusionKeys = audienceCueExclusionKeySet(cueExclusions);
  const scored = dialogueLines
    .filter((line) => !audienceCueIsExcluded({ lineId: line.id || "", lineIndex: Number(line.index) || 0 }, exclusionKeys))
    .map((line, index) => ({
      line,
      score: scoreLine(line, index, dialogueLines.length, dialogueLines)
    }))
    .sort((a, b) => b.score - a.score || Number(a.line.startSeconds || 0) - Number(b.line.startSeconds || 0));
  const scoreFloor = kind === "laugh" ? profile.scoreThreshold - 0.45 : profile.scoreThreshold;
  const strongPool = scored.filter((item) => item.score >= profile.scoreThreshold);
  const backupPool = scored.filter((item) => item.score < profile.scoreThreshold && item.score >= scoreFloor);
  const targetCueCount = autoCueCount
    ? estimateAudienceCueTarget({ kind, scored, profile, maxCues: requestedMaxCues, lineCount: dialogueLines.length })
    : requestedMaxCues;
  const candidates = strongPool.length
    ? [...strongPool, ...backupPool].slice(0, Math.max(targetCueCount * 3, targetCueCount))
    : scored.slice(0, Math.min(targetCueCount, scored.length));
  const selected = [];

  for (const candidate of candidates) {
    const cue = fittedAudienceCueForLine({
      line: candidate.line,
      totalDuration,
      requestedCueDuration,
      profile,
      startNudgeSeconds
    });
    if (!cue) continue;
    if (selected.some((placement) => Math.abs(placement.startSeconds - cue.startSeconds) < minSpacing)) continue;
    selected.push({
      startSeconds: cue.startSeconds,
      durationSeconds:
        kind === "laugh"
          ? audienceCueDuration({
              requestedCueDuration,
              availableSeconds: cue.availableSeconds,
              profile,
              score: candidate.score
            })
          : cue.durationSeconds,
      lineId: candidate.line.id || "",
      lineIndex: Number(candidate.line.index) || 0,
      score: roundSeconds(candidate.score),
      intensity: kind === "laugh" ? audienceCueIntensity({ score: candidate.score, profile }) : profile.normalized,
      energy: profile.energy,
      energyLabel: profile.label,
      reason: compactText(String(candidate.line.text || "").trim(), 120)
    });
    if (selected.length >= targetCueCount) break;
  }

  return selected.sort((a, b) => a.startSeconds - b.startSeconds);
}

function selectLaughTrackPlacements({ lines = [], baseDuration = 0, cueDuration = 2.4, maxCues = 12, energy = 55, autoCueCount = true, startNudgeSeconds = 0, cueExclusions = [] }) {
  return selectAudienceReactionPlacements({
    lines,
    baseDuration,
    cueDuration,
    maxCues,
    energy,
    kind: "laugh",
    scoreLine: laughTrackLineScore,
    autoCueCount,
    startNudgeSeconds,
    cueExclusions
  });
}

function selectApplauseTrackPlacements({ lines = [], baseDuration = 0, cueDuration = 3.2, maxCues = 12, energy = 60, autoCueCount = true, cueExclusions = [] }) {
  return selectAudienceReactionPlacements({
    lines,
    baseDuration,
    cueDuration,
    maxCues,
    energy,
    kind: "applause",
    scoreLine: applauseTrackLineScore,
    autoCueCount,
    cueExclusions
  });
}

function estimateAudienceCueTarget({ kind = "laugh", scored = [], profile, maxCues = 12, lineCount = 0 }) {
  const cap = Math.max(1, Math.round(Number(maxCues) || 1));
  const strongCount = scored.filter((item) => item.score >= profile.scoreThreshold).length;
  const goodCount = scored.filter((item) => item.score >= profile.scoreThreshold - 0.25 && item.score < profile.scoreThreshold).length;
  const possibleCount = scored.filter((item) => item.score >= profile.scoreThreshold - 0.55).length;
  const densityDivisor = kind === "applause" ? 7 : 3.5;
  const densityCap = Math.max(1, Math.round((Number(lineCount) || scored.length || 1) / densityDivisor));
  const scriptEstimate = Math.round(strongCount + goodCount * 0.6 + Math.max(0, possibleCount - strongCount - goodCount) * 0.25);
  const fallbackDivisor = kind === "applause" ? 10 : 6;
  const fallbackEstimate = Math.max(1, Math.round((Number(lineCount) || scored.length || 1) / fallbackDivisor));
  return Math.min(cap, densityCap, Math.max(scriptEstimate || fallbackEstimate, Math.min(strongCount || 1, cap)));
}

function audienceCueWordCount(text = "") {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function laughTrackLineScore(line, index, totalLines) {
  const text = String(line.text || "").trim();
  const normalized = text.toLowerCase();
  const previousText = String(line.previousText || "").trim().toLowerCase();
  const nextText = String(line.nextText || "").trim().toLowerCase();
  const wordCount = Number(line.wordCount || audienceCueWordCount(text));
  const previousGap = Number(line.previousGapSeconds || 0);
  let score = 0.15;
  const position = totalLines > 1 ? index / (totalLines - 1) : 0;
  score += position * 0.25;
  if (/[!?]["')\]]?$/.test(text)) score += 0.65;
  if (/[.]["')\]]?$/.test(text) && wordCount <= 12) score += 0.45;
  if (wordCount >= 4 && wordCount <= 16) score += 0.45;
  if (wordCount <= 5 && previousText) score += 0.35;
  if (text.length >= 35 && text.length <= 180) score += 0.25;
  if (/^("|'|and\b|but\b|so\b|because\b|which\b|that\b|then\b|meanwhile\b|apparently\b|except\b)/i.test(text)) score += 0.35;
  if (/"[^"]{3,}"/.test(text)) score += 0.45;
  if (/\b(seriously|folks|apparently|somehow|meanwhile|frankly|admittedly|honestly|trust me|for the first time|yes|no|again|exactly)\b/i.test(text)) score += 0.65;
  if (/\b(dead|alive|afterlife|insane|ridiculous|absurd|normal|forever|shocked|license|hobby|yogurt|payroll|nuclear|comment sections|exclusive|club|collapse|subscription|products|fired|temples)\b/i.test(text)) score += 0.8;
  if (/\b(no|not|never|only|just|even|still|actually|absolutely|literally|somehow|eventually)\b/i.test(text)) score += 0.25;
  if (/\b(but|because|except|instead|while|meanwhile|turns out|apparently)\b/i.test(normalized)) score += 0.3;
  if (/\?$/.test(previousText) || /\b(question|asking|wondering|whether)\b/i.test(previousText)) score += 0.45;
  if (previousText && wordCount <= 10 && !/^(and|but|so|because)\b/i.test(normalized)) score += 0.35;
  if (previousGap >= 0.35 && wordCount <= 12) score += 0.15;
  if (index === totalLines - 1) score += 0.25;
  if (/\b(thank you|welcome back|before we begin|moving on|finally|tonight we'?ll|let me explain|now before)\b/i.test(normalized)) score -= 0.45;
  if (/\b(politics|technology|celebrity|economic|updates from earth|moving on|let'?s discuss)\b/i.test(normalized)) score -= 0.25;
  if (nextText && /^(and|but|because|which|that)\b/i.test(nextText) && wordCount > 18) score -= 0.2;
  if (text.length > 220) score -= 0.45;
  return roundSeconds(score);
}

function applauseTrackLineScore(line, index, totalLines) {
  const text = String(line.text || "").trim();
  const normalized = text.toLowerCase();
  const wordCount = Number(line.wordCount || audienceCueWordCount(text));
  const nextGap = Number(line.nextGapSeconds || 0);
  let score = 0.1;
  const isFirst = index === 0;
  const isLast = index === totalLines - 1;
  const position = totalLines > 1 ? index / (totalLines - 1) : 0;
  score += position * 0.25;
  if (isFirst) score += 1.35;
  if (isLast) score += 1.45;
  if (/[!]["')\]]?$/.test(text)) score += 0.35;
  if (/\b(good evening|welcome|welcome back|thank you|thanks|goodnight|good night|that'?s our show|joining us|first episode|tonight'?s show|moving on|finally|before we begin|and that'?s)\b/i.test(normalized)) score += 1.0;
  if (/\b(please welcome|give it up|big hand|applause|audience|show|episode|everybody|folks)\b/i.test(normalized)) score += 0.9;
  if (/\b(reveal|announcement|winner|celebrating|birthday|anniversary|final|closing)\b/i.test(normalized)) score += 0.55;
  if (wordCount >= 3 && wordCount <= 28) score += 0.25;
  if (nextGap >= 0.5) score += 0.25;
  if (/\b(seriously|apparently|somehow|insane|ridiculous|dead|afterlife)\b/i.test(normalized)) score -= 0.25;
  if (!isFirst && !isLast && /\b(no|not|never|just|actually|absurd|ridiculous|yogurt|payroll|nuclear|comment sections)\b/i.test(normalized)) score -= 0.3;
  if (text.length > 220) score -= 0.45;
  return roundSeconds(score);
}

async function exportFinishedMaster({ episode, show, layers = [] }) {
  const baseOutput = baseFinalVideoOutput(episode);
  const basePath = outputFilePath(baseOutput);
  if (!basePath) {
    throw new Error("Render the final video before adding finishing layers.");
  }

  const masterId = randomUUID();
  const masterDir = path.join(outputsDir, "finished-masters");
  await mkdir(masterDir, { recursive: true });
  const fileName = `${safeFileSegment(episode.title)}-${masterId.slice(0, 8)}-finished-master.mp4`;
  const outputPath = path.join(masterDir, fileName);
  const baseDuration = baseOutput.durationSeconds || (await probeDuration(basePath));
  if (!baseDuration) {
    throw new Error("Could not read the final render duration for finishing export.");
  }
  const dimensions = await probeMediaDimensions(basePath);
  const width = dimensions?.width || Number(show.shortFormat?.resolution?.split("x")?.[0]) || 1920;
  const height = dimensions?.height || Number(show.shortFormat?.resolution?.split("x")?.[1]) || 1080;
  const fps = Number(episode.format?.fps || show.shortFormat?.fps || 30);
  const normalizedLayers = normalizeFinishingLayers(layers).filter((layer) => layer.enabled !== false);
  const preparedLayers = (
    await Promise.all(
      normalizedLayers.map(async (layer) => {
        const filePath = finishingLayerFilePath(layer);
        if (!filePath) return null;
        const sourceDuration =
          layer.type === "image"
            ? 0
            : layer.sourceDurationSeconds || (await probeDuration(filePath));
        return { layer, filePath, sourceDuration };
      })
    )
  ).filter(Boolean);
  const visualLayers = preparedLayers.filter(({ layer }) => ["image", "video"].includes(layer.type));
  const audioLayers = preparedLayers.filter(({ layer }) => layer.type === "audio");
  const baseHasAudio = await probeHasAudio(basePath);

  const inputArgs = ["-i", basePath];
  const inputIndexes = new Map();
  let nextInputIndex = 1;
  for (const item of visualLayers) {
    const duration = finishingLayerDuration(item.layer, baseDuration);
    if (item.layer.type === "image") {
      inputArgs.push("-loop", "1", "-framerate", String(fps), "-t", duration.toFixed(3), "-i", item.filePath);
    } else {
      inputArgs.push("-i", item.filePath);
    }
    inputIndexes.set(item.layer.id, nextInputIndex);
    nextInputIndex += 1;
  }
  for (const item of audioLayers) {
    inputArgs.push("-i", item.filePath);
    inputIndexes.set(item.layer.id, nextInputIndex);
    nextInputIndex += 1;
  }

  const filters = ["[0:v]setpts=PTS-STARTPTS,setsar=1,format=rgba[v0]"];
  let currentVideoLabel = "v0";
  visualLayers.forEach(({ layer, sourceDuration }, index) => {
    const inputIndex = inputIndexes.get(layer.id);
    const duration = finishingLayerDuration(layer, baseDuration);
    const start = finishingLayerStart(layer, baseDuration);
    const end = Math.min(baseDuration || start + duration, start + duration);
    const targetWidth = Math.max(2, Math.round(width * (layer.widthPercent / 100)));
    const x = Math.round(width * (layer.xPercent / 100));
    const y = Math.round(height * (layer.yPercent / 100));
    const videoSourceDuration = Math.max(0, Number(sourceDuration) || 0);
    const frontHoldDuration =
      layer.type === "video" && videoSourceDuration
        ? Math.min(duration, Math.max(0, Number(layer.holdStartSeconds) || 0))
        : 0;
    const sourceTrimDuration =
      layer.type === "video" && videoSourceDuration
        ? Math.max(0.001, Math.min(duration - frontHoldDuration, videoSourceDuration))
        : duration;
    const endHoldDuration =
      layer.type === "video" && videoSourceDuration
        ? Math.max(0, duration - frontHoldDuration - sourceTrimDuration)
        : 0;
    const videoPrep =
      layer.type === "video"
        ? `trim=0:${sourceTrimDuration.toFixed(3)},setpts=PTS-STARTPTS,${
            frontHoldDuration > 0 || endHoldDuration > 0
              ? `tpad=start_mode=clone:start_duration=${frontHoldDuration.toFixed(3)}:stop_mode=clone:stop_duration=${endHoldDuration.toFixed(3)},trim=0:${duration.toFixed(3)},`
              : ""
          }`
        : "";
    filters.push(
      `[${inputIndex}:v]${videoPrep}setpts=PTS-STARTPTS+${start.toFixed(3)}/TB,scale=${targetWidth}:-1:flags=lanczos,setsar=1,format=rgba,colorchannelmixer=aa=${layer.opacity.toFixed(3)}[ov${index}]`
    );
    filters.push(
      `[${currentVideoLabel}][ov${index}]overlay=x=${x}:y=${y}:enable='between(t,${start.toFixed(3)},${end.toFixed(3)})':format=auto[v${index + 1}]`
    );
    currentVideoLabel = `v${index + 1}`;
  });

  let audioMap = baseHasAudio ? "0:a:0" : "";
  if (audioLayers.length) {
    if (baseHasAudio) {
      filters.push("[0:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=1[a0]");
    } else {
      filters.push(`anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:${baseDuration.toFixed(3)},asetpts=PTS-STARTPTS[a0]`);
    }
    const audioLabels = ["[a0]"];
    audioLayers.forEach(({ layer }, index) => {
      const inputIndex = inputIndexes.get(layer.id);
      const duration = finishingLayerDuration(layer, baseDuration);
      const start = finishingLayerStart(layer, baseDuration);
      const fadeOutStart = Math.max(0, duration - layer.fadeOutSeconds);
      const fadeFilters = [
        `atrim=0:${duration.toFixed(3)}`,
        "asetpts=PTS-STARTPTS",
        "aresample=48000",
        "aformat=sample_fmts=fltp:channel_layouts=stereo",
        `volume=${layer.volume.toFixed(3)}`
      ];
      if (layer.fadeInSeconds > 0) fadeFilters.push(`afade=t=in:st=0:d=${layer.fadeInSeconds.toFixed(3)}`);
      if (layer.fadeOutSeconds > 0) {
        fadeFilters.push(`afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${layer.fadeOutSeconds.toFixed(3)}`);
      }
      fadeFilters.push(`adelay=${Math.round(start * 1000)}:all=1`);
      filters.push(`[${inputIndex}:a]${fadeFilters.join(",")}[a${index + 1}]`);
      audioLabels.push(`[a${index + 1}]`);
    });
    filters.push(`${audioLabels.join("")}amix=inputs=${audioLabels.length}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[aout]`);
    audioMap = "[aout]";
  } else if (!baseHasAudio) {
    filters.push(`anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:${baseDuration.toFixed(3)},asetpts=PTS-STARTPTS[aout]`);
    audioMap = "[aout]";
  }

  const args = [
    "-y",
    ...inputArgs,
    "-filter_complex",
    filters.join(";"),
    "-map",
    `[${currentVideoLabel}]`,
    "-map",
    audioMap,
    "-t",
    (baseDuration || 0).toFixed(3),
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    outputPath
  ];

  await execFileAsync(ffmpegPath, args, {
    timeout: 300000,
    maxBuffer: 30 * 1024 * 1024
  });

  const output = {
    id: `${masterId}-finished-master`,
    type: "finished_master",
    name: "Finished master",
    fileName,
    localUrl: `/outputs/finished-masters/${fileName}`,
    sourceFinalVideoId: baseOutput.id || "",
    layerCount: preparedLayers.length,
    durationSeconds: await probeDuration(outputPath),
    createdAt: new Date().toISOString()
  };
  return { output, layers: normalizedLayers };
}

function finishingLayerStart(layer, baseDuration = 0) {
  return clampNumber(layer.startSeconds, 0, Math.max(0, Number(baseDuration) || 0));
}

function finishingLayerDuration(layer, baseDuration = 0) {
  const start = finishingLayerStart(layer, baseDuration);
  const remaining = Math.max(0.1, (Number(baseDuration) || start + 0.1) - start);
  return clampNumber(layer.durationSeconds, 0.1, remaining);
}

async function exportUploadPackage({ episode, show }) {
  const finalVideo = latestFinalVideoOutput(episode);
  const finalVideoPath = outputFilePath(finalVideo);
  if (!finalVideoPath) {
    throw new Error("Render the final video before exporting the upload package.");
  }

  const selectedThumbnail = selectedThumbnailOutput(episode);
  const thumbnailPath = outputFilePath(selectedThumbnail);
  if (!thumbnailPath) {
    throw new Error("Select a final thumbnail before exporting the upload package.");
  }

  const packageId = randomUUID();
  const packageName = `${safeFileSegment(episode.title)}-${packageId.slice(0, 8)}-upload-package`;
  const packageDir = path.join(outputsDir, "packages", episode.id, packageName);
  await mkdir(packageDir, { recursive: true });

  const shortsThumbnailRequested = Boolean(episode.drafts?.youtube?.shortsThumbnail);
  const videoFileName = shortsThumbnailRequested ? "video-shorts-thumbnail.mp4" : `video${path.extname(finalVideoPath) || ".mp4"}`;
  const thumbnailFileName = `thumbnail${path.extname(thumbnailPath) || ".png"}`;
  const metadataFileName = "youtube-metadata.json";
  const textFileName = "youtube-upload.txt";
  const campaignMetadataFileName = "campaign-drafts.json";
  const campaignTextFileName = "campaign-drafts.txt";
  const promotionPacketFileName = "promotion-packet.json";
  const promotionPacketTextFileName = "promotion-packet.txt";
  if (shortsThumbnailRequested) {
    await prepareShortsThumbnailUploadVideo({
      videoPath: finalVideoPath,
      thumbnailPath,
      tempDir: packageDir,
      outputPath: path.join(packageDir, videoFileName)
    });
  } else {
    await copyFile(finalVideoPath, path.join(packageDir, videoFileName));
  }
  await copyFile(thumbnailPath, path.join(packageDir, thumbnailFileName));

  const metadata = youtubePackageMetadata({
    episode,
    show,
    finalVideo,
    selectedThumbnail,
    packageName,
    videoFileName,
    thumbnailFileName
  });
  await writeFile(path.join(packageDir, metadataFileName), JSON.stringify(metadata, null, 2));
  await writeFile(path.join(packageDir, textFileName), youtubePackageText(metadata));
  await writeFile(path.join(packageDir, campaignMetadataFileName), JSON.stringify(metadata.campaign, null, 2));
  await writeFile(path.join(packageDir, campaignTextFileName), campaignPackageText(metadata));
  await writeFile(path.join(packageDir, promotionPacketFileName), JSON.stringify(promotionPacketMetadata(metadata), null, 2));
  await writeFile(path.join(packageDir, promotionPacketTextFileName), promotionPacketText(metadata));

  const baseLocalUrl = `/outputs/packages/${episode.id}/${packageName}`;
  const output = {
    id: `${packageId}-package`,
    type: "package_export",
    name: "Final upload package",
    fileName: packageName,
    localUrl: `${baseLocalUrl}/${metadataFileName}`,
    metadataLocalUrl: `${baseLocalUrl}/${metadataFileName}`,
    textLocalUrl: `${baseLocalUrl}/${textFileName}`,
    campaignMetadataLocalUrl: `${baseLocalUrl}/${campaignMetadataFileName}`,
    campaignTextLocalUrl: `${baseLocalUrl}/${campaignTextFileName}`,
    promotionPacketLocalUrl: `${baseLocalUrl}/${promotionPacketFileName}`,
    promotionTextLocalUrl: `${baseLocalUrl}/${promotionPacketTextFileName}`,
    videoLocalUrl: `${baseLocalUrl}/${videoFileName}`,
    thumbnailLocalUrl: `${baseLocalUrl}/${thumbnailFileName}`,
    createdAt: metadata.createdAt
  };

  return { output, metadata };
}

async function writeNewtBuilderEpisodePackage({ episode, show, parentPath }) {
  const exportedAt = new Date().toISOString();
  const parent = normalizePackageParentPath(parentPath);
  if (!parent) throw new Error("Choose a valid parent folder for the episode package.");
  await mkdir(parent, { recursive: true });

  const packageName = uniqueEpisodePackageName(parent, `${safeFileSegment(episode.title)}-newtbuilder-package`);
  const packagePath = path.join(parent, packageName);
  const metadataDir = path.join(packagePath, ".newtbuilder");
  await Promise.all([
    mkdir(packagePath, { recursive: true }),
    mkdir(metadataDir, { recursive: true })
  ]);

  const urlMap = new Map();
  const files = [];
  const localUrls = [...collectLocalProjectUrls(show), ...collectLocalProjectUrls(episode)];
  for (const localUrl of [...new Set(localUrls)]) {
    const sourcePath = localProjectFilePath(localUrl);
    const relativePath = packageRelativePathForLocalUrl(localUrl);
    if (!sourcePath || !relativePath) continue;
    const targetPath = path.join(packagePath, relativePath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await copyFile(sourcePath, targetPath);
    const normalizedRelativePath = relativePath.replace(/\\/g, "/");
    urlMap.set(localUrl, `./${normalizedRelativePath}`);
    files.push({
      originalUrl: localUrl,
      relativePath: normalizedRelativePath,
      fileName: path.basename(targetPath)
    });
  }

  const packagedShow = rewritePackageLocalUrls(show, urlMap);
  const packagedEpisode = rewritePackageLocalUrls(episode, urlMap);
  const manifestPath = path.join(packagePath, "episode.newtbuilder.json");
  const manifest = {
    app: "NewtBuilder",
    version: 1,
    exportedAt,
    packageName,
    packagePath,
    show: packagedShow,
    episode: packagedEpisode,
    files
  };
  const summary = {
    app: "NewtBuilder",
    version: 1,
    exportedAt,
    packageName,
    manifest: "episode.newtbuilder.json",
    showId: show.id,
    episodeId: episode.id,
    fileCount: files.length
  };

  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  await writeFile(path.join(metadataDir, "manifest.json"), JSON.stringify(summary, null, 2));

  return {
    packageName,
    packagePath,
    manifestPath,
    exportedAt,
    fileCount: files.length
  };
}

function normalizePackageParentPath(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return path.resolve(raw);
}

function uniqueEpisodePackageName(parentPath, baseName) {
  const safeBase = safeFileSegment(baseName || "newtbuilder-episode-package");
  let packageName = safeBase;
  let index = 2;
  while (existsSync(path.join(parentPath, packageName))) {
    packageName = `${safeBase}-${index}`;
    index += 1;
  }
  return packageName;
}

function collectLocalProjectUrls(value, urls = new Set()) {
  if (!value) return urls;
  if (typeof value === "string") {
    if (value.startsWith("/uploads/") || value.startsWith("/outputs/")) urls.add(value);
    return urls;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectLocalProjectUrls(item, urls);
    return urls;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value)) collectLocalProjectUrls(item, urls);
  }
  return urls;
}

function packageRelativePathForLocalUrl(localUrl) {
  const normalized = String(localUrl || "").replace(/\\/g, "/");
  if (!normalized.startsWith("/uploads/") && !normalized.startsWith("/outputs/")) return "";
  const parts = normalized
    .replace(/^\/+/, "")
    .split("/")
    .map(safePackagePathSegment)
    .filter(Boolean);
  if (!parts.length || !["uploads", "outputs"].includes(parts[0])) return "";
  return path.join(...parts);
}

function safePackagePathSegment(value) {
  return (
    String(value || "")
      .trim()
      .replace(/[^a-z0-9_.-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120) || "asset"
  );
}

function rewritePackageLocalUrls(value, urlMap) {
  if (!value) return value;
  if (typeof value === "string") return urlMap.get(value) || value;
  if (Array.isArray(value)) return value.map((item) => rewritePackageLocalUrls(item, urlMap));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, rewritePackageLocalUrls(item, urlMap)])
    );
  }
  return value;
}

function latestFinalVideoOutput(episode) {
  const outputs = Array.isArray(episode.outputs) ? episode.outputs : [];
  return (
    outputs.find((output) => output.type === "upscaled_video" && outputFilePath(output)) ||
    outputs.find((output) => output.type === "finished_master" && outputFilePath(output)) ||
    baseFinalVideoOutput(episode)
  );
}

function latestFinalAudioOutput(episode) {
  const outputs = Array.isArray(episode.outputs) ? episode.outputs : [];
  return (
    outputs.find((output) => output.type === "final_audio_mix" && outputFilePath(output)) ||
    outputs.find((output) => output.type === "audio_mix" && outputFilePath(output)) ||
    null
  );
}

function baseFinalVideoOutput(episode) {
  const outputs = Array.isArray(episode.outputs) ? episode.outputs : [];
  return outputs.find((output) => output.type === "final_video" && outputFilePath(output)) || null;
}

function selectedThumbnailOutput(episode) {
  const outputs = Array.isArray(episode.outputs) ? episode.outputs : [];
  const selectedId = episode.drafts?.selectedThumbnailOutputId || "";
  return (
    outputs.find((output) => output.type === "thumbnail_image" && output.id === selectedId && outputFilePath(output)) ||
    outputs.find((output) => output.type === "thumbnail_image" && output.isSelected && outputFilePath(output)) ||
    null
  );
}

async function buildLaunchReadiness({ episode, show }) {
  const outputs = Array.isArray(episode.outputs) ? episode.outputs : [];
  const assets = Array.isArray(episode.assets) ? episode.assets.map(normalizeAsset) : [];
  const lines = applyStoredSpeakerMasks(Array.isArray(episode.productionMap) ? episode.productionMap : [], assets);
  const dialogueLines = lines.filter((line) => line.lineType !== "insert");
  const insertLines = lines.filter((line) => line.lineType === "insert");
  const groupedDialogue = dialogueLines.filter((line) => ["wide_shot", "medium_two_shot"].includes(line.shotRole));
  const approvals = Array.isArray(episode.approvals) ? episode.approvals : [];
  const requiredApprovalIds = ["script_plan", "voice_audio", "render_preview"];
  const missingApprovals = requiredApprovalIds.filter((id) => {
    const gate = approvals.find((item) => item.id === id);
    return !gate || (gate.status !== "approved" && gate.status !== "auto");
  });
  const missingVoices = dialogueLines.filter((line) => !String(line.voiceId || "").trim());
  const missingImages = lines.filter((line) => !String(line.assetId || "").trim());
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const missingMasks = groupedDialogue.filter(
    (line) => !line.maskAutoApplyDisabled && lineExpectsSpeakerMask(line, assetById.get(line.assetId)) && !String(line.maskAssetId || "").trim()
  );
  const missingInsertVideos = insertLines.filter((line) => !line.videoTake?.localUrl && !line.videoTake?.proxyLocalUrl);
  const badInsertTrims = insertLines.filter((line) => {
    if (!line.videoTake?.localUrl && !line.videoTake?.proxyLocalUrl) return false;
    return Number(line.videoOutSeconds || 0) <= Number(line.videoInSeconds || 0);
  });
  const finalVideo = latestFinalVideoOutput(episode);
  const finalVideoPath = outputFilePath(finalVideo);
  const selectedThumbnail = selectedThumbnailOutput(episode);
  const thumbnailPath = outputFilePath(selectedThumbnail);
  const finalAudio =
    outputs.find((output) => output.type === "final_audio_mix" && outputFilePath(output)) ||
    outputs.find((output) => output.type === "audio_mix" && outputFilePath(output)) ||
    null;
  const youtubeDraft = episode.drafts?.youtube || {};
  const title = String(youtubeDraft.title || episode.title || show.name || "").trim();
  const description = String(youtubeDraft.description || "").trim();
  const tags = Array.isArray(youtubeDraft.tags) ? youtubeDraft.tags : [];
  const plannedPublishAt = String(youtubeDraft.plannedPublishAt || "").trim();
  const youtube = await youtubeOAuthStatus();
  const checks = [];

  function add(group, id, label, passed, detail, severityWhenFalse = "fail") {
    checks.push({
      group,
      id,
      label,
      status: passed ? "pass" : severityWhenFalse,
      detail
    });
  }

  add(
    "episode",
    "script",
    "Script package",
    Boolean(String(episode.scriptText || "").trim()),
    episode.scriptText ? `${String(episode.scriptText).split(/\s+/).filter(Boolean).length} words loaded` : "Upload or paste a script"
  );
  add(
    "episode",
    "production_map",
    "Production map",
    lines.length > 0,
    lines.length ? `${lines.length} mapped shots` : "Build Plan must create the shot map"
  );
  add(
    "episode",
    "approvals",
    "Mandatory approvals",
    missingApprovals.length === 0,
    missingApprovals.length ? `${missingApprovals.length} gate(s) still need approval` : "Script Plan, Voice & Audio, and Episode Render are approved"
  );
  add(
    "episode",
    "voices",
    "Dialogue voices",
    dialogueLines.length > 0 && missingVoices.length === 0,
    dialogueLines.length ? `${dialogueLines.length - missingVoices.length}/${dialogueLines.length} dialogue lines assigned` : "No dialogue lines found"
  );
  add(
    "episode",
    "shots",
    "Shot images",
    lines.length > 0 && missingImages.length === 0,
    lines.length ? `${lines.length - missingImages.length}/${lines.length} lines have visual assets` : "No mapped shots found"
  );
  add(
    "episode",
    "group_masks",
    "Grouped-shot masks",
    groupedDialogue.length === 0 || missingMasks.length === 0,
    groupedDialogue.length
      ? `${groupedDialogue.length - missingMasks.length}/${groupedDialogue.length} wide/two-shot lines have masks`
      : "No grouped dialogue shots require masks"
  );
  add(
    "episode",
    "insert_clips",
    "Insert clips",
    missingInsertVideos.length === 0 && badInsertTrims.length === 0,
    insertLines.length
      ? `${insertLines.length - missingInsertVideos.length}/${insertLines.length} inserts generated${
          badInsertTrims.length ? `; ${badInsertTrims.length} trim issue(s)` : ""
        }`
      : "No insert lines in this episode"
  );

  const finalAudioPath = outputFilePath(finalAudio);
  const finalVideoStat = finalVideoPath ? await safeStat(finalVideoPath) : null;
  const thumbnailStat = thumbnailPath ? await safeStat(thumbnailPath) : null;
  const thumbnailMime = thumbnailPath ? thumbnailMimeTypeForPath(thumbnailPath) : "";
  add(
    "render",
    "audio_mix",
    "Final audio mix",
    Boolean(finalAudioPath),
    finalAudioPath ? finalAudio.name || "Audio mix exists" : "Rebuild audio or build the preview"
  );
  add(
    "render",
    "final_video",
    "Final render",
    Boolean(finalVideoPath),
    finalVideoPath
      ? `${finalVideo.name || finalVideo.fileName || "Final video"}${finalVideoStat ? `, ${fileSizeLabel(finalVideoStat.size)}` : ""}`
      : "Render the final video"
  );
  add(
    "render",
    "selected_thumbnail",
    "Selected thumbnail",
    Boolean(thumbnailPath),
    thumbnailPath
      ? `${selectedThumbnail.name || selectedThumbnail.fileName || "Thumbnail"}${thumbnailStat ? `, ${fileSizeLabel(thumbnailStat.size)}` : ""}`
      : "Generate and select one thumbnail"
  );
  if (thumbnailPath) {
    add(
      "render",
      "thumbnail_youtube_safe",
      "YouTube thumbnail format",
      thumbnailStat && thumbnailStat.size <= 2 * 1024 * 1024 && ["image/png", "image/jpeg"].includes(thumbnailMime),
      thumbnailStat && thumbnailStat.size > 2 * 1024 * 1024
        ? "Will be converted to a YouTube-safe JPEG before upload"
        : ["image/png", "image/jpeg"].includes(thumbnailMime)
          ? thumbnailMime
          : "Will be converted to JPEG before upload",
      "warning"
    );
  }
  if (youtubeDraft.shortsThumbnail) {
    add(
      "render",
      "shorts_thumbnail_frame",
      "Shorts thumbnail frame",
      Boolean(finalVideoPath && thumbnailPath),
      finalVideoPath && thumbnailPath
        ? `Selected thumbnail will be held for ${shortsThumbnailFrameSeconds}s as the final upload frame`
        : "Render final video and select a thumbnail before adding the Shorts frame",
      "warning"
    );
  }

  add(
    "youtube",
    "metadata_title",
    "YouTube title",
    Boolean(title),
    title ? `${Math.min(title.length, 100)}/100 characters` : "Add a title in YouTube Prep"
  );
  add(
    "youtube",
    "metadata_description",
    "YouTube description",
    Boolean(description),
    description ? `${description.length} characters` : "Description is empty",
    "warning"
  );
  add(
    "youtube",
    "metadata_tags",
    "YouTube tags",
    tags.length > 0,
    tags.length ? `${tags.length} tag(s)` : "Tags are optional but recommended",
    "warning"
  );
  add(
    "youtube",
    "oauth",
    "YouTube OAuth",
    youtube.connected,
    youtube.connected ? "Connected" : "Connect YouTube before upload"
  );
  add(
    "youtube",
    "upload_scope",
    "YouTube upload permission",
    youtube.canUpload,
    youtube.needsReconnectForUpload
      ? "Reconnect YouTube and approve upload scope"
      : youtube.scopeKnown
        ? "Upload scope approved"
        : "Scope stored outside local file; upload will verify at runtime",
    youtube.connected ? "warning" : "fail"
  );
  add(
    "youtube",
    "publishing_lock",
    "Publishing lock",
    publishingEnabled,
    publishingEnabled
      ? "Private draft upload is unlocked"
      : "Set NEWTBUILDER_ENABLE_PUBLISHING=true before uploading",
    "fail"
  );
  add(
    "youtube",
    "private_draft_safety",
    "Private draft safety",
    true,
    "The upload endpoint always sends privacyStatus=private; public publish stays manual in YouTube Studio"
  );
  add(
    "youtube",
    "schedule_plan",
    "Schedule plan",
    true,
    plannedPublishAt ? `Manual schedule target saved: ${plannedPublishAt}` : "No schedule target saved; private draft can stay parked"
  );

  add(
    "promotion",
    "promotion_packet",
    "Promotion packet",
    Boolean(youtubeDraft.promotion?.communityPost || youtubeDraft.promotion?.pinnedComment),
    youtubeDraft.promotion?.communityPost || youtubeDraft.promotion?.pinnedComment
      ? "YouTube promotion copy is drafted"
      : "Draft promotion copy before package export",
    "warning"
  );

  const blockers = checks.filter((check) => check.status === "fail");
  const warnings = checks.filter((check) => check.status === "warning");
  const ready = blockers.length === 0;
  return {
    checkedAt: new Date().toISOString(),
    ready,
    canUploadPrivateDraft: ready,
    summary: ready
      ? warnings.length
        ? `Launch readiness passed with ${warnings.length} warning(s).`
        : "Launch readiness passed."
      : `Launch readiness has ${blockers.length} blocker(s).`,
    checks,
    blockers,
    warnings,
    outputs: {
      finalVideo: finalVideo
        ? {
            id: finalVideo.id || "",
            name: finalVideo.name || finalVideo.fileName || "",
            localUrl: finalVideo.localUrl || "",
            exists: Boolean(finalVideoPath)
          }
        : null,
      selectedThumbnail: selectedThumbnail
        ? {
            id: selectedThumbnail.id || "",
            name: selectedThumbnail.name || selectedThumbnail.fileName || "",
            localUrl: selectedThumbnail.localUrl || "",
            exists: Boolean(thumbnailPath)
          }
        : null
    },
    youtube: {
      connected: youtube.connected,
      canUpload: youtube.canUpload,
      canReadStatus: youtube.canReadStatus,
      publishingEnabled,
      draftOnly: true
    }
  };
}

async function safeStat(filePath) {
  try {
    return await stat(filePath);
  } catch {
    return null;
  }
}

function fileSizeLabel(bytes = 0) {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

function youtubePackageMetadata({ episode, show, finalVideo, selectedThumbnail, packageName, videoFileName, thumbnailFileName }) {
  const youtube = episode.drafts?.youtube || {};
  const latestYoutubeUpload = (Array.isArray(episode.outputs) ? episode.outputs : []).find(
    (output) => output.type === "youtube_upload" && output.videoId
  );
  const draftWatchUrl = String(latestYoutubeUpload?.watchUrl || "");
  const draftStudioUrl = String(latestYoutubeUpload?.studioUrl || "");
  const tags = uniqueStrings([...(Array.isArray(youtube.tags) ? youtube.tags : []), ...(show.platforms?.youtube?.defaultTags || [])]).slice(0, 30);
  return {
    createdAt: new Date().toISOString(),
    packageName,
    show: {
      id: show.id,
      name: show.name
    },
    episode: {
      id: episode.id,
      title: episode.title,
      durationSeconds: finalVideo.durationSeconds || 0,
      aspectRatio: episode.format?.aspectRatio || show.shortFormat?.aspectRatio || ""
    },
    youtube: {
      title: String(youtube.title || episode.title || show.name || "Untitled Episode").slice(0, 100),
      description: String(youtube.description || "").trim(),
      tags,
      privacyStatus: "private",
      categoryId: youtube.categoryId || show.platforms?.youtube?.categoryId || "24",
      madeForKids: Boolean(youtube.madeForKids ?? show.platforms?.youtube?.madeForKids),
      notifySubscribers: Boolean(youtube.notifySubscribers ?? show.platforms?.youtube?.notifySubscribers),
      containsSyntheticMedia: youtube.containsSyntheticMedia !== false,
      shortsThumbnail: Boolean(youtube.shortsThumbnail),
      shortsThumbnailFrameSeconds: Boolean(youtube.shortsThumbnail) ? shortsThumbnailFrameSeconds : 0,
      plannedPublishAt: String(youtube.plannedPublishAt || ""),
      publishNotes: String(youtube.publishNotes || "").trim(),
      readyToPublish: Boolean(youtube.readyToPublish),
      readyToPublishAt: String(youtube.readyToPublishAt || ""),
      draftWatchUrl,
      draftStudioUrl,
      handoffChecklist: {
        titleReady: Boolean(youtube.handoffChecklist?.titleReady),
        descriptionReady: Boolean(youtube.handoffChecklist?.descriptionReady),
        thumbnailReady: Boolean(youtube.handoffChecklist?.thumbnailReady),
        studioChecked: Boolean(youtube.handoffChecklist?.studioChecked),
        approvalReady: Boolean(youtube.handoffChecklist?.approvalReady),
        scheduledManually: Boolean(youtube.handoffChecklist?.scheduledManually)
      },
      promotion: {
        communityPost: hydrateYouTubeLink(youtube.promotion?.communityPost || "", draftWatchUrl),
        pinnedComment: hydrateYouTubeLink(youtube.promotion?.pinnedComment || "", draftWatchUrl)
      }
    },
    files: {
      video: videoFileName,
      thumbnail: thumbnailFileName,
      metadata: "youtube-metadata.json",
      text: "youtube-upload.txt",
      campaignMetadata: "campaign-drafts.json",
      campaignText: "campaign-drafts.txt",
      promotionPacket: "promotion-packet.json",
      promotionText: "promotion-packet.txt"
    },
    sources: {
      videoOutputId: finalVideo.id || "",
      thumbnailOutputId: selectedThumbnail.id || "",
      thumbnailProvider: selectedThumbnail.provider || ""
    },
    campaign: {
      youtubePromotion: {
        communityPost: hydrateYouTubeLink(youtube.promotion?.communityPost || "", draftWatchUrl),
        pinnedComment: hydrateYouTubeLink(youtube.promotion?.pinnedComment || "", draftWatchUrl)
      },
      social: []
    }
  };
}

function campaignPackageText(metadata) {
  return [
    "YouTube Community post:",
    metadata.youtube.promotion.communityPost || "",
    "",
    "YouTube pinned comment:",
    metadata.youtube.promotion.pinnedComment || ""
  ].join("\n");
}

function promotionPacketMetadata(metadata) {
  const checks = promotionPacketChecks(metadata);
  return {
    createdAt: metadata.createdAt,
    show: metadata.show,
    episode: metadata.episode,
    youtube: {
      title: metadata.youtube.title,
      draftWatchUrl: metadata.youtube.draftWatchUrl || "",
      draftStudioUrl: metadata.youtube.draftStudioUrl || "",
      plannedPublishAt: metadata.youtube.plannedPublishAt || "",
      publishNotes: metadata.youtube.publishNotes || "",
      communityPost: metadata.youtube.promotion.communityPost || "",
      pinnedComment: metadata.youtube.promotion.pinnedComment || ""
    },
    checks,
    manualSequence: [
      "Review the final render and selected thumbnail.",
      "Confirm the private YouTube draft metadata in YouTube Studio.",
      "Paste the YouTube Community post when the video is ready for audience attention.",
      "Paste the pinned comment after the video is live or scheduled."
    ]
  };
}

function promotionPacketChecks(metadata) {
  const checks = [];
  const watchUrl = metadata.youtube.draftWatchUrl || "";
  function add(id, label, status, detail) {
    checks.push({ id, label, status, detail });
  }
  const community = metadata.youtube.promotion.communityPost || "";
  const pinned = metadata.youtube.promotion.pinnedComment || "";
  add(
    "youtube_community",
    "YouTube Community",
    community ? "ready" : "needs_draft",
    community ? `${community.length}/${campaignPlatformLimits.youtubeCommunity} characters` : "Community post is empty"
  );
  add(
    "pinned_comment",
    "Pinned comment",
    pinned ? "ready" : "needs_draft",
    pinned ? `${pinned.length}/${campaignPlatformLimits.pinnedComment} characters` : "Pinned comment is empty"
  );
  add(
    "youtube_link",
    "YouTube link",
    watchUrl ? "ready" : "pending",
    watchUrl || "Private draft link not included yet"
  );
  return checks;
}

function promotionPacketText(metadata) {
  const packet = promotionPacketMetadata(metadata);
  return [
    "Promotion Packet",
    "",
    `Show: ${packet.show.name}`,
    `Episode: ${packet.episode.title}`,
    `YouTube draft: ${packet.youtube.draftWatchUrl || "pending"}`,
    `Studio: ${packet.youtube.draftStudioUrl || "pending"}`,
    `Planned publish: ${packet.youtube.plannedPublishAt || "not set"}`,
    "",
    "Checks:",
    ...packet.checks.map((check) => `- ${check.label}: ${check.status} (${check.detail})`),
    "",
    "YouTube Community:",
    packet.youtube.communityPost || "",
    "",
    "Pinned Comment:",
    packet.youtube.pinnedComment || "",
    "",
    "Manual Sequence:",
    ...packet.manualSequence.map((item, index) => `${index + 1}. ${item}`)
  ].join("\n");
}

function youtubePackageText(metadata) {
  return [
    "Title:",
    metadata.youtube.title,
    "",
    "Description:",
    metadata.youtube.description || "",
    "",
    "Tags:",
    metadata.youtube.tags.join(", "),
    "",
    "Privacy:",
    metadata.youtube.privacyStatus,
    "",
    "Category ID:",
    metadata.youtube.categoryId,
    "",
    "Made for kids:",
    metadata.youtube.madeForKids ? "yes" : "no",
    "",
    "Contains synthetic media:",
    metadata.youtube.containsSyntheticMedia ? "yes" : "no",
    "",
    "Shorts thumbnail frame:",
    metadata.youtube.shortsThumbnail
      ? `yes (${metadata.youtube.shortsThumbnailFrameSeconds || shortsThumbnailFrameSeconds}s held at end of upload video)`
      : "no",
    "",
    "Target publish time:",
    metadata.youtube.plannedPublishAt || "",
    "",
    "Publish notes:",
    metadata.youtube.publishNotes || "",
    "",
    "Ready for manual publish:",
    metadata.youtube.readyToPublish ? "yes" : "no",
    "",
    "Handoff checklist:",
    `Title ready: ${metadata.youtube.handoffChecklist.titleReady ? "yes" : "no"}`,
    `Description ready: ${metadata.youtube.handoffChecklist.descriptionReady ? "yes" : "no"}`,
    `Thumbnail ready: ${metadata.youtube.handoffChecklist.thumbnailReady ? "yes" : "no"}`,
    `Studio checked: ${metadata.youtube.handoffChecklist.studioChecked ? "yes" : "no"}`,
    `Approval ready: ${metadata.youtube.handoffChecklist.approvalReady ? "yes" : "no"}`,
    `Scheduled/published manually: ${metadata.youtube.handoffChecklist.scheduledManually ? "yes" : "no"}`,
    "",
    "Community post draft:",
    metadata.youtube.promotion.communityPost || "",
    "",
    "Pinned comment draft:",
    metadata.youtube.promotion.pinnedComment || "",
    "",
    "Promotion packet:",
    `Community post ready: ${metadata.youtube.promotion.communityPost ? "yes" : "no"}`,
    `Pinned comment ready: ${metadata.youtube.promotion.pinnedComment ? "yes" : "no"}`,
    "",
    "Files:",
    `Video: ${metadata.files.video}`,
    `Thumbnail: ${metadata.files.thumbnail}`
  ].join("\n");
}

async function uploadYouTubePrivateDraft({ episode, show }) {
  const finalVideo = latestFinalVideoOutput(episode);
  const finalVideoPath = outputFilePath(finalVideo);
  if (!finalVideoPath) {
    throw new Error("Render the final video before uploading a private YouTube draft.");
  }

  const selectedThumbnail = selectedThumbnailOutput(episode);
  const thumbnailPath = outputFilePath(selectedThumbnail);
  if (!thumbnailPath) {
    throw new Error("Select a final thumbnail before uploading a private YouTube draft.");
  }

  const uploadId = randomUUID();
  const tempDir = path.join(outputsDir, "tmp", `youtube-upload-${uploadId}`);
  await mkdir(tempDir, { recursive: true });

  try {
    const metadata = youtubePackageMetadata({
      episode,
      show,
      finalVideo,
      selectedThumbnail,
      packageName: `${safeFileSegment(episode.title)}-${uploadId.slice(0, 8)}-youtube-draft`,
      videoFileName: path.basename(finalVideoPath),
      thumbnailFileName: path.basename(thumbnailPath)
    });
    let uploadVideoPath = finalVideoPath;
    let shortsThumbnailApplied = false;
    if (metadata.youtube.shortsThumbnail) {
      uploadVideoPath = await prepareShortsThumbnailUploadVideo({
        videoPath: finalVideoPath,
        thumbnailPath,
        tempDir
      });
      if (!uploadVideoPath || uploadVideoPath === finalVideoPath) {
        throw new Error("Shorts thumbnail was requested, but NewtBuilder could not prepare the upload video with the thumbnail as the final frame.");
      }
      shortsThumbnailApplied = true;
      metadata.files.video = path.basename(uploadVideoPath);
      metadata.youtube.shortsThumbnailFrameSeconds = shortsThumbnailFrameSeconds;
    }
    const accessToken = await youtubeAccessToken();
    const video = await uploadYouTubeVideo({
      accessToken,
      videoPath: uploadVideoPath,
      metadata
    });
    const videoId = String(video?.id || "").trim();
    if (!videoId) {
      throw new Error("YouTube did not return a video ID for the private draft upload.");
    }

    let thumbnailSet = false;
    let thumbnailWarning = "";
    try {
      const thumbnail = await prepareYouTubeThumbnail({ thumbnailPath, tempDir });
      await setYouTubeThumbnail({
        accessToken,
        videoId,
        thumbnailPath: thumbnail.filePath,
        mimeType: thumbnail.mimeType
      });
      thumbnailSet = true;
      thumbnailWarning = thumbnail.converted ? "Thumbnail was converted to a YouTube-safe JPEG under 2MB before upload." : "";
    } catch (error) {
      thumbnailWarning = cleanErrorMessage(error);
    }

    return {
      uploadId,
      videoId,
      watchUrl: `https://youtu.be/${videoId}`,
      studioUrl: `https://studio.youtube.com/video/${videoId}/edit`,
      privacyStatus: "private",
      requestedPrivacyStatus: metadata.youtube.privacyStatus,
      shortsThumbnailApplied,
      shortsThumbnailFrameSeconds: shortsThumbnailApplied ? shortsThumbnailFrameSeconds : 0,
      uploadVideoFileName: path.basename(uploadVideoPath),
      thumbnailSet,
      thumbnailWarning,
      metadata,
      createdAt: new Date().toISOString()
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function prepareShortsThumbnailUploadVideo({ videoPath, thumbnailPath, tempDir, outputPath = "" }) {
  const dimensions = await probeMediaDimensions(videoPath);
  const probedWidth = Math.round(Number(dimensions.width) || 0);
  const probedHeight = Math.round(Number(dimensions.height) || 0);
  if (probedWidth <= 0 || probedHeight <= 0) {
    throw new Error("Could not read final video dimensions before adding the Shorts thumbnail frame.");
  }
  const width = Math.max(2, probedWidth);
  const height = Math.max(2, probedHeight);

  const finalOutputPath = outputPath || path.join(tempDir, "youtube-shorts-thumbnail-upload.mp4");
  const frameSeconds = shortsThumbnailFrameSeconds.toFixed(3);
  const filter = [
    `[0:v]setpts=PTS-STARTPTS,setsar=1,format=yuv420p[v0]`,
    `[1:v]scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height}:x=(in_w-out_w)/2:y=(in_h-out_h)/2,setsar=1,format=yuv420p,trim=0:${frameSeconds},setpts=PTS-STARTPTS[v1]`,
    `[v0][v1]concat=n=2:v=1:a=0[vout]`
  ].join(";");

  await execFileAsync(
    ffmpegPath,
    [
      "-y",
      "-i",
      videoPath,
      "-loop",
      "1",
      "-framerate",
      "30",
      "-t",
      frameSeconds,
      "-i",
      thumbnailPath,
      "-filter_complex",
      filter,
      "-map",
      "[vout]",
      "-map",
      "0:a?",
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "copy",
      "-movflags",
      "+faststart",
      finalOutputPath
    ],
    {
      timeout: 300000,
      maxBuffer: 30 * 1024 * 1024
    }
  );

  return finalOutputPath;
}

function youtubeOAuthClientConfigured() {
  return Boolean(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET);
}

async function youtubeOAuthConfigured() {
  return Boolean(youtubeOAuthClientConfigured() && (await youtubeRefreshToken()));
}

async function youtubeOAuthStatus() {
  const stored = await readYouTubeOAuth();
  const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN || stored.refreshToken;
  const scopeList = process.env.YOUTUBE_REFRESH_TOKEN ? [] : parseOAuthScopes(stored.scope);
  const scopeKnown = scopeList.length > 0;
  const missingScopes = scopeKnown ? youtubeScopeList.filter((scope) => !scopeList.includes(scope)) : [];
  const connected = Boolean(youtubeOAuthClientConfigured() && refreshToken);
  const hasUploadScope = !scopeKnown || scopeList.includes(youtubeUploadScope);
  const hasReadonlyScope = !scopeKnown || scopeList.includes(youtubeReadScope);

  return {
    connected,
    scopeKnown,
    scopes: scopeList,
    missingScopes,
    canUpload: connected && hasUploadScope,
    needsReconnectForUpload: connected && scopeKnown && !hasUploadScope,
    canReadStatus: connected && hasReadonlyScope,
    needsReconnectForStatus: connected && scopeKnown && !hasReadonlyScope,
    connectedAt: stored.connectedAt
  };
}

function parseOAuthScopes(scopeText) {
  return uniqueStrings(String(scopeText || "").split(/\s+/).filter(Boolean));
}

async function youtubeRefreshToken() {
  if (process.env.YOUTUBE_REFRESH_TOKEN) return process.env.YOUTUBE_REFRESH_TOKEN;
  const stored = await readYouTubeOAuth();
  return stored.refreshToken || "";
}

async function readYouTubeOAuth() {
  const data = await readJson(youtubeAuthPath, {});
  return {
    refreshToken: String(data.refreshToken || data.refresh_token || "").trim(),
    scope: String(data.scope || "").trim(),
    tokenType: String(data.tokenType || data.token_type || "").trim(),
    connectedAt: String(data.connectedAt || "").trim()
  };
}

function youtubeRedirectUri() {
  return process.env.YOUTUBE_REDIRECT_URI || `http://127.0.0.1:${port}/api/youtube/oauth/callback`;
}

async function exchangeYouTubeAuthorizationCode(code) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      code,
      client_id: process.env.YOUTUBE_CLIENT_ID || "",
      client_secret: process.env.YOUTUBE_CLIENT_SECRET || "",
      redirect_uri: youtubeRedirectUri(),
      grant_type: "authorization_code"
    }),
    signal:
      typeof AbortSignal !== "undefined" && AbortSignal.timeout
        ? AbortSignal.timeout(Number(process.env.YOUTUBE_TOKEN_TIMEOUT_MS || 30000))
        : undefined
  });
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(`YouTube OAuth code exchange failed.${youtubeApiErrorSuffix(payload, response.status)}`);
  }
  return payload;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function youtubeOAuthHtml(title, message, includeAppLink = false) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 40px; background: #111; color: #f6f1e8; }
      main { max-width: 640px; }
      p { color: #bdb7ad; line-height: 1.5; }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
      ${includeAppLink ? '<p><a href="http://127.0.0.1:5174/">Return to NewtBuilder</a></p>' : ""}
    </main>
  </body>
</html>`;
}

async function youtubeAccessToken() {
  const refreshToken = await youtubeRefreshToken();
  if (!youtubeOAuthClientConfigured() || !refreshToken) {
    throw new Error("YouTube OAuth is not configured.");
  }
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: process.env.YOUTUBE_CLIENT_ID || "",
      client_secret: process.env.YOUTUBE_CLIENT_SECRET || "",
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    }),
    signal:
      typeof AbortSignal !== "undefined" && AbortSignal.timeout
        ? AbortSignal.timeout(Number(process.env.YOUTUBE_TOKEN_TIMEOUT_MS || 30000))
        : undefined
  });
  const payload = await readJsonResponse(response);
  if (!response.ok || !payload?.access_token) {
    if (!process.env.YOUTUBE_REFRESH_TOKEN && youtubeRefreshTokenExpiredOrRevoked(payload)) {
      await clearStoredYouTubeRefreshToken();
    }
    throw new Error(`YouTube OAuth token refresh failed.${youtubeApiErrorSuffix(payload, response.status)}`);
  }
  return payload.access_token;
}

function youtubeRefreshTokenExpiredOrRevoked(payload) {
  const text = `${payload?.error || ""} ${payload?.error_description || ""} ${payload?.error?.message || ""} ${payload?.raw || ""}`.toLowerCase();
  return text.includes("invalid_grant") || text.includes("expired") || text.includes("revoked");
}

async function clearStoredYouTubeRefreshToken() {
  const stored = await readYouTubeOAuth();
  await writeFile(
    youtubeAuthPath,
    JSON.stringify(
      {
        ...stored,
        refreshToken: "",
        connectedAt: ""
      },
      null,
      2
    )
  );
}

async function uploadYouTubeVideo({ accessToken, videoPath, metadata }) {
  const uploadMetadata = {
    snippet: {
      title: metadata.youtube.title,
      description: metadata.youtube.description,
      categoryId: metadata.youtube.categoryId
    },
    status: {
      privacyStatus: "private",
      selfDeclaredMadeForKids: Boolean(metadata.youtube.madeForKids),
      containsSyntheticMedia: Boolean(metadata.youtube.containsSyntheticMedia)
    }
  };
  if (metadata.youtube.tags.length) {
    uploadMetadata.snippet.tags = metadata.youtube.tags;
  }

  const videoBuffer = await readFile(videoPath);
  const { body, contentType } = multipartRelatedBody([
    {
      contentType: "application/json; charset=UTF-8",
      body: Buffer.from(JSON.stringify(uploadMetadata), "utf8")
    },
    {
      contentType: videoMimeTypeForPath(videoPath),
      body: videoBuffer
    }
  ]);
  const url = new URL("https://www.googleapis.com/upload/youtube/v3/videos");
  url.searchParams.set("part", "snippet,status");
  url.searchParams.set("uploadType", "multipart");
  url.searchParams.set("notifySubscribers", "false");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": contentType,
      "Content-Length": String(body.length)
    },
    body,
    signal:
      typeof AbortSignal !== "undefined" && AbortSignal.timeout
        ? AbortSignal.timeout(Number(process.env.YOUTUBE_UPLOAD_TIMEOUT_MS || 900000))
        : undefined
  });
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(`YouTube video upload failed.${youtubeApiErrorSuffix(payload, response.status)}`);
  }
  return payload;
}

async function setYouTubeThumbnail({ accessToken, videoId, thumbnailPath, mimeType }) {
  const body = await readFile(thumbnailPath);
  const url = new URL("https://www.googleapis.com/upload/youtube/v3/thumbnails/set");
  url.searchParams.set("videoId", videoId);
  url.searchParams.set("uploadType", "media");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": mimeType,
      "Content-Length": String(body.length)
    },
    body,
    signal:
      typeof AbortSignal !== "undefined" && AbortSignal.timeout
        ? AbortSignal.timeout(Number(process.env.YOUTUBE_THUMBNAIL_TIMEOUT_MS || 120000))
        : undefined
  });
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(`YouTube thumbnail upload failed.${youtubeApiErrorSuffix(payload, response.status)}`);
  }
  return payload;
}

async function fetchYouTubeVideoStatus({ accessToken, videoId }) {
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "snippet,status,processingDetails");
  url.searchParams.set("id", videoId);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    signal:
      typeof AbortSignal !== "undefined" && AbortSignal.timeout
        ? AbortSignal.timeout(Number(process.env.YOUTUBE_STATUS_TIMEOUT_MS || 30000))
        : undefined
  });
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(`YouTube status check failed.${youtubeApiErrorSuffix(payload, response.status)}`);
  }
  const video = Array.isArray(payload.items) ? payload.items[0] : null;
  if (!video) {
    throw new Error("YouTube did not return the private draft. Make sure the connected account owns this upload.");
  }
  return {
    videoId: String(video.id || videoId),
    title: String(video.snippet?.title || ""),
    channelId: String(video.snippet?.channelId || ""),
    channelTitle: String(video.snippet?.channelTitle || ""),
    categoryId: String(video.snippet?.categoryId || ""),
    tags: Array.isArray(video.snippet?.tags) ? video.snippet.tags : [],
    privacyStatus: String(video.status?.privacyStatus || ""),
    uploadStatus: String(video.status?.uploadStatus || ""),
    madeForKids: Boolean(video.status?.madeForKids),
    selfDeclaredMadeForKids: Boolean(video.status?.selfDeclaredMadeForKids),
    embeddable: Boolean(video.status?.embeddable),
    publicStatsViewable: Boolean(video.status?.publicStatsViewable),
    publishAt: String(video.status?.publishAt || ""),
    license: String(video.status?.license || ""),
    processingStatus: String(video.processingDetails?.processingStatus || ""),
    processingFailureReason: String(video.processingDetails?.processingFailureReason || ""),
    processingProgress: video.processingDetails?.processingProgress || null
  };
}

async function prepareYouTubeThumbnail({ thumbnailPath, tempDir }) {
  const maxBytes = 2 * 1024 * 1024;
  const original = await stat(thumbnailPath);
  const originalMime = thumbnailMimeTypeForPath(thumbnailPath);
  if (original.size <= maxBytes && ["image/png", "image/jpeg"].includes(originalMime)) {
    return { filePath: thumbnailPath, mimeType: originalMime, converted: false };
  }

  const outputPath = path.join(tempDir, "thumbnail-youtube.jpg");
  const qualities = [3, 5, 7, 9, 12];
  for (const quality of qualities) {
    await execFileAsync(
      ffmpegPath,
      [
        "-y",
        "-i",
        thumbnailPath,
        "-vf",
        "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1",
        "-frames:v",
        "1",
        "-q:v",
        String(quality),
        outputPath
      ],
      { timeout: 90000, maxBuffer: 12 * 1024 * 1024 }
    );
    const converted = await stat(outputPath);
    if (converted.size <= maxBytes) {
      return { filePath: outputPath, mimeType: "image/jpeg", converted: true };
    }
  }
  throw new Error("Selected thumbnail is larger than YouTube's 2MB thumbnail limit, and automatic JPEG conversion could not get it below the limit.");
}

function multipartRelatedBody(parts) {
  const boundary = `newtbuilder-${randomUUID()}`;
  const chunks = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Type: ${part.contentType}\r\n\r\n`, "utf8"));
    chunks.push(Buffer.isBuffer(part.body) ? part.body : Buffer.from(String(part.body || ""), "utf8"));
    chunks.push(Buffer.from("\r\n", "utf8"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/related; boundary=${boundary}`
  };
}

async function readJsonResponse(response) {
  const text = await response.text().catch(() => "");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function youtubeApiErrorSuffix(payload, status) {
  const message = payload?.error?.message || payload?.error_description || payload?.raw || "";
  return message ? ` (${status}) ${compactText(message, 260)}` : ` (${status})`;
}

function videoMimeTypeForPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".mov" || ext === ".qt") return "video/quicktime";
  if (ext === ".webm") return "video/webm";
  if (ext === ".m4v") return "video/x-m4v";
  return "video/mp4";
}

function thumbnailMimeTypeForPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  return "application/octet-stream";
}

function thumbnailTitleText({ episode, show, thumbnailBrief = {} }) {
  const rawTitle = thumbnailBrief.superText || episode.drafts?.youtube?.title || episode.title || show.name || "New Episode";
  return wrapThumbnailText(rawTitle, 18, 3).toUpperCase();
}

function wrapThumbnailText(text, maxLineLength = 18, maxLines = 3) {
  const words = String(text || "")
    .replace(/[^\w\s'-]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const lines = [];
  for (const word of words) {
    const current = lines[lines.length - 1] || "";
    if (!current || `${current} ${word}`.length > maxLineLength) {
      if (lines.length >= maxLines) break;
      lines.push(word);
    } else {
      lines[lines.length - 1] = `${current} ${word}`;
    }
  }
  return lines.join("\n") || "NEW EPISODE";
}

function thumbnailVariants({ title, show }) {
  const style = show.creative?.thumbnailStyle || "bold character moment, clean text, strong expression";
  return [
    {
      id: "hook",
      label: "Hook Frame",
      position: 0.22,
      accent: "#ffd22e",
      text: title,
      prompt: `${style}. Hook frame with bold title overlay.`
    },
    {
      id: "moment",
      label: "Story Moment",
      position: 0.52,
      accent: "#40c7ff",
      text: title,
      prompt: `${style}. Mid-story moment with readable title overlay.`
    },
    {
      id: "final",
      label: "Final Beat",
      position: 0.78,
      accent: "#ff8a3d",
      text: title,
      prompt: `${style}. Final beat frame with high-contrast title overlay.`
    }
  ];
}

function thumbnailTimestamp(duration, position) {
  const safeDuration = Math.max(0, Number(duration) || 0);
  if (safeDuration <= 0.8) return 0;
  return Math.min(Math.max(0.35, safeDuration * position), Math.max(0.35, safeDuration - 0.35));
}

function thumbnailBriefStillPosition(value) {
  return {
    opening: 0.18,
    middle: 0.48,
    ending: 0.78
  }[String(value || "").toLowerCase()] || 0.48;
}

async function renderThumbnailCandidate({ sourcePath, outputPath, framePath, textPath, timestamp, width, height, variant }) {
  const filter = [
    `scale=${width}:${height}:force_original_aspect_ratio=increase`,
    `crop=${width}:${height}:x=(in_w-out_w)/2:y=(in_h-out_h)/2`,
    "eq=contrast=1.08:saturation=1.18",
    "format=rgb24"
  ].join(",");

  await execFileAsync(
    ffmpegPath,
    [
      "-y",
      "-ss",
      timestamp.toFixed(3),
      "-i",
      sourcePath,
      "-vf",
      filter,
      "-frames:v",
      "1",
      "-update",
      "1",
      framePath
    ],
    { timeout: 120000, maxBuffer: 18 * 1024 * 1024 }
  );

  await renderThumbnailOverlayWithPillow({ framePath, outputPath, textPath, width, height, variant });
}

async function extractThumbnailReferenceFrame({ sourcePath, outputPath, timestamp, width, height }) {
  const filter = [
    `scale=${width}:${height}:force_original_aspect_ratio=increase`,
    `crop=${width}:${height}:x=(in_w-out_w)/2:y=(in_h-out_h)/2`,
    "eq=contrast=1.04:saturation=1.08",
    "format=yuvj420p"
  ].join(",");

  await execFileAsync(
    ffmpegPath,
    [
      "-y",
      "-ss",
      timestamp.toFixed(3),
      "-i",
      sourcePath,
      "-vf",
      filter,
      "-frames:v",
      "1",
      "-update",
      "1",
      outputPath
    ],
    { timeout: 120000, maxBuffer: 18 * 1024 * 1024 }
  );
}

async function thumbnailReferenceAssetPaths({ episode, tempDir }) {
  const assets = Array.isArray(episode.assets) ? episode.assets.map(normalizeAsset) : [];
  const imageAssetsById = new Map(assets.filter((asset) => asset.type === "image" && asset.shotRole !== "mask").map((asset) => [asset.id, asset]));
  const usedAssetIds = await thumbnailUsedImageAssetIds(episode);
  const ranked = usedAssetIds.map((assetId) => imageAssetsById.get(assetId)).filter(Boolean);
  const seen = new Set();
  const references = [];
  for (const asset of ranked) {
    const sourcePath = resolveAssetPath(asset);
    if (!sourcePath || seen.has(sourcePath)) continue;
    seen.add(sourcePath);
    const outputPath = path.join(tempDir, `ref-${String(references.length + 1).padStart(2, "0")}.jpg`);
    await prepareThumbnailReferenceImage({ sourcePath, outputPath });
    references.push(outputPath);
    if (references.length >= 4) break;
  }
  return references;
}

async function thumbnailUsedImageAssetIds(episode) {
  const used = [];
  const seen = new Set();
  const add = (assetId) => {
    const id = cleanId(assetId);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    used.push(id);
    return true;
  };

  const manifestOutputs = (Array.isArray(episode.outputs) ? episode.outputs : [])
    .filter((output) => ["final_render_manifest", "render_manifest"].includes(output.type) && outputFilePath(output))
    .sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""));
  for (const output of manifestOutputs.slice(0, 1)) {
    const manifest = await readJson(outputFilePath(output), null);
    for (const line of Array.isArray(manifest?.lines) ? manifest.lines : []) {
      add(line?.image?.assetId);
      add(line?.endImage?.assetId);
      add(line?.assetId);
      add(line?.insertEndAssetId);
    }
    if (used.length) return used;
  }

  for (const line of normalizeProductionMapForFormat(episode.productionMap, episode.format)) {
    add(line.assetId);
    add(line.insertEndAssetId);
  }

  return used;
}

async function prepareThumbnailReferenceImage({ sourcePath, outputPath }) {
  await execFileAsync(
    ffmpegPath,
    [
      "-y",
      "-i",
      sourcePath,
      "-vf",
      "scale=1024:1024:force_original_aspect_ratio=decrease,format=yuvj420p",
      "-frames:v",
      "1",
      "-update",
      "1",
      outputPath
    ],
    { timeout: 120000, maxBuffer: 18 * 1024 * 1024 }
  );
}

function aiThumbnailPrompt({ episode, show, variant, title, vertical, thumbnailBrief = {} }) {
  const planBeats = Array.isArray(episode.plan?.beats) ? episode.plan.beats : [];
  const hook = compactText(planBeats[0]?.text || episode.drafts?.youtube?.description || episode.scriptText || episode.title, 420);
  const characterNames = thumbnailEpisodeCharacterNames({ episode, show }).join(", ");
  const visualStyle = show.creative?.visualStyle || "bright expressive 2D cartoon, polished animated short";
  const thumbnailStyle = show.creative?.thumbnailStyle || "bold character moment, clean text, strong expression";
  const aspect = vertical ? "vertical 9:16 video thumbnail" : "wide 16:9 YouTube thumbnail";
  const titleLine = title.replace(/\n/g, " ");
  const userInstruction =
    thumbnailBrief.prompt ||
    `Create a ${vertical ? "9x16" : "16x9"} YouTube thumbnail that includes the selected still frame, a dynamic super, and the provided episode information.`;
  const providedInfo = thumbnailBrief.details || episode.drafts?.youtube?.description || "";
  return compactText(
    [
      `User thumbnail prompt: ${userInstruction}`,
      `Create a premium ${aspect} for the show "${show.name}".`,
      "Use Image 1 as the selected still frame and compositional base. Use the other provided images only as visual references for character identity and show style for images used in the current video.",
      `Dynamic super text to include exactly, large and readable: "${titleLine}".`,
      providedInfo ? `Provided episode information: ${compactText(providedInfo, 700)}.` : "",
      `Preserve the exact character designs, color palette, and episode visual style from the references.`,
      `Visual style: ${visualStyle}. Thumbnail style: ${thumbnailStyle}.`,
      characterNames ? `Current episode characters to preserve when present: ${characterNames}.` : "",
      `Story hook: ${hook}.`,
      `Composition: ${variant.prompt}. Make one clear emotional focal point, strong readable faces, clean negative space for the title, bright child-friendly polish, high contrast, and no clutter.`,
      "Constraints: no logos, no watermark, no captions beyond the dynamic super text, no misspelled text, no photoreal humans, no distorted faces, no extra characters beyond the selected still frame, current episode characters, and current video image references."
    ]
      .filter(Boolean)
      .join(" "),
    3000
  );
}

function thumbnailEpisodeCharacterNames({ episode, show }) {
  const charactersById = new Map((show?.characters || []).map((character) => [character.id, character.name]));
  return uniqueStrings(
    normalizeProductionMapForFormat(episode.productionMap, episode.format)
      .filter((line) => line.lineType !== "insert")
      .map((line) => charactersById.get(line.characterId) || line.character || line.speaker)
      .map((name) => {
        const trimmed = String(name || "").replace(/^@/, "").trim();
        return /^[A-Z\s]+$/.test(trimmed) ? trimmed.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase()) : trimmed;
      })
      .filter(Boolean)
  );
}

async function runFalGptImageThumbnail({ imageUrls, prompt, width, height }) {
  const modelId = process.env.FAL_THUMBNAIL_MODEL || "openai/gpt-image-2/edit";
  const body = {
    prompt,
    image_urls: imageUrls,
    image_size: { width, height },
    quality: falThumbnailQuality(),
    num_images: 1,
    output_format: "png"
  };

  const response = await fetch(`https://fal.run/${modelId}`, {
    method: "POST",
    headers: {
      Authorization: `Key ${falApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body),
    signal:
      typeof AbortSignal !== "undefined" && AbortSignal.timeout
        ? AbortSignal.timeout(Number(process.env.FAL_THUMBNAIL_TIMEOUT_MS || 900000))
        : undefined
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`fal GPT Image 2 returned ${response.status}${detail ? `: ${compactText(detail, 260)}` : ""}`);
  }

  return response.json();
}

function falThumbnailQuality() {
  const quality = String(process.env.FAL_THUMBNAIL_QUALITY || "high").toLowerCase();
  return ["auto", "low", "medium", "high"].includes(quality) ? quality : "high";
}

function sanitizeThumbnailBrief(brief = {}) {
  const stillFrame = ["opening", "middle", "ending"].includes(String(brief.stillFrame || "").toLowerCase())
    ? String(brief.stillFrame).toLowerCase()
    : "middle";
  return {
    prompt: preserveInputText(brief.prompt, 1000),
    superText: preserveInputText(brief.superText, 140),
    details: preserveInputText(brief.details, 1600),
    stillFrame
  };
}

function preserveInputText(value, maxLength) {
  const normalized = String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\t/g, "  ")
    .replace(/[^\S\n]+$/gm, "")
    .trim();
  if (normalized.length <= maxLength) return normalized;
  return normalized.slice(0, maxLength).replace(/[^\S\n]+$/gm, "").trimEnd();
}

async function renderThumbnailOverlayWithPillow({ framePath, outputPath, textPath, width, height, variant }) {
  const python = findImagePython();
  const configPath = `${outputPath}.json`;
  await writeFile(
    configPath,
    JSON.stringify(
      {
        framePath,
        outputPath,
        textPath,
        width,
        height,
        accent: variant.accent
      },
      null,
      2
    )
  );
  const code = String.raw`
import json
import os
import sys
from PIL import Image, ImageDraw, ImageFont

config = json.load(open(sys.argv[1], "r", encoding="utf-8"))
frame_path = config["framePath"]
output_path = config["outputPath"]
text_path = config["textPath"]
width = int(config["width"])
height = int(config["height"])
accent = config.get("accent", "#ffd22e")
text = open(text_path, "r", encoding="utf-8").read().strip() or "NEW EPISODE"

img = Image.open(frame_path).convert("RGBA")
if img.size != (width, height):
    img = img.resize((width, height), Image.Resampling.LANCZOS)

overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
draw = ImageDraw.Draw(overlay)
band_h = int(height * (0.34 if width >= height else 0.30))
draw.rectangle((0, height - band_h, width, height), fill=(0, 0, 0, 150))

font_candidates = [
    "/System/Library/Fonts/Supplemental/Arial Black.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/Library/Fonts/Arial Bold.ttf",
]
font_path = next((item for item in font_candidates if os.path.exists(item)), None)
font_size = int(68 if width >= height else 92)
try:
    font = ImageFont.truetype(font_path, font_size) if font_path else ImageFont.load_default()
except Exception:
    font = ImageFont.load_default()

stroke = int(6 if width >= height else 8)
spacing = int(8 if width >= height else 10)
bbox = draw.multiline_textbbox((0, 0), text, font=font, spacing=spacing, stroke_width=stroke, align="center")
text_w = bbox[2] - bbox[0]
text_h = bbox[3] - bbox[1]
x = (width - text_w) / 2
y = height - int(height * (0.20 if width >= height else 0.19)) - text_h / 2
draw.multiline_text(
    (x, y),
    text,
    font=font,
    fill=(255, 255, 255, 255),
    spacing=spacing,
    align="center",
    stroke_width=stroke,
    stroke_fill=(0, 0, 0, 220),
)

try:
    accent_rgb = tuple(int(accent.lstrip("#")[i:i+2], 16) for i in (0, 2, 4))
except Exception:
    accent_rgb = (255, 210, 46)
border = int(6 if width >= height else 8)
for inset in range(border):
    draw.rectangle((inset, inset, width - 1 - inset, height - 1 - inset), outline=accent_rgb + (245,))

Image.alpha_composite(img, overlay).convert("RGB").save(output_path, "PNG")
`;

  try {
    await execFileAsync(python, ["-c", code, configPath], { timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
  } finally {
    await rm(configPath, { force: true });
  }
}

function findImagePython() {
  const candidates = [
    process.env.NEWTBUILDER_IMAGE_PYTHON,
    process.env.NEWTBUILDER_PYTHON_PATH,
    "python3",
    "python"
  ].filter(Boolean);

  return (
    candidates.find((candidate) => {
      if (candidate.includes("/") && !existsSync(candidate)) return false;
      return true;
    }) || "python3"
  );
}

function finalStillFitFilters({ width, height }) {
  return [
    `scale=${width}:${height}:force_original_aspect_ratio=increase`,
    `crop=${width}:${height}:x=(in_w-out_w)/2:y=(in_h-out_h)/2`
  ];
}

async function probeDuration(filePath) {
  try {
    const { stdout } = await execFileAsync(
      ffprobePath,
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", filePath],
      { timeout: 30000, maxBuffer: 1024 * 1024 }
    );
    return roundSeconds(Number(stdout) || 0);
  } catch {
    return 0;
  }
}

async function probeVideoFrameRate(filePath) {
  try {
    const { stdout } = await execFileAsync(
      ffprobePath,
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=avg_frame_rate,r_frame_rate",
        "-of",
        "json",
        filePath
      ],
      { timeout: 30000, maxBuffer: 1024 * 1024 }
    );
    const stream = JSON.parse(stdout)?.streams?.[0] || {};
    return parseFrameRateValue(stream.avg_frame_rate) || parseFrameRateValue(stream.r_frame_rate) || 25;
  } catch {
    return 25;
  }
}

function parseFrameRateValue(value) {
  const text = String(value || "").trim();
  const fraction = text.match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
  if (fraction) {
    const numerator = Number(fraction[1]);
    const denominator = Number(fraction[2]);
    return denominator > 0 ? Math.max(0.1, Math.min(240, numerator / denominator)) : 0;
  }
  const number = Number(text);
  return Number.isFinite(number) && number > 0 ? Math.max(0.1, Math.min(240, number)) : 0;
}

async function probeHasAudio(filePath) {
  try {
    const { stdout } = await execFileAsync(
      ffprobePath,
      [
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=index",
        "-of",
        "csv=p=0",
        filePath
      ],
      { timeout: 30000, maxBuffer: 1024 * 1024 }
    );
    return Boolean(String(stdout || "").trim());
  } catch {
    return false;
  }
}

async function probeMediaDimensions(filePath) {
  try {
    const { stdout } = await execFileAsync(
      ffprobePath,
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-of",
        "json",
        filePath
      ],
      { timeout: 30000, maxBuffer: 1024 * 1024 }
    );
    const stream = JSON.parse(stdout)?.streams?.[0] || {};
    return {
      width: Math.max(0, Math.round(Number(stream.width) || 0)),
      height: Math.max(0, Math.round(Number(stream.height) || 0))
    };
  } catch {
    return { width: 0, height: 0 };
  }
}

async function readImageDimensions(filePath) {
  try {
    return imageDimensionsFromBuffer(await readFile(filePath));
  } catch {
    return { width: 0, height: 0 };
  }
}

function imageDimensionsFromBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) return { width: 0, height: 0 };
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20)
    };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      while (offset < buffer.length && buffer[offset] !== 0xff) offset += 1;
      while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
      const marker = buffer[offset];
      offset += 1;
      if (!marker || marker === 0xd9 || marker === 0xda) break;
      if (offset + 2 > buffer.length) break;
      const segmentLength = buffer.readUInt16BE(offset);
      const isStartOfFrame =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);
      if (isStartOfFrame && offset + 7 < buffer.length) {
        return {
          width: buffer.readUInt16BE(offset + 5),
          height: buffer.readUInt16BE(offset + 3)
        };
      }
      offset += segmentLength;
    }
  }
  return { width: 0, height: 0 };
}

async function attachPreviewToReport(report, preview) {
  const updated = {
    ...report,
    preview: {
      mode: preview.manifest.mode,
      renderNote: preview.manifest.renderNote,
      totalSeconds: preview.manifest.totalSeconds,
      manifestUrl: preview.manifest.localUrl,
      audioMode: preview.manifest.audio?.mode || "",
      audioUrl: preview.manifest.audio?.localUrl || "",
      audioDurationSeconds: preview.manifest.audio?.durationSeconds || 0,
      audioWarnings: preview.manifest.audio?.warnings || [],
      videoUrl: preview.video?.localUrl || "",
      videoDurationSeconds: preview.video?.durationSeconds || 0,
      renderError: preview.manifest.renderError || ""
    }
  };
  await writeFile(path.join(outputsDir, "build-reports", report.fileName), JSON.stringify(updated, null, 2));
  return updated;
}

function stripPrivateManifestFields(manifest) {
  return {
    ...manifest,
    lines: manifest.lines.map(({ imagePath, maskPath, videoPath, ...line }) => ({
      ...line,
      audio: line.audio ? stripPrivateAudioFields(line.audio) : line.audio
    }))
  };
}

function stripPrivateAudioFields(audio) {
  const { filePath, ...cleanAudio } = audio;
  return cleanAudio;
}

function attachAudioTakesToProductionMap(productionMap = [], manifestLines = []) {
  const linesById = new Map((manifestLines || []).map((line) => [line.id, line]));
  return (Array.isArray(productionMap) ? productionMap : []).map((line, index) => {
    const normalized = normalizeProductionLine(line, index);
    const manifestLine = linesById.get(normalized.id);
    if (!manifestLine?.audioTake && !manifestLine?.videoTake) return normalized;
    const audioTake = normalizeAudioTake(manifestLine.audioTake);
    const videoTake = normalizeVideoTake(manifestLine.videoTake);
    const audioStatus =
      ["approved", "hold"].includes(normalized.audioStatus) && audioTake?.signature === lineAudioSignature(normalized)
        ? normalized.audioStatus
        : "pending";
    const nextVideoTake = videoTake || normalized.videoTake;
    const videoStatus =
      ["approved", "hold"].includes(normalized.videoStatus) && nextVideoTake?.signature
        ? normalized.videoStatus
        : videoTake
          ? "generated"
          : normalized.videoStatus;
    return normalizeProductionLine(
      {
        ...normalized,
        audioStatus,
        audioTake,
        videoStatus,
        videoTake: nextVideoTake,
        videoTakes: normalizeVideoTakes(videoTake ? [videoTake, ...(normalized.videoTakes || [])] : normalized.videoTakes, nextVideoTake)
      },
      index
    );
  });
}

function attachRecoveredAudioTakesToProductionMap(productionMap = [], recoveredAudioTakes = new Map()) {
  return (Array.isArray(productionMap) ? productionMap : []).map((line, index) => {
    const normalized = normalizeProductionLine(line, index);
    const audioTake = normalizeAudioTake(recoveredAudioTakes.get(normalized.id));
    if (!audioTake) return normalized;
    return normalizeProductionLine(
      {
        ...normalized,
        audioTake,
        audioStatus: ["approved", "hold"].includes(normalized.audioStatus) ? normalized.audioStatus : "pending"
      },
      index
    );
  });
}

async function recoverAudioTakeForLineFromManifests({ episode, line }) {
  const expectedSignature = lineAudioSignature(line);
  const manifestOutputs = (Array.isArray(episode.outputs) ? episode.outputs : [])
    .filter((output) => ["final_render_manifest", "render_manifest"].includes(output.type))
    .sort((a, b) => Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""));

  for (const output of manifestOutputs) {
    const manifestPath = outputFilePath(output);
    if (!manifestPath) continue;
    const manifest = await readJson(manifestPath, null);
    const manifestLines = Array.isArray(manifest?.lines) ? manifest.lines : [];
    const orderedLines = [
      ...manifestLines.filter((candidate) => candidate.id === line.id),
      ...manifestLines.filter((candidate) => candidate.id !== line.id)
    ];

    for (const candidate of orderedLines) {
      const audioTake = normalizeAudioTake(candidate.audioTake || candidate.audio);
      if (!audioTake || audioTake.signature !== expectedSignature) continue;
      if (audioTakeFilePath(audioTake)) return audioTake;
    }
  }

  return null;
}

function parseResolution(resolution, aspectRatio) {
  const match = String(resolution || "").match(/^(\d+)x(\d+)$/);
  if (match) {
    return { width: Number(match[1]), height: Number(match[2]) };
  }
  return aspectRatio === "16:9" ? { width: 1920, height: 1080 } : { width: 1080, height: 1920 };
}

function defaultResolutionForAspect(aspectRatio) {
  return aspectRatio === "16:9" ? "1920x1080" : "1080x1920";
}

function normalizeResolutionValue(resolution) {
  return String(resolution || "")
    .trim()
    .toLowerCase()
    .replace(/[×*]/g, "x")
    .replace(/\s+/g, "");
}

function sanitizeFormatResolution(resolution, aspectRatio) {
  const normalized = normalizeResolutionValue(resolution);
  const allowed = standardFormatResolutions[aspectRatio] || standardFormatResolutions["9:16"];
  return allowed.has(normalized) ? normalized : defaultResolutionForAspect(aspectRatio);
}
function roundSeconds(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function createAudioTake({ line, filePath, localUrl, generatedAudio, source }) {
  return normalizeAudioTake({
    id: randomUUID(),
    fileName: path.basename(filePath),
    localUrl,
    mode: generatedAudio.mode,
    voiceName: generatedAudio.voiceName,
    voiceId: generatedAudio.voiceId || line.voiceId,
    warning: generatedAudio.warning || "",
    durationSeconds: generatedAudio.durationSeconds,
    signature: lineAudioSignature(line),
    source,
    generatedAt: new Date().toISOString()
  });
}

function createVideoTake({ line, format, filePath, localUrl, proxyFilePath, proxyLocalUrl, remoteUrl, result, prompt, source }) {
  const mode = insertVideoModeForLine(line);
  const { width, height } = parseResolution(format.resolution, format.aspectRatio);
  return normalizeVideoTake({
    id: randomUUID(),
    fileName: path.basename(filePath),
    localUrl,
    proxyFileName: proxyFilePath ? path.basename(proxyFilePath) : "",
    proxyLocalUrl,
    remoteUrl,
    model: seedanceModelId(mode),
    prompt,
    seed: result?.seed,
    warning: "",
    durationSeconds: 0,
    signature: lineVideoSignature(line, format),
    source,
    width,
    height,
    resolution: `${width}x${height}`,
    aspectRatio: format.aspectRatio || "",
    generatedAt: new Date().toISOString()
  });
}

async function createUploadedInsertVideoTake({ episode, line, format, uploadedFile }) {
  const runId = randomUUID();
  const videoDir = path.join(outputsDir, "insert-videos", episode.id);
  await mkdir(videoDir, { recursive: true });

  const extension = videoExtensionForPath(uploadedFile.originalname || uploadedFile.filename);
  const baseName = safeFileSegment(path.basename(uploadedFile.originalname || "custom-insert", path.extname(uploadedFile.originalname || "")));
  const fileName = `insert-${String(line.index).padStart(3, "0")}-${runId.slice(0, 8)}-${baseName}${extension}`;
  const filePath = path.join(videoDir, fileName);
  const uploadedPath = path.join(uploadsDir, uploadedFile.filename);
  await copyFile(uploadedPath, filePath);
  await deleteStoredUpload(uploadedFile.filename);

  const proxyFileName = `insert-${String(line.index).padStart(3, "0")}-${runId.slice(0, 8)}-${baseName}-proxy.mp4`;
  const proxyFilePath = path.join(videoDir, proxyFileName);
  let proxyLocalUrl = `/outputs/insert-videos/${episode.id}/${proxyFileName}`;
  let warning = "";
  try {
    await writeVideoProxy({ sourcePath: filePath, outputPath: proxyFilePath });
  } catch (error) {
    proxyLocalUrl = "";
    warning = `Preview proxy could not be created. The original uploaded clip will still be used. ${cleanErrorMessage(error)}`;
  }

  const durationSeconds = (await probeDuration(filePath)) || (proxyLocalUrl ? await probeDuration(proxyFilePath) : 0);
  return normalizeVideoTake({
    id: randomUUID(),
    fileName,
    localUrl: `/outputs/insert-videos/${episode.id}/${fileName}`,
    proxyFileName: proxyLocalUrl ? proxyFileName : "",
    proxyLocalUrl,
    remoteUrl: "",
    model: "user-upload",
    prompt: String(line.videoPrompt || line.text || "").trim(),
    seed: null,
    warning,
    durationSeconds,
    signature: `user-upload:${runId}`,
    source: "user-upload",
    generatedAt: new Date().toISOString()
  });
}

function isVideoUploadFile(file) {
  const mimeType = String(file?.mimetype || "").toLowerCase();
  if (mimeType.startsWith("video/")) return true;
  return [file?.originalname, file?.filename].some((name) => [".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv"].includes(path.extname(String(name || "")).toLowerCase()));
}

function videoExtensionForPath(filePath) {
  const ext = path.extname(String(filePath || "")).toLowerCase();
  return [".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv"].includes(ext) ? ext : ".mp4";
}

function reusableAudioTakeForLine(line) {
  const take = normalizeAudioTake(line.audioTake);
  if (!take || take.signature !== lineAudioSignature(line)) return null;
  return audioTakeFilePath(take) ? take : null;
}

function reusableVideoTakeForLine(line, imageAsset, endImageAsset, format, maskAsset = null, context = {}) {
  const take = context.preferLatestVideoTake ? latestExistingVideoTakeForLine(line) : normalizeVideoTake(line.videoTake);
  if (!take) return null;
  if (take.source === "user-upload") return videoTakeFilePath(take) ? take : null;
  if (context.reuseExistingVideoTake && videoTakeFilePath(take)) return take;
  if (line.lineType !== "insert") {
    const maskPath = resolveAssetPath(maskAsset);
    const visualLipSyncModel = sanitizeOptionalLipSyncModel(imageAsset?.metadata?.lipSyncModel);
    const visualLipSyncPrompt = lineLipSyncInputPrompt(line, imageAsset);
    const visualAnimationStrength = animationStrengthForAsset(imageAsset);
    const resolvedAnimationStrength = animationStrengthForLine(line, imageAsset);
    const signatureLine = {
      ...line,
      visualLipSyncModel,
      visualLipSyncPrompt,
      visualAnimationStrength,
      animationStrength: resolvedAnimationStrength,
      image: imageAsset
        ? {
            assetId: imageAsset.id,
            fileName: imageAsset.fileName,
            localUrl: imageAsset.localUrl,
            shotRole: effectiveAssetShotRole(imageAsset),
            speakingTag: imageAsset.metadata?.speakingTag || imageAsset.metadata?.characterTags || "",
            speakingRoles: assetSpeakingRoles(imageAsset),
            lipSyncModel: visualLipSyncModel,
            lipSyncPrompt: visualLipSyncPrompt,
            animationStrength: visualAnimationStrength
          }
        : null,
      needsMask: Boolean(maskPath),
      mask: maskPath && maskAsset
        ? {
            assetId: maskAsset.id,
            fileName: maskAsset.fileName,
            localUrl: maskAsset.localUrl
          }
        : null,
      infiniteTalkBackend: line.infiniteTalkBackend || infiniteTalkBackendForShow(context.show)
    };
    const provider = lipSyncModelForLine(signatureLine, {
      imageAsset,
      character: context.character,
      show: context.show
    });
    const providerConfig = lipSyncProviderConfig(provider, { line: signatureLine });
    const prompt = lipSyncPromptForLine(signatureLine, provider);
    const signature = lineLipSyncSignature(signatureLine, format, {
      provider,
      modelId: providerConfig.modelId,
      prompt
    });
    if (take.signature !== signature) return null;
    return videoTakeFilePath(take) ? take : null;
  }
  const signatureLine = {
    ...line,
    image: imageAsset
      ? {
          assetId: imageAsset.id,
          fileName: imageAsset.fileName,
          localUrl: imageAsset.localUrl
        }
      : null,
    endImage: endImageAsset
      ? {
          assetId: endImageAsset.id,
          fileName: endImageAsset.fileName,
          localUrl: endImageAsset.localUrl
        }
      : null
  };
  if (take.signature !== lineVideoSignature(signatureLine, format)) return null;
  return videoTakeFilePath(take) ? take : null;
}

function latestExistingVideoTakeForLine(line) {
  const candidates = normalizeVideoTakes(line?.videoTakes, line?.videoTake)
    .map((take, index) => ({
      take,
      index,
      timestamp: videoTakeGeneratedTimestamp(take)
    }))
    .filter(({ take }) => Boolean(videoTakeFilePath(take)));
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.timestamp - a.timestamp || a.index - b.index);
  return candidates[0].take;
}

function videoTakeGeneratedTimestamp(take) {
  const timestamp = Date.parse(String(take?.generatedAt || ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function audioTakeFilePath(take) {
  const localUrl = String(take?.localUrl || "");
  if (!localUrl.startsWith("/outputs/")) return "";
  const filePath = path.resolve(rootDir, `.${localUrl}`);
  const outputRoot = path.resolve(outputsDir);
  if (!filePath.startsWith(`${outputRoot}${path.sep}`) || !existsSync(filePath)) return "";
  return filePath;
}

function videoTakeFilePath(take) {
  const localUrl = String(take?.localUrl || "");
  if (!localUrl.startsWith("/outputs/")) return "";
  const filePath = path.resolve(rootDir, `.${localUrl}`);
  const outputRoot = path.resolve(outputsDir);
  if (!filePath.startsWith(`${outputRoot}${path.sep}`) || !existsSync(filePath)) return "";
  return filePath;
}

function lineAudioSignature(line) {
  return JSON.stringify({
    speaker: String(line.speaker || "").trim(),
    voiceId: String(line.voiceId || "").trim(),
    text: plainSpeechText(line),
    audioTags: sanitizeAudioTags(line.audioTags),
    provider: audioProviderMode(),
    modelId: process.env.ELEVEN_MODEL_ID || "eleven_v3",
    outputFormat: process.env.ELEVEN_OUTPUT_FORMAT || "mp3_44100_128",
    voiceSettings: elevenVoiceSettings()
  });
}

function lineVideoSignature(line, format = {}) {
  const mode = insertVideoModeForLine(line);
  return JSON.stringify({
    model: seedanceModelId(mode),
    mode,
    prompt: insertVideoPrompt(line),
    imageAssetId: line.image?.assetId || line.assetId || "",
    imageLocalUrl: line.image?.localUrl || "",
    endImageAssetId: mode === "first_last_frame" ? line.endImage?.assetId || line.insertEndAssetId || "" : "",
    endImageLocalUrl: mode === "first_last_frame" ? line.endImage?.localUrl || "" : "",
    duration: insertVideoDurationSeconds(line),
    aspectRatio: format.aspectRatio || "",
    resolution: seedanceResolution(),
    generateAudio: false
  });
}

function insertVideoModeForLine(line = {}) {
  return sanitizeInsertVideoMode(line.insertVideoMode);
}

function seedanceModelId(mode = "reference") {
  const normalizedMode = sanitizeInsertVideoMode(mode);
  if (normalizedMode === "reference") {
    return process.env.FAL_SEEDANCE_REFERENCE_MODEL || process.env.FAL_SEEDANCE_MODEL || "bytedance/seedance-2.0/reference-to-video";
  }
  return process.env.FAL_SEEDANCE_IMAGE_MODEL || process.env.FAL_SEEDANCE_MODEL || "bytedance/seedance-2.0/image-to-video";
}

function seedanceResolution() {
  return process.env.FAL_SEEDANCE_RESOLUTION || "720p";
}

function assetLipSyncPrompt(asset) {
  return compactText(String(asset?.metadata?.lipSyncPrompt || "").trim(), lipSyncInputPromptMaxLength);
}

function lineLipSyncInputPrompt(line, imageAsset) {
  return compactText(String(line?.lipSyncInputPromptOverride || "").trim(), lipSyncInputPromptMaxLength) || assetLipSyncPrompt(imageAsset);
}

function visualReferencePromptForLine(line) {
  const prompt = compactText(
    String(
      line?.visualLipSyncPrompt ||
        line?.lipSyncInputPromptOverride ||
        line?.image?.lipSyncPrompt ||
        line?.assetLipSyncPrompt ||
        ""
    ).trim(),
    lipSyncInputPromptMaxLength
  );
  return prompt ? `Visual reference: ${prompt}` : "";
}

function sanitizeInfiniteTalkPositivePromptText(value) {
  let text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  text = text
    .replace(/\blarge expressive black eye disks?\b/gi, "flat matte black painted eye shapes")
    .replace(/\blarge expressive black eyes holes?\b/gi, "flat matte black painted eye shapes")
    .replace(/\bexpressive black eye disks?\b/gi, "flat matte black painted eye shapes")
    .replace(/\bblack eye disks?\b/gi, "flat matte black painted eye shapes")
    .replace(/\bblack eyes holes?\b/gi, "flat matte black painted eye shapes")
    .replace(
      /\bthe eye (?:disks?|shapes?) may squint, blink, compress, stretch, or change shape for expression, but must always remain solid black painted eye (?:disks?|shapes?)\.?/gi,
      "The painted eye shapes remain flat, matte, black, and unchanged."
    );
  const blockedPositiveTerms =
    /\b(pupils?|irises?|eyeballs?|sclera|human eyes?|realistic eyes?|cg eyes?|3d eyes?|cartoon eyes?|animated eyes?|anime eyes?|cute eyes?|eye whites?|catchlights?|eye reflections?|glass eyes?|eyelids?)\b/i;
  const blockedEyeActions = /\b(squint|blink|compress|stretch|change shape)\b/i;
  const sentences = text.match(/[^.!?]+[.!?]?/g) || [text];
  return sentences
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence && !blockedPositiveTerms.test(sentence))
    .filter((sentence) => !(sentence.toLowerCase().includes("eye") && blockedEyeActions.test(sentence)))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function infiniteTalkVisualReferencePromptForLine(line) {
  const prompt = compactText(
    sanitizeInfiniteTalkPositivePromptText(
      String(
        line?.visualLipSyncPrompt ||
          line?.lipSyncInputPromptOverride ||
          line?.image?.lipSyncPrompt ||
          line?.assetLipSyncPrompt ||
          ""
      ).trim()
    ),
    lipSyncInputPromptMaxLength
  );
  return prompt ? `Visual reference: ${prompt}` : "";
}

function lipSyncPromptLengthForProvider(provider) {
  const normalized = sanitizeLipSyncModel(provider);
  if (normalized === "kling") return 3000;
  if (normalized === "aurora") return lipSyncFullPromptMaxLength;
  if (normalized === "infinitalk") return lipSyncFullPromptMaxLength;
  return lipSyncFullPromptMaxLength;
}

function lipSyncModelForLine(line, context = {}) {
  const shotOverride = sanitizeOptionalLipSyncModel(line?.lipSyncModelOverride || line?.lipSyncModel);
  if (shotOverride) return shotOverride;
  const assetModel = sanitizeOptionalLipSyncModel(context.imageAsset?.metadata?.lipSyncModel || line?.visualLipSyncModel || line?.image?.lipSyncModel);
  if (assetModel) return assetModel;
  const characterModel = sanitizeOptionalLipSyncModel(context.character?.lipSyncModel);
  if (characterModel) return characterModel;
  return sanitizeLipSyncModel(context.show?.production?.defaultLipSyncModel || defaultLipSyncModel());
}

function defaultLipSyncModel() {
  return sanitizeLipSyncModel(process.env.NEWTBUILDER_DEFAULT_LIPSYNC_MODEL || "fabric");
}

function animationStrengthValueIsSet(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function roundAnimationStrength(value) {
  return Math.round(Number(value) * 10) / 10;
}

function defaultAnimationStrength() {
  const configured = [
    process.env.NEWTBUILDER_ANIMATION_STRENGTH,
    process.env.COMFYUI_INFINITALK_AUDIO_CFG_SCALE
  ].find((value) => animationStrengthValueIsSet(value));
  const number = Number(configured);
  if (!Number.isFinite(number)) return animationStrengthDefault;
  return roundAnimationStrength(clampNumber(number, 0, 5));
}

function normalizeAnimationStrength(value, fallback = defaultAnimationStrength()) {
  if (!animationStrengthValueIsSet(value)) return normalizeAnimationStrength(fallback, animationStrengthDefault);
  const number = Number(value);
  if (!Number.isFinite(number)) return normalizeAnimationStrength(fallback, animationStrengthDefault);
  return roundAnimationStrength(clampNumber(number, 0, 5));
}

function normalizeOptionalAnimationStrength(value) {
  if (!animationStrengthValueIsSet(value)) return null;
  return normalizeAnimationStrength(value);
}

function animationStrengthForAsset(asset) {
  const value = normalizeOptionalAnimationStrength(asset?.metadata?.animationStrength);
  return value === null ? defaultAnimationStrength() : value;
}

function animationStrengthForLine(line, imageAsset = null) {
  const override = normalizeOptionalAnimationStrength(line?.animationStrengthOverride);
  if (override !== null) return override;
  const resolvedLineValue = normalizeOptionalAnimationStrength(line?.animationStrength);
  if (resolvedLineValue !== null) return resolvedLineValue;
  const assetValue = normalizeOptionalAnimationStrength(imageAsset?.metadata?.animationStrength ?? line?.image?.animationStrength);
  return assetValue === null ? defaultAnimationStrength() : assetValue;
}

function defaultInfiniteTalkBackend() {
  return sanitizeInfiniteTalkBackend(process.env.NEWTBUILDER_INFINITALK_BACKEND || "fal");
}

function infiniteTalkBackendForShow(show) {
  return sanitizeInfiniteTalkBackend(show?.production?.infiniteTalkBackend || defaultInfiniteTalkBackend());
}

function infiniteTalkBackendForLine(line = {}, manifest = {}) {
  return sanitizeInfiniteTalkBackend(line.infiniteTalkBackend || manifest?.lipSync?.infiniteTalkBackend || defaultInfiniteTalkBackend());
}

function localInfiniteTalkConfigured() {
  const repoDir = String(
    process.env.LOCAL_INFINITALK_REPO_DIR ||
      process.env.NEWTBUILDER_INFINITALK_REPO_DIR ||
      process.env.INFINITALK_REPO_DIR ||
      ""
  ).trim();
  return Boolean(repoDir && existsSync(path.resolve(repoDir)));
}

function comfyUiBaseUrl() {
  return String(process.env.COMFYUI_BASE_URL || "http://127.0.0.1:8188").trim().replace(/\/+$/, "");
}

function comfyUiRootDir() {
  const configured = String(process.env.COMFYUI_ROOT_DIR || process.env.COMFYUI_DIR || "").trim();
  if (configured) return path.resolve(configured);
  const desktopPath = "D:\\_AI\\Comfyui_1_0_4\\ComfyUI";
  return existsSync(desktopPath) ? desktopPath : "";
}

function comfyUiInputDir() {
  const configured = String(process.env.COMFYUI_INPUT_DIR || "").trim();
  if (configured) return path.resolve(configured);
  const root = comfyUiRootDir();
  return root ? path.join(root, "input") : "";
}

function comfyUiOutputDir() {
  const configured = String(process.env.COMFYUI_OUTPUT_DIR || "").trim();
  if (configured) return path.resolve(configured);
  const root = comfyUiRootDir();
  return root ? path.join(root, "output") : "";
}

function comfyUiTempDir() {
  const configured = String(process.env.COMFYUI_TEMP_DIR || "").trim();
  if (configured) return path.resolve(configured);
  const root = comfyUiRootDir();
  return root ? path.join(root, "temp") : "";
}

function comfyUiInfiniteTalkWorkflowPath() {
  const configured = String(process.env.COMFYUI_INFINITALK_WORKFLOW || "").trim();
  return configured ? path.resolve(configured) : "";
}

function comfyUiInfiniteTalkConfigured() {
  const workflowPath = comfyUiInfiniteTalkWorkflowPath();
  const inputDir = comfyUiInputDir();
  const outputDir = comfyUiOutputDir();
  return Boolean(workflowPath && existsSync(workflowPath) && inputDir && existsSync(inputDir) && outputDir && existsSync(outputDir));
}

function comfyUiInfiniteTalkModelId() {
  return process.env.COMFYUI_INFINITALK_MODEL_ID || "comfyui-infinitalk";
}

function cleanupComfyUiProgressEntries() {
  const now = Date.now();
  const activeTtlMs = Number(process.env.COMFYUI_PROGRESS_ACTIVE_TTL_MS || 6 * 60 * 60 * 1000);
  const doneTtlMs = Number(process.env.COMFYUI_PROGRESS_DONE_TTL_MS || 5 * 60 * 1000);
  for (const [key, entry] of comfyUiProgressEntries.entries()) {
    const updatedAt = Date.parse(entry.updatedAt || entry.startedAt || "") || 0;
    const terminal = ["complete", "error", "cancelled"].includes(String(entry.status || "").toLowerCase());
    const ttl = terminal ? doneTtlMs : activeTtlMs;
    if (!updatedAt || now - updatedAt > ttl) comfyUiProgressEntries.delete(key);
  }
}

function comfyUiProgressKey(context = {}) {
  const episodeId = String(context.episodeId || "episode").trim() || "episode";
  const lineId = String(context.lineId || context.promptId || "render").trim() || "render";
  return `${episodeId}:${lineId}`;
}

function comfyUiProgressContext({ manifest = {}, line = {}, filenamePrefix = "" } = {}) {
  return {
    episodeId: String(manifest?.episode?.id || line?.episodeId || "").trim(),
    episodeTitle: String(manifest?.episode?.title || "").trim(),
    renderId: String(manifest?.id || "").trim(),
    lineId: String(line?.id || "").trim(),
    lineIndex: Number(line?.index || 0) || 0,
    speaker: String(line?.speaker || "").trim(),
    provider: "infinitalk",
    backend: "comfyui",
    filenamePrefix
  };
}

function upscaleProgressContext({ episode = {}, sourceOutput = {}, target = {}, model = "" } = {}) {
  return {
    episodeId: String(episode?.id || "").trim(),
    episodeTitle: String(episode?.title || "").trim(),
    renderId: String(sourceOutput?.id || "upscale").trim(),
    lineId: "upscale",
    lineIndex: 0,
    speaker: "",
    provider: "upscale",
    backend: "realesrgan",
    filenamePrefix: "",
    sourceOutputId: String(sourceOutput?.id || "").trim(),
    sourceOutputName: String(sourceOutput?.name || sourceOutput?.fileName || "").trim(),
    targetResolution: target?.width && target?.height ? `${target.width}x${target.height}` : "",
    model: String(model || "").trim()
  };
}

function setComfyUiProgress(context = {}, patch = {}) {
  const key = comfyUiProgressKey(context);
  const existing = comfyUiProgressEntries.get(key) || {};
  const now = new Date().toISOString();
  const next = {
    key,
    episodeId: String(context.episodeId || existing.episodeId || "").trim(),
    episodeTitle: String(context.episodeTitle || existing.episodeTitle || "").trim(),
    renderId: String(context.renderId || existing.renderId || "").trim(),
    lineId: String(context.lineId || existing.lineId || "").trim(),
    lineIndex: Number(context.lineIndex || existing.lineIndex || 0) || 0,
    speaker: String(context.speaker || existing.speaker || "").trim(),
    provider: String(context.provider || existing.provider || "infinitalk").trim(),
    backend: String(context.backend || existing.backend || "comfyui").trim(),
    filenamePrefix: String(context.filenamePrefix || existing.filenamePrefix || "").trim(),
    sourceOutputId: String(context.sourceOutputId || existing.sourceOutputId || "").trim(),
    sourceOutputName: String(context.sourceOutputName || existing.sourceOutputName || "").trim(),
    targetResolution: String(context.targetResolution || existing.targetResolution || "").trim(),
    model: String(context.model || existing.model || "").trim(),
    startedAt: existing.startedAt || now,
    updatedAt: now,
    status: String(patch.status || existing.status || "starting").trim(),
    phase: String(patch.phase || existing.phase || "").trim(),
    message: compactText(String(patch.message || existing.message || ""), 260),
    percent: clampPercent(patch.percent ?? existing.percent ?? 0),
    value: Number.isFinite(Number(patch.value)) ? Number(patch.value) : Number(existing.value || 0),
    max: Number.isFinite(Number(patch.max)) ? Number(patch.max) : Number(existing.max || 0),
    node: String(patch.node ?? existing.node ?? "").trim(),
    nodeType: String(patch.nodeType ?? existing.nodeType ?? "").trim(),
    promptId: String(patch.promptId || existing.promptId || "").trim(),
    error: compactText(String(patch.error || existing.error || ""), 500)
  };
  comfyUiProgressEntries.set(key, next);
  cleanupComfyUiProgressEntries();
  return next;
}

function completeComfyUiProgress(context = {}, patch = {}) {
  return setComfyUiProgress(context, {
    status: "complete",
    phase: "complete",
    percent: 100,
    message: patch.message || "ComfyUI generation complete.",
    promptId: patch.promptId || ""
  });
}

function failComfyUiProgress(context = {}, error, patch = {}) {
  return setComfyUiProgress(context, {
    status: "error",
    phase: "error",
    message: patch.message || "ComfyUI generation failed.",
    promptId: patch.promptId || "",
    error: cleanErrorMessage(error)
  });
}

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function comfyUiProgressPercent(value, max) {
  const numericValue = Number(value);
  const numericMax = Number(max);
  if (!Number.isFinite(numericValue) || !Number.isFinite(numericMax) || numericMax <= 0) return 0;
  return clampPercent((numericValue / numericMax) * 100);
}

function comfyUiWebSocketUrl(clientId) {
  const url = new URL(comfyUiBaseUrl());
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = "";
  url.searchParams.set("clientId", clientId);
  return url.toString();
}

function openComfyUiProgressSocket({ clientId, context }) {
  if (typeof WebSocket === "undefined") {
    setComfyUiProgress(context, {
      status: "queued",
      phase: "polling",
      message: "ComfyUI websocket is unavailable in this Node runtime; polling history."
    });
    return null;
  }

  let promptId = "";
  let socket = null;
  try {
    socket = new WebSocket(comfyUiWebSocketUrl(clientId));
  } catch (error) {
    setComfyUiProgress(context, {
      status: "queued",
      phase: "polling",
      message: `ComfyUI websocket could not open; polling history. ${cleanErrorMessage(error)}`
    });
    return null;
  }

  const close = () => {
    try {
      socket?.close?.();
    } catch {
      // Non-critical cleanup.
    }
  };
  const setPromptId = (value) => {
    promptId = String(value || "");
  };

  socket.addEventListener("open", () => {
    setComfyUiProgress(context, {
      status: "queued",
      phase: "connected",
      message: "Connected to ComfyUI progress stream."
    });
  });
  socket.addEventListener("message", (event) => {
    handleComfyUiProgressMessage({
      context,
      message: event?.data,
      promptId
    });
  });
  socket.addEventListener("error", () => {
    setComfyUiProgress(context, {
      status: "running",
      phase: "polling",
      message: "ComfyUI websocket had a progress-stream error; polling history."
    });
  });
  socket.addEventListener("close", () => {
    const current = comfyUiProgressEntries.get(comfyUiProgressKey(context));
    if (current && !["complete", "error"].includes(current.status)) {
      setComfyUiProgress(context, {
        status: current.status || "running",
        phase: current.phase || "polling",
        message: current.message || "ComfyUI progress stream closed; polling history."
      });
    }
  });

  return { close, setPromptId };
}

function handleComfyUiProgressMessage({ context, message, promptId = "" }) {
  if (typeof message !== "string") return;
  let payload = null;
  try {
    payload = JSON.parse(message);
  } catch {
    return;
  }

  const type = String(payload?.type || "").toLowerCase();
  const data = payload?.data || {};
  const messagePromptId = String(data.prompt_id || data.promptId || "");
  if (promptId && messagePromptId && messagePromptId !== promptId) return;
  const promptPatch = messagePromptId ? { promptId: messagePromptId } : {};

  if (type === "execution_start") {
    setComfyUiProgress(context, {
      ...promptPatch,
      status: "running",
      phase: "started",
      message: "ComfyUI started executing the prompt."
    });
    return;
  }
  if (type === "executing") {
    const node = data.node === null || data.node === undefined ? "" : String(data.node);
    if (!node) {
      completeComfyUiProgress(context, {
        ...promptPatch,
        message: "ComfyUI finished executing the prompt."
      });
      return;
    }
    setComfyUiProgress(context, {
      ...promptPatch,
      status: "running",
      phase: "executing",
      node,
      message: `ComfyUI executing node ${node}.`
    });
    return;
  }
  if (type === "progress") {
    const value = Number(data.value || 0);
    const max = Number(data.max || 0);
    setComfyUiProgress(context, {
      ...promptPatch,
      status: "running",
      phase: "sampling",
      value,
      max,
      percent: comfyUiProgressPercent(value, max),
      message: max > 0 ? `ComfyUI sampling ${value}/${max}.` : "ComfyUI sampling."
    });
    return;
  }
  if (type === "execution_cached") {
    setComfyUiProgress(context, {
      ...promptPatch,
      status: "running",
      phase: "cached",
      message: "ComfyUI reused cached nodes."
    });
    return;
  }
  if (type === "executed") {
    setComfyUiProgress(context, {
      ...promptPatch,
      status: "running",
      phase: "collecting",
      node: data.node === undefined || data.node === null ? "" : String(data.node),
      message: "ComfyUI node finished; collecting output."
    });
    return;
  }
  if (type === "execution_error") {
    failComfyUiProgress(context, data.exception_message || data.exception_type || "ComfyUI execution error.", promptPatch);
  }
}

async function comfyUiHealthStatus() {
  const baseUrl = comfyUiBaseUrl();
  const configured = comfyUiInfiniteTalkConfigured();
  let reachable = false;
  let error = "";
  try {
    await fetchJsonWithTimeout(`${baseUrl}/system_stats`, {}, Number(process.env.COMFYUI_HEALTH_TIMEOUT_MS || 800));
    reachable = true;
  } catch (healthError) {
    error = compactText(String(healthError?.message || healthError), 160);
  }
  return {
    baseUrl,
    reachable,
    infinitalkConfigured: configured,
    rootDir: comfyUiRootDir(),
    workflow: comfyUiInfiniteTalkWorkflowPath(),
    inputDir: comfyUiInputDir(),
    outputDir: comfyUiOutputDir(),
    autoStartEnabled: comfyUiAutoStartEnabled(),
    startScript: comfyUiStartScriptPath(),
    logs: comfyUiLogPaths(),
    error
  };
}

function comfyUiAutoStartEnabled() {
  const value = String(process.env.COMFYUI_AUTO_START ?? process.env.NEWTBUILDER_COMFYUI_AUTO_START ?? "").trim().toLowerCase();
  if (!value) return true;
  return ["1", "true", "yes", "on"].includes(value);
}

function comfyUiStartScriptPath() {
  const configured = String(process.env.COMFYUI_START_SCRIPT || process.env.NEWTBUILDER_COMFYUI_START_SCRIPT || "").trim();
  if (configured) return path.resolve(configured);
  return existsSync(defaultComfyUiStartScriptPath) ? defaultComfyUiStartScriptPath : "";
}

function comfyUiLogPaths() {
  return {
    log: path.join(logsDir, "comfyui.log"),
    errorLog: path.join(logsDir, "comfyui.err.log")
  };
}

function comfyUiConnectionTarget() {
  try {
    const url = new URL(comfyUiBaseUrl());
    const portNumber = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    return {
      host: url.hostname || "127.0.0.1",
      listenHost: ["localhost", "::1"].includes(url.hostname) ? "127.0.0.1" : url.hostname || "127.0.0.1",
      port: Number.isFinite(portNumber) ? portNumber : 8188
    };
  } catch {
    return { host: "127.0.0.1", listenHost: "127.0.0.1", port: 8188 };
  }
}

function comfyUiPythonPath(root) {
  const configured = String(process.env.COMFYUI_PYTHON || process.env.NEWTBUILDER_COMFYUI_PYTHON || "").trim();
  if (configured) return path.resolve(configured);
  const candidates =
    process.platform === "win32"
      ? [
          path.join(root, ".venv", "Scripts", "python.exe"),
          path.join(root, "venv", "Scripts", "python.exe"),
          path.join(root, "..", "standalone-env", "python.exe")
        ]
      : [
          path.join(root, ".venv", "bin", "python"),
          path.join(root, "venv", "bin", "python"),
          path.join(root, "..", "standalone-env", "bin", "python")
        ];
  return candidates.find((candidate) => existsSync(candidate)) || "python";
}

function comfyUiAutoStartTimeoutMs(renderTimeoutMs = 120000) {
  const configured = Number(process.env.COMFYUI_AUTO_START_TIMEOUT_MS || process.env.NEWTBUILDER_COMFYUI_AUTO_START_TIMEOUT_MS || 120000);
  const timeoutMs = Number.isFinite(configured) ? configured : 120000;
  const renderCeiling = Number.isFinite(Number(renderTimeoutMs)) ? Number(renderTimeoutMs) : 120000;
  return Math.min(Math.max(5000, timeoutMs), Math.max(5000, renderCeiling));
}

function closeFdQuietly(fd) {
  if (!Number.isInteger(fd)) return;
  try {
    closeSync(fd);
  } catch {
    // Best effort cleanup for detached process log descriptors.
  }
}

async function spawnDetachedProcess(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, {
        ...options,
        detached: true,
        windowsHide: true
      });
    } catch (error) {
      reject(error);
      return;
    }

    let settled = false;
    const settle = (error = null) => {
      if (settled) return;
      settled = true;
      if (error) {
        reject(error);
        return;
      }
      child.unref();
      resolve(child);
    };

    child.once("error", settle);
    child.once("spawn", () => settle());
  });
}

async function launchComfyUiBackend() {
  await mkdir(logsDir, { recursive: true });
  const scriptPath = comfyUiStartScriptPath();
  if (scriptPath) {
    if (!existsSync(scriptPath)) {
      throw new Error(`Configured ComfyUI start script was not found: ${scriptPath}`);
    }
    await spawnDetachedProcess(scriptPath, [], {
      cwd: path.dirname(scriptPath),
      shell: process.platform === "win32",
      stdio: "ignore",
      env: {
        ...process.env,
        PYTHONUTF8: process.env.PYTHONUTF8 || "1",
        PYTHONIOENCODING: process.env.PYTHONIOENCODING || "utf-8"
      }
    });
    return { mode: "script", path: scriptPath };
  }

  const root = comfyUiRootDir();
  if (!root || !existsSync(root)) {
    throw new Error("COMFYUI_ROOT_DIR is not set and the default ComfyUI Desktop path was not found.");
  }
  const mainPath = path.join(root, "main.py");
  if (!existsSync(mainPath)) {
    throw new Error(`ComfyUI main.py was not found under ${root}.`);
  }

  const { listenHost, port: comfyPort } = comfyUiConnectionTarget();
  const pythonPath = comfyUiPythonPath(root);
  const { log, errorLog } = comfyUiLogPaths();
  const stdoutFd = openSync(log, "a");
  const stderrFd = openSync(errorLog, "a");
  try {
    await spawnDetachedProcess(
      pythonPath,
      ["main.py", "--listen", listenHost, "--port", String(comfyPort)],
      {
        cwd: root,
        stdio: ["ignore", stdoutFd, stderrFd],
        env: {
          ...process.env,
          PYTHONUTF8: process.env.PYTHONUTF8 || "1",
          PYTHONIOENCODING: process.env.PYTHONIOENCODING || "utf-8"
        }
      }
    );
  } finally {
    closeFdQuietly(stdoutFd);
    closeFdQuietly(stderrFd);
  }

  return { mode: "python", path: mainPath, pythonPath, port: comfyPort };
}

async function waitForComfyUiReachable(timeoutMs) {
  const startedAt = Date.now();
  let lastStatus = null;
  while (Date.now() - startedAt < timeoutMs) {
    lastStatus = await comfyUiHealthStatus();
    if (lastStatus.reachable) return lastStatus;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return lastStatus || comfyUiHealthStatus();
}

async function startComfyUiBackendAndWait(renderTimeoutMs) {
  const startTimeoutMs = comfyUiAutoStartTimeoutMs(renderTimeoutMs);
  const launched = await launchComfyUiBackend();
  const status = await waitForComfyUiReachable(startTimeoutMs);
  if (!status.reachable) {
    const { log, errorLog } = comfyUiLogPaths();
    throw new Error(
      `ComfyUI auto-start launched via ${launched.mode}, but ${status.baseUrl} did not answer within ${Math.round(startTimeoutMs / 1000)} seconds. ` +
        `Check ${log} and ${errorLog}.${status.error ? ` Last health error: ${status.error}` : ""}`
    );
  }
  if (!status.infinitalkConfigured) {
    throw new Error("ComfyUI is running, but InfiniteTalk is not configured. Check COMFYUI_INFINITALK_WORKFLOW plus the ComfyUI input/output directories.");
  }
  return status;
}

async function ensureComfyUiReadyForInfiniteTalk(renderTimeoutMs = 120000) {
  const status = await comfyUiHealthStatus();
  if (status.reachable) {
    if (!status.infinitalkConfigured) {
      throw new Error("ComfyUI is running, but InfiniteTalk is not configured. Check COMFYUI_INFINITALK_WORKFLOW plus the ComfyUI input/output directories.");
    }
    return status;
  }

  if (!comfyUiAutoStartEnabled()) {
    throw new Error(`ComfyUI is not reachable at ${status.baseUrl}. Start ComfyUI or set COMFYUI_AUTO_START=true to let NewtBuilder launch it for InfiniteTalk renders.`);
  }

  if (!comfyUiAutoStartPromise) {
    comfyUiAutoStartPromise = startComfyUiBackendAndWait(renderTimeoutMs).finally(() => {
      comfyUiAutoStartPromise = null;
    });
  }
  return comfyUiAutoStartPromise;
}

function fabricModelId() {
  return process.env.FAL_FABRIC_MODEL || "veed/fabric-1.0";
}

function klingAvatarModelId() {
  return process.env.FAL_KLING_AVATAR_MODEL || "fal-ai/kling-video/ai-avatar/v2/pro";
}

function auroraModelId() {
  return process.env.FAL_AURORA_MODEL || "fal-ai/creatify/aurora";
}

function infiniteTalkModelId() {
  return process.env.FAL_INFINITALK_MODEL || "fal-ai/infinitalk";
}

function localInfiniteTalkModelId() {
  return process.env.LOCAL_INFINITALK_MODEL_ID || "local-infinitalk";
}

function lipSyncProviderConfig(provider, context = {}) {
  const normalizedProvider = sanitizeLipSyncModel(provider);
  if (normalizedProvider === "kling") {
    return {
      provider: "kling",
      outputFolder: "kling-renders",
      source: "fal-kling-avatar",
      modelId: klingAvatarModelId(),
      label: "Kling avatar",
      promptSummary: "Kling avatar lip-sync."
    };
  }
  if (normalizedProvider === "aurora") {
    return {
      provider: "aurora",
      outputFolder: "aurora-renders",
      source: "fal-creatify-aurora",
      modelId: auroraModelId(),
      label: "Creatify Aurora",
      promptSummary: "Creatify Aurora lip-sync."
    };
  }
  if (normalizedProvider === "infinitalk") {
    const backend = infiniteTalkBackendForLine(context.line, context.manifest);
    const local = backend === "local";
    const comfyUi = backend === "comfyui";
    return {
      provider: "infinitalk",
      backend,
      outputFolder: local ? "infinitalk-local-renders" : comfyUi ? "infinitalk-comfyui-renders" : "infinitalk-renders",
      source: local ? "local-infinitalk" : comfyUi ? "comfyui-infinitalk" : "fal-infinitalk",
      modelId: local ? localInfiniteTalkModelId() : comfyUi ? comfyUiInfiniteTalkModelId() : infiniteTalkModelId(),
      label: local ? "InfiniteTalk local" : comfyUi ? "InfiniteTalk ComfyUI" : "InfiniteTalk",
      promptSummary: local ? "Local InfiniteTalk lip-sync." : comfyUi ? "ComfyUI InfiniteTalk lip-sync." : "InfiniteTalk lip-sync."
    };
  }
  return {
    provider: "fabric",
    outputFolder: "fabric-renders",
    source: "fal-fabric",
    modelId: fabricModelId(),
    label: "Fabric",
    promptSummary: "Fabric lip-sync."
  };
}

function lipSyncDisabled() {
  const configured =
    process.env.NEWTBUILDER_LIPSYNC_ENABLED !== undefined
      ? process.env.NEWTBUILDER_LIPSYNC_ENABLED
      : process.env.NEWTBUILDER_FABRIC_ENABLED;
  const value = String(configured || "").trim().toLowerCase();
  return ["0", "false", "off", "no"].includes(value);
}

function allowLipSyncStillFallback() {
  const value = String(process.env.NEWTBUILDER_ALLOW_LIPSYNC_FALLBACK || "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(value);
}

function lipSyncProviderRequiresFal(provider, line = {}, manifest = {}) {
  if (sanitizeLipSyncModel(provider) === "infinitalk") {
    const backend = infiniteTalkBackendForLine(line, manifest);
    if (backend === "local" || backend === "comfyui") return false;
  }
  return true;
}

function lipSyncProviderAvailable(provider, line = {}, manifest = {}) {
  if (lipSyncDisabled()) return false;
  if (sanitizeLipSyncModel(provider) === "infinitalk") {
    const backend = infiniteTalkBackendForLine(line, manifest);
    if (backend === "local") return localInfiniteTalkConfigured();
    if (backend === "comfyui") return comfyUiInfiniteTalkConfigured();
  }
  return lipSyncProviderRequiresFal(provider, line, manifest) ? Boolean(falApiKey) : true;
}

function lipSyncProviderUnavailableMessage(provider, line = {}, manifest = {}) {
  if (lipSyncDisabled()) return "Lip-sync rendering is disabled by NEWTBUILDER_LIPSYNC_ENABLED.";
  if (sanitizeLipSyncModel(provider) === "infinitalk") {
    const backend = infiniteTalkBackendForLine(line, manifest);
    if (backend === "local") {
      return "Local InfiniteTalk is selected, but LOCAL_INFINITALK_REPO_DIR is not set or does not point to an InfiniteTalk checkout.";
    }
    if (backend === "comfyui") {
      return "ComfyUI InfiniteTalk is selected, but COMFYUI_INFINITALK_WORKFLOW is not set to an API-format workflow or ComfyUI input/output directories are unavailable.";
    }
  }
  if (lipSyncProviderRequiresFal(provider, line, manifest) && !falApiKey) {
    return "fal API key is not configured for this lip-sync provider.";
  }
  return "Lip-sync provider is not configured.";
}

function insertVideoDurationSeconds(line) {
  const duration = Number(line?.estimatedSeconds || line?.durationSeconds || 4);
  return Math.min(15, Math.max(4, Math.round(duration || 4)));
}

function defaultInsertVideoOutPoint(line, videoTake = null) {
  const takeDuration = Number(videoTake?.durationSeconds || line?.videoTake?.durationSeconds || 0);
  const inPoint = Math.max(0, Number(line?.videoInSeconds) || 0);
  const ceiling = takeDuration || Math.max(inPoint + 0.35, insertVideoDurationSeconds(line));
  return roundSeconds(Math.min(ceiling, Math.max(inPoint + 0.35, inPoint + insertTrimDefaultSeconds)));
}

function insertPlaybackDurationSeconds(line, videoTake = null) {
  const requestedDuration = insertVideoDurationSeconds(line);
  const takeDuration = Number(videoTake?.durationSeconds || line?.videoTake?.durationSeconds || 0);
  const inPoint = Math.max(0, Number(line?.videoInSeconds) || 0);
  if (!takeDuration) return Math.min(requestedDuration, insertTrimDefaultSeconds);
  const requestedOut = Number(line?.videoOutSeconds) || 0;
  const defaultOut = defaultInsertVideoOutPoint(line, videoTake);
  const outPoint = requestedOut > inPoint ? Math.min(requestedOut, takeDuration) : defaultOut;
  return roundSeconds(Math.max(0.35, outPoint - Math.min(inPoint, takeDuration)));
}

function insertVideoInPoint(line) {
  const takeDuration = Number(line?.videoTake?.durationSeconds || 0);
  const inPoint = Math.max(0, Number(line?.videoInSeconds) || 0);
  return takeDuration ? Math.min(inPoint, Math.max(0, takeDuration - 0.35)) : inPoint;
}

function insertVideoPrompt(line) {
  const mode = insertVideoModeForLine(line);
  const action = String(line.videoPrompt || line.text || "").trim();
  const imageInstruction =
    mode === "reference"
      ? "Use @Image1 as a visual reference for the character design, proportions, colors, and style. Do not force it to be the first frame."
      : mode === "first_last_frame"
        ? "Use the provided first image as the first frame and the second image as the last frame."
        : "Use the provided image as the first frame and preserve the character design.";
  return compactText(
    [
      "Create a simple, clean insert-shot action for a 2D cartoon episode.",
      imageInstruction,
      `Action: ${action}`,
      "Keep motion readable, friendly, and subtle. Use a steady camera. No text overlays."
    ].join(" "),
    900
  );
}

function klingAvatarPromptForLine(line) {
  const minimalMotionPrompt =
    process.env.FAL_KLING_AVATAR_MINIMAL_BODY_PROMPT ||
    "Keep the character body, hand, and arm motions very minimal.";
  const expressiveBodyPrompt =
    process.env.FAL_KLING_AVATAR_EXPRESSIVE_BODY_PROMPT ||
    "Allow natural expressive upper-body motion only when it supports the dialogue, while preserving the original character design and shot composition.";
  const shotPrompt = String(line.videoPrompt || "").trim();
  const visualPrompt = visualReferencePromptForLine(line);
  return compactText(
    [
      "Create a polished lip-sync avatar animation for this cartoon episode shot.",
      visualPrompt,
      `Speaker: ${String(line.speaker || "character").trim()}.`,
      `Dialogue: ${plainSpeechText(line)}`,
      shotPrompt ? `Shot direction: ${shotPrompt}` : "",
      "Preserve the uploaded image composition, character identity, lighting, wardrobe, background, and camera framing.",
      "Keep facial motion natural and speech-synced. Avoid changing the character design, adding text, or changing the camera.",
      line.expressiveBodyMotion ? expressiveBodyPrompt : minimalMotionPrompt
    ].filter(Boolean).join(" "),
    lipSyncPromptLengthForProvider("kling")
  );
}

function auroraPromptForLine(line) {
  const shotPrompt = String(line.videoPrompt || "").trim();
  const visualPrompt = visualReferencePromptForLine(line);
  const basePrompt =
    process.env.FAL_AURORA_PROMPT ||
    "Create a polished studio-quality avatar lip-sync animation. Preserve the uploaded image composition, character identity, background, lighting, wardrobe, and camera framing.";
  const motionPrompt =
    line.expressiveBodyMotion
      ? process.env.FAL_AURORA_EXPRESSIVE_BODY_PROMPT ||
        "Allow restrained, natural facial and upper-body motion only when it supports the dialogue."
      : process.env.FAL_AURORA_MINIMAL_BODY_PROMPT ||
        "Keep the body, hands, arms, and camera very still; prioritize stable facial lip-sync.";
  return compactText(
    [
      basePrompt,
      visualPrompt,
      `Speaker: ${String(line.speaker || "character").trim()}.`,
      `Dialogue: ${plainSpeechText(line)}`,
      shotPrompt ? `Shot direction: ${shotPrompt}` : "",
      "Do not add text overlays or change the character design.",
      motionPrompt
    ].filter(Boolean).join(" "),
    lipSyncPromptLengthForProvider("aurora")
  );
}

function infiniteTalkPromptForLine(line) {
  const shotPrompt = String(line.videoPrompt || "").trim();
  const visualPrompt = infiniteTalkVisualReferencePromptForLine(line);
  const basePrompt =
    process.env.FAL_INFINITALK_PROMPT ||
    "Animate the uploaded stylized puppet character speaking the dialogue while preserving the source image design.";
  const motionPrompt =
    line.expressiveBodyMotion
      ? process.env.FAL_INFINITALK_EXPRESSIVE_BODY_PROMPT ||
        "Use controlled puppet-style mouth movement, small head bobs, and restrained upper-body gestures when they support the dialogue; keep the painted eye shapes flat and unchanged."
      : process.env.FAL_INFINITALK_MINIMAL_BODY_PROMPT ||
        "Keep the body, camera, background, and painted eye shapes stable; focus motion on puppet-style mouth movement synced to speech.";
  return compactText(
    [
      basePrompt,
      visualPrompt,
      `Speaker: ${String(line.speaker || "character").trim()}.`,
      `Dialogue: ${plainSpeechText(line)}`,
      shotPrompt ? `Shot direction: ${shotPrompt}` : "",
      "Preserve the uploaded image composition, character identity, style, clothing, lighting, and background.",
      "Do not add captions, logos, or text overlays.",
      motionPrompt
    ].filter(Boolean).join(" "),
    lipSyncPromptLengthForProvider("infinitalk")
  );
}

function lipSyncPromptForLine(line, provider) {
  const reviewedPrompt = compactText(String(line.lipSyncFullPromptOverride || "").trim(), lipSyncPromptLengthForProvider(provider));
  if (reviewedPrompt) return reviewedPrompt;
  if (provider === "kling") return klingAvatarPromptForLine(line);
  if (provider === "aurora") return auroraPromptForLine(line);
  if (provider === "infinitalk") return infiniteTalkPromptForLine(line);
  return "";
}

function klingAvatarMinimumAudioSeconds() {
  return boundedEnvNumber("FAL_KLING_AVATAR_MIN_AUDIO_SECONDS", 2, 0.5, 10);
}

function lipSyncMinimumAudioSeconds(provider) {
  if (provider === "kling") return klingAvatarMinimumAudioSeconds();
  if (provider === "aurora") return boundedEnvNumber("FAL_AURORA_MIN_AUDIO_SECONDS", 0, 0, 10);
  if (provider === "infinitalk") return infiniteTalkMinimumAudioSeconds();
  return 0;
}

function infiniteTalkModelFps() {
  return boundedEnvNumber("FAL_INFINITALK_FRAME_RATE", 25, 12, 60);
}

function infiniteTalkMinimumAudioSeconds() {
  return boundedEnvNumber("FAL_INFINITALK_MIN_AUDIO_SECONDS", 1.72, 1.64, 10);
}

function infiniteTalkNumFrames(line) {
  const explicitFrames = Number(process.env.FAL_INFINITALK_NUM_FRAMES);
  if (Number.isFinite(explicitFrames) && explicitFrames > 0) {
    return Math.min(721, Math.max(41, Math.round(explicitFrames)));
  }
  const modelFps = infiniteTalkModelFps();
  const durationSeconds = Number(line?.audio?.durationSeconds || line?.audioTake?.durationSeconds || line?.durationSeconds || 0);
  const frameSafetyMargin = boundedEnvNumber("FAL_INFINITALK_FRAME_SAFETY_MARGIN", 2, 0, 12);
  const safeFrames = Math.floor(Math.max(durationSeconds, infiniteTalkMinimumAudioSeconds()) * modelFps) - frameSafetyMargin;
  return Math.min(721, Math.max(41, safeFrames));
}

function infiniteTalkRequiredAudioSeconds(line) {
  const frames = infiniteTalkNumFrames(line);
  const modelFps = infiniteTalkModelFps();
  const framePaddingSeconds = boundedEnvNumber("FAL_INFINITALK_AUDIO_PAD_SECONDS", 0.12, 0, 1);
  return Math.max(infiniteTalkMinimumAudioSeconds(), (frames + 1) / modelFps + framePaddingSeconds);
}

function infiniteTalkResolution() {
  const configured = normalizeResolutionValue(process.env.FAL_INFINITALK_RESOLUTION || "");
  if (configured === "720p" || configured === "480p") return configured;
  if (configured) {
    console.warn(`Ignoring unsupported FAL_INFINITALK_RESOLUTION="${process.env.FAL_INFINITALK_RESOLUTION}". InfiniteTalk currently accepts only 480p or 720p.`);
  }
  return "720p";
}

function infiniteTalkAcceleration() {
  const value = String(process.env.FAL_INFINITALK_ACCELERATION || "regular").trim().toLowerCase();
  return ["none", "regular", "high"].includes(value) ? value : "regular";
}

function infiniteTalkSeed() {
  const seed = Number(process.env.FAL_INFINITALK_SEED);
  return Number.isFinite(seed) ? Math.round(seed) : null;
}

function infiniteTalkMaskMode() {
  const value = String(process.env.NEWTBUILDER_INFINITALK_MASK_MODE || "multi").trim().toLowerCase();
  if (["multi", "multiperson", "multi-person"].includes(value)) return "multi";
  if (["composite", "mask", "single"].includes(value)) return "composite";
  return "multi";
}

function infiniteTalkMultiPersonPlanForLine(line) {
  const shotRole = String(line?.image?.shotRole || line?.shotRole || "").trim();
  const roles = uniqueRoleList(
    Array.isArray(line?.image?.speakingRoles) && line.image.speakingRoles.length
      ? line.image.speakingRoles
      : parseCharacterTagRoles(line?.image?.speakingTag || "")
  );
  const speakerRole = speakerTypeFor(line?.speaker);
  const speakerIndex = roles.indexOf(speakerRole);
  const enabled =
    infiniteTalkMaskMode() === "multi" &&
    Boolean(line?.needsMask && line?.maskPath) &&
    ["medium_two_shot", "wide_shot"].includes(shotRole) &&
    roles.length === 2 &&
    speakerIndex >= 0;

  return {
    enabled,
    audioType: "para",
    personRoles: roles.slice(0, 2),
    speakerRole,
    speakerIndex,
    shotRole,
    reason: enabled
      ? ""
      : !line?.needsMask || !line?.maskPath
        ? "line is not using a speaker mask"
        : !["medium_two_shot", "wide_shot"].includes(shotRole)
          ? "shot is not a medium two-shot or wide shot"
          : roles.length !== 2
            ? "shot asset must have exactly two speaking tags"
            : speakerIndex < 0
              ? "line speaker is not present in the shot asset speaking tags"
              : "InfiniteTalk multi-person mode is disabled"
  };
}

function shouldUseInfiniteTalkMultiPerson(line, provider) {
  return sanitizeLipSyncModel(provider) === "infinitalk" && infiniteTalkMultiPersonPlanForLine(line).enabled;
}

function comfyUiInfiniteTalkModelNameForLine(line) {
  const plan = infiniteTalkMultiPersonPlanForLine(line);
  if (!plan.enabled) return String(process.env.COMFYUI_INFINITALK_SINGLE_MODEL || "").trim();
  return String(process.env.COMFYUI_INFINITALK_MULTI_MODEL || "InfiniteTalk\\Wan2_1-InfiniteTalk-Multi_fp8_e4m3fn_scaled_KJ.safetensors").trim();
}

function lipSyncProviderSignatureOptions(provider, line, format = {}) {
  if (provider === "infinitalk") {
    const backend = infiniteTalkBackendForLine(line);
    const multiPerson = infiniteTalkMultiPersonPlanForLine(line);
    const options = {
      backend,
      numFrames: infiniteTalkNumFrames(line),
      requiredAudioSeconds: infiniteTalkRequiredAudioSeconds(line),
      frameRate: infiniteTalkModelFps(),
      frameSafetyMargin: boundedEnvNumber("FAL_INFINITALK_FRAME_SAFETY_MARGIN", 2, 0, 12),
      resolution: infiniteTalkResolution(format),
      acceleration: infiniteTalkAcceleration(),
      seed: infiniteTalkSeed(),
      comfyUiWorkflow: backend === "comfyui" ? comfyUiInfiniteTalkWorkflowPath() : "",
      comfyUiMapping: backend === "comfyui" ? compactText(process.env.COMFYUI_INFINITALK_MAPPING_JSON || "", 500) : "",
      multiPerson
    };
    if (backend === "comfyui") options.comfyUiMultiModel = comfyUiInfiniteTalkModelNameForLine(line);
    if (backend === "comfyui") options.audioCfgScale = multiPerson.enabled ? 1 : animationStrengthForLine(line);
    return options;
  }
  return {};
}

function lineLipSyncSignature(line, format = {}, options = {}) {
  const masked = Boolean(line.needsMask);
  const provider = options.provider || lipSyncModelForLine(line);
  const model = options.modelId || lipSyncProviderConfig(provider, { line }).modelId;
  return JSON.stringify({
    compositeVersion: provider === "infinitalk" ? 8 : 7,
    provider,
    model,
    providerOptions: lipSyncProviderSignatureOptions(provider, line, format),
    minAudioSeconds: lipSyncMinimumAudioSeconds(provider),
    prompt: String(options.prompt || ""),
    speaker: String(line.speaker || "").trim(),
    text: plainSpeechText(line),
    audioSignature: String(line.audio?.signature || line.audioTake?.signature || ""),
    audioLocalUrl: String(line.audio?.localUrl || line.audioTake?.localUrl || ""),
    imageAssetId: line.image?.assetId || "",
    imageLocalUrl: line.image?.localUrl || "",
    needsMask: masked,
    maskAssetId: masked ? line.mask?.assetId || "" : "",
    maskLocalUrl: masked ? line.mask?.localUrl || "" : "",
    invertMask: Boolean(line.invertMask),
    expressiveBodyMotion: Boolean(line.expressiveBodyMotion),
    lipSyncModel: provider,
    maskRenderDilationPasses: Math.round(boundedEnvNumber("NEWTBUILDER_MASK_RENDER_DILATE_PASSES", 4, 0, 24)),
    maskRenderFeatherPixels: boundedEnvNumber("NEWTBUILDER_MASK_RENDER_FEATHER_PX", 1.5, 0, 12),
    aspectRatio: format.aspectRatio || "",
    width: Number(format.width || parseResolution(format.resolution, format.aspectRatio).width || 0),
    height: Number(format.height || parseResolution(format.resolution, format.aspectRatio).height || 0),
    resolution: String(format.resolution || ""),
    fps: Number(format.fps || 30)
  });
}

function signatureHashFor(signature) {
  return createHash("sha256").update(String(signature || "")).digest("hex").slice(0, 16);
}

async function prepareLipSyncInputImage({ line, tempDir, signatureHash }) {
  const lineLabel = `line-${String(line.index).padStart(3, "0")}-${signatureHash}`;
  const outputPath = path.join(tempDir, `${lineLabel}-kling-input.png`);
  const blurSigma = Math.max(0, Math.min(96, Number(process.env.FABRIC_BG_BLUR_PX || 24) || 0));
  const maskChain = renderMaskCleanupFilter({ invert: line.invertMask });
  const filterComplex = [
    "[0:v]format=rgba,setsar=1[base0]",
    `[0:v]format=rgba,gblur=sigma=${blurSigma},setsar=1[fill0]`,
    `[1:v]${maskChain}[mask0]`,
    "[mask0][base0]scale2ref=flags=neighbor[mask][base1]",
    "[fill0][base1]scale2ref[fill][base_ref]",
    "[fill]format=rgba[fill_rgba]",
    "[base_ref]format=rgba[base_rgba]",
    "[mask]format=gray[mask_g]",
    "[base_rgba][mask_g]alphamerge[base_a]",
    "[fill_rgba][base_a]overlay=format=auto:shortest=1,format=rgba,setsar=1[out]"
  ].join(";");

  await execFileAsync(
    ffmpegPath,
    [
      "-y",
      "-i",
      line.imagePath,
      "-i",
      line.maskPath,
      "-filter_complex",
      filterComplex,
      "-map",
      "[out]",
      "-frames:v",
      "1",
      "-update",
      "1",
      outputPath
    ],
    { timeout: 90000, maxBuffer: 12 * 1024 * 1024 }
  );
  return outputPath;
}

async function prepareLipSyncMaskImage({ line, tempDir, signatureHash }) {
  const lineLabel = `line-${String(line.index).padStart(3, "0")}-${signatureHash}`;
  const outputPath = path.join(tempDir, `${lineLabel}-speaker-mask.png`);
  const maskChain = renderMaskCleanupFilter({ invert: line.invertMask });
  const filterComplex = [
    `[0:v]${maskChain}[mask0]`,
    "[mask0][1:v]scale2ref=flags=neighbor[mask][ref]",
    "[ref]nullsink",
    "[mask]format=gray,setsar=1[out]"
  ].join(";");

  await execFileAsync(
    ffmpegPath,
    [
      "-y",
      "-i",
      line.maskPath,
      "-i",
      line.imagePath,
      "-filter_complex",
      filterComplex,
      "-map",
      "[out]",
      "-frames:v",
      "1",
      "-update",
      "1",
      outputPath
    ],
    { timeout: 90000, maxBuffer: 12 * 1024 * 1024 }
  );
  return outputPath;
}

async function prepareLipSyncAudio({ line, tempDir, signatureHash, provider = "kling" }) {
  const sourcePath = line.audio?.filePath || "";
  const sourceDuration = Number(line.audio?.durationSeconds || 0) || (sourcePath ? await probeDuration(sourcePath) : 0);
  const requiredDuration = provider === "infinitalk"
    ? infiniteTalkRequiredAudioSeconds(line)
    : lipSyncMinimumAudioSeconds(provider);
  if (!sourcePath || sourceDuration >= requiredDuration) return sourcePath;

  const lineLabel = `line-${String(line.index).padStart(3, "0")}-${signatureHash}`;
  const outputPath = path.join(tempDir, `${lineLabel}-${provider}-audio.wav`);
  const padDuration = Math.max(0.2, requiredDuration - sourceDuration + 0.2);
  await execFileAsync(
    ffmpegPath,
    [
      "-y",
      "-i",
      sourcePath,
      "-af",
      `apad=pad_dur=${padDuration.toFixed(3)},atrim=0:${requiredDuration.toFixed(3)}`,
      "-ar",
      "48000",
      "-ac",
      "1",
      outputPath
    ],
    { timeout: 90000, maxBuffer: 12 * 1024 * 1024 }
  );
  return outputPath;
}

async function prepareInfiniteTalkMultiPersonAudioSlots({ line, audioPath, tempDir, signatureHash, plan }) {
  const speakerIndex = Number(plan?.speakerIndex);
  if (![0, 1].includes(speakerIndex)) {
    throw new Error(`InfiniteTalk multi-person audio needs speaker index 0 or 1 for line ${line.index}.`);
  }
  const sourceDuration = audioPath ? await probeDuration(audioPath) : 0;
  const durationSeconds = Math.max(
    0.35,
    Number(sourceDuration || 0),
    Number(line.audio?.durationSeconds || line.audioTake?.durationSeconds || line.durationSeconds || 0),
    infiniteTalkRequiredAudioSeconds(line)
  );
  const lineLabel = `line-${String(line.index).padStart(3, "0")}-${signatureHash}`;
  const silencePath = path.join(tempDir, `${lineLabel}-infinitalk-silent-person-${speakerIndex === 0 ? "2" : "1"}.wav`);
  await writeSilentSpeechWav({ filePath: silencePath, durationSeconds });
  return {
    audio1Path: speakerIndex === 0 ? audioPath : silencePath,
    audio2Path: speakerIndex === 1 ? audioPath : silencePath,
    durationSeconds
  };
}

async function prepareInfiniteTalkMultiPersonMasks({ line, tempDir, signatureHash, plan, width, height }) {
  if (!line.maskPath) {
    throw new Error(`InfiniteTalk multi-person masks need a speaker mask for line ${line.index}.`);
  }
  const speakerIndex = Number(plan?.speakerIndex);
  if (![0, 1].includes(speakerIndex)) {
    throw new Error(`InfiniteTalk multi-person masks need speaker index 0 or 1 for line ${line.index}.`);
  }
  const targetWidth = Math.max(16, Math.round(Number(width) || 720));
  const targetHeight = Math.max(16, Math.round(Number(height) || 1280));
  const lineLabel = `line-${String(line.index).padStart(3, "0")}-${signatureHash}`;
  const activePath = path.join(tempDir, `${lineLabel}-infinitalk-speaker-mask.png`);
  const otherPath = path.join(tempDir, `${lineLabel}-infinitalk-other-mask.png`);
  const backgroundPath = path.join(tempDir, `${lineLabel}-infinitalk-background-mask.png`);

  await writeFittedSpeakerMask({
    sourcePath: line.maskPath,
    outputPath: activePath,
    width: targetWidth,
    height: targetHeight,
    invert: line.invertMask
  });
  await writeInfiniteTalkRoleLaneMask({
    outputPath: otherPath,
    width: targetWidth,
    height: targetHeight,
    roleIndex: speakerIndex === 0 ? 1 : 0
  });
  await writeInfiniteTalkBackgroundMask({
    maskAPath: activePath,
    maskBPath: otherPath,
    outputPath: backgroundPath
  });

  return speakerIndex === 0
    ? [activePath, otherPath, backgroundPath]
    : [otherPath, activePath, backgroundPath];
}

async function writeFittedSpeakerMask({ sourcePath, outputPath, width, height, invert = false }) {
  const maskChain = renderMaskCleanupFilter({ invert });
  await execFileAsync(
    ffmpegPath,
    [
      "-y",
      "-i",
      sourcePath,
      "-vf",
      `${maskChain},scale=${width}:${height}:force_original_aspect_ratio=increase:flags=neighbor,crop=${width}:${height}:x=(in_w-out_w)/2:y=(in_h-out_h)/2,format=gray,setsar=1`,
      "-frames:v",
      "1",
      "-update",
      "1",
      outputPath
    ],
    { timeout: 90000, maxBuffer: 12 * 1024 * 1024 }
  );
}

async function writeInfiniteTalkRoleLaneMask({ outputPath, width, height, roleIndex }) {
  const halfWidth = Math.max(1, Math.floor(width / 2));
  const insetX = Math.max(0, Math.round(halfWidth * 0.1));
  const insetY = Math.max(0, Math.round(height * 0.1));
  const boxX = roleIndex === 0 ? insetX : halfWidth + insetX;
  const boxY = insetY;
  const boxWidth = Math.max(1, halfWidth - insetX * 2);
  const boxHeight = Math.max(1, height - insetY * 2);
  await execFileAsync(
    ffmpegPath,
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=black:s=${width}x${height}:d=0.1`,
      "-vf",
      `drawbox=x=${boxX}:y=${boxY}:w=${boxWidth}:h=${boxHeight}:color=white:t=fill,format=gray,setsar=1`,
      "-frames:v",
      "1",
      "-update",
      "1",
      outputPath
    ],
    { timeout: 90000, maxBuffer: 12 * 1024 * 1024 }
  );
}

async function writeInfiniteTalkBackgroundMask({ maskAPath, maskBPath, outputPath }) {
  await execFileAsync(
    ffmpegPath,
    [
      "-y",
      "-i",
      maskAPath,
      "-i",
      maskBPath,
      "-filter_complex",
      "[0:v]format=gray[a];[1:v]format=gray[b];[a][b]blend=all_mode=lighten[union];[union]negate,format=gray,setsar=1[out]",
      "-map",
      "[out]",
      "-frames:v",
      "1",
      "-update",
      "1",
      outputPath
    ],
    { timeout: 90000, maxBuffer: 12 * 1024 * 1024 }
  );
}

async function runLipSyncProvider({ provider, imagePath, audioPath, prompt, line, format, tempDir, rawPath, manifest, infiniteTalkMultiPerson = null }) {
  if (provider === "infinitalk") {
    const backend = infiniteTalkBackendForLine(line, manifest);
    if (backend === "local") {
      return runLocalInfiniteTalk({ imagePath, audioPath, prompt, line, format, tempDir, rawPath });
    }
    if (backend === "comfyui") {
      return runComfyUiInfiniteTalk({ imagePath, audioPath, prompt, line, format, tempDir, rawPath, manifest, infiniteTalkMultiPerson });
    }
  }
  return runFalLipSyncProvider({ provider, imagePath, audioPath, prompt, line, format, tempDir });
}

async function runFalLipSyncProvider({ provider, imagePath, audioPath, prompt, line, format, tempDir }) {
  if (provider === "kling") {
    return runFalKlingAvatar({ imagePath, audioPath, prompt, line, tempDir });
  }
  if (provider === "aurora") {
    return runFalAurora({ imagePath, audioPath, prompt, line, tempDir });
  }
  if (provider === "infinitalk") {
    return runFalInfiniteTalk({ imagePath, audioPath, prompt, line, format, tempDir });
  }
  return runFalFabric({ imagePath, audioPath, line, tempDir });
}

async function runLocalInfiniteTalk({ imagePath, audioPath, prompt, line, tempDir, rawPath }) {
  const repoDir = String(
    process.env.LOCAL_INFINITALK_REPO_DIR ||
      process.env.NEWTBUILDER_INFINITALK_REPO_DIR ||
      process.env.INFINITALK_REPO_DIR ||
      ""
  ).trim();
  if (!repoDir) {
    throw new Error("Local InfiniteTalk is selected, but LOCAL_INFINITALK_REPO_DIR is not set.");
  }
  if (!existsSync(path.resolve(repoDir))) {
    throw new Error(`Local InfiniteTalk repo was not found at ${repoDir}.`);
  }

  const seed = infiniteTalkSeed();
  const timeoutMs = Number(process.env.LOCAL_INFINITALK_TIMEOUT_MS || process.env.FAL_INFINITALK_TIMEOUT_MS || 7200000);
  const payload = {
    image_path: imagePath,
    audio_path: audioPath,
    output_path: rawPath,
    prompt,
    repo_dir: repoDir,
    script_path: process.env.LOCAL_INFINITALK_SCRIPT || "",
    python: process.env.LOCAL_INFINITALK_PYTHON || process.env.INFINITALK_PYTHON || "",
    ckpt_dir: process.env.LOCAL_INFINITALK_CKPT_DIR || "",
    wav2vec_dir: process.env.LOCAL_INFINITALK_WAV2VEC_DIR || "",
    infinitalk_dir: process.env.LOCAL_INFINITALK_DIR || "",
    num_frames: infiniteTalkNumFrames(line),
    frame_num: process.env.LOCAL_INFINITALK_FRAME_NUM || "",
    resolution: infiniteTalkResolution(),
    sample_steps: Number(process.env.LOCAL_INFINITALK_SAMPLE_STEPS || 0) || undefined,
    motion_frame: Number(process.env.LOCAL_INFINITALK_MOTION_FRAME || 0) || undefined,
    mode: process.env.LOCAL_INFINITALK_MODE || "streaming",
    sample_text_guide_scale: process.env.LOCAL_INFINITALK_TEXT_GUIDE_SCALE || "",
    sample_audio_guide_scale: process.env.LOCAL_INFINITALK_AUDIO_GUIDE_SCALE || "",
    use_teacache: process.env.LOCAL_INFINITALK_USE_TEACACHE || "",
    use_apg: process.env.LOCAL_INFINITALK_USE_APG || "",
    low_vram: process.env.LOCAL_INFINITALK_LOW_VRAM || "",
    quant: process.env.LOCAL_INFINITALK_QUANT || "",
    quant_dir: process.env.LOCAL_INFINITALK_QUANT_DIR || "",
    lora_dir: process.env.LOCAL_INFINITALK_LORA_DIR || "",
    t5_cpu: process.env.LOCAL_INFINITALK_T5_CPU || "",
    timeout_seconds: Math.max(60, Math.ceil(timeoutMs / 1000))
  };
  if (seed !== null) payload.seed = seed;

  const payloadPath = path.join(tempDir, `local-infinitalk-payload-line-${String(line.index).padStart(3, "0")}.json`);
  await writeFile(payloadPath, JSON.stringify(payload, null, 2));

  let stdout = "";
  let stderr = "";
  try {
    ({ stdout, stderr } = await execFileAsync(
      process.env.NEWTBUILDER_PYTHON_PATH || "python3",
      [localInfiniteTalkRunnerPath, payloadPath],
      {
        env: process.env,
        timeout: timeoutMs,
        maxBuffer: 64 * 1024 * 1024
      }
    ));
  } catch (error) {
    const timedOut =
      error?.killed ||
      error?.signal === "SIGTERM" ||
      String(error?.message || "").toLowerCase().includes("timed out");
    const detail = compactText(String(error?.stderr || error?.stdout || error?.message || error), 700);
    const timeoutDetail = timedOut
      ? `Timed out after ${Math.round(timeoutMs / 60000)} minutes. Increase LOCAL_INFINITALK_TIMEOUT_MS or lower LOCAL_INFINITALK_SAMPLE_STEPS.`
      : "";
    throw new Error(`Local InfiniteTalk request failed for line ${line.index}. ${[timeoutDetail, detail].filter(Boolean).join(" ")}`);
  }

  const lines = String(stdout || "")
    .trim()
    .split(/\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  try {
    return JSON.parse(lines.at(-1) || "{}");
  } catch {
    throw new Error(`Unable to parse local InfiniteTalk response for line ${line.index}.${stderr ? ` ${compactText(stderr, 180)}` : ""}`);
  }
}

async function runComfyUiInfiniteTalk({ imagePath, audioPath, prompt, line, format, tempDir, rawPath, manifest, infiniteTalkMultiPerson = null }) {
  const workflowPath = comfyUiInfiniteTalkWorkflowPath();
  if (!workflowPath || !existsSync(workflowPath)) {
    throw new Error("ComfyUI InfiniteTalk is selected, but COMFYUI_INFINITALK_WORKFLOW does not point to an API-format workflow JSON file.");
  }
  const inputDir = comfyUiInputDir();
  if (!inputDir || !existsSync(inputDir)) {
    throw new Error("ComfyUI InfiniteTalk is selected, but the ComfyUI input directory was not found. Set COMFYUI_ROOT_DIR or COMFYUI_INPUT_DIR.");
  }
  const outputDir = comfyUiOutputDir();
  if (!outputDir || !existsSync(outputDir)) {
    throw new Error("ComfyUI InfiniteTalk is selected, but the ComfyUI output directory was not found. Set COMFYUI_ROOT_DIR or COMFYUI_OUTPUT_DIR.");
  }

  const timeoutMs = Number(process.env.COMFYUI_INFINITALK_TIMEOUT_MS || process.env.LOCAL_INFINITALK_TIMEOUT_MS || 7200000);
  await ensureComfyUiReadyForInfiniteTalk(timeoutMs);
  const graph = await loadComfyUiApiWorkflow(workflowPath);
  const lineLabel = `line-${String(line.index).padStart(3, "0")}-${safeFileSegment(line.speaker)}`;
  const prefix = `NewtBuilder_${lineLabel}_${Date.now()}`;
  const progressContext = comfyUiProgressContext({ manifest, line, filenamePrefix: prefix });
  let promptId = "";
  let progressSocket = null;

  try {
    setComfyUiProgress(progressContext, {
      status: "starting",
      phase: "preparing",
      message: `Preparing ComfyUI inputs for line ${line.index}.`
    });

    const multiPerson = infiniteTalkMultiPerson?.enabled ? infiniteTalkMultiPerson : null;
    const masked = Boolean(line.maskPath && line.imagePath);
    const workflowMaskSupported = !multiPerson && masked && comfyUiCanMapImageFileInput(graph, "mask", comfyUiMaskInputNames(), comfyUiMaskInputPredicate);
    const primaryImagePath = workflowMaskSupported ? line.imagePath : imagePath;
    const dimensions = parseResolution(format?.resolution, format?.aspectRatio);
    const width = Number(format?.width || dimensions.width || 720);
    const height = Number(format?.height || dimensions.height || 1280);
    const imageName = await copyComfyUiInputFile(primaryImagePath, `${prefix}-image`);
    const audioSlots = multiPerson
      ? await prepareInfiniteTalkMultiPersonAudioSlots({ line, audioPath, tempDir, signatureHash: prefix, plan: multiPerson })
      : { audio1Path: audioPath, audio2Path: "", durationSeconds: 0 };
    const audioName = await copyComfyUiInputFile(audioSlots.audio1Path, `${prefix}-audio-p1`);
    const audio2Name = audioSlots.audio2Path ? await copyComfyUiInputFile(audioSlots.audio2Path, `${prefix}-audio-p2`) : "";
    const refTargetMaskNames = multiPerson
      ? (
          await Promise.all(
            (await prepareInfiniteTalkMultiPersonMasks({ line, tempDir, signatureHash: prefix, plan: multiPerson, width, height })).map((maskPath, index) =>
              copyComfyUiInputFile(maskPath, `${prefix}-ref-mask-${index + 1}`)
            )
          )
        )
      : [];
    const maskInputPath = workflowMaskSupported ? await prepareLipSyncMaskImage({ line, tempDir, signatureHash: prefix }) : "";
    const maskName = maskInputPath ? await copyComfyUiInputFile(maskInputPath, `${prefix}-mask`) : "";
    const sourceImageName = workflowMaskSupported ? imageName : "";
    const seed = infiniteTalkSeed();
    const audioCfgScale = multiPerson ? 1 : animationStrengthForLine(line);

    const mappedInputs = applyComfyUiWorkflowInputs(graph, {
      imageName,
      audioName,
      audio2Name,
      refTargetMaskNames,
      multiAudioType: multiPerson ? multiPerson.audioType : "",
      maskName,
      sourceImageName,
      prompt: prompt || ".",
      negativePrompt: process.env.COMFYUI_INFINITALK_NEGATIVE_PROMPT || defaultComfyUiInfiniteTalkNegativePrompt,
      width,
      height,
      numFrames: infiniteTalkNumFrames(line),
      audioCfgScale,
      seed,
      filenamePrefix: prefix,
      infiniteTalkMultiPerson: multiPerson
    });

    const clientId = randomUUID();
    progressSocket = openComfyUiProgressSocket({ clientId, context: progressContext });
    setComfyUiProgress(progressContext, {
      status: "queued",
      phase: "queueing",
      message: `Submitting line ${line.index} to ComfyUI.`
    });

    const queued = await queueComfyUiPrompt(graph, timeoutMs, clientId);
    promptId = queued.prompt_id || queued.promptId || "";
    if (!promptId) {
      throw new Error(`ComfyUI did not return a prompt id. ${compactText(JSON.stringify(queued), 260)}`);
    }
    progressSocket?.setPromptId?.(promptId);
    setComfyUiProgress(progressContext, {
      status: "queued",
      phase: "queued",
      message: `ComfyUI queued line ${line.index}.`,
      promptId
    });

    const history = await waitForComfyUiPrompt(promptId, timeoutMs, progressContext);
    setComfyUiProgress(progressContext, {
      status: "running",
      phase: "collecting",
      message: "ComfyUI finished; locating generated video output.",
      promptId,
      percent: 100
    });
    const output = findComfyUiVideoOutput(history, promptId);
    if (!output) {
      throw new Error(`ComfyUI completed prompt ${promptId}, but no MP4/video output was recorded in history.`);
    }
    const outputPath = resolveComfyUiOutputPath(output);
    if (!outputPath || !existsSync(outputPath)) {
      throw new Error(`ComfyUI reported an output that NewtBuilder could not find: ${compactText(JSON.stringify(output), 260)}`);
    }
    if (path.resolve(outputPath) !== path.resolve(rawPath)) {
      await copyFile(outputPath, rawPath);
    }

    completeComfyUiProgress(progressContext, {
      promptId,
      message: `ComfyUI video ready for line ${line.index}.`
    });

    return {
      video: { path: rawPath, url: "" },
      backend: "comfyui",
      model: comfyUiInfiniteTalkModelId(),
      prompt_id: promptId,
      workflow: workflowPath,
      audio_cfg_scale: audioCfgScale,
      masked,
      hard_mask_composite: false,
      multi_person: Boolean(multiPerson),
      multi_person_roles: multiPerson?.personRoles || [],
      multi_person_speaker_index: multiPerson ? multiPerson.speakerIndex : null,
      workflow_mask_supported: workflowMaskSupported,
      workflow_mask_input: Boolean(mappedInputs.mask),
      workflow_audio_2_input: Boolean(mappedInputs.audio2),
      workflow_ref_target_masks_input: Boolean(mappedInputs.refTargetMasks),
      multi_audio_type: multiPerson ? multiPerson.audioType : "",
      width,
      height
    };
  } catch (error) {
    failComfyUiProgress(progressContext, error, { promptId });
    throw error;
  } finally {
    progressSocket?.close?.();
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    if (!response.ok) {
      const detail = compactText(await response.text(), 500);
      throw new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
    }
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 30000) {
  const response = await fetchWithTimeout(url, options, timeoutMs);
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Expected JSON from ${url}, received: ${compactText(text, 260)}`);
  }
}

async function loadComfyUiApiWorkflow(workflowPath) {
  const raw = await readFile(workflowPath, "utf8");
  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Unable to parse ComfyUI workflow JSON at ${workflowPath}: ${error.message}`);
  }
  const graph = data?.prompt && comfyUiLooksLikeApiGraph(data.prompt) ? data.prompt : data;
  if (Array.isArray(graph?.nodes)) {
    throw new Error("COMFYUI_INFINITALK_WORKFLOW points to a visual ComfyUI workflow. Open it in ComfyUI and export/save it in API format for NewtBuilder.");
  }
  if (!comfyUiLooksLikeApiGraph(graph)) {
    throw new Error("COMFYUI_INFINITALK_WORKFLOW must be a ComfyUI API-format graph keyed by node id.");
  }
  return JSON.parse(JSON.stringify(graph));
}

function comfyUiLooksLikeApiGraph(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length > 0 && entries.every(([, node]) => node && typeof node === "object" && node.class_type && node.inputs);
}

async function copyComfyUiInputFile(sourcePath, label) {
  const inputDir = comfyUiInputDir();
  const extension = path.extname(sourcePath) || ".dat";
  const fileName = `${safeFileSegment(label)}-${randomUUID().slice(0, 8)}${extension}`;
  await mkdir(inputDir, { recursive: true });
  await copyFile(sourcePath, path.join(inputDir, fileName));
  return fileName;
}

function applyComfyUiWorkflowInputs(graph, values) {
  const mapped = {
    image: false,
    audio: false,
    audio2: false,
    refTargetMasks: false,
    mask: false,
    sourceImage: false
  };
  mapped.image = setComfyUiWorkflowInput(graph, "image", values.imageName, {
    required: true,
    defaultInput: "image",
    candidates: comfyUiCandidatesByInput(graph, ["image"], (node) => comfyUiNodeText(node).includes("loadimage"))
  });
  mapped.audio = setComfyUiWorkflowInput(graph, "audio", values.audioName, {
    required: true,
    defaultInput: "audio",
    candidates: comfyUiCandidatesByInput(
      graph,
      ["audio", "audio_file", "wav", "filename", "file", "path"],
      (node) => comfyUiNodeText(node).includes("audio")
    )
  });
  if (values.audio2Name) {
    mapped.audio2 = applyComfyUiSecondAudioInput(graph, values.audio2Name);
    applyComfyUiStringInputs(graph, "multiAudioType", values.multiAudioType || "para", ["multi_audio_type", "audio_type"]);
  }
  if (Array.isArray(values.refTargetMaskNames) && values.refTargetMaskNames.length) {
    mapped.refTargetMasks = applyComfyUiRefTargetMasksInput(graph, values.refTargetMaskNames);
  }
  if (values.infiniteTalkMultiPerson) {
    applyComfyUiInfiniteTalkModelSelection(graph, values.infiniteTalkMultiPerson);
  }
  if (values.sourceImageName) {
    mapped.sourceImage = applyComfyUiImageFileInput(
      graph,
      "sourceImage",
      values.sourceImageName,
      comfyUiSourceImageInputNames(),
      comfyUiSourceImageInputPredicate
    );
  }
  if (values.maskName) {
    mapped.mask = applyComfyUiImageFileInput(
      graph,
      "mask",
      values.maskName,
      comfyUiMaskInputNames(),
      comfyUiMaskInputPredicate
    );
  }
  setComfyUiWorkflowInput(graph, "prompt", values.prompt, {
    defaultInput: "text",
    candidates: comfyUiCandidatesByInput(
      graph,
      ["prompt", "text", "positive"],
      (node) => {
        const text = comfyUiNodeText(node);
        return text.includes("prompt") || text.includes("text") || text.includes("cliptextencode") || text.includes("string");
      }
    )
  });
  if (values.negativePrompt) {
    setComfyUiWorkflowInput(graph, "negativePrompt", values.negativePrompt, {
      defaultInput: "text",
      candidates: comfyUiCandidatesByInput(
        graph,
        ["negative", "negative_prompt", "text"],
        (node) => comfyUiNodeText(node).includes("negative")
      )
    });
  }
  applyComfyUiResolutionInputs(graph, values.width, values.height);
  applyComfyUiNumericInputs(graph, "numFrames", values.numFrames, ["num_frames", "frame_num"]);
  applyComfyUiNumericInputs(graph, "audioCfgScale", values.audioCfgScale, ["audio_cfg_scale"]);
  if (values.seed !== null && values.seed !== undefined) {
    applyComfyUiNumericInputs(graph, "seed", values.seed, ["seed"]);
  }
  applyComfyUiStringInputs(graph, "filenamePrefix", values.filenamePrefix, ["filename_prefix"]);
  return mapped;
}

function applyComfyUiSecondAudioInput(graph, audio2Name) {
  const loaderId = addComfyUiLoadAudioNode(graph, audio2Name);
  const targets = Object.entries(graph)
    .filter(([, node]) => {
      const text = comfyUiNodeText(node);
      return text.includes("multitalk") && text.includes("wav2vec");
    })
    .map(([id, node]) => ({ id, node }));
  if (targets.length !== 1) {
    const listed = targets.map((target) => target.id).join(", ") || "none found";
    throw new Error(`ComfyUI InfiniteTalk multi-person mode needs exactly one MultiTalk wav2vec node for audio_2 mapping (${listed}).`);
  }
  targets[0].node.inputs.audio_2 = [loaderId, 0];
  return true;
}

function applyComfyUiRefTargetMasksInput(graph, maskNames = []) {
  const names = maskNames.map((name) => String(name || "").trim()).filter(Boolean);
  if (names.length < 2) {
    throw new Error("ComfyUI InfiniteTalk multi-person mode needs at least two reference target masks.");
  }
  const targets = Object.entries(graph)
    .filter(([, node]) => {
      const text = comfyUiNodeText(node);
      return text.includes("multitalk") && text.includes("wav2vec");
    })
    .map(([id, node]) => ({ id, node }));
  if (targets.length !== 1) {
    const listed = targets.map((target) => target.id).join(", ") || "none found";
    throw new Error(`ComfyUI InfiniteTalk multi-person mode needs exactly one MultiTalk wav2vec node for ref_target_masks mapping (${listed}).`);
  }

  const maskRefs = names.map((name, index) => [addComfyUiLoadImageMaskNode(graph, name, `NewtBuilder Ref Mask ${index + 1}`), 0]);
  const batchRef = [addComfyUiMaskBatchMultiNode(graph, maskRefs), 0];
  targets[0].node.inputs.ref_target_masks = batchRef;
  return true;
}

function addComfyUiLoadImageMaskNode(graph, imageName, title = "NewtBuilder Ref Mask") {
  const id = nextComfyUiNodeId(graph);
  graph[id] = {
    class_type: "LoadImageMask",
    inputs: {
      image: String(imageName || ""),
      channel: "red"
    },
    _meta: {
      title
    }
  };
  return id;
}

function addComfyUiMaskBatchMultiNode(graph, maskRefs = []) {
  const id = nextComfyUiNodeId(graph);
  const inputs = {
    inputcount: maskRefs.length
  };
  maskRefs.forEach((maskRef, index) => {
    inputs[`mask_${index + 1}`] = maskRef;
  });
  graph[id] = {
    class_type: "MaskBatchMulti",
    inputs,
    _meta: {
      title: "NewtBuilder Ref Mask Batch"
    }
  };
  return id;
}

function addComfyUiLoadAudioNode(graph, audioName) {
  const source = Object.values(graph).find((node) => String(node?.class_type || "").toLowerCase() === "loadaudio");
  const id = nextComfyUiNodeId(graph);
  graph[id] = source
    ? {
        ...JSON.parse(JSON.stringify(source)),
        inputs: {
          ...(source.inputs || {}),
          audio: String(audioName || "")
        },
        _meta: {
          ...(source._meta || {}),
          title: "NewtBuilder Person 2 Audio"
        }
      }
    : {
        class_type: "LoadAudio",
        inputs: {
          audio: String(audioName || "")
        },
        _meta: {
          title: "NewtBuilder Person 2 Audio"
        }
      };
  return id;
}

function nextComfyUiNodeId(graph) {
  const maxId = Object.keys(graph || {}).reduce((max, id) => {
    const value = Number(id);
    return Number.isFinite(value) ? Math.max(max, value) : max;
  }, 0);
  return String(maxId + 1);
}

function applyComfyUiInfiniteTalkModelSelection(graph, lineOrPlan) {
  const modelName = comfyUiInfiniteTalkModelNameForLine({
    needsMask: true,
    maskPath: "mask",
    image: {
      shotRole: lineOrPlan?.shotRole || "medium_two_shot",
      speakingRoles: lineOrPlan?.personRoles || []
    },
    speaker: lineOrPlan?.speakerRole || lineOrPlan?.personRoles?.[lineOrPlan?.speakerIndex || 0] || ""
  });
  if (!modelName) return false;
  const targets = Object.entries(graph)
    .filter(([, node]) => comfyUiNodeText(node).includes("multitalkmodelloader"))
    .map(([id, node]) => ({ id, node }));
  if (targets.length !== 1) {
    const listed = targets.map((target) => target.id).join(", ") || "none found";
    throw new Error(`ComfyUI InfiniteTalk multi-person mode needs exactly one MultiTalkModelLoader node (${listed}).`);
  }
  targets[0].node.inputs.model = modelName;
  return true;
}

function comfyUiMaskInputNames() {
  return ["mask", "mask_image", "maskImage", "mask_file", "maskFile", "mask_filename", "maskFilename", "matte", "matte_image", "alpha_mask", "segmentation_mask"];
}

function comfyUiSourceImageInputNames() {
  return ["source_image", "sourceImage", "original_image", "originalImage", "full_image", "fullImage", "reference_image", "referenceImage"];
}

function comfyUiMaskInputPredicate(node) {
  const text = comfyUiNodeText(node);
  return text.includes("mask") || text.includes("matte") || text.includes("alpha");
}

function comfyUiSourceImageInputPredicate(node) {
  const text = comfyUiNodeText(node);
  return text.includes("source") || text.includes("original") || text.includes("full image") || text.includes("reference");
}

function applyComfyUiImageFileInput(graph, field, value, inputNames, predicate) {
  const mapping = comfyUiInputMapping(field);
  if (mapping.node) {
    const node = graph[String(mapping.node)];
    if (!node) {
      throw new Error(`COMFYUI_INFINITALK_${comfyUiFieldEnvKey(field)}_NODE=${mapping.node} does not exist in the API workflow.`);
    }
    const inputKey = mapping.input || "image";
    node.inputs[inputKey] = String(value || "");
    return true;
  }

  const literalInputNames = inputNames.filter((name) => String(name).toLowerCase() !== "image");
  if (setComfyUiInputsByName(graph, literalInputNames, String(value || "")) > 0) return true;

  const candidates = comfyUiImageFileInputCandidates(graph, inputNames, predicate);
  if (candidates.length !== 1) return false;
  graph[candidates[0].id].inputs[candidates[0].input] = String(value || "");
  return true;
}

function comfyUiCanMapImageFileInput(graph, field, inputNames, predicate) {
  const mapping = comfyUiInputMapping(field);
  if (mapping.node) return true;
  const literalInputNames = inputNames.filter((name) => String(name).toLowerCase() !== "image");
  if (countComfyUiLiteralInputsByName(graph, literalInputNames) > 0) return true;
  return comfyUiImageFileInputCandidates(graph, inputNames, predicate).length === 1;
}

function comfyUiImageFileInputCandidates(graph, inputNames, predicate) {
  return [
    ...comfyUiCandidatesByInput(graph, inputNames, predicate),
    ...comfyUiCandidatesByInput(graph, ["image"], (node) => predicate(node) && comfyUiNodeText(node).includes("loadimage"))
  ];
}

function countComfyUiLiteralInputsByName(graph, inputNames) {
  const names = new Set(inputNames.map((item) => String(item).toLowerCase()));
  let count = 0;
  for (const node of Object.values(graph)) {
    for (const [inputName, inputValue] of Object.entries(node.inputs || {})) {
      if (!names.has(inputName.toLowerCase())) continue;
      if (!comfyUiInputIsLiteral(inputValue)) continue;
      count += 1;
    }
  }
  return count;
}

function setComfyUiWorkflowInput(graph, field, value, options = {}) {
  const mapping = comfyUiInputMapping(field);
  if (mapping.node) {
    const node = graph[String(mapping.node)];
    if (!node) {
      throw new Error(`COMFYUI_INFINITALK_${comfyUiFieldEnvKey(field)}_NODE=${mapping.node} does not exist in the API workflow.`);
    }
    const inputKey = mapping.input || options.defaultInput;
    if (!inputKey) throw new Error(`Set COMFYUI_INFINITALK_${comfyUiFieldEnvKey(field)}_INPUT for node ${mapping.node}.`);
    node.inputs[inputKey] = value;
    return true;
  }

  const candidates = options.candidates || [];
  if (candidates.length === 1) {
    graph[candidates[0].id].inputs[candidates[0].input] = value;
    return true;
  }
  if (candidates.length > 1 || options.required) {
    const listed = candidates.length ? describeComfyUiCandidates(candidates) : "none found";
    throw new Error(
      `ComfyUI workflow input "${field}" could not be mapped automatically (${listed}). Set COMFYUI_INFINITALK_${comfyUiFieldEnvKey(field)}_NODE and COMFYUI_INFINITALK_${comfyUiFieldEnvKey(field)}_INPUT.`
    );
  }
  return false;
}

function applyComfyUiResolutionInputs(graph, width, height) {
  const mappedWidth = setComfyUiWorkflowInput(graph, "width", width, { defaultInput: "width" });
  const mappedHeight = setComfyUiWorkflowInput(graph, "height", height, { defaultInput: "height" });
  if (String(process.env.COMFYUI_INFINITALK_AUTO_RESOLUTION || "true").trim().toLowerCase() === "false") return;
  if (!mappedWidth) setComfyUiInputsByName(graph, ["width", "image_width"], width);
  if (!mappedHeight) setComfyUiInputsByName(graph, ["height", "image_height"], height);
}

function applyComfyUiNumericInputs(graph, field, value, inputNames) {
  const mapped = setComfyUiWorkflowInput(graph, field, Number(value), { defaultInput: inputNames[0] });
  if (!mapped) setComfyUiInputsByName(graph, inputNames, Number(value));
}

function applyComfyUiStringInputs(graph, field, value, inputNames) {
  const mapped = setComfyUiWorkflowInput(graph, field, String(value || ""), { defaultInput: inputNames[0] });
  if (!mapped) setComfyUiInputsByName(graph, inputNames, String(value || ""));
}

function setComfyUiInputsByName(graph, inputNames, value) {
  const names = new Set(inputNames.map((item) => String(item).toLowerCase()));
  let count = 0;
  for (const node of Object.values(graph)) {
    for (const inputName of Object.keys(node.inputs || {})) {
      if (!names.has(inputName.toLowerCase())) continue;
      if (!comfyUiInputIsLiteral(node.inputs[inputName])) continue;
      node.inputs[inputName] = value;
      count += 1;
    }
  }
  return count;
}

function comfyUiCandidatesByInput(graph, inputNames, predicate = () => true) {
  const names = new Set(inputNames.map((item) => String(item).toLowerCase()));
  const candidates = [];
  for (const [id, node] of Object.entries(graph)) {
    if (!predicate(node)) continue;
    for (const [inputName, inputValue] of Object.entries(node.inputs || {})) {
      if (!names.has(inputName.toLowerCase())) continue;
      if (!comfyUiInputIsLiteral(inputValue)) continue;
      candidates.push({ id, input: inputName, classType: node.class_type, title: node._meta?.title || "" });
    }
  }
  return candidates;
}

function comfyUiInputIsLiteral(value) {
  return !Array.isArray(value);
}

function comfyUiNodeText(node) {
  return `${node?.class_type || ""} ${node?._meta?.title || ""}`.toLowerCase();
}

function comfyUiInputMapping(field) {
  const envKey = comfyUiFieldEnvKey(field);
  const directNode = String(process.env[`COMFYUI_INFINITALK_${envKey}_NODE`] || "").trim();
  const directInput = String(process.env[`COMFYUI_INFINITALK_${envKey}_INPUT`] || "").trim();
  const json = String(process.env.COMFYUI_INFINITALK_MAPPING_JSON || "").trim();
  if (!json) return { node: directNode, input: directInput };
  try {
    const parsed = JSON.parse(json);
    const fromJson = parsed?.[field] || parsed?.[envKey.toLowerCase()] || {};
    return {
      node: directNode || String(fromJson.node || fromJson.nodeId || "").trim(),
      input: directInput || String(fromJson.input || fromJson.inputName || "").trim()
    };
  } catch (error) {
    throw new Error(`COMFYUI_INFINITALK_MAPPING_JSON is not valid JSON: ${error.message}`);
  }
}

function comfyUiFieldEnvKey(field) {
  return String(field).replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase();
}

function describeComfyUiCandidates(candidates) {
  return candidates
    .slice(0, 8)
    .map((candidate) => `${candidate.id}.${candidate.input} (${candidate.title || candidate.classType})`)
    .join(", ");
}

async function queueComfyUiPrompt(graph, timeoutMs, clientId = randomUUID()) {
  return fetchJsonWithTimeout(
    `${comfyUiBaseUrl()}/prompt`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: graph, client_id: clientId })
    },
    Math.min(timeoutMs, Number(process.env.COMFYUI_REQUEST_TIMEOUT_MS || 30000))
  );
}

async function waitForComfyUiPrompt(promptId, timeoutMs, progressContext = null) {
  const startedAt = Date.now();
  const pollMs = Math.max(1000, Number(process.env.COMFYUI_POLL_INTERVAL_MS || 3000));
  let pollCount = 0;
  while (Date.now() - startedAt < timeoutMs) {
    const history = await fetchJsonWithTimeout(
      `${comfyUiBaseUrl()}/history/${encodeURIComponent(promptId)}`,
      {},
      Number(process.env.COMFYUI_REQUEST_TIMEOUT_MS || 30000)
    );
    const record = history?.[promptId];
    const status = record?.status || {};
    if (String(status.status_str || "").toLowerCase() === "error") {
      throw new Error(`ComfyUI prompt ${promptId} failed. ${comfyUiExecutionErrorMessage(status)}`);
    }
    if (record?.outputs && status.completed !== false) return history;
    if (progressContext) {
      pollCount += 1;
      const current = comfyUiProgressEntries.get(comfyUiProgressKey(progressContext));
      if (!current || ["starting", "queued"].includes(current.status) || pollCount % 4 === 0) {
        setComfyUiProgress(progressContext, {
          status: "running",
          phase: current?.phase || "polling",
          message: current?.message || "ComfyUI is running; waiting for history output.",
          promptId,
          percent: current?.percent || 0
        });
      }
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(`ComfyUI prompt ${promptId} timed out after ${Math.round(timeoutMs / 60000)} minutes.`);
}

function comfyUiExecutionErrorMessage(status = {}) {
  const messages = Array.isArray(status.messages) ? status.messages : [];
  const executionError = messages
    .map((entry) => (Array.isArray(entry) && entry[0] === "execution_error" ? entry[1] : null))
    .filter(Boolean)
    .at(-1);
  if (!executionError) return compactText(JSON.stringify(status), 600);
  const node = [executionError.node_id, executionError.node_type].filter(Boolean).join(" ");
  const message = String(executionError.exception_message || executionError.exception_type || "").trim();
  return compactText([node ? `Node ${node}:` : "", message].filter(Boolean).join(" "), 600);
}

function findComfyUiVideoOutput(history, promptId) {
  const outputs = history?.[promptId]?.outputs || {};
  const buckets = ["videos", "gifs", "animations", "files", "images"];
  for (const nodeOutput of Object.values(outputs)) {
    for (const bucket of buckets) {
      const items = Array.isArray(nodeOutput?.[bucket]) ? nodeOutput[bucket] : [];
      const match = items.find((item) => {
        const filename = String(item?.filename || item?.name || "");
        return /\.(mp4|mov|mkv|webm)$/i.test(filename) || String(item?.format || "").toLowerCase().includes("video");
      });
      if (match) return match;
    }
  }
  return null;
}

function resolveComfyUiOutputPath(output) {
  const filename = String(output?.filename || output?.name || "").trim();
  if (!filename) return "";
  if (path.isAbsolute(filename)) return filename;
  const type = String(output?.type || "").trim().toLowerCase();
  const baseDir = type === "temp" ? comfyUiTempDir() : comfyUiOutputDir();
  const subfolder = String(output?.subfolder || "").trim();
  const fullPath = path.resolve(baseDir, subfolder, filename);
  const allowedBase = path.resolve(baseDir);
  return fullPath === allowedBase || fullPath.startsWith(`${allowedBase}${path.sep}`) ? fullPath : "";
}

async function runFalKlingAvatar({ imagePath, audioPath, prompt, line, tempDir }) {
  const payloadPath = path.join(tempDir, `kling-avatar-payload-line-${String(line.index).padStart(3, "0")}.json`);
  await writeFile(
    payloadPath,
    JSON.stringify(
      {
        image_path: imagePath,
        audio_path: audioPath,
        prompt,
        model: klingAvatarModelId()
      },
      null,
      2
    )
  );

  let stdout = "";
  let stderr = "";
  try {
    ({ stdout, stderr } = await execFileAsync(
      process.env.NEWTBUILDER_PYTHON_PATH || "python3",
      [falKlingAvatarRunnerPath, payloadPath],
      {
        env: {
          ...process.env,
          FAL_KEY: falApiKey,
          FAL_API_KEY: falApiKey
        },
        timeout: Number(process.env.FAL_KLING_AVATAR_TIMEOUT_MS || process.env.FAL_LIPSYNC_TIMEOUT_MS || 900000),
        maxBuffer: 12 * 1024 * 1024
      }
    ));
  } catch (error) {
    const detail = compactText(String(error?.stderr || error?.stdout || error?.message || error), 220);
    throw new Error(`Kling avatar request failed for line ${line.index}. ${detail}`);
  }

  const lines = String(stdout || "")
    .trim()
    .split(/\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  try {
    return JSON.parse(lines.at(-1) || "{}");
  } catch {
    throw new Error(`Unable to parse Kling avatar response for line ${line.index}.${stderr ? ` ${compactText(stderr, 180)}` : ""}`);
  }
}

async function runFalAurora({ imagePath, audioPath, prompt, line, tempDir }) {
  const payloadPath = path.join(tempDir, `aurora-payload-line-${String(line.index).padStart(3, "0")}.json`);
  await writeFile(
    payloadPath,
    JSON.stringify(
      {
        image_path: imagePath,
        audio_path: audioPath,
        prompt,
        model: auroraModelId(),
        resolution: process.env.FAL_AURORA_RESOLUTION || "720p",
        guidance_scale: boundedEnvNumber("FAL_AURORA_GUIDANCE_SCALE", 1, 0, 20),
        audio_guidance_scale: boundedEnvNumber("FAL_AURORA_AUDIO_GUIDANCE_SCALE", 2, 0, 20)
      },
      null,
      2
    )
  );

  let stdout = "";
  let stderr = "";
  try {
    ({ stdout, stderr } = await execFileAsync(
      process.env.NEWTBUILDER_PYTHON_PATH || "python3",
      [falAuroraRunnerPath, payloadPath],
      {
        env: {
          ...process.env,
          FAL_KEY: falApiKey,
          FAL_API_KEY: falApiKey
        },
        timeout: Number(process.env.FAL_AURORA_TIMEOUT_MS || process.env.FAL_LIPSYNC_TIMEOUT_MS || 900000),
        maxBuffer: 12 * 1024 * 1024
      }
    ));
  } catch (error) {
    const detail = compactText(String(error?.stderr || error?.stdout || error?.message || error), 220);
    throw new Error(`Creatify Aurora request failed for line ${line.index}. ${detail}`);
  }

  const lines = String(stdout || "")
    .trim()
    .split(/\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  try {
    return JSON.parse(lines.at(-1) || "{}");
  } catch {
    throw new Error(`Unable to parse Creatify Aurora response for line ${line.index}.${stderr ? ` ${compactText(stderr, 180)}` : ""}`);
  }
}

async function runFalInfiniteTalk({ imagePath, audioPath, prompt, line, format, tempDir }) {
  const seed = infiniteTalkSeed();
  const timeoutMs = Number(process.env.FAL_INFINITALK_TIMEOUT_MS || process.env.FAL_LIPSYNC_TIMEOUT_MS || 1800000);
  const resolution = infiniteTalkResolution(format);
  const payload = {
    image_path: imagePath,
    audio_path: audioPath,
    prompt,
    model: infiniteTalkModelId(),
    num_frames: infiniteTalkNumFrames(line),
    resolution,
    acceleration: infiniteTalkAcceleration()
  };
  if (seed !== null) payload.seed = seed;

  const payloadPath = path.join(tempDir, `infinitalk-payload-line-${String(line.index).padStart(3, "0")}.json`);
  await writeFile(payloadPath, JSON.stringify(payload, null, 2));

  let stdout = "";
  let stderr = "";
  try {
    ({ stdout, stderr } = await execFileAsync(
      process.env.NEWTBUILDER_PYTHON_PATH || "python3",
      [falInfiniteTalkRunnerPath, payloadPath],
      {
        env: {
          ...process.env,
          FAL_KEY: falApiKey,
          FAL_API_KEY: falApiKey
        },
        timeout: timeoutMs,
        maxBuffer: 12 * 1024 * 1024
      }
    ));
  } catch (error) {
    const timedOut =
      error?.killed ||
      error?.signal === "SIGTERM" ||
      String(error?.message || "").toLowerCase().includes("timed out");
    const detail = compactText(String(error?.stderr || error?.stdout || error?.message || error), 420);
    const timeoutDetail = timedOut
      ? `Timed out after ${Math.round(timeoutMs / 60000)} minutes. InfiniteTalk 720p jobs can queue or render slowly; increase FAL_INFINITALK_TIMEOUT_MS or use high acceleration for this model.`
      : "";
    throw new Error(`InfiniteTalk request failed for line ${line.index}. ${[timeoutDetail, detail].filter(Boolean).join(" ")}`);
  }

  const lines = String(stdout || "")
    .trim()
    .split(/\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  try {
    return JSON.parse(lines.at(-1) || "{}");
  } catch {
    throw new Error(`Unable to parse InfiniteTalk response for line ${line.index}.${stderr ? ` ${compactText(stderr, 180)}` : ""}`);
  }
}

async function runFalFabric({ imagePath, audioPath, line, tempDir }) {
  const payloadPath = path.join(tempDir, `fabric-payload-line-${String(line.index).padStart(3, "0")}.json`);
  await writeFile(
    payloadPath,
    JSON.stringify(
      {
        image_path: imagePath,
        audio_path: audioPath,
        model: fabricModelId(),
        resolution: process.env.FAL_FABRIC_RESOLUTION || "720p"
      },
      null,
      2
    )
  );

  let stdout = "";
  let stderr = "";
  try {
    ({ stdout, stderr } = await execFileAsync(
      process.env.NEWTBUILDER_PYTHON_PATH || "python3",
      [falFabricRunnerPath, payloadPath],
      {
        env: {
          ...process.env,
          FAL_KEY: falApiKey,
          FAL_API_KEY: falApiKey
        },
        timeout: Number(process.env.FAL_FABRIC_TIMEOUT_MS || process.env.FAL_LIPSYNC_TIMEOUT_MS || 900000),
        maxBuffer: 12 * 1024 * 1024
      }
    ));
  } catch (error) {
    const detail = compactText(String(error?.stderr || error?.stdout || error?.message || error), 220);
    throw new Error(`Fabric request failed for line ${line.index}. ${detail}`);
  }

  const lines = String(stdout || "")
    .trim()
    .split(/\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  try {
    return JSON.parse(lines.at(-1) || "{}");
  } catch {
    throw new Error(`Unable to parse Fabric response for line ${line.index}.${stderr ? ` ${compactText(stderr, 180)}` : ""}`);
  }
}

function falVideoUrl(result) {
  return (
    result?.video?.url ||
    result?.url ||
    result?.videos?.[0]?.url ||
    result?.output?.video?.url ||
    result?.output?.url ||
    ""
  );
}

function localVideoPath(result) {
  return (
    result?.video?.path ||
    result?.localPath ||
    result?.local_path ||
    result?.path ||
    result?.output?.path ||
    ""
  );
}

async function normalizeLipSyncClip({ sourcePath, outputPath, fps, width, height }) {
  const targetWidth = Math.max(0, Math.round(Number(width) || 0));
  const targetHeight = Math.max(0, Math.round(Number(height) || 0));
  const fitFilters =
    targetWidth && targetHeight
      ? [
          `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=increase`,
          `crop=${targetWidth}:${targetHeight}:x=(in_w-out_w)/2:y=(in_h-out_h)/2`,
          "setsar=1"
        ]
      : ["setsar=1"];
  await execFileAsync(
    ffmpegPath,
    [
      "-y",
      "-i",
      sourcePath,
      "-an",
      "-vf",
      fitFilters.join(","),
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-r",
      String(fps || 30),
      "-movflags",
      "+faststart",
      outputPath
    ],
    { timeout: 180000, maxBuffer: 20 * 1024 * 1024 }
  );
}

async function compositeLipSyncClipWithMask({ lipSyncPath, stillPath, maskPath, outputPath, invertMask, fps, durationSeconds, width, height }) {
  const duration = roundSeconds(Math.max(0.35, Number(durationSeconds) || (await probeDuration(lipSyncPath)) || 0.35));
  const targetWidth = Math.max(0, Math.round(Number(width) || 0));
  const targetHeight = Math.max(0, Math.round(Number(height) || 0));
  const maskChain = renderMaskCleanupFilter({ invert: invertMask });
  const outputFitChain =
    targetWidth && targetHeight
      ? `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=increase,crop=${targetWidth}:${targetHeight}:x=(in_w-out_w)/2:y=(in_h-out_h)/2,setsar=1`
      : "setsar=1";
  const filterComplex = [
    "[0:v]format=rgba[fab0]",
    "[1:v]format=rgba[still0]",
    "[still0][fab0]scale2ref[still][fab1]",
    `[2:v]${maskChain}[mask0]`,
    "[mask0][fab1]scale2ref=flags=neighbor[maskg][fab2]",
    "[fab2]format=rgba,setsar=1[fab_rgba]",
    "[still]format=rgba,setsar=1[still_rgba]",
    "[maskg]format=gray[mask_gray]",
    "[fab_rgba][mask_gray]alphamerge[fab_a]",
    `[still_rgba][fab_a]overlay=format=auto:shortest=1,${outputFitChain}[outv]`
  ].join(";");

  await execFileAsync(
    ffmpegPath,
    [
      "-y",
      "-i",
      lipSyncPath,
      "-loop",
      "1",
      "-t",
      duration.toFixed(3),
      "-i",
      stillPath,
      "-loop",
      "1",
      "-t",
      duration.toFixed(3),
      "-i",
      maskPath,
      "-filter_complex",
      filterComplex,
      "-map",
      "[outv]",
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-r",
      String(fps || 30),
      "-movflags",
      "+faststart",
      "-shortest",
      "-t",
      duration.toFixed(3),
      outputPath
    ],
    { timeout: 180000, maxBuffer: 20 * 1024 * 1024 }
  );
}

async function generateDrawnSpeakerMaskForLine({ line, imagePath, maskDataUrl }) {
  const maskBuffer = bufferFromPngDataUrl(maskDataUrl);
  const runId = randomUUID();
  const tempDir = path.join(outputsDir, "tmp", `drawn-mask-${runId}`);
  await mkdir(tempDir, { recursive: true });

  const safeSpeaker = safeFileSegment(line.speaker || "speaker");
  const storedFileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}-drawn-mask-line-${String(line.index).padStart(3, "0")}-${safeSpeaker}.png`;
  const rawMaskPath = path.join(tempDir, `raw-${storedFileName}`);
  const maskPath = path.join(uploadsDir, storedFileName);
  await writeFile(rawMaskPath, maskBuffer);
  await normalizeDrawnMask({ maskPath: rawMaskPath, imagePath, outputPath: maskPath });

  const asset = normalizeAsset({
    id: randomUUID(),
    type: "image",
    shotRole: "mask",
    roleLabel: "Drawn Speaker Mask",
    fileName: `drawn-mask-line-${String(line.index).padStart(3, "0")}-${safeSpeaker}.png`,
    storedFileName,
    mimeType: "image/png",
    localUrl: `/uploads/${storedFileName}`,
    createdAt: new Date().toISOString(),
    metadata: {
      kind: "speaker-drawn-mask",
      sourceImageAssetId: line.image?.assetId || line.assetId || "",
      speakerMaskKey: speakerMaskReuseKey(line),
      maskRefreshToken: String(line.maskRefreshToken || "").trim(),
      speaker: String(line.speaker || "").trim(),
      characterId: cleanId(line.characterId),
      postProcessVersion: "drawn-speaker-mask-v1"
    }
  });

  return { asset };
}

async function generateAutomaticSpeakerMaskForLine({ line, imageAsset, show }) {
  const imagePath = resolveAssetPath(imageAsset);
  if (!imagePath) return null;

  const dimensions = await probeMediaDimensions(imagePath);
  if (!dimensions.width || !dimensions.height) return null;

  const region = await speakerMaskRegionForLine({ line, imageAsset, show, dimensions });
  if (!region) return null;

  const safeSpeaker = safeFileSegment(line.speaker || "speaker");
  const storedFileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}-auto-mask-line-${String(line.index).padStart(3, "0")}-${safeSpeaker}.png`;
  const maskPath = path.join(uploadsDir, storedFileName);
  await renderAutomaticSpeakerMask({ outputPath: maskPath, dimensions, region });

  const asset = normalizeAsset({
    id: randomUUID(),
    type: "image",
    shotRole: "mask",
    roleLabel: "Auto Speaker Mask",
    fileName: `auto-mask-line-${String(line.index).padStart(3, "0")}-${safeSpeaker}.png`,
    storedFileName,
    mimeType: "image/png",
    localUrl: `/uploads/${storedFileName}`,
    createdAt: new Date().toISOString(),
    metadata: {
      kind: "speaker-auto-mask",
      sourceImageAssetId: line.assetId || "",
      speakerMaskKey: speakerMaskReuseKey(line),
      maskRefreshToken: String(line.maskRefreshToken || "").trim(),
      speaker: String(line.speaker || "").trim(),
      speakerRole: targetSpeakerRoleForLine(line, imageAsset),
      characterId: cleanId(line.characterId),
      detector: region.detector || "shot-asset-speaking-tags",
      confidence: Number(region.confidence || 0),
      maskRegionX: Number(region.x || 0),
      maskRegionY: Number(region.y || 0),
      maskRegionWidth: Number(region.width || 0),
      maskRegionHeight: Number(region.height || 0),
      postProcessVersion: autoSpeakerMaskVersion
    }
  });

  return { asset };
}

async function speakerMaskRegionForLine({ line, imageAsset, show, dimensions }) {
  const visionRegion = await openAiSpeakerMaskRegion({ line, imageAsset, show, dimensions }).catch(() => null);
  if (visionRegion) return visionRegion;
  return filenameSpeakerMaskRegion({ line, imageAsset, dimensions });
}

function castVisualPromptProfile(provider) {
  const normalized = sanitizeLipSyncModel(provider);
  if (normalized === "kling") {
    return {
      provider: "kling",
      label: "Kling Avatar",
      targetCharacters: 1300,
      maxOutputTokens: 900,
      guidance: [
        "Kling Avatar works best with a direct cinematic instruction prompt.",
        "Use a compact paragraph or short structured clauses that emphasize source-image preservation first, then visible character identity, framing, expression, and restrained avatar motion.",
        "Avoid long negative lists; use concise prevention language such as no added text, no extra characters, no camera changes.",
        "Keep it suitable to be followed by separate dialogue and shot-direction instructions."
      ]
    };
  }
  if (normalized === "aurora") {
    return {
      provider: "aurora",
      label: "Creatify Aurora",
      targetCharacters: 1600,
      maxOutputTokens: 1100,
      guidance: [
        "Creatify Aurora works best with a polished talking-avatar prompt.",
        "Use a stable visual-reference format that clearly separates identity, composition, style, lighting/background, and preservation constraints.",
        "Favor concrete visible descriptors over abstract mood words.",
        "Keep motion direction minimal because dialogue and per-shot motion instructions are added later."
      ]
    };
  }
  if (normalized === "infinitalk") {
    return {
      provider: "infinitalk",
      label: "InfiniteTalk",
      targetCharacters: 1500,
      maxOutputTokens: 1000,
      guidance: [
        "InfiniteTalk works best with identity-first talking-head or talking-character reference prompts.",
        "Use a concise but detailed visual identity paragraph with explicit stability instructions for face, body, outfit, art style, background, and camera framing.",
        "Prioritize lip-sync reliability and source-image consistency over elaborate scene direction.",
        "Avoid instructions that ask for new poses, new camera movement, or new objects."
      ]
    };
  }
  return {
    provider: "fabric",
    label: "Fabric",
    targetCharacters: 1200,
    maxOutputTokens: 800,
    guidance: [
      "Fabric does not currently submit a text prompt, but this Cast Visual prompt may be reused if the shot switches to a prompt-based renderer.",
      "Generate a general image-to-video visual reference prompt focused on source-image preservation, visible character identity, composition, and style.",
      "Do not include dialogue or per-shot action."
    ]
  };
}

async function generateCastVisualLipSyncPrompt({ asset, show, provider }) {
  if (!openAiApiKey) {
    throw new Error("OpenAI API key is not configured.");
  }
  const imagePath = resolveAssetPath(asset);
  if (!imagePath) {
    throw new Error("Cast Visual image file could not be found.");
  }

  const imageUrl = await imageDataUri(imagePath);
  const characterNames = uniqueStrings((show?.characters || []).map((character) => character.name).filter(Boolean)).join(", ");
  const visualStyle = show?.creative?.visualStyle || "expressive cinematic animated episodes";
  const speakingTag = asset?.metadata?.speakingTag || asset?.metadata?.characterTags || "";
  const profile = castVisualPromptProfile(provider);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.NEWTBUILDER_VISION_MODEL || "gpt-4.1-mini",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                `Create a reusable Cast Visual input prompt for the ${profile.label} lip-sync renderer.`,
                "Inspect the uploaded image and first decide the ideal prompt format for this renderer and image.",
                "Then output only the finished prompt text in that format. Do not explain your choice.",
                "The prompt must be optimized for preserving the input image during lip-sync generation.",
                "Describe only visible character identity, art style, framing, background, lighting, wardrobe, colors, expression, and source-image preservation details.",
                "Do not invent unseen details, do not include dialogue, and do not include episode-specific shot action.",
                `Target length: about ${profile.targetCharacters} characters; keep every important identity detail, but stay below ${lipSyncInputPromptMaxLength} characters.`,
                ...profile.guidance,
                `Show visual style: ${visualStyle}.`,
                characterNames ? `Known cast names: ${characterNames}.` : "",
                speakingTag ? `Image speaking tag: ${speakingTag}.` : "",
                `Shot type: ${labelForShotRole(asset?.shotRole || "general")}.`,
                `File name: ${asset?.fileName || "unknown"}.`
              ].filter(Boolean).join("\n")
            },
            {
              type: "input_image",
              image_url: imageUrl,
              detail: "high"
            }
          ]
        }
      ],
      max_output_tokens: profile.maxOutputTokens
    }),
    signal:
      typeof AbortSignal !== "undefined" && AbortSignal.timeout
        ? AbortSignal.timeout(Number(process.env.OPENAI_VISION_TIMEOUT_MS || 45000))
        : undefined
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`OpenAI visual prompt failed (${response.status})${detail ? `: ${compactText(detail, 220)}` : ""}`);
  }
  const payload = await response.json();
  return compactText(
    extractOpenAiResponseText(payload)
      .replace(/^["'\s]*(?:prompt|visual prompt|input prompt|cast visual prompt)\s*:\s*/i, "")
      .replace(/["'\s]+$/g, "")
      .trim(),
    lipSyncInputPromptMaxLength
  );
}

async function openAiSpeakerMaskRegion({ line, imageAsset, show, dimensions }) {
  if (!openAiApiKey || String(process.env.NEWTBUILDER_DISABLE_VISION_MASKS || "").toLowerCase() === "true") {
    return null;
  }

  const imagePath = resolveAssetPath(imageAsset);
  if (!imagePath) return null;
  const imageUrl = await imageDataUri(imagePath);
  const character = findCharacterForSpeaker(line.speaker, show);
  const targetRole = targetSpeakerRoleForLine(line, imageAsset);
  const binding = assetShotBinding(imageAsset);
  const roleOrder = binding.roles.length ? binding.roles.join(", ") : "unknown";
  const characterContext = characterMaskContext({ line, character, show });

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.NEWTBUILDER_VISION_MODEL || "gpt-4.1-mini",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                "Locate the character who should be animated for a dialogue lip-sync mask.",
                "Return only compact JSON in this exact shape:",
                "{\"confidence\":0.0,\"box\":{\"x\":0.0,\"y\":0.0,\"width\":0.0,\"height\":0.0},\"reason\":\"short\"}",
                "The box must be normalized 0-1 coordinates around the full visible character, including hair, head, body, hands, and arms, with a little safe padding.",
                "Do not include other characters. If the target is unclear, return confidence below 0.65.",
                `Target speaker: ${line.speaker || "unknown"}`,
                `Target role: ${targetRole}`,
                `Shot asset speaking tags: ${roleOrder}`,
                `Shot asset file name: ${imageAsset?.fileName || "unknown"}`,
                `Image size: ${dimensions.width}x${dimensions.height}`,
                characterContext
              ]
                .filter(Boolean)
                .join("\n")
            },
            {
              type: "input_image",
              image_url: imageUrl,
              detail: "high"
            }
          ]
        }
      ],
      max_output_tokens: 450
    }),
    signal:
      typeof AbortSignal !== "undefined" && AbortSignal.timeout
        ? AbortSignal.timeout(Number(process.env.OPENAI_VISION_TIMEOUT_MS || 45000))
        : undefined
  });

  if (!response.ok) {
    throw new Error(`OpenAI vision mask failed (${response.status}).`);
  }
  const payload = await response.json();
  const parsed = parseResponseJsonObject(extractOpenAiResponseText(payload));
  const box = parsed?.box || {};
  const confidence = Number(parsed?.confidence || 0);
  const threshold = boundedEnvNumber("NEWTBUILDER_VISION_MASK_CONFIDENCE", 0.68, 0.1, 1);
  if (confidence < threshold) return null;
  return normalizeMaskRegion(
    {
      x: Number(box.x),
      y: Number(box.y),
      width: Number(box.width),
      height: Number(box.height),
      confidence,
      detector: "openai-vision"
    },
    dimensions
  );
}

function filenameSpeakerMaskRegion({ line, imageAsset, dimensions }) {
  const binding = assetShotBinding(imageAsset);
  const roles = binding.roles || [];
  const targetRole = targetSpeakerRoleForLine(line, imageAsset);
  const roleIndex = roles.indexOf(targetRole);
  const shotRole = binding.shotRole || effectiveAssetShotRole(imageAsset) || line.shotRole || "";
  if (roles.length < 2 || roleIndex === -1 || !["medium_two_shot", "wide_shot"].includes(shotRole)) {
    return null;
  }

  const region = filenameLaneRegion({ roleCount: roles.length, roleIndex, shotRole });
  return normalizeMaskRegion(
    {
      ...region,
      confidence: 0.55,
      detector: "shot-asset-speaking-tags"
    },
    dimensions
  );
}

function filenameLaneRegion({ roleCount, roleIndex, shotRole }) {
  const count = Math.max(2, Math.min(4, roleCount));
  const index = Math.min(roleIndex, count - 1);
  const isWide = shotRole === "wide_shot";
  const top = isWide ? 0.025 : 0.05;
  const height = isWide ? 0.95 : 0.9;

  if (count === 2) {
    return {
      x: index === 0 ? 0.035 : 0.525,
      y: top,
      width: 0.44,
      height
    };
  }

  if (count === 3) {
    const bands = [
      { x: 0.035, width: 0.38 },
      { x: 0.34, width: 0.32 },
      { x: 0.585, width: 0.38 }
    ];
    return {
      ...bands[index],
      y: top,
      height
    };
  }

  const laneWidth = 1 / count;
  const sidePadRatio = 0.04;
  return {
    x: laneWidth * index + laneWidth * sidePadRatio,
    y: top,
    width: laneWidth * (1 - sidePadRatio * 2),
    height
  };
}

function targetSpeakerRoleForLine(line, imageAsset) {
  const speakerKey = keyForMatch(line?.speaker);
  return speakerKey ? speakerTypeFor(line.speaker) : assetSpeakingRoles(imageAsset)[0] || "guest";
}

function characterMaskContext({ line, character, show }) {
  const cast = Array.isArray(show?.characters)
    ? show.characters
        .map((item) =>
          [item.name, item.role, item.visualNotes]
            .map((value) => String(value || "").trim())
            .filter(Boolean)
            .join(": ")
        )
        .filter(Boolean)
        .join("\n")
    : "";
  return [
    character
      ? `Target character profile: ${[character.name, character.role, character.visualNotes]
          .map((value) => String(value || "").trim())
          .filter(Boolean)
          .join(": ")}`
      : "",
    cast ? `Cast profiles:\n${cast}` : "",
    line?.text ? `Dialogue line: ${line.text}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function normalizeMaskRegion(region, dimensions) {
  const safePad = Number(region.detector === "openai-vision" ? 0.055 : 0);
  const x = Number(region.x);
  const y = Number(region.y);
  const width = Number(region.width);
  const height = Number(region.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  const left = Math.max(0, x - safePad);
  const top = Math.max(0, y - safePad);
  const right = Math.min(1, x + width + safePad);
  const bottom = Math.min(1, y + height + safePad);
  const normalized = {
    x: left,
    y: top,
    width: Math.max(0.05, right - left),
    height: Math.max(0.08, bottom - top),
    confidence: Number(region.confidence || 0),
    detector: region.detector || "unknown"
  };
  if (normalized.x + normalized.width > 1) normalized.width = 1 - normalized.x;
  if (normalized.y + normalized.height > 1) normalized.height = 1 - normalized.y;
  if (normalized.width * dimensions.width < 20 || normalized.height * dimensions.height < 20) return null;
  return normalized;
}

async function renderAutomaticSpeakerMask({ outputPath, dimensions, region }) {
  const width = Math.max(1, Math.round(dimensions.width));
  const height = Math.max(1, Math.round(dimensions.height));
  const x = Math.round(region.x * width);
  const y = Math.round(region.y * height);
  const boxWidth = Math.max(1, Math.round(region.width * width));
  const boxHeight = Math.max(1, Math.round(region.height * height));
  const feather = boundedEnvNumber("NEWTBUILDER_AUTO_MASK_FEATHER_PX", 1.75, 0, 12);
  await execFileAsync(
    ffmpegPath,
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=black:s=${width}x${height}:r=1`,
      "-vf",
      `drawbox=x=${x}:y=${y}:w=${boxWidth}:h=${boxHeight}:color=white:t=fill,gblur=sigma=${feather},format=gray,setsar=1`,
      "-frames:v",
      "1",
      "-update",
      "1",
      outputPath
    ],
    { timeout: 90000, maxBuffer: 12 * 1024 * 1024 }
  );
}

function extractOpenAiResponseText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  const parts = [];
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (typeof content?.text === "string") parts.push(content.text);
      if (typeof content?.output_text === "string") parts.push(content.output_text);
    }
  }
  return parts.join("\n");
}

function extractOpenAiChatResponseText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => part?.text || part?.output_text || "")
      .filter(Boolean)
      .join("\n");
  }
  return extractOpenAiResponseText(payload);
}

function parseResponseJsonObject(text) {
  const clean = String(text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(clean.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function normalizeDrawnMask({ maskPath, imagePath, outputPath }) {
  const cleanupFilter = maskCleanupFilter({
    featherPixels: boundedEnvNumber("NEWTBUILDER_DRAWN_MASK_FEATHER_PX", 1.25, 0, 8)
  });
  const filterComplex = [
    "[0:v]format=gray[mask0]",
    "[mask0][1:v]scale2ref=flags=neighbor[mask][ref]",
    "[ref]nullsink",
    `[mask]${cleanupFilter}[out]`
  ].join(";");

  await execFileAsync(
    ffmpegPath,
    [
      "-y",
      "-i",
      maskPath,
      "-i",
      imagePath,
      "-filter_complex",
      filterComplex,
      "-map",
      "[out]",
      "-frames:v",
      "1",
      "-update",
      "1",
      outputPath
    ],
    { timeout: 90000, maxBuffer: 12 * 1024 * 1024 }
  );
}

function bufferFromPngDataUrl(dataUrl) {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/u.exec(String(dataUrl || "").trim());
  if (!match) {
    throw new Error("Mask editor did not send a valid PNG mask.");
  }
  return Buffer.from(match[1], "base64");
}

function renderMaskCleanupFilter({ invert = false } = {}) {
  return maskCleanupFilter({
    invert,
    dilationPasses: Math.round(boundedEnvNumber("NEWTBUILDER_MASK_RENDER_DILATE_PASSES", 4, 0, 24)),
    featherPixels: boundedEnvNumber("NEWTBUILDER_MASK_RENDER_FEATHER_PX", 1.5, 0, 12)
  });
}

function maskCleanupFilter({ invert = false, dilationPasses = 0, featherPixels = 0 } = {}) {
  return [
    "format=gray",
    invert ? "negate" : "",
    ...Array.from({ length: Math.max(0, dilationPasses) }, () => "dilation"),
    featherPixels > 0 ? `gblur=sigma=${featherPixels}` : "",
    "format=gray",
    "setsar=1"
  ]
    .filter(Boolean)
    .join(",");
}

async function generateInsertVideoForLine({ episode, line, format }) {
  if (!falApiKey) {
    throw new Error("fal API key is not configured.");
  }
  if (!line.imagePath) {
    throw new Error("Insert line needs an image reference.");
  }

  const mode = insertVideoModeForLine(line);
  if (mode === "first_last_frame" && !line.endImagePath) {
    throw new Error("First/last-frame insert generation needs a last-frame image.");
  }
  const prompt = insertVideoPrompt(line);
  const imageUrl = await imageDataUri(line.imagePath);
  const endImageUrl = mode === "first_last_frame" && line.endImagePath ? await imageDataUri(line.endImagePath) : "";
  const modelId = seedanceModelId(mode);
  const url = `https://fal.run/${modelId}`;
  const body =
    mode === "reference"
      ? {
          prompt,
          image_urls: [imageUrl],
          duration: String(insertVideoDurationSeconds(line)),
          aspect_ratio: format.aspectRatio || "16:9",
          resolution: seedanceResolution(),
          generate_audio: false
        }
      : {
          prompt,
          image_url: imageUrl,
          ...(endImageUrl ? { end_image_url: endImageUrl } : {}),
          duration: String(insertVideoDurationSeconds(line)),
          aspect_ratio: format.aspectRatio || "16:9",
          resolution: seedanceResolution(),
          generate_audio: false
        };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Key ${falApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body),
    signal:
      typeof AbortSignal !== "undefined" && AbortSignal.timeout
        ? AbortSignal.timeout(Number(process.env.FAL_VIDEO_TIMEOUT_MS || 600000))
        : undefined
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`fal Seedance returned ${response.status}${detail ? `: ${compactText(detail, 220)}` : ""}`);
  }

  const result = await response.json();
  const remoteUrl = result?.video?.url || result?.url || result?.videos?.[0]?.url || "";
  if (!remoteUrl) {
    throw new Error("fal Seedance response did not include a video URL.");
  }

  const runId = randomUUID();
  const videoDir = path.join(outputsDir, "insert-videos", episode.id);
  await mkdir(videoDir, { recursive: true });
  const fileName = `insert-${String(line.index).padStart(3, "0")}-${runId.slice(0, 8)}.mp4`;
  const filePath = path.join(videoDir, fileName);
  await downloadRemoteFile(remoteUrl, filePath, "generated insert video");
  const localUrl = `/outputs/insert-videos/${episode.id}/${fileName}`;
  const proxyFileName = `insert-${String(line.index).padStart(3, "0")}-${runId.slice(0, 8)}-proxy.mp4`;
  const proxyFilePath = path.join(videoDir, proxyFileName);
  const proxyLocalUrl = `/outputs/insert-videos/${episode.id}/${proxyFileName}`;
  await writeVideoProxy({ sourcePath: filePath, outputPath: proxyFilePath });
  const take = createVideoTake({
    line,
    format,
    filePath,
    localUrl,
    proxyFilePath,
    proxyLocalUrl,
    remoteUrl,
    result,
    prompt,
    source: mode === "reference" ? "fal-seedance-reference" : "fal-seedance-keyframe"
  });
  return {
    ...take,
    durationSeconds: await probeDuration(filePath)
  };
}

async function imageDataUri(filePath) {
  const buffer = await readFile(filePath);
  const mimeType = mimeTypeForFilePath(filePath);
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function mimeTypeForFilePath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}

async function downloadRemoteFile(url, filePath, label = "remote file") {
  const response = await fetch(url, {
    signal:
      typeof AbortSignal !== "undefined" && AbortSignal.timeout
        ? AbortSignal.timeout(Number(process.env.FAL_DOWNLOAD_TIMEOUT_MS || 180000))
        : undefined
  });
  if (!response.ok) {
    throw new Error(`Unable to download ${label} (${response.status}).`);
  }
  await writeFile(filePath, Buffer.from(await response.arrayBuffer()));
}

async function writeVideoProxy({ sourcePath, outputPath }) {
  await execFileAsync(
    ffmpegPath,
    [
      "-y",
      "-i",
      sourcePath,
      "-vf",
      "scale='if(gte(iw,ih),480,-2)':'if(gte(iw,ih),-2,480)',fps=15,format=yuv420p",
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "30",
      "-movflags",
      "+faststart",
      outputPath
    ],
    { timeout: 120000, maxBuffer: 12 * 1024 * 1024 }
  );
}

async function writeLineSpeechWav({ filePath, line, tempDir, previousText = "", nextText = "" }) {
  const provider = audioProviderMode();
  const warnings = [];
  const hasElevenVoice = Boolean(elevenVoiceIdForLine(line));
  const shouldTryEleven = provider === "elevenlabs" || (provider === "auto" && elevenLabsApiKey && hasElevenVoice);

  if (shouldTryEleven) {
    try {
      const result = await writeElevenLabsSpeechWav({ filePath, line, tempDir, previousText, nextText });
      if (result.durationSeconds > 0) return result;
    } catch (error) {
      warnings.push(cleanErrorMessage(error));
    }
  }

  if (provider === "auto" || provider === "elevenlabs" || provider === "macos") {
    try {
      const result = await writeMacSpeechWav({ filePath, line, tempDir });
      if (result.durationSeconds > 0) {
        return {
          ...result,
          warning: warnings.length ? `ElevenLabs unavailable, used macOS voice. ${warnings[0]}` : ""
        };
      }
    } catch (error) {
      warnings.push(cleanErrorMessage(error));
    }
  }

  await writeFile(
    filePath,
    wavBufferForTone({
      durationSeconds: line.durationSeconds,
      frequency: frequencyForSpeaker(line.speaker)
    })
  );
  return {
    mode: "demo-tone",
    voiceName: "",
    voiceId: "",
    warning: warnings.length ? `Speech provider fallback used. ${warnings[0]}` : "",
    durationSeconds: await probeDuration(filePath)
  };
}

async function writeElevenLabsSpeechWav({ filePath, line, tempDir, previousText = "", nextText = "" }) {
  if (!elevenLabsApiKey) {
    throw new Error("ElevenLabs API key is not configured.");
  }

  const voiceId = elevenVoiceIdForLine(line);
  if (!voiceId) {
    throw new Error("No ElevenLabs voice ID is assigned for this line.");
  }

  const modelId = process.env.ELEVEN_MODEL_ID || "eleven_v3";
  const outputFormat = process.env.ELEVEN_OUTPUT_FORMAT || "mp3_44100_128";
  const tempFile = path.join(tempDir, `${path.basename(filePath, ".wav")}.${extensionForElevenOutputFormat(outputFormat)}`);
  const url = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`);
  url.searchParams.set("output_format", outputFormat);

  const body = {
    text: speechTextForElevenLine(line),
    model_id: modelId,
    voice_settings: elevenVoiceSettings()
  };
  if (modelId !== "eleven_v3") {
    if (previousText) body.previous_text = previousText;
    if (nextText) body.next_text = nextText;
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": elevenLabsApiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg"
      },
      body: JSON.stringify(body),
      signal:
        typeof AbortSignal !== "undefined" && AbortSignal.timeout
          ? AbortSignal.timeout(Number(process.env.ELEVEN_TIMEOUT_MS || 120000))
          : undefined
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`ElevenLabs TTS returned ${response.status}${detail ? `: ${compactText(detail, 180)}` : ""}`);
    }

    await writeFile(tempFile, Buffer.from(await response.arrayBuffer()));
    await cleanSpeechSourceToWav({ sourcePath: tempFile, outputPath: filePath, timeout: 90000 });
  } finally {
    await rm(tempFile, { force: true });
  }

  return {
    mode: "elevenlabs",
    voiceName: elevenVoiceNameForLine(line, voiceId),
    voiceId,
    durationSeconds: await probeDuration(filePath)
  };
}

async function writeMacSpeechWav({ filePath, line, tempDir }) {
  const voiceName = macVoiceForLine(line);
  const tempFile = path.join(tempDir, `${path.basename(filePath, ".wav")}.aiff`);
  await execFileAsync(
    process.env.MACOS_SAY_PATH || "say",
    ["-v", voiceName, "-o", tempFile, plainSpeechText(line)],
    { timeout: 60000, maxBuffer: 2 * 1024 * 1024 }
  );
  await cleanSpeechSourceToWav({ sourcePath: tempFile, outputPath: filePath, timeout: 60000 });
  await rm(tempFile, { force: true });
  return {
    mode: "macos-say",
    voiceName,
    voiceId: line.voiceId || "",
    durationSeconds: await probeDuration(filePath)
  };
}

async function writeSilentSpeechWav({ filePath, durationSeconds }) {
  await writeFile(filePath, wavBufferForSilence({ durationSeconds }));
  return {
    mode: "silent-insert",
    voiceName: "",
    voiceId: "",
    warning: "",
    durationSeconds: await probeDuration(filePath)
  };
}

async function cleanSpeechSourceToWav({ sourcePath, outputPath, timeout }) {
  const sourceDuration = await probeDuration(sourcePath);
  const fadeOutStart = Math.max(0, sourceDuration - 0.012);
  const filter = [
    "aresample=48000",
    "aformat=sample_fmts=s16:channel_layouts=mono",
    "afade=t=in:st=0:d=0.012",
    `afade=t=out:st=${fadeOutStart.toFixed(3)}:d=0.012`,
    "apad=pad_dur=0.16",
    "volume=0.86",
    "alimiter=limit=0.85"
  ].join(",");

  await execFileAsync(
    ffmpegPath,
    [
      "-y",
      "-i",
      sourcePath,
      "-af",
      filter,
      "-ar",
      "48000",
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      outputPath
    ],
    { timeout, maxBuffer: 8 * 1024 * 1024 }
  );
}

async function writeEpisodeSpeechMix({ filePath, lines, tempDir }) {
  const concatFile = path.join(tempDir, "audio-clips.txt");
  await writeFile(
    concatFile,
    `${lines
      .filter((line) => line.audio?.fileName || line.audio?.filePath)
      .map((line) => {
        const audioPath = line.audio.filePath || path.join(path.dirname(filePath), line.audio.fileName);
        return `file '${escapeConcatPath(audioPath)}'`;
      })
      .join("\n")}\n`
  );
  await execFileAsync(
    ffmpegPath,
    [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatFile,
      "-ar",
      "48000",
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      filePath
    ],
    { timeout: 90000, maxBuffer: 8 * 1024 * 1024 }
  );
}

function refreshManifestTiming(manifest) {
  let cursor = 0;
  for (const line of manifest.lines) {
    line.startSeconds = roundSeconds(cursor);
    line.durationSeconds = roundSeconds(Math.max(0.35, Number(line.durationSeconds) || 0.35));
    cursor += line.durationSeconds;
  }
  manifest.totalSeconds = roundSeconds(cursor);
}

function summarizeAudioMode(lines) {
  const modes = uniqueStrings(lines.map((line) => line.audio?.mode).filter(Boolean));
  if (!modes.length) return "unknown";
  if (modes.length === 1) return modes[0];
  return modes.join("+");
}

function audioProviderMode() {
  const configured = String(process.env.NEWTBUILDER_AUDIO_PROVIDER || "auto").toLowerCase();
  if (["auto", "elevenlabs", "macos", "tone"].includes(configured)) return configured;
  return "auto";
}

function elevenVoiceIdForLine(line) {
  const voiceId = String(line.voiceId || "").trim();
  const voiceKey = voiceId.toLowerCase();
  const speakerType = speakerTypeFor(line.speaker);
  const mappedByDemoVoice = {
    demo_max: process.env.ELEVEN_MAX_VOICE_ID || "",
    demo_pip: process.env.ELEVEN_PIP_VOICE_ID || "",
    demo_guest: process.env.ELEVEN_GUEST_VOICE_ID || ""
  }[voiceKey];

  if (mappedByDemoVoice) return mappedByDemoVoice;
  if (voiceId && !voiceKey.startsWith("demo_")) return voiceId;
  if (speakerType === "max") return process.env.ELEVEN_MAX_VOICE_ID || "";
  if (speakerType === "pip") return process.env.ELEVEN_PIP_VOICE_ID || "";
  return process.env.ELEVEN_GUEST_VOICE_ID || "";
}

function elevenVoiceNameForLine(line, voiceId) {
  const assigned = String(line.voiceId || "").trim();
  if (assigned && assigned !== voiceId) return `${assigned} -> ${voiceId}`;
  return voiceId;
}

function elevenVoiceSettings() {
  return {
    stability: boundedEnvNumber("ELEVEN_STABILITY", 0.5, 0, 1),
    similarity_boost: boundedEnvNumber("ELEVEN_SIMILARITY_BOOST", 0.75, 0, 1),
    style: boundedEnvNumber("ELEVEN_STYLE", 0, 0, 1),
    speed: boundedEnvNumber("ELEVEN_SPEED", 1, 0.7, 1.2),
    use_speaker_boost: stringEnvBoolean("ELEVEN_USE_SPEAKER_BOOST", true)
  };
}

function boundedEnvNumber(name, fallback, min, max) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function oddKernelNumber(name, fallback, min, max) {
  const bounded = Math.round(boundedEnvNumber(name, fallback, min, max));
  if (bounded <= 0) return 0;
  return bounded % 2 === 1 ? bounded : Math.min(max, bounded + 1);
}

function stringEnvBoolean(name, fallback) {
  const value = String(process.env[name] || "").trim().toLowerCase();
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value);
}

function extensionForElevenOutputFormat(outputFormat) {
  const codec = String(outputFormat || "").split("_")[0].toLowerCase();
  if (["mp3", "wav", "ogg"].includes(codec)) return codec;
  return "audio";
}

function audioMimeTypeForElevenOutputFormat(outputFormat) {
  const extension = extensionForElevenOutputFormat(outputFormat);
  if (extension === "wav") return "audio/wav";
  if (extension === "ogg") return "audio/ogg";
  return "audio/mpeg";
}

function extensionForGeneratedAudio({ contentType, outputFormat }) {
  const normalizedType = String(contentType || "").toLowerCase();
  if (normalizedType.includes("wav")) return "wav";
  if (normalizedType.includes("ogg")) return "ogg";
  if (normalizedType.includes("mpeg") || normalizedType.includes("mp3")) return "mp3";
  const extension = extensionForElevenOutputFormat(outputFormat);
  return extension === "audio" ? "mp3" : extension;
}

function musicTagsFromInput(value) {
  const items = Array.isArray(value) ? value : String(value || "").split(/[,;\n]+/);
  return uniqueStrings(
    items
      .map((item) => compactText(String(item || "").replace(/^#+/, "").trim(), 40))
      .filter(Boolean)
  ).slice(0, 10);
}

function cleanErrorMessage(error) {
  return compactText(String(error?.message || error || "Unknown speech provider error").replace(/\s+/g, " "), 700);
}

function macVoiceForLine(line) {
  const voiceId = String(line.voiceId || "").toLowerCase();
  const speakerType = speakerTypeFor(line.speaker);
  const configured = {
    demo_max: process.env.NEWTBUILDER_DEMO_MAX_VOICE || "Eddy (English (US))",
    demo_pip: process.env.NEWTBUILDER_DEMO_PIP_VOICE || "Flo (English (US))",
    demo_guest: process.env.NEWTBUILDER_DEMO_GUEST_VOICE || "Sandy (English (US))"
  }[voiceId];
  if (configured) return configured;
  if (speakerType === "max") return process.env.NEWTBUILDER_DEMO_MAX_VOICE || "Eddy (English (US))";
  if (speakerType === "pip") return process.env.NEWTBUILDER_DEMO_PIP_VOICE || "Flo (English (US))";
  return process.env.NEWTBUILDER_DEMO_GUEST_VOICE || "Sandy (English (US))";
}

function escapeConcatPath(filePath) {
  return String(filePath || "").replace(/'/g, "'\\''");
}

function frequencyForSpeaker(speaker) {
  const type = speakerTypeFor(speaker);
  if (type === "max") return 220;
  if (type === "pip") return 330;
  let hash = 0;
  for (const char of String(speaker || "guest")) {
    hash = (hash + char.charCodeAt(0)) % 120;
  }
  return 250 + hash;
}

function wavBufferForTone({ durationSeconds, frequency }, sampleRate = 48000) {
  return wavBufferFromPcm(
    pcmTone({
      durationSeconds: Math.max(0.2, Number(durationSeconds) || 1),
      frequency: Number(frequency) || 260,
      sampleRate
    }),
    sampleRate
  );
}

function wavBufferForSilence({ durationSeconds }, sampleRate = 48000) {
  const sampleCount = Math.max(1, Math.round(Math.max(0.2, Number(durationSeconds) || 1) * sampleRate));
  return wavBufferFromPcm(Buffer.alloc(sampleCount * 2), sampleRate);
}

function pcmTone({ durationSeconds, frequency, sampleRate }) {
  const sampleCount = Math.max(1, Math.round(durationSeconds * sampleRate));
  const pcm = Buffer.alloc(sampleCount * 2);
  const fadeSamples = Math.min(Math.round(sampleRate * 0.04), Math.floor(sampleCount / 2));
  const voiceLength = Math.max(1, Math.round(sampleCount * 0.86));

  for (let sample = 0; sample < sampleCount; sample += 1) {
    const byteIndex = sample * 2;
    if (sample > voiceLength) {
      pcm.writeInt16LE(0, byteIndex);
      continue;
    }

    const t = sample / sampleRate;
    const fadeIn = fadeSamples ? Math.min(1, sample / fadeSamples) : 1;
    const fadeOut = fadeSamples ? Math.min(1, (voiceLength - sample) / fadeSamples) : 1;
    const envelope = Math.max(0, Math.min(fadeIn, fadeOut));
    const pulse = 0.58 + 0.42 * Math.sin(2 * Math.PI * 5.2 * t);
    const sampleValue = Math.sin(2 * Math.PI * frequency * t) * pulse * envelope * 0.14;
    pcm.writeInt16LE(Math.round(sampleValue * 32767), byteIndex);
  }

  return pcm;
}

function wavBufferFromPcm(pcmData, sampleRate) {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * 2;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcmData.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcmData.length, 40);
  return Buffer.concat([header, pcmData]);
}

function buildCheck(id, label, passed, detail = "", severityWhenFalse = "fail") {
  return {
    id,
    label,
    status: passed ? "pass" : severityWhenFalse,
    detail
  };
}

function safeFileSegment(value) {
  return (
    String(value || "episode")
      .trim()
      .replace(/[^a-z0-9_-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "episode"
  );
}

function appendLog(log = [], message) {
  return [
    {
      id: randomUUID(),
      at: new Date().toISOString(),
      message
    },
    ...log
  ].slice(0, 25);
}

async function fetchElevenLabsVoices() {
  const voices = [];
  let nextPageToken = "";

  do {
    const url = new URL("https://api.elevenlabs.io/v2/voices");
    url.searchParams.set("page_size", "100");
    url.searchParams.set("include_total_count", "true");
    if (nextPageToken) url.searchParams.set("next_page_token", nextPageToken);

    const response = await fetch(url, {
      headers: { "xi-api-key": elevenLabsApiKey }
    });
    if (!response.ok) {
      throw new Error(`ElevenLabs voices returned ${response.status}`);
    }

    const data = await response.json();
    const pageVoices = Array.isArray(data.voices) ? data.voices : [];
    voices.push(
      ...pageVoices
        .map((voice) => ({
          voice_id: voice.voice_id,
          name: voice.name,
          category: voice.category || "",
          description: voice.description || "",
          source: "elevenlabs"
        }))
        .filter((voice) => voice.voice_id && voice.name)
    );

    nextPageToken = data.has_more ? String(data.next_page_token || "") : "";
  } while (nextPageToken);

  return voices;
}

function demoVoiceOptions() {
  return [
    { voice_id: "demo_max", name: "Demo Max", source: "demo" },
    { voice_id: "demo_pip", name: "Demo Pip", source: "demo" },
    { voice_id: "demo_guest", name: "Demo Guest", source: "demo" }
  ];
}

function withDemoVoiceOptions(voices) {
  const seen = new Set();
  return [...voices, ...demoVoiceOptions()].filter((voice) => {
    if (!voice.voice_id || seen.has(voice.voice_id)) return false;
    seen.add(voice.voice_id);
    return true;
  });
}

function nextCurrentStage(approvals) {
  const gate = approvals.find((item) => item.status === "pending" || item.status === "blocked");
  return gate ? gate.stage : "Ready";
}

function resetRenderApproval(approvals = [], note = "") {
  return (Array.isArray(approvals) ? approvals : []).map((gate) =>
    gate.id === "render_preview"
      ? {
          ...gate,
          status: "pending",
          approvedAt: "",
          note: note || gate.note || ""
        }
      : gate
  );
}

function renderApprovalApproved(approvals = []) {
  const gate = (Array.isArray(approvals) ? approvals : []).find((item) => item.id === "render_preview");
  return Boolean(gate && (gate.status === "approved" || gate.status === "auto"));
}

function deriveEpisodeStatus(approvals, currentStatus) {
  if (approvals.some((gate) => gate.status === "blocked")) return "blocked";
  if (approvals.every((gate) => gate.status === "approved" || gate.status === "auto")) return "approved";
  if (currentStatus === "draft") return "draft";
  return "waiting";
}

function approvalTitle(id) {
  return approvalTemplates.find((gate) => gate.id === id)?.title || "Approval";
}

function nextEpisodeTitle(show) {
  return `${show.name} Episode ${new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric"
  })}`;
}

function firstMeaningfulLine(scriptText) {
  return scriptText
    .split(/\r?\n/)
    .map((line) => stripSpeakerPrefix(line).trim())
    .find((line) => line.length > 0);
}

function stripSpeakerPrefix(text) {
  return String(text || "").replace(/^\s*[\w -]{1,24}\s*:\s*/, "");
}

function beatLabel(index, total) {
  if (index === 0) return "Hook";
  if (index === total - 1) return "Payoff";
  if (index === 1) return "Setup";
  if (index === 2) return "Turn";
  return `Beat ${index + 1}`;
}

function cleanTitle(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text || "Untitled Episode";
}

function compactText(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

function normalizeHashtags(items) {
  return uniqueStrings(items.map((item) => String(item || "").trim()).filter(Boolean)).map((item) =>
    item.startsWith("#") ? item : `#${item.replace(/^#+/, "")}`
  );
}

function uniqueStrings(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = String(item || "").trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cleanId(value) {
  return String(value || "").trim();
}

function mediaTypeForMime(mimeType = "") {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType === "application/pdf") return "script";
  if (mimeType.includes("text") || mimeType.includes("json")) return "script";
  return "file";
}

async function extractScriptText(file) {
  const extension = path.extname(file.originalname || "").toLowerCase();
  const mimeType = String(file.mimetype || "").toLowerCase();
  if (extension === ".pdf" || mimeType === "application/pdf") {
    return extractPdfText(file.path);
  }

  const text = await readFile(file.path, "utf8");
  if (!text.trim()) {
    throw new Error("Uploaded script is empty.");
  }
  return text;
}

async function extractPdfText(filePath) {
  const python = findPdfPython();
  if (!python) {
    throw new Error("PDF script upload requires Python with pypdf. Save as .txt or set PDF_TEXT_PYTHON.");
  }

  const code = [
    "import sys",
    "from pathlib import Path",
    "import pypdf",
    "reader = pypdf.PdfReader(sys.argv[1])",
    "parts = []",
    "for page in reader.pages:",
    "    parts.append(page.extract_text() or '')",
    "text = '\\n'.join(parts).strip()",
    "sys.stdout.write(text)"
  ].join("\n");

  try {
    const { stdout } = await execFileAsync(python, ["-c", code, filePath], {
      maxBuffer: 5 * 1024 * 1024,
      timeout: 30000
    });
    const text = String(stdout || "").trim();
    if (!text) {
      throw new Error("No readable text found in PDF.");
    }
    return text;
  } catch (error) {
    throw new Error(`Could not extract text from PDF: ${error.message}`);
  }
}

function findPdfPython() {
  const candidates = [
    process.env.PDF_TEXT_PYTHON,
    process.env.NEWTBUILDER_PYTHON_PATH,
    "/usr/bin/python3",
    "python3",
    "python"
  ].filter(Boolean);

  return candidates.find((candidate) => {
    if (candidate.includes("/") && !existsSync(candidate)) return false;
    return true;
  });
}

function normalizeShortFormat(format = {}) {
  const aspectRatio = format.aspectRatio === "16:9" ? "16:9" : "9:16";
  const durationBoundKeys = new Set(["min", "max", "target"].map((prefix) => `${prefix}Seconds`));
  const unboundedFormat = Object.fromEntries(
    Object.entries(format || {}).filter(([key]) => !durationBoundKeys.has(key))
  );
  return {
    ...shortFormatDefaults,
    ...unboundedFormat,
    aspectRatio,
    resolution: sanitizeFormatResolution(format.resolution, aspectRatio)
  };
}

function normalizeAsset(asset) {
  const fileName = String(asset.fileName || "asset").trim() || "asset";
  const storedRole = sanitizeShotRole(asset.shotRole || asset.role || "");
  const shotRole = storedRole || "general";
  return {
    id: asset.id || randomUUID(),
    type: asset.type || mediaTypeForMime(asset.mimeType),
    shotRole,
    roleLabel: asset.roleLabel || labelForShotRole(shotRole),
    fileName,
    storedFileName: String(asset.storedFileName || "").trim(),
    mimeType: String(asset.mimeType || "application/octet-stream"),
    localUrl: String(asset.localUrl || ""),
    createdAt: asset.createdAt || new Date().toISOString(),
    metadata: normalizeAssetMetadata(asset.metadata)
  };
}

function normalizeAssetMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  const normalized = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!/^[A-Za-z0-9_-]{1,48}$/.test(key)) continue;
    if (!["string", "number", "boolean"].includes(typeof value) && value !== null) continue;
    if (key === "lipSyncPrompt") {
      normalized[key] = compactText(String(value || "").trim(), lipSyncInputPromptMaxLength);
    } else if (key === "lipSyncModel") {
      normalized[key] = sanitizeOptionalLipSyncModel(value);
    } else if (key === "lipSyncPromptModel") {
      normalized[key] = sanitizeOptionalLipSyncModel(value);
    } else if (key === "animationStrength") {
      const animationStrength = normalizeOptionalAnimationStrength(value);
      if (animationStrength !== null) normalized[key] = animationStrength;
    } else if (typeof value === "string") {
      normalized[key] = value.slice(0, 500);
    } else {
      normalized[key] = value;
    }
  }
  return normalized;
}

function normalizeFinishingLayers(layers = []) {
  return (Array.isArray(layers) ? layers : [])
    .map(normalizeFinishingLayer)
    .filter(Boolean)
    .slice(0, 160);
}

function finishingLayersFromRequestOrEpisode(req, episode) {
  const submittedLayers = Array.isArray(req.body?.finishingLayers) ? req.body.finishingLayers : null;
  return normalizeFinishingLayers(submittedLayers || episode?.drafts?.finishingLayers);
}

function normalizeFinishingLayer(layer) {
  if (!layer || typeof layer !== "object") return null;
  const mediaType = sanitizeFinishingLayerType(layer.type || layer.mediaType);
  if (!mediaType) return null;
  const startSeconds = Math.max(0, roundSeconds(layer.startSeconds));
  const durationSeconds = Math.max(0.1, roundSeconds(layer.durationSeconds || layer.duration || 3));
  return {
    id: cleanId(layer.id) || randomUUID(),
    type: mediaType,
    name: compactText(String(layer.name || layer.fileName || `${mediaType} layer`).trim(), 90),
    fileName: path.basename(String(layer.fileName || "").trim()),
    storedFileName: path.basename(String(layer.storedFileName || "").trim()),
    mimeType: String(layer.mimeType || "").trim(),
    localUrl: String(layer.localUrl || "").trim(),
    duplicatedFromLayerId: cleanId(layer.duplicatedFromLayerId),
    cueKind: compactText(String(layer.cueKind || "").trim(), 24),
    cueLineId: cleanId(layer.cueLineId),
    cueLineIndex: Math.max(0, Math.round(Number(layer.cueLineIndex) || 0)),
    cueScore: roundSeconds(layer.cueScore),
    cueIntensity: clampNumber(layer.cueIntensity ?? 0, 0, 1),
    cueConfidence: clampNumber(layer.cueConfidence ?? 0, 0, 1),
    cueSource: compactText(String(layer.cueSource || "").trim(), 60),
    cueReason: compactText(String(layer.cueReason || "").trim(), 220),
    enabled: layer.enabled !== false,
    startSeconds,
    durationSeconds,
    sourceDurationSeconds: clampNumber(layer.sourceDurationSeconds ?? (mediaType === "image" ? 0 : durationSeconds), 0, 9999),
    holdStartSeconds: clampNumber(layer.holdStartSeconds ?? 0, 0, durationSeconds),
    sourceFileSize: Math.max(0, Math.round(Number(layer.sourceFileSize) || 0)),
    xPercent: clampNumber(layer.xPercent ?? 5, 0, 100),
    yPercent: clampNumber(layer.yPercent ?? 5, 0, 100),
    widthPercent: clampNumber(layer.widthPercent ?? (mediaType === "video" ? 100 : 35), 1, 220),
    opacity: clampNumber(layer.opacity ?? 1, 0, 1),
    volume: clampNumber(layer.volume ?? 0.8, 0, 2),
    fadeInSeconds: clampNumber(layer.fadeInSeconds ?? 0, 0, 10),
    fadeOutSeconds: clampNumber(layer.fadeOutSeconds ?? 0, 0, 10),
    createdAt: String(layer.createdAt || new Date().toISOString())
  };
}

function sanitizeFinishingLayerType(value) {
  const type = String(value || "").toLowerCase();
  return ["image", "video", "audio"].includes(type) ? type : "";
}

function finishingLayerImportKey(layer) {
  if (!layer) return "";
  const type = sanitizeFinishingLayerType(layer.type);
  const fileName = String(layer.fileName || layer.name || "").trim().toLowerCase();
  if (!type || !fileName) return "";
  const duration = roundSeconds(layer.sourceDurationSeconds || layer.durationSeconds || 0);
  return [type, fileName, duration || "unknown-duration"].join("|");
}

async function finishingLayerFromUpload(file, baseDurationSeconds = 0) {
  const mediaType = mediaTypeForMime(file.mimetype);
  const type = sanitizeFinishingLayerType(mediaType);
  if (!type) return null;
  const filePath = path.join(uploadsDir, path.basename(file.filename));
  const sourceDuration = type === "image" ? 0 : await probeDuration(filePath);
  const fallbackDuration = type === "image" ? 3 : Math.max(0.1, sourceDuration || 3);
  const maxDuration = Math.max(0.1, Number(baseDurationSeconds) || fallbackDuration);
  const durationSeconds = Math.min(maxDuration, fallbackDuration);
  return normalizeFinishingLayer({
    id: randomUUID(),
    type,
    name: path.basename(file.originalname || file.filename),
    fileName: file.originalname || file.filename,
    storedFileName: file.filename,
    mimeType: file.mimetype || "application/octet-stream",
    localUrl: `/uploads/${file.filename}`,
    enabled: true,
    startSeconds: 0,
    durationSeconds,
    sourceDurationSeconds: sourceDuration,
    holdStartSeconds: 0,
    sourceFileSize: file.size || 0,
    xPercent: type === "video" ? 0 : 5,
    yPercent: type === "video" ? 0 : 5,
    widthPercent: type === "video" ? 100 : 35,
    opacity: 1,
    volume: type === "audio" ? 0.8 : 1,
    fadeInSeconds: type === "audio" ? 0.15 : 0,
    fadeOutSeconds: type === "audio" ? 0.25 : 0,
    createdAt: new Date().toISOString()
  });
}

function sanitizeShotRole(value) {
  const normalized = String(value || "general").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_");
  const allowed = new Set(["character_one_shot", "medium_two_shot", "wide_shot", "insert_shot", "mask", "audio", "script", "general"]);
  return allowed.has(normalized) ? normalized : "general";
}

function labelForShotRole(role) {
  return {
    character_one_shot: "Character One-Shot",
    medium_two_shot: "Medium Two-Shot",
    wide_shot: "Wide Shot",
    insert_shot: "Insert Shot",
    mask: "Mask / Matte",
    audio: "Audio",
    script: "Script",
    general: "General Asset"
  }[role] || "General Asset";
}

