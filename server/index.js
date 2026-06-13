import "dotenv/config";

import cors from "cors";
import express from "express";
import multer from "multer";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rm, writeFile, stat } from "node:fs/promises";
import { promisify } from "node:util";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const falFabricRunnerPath = path.join(__dirname, "fal_fabric_runner.py");
const falKlingAvatarRunnerPath = path.join(__dirname, "fal_kling_avatar_runner.py");
const dataDir = path.join(__dirname, "data");
const uploadsDir = path.join(rootDir, "uploads");
const outputsDir = path.join(rootDir, "outputs");
const showsPath = path.join(dataDir, "shows.json");
const episodesPath = path.join(dataDir, "episodes.json");
const jobsPath = path.join(dataDir, "jobs.json");
const voicesPath = path.join(dataDir, "voices-cache.json");
const youtubeAuthPath = path.join(dataDir, "youtube-oauth.json");
const port = Number(process.env.PORT || 3334);
const execFileAsync = promisify(execFile);
const publishingEnabled = String(process.env.NEWTBUILDER_ENABLE_PUBLISHING || "").toLowerCase() === "true";
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

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use("/uploads", express.static(uploadsDir));
app.use("/outputs", express.static(outputsDir));

app.get("/api/health", async (_req, res) => {
  const youtube = await youtubeOAuthStatus();
  res.json({
    ok: true,
    app: "NewtBuilder",
    dataDirectory: dataDir,
    outputDirectory: outputsDir,
    integrations: {
      youtube: youtube.connected,
      openai: Boolean(process.env.OPENAI_API_KEY),
      elevenlabs: Boolean(elevenLabsApiKey),
      fal: Boolean(falApiKey)
    },
    safety: {
      publishingEnabled,
      mode: publishingEnabled ? "publishing-capable" : "local-test-only",
      youtubeDraftOnly: true
    },
    youtube
  });
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
  await writeShows([updated, ...shows.filter((show) => show.id !== updated.id)]);
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
  for (const episode of deletedEpisodes) {
    for (const asset of episode.assets || []) {
      await deleteStoredUpload(asset.storedFileName);
    }
  }

  const nextShows = shows.filter((show) => show.id !== current.id);
  const safeShows = nextShows.length ? nextShows : [defaultShow()];
  const nextEpisodes = episodes.filter((episode) => episode.showId !== current.id);
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
  res.json(showId ? episodes.filter((episode) => episode.showId === showId) : episodes);
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
  const episode = normalizeEpisode({
    id: randomUUID(),
    showId: show.id,
    title: String(req.body.title || nextEpisodeTitle(show)).trim(),
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

  const episodes = await readEpisodes();
  await writeEpisodes([episode, ...episodes]);
  res.json(episode);
});

app.patch("/api/episodes/:id", async (req, res) => {
  const shows = await readShows();
  const episodes = await readEpisodes();
  const current = episodes.find((item) => item.id === req.params.id);
  if (!current) {
    return res.status(404).json({ error: "Episode not found." });
  }
  const show = shows.find((item) => item.id === current.showId) || shows[0];

  const updated = await ensureAutomaticSpeakerMasksForEpisode(normalizeEpisode({
    ...current,
    ...req.body,
    id: current.id,
    showId: current.showId,
    createdAt: current.createdAt,
    format: show.shortFormat || req.body.format || current.format,
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
    const binding = shotFilenameBinding(file.originalname);
    const shotRole = binding.shotRole && requestedShotRole !== "mask" ? binding.shotRole : requestedShotRole;
    return {
      id: randomUUID(),
      type: mediaTypeForMime(file.mimetype),
      shotRole,
      roleLabel: binding.shotRole ? labelForShotRole(shotRole) : requestedRoleLabel,
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

  const speakingTag = sanitizeSpeakingTag(
    req.body?.speakingTag ??
      req.body?.characterTags ??
      req.body?.metadata?.speakingTag ??
      req.body?.metadata?.characterTags ??
      asset.metadata?.speakingTag ??
      asset.metadata?.characterTags ??
      ""
  );
  const updatedAssets = current.assets.map((item) =>
    item.id === assetId
      ? normalizeAsset({
          ...item,
          metadata: {
            ...(item.metadata || {}),
            speakingTag
          }
        })
      : item
  );

  const removedAutoMaskIds = new Set(
    current.assets
      .filter(
        (item) =>
          item.shotRole === "mask" &&
          item.metadata?.kind === "speaker-auto-mask" &&
          cleanId(item.metadata?.sourceImageAssetId) === assetId
      )
      .map((item) => item.id)
  );
  const remainingAssets = updatedAssets.filter((item) => !removedAutoMaskIds.has(item.id));
  const productionMap = clearMaskAssetsFromProductionMap(current.productionMap, removedAutoMaskIds);

  const shows = await readShows();
  const show = shows.find((item) => item.id === current.showId) || shows[0];
  const updated = await ensureAutomaticSpeakerMasksForEpisode(normalizeEpisode({
    ...current,
    assets: remainingAssets,
    productionMap,
    jobLog: appendLog(current.jobLog, `Updated speaking tag for ${asset.fileName}.`),
    updatedAt: new Date().toISOString()
  }), show);
  await writeEpisodes([updated, ...episodes.filter((item) => item.id !== updated.id)]);
  res.json(updated);
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

  await deleteStoredUpload(asset.storedFileName);

  const updated = normalizeEpisode({
    ...current,
    assets: current.assets.filter((item) => item.id !== req.params.assetId),
    productionMap: clearAssetFromProductionMap(current.productionMap, req.params.assetId),
    jobLog: appendLog(current.jobLog, `Deleted asset: ${asset.fileName}`),
    updatedAt: new Date().toISOString()
  });
  await writeEpisodes([updated, ...episodes.filter((item) => item.id !== updated.id)]);
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
  const format = normalizeShortFormat(req.body.format || show.shortFormat || current.format);
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
    approvals: refreshApprovals(current.approvals, show.automation),
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
  const updated = await ensureAutomaticSpeakerMasksForEpisode(normalizeEpisode({
    ...current,
    format: show.shortFormat || current.format,
    productionMap: normalizeProductionMapForFormat(
      Array.isArray(req.body.productionMap) ? req.body.productionMap : current.productionMap,
      show.shortFormat || current.format
    ),
    productionMapEditedAt: String(req.body.productionMapEditedAt ?? current.productionMapEditedAt ?? ""),
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
        audioTake
      },
      lineIndex
    );

    const updated = normalizeEpisode({
      ...current,
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
  const format = normalizeShortFormat(current.format || show.shortFormat);
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
      productionMap,
      jobLog: appendLog(current.jobLog, `Insert video generated for line ${line.index}.`),
      updatedAt: new Date().toISOString()
    });
    await writeEpisodes([updated, ...episodes.filter((item) => item.id !== updated.id)]);
    res.json({ episode: updated, line: updated.productionMap[lineIndex] });
  } catch (error) {
    const productionMap = (current.productionMap || []).map((item, index) =>
      index === lineIndex ? normalizeProductionLine({ ...line, videoStatus: "failed" }, index) : normalizeProductionLine(item, index)
    );
    const updated = normalizeEpisode({
      ...current,
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
  const format = normalizeShortFormat(current.format || show.shortFormat);
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
    const finalRender = await createFinalRender({ episode: current, show });
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
      summary: `Final local render created.${lipSyncSummary} No publishing was attempted.`,
      steps: [
        { id: "audio_mix", label: "Use approved audio mix", enabled: true, status: "rendered" },
        {
          id: "lipsync",
          label: "Generate Fabric/Kling lip-sync clips",
          enabled: Boolean(falApiKey) && !lipSyncDisabled(),
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
        { id: "audio_mix", label: "Use approved audio mix", enabled: true, status: "checked" },
        {
          id: "lipsync",
          label: "Generate Fabric/Kling lip-sync clips",
          enabled: Boolean(falApiKey) && !lipSyncDisabled(),
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
    const currentLayers = normalizeFinishingLayers(current.drafts?.finishingLayers);
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
    const currentLayers = normalizeFinishingLayers(current.drafts?.finishingLayers);
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
        selectedThumbnailOutputId: ""
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
      createdAt: uploadResult.createdAt
    };
    const updated = normalizeEpisode({
      ...episodeForUpload,
      outputs: [output, ...(episodeForUpload.outputs || []).filter((item) => item.type !== "youtube_upload")],
      jobLog: appendLog(
        episodeForUpload.jobLog,
        `Uploaded private YouTube draft: ${uploadResult.watchUrl}${uploadResult.thumbnailWarning ? ` Thumbnail warning: ${uploadResult.thumbnailWarning}` : ""}`
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
      summary: `Private YouTube draft uploaded. Video ID: ${uploadResult.videoId}`,
      steps: [
        { id: "youtube_video", label: "Upload video as private draft", enabled: true, status: "uploaded" },
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

app.get("/api/jobs", async (_req, res) => {
  res.json(await readJobs());
});

app.listen(port, "127.0.0.1", () => {
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
  const safeName = path.basename(String(storedFileName || ""));
  if (!safeName) return;

  const uploadsRoot = path.resolve(uploadsDir);
  const filePath = path.resolve(uploadsRoot, safeName);
  if (!filePath.startsWith(`${uploadsRoot}${path.sep}`)) return;
  await rm(filePath, { force: true });
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
  return shotFilenameBinding(asset?.fileName).roles.length > 1;
}

function speakerMaskMatchesLine(maskAsset, line) {
  if (!maskAsset || !line) return false;
  if (
    maskAsset.metadata?.kind === "speaker-auto-mask" &&
    String(maskAsset.metadata?.postProcessVersion || "") !== autoSpeakerMaskVersion
  ) {
    return false;
  }
  return (
    cleanId(maskAsset.metadata?.sourceImageAssetId) === cleanId(line.assetId) &&
    String(maskAsset.metadata?.speakerMaskKey || "") === speakerMaskReuseKey(line)
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
      defaultLipSyncModel: sanitizeLipSyncModel(show.production?.defaultLipSyncModel || "fabric"),
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
  const format = normalizeShortFormat(episode.format);
  const assets = Array.isArray(episode.assets) ? episode.assets.map(normalizeAsset) : [];
  const productionMap = Array.isArray(episode.productionMap)
    ? applyStoredSpeakerMasks(normalizeProductionMapForFormat(episode.productionMap, format), assets)
    : [];
  const drafts = {
    ...emptyDrafts(defaultShow()),
    ...(episode.drafts || {}),
    finishingLayers: normalizeFinishingLayers(episode.drafts?.finishingLayers)
  };
  return {
    id: cleanId(episode.id) || randomUUID(),
    showId: cleanId(episode.showId),
    title: String(episode.title || "Untitled Episode").trim() || "Untitled Episode",
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
    finishingLayers: [],
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
    const assetId =
      previous?.assetId ||
      bestAssetForProductionLine({
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
        lipSyncModel: previous?.lipSyncModel || show.production?.defaultLipSyncModel || "fabric",
        shotRole,
        assetId,
        maskAssetId,
        needsMask,
        invertMask: false,
        notes: previous?.notes || "",
        groupId: previous?.groupId || "",
        groupTitle: previous?.groupTitle || "",
        estimatedSeconds: isInsert ? estimateInsertSeconds(line.text) : estimateLineSeconds(line.text, show),
        videoStatus: previous?.videoStatus || "pending",
        videoTake: previous?.videoTake || null,
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
    lipSyncModel: sanitizeLipSyncModel(line.lipSyncModel),
    shotRole: sanitizeShotRole(line.shotRole || "character_one_shot"),
    assetId: cleanId(line.assetId),
    maskAssetId,
    needsMask: Boolean(line.needsMask || maskAssetId),
    invertMask: Boolean(line.invertMask),
    audioStatus: sanitizeAudioStatus(line.audioStatus),
    audioTake: normalizeAudioTake(line.audioTake),
    videoStatus: sanitizeVideoStatus(line.videoStatus),
    videoTake: normalizeVideoTake(line.videoTake),
    insertVideoMode: sanitizeInsertVideoMode(line.insertVideoMode),
    insertEndAssetId: cleanId(line.insertEndAssetId),
    videoPrompt: String(line.videoPrompt || "").trim(),
    videoInSeconds: Math.max(0, roundSeconds(line.videoInSeconds)),
    videoOutSeconds: Math.max(0, roundSeconds(line.videoOutSeconds)),
    notes: String(line.notes || "").trim(),
    groupId: cleanId(line.groupId),
    groupTitle: compactText(String(line.groupTitle || "").trim(), 80),
    estimatedSeconds: Math.max(1, Math.round(Number(line.estimatedSeconds) || 1)),
    sourceLine: Number.isFinite(Number(line.sourceLine)) ? Number(line.sourceLine) : 0
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
  return ["pending", "generated", "approved", "hold", "failed"].includes(status) ? status : "pending";
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
  return "fabric";
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
    generatedAt: String(take.generatedAt || "").trim()
  };
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

  const hasBoundAssetsForRole = roleAssets.some((asset) => assetShotBinding(asset).roles.length > 0);
  if (hasBoundAssetsForRole) return "";

  const preferredNames = [speaker, character?.name, character?.role].map(keyForMatch).filter(Boolean);
  const nameMatched = roleAssets.find((asset) =>
    preferredNames.some((name) => keyForMatch(asset.fileName).includes(name))
  );
  const speakerMatched = roleAssets.find((asset) => keyForMatch(asset.fileName).includes(speakerType));
  const speakingTagged = roleAssets.find((asset) => assetSpeakingRoles(asset).includes(speakerType));
  const prefixed = roleAssets.find((asset) => fileStartsWithShotPrefix(asset.fileName, shotRole));
  return (speakingTagged || speakerMatched || nameMatched || prefixed || roleAssets[0] || imageAssets[0])?.id || "";
}

function baseCastRolesForShow(show) {
  const characters = Array.isArray(show?.characters) ? show.characters : [];
  const roles = new Set();
  for (const character of characters) {
    const role = speakerTypeFor(character.name || character.role);
    if (role === "max" || role === "pip") roles.add(role);
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

  if (shotRole === "character_one_shot") {
    if (roles.length !== 1 || roles[0] !== speakerType) return Number.NEGATIVE_INFINITY;
    return 100 + (activeSpeakers.includes(speakerType) ? 30 : 0);
  }

  const missingDesired = desired.filter((role) => !roles.includes(role));
  if (missingDesired.length) return Number.NEGATIVE_INFINITY;
  if (!desired.includes("guest") && roles.includes("guest")) return Number.NEGATIVE_INFINITY;

  const exact = roles.length === desired.length;
  return 80 + desired.length * 10 + (exact ? 20 : 0) + (activeSpeakers.includes(speakerType) ? 30 : 0) - Math.max(0, roles.length - desired.length);
}

function effectiveAssetShotRole(asset) {
  const binding = shotFilenameBinding(asset?.fileName);
  return binding.shotRole || sanitizeShotRole(asset?.shotRole || "general");
}

function assetShotBinding(asset) {
  return shotFilenameBinding(asset?.fileName);
}

function assetSpeakingRoles(asset) {
  return parseCharacterTagRoles(asset?.metadata?.speakingTag || asset?.metadata?.characterTags).slice(0, 1);
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
  const first = fallback[0] || "";
  return first ? `@${first.slice(0, 48)}` : "";
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
  if (key === "max") return "max";
  if (key === "pip" || key === "pop") return "pip";
  return "guest";
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
  const blockedGate = preRenderBlockedGate(episode.approvals);
  const canContinue = !blockedGate || blockedGate.status === "auto";
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

  if (!canContinue && blockedGate) {
    return {
      report,
      outputs,
      job: {
      id: randomUUID(),
      episodeId: episode.id,
      showId: show.id,
      status: "waiting_for_approval",
      currentStage: blockedGate.stage,
      createdAt: new Date().toISOString(),
      summary: `Local test complete. Waiting for ${blockedGate.title} approval. No publishing was attempted.`,
      steps: steps.map((step) => ({ ...step, status: step.enabled ? "waiting" : "manual" }))
      }
    };
  }

  let preview = null;
  let productionMap = null;
  if (report.renderReady) {
    preview = await createLocalPreview({ previewId: reportId, episode, show });
    report = await attachPreviewToReport(report, preview);
    outputs.unshift(...preview.outputs);
    productionMap = attachAudioTakesToProductionMap(episode.productionMap, preview.manifest.lines);
  }

  return {
    report,
    outputs,
    productionMap,
    job: {
    id: randomUUID(),
    episodeId: episode.id,
    showId: show.id,
    status: report.overall === "fail" ? "blocked" : preview?.video ? "local_preview_ready" : "local_test_passed",
    currentStage: preview?.video ? "Preview Ready" : report.renderReady ? "Ready for Render Integration" : "Package Review",
    createdAt: new Date().toISOString(),
    summary:
      report.overall === "fail"
        ? "Local test found required fixes. No publishing was attempted."
        : preview?.video
          ? "Local preview rendered. No publishing was attempted."
          : "Local test passed for current NewtBuilder workflow. No publishing was attempted.",
    steps: steps.map((step) => ({
      ...step,
      status:
        step.id === "render" && preview?.video
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
  const format = normalizeShortFormat(show?.shortFormat || episode.format);
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
      "Pre-render approval gates are clear",
      pendingPreRenderApprovals.length === 0,
      pendingPreRenderApprovals.length ? `${pendingPreRenderApprovals.length} pre-render approvals still need attention` : "Ready to render locally"
    ),
    buildCheck(
      "render_review",
      "Episode Render approval records preview review",
      renderApproved,
      renderApproved ? "Preview review approval is complete." : "Approve Episode Render after watching the local preview.",
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
  const manifest = buildRenderManifest({ previewId, episode, show, createdAt });
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
      durationSeconds: video.durationSeconds
    });
  }

  return { manifest: stripPrivateManifestFields(manifest), video, outputs };
}

async function createFinalRender({ episode, show }) {
  const renderId = randomUUID();
  const createdAt = new Date().toISOString();
  const manifest = buildRenderManifest({ previewId: renderId, episode, show, createdAt });
  manifest.mode = "local-production-render";
  manifest.renderNote =
    "Final local render with approved audio and per-shot Fabric/Kling lip-sync clips when fal is configured. No publishing was attempted.";
  const audioDir = path.join(outputsDir, "final-audio", renderId);
  const manifestDir = path.join(outputsDir, "render-manifests");
  const tempDir = path.join(outputsDir, "tmp", `final-${renderId}`);
  await Promise.all([
    mkdir(audioDir, { recursive: true }),
    mkdir(manifestDir, { recursive: true }),
    mkdir(tempDir, { recursive: true })
  ]);

  for (const line of manifest.lines) {
    const reusableTake = reusableAudioTakeForLine(line);
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

  await renderLipSyncClipsForManifest({ episode, manifest, tempDir });
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
    outputs: [
      {
        id: `${renderId}-final-video`,
        type: "final_video",
        name: video.fileName,
        localUrl: video.localUrl,
        createdAt,
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

function buildRenderManifest({ previewId, episode, show, createdAt }) {
  const format = normalizeShortFormat(show?.shortFormat || episode.format);
  const { width, height } = parseResolution(format.resolution, format.aspectRatio);
  const assets = Array.isArray(episode.assets) ? episode.assets.map(normalizeAsset) : [];
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const characters = new Map((show.characters || []).map((character) => [character.id, character]));
  let cursor = 0;

  const lines = normalizeProductionMapForFormat(episode.productionMap, format).map((line, index) => {
    const normalized = normalizeProductionLine(line, index);
    const imageAsset = assetById.get(normalized.assetId);
    const endImageAsset = assetById.get(normalized.insertEndAssetId);
    const maskAsset = resolveMaskAsset(normalized.maskAssetId, assetById);
    const maskPath = resolveAssetPath(maskAsset);
    const videoTake = reusableVideoTakeForLine(normalized, imageAsset, endImageAsset, format);
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
      character: characters.get(normalized.characterId)?.name || normalized.speaker,
      voiceId: normalized.voiceId,
      text: normalized.text,
      audioTags: normalized.audioTags,
      expressiveBodyMotion: Boolean(normalized.expressiveBodyMotion),
      lipSyncModel: sanitizeLipSyncModel(normalized.lipSyncModel),
      audioStatus: normalized.audioStatus,
      audioTake: normalized.audioTake,
      videoStatus: normalized.videoStatus,
      videoTake,
      insertVideoMode: normalized.insertVideoMode,
      insertEndAssetId: normalized.insertEndAssetId,
      videoPrompt: normalized.videoPrompt,
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
      name: show.name
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

async function renderLipSyncClipsForManifest({ episode, manifest, tempDir }) {
  const dialogueLines = manifest.lines.filter((line) => line.lineType !== "insert");
  const selectedModels = [...new Set(dialogueLines.map((line) => lipSyncModelForLine(line)))];
  manifest.lipSync = {
    provider: "per-shot",
    enabled: Boolean(falApiKey) && !lipSyncDisabled(),
    defaultModel: "fabric",
    models: selectedModels,
    mode: "image-audio-prompt",
    clips: [],
    warnings: []
  };

  if (!dialogueLines.length) return;
  if (!manifest.lipSync.enabled) {
    manifest.lipSync.warnings.push(
      falApiKey
        ? "Lip-sync rendering is disabled by NEWTBUILDER_LIPSYNC_ENABLED."
        : "fal API key is not configured; final render used clean stills without lip-sync."
    );
    return;
  }

  for (const line of dialogueLines) {
    const provider = lipSyncModelForLine(line);
    const outputFolder = provider === "kling" ? "kling-renders" : "fabric-renders";
    const source = provider === "kling" ? "fal-kling-avatar" : "fal-fabric";
    const modelId = provider === "kling" ? klingAvatarModelId() : fabricModelId();
    const providerLabel = provider === "kling" ? "Kling avatar" : "Fabric";
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

    const prompt = provider === "kling" ? klingAvatarPromptForLine(line) : "";
    const signature = lineLipSyncSignature(line, manifest.format, { provider, modelId, prompt });
    const signatureHash = signatureHashFor(signature);
    const lineLabel = `line-${String(line.index).padStart(3, "0")}-${safeFileSegment(line.speaker)}`;
    const fileName = `${lineLabel}-${signatureHash}.mp4`;
    const filePath = path.join(lipSyncDir, fileName);
    const localUrl = `/outputs/${outputFolder}/${episode.id}/${fileName}`;
    const cachedDuration = existsSync(filePath) ? await probeDuration(filePath) : 0;
    const masked = Boolean(line.needsMask && line.maskPath);
    let durationSeconds = cachedDuration;
    let remoteUrl = "";
    let cached = cachedDuration > 0;

    try {
      if (!cached) {
        const rawPath = path.join(rawDir, `${lineLabel}-${signatureHash}-raw.mp4`);
        const lipSyncInputPath = masked
          ? await prepareLipSyncInputImage({ line, tempDir, signatureHash })
          : line.imagePath;
        const lipSyncAudioPath = provider === "kling"
          ? await prepareLipSyncAudio({ line, tempDir, signatureHash })
          : line.audio.filePath;
        const result = provider === "kling"
          ? await runFalKlingAvatar({
              imagePath: lipSyncInputPath,
              audioPath: lipSyncAudioPath,
              prompt,
              line,
              tempDir
            })
          : await runFalFabric({
              imagePath: lipSyncInputPath,
              audioPath: lipSyncAudioPath,
              line,
              tempDir
            });
        remoteUrl = falVideoUrl(result);
        if (!remoteUrl) {
          throw new Error(`${providerLabel} did not return a video URL for line ${line.index}.`);
        }
        await downloadRemoteFile(remoteUrl, rawPath, `${providerLabel} lip-sync clip`);
        const rawDurationSeconds = await probeDuration(rawPath);
        if (masked) {
          await compositeLipSyncClipWithMask({
            lipSyncPath: rawPath,
            stillPath: line.imagePath,
            maskPath: line.maskPath,
            outputPath: filePath,
            invertMask: line.invertMask,
            fps: Number(manifest.format.fps || 30),
            durationSeconds: rawDurationSeconds || line.durationSeconds
          });
        } else {
          await normalizeLipSyncClip({
            sourcePath: rawPath,
            outputPath: filePath,
            fps: Number(manifest.format.fps || 30)
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
        prompt: provider === "kling"
          ? line.expressiveBodyMotion
            ? "Expressive body motion enabled."
            : "Minimal body motion enabled."
          : "Fabric lip-sync.",
        warning: "",
        durationSeconds,
        signature,
        source,
        generatedAt: cached ? "" : new Date().toISOString()
      });
      line.lipSyncTake = take;
      line.videoPath = filePath;
      line.videoStatus = cached ? "cached" : "generated";
      manifest.lipSync.clips.push({
        lineIndex: line.index,
        speaker: line.speaker,
        localUrl,
        durationSeconds,
        cached,
        provider,
        model: modelId,
        masked,
        invertMask: Boolean(line.invertMask),
        expressiveBodyMotion: Boolean(line.expressiveBodyMotion)
      });
    } catch (error) {
      const message = compactText(String(error?.message || error || `Unknown ${providerLabel} error`).replace(/\s+/g, " "), 700);
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
    process.env.FFMPEG_PATH || "ffmpeg",
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
    process.env.FFMPEG_PATH || "ffmpeg",
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
      outputs.push({
        id: `${runId}-${variant.id}`,
        type: "thumbnail_image",
        name: variant.label,
        fileName,
        localUrl: `/outputs/thumbnails/${episode.id}/${fileName}`,
        width,
        height,
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
      outputs.push({
        id: `${runId}-${variant.id}-ai`,
        type: "thumbnail_image",
        name: `${variant.label} AI`,
        fileName,
        localUrl: `/outputs/thumbnails/${episode.id}/${fileName}`,
        width: result?.images?.[0]?.width || width,
        height: result?.images?.[0]?.height || height,
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
    outputs.find((output) => output.type === "finished_master" && outputFilePath(output)) ||
    outputs.find((output) => output.type === "final_video" && outputFilePath(output)) ||
    outputs.find((output) => output.type === "preview_video" && outputFilePath(output)) ||
    null
  );
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
    filters.push(`${audioLabels.join("")}amix=inputs=${audioLabels.length}:duration=first:dropout_transition=0,alimiter=limit=0.95[aout]`);
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

  await execFileAsync(process.env.FFMPEG_PATH || "ffmpeg", args, {
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

  const videoFileName = `video${path.extname(finalVideoPath) || ".mp4"}`;
  const thumbnailFileName = `thumbnail${path.extname(thumbnailPath) || ".png"}`;
  const metadataFileName = "youtube-metadata.json";
  const textFileName = "youtube-upload.txt";
  const campaignMetadataFileName = "campaign-drafts.json";
  const campaignTextFileName = "campaign-drafts.txt";
  const promotionPacketFileName = "promotion-packet.json";
  const promotionPacketTextFileName = "promotion-packet.txt";
  await copyFile(finalVideoPath, path.join(packageDir, videoFileName));
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

function latestFinalVideoOutput(episode) {
  const outputs = Array.isArray(episode.outputs) ? episode.outputs : [];
  return (
    outputs.find((output) => output.type === "finished_master" && outputFilePath(output)) ||
    baseFinalVideoOutput(episode)
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
    (line) => lineExpectsSpeakerMask(line, assetById.get(line.assetId)) && !String(line.maskAssetId || "").trim()
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
    const accessToken = await youtubeAccessToken();
    const video = await uploadYouTubeVideo({
      accessToken,
      videoPath: finalVideoPath,
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
      thumbnailSet,
      thumbnailWarning,
      metadata,
      createdAt: new Date().toISOString()
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
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
      process.env.FFMPEG_PATH || "ffmpeg",
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
    process.env.FFMPEG_PATH || "ffmpeg",
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
    process.env.FFMPEG_PATH || "ffmpeg",
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
  const imageAssets = assets.filter((asset) => asset.type === "image" && asset.shotRole !== "mask");
  const ranked = [
    ...imageAssets.filter((asset) => asset.shotRole === "character_one_shot"),
    ...imageAssets.filter((asset) => asset.shotRole === "wide_shot"),
    ...imageAssets.filter((asset) => asset.shotRole === "medium_two_shot"),
    ...imageAssets.filter((asset) => asset.shotRole === "insert_shot"),
    ...imageAssets.filter((asset) => !["character_one_shot", "wide_shot", "medium_two_shot", "insert_shot"].includes(asset.shotRole))
  ];
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

async function prepareThumbnailReferenceImage({ sourcePath, outputPath }) {
  await execFileAsync(
    process.env.FFMPEG_PATH || "ffmpeg",
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
  const characterNames = uniqueStrings((show.characters || []).map((character) => character.name).filter(Boolean)).join(", ");
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
      "Use Image 1 as the selected still frame and compositional base. Use the other provided images only as visual references for character identity and show style.",
      `Dynamic super text to include exactly, large and readable: "${titleLine}".`,
      providedInfo ? `Provided episode information: ${compactText(providedInfo, 700)}.` : "",
      `Preserve the exact character designs, color palette, and episode visual style from the references.`,
      `Visual style: ${visualStyle}. Thumbnail style: ${thumbnailStyle}.`,
      characterNames ? `Characters to preserve when present: ${characterNames}.` : "",
      `Story hook: ${hook}.`,
      `Composition: ${variant.prompt}. Make one clear emotional focal point, strong readable faces, clean negative space for the title, bright child-friendly polish, high contrast, and no clutter.`,
      "Constraints: no logos, no watermark, no captions beyond the dynamic super text, no misspelled text, no photoreal humans, no distorted faces, no extra characters beyond the references."
    ]
      .filter(Boolean)
      .join(" "),
    3000
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
    prompt: compactText(brief.prompt, 1000),
    superText: compactText(brief.superText, 140),
    details: compactText(brief.details, 1600),
    stillFrame
  };
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
      process.env.FFPROBE_PATH || "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", filePath],
      { timeout: 30000, maxBuffer: 1024 * 1024 }
    );
    return roundSeconds(Number(stdout) || 0);
  } catch {
    return 0;
  }
}

async function probeHasAudio(filePath) {
  try {
    const { stdout } = await execFileAsync(
      process.env.FFPROBE_PATH || "ffprobe",
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
      process.env.FFPROBE_PATH || "ffprobe",
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
    const videoStatus =
      ["approved", "hold"].includes(normalized.videoStatus) && videoTake?.signature
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
        videoTake
      },
      index
    );
  });
}

function parseResolution(resolution, aspectRatio) {
  const match = String(resolution || "").match(/^(\d+)x(\d+)$/);
  if (match) {
    return { width: Number(match[1]), height: Number(match[2]) };
  }
  return aspectRatio === "16:9" ? { width: 1920, height: 1080 } : { width: 1080, height: 1920 };
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

function reusableVideoTakeForLine(line, imageAsset, endImageAsset, format) {
  const take = normalizeVideoTake(line.videoTake);
  if (!take) return null;
  if (take.source === "user-upload") return videoTakeFilePath(take) ? take : null;
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

function lipSyncModelForLine(line) {
  return sanitizeLipSyncModel(line?.lipSyncModel);
}

function fabricModelId() {
  return process.env.FAL_FABRIC_MODEL || "veed/fabric-1.0";
}

function klingAvatarModelId() {
  return process.env.FAL_KLING_AVATAR_MODEL || "fal-ai/kling-video/ai-avatar/v2/pro";
}

function lipSyncDisabled() {
  const configured =
    process.env.NEWTBUILDER_LIPSYNC_ENABLED !== undefined
      ? process.env.NEWTBUILDER_LIPSYNC_ENABLED
      : process.env.NEWTBUILDER_FABRIC_ENABLED;
  const value = String(configured || "").trim().toLowerCase();
  return ["0", "false", "off", "no"].includes(value);
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
  return compactText(
    [
      "Create a polished lip-sync avatar animation for this cartoon episode shot.",
      `Speaker: ${String(line.speaker || "character").trim()}.`,
      `Dialogue: ${plainSpeechText(line)}`,
      shotPrompt ? `Shot direction: ${shotPrompt}` : "",
      "Preserve the uploaded image composition, character identity, lighting, wardrobe, background, and camera framing.",
      "Keep facial motion natural and speech-synced. Avoid changing the character design, adding text, or changing the camera.",
      line.expressiveBodyMotion ? expressiveBodyPrompt : minimalMotionPrompt
    ].filter(Boolean).join(" "),
    900
  );
}

function klingAvatarMinimumAudioSeconds() {
  return boundedEnvNumber("FAL_KLING_AVATAR_MIN_AUDIO_SECONDS", 2, 0.5, 10);
}

function lineLipSyncSignature(line, format = {}, options = {}) {
  const masked = Boolean(line.needsMask);
  const provider = options.provider || lipSyncModelForLine(line);
  const model = options.modelId || (provider === "kling" ? klingAvatarModelId() : fabricModelId());
  return JSON.stringify({
    compositeVersion: 7,
    provider,
    model,
    minAudioSeconds: provider === "kling" ? klingAvatarMinimumAudioSeconds() : 0,
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
    process.env.FFMPEG_PATH || "ffmpeg",
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

async function prepareLipSyncAudio({ line, tempDir, signatureHash }) {
  const sourcePath = line.audio?.filePath || "";
  const sourceDuration = Number(line.audio?.durationSeconds || 0) || (sourcePath ? await probeDuration(sourcePath) : 0);
  const minimumDuration = klingAvatarMinimumAudioSeconds();
  if (!sourcePath || sourceDuration >= minimumDuration) return sourcePath;

  const lineLabel = `line-${String(line.index).padStart(3, "0")}-${signatureHash}`;
  const outputPath = path.join(tempDir, `${lineLabel}-kling-audio.wav`);
  const padDuration = Math.max(0.2, minimumDuration - sourceDuration + 0.2);
  await execFileAsync(
    process.env.FFMPEG_PATH || "ffmpeg",
    [
      "-y",
      "-i",
      sourcePath,
      "-af",
      `apad=pad_dur=${padDuration.toFixed(3)},atrim=0:${minimumDuration.toFixed(3)}`,
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

async function normalizeLipSyncClip({ sourcePath, outputPath, fps }) {
  await execFileAsync(
    process.env.FFMPEG_PATH || "ffmpeg",
    [
      "-y",
      "-i",
      sourcePath,
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
      outputPath
    ],
    { timeout: 180000, maxBuffer: 20 * 1024 * 1024 }
  );
}

async function compositeLipSyncClipWithMask({ lipSyncPath, stillPath, maskPath, outputPath, invertMask, fps, durationSeconds }) {
  const duration = roundSeconds(Math.max(0.35, Number(durationSeconds) || (await probeDuration(lipSyncPath)) || 0.35));
  const maskChain = renderMaskCleanupFilter({ invert: invertMask });
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
    "[still_rgba][fab_a]overlay=format=auto:shortest=1,setsar=1[outv]"
  ].join(";");

  await execFileAsync(
    process.env.FFMPEG_PATH || "ffmpeg",
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
      speaker: String(line.speaker || "").trim(),
      speakerRole: targetSpeakerRoleForLine(line, imageAsset),
      characterId: cleanId(line.characterId),
      detector: region.detector || "filename-role-order",
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

async function openAiSpeakerMaskRegion({ line, imageAsset, show, dimensions }) {
  if (!openAiApiKey || String(process.env.NEWTBUILDER_DISABLE_VISION_MASKS || "").toLowerCase() === "true") {
    return null;
  }

  const imagePath = resolveAssetPath(imageAsset);
  if (!imagePath) return null;
  const imageUrl = await imageDataUri(imagePath);
  const character = findCharacterForSpeaker(line.speaker, show);
  const targetRole = targetSpeakerRoleForLine(line, imageAsset);
  const binding = shotFilenameBinding(imageAsset?.fileName);
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
                `Filename visible role order: ${roleOrder}`,
                `Shot filename: ${imageAsset?.fileName || "unknown"}`,
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
  const binding = shotFilenameBinding(imageAsset?.fileName);
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
      detector: "filename-role-order"
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
    process.env.FFMPEG_PATH || "ffmpeg",
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
    process.env.FFMPEG_PATH || "ffmpeg",
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
    process.env.FFMPEG_PATH || "ffmpeg",
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
    process.env.FFMPEG_PATH || "ffmpeg",
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
    process.env.FFMPEG_PATH || "ffmpeg",
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
  return compactText(String(error?.message || error || "Unknown speech provider error").replace(/\s+/g, " "), 260);
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
    resolution: aspectRatio === "16:9" ? "1920x1080" : "1080x1920"
  };
}

function normalizeAsset(asset) {
  const fileName = String(asset.fileName || "asset").trim() || "asset";
  const binding = shotFilenameBinding(fileName);
  const storedRole = sanitizeShotRole(asset.shotRole || asset.role || "general");
  const shotRole = binding.shotRole && storedRole !== "mask" ? binding.shotRole : storedRole;
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
  return Object.fromEntries(
    Object.entries(metadata)
      .filter(([key]) => /^[A-Za-z0-9_-]{1,48}$/.test(key))
      .map(([key, value]) => [key, typeof value === "string" ? value.slice(0, 500) : value])
      .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value) || value === null)
  );
}

function normalizeFinishingLayers(layers = []) {
  return (Array.isArray(layers) ? layers : [])
    .map(normalizeFinishingLayer)
    .filter(Boolean)
    .slice(0, 24);
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
