import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  BadgeCheck,
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clapperboard,
  Copy,
  Eraser,
  Film,
  FileText,
  FolderOpen,
  Gauge,
  Image,
  LayoutGrid,
  List,
  ListChecks,
  Lock,
  MonitorUp,
  Music,
  Pause,
  Pencil,
  Play,
  Plus,
  Power,
  RefreshCw,
  Save,
  Server,
  Settings2,
  Sparkles,
  Trash2,
  Undo2,
  Unlock,
  Upload,
  WandSparkles,
  X,
  Youtube
} from "lucide-react";

const API = import.meta.env.VITE_API_URL || "";
const INSERT_TRIM_DEFAULT_SECONDS = 2;
const AUTOSAVE_DELAY_MS = 4000;
const MASK_PREVIEW_ALPHA = 118;
const LIPSYNC_INPUT_PROMPT_MAX_LENGTH = 2400;
const LIPSYNC_FULL_PROMPT_MAX_LENGTH = 3600;
const ANIMATION_STRENGTH_DEFAULT = 1;
const ANIMATION_STRENGTH_MIN = 0;
const ANIMATION_STRENGTH_MAX = 5;
const ANIMATION_STRENGTH_STEP = 0.1;

const formatResolutionOptions = {
  "9:16": [
    { value: "540x960", label: "540 x 960" },
    { value: "720x1280", label: "720 x 1280" },
    { value: "1080x1920", label: "1080 x 1920" },
    { value: "1440x2560", label: "1440 x 2560" },
    { value: "2160x3840", label: "2160 x 3840" }
  ],
  "16:9": [
    { value: "960x540", label: "960 x 540" },
    { value: "1280x720", label: "1280 x 720" },
    { value: "1920x1080", label: "1920 x 1080" },
    { value: "2560x1440", label: "2560 x 1440" },
    { value: "3840x2160", label: "3840 x 2160" }
  ]
};

const automationControls = [
  {
    key: "parseScript",
    label: "Script plan",
    phase: "Planning",
    description: "Build the script plan and production map from the uploaded script.",
    icon: FileText
  },
  {
    key: "generateVoices",
    label: "Voice and audio",
    phase: "Audio",
    description: "Generate character dialogue and rebuild the episode mix.",
    icon: Bot
  },
  {
    key: "generateInsertVideos",
    label: "Insert videos",
    phase: "Video",
    description: "Generate simple action clips for INSERT lines.",
    icon: Sparkles
  },
  {
    key: "renderEpisode",
    label: "Episode render",
    phase: "Render",
    description: "Render preview/final episode outputs when prerequisites are ready.",
    icon: Film
  },
  {
    key: "generateThumbnails",
    label: "Thumbnails",
    phase: "Packaging",
    description: "Generate AI thumbnail candidates from the finished episode.",
    icon: Image
  },
  {
    key: "draftYoutubeMetadata",
    label: "YouTube prep",
    phase: "Publishing",
    description: "Prepare title, description, tags, checklist, and promotion copy.",
    icon: Youtube
  },
  {
    key: "uploadYoutube",
    label: "YouTube upload",
    phase: "Publishing",
    description: "Send private YouTube uploads only. Public release remains manual.",
    icon: MonitorUp
  },
  {
    key: "draftSocialCampaign",
    label: "YouTube promotion",
    phase: "Promotion",
    description: "Prepare YouTube Community and pinned-comment copy.",
    icon: WandSparkles
  }
];

const automationPresets = [
  {
    id: "manual",
    label: "Manual review",
    values: {
      parseScript: false,
      generateVoices: false,
      generateInsertVideos: false,
      renderEpisode: false,
      generateThumbnails: false,
      draftYoutubeMetadata: false,
      uploadYoutube: false,
      draftSocialCampaign: false
    }
  },
  {
    id: "autoPrep",
    label: "Auto prep",
    values: {
      parseScript: true,
      generateVoices: false,
      generateInsertVideos: false,
      renderEpisode: false,
      generateThumbnails: true,
      draftYoutubeMetadata: true,
      uploadYoutube: false,
      draftSocialCampaign: true
    }
  },
  {
    id: "autoProduction",
    label: "Auto production",
    values: {
      parseScript: true,
      generateVoices: true,
      generateInsertVideos: true,
      renderEpisode: true,
      generateThumbnails: true,
      draftYoutubeMetadata: true,
      uploadYoutube: false,
      draftSocialCampaign: true
    }
  }
];

const promotionTemplateDefaults = {
  youtubeCommunity: "{{title}}\n\n{{hook}}\n\nWatch here: {{youtube_url}}\n\n{{hashtags}}",
  pinnedComment: "Thanks for watching {{title}}. What moment stood out to you? Subscribe for the next episode."
};

const promotionTemplateFields = [
  { key: "youtubeCommunity", label: "YouTube Community", rows: 4 },
  { key: "pinnedComment", label: "Pinned Comment", rows: 3 }
];

const integrationSetupRows = [
  {
    key: "youtube",
    label: "YouTube",
    purpose: "Private draft upload, thumbnail set, and draft status checks.",
    env: "YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET"
  },
  {
    key: "elevenlabs",
    label: "ElevenLabs",
    purpose: "Character voices and dialogue audio.",
    env: "ELEVEN_API_KEY"
  },
  {
    key: "fal",
    label: "Fal",
    purpose: "Lip-sync, insert videos, and AI thumbnail generation.",
    env: "FAL_KEY"
  },
  {
    key: "infinitalkLocal",
    label: "Local InfiniteTalk",
    purpose: "Local InfiniteTalk video generation backend.",
    env: "LOCAL_INFINITALK_REPO_DIR"
  },
  {
    key: "infinitalkComfyUi",
    label: "ComfyUI InfiniteTalk",
    purpose: "ComfyUI Desktop InfiniteTalk video generation backend.",
    env: "COMFYUI_BASE_URL, COMFYUI_ROOT_DIR, COMFYUI_INFINITALK_WORKFLOW"
  },
  {
    key: "openai",
    label: "OpenAI",
    purpose: "Reserved for future script, metadata, and campaign intelligence.",
    env: "OPENAI_API_KEY"
  }
];

const shotAssetTypes = [
  {
    role: "character_one_shot",
    label: "Character One-Shots",
    hint: "Single-character images for dialogue closeups.",
    icon: Image
  },
  {
    role: "medium_two_shot",
    label: "Medium Two-Shots",
    hint: "Two characters framed together for back-and-forth lines.",
    icon: Clapperboard
  },
  {
    role: "wide_shot",
    label: "Wide Shots",
    hint: "Add tags to what character in the frame is speaking.",
    icon: Film
  },
  {
    role: "insert_shot",
    label: "Insert Shots",
    hint: "Optional cutaways, details, signs, or simple visual beats.",
    icon: Sparkles
  },
  {
    role: "mask",
    label: "Masks / Mattes",
    hint: "Masks for controlling who speaks in wide or grouped shots.",
    icon: ListChecks
  }
];

const lipSyncModelOptions = [
  { value: "fabric", label: "Fabric" },
  { value: "aurora", label: "Creatify Aurora" },
  { value: "infinitalk", label: "InfiniteTalk" },
  { value: "kling", label: "Kling" }
];

const infiniteTalkBackendOptions = [
  { value: "fal", label: "Fal" },
  { value: "comfyui", label: "ComfyUI" },
  { value: "local", label: "Direct Local" }
];

const targetTabs = [
  { key: "studio", label: "Studio", icon: Clapperboard },
  { key: "approvals", label: "Approvals", icon: ListChecks }
];
const workspaceTabKeys = new Set([...targetTabs.map((tab) => tab.key), "settings"]);

const youtubeHandoffDefaults = {
  titleReady: false,
  descriptionReady: false,
  thumbnailReady: false,
  studioChecked: false,
  approvalReady: false,
  scheduledManually: false
};

const youtubeHandoffChecks = [
  ["titleReady", "Title ready"],
  ["descriptionReady", "Description ready"],
  ["thumbnailReady", "Thumbnail ready"],
  ["studioChecked", "Studio checked"],
  ["approvalReady", "Approval ready"],
  ["scheduledManually", "Scheduled/published manually"]
];

const youtubePromotionDefaults = {
  communityPost: "",
  pinnedComment: ""
};

const youtubePromotionLimits = {
  communityPost: 1500,
  pinnedComment: 500
};

function clampCopy(text, limit) {
  const clean = String(text || "").trim();
  if (!limit || clean.length <= limit) return clean;
  return `${clean.slice(0, Math.max(0, limit - 3)).trim()}...`;
}

function compactText(text, limit = 900) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!limit || clean.length <= limit) return clean;
  return `${clean.slice(0, Math.max(0, limit - 3)).trim()}...`;
}

function cacheBustedUrl(url, token) {
  if (!url) return "";
  const separator = String(url).includes("?") ? "&" : "?";
  return `${url}${separator}v=${encodeURIComponent(token || "fresh")}`;
}

function firstDescriptionLine(description) {
  return (
    String(description || "")
      .split(/\n+/)
      .map((line) => line.trim())
      .find(Boolean) || "A new episode is ready to watch."
  );
}

function normalizePromotionTemplates(templates = {}) {
  return {
    ...promotionTemplateDefaults,
    ...(templates || {})
  };
}

function promotionTemplateContext({ title, description, watchUrl, showName = "", hashtags = [], cta = "" }) {
  const cleanTitle = String(title || "").trim() || "New episode";
  const cleanDescription = String(description || "").trim();
  return {
    title: cleanTitle,
    show: String(showName || "").trim() || "NewtBuilder",
    hook: firstDescriptionLine(cleanDescription),
    description: cleanDescription,
    youtube_url: watchUrl || "[YouTube link]",
    cta: String(cta || "").trim() || "Follow for the next episode.",
    hashtags: Array.isArray(hashtags) ? hashtags.join(" ") : String(hashtags || "")
  };
}

function renderPromotionTemplate(template, context) {
  const values = context || {};
  return String(template || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, token) => values[token] ?? "");
}

function formatSeconds(seconds = 0) {
  const safe = Math.max(0, Number(seconds) || 0);
  const mins = Math.floor(safe / 60);
  const secs = Math.round(safe % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function formatDimensions(format = {}) {
  const explicitWidth = Number(format.width);
  const explicitHeight = Number(format.height);
  if (Number.isFinite(explicitWidth) && explicitWidth > 0 && Number.isFinite(explicitHeight) && explicitHeight > 0) {
    return {
      width: Math.round(explicitWidth),
      height: Math.round(explicitHeight)
    };
  }
  const match = String(format.resolution || "").match(/^(\d+)x(\d+)$/);
  if (match) {
    return {
      width: Number(match[1]),
      height: Number(match[2])
    };
  }
  return format.aspectRatio === "16:9"
    ? { width: 1920, height: 1080 }
    : { width: 1080, height: 1920 };
}

function mediaDimensions(media = {}) {
  if (!media || typeof media !== "object") return null;
  const explicitWidth = Number(media.width);
  const explicitHeight = Number(media.height);
  if (Number.isFinite(explicitWidth) && explicitWidth > 0 && Number.isFinite(explicitHeight) && explicitHeight > 0) {
    return {
      width: Math.round(explicitWidth),
      height: Math.round(explicitHeight)
    };
  }
  const match = String(media.resolution || "").match(/^(\d+)x(\d+)$/);
  if (!match) return null;
  return {
    width: Number(match[1]),
    height: Number(match[2])
  };
}

function mediaAspectStyle(media = {}) {
  const dimensions = mediaDimensions(media);
  if (dimensions) return { aspectRatio: `${dimensions.width} / ${dimensions.height}` };
  const aspectMatch = String(media.aspectRatio || "").match(/^(\d+(?:\.\d+)?)\s*(?::|\/)\s*(\d+(?:\.\d+)?)$/);
  return aspectMatch ? { aspectRatio: `${aspectMatch[1]} / ${aspectMatch[2]}` } : undefined;
}

function mediaDimensionLabel(media = {}) {
  const dimensions = mediaDimensions(media);
  return dimensions ? `${dimensions.width} x ${dimensions.height}` : "";
}

function videoTakeKey(take = {}) {
  const safeTake = take && typeof take === "object" ? take : {};
  return String(safeTake.id || safeTake.localUrl || safeTake.proxyLocalUrl || safeTake.fileName || "").trim();
}

function lineVideoTakeOptions(line = {}) {
  const options = [];
  const seen = new Set();
  const sourceTakes = Array.isArray(line.videoTakes) ? line.videoTakes : [];
  for (const candidate of [...sourceTakes, line.videoTake]) {
    if (!candidate || typeof candidate !== "object") continue;
    const key = videoTakeKey(candidate);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    options.push(candidate);
  }
  return options;
}

function audienceLaughCueMode(line = {}) {
  const raw = String(line?.audienceCue?.laugh ?? line?.audienceCue?.laughMode ?? line?.audienceCue?.mode ?? "auto")
    .trim()
    .toLowerCase();
  if (["force", "laugh", "add", "on", "yes", "true"].includes(raw)) return "force";
  if (["none", "off", "no", "false", "never", "skip"].includes(raw)) return "none";
  return "auto";
}

function audienceLaughCuePatch(line = {}, mode = "auto") {
  return {
    audienceCue: {
      ...(line.audienceCue || {}),
      laugh: mode
    }
  };
}

function parseJsonObject(value) {
  if (!value || typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function outputRenderId(output = {}) {
  const id = String(output.id || "");
  const knownSuffixes = ["-final-video", "-final-manifest", "-video", "-manifest"];
  for (const suffix of knownSuffixes) {
    if (id.endsWith(suffix)) return id.slice(0, -suffix.length);
  }
  const text = String(output.name || output.fileName || output.localUrl || "");
  const uuidMatch = text.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:-final)?\.(?:mp4|json)/i);
  return uuidMatch?.[1] || "";
}

function outputCreatedAtValue(output = {}) {
  const parsed = Date.parse(output.createdAt || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function finalVideoForReviewOutput(output, finalOutputs = []) {
  if (!output) return null;
  if (output.type === "finished_master" && output.sourceFinalVideoId) {
    return finalOutputs.find((candidate) => candidate.id === output.sourceFinalVideoId) || output;
  }
  return output;
}

function finalManifestForReviewOutput(output, finalOutputs = [], finalManifestOutputs = []) {
  const finalVideo = finalVideoForReviewOutput(output, finalOutputs);
  if (!finalVideo) return null;
  const renderId = outputRenderId(finalVideo);
  return (
    finalManifestOutputs.find((manifest) => outputRenderId(manifest) === renderId) ||
    finalManifestOutputs.find((manifest) => manifest.createdAt && manifest.createdAt === finalVideo.createdAt) ||
    null
  );
}

function lipSyncProviderLabel(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized.includes("infinitalk") || normalized.includes("infinite")) return "InfiniteTalk";
  if (normalized.includes("aurora") || normalized.includes("creatify")) return "Creatify Aurora";
  if (normalized.includes("kling")) return "Kling";
  if (normalized.includes("fabric")) return "Fabric";
  if (normalized.includes("still")) return "Still/source media";
  return String(value || "").trim() || "Source media";
}

function providerOptionsLabel(options = {}) {
  const parts = [];
  if (options.backend) parts.push(`${String(options.backend)} backend`);
  if (options.numFrames) parts.push(`${options.numFrames} frames`);
  if (options.resolution) parts.push(String(options.resolution));
  if (options.acceleration) parts.push(`${options.acceleration} acceleration`);
  if (options.seed !== undefined && options.seed !== null) parts.push(`seed ${options.seed}`);
  return parts.join(" - ");
}

function lineGenerationDetail(line = {}) {
  const take = line.lipSyncTake || line.videoTake || null;
  const signature = parseJsonObject(take?.signature) || {};
  const provider = signature.provider || line.lipSyncModel || take?.source || "";
  const model = take?.model || take?.modelId || signature.model || signature.modelId || "";
  const providerLabel = lipSyncProviderLabel(provider || model || take?.source);
  const prompt = signature.prompt || take?.prompt || line.videoPrompt || "";
  const generatedClip = Boolean(take?.localUrl || take?.remoteUrl || take?.fileName);
  return {
    index: line.index || "",
    speaker: line.speaker || line.character || "",
    text: line.text || "",
    shotRole: line.shotRole || line.lineType || "",
    imageName: line.image?.fileName || line.endImage?.fileName || "",
    providerLabel: generatedClip ? providerLabel : "Still/source media",
    model,
    source: take?.source || "",
    prompt,
    providerOptions: providerOptionsLabel(signature.providerOptions),
    warning: take?.warning || "",
    generatedAt: take?.generatedAt || "",
    generatedClip
  };
}

function renderGenerationSummary(manifest) {
  if (!manifest) return null;
  const lines = Array.isArray(manifest.lines) ? manifest.lines.map(lineGenerationDetail) : [];
  const modelLabels = lines
    .map((line) => line.model ? `${line.providerLabel} (${line.model})` : line.providerLabel)
    .filter(Boolean);
  const uniqueModelLabels = [...new Set(modelLabels)];
  const manifestModels = Array.isArray(manifest.lipSync?.models)
    ? manifest.lipSync.models.map(lipSyncProviderLabel)
    : [];
  const modelSummary = uniqueModelLabels.length
    ? uniqueModelLabels.join(", ")
    : manifestModels.length
      ? [...new Set(manifestModels)].join(", ")
      : "Source media";
  const warnings = [
    ...(Array.isArray(manifest.lipSync?.warnings) ? manifest.lipSync.warnings : []),
    ...(Array.isArray(manifest.audio?.warnings) ? manifest.audio.warnings : []),
    ...lines.map((line) => line.warning).filter(Boolean)
  ];
  const format = manifest.format || {};
  return {
    id: manifest.id || "",
    createdAt: manifest.createdAt || "",
    modelSummary,
    formatLabel: `${format.resolution || `${format.width || "?"}x${format.height || "?"}`} - ${format.fps || "?"} fps`,
    audioLabel: `${manifest.audio?.mode || "audio"}${manifest.audio?.durationSeconds ? ` - ${formatSeconds(manifest.audio.durationSeconds)}` : ""}`,
    totalLabel: formatSeconds(manifest.totalSeconds || manifest.video?.durationSeconds || 0),
    warnings,
    lines
  };
}

function statusTone(status) {
  if (status === "approved" || status === "auto") return "good";
  if (status === "blocked") return "danger";
  if (status === "waiting") return "warn";
  return "neutral";
}

function readinessTone(status) {
  if (status === "pass") return "good";
  if (status === "warning") return "warn";
  return "danger";
}

function readinessCheck(id, label, passed, detail, statusWhenMissing = "fail", group = "setup") {
  return {
    id,
    label,
    detail,
    group,
    status: passed ? "pass" : statusWhenMissing
  };
}

function reindexProductionMap(lines = []) {
  return (Array.isArray(lines) ? lines : []).map((line, index) => ({
    ...line,
    index: index + 1
  }));
}

function productionMapGroupBlocks(lines = []) {
  const blocks = [];
  for (const line of Array.isArray(lines) ? lines : []) {
    if (!line.groupId) {
      blocks.push({ type: "line", line, blockId: line.id });
      continue;
    }
    const previous = blocks.at(-1);
    if (previous?.type === "group" && previous.groupId === line.groupId) {
      previous.lines.push(line);
      continue;
    }
    blocks.push({
      type: "group",
      blockId: `${line.groupId}-${line.id}`,
      groupId: line.groupId,
      groupTitle: line.groupTitle || "Group",
      lines: [line]
    });
  }
  return blocks;
}

function buildRenderReadiness({
  productionMap = [],
  assets = [],
  approvals = [],
  audioOutput,
  previewOutput,
  renderReviewApproved,
  dialogueClipRequired = false,
  selectedFormat = {},
  plan = {}
}) {
  const lines = Array.isArray(productionMap) ? productionMap : [];
  const dialogueLines = lines.filter((line) => line.lineType !== "insert");
  const insertLines = lines.filter((line) => line.lineType === "insert");
  const groupedDialogue = dialogueLines.filter((line) => ["wide_shot", "medium_two_shot"].includes(line.shotRole));
  const assetById = new Map((Array.isArray(assets) ? assets : []).map((asset) => [asset.id, asset]));
  const missingVoices = dialogueLines.filter((line) => !String(line.voiceId || "").trim());
  const missingImages = lines.filter((line) => !String(line.assetId || "").trim());
  const missingMasks = groupedDialogue.filter(
    (line) => !line.maskAutoApplyDisabled && lineExpectsSpeakerMask(line, assetById.get(line.assetId)) && !String(line.maskAssetId || "").trim()
  );
  const missingInsertVideos = insertLines.filter((line) => !line.videoTake?.localUrl && !line.videoTake?.proxyLocalUrl);
  const missingInsertTrims = insertLines.filter((line) => {
    if (!line.videoTake?.localUrl && !line.videoTake?.proxyLocalUrl) return false;
    return Number(line.videoOutSeconds || 0) <= Number(line.videoInSeconds || 0);
  });
  const missingDialogueVideos = dialogueLines.filter((line) => !line.videoTake?.localUrl || line.videoStatus === "failed");
  const requiredApprovalIds = ["script_plan", "voice_audio"];
  const pendingPreRenderApprovals = requiredApprovalIds.filter((id) => {
    const gate = approvals.find((item) => item.id === id);
    return !gate || (gate.status !== "approved" && gate.status !== "auto");
  });
  const estimate = Number(plan.estimatedSeconds || 0);
  const runtimeKnown = estimate > 0;

  const setupChecks = [
    readinessCheck(
      "production_map",
      "Production map",
      lines.length > 0,
      lines.length ? `${lines.length} lines mapped` : "Build a plan from the script first"
    ),
    readinessCheck(
      "voices",
      "Voice assignments",
      dialogueLines.length > 0 && missingVoices.length === 0,
      `${dialogueLines.length - missingVoices.length}/${dialogueLines.length} dialogue lines have voices`
    ),
    readinessCheck(
      "images",
      "Shot images",
      lines.length > 0 && missingImages.length === 0,
      `${lines.length - missingImages.length}/${lines.length} lines have images`
    ),
    readinessCheck(
      "masks",
      "Grouped-shot masks",
      groupedDialogue.length === 0 || missingMasks.length === 0,
      groupedDialogue.length
        ? `${groupedDialogue.length - missingMasks.length}/${groupedDialogue.length} wide/two-shot lines have masks`
        : "No grouped dialogue shots need masks"
    ),
    readinessCheck(
      "insert_clips",
      "Insert clips",
      true,
      insertLines.length
        ? `${insertLines.length - missingInsertVideos.length}/${insertLines.length} inserts generated${
            missingInsertTrims.length ? `, ${missingInsertTrims.length} need trim points` : ""
          }; missing inserts render from their assigned still image`
        : "No insert lines in this script"
    ),
    readinessCheck(
      "approvals",
      "Approvals",
      true,
      pendingPreRenderApprovals.length
        ? `${pendingPreRenderApprovals.length} approval gate${pendingPreRenderApprovals.length === 1 ? "" : "s"} pending; Render Final can still run`
        : "Script Plan and Voice & Audio are approved"
    ),
    readinessCheck(
      "runtime",
      "Length estimate",
      runtimeKnown,
      runtimeKnown
        ? `${formatSeconds(estimate)} estimate from ${plan.wordCount || 0} words`
        : "Length estimate will appear after the script plan is built",
      "warning"
    )
  ];

  const reviewChecks = [
    readinessCheck(
      "audio_mix",
      "Audio mix",
      Boolean(audioOutput?.localUrl),
      audioOutput?.localUrl ? "Audio preview is available" : "Rebuild audio or build a preview",
      "warning",
      "review"
    ),
    readinessCheck(
      "dialogue_shot_clips",
      "Shot video previews",
      true,
      dialogueClipRequired
        ? `${dialogueLines.length - missingDialogueVideos.length}/${dialogueLines.length} dialogue shots generated; Rebuild Final reuses them, Render Final regenerates them`
        : "Shot video previews are optional without generated lip-sync",
      "warning",
      "review"
    ),
    readinessCheck(
      "preview_video",
      "Preview video",
      true,
      previewOutput?.localUrl ? "Local preview is available" : "Preview is optional before Render Final",
      "warning",
      "review"
    ),
    readinessCheck(
      "render_review",
      "Preview approval",
      true,
      renderReviewApproved ? "Episode Render gate is approved" : "Approval is optional before Render Final",
      "warning",
      "review"
    )
  ];

  const setupReady = setupChecks.every((check) => check.status !== "fail");
  const finalReady = setupReady;
  return {
    checks: [...setupChecks, ...reviewChecks],
    setupReady,
    finalReady,
    tone: finalReady ? "good" : "danger",
    label: finalReady ? "Ready for final render" : "Needs setup"
  };
}

function voiceStatusText({ count, source, elevenLabsConnected }) {
  if (source === "elevenlabs") return `Loaded ${count} ElevenLabs voices.`;
  if (source === "cache" && elevenLabsConnected) return `Loaded ${count} cached voices.`;
  if (source === "cache") return `Using cached voices. ElevenLabs is not connected.`;
  if (source === "demo") return "Using demo voices. ElevenLabs is not connected.";
  if (count > 0) return `Loaded ${count} voices.`;
  return "No voices available yet.";
}

function progressUpdatedAtValue(item) {
  return Date.parse(item?.updatedAt || item?.startedAt || "") || 0;
}

function generationProgressIsActive(item) {
  return item && !["complete", "error", "cancelled"].includes(String(item.status || "").toLowerCase());
}

function latestGenerationProgress(items = []) {
  const sorted = [...items].sort((a, b) => progressUpdatedAtValue(b) - progressUpdatedAtValue(a));
  return sorted.find(generationProgressIsActive) || sorted[0] || null;
}

function generationProgressPercent(item) {
  const percent = Number(item?.percent || 0);
  if (!Number.isFinite(percent)) return 0;
  return Math.max(0, Math.min(100, Math.round(percent)));
}

function generationProgressLineLabel(item) {
  return item?.lineIndex ? `Line ${item.lineIndex}${item.speaker ? ` ${item.speaker}` : ""}` : "ComfyUI";
}

function generationProgressTitle(item) {
  if (!item) return "";
  const percent = generationProgressPercent(item);
  const status = String(item.status || "running").replace(/_/g, " ");
  const phase = String(item.phase || "").replace(/_/g, " ");
  const base = `${generationProgressLineLabel(item)} - ${phase || status}`;
  return percent > 0 ? `${base} ${percent}%` : base;
}

function generationProgressDetail(item) {
  if (!item) return "";
  return item.message || (item.promptId ? `Prompt ${item.promptId}` : "Waiting for ComfyUI progress.");
}

function lipSyncModelForLine(line) {
  const value = String(line?.lipSyncModel || "").trim().toLowerCase();
  if (value === "kling") return "kling";
  if (["aurora", "creatify", "creatify-aurora", "fal-ai/creatify/aurora"].includes(value)) return "aurora";
  if (["infinitalk", "infinite-talk", "infinite talk", "fal-ai/infinitalk"].includes(value)) return "infinitalk";
  return "fabric";
}

function optionalLipSyncModel(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw || ["default", "inherit", "visual-default", "cast-default", "none"].includes(raw)) return "";
  return lipSyncModelForLine({ lipSyncModel: raw });
}

function lipSyncModelLabel(value) {
  const option = lipSyncModelOptions.find((item) => item.value === lipSyncModelForLine({ lipSyncModel: value }));
  return option?.label || "Fabric";
}

function assetLipSyncModel(asset) {
  return optionalLipSyncModel(asset?.metadata?.lipSyncModel);
}

function assetLipSyncPrompt(asset) {
  return compactText(String(asset?.metadata?.lipSyncPrompt || "").trim(), LIPSYNC_INPUT_PROMPT_MAX_LENGTH);
}

function animationStrengthValueIsSet(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function normalizeAnimationStrength(value, fallback = ANIMATION_STRENGTH_DEFAULT) {
  const source = animationStrengthValueIsSet(value) ? value : fallback;
  const number = Number(source);
  const safeNumber = Number.isFinite(number) ? number : ANIMATION_STRENGTH_DEFAULT;
  return Math.round(Math.min(ANIMATION_STRENGTH_MAX, Math.max(ANIMATION_STRENGTH_MIN, safeNumber)) * 10) / 10;
}

function optionalAnimationStrength(value) {
  return animationStrengthValueIsSet(value) ? normalizeAnimationStrength(value) : null;
}

function formatAnimationStrength(value) {
  return normalizeAnimationStrength(value).toFixed(1);
}

function assetAnimationStrength(asset) {
  return normalizeAnimationStrength(asset?.metadata?.animationStrength);
}

function lineLipSyncInputPromptOverride(line) {
  return compactText(String(line?.lipSyncInputPromptOverride || "").trim(), LIPSYNC_INPUT_PROMPT_MAX_LENGTH);
}

function lineLipSyncInputPrompt(line, asset) {
  return lineLipSyncInputPromptOverride(line) || assetLipSyncPrompt(asset);
}

function lineLipSyncOverrideModel(line) {
  return optionalLipSyncModel(line?.lipSyncModelOverride || line?.lipSyncModel);
}

function lineAnimationStrengthOverride(line) {
  return optionalAnimationStrength(line?.animationStrengthOverride);
}

function resolvedAnimationStrengthForLine(line, asset) {
  const override = lineAnimationStrengthOverride(line);
  return override === null ? assetAnimationStrength(asset) : override;
}

function resolvedLipSyncModelForLine(line, asset, show) {
  return (
    lineLipSyncOverrideModel(line) ||
    assetLipSyncModel(asset) ||
    optionalLipSyncModel(show?.production?.defaultLipSyncModel) ||
    "fabric"
  );
}

function plainSpeechText(line) {
  return String(line?.text || "").replace(/^\s*(?:\[[^\]\r\n]{1,60}\]\s*)+/, "").trim() || " ";
}

function visualReferencePromptForLine(line, asset) {
  const prompt = lineLipSyncInputPrompt(line, asset);
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

function infiniteTalkVisualReferencePromptForLine(line, asset) {
  const prompt = sanitizeInfiniteTalkPositivePromptText(lineLipSyncInputPrompt(line, asset));
  return prompt ? `Visual reference: ${compactText(prompt, LIPSYNC_INPUT_PROMPT_MAX_LENGTH)}` : "";
}

function generatedKlingPromptForLine(line, asset) {
  const minimalMotionPrompt = "Keep the character body, hand, and arm motions very minimal.";
  const expressiveBodyPrompt =
    "Allow natural expressive upper-body motion only when it supports the dialogue, while preserving the original character design and shot composition.";
  const shotPrompt = String(line.videoPrompt || "").trim();
  const visualPrompt = visualReferencePromptForLine(line, asset);
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
    LIPSYNC_FULL_PROMPT_MAX_LENGTH
  );
}

function generatedAuroraPromptForLine(line, asset) {
  const shotPrompt = String(line.videoPrompt || "").trim();
  const visualPrompt = visualReferencePromptForLine(line, asset);
  const basePrompt =
    "Create a polished studio-quality avatar lip-sync animation. Preserve the uploaded image composition, character identity, background, lighting, wardrobe, and camera framing.";
  const motionPrompt = line.expressiveBodyMotion
    ? "Allow restrained, natural facial and upper-body motion only when it supports the dialogue."
    : "Keep the body, hands, arms, and camera very still; prioritize stable facial lip-sync.";
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
    LIPSYNC_FULL_PROMPT_MAX_LENGTH
  );
}

function generatedInfiniteTalkPromptForLine(line, asset) {
  const shotPrompt = String(line.videoPrompt || "").trim();
  const visualPrompt = infiniteTalkVisualReferencePromptForLine(line, asset);
  const basePrompt = "Animate the uploaded stylized puppet character speaking the dialogue while preserving the source image design.";
  const motionPrompt = line.expressiveBodyMotion
    ? "Use controlled puppet-style mouth movement, small head bobs, and restrained upper-body gestures when they support the dialogue; keep the painted eye shapes flat and unchanged."
    : "Keep the body, camera, background, and painted eye shapes stable; focus motion on puppet-style mouth movement synced to speech.";
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
    LIPSYNC_FULL_PROMPT_MAX_LENGTH
  );
}

function generatedLipSyncPromptForLine(line, provider = lipSyncModelForLine(line), asset = null) {
  if (provider === "kling") return generatedKlingPromptForLine(line, asset);
  if (provider === "aurora") return generatedAuroraPromptForLine(line, asset);
  if (provider === "infinitalk") return generatedInfiniteTalkPromptForLine(line, asset);
  return "";
}

function Toggle({ checked, onChange, label, icon: Icon, disabled = false, locked = false }) {
  return (
    <button
      type="button"
      className={`toggle ${checked ? "on" : ""} ${locked ? "locked" : ""}`}
      onClick={() => !disabled && !locked && onChange(!checked)}
      title={label}
      disabled={disabled}
    >
      <Icon size={17} />
      <span>{label}</span>
      <span className="switch" />
    </button>
  );
}

function SegmentedControl({ value, options, onChange, disabled = false }) {
  return (
    <div className="segmentedControl">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={value === option.value ? "active" : ""}
          onClick={() => onChange(option.value)}
          disabled={disabled}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Pill({ children, tone = "neutral" }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

function AnimationStrengthControl({ label, value, sourceLabel = "", onChange, onReset = null }) {
  const normalizedValue = normalizeAnimationStrength(value);
  return (
    <div className="animationStrengthControl">
      <div className="animationStrengthHeader">
        <span>{label}</span>
        <output>{formatAnimationStrength(normalizedValue)}</output>
      </div>
      <input
        type="range"
        min={ANIMATION_STRENGTH_MIN}
        max={ANIMATION_STRENGTH_MAX}
        step={ANIMATION_STRENGTH_STEP}
        value={normalizedValue}
        aria-label={label}
        onChange={(event) => onChange?.(normalizeAnimationStrength(event.target.value))}
      />
      {sourceLabel || onReset ? (
        <div className="animationStrengthMeta">
          {sourceLabel ? <Pill tone={sourceLabel === "shot" ? "good" : "neutral"}>{sourceLabel}</Pill> : null}
          {onReset ? (
            <button type="button" className="quietButton" onClick={onReset}>
              Use Global
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function commaList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function dateTimeLabel(value) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString();
}

function VoiceSelectOptions({ voices, currentValue }) {
  const elevenVoices = voices.filter((voice) => voice.source === "elevenlabs");
  const demoVoices = voices.filter((voice) => voice.source !== "elevenlabs");

  return (
    <>
      <option value="">Choose a voice...</option>
      {currentValue && !voices.some((voice) => voice.voice_id === currentValue) && (
        <option value={currentValue}>{currentValue}</option>
      )}
      {elevenVoices.length > 0 && (
        <optgroup label="ElevenLabs">
          {elevenVoices.map((voice) => (
            <option key={voice.voice_id} value={voice.voice_id}>
              {voice.name}
            </option>
          ))}
        </optgroup>
      )}
      {demoVoices.length > 0 && (
        <optgroup label="Demo">
          {demoVoices.map((voice) => (
            <option key={voice.voice_id} value={voice.voice_id}>
              {voice.name}
            </option>
          ))}
        </optgroup>
      )}
    </>
  );
}

function newestTimestamp(items = []) {
  return items.reduce((latest, item) => {
    const value = Date.parse(item?.updatedAt || item?.createdAt || "");
    return Number.isFinite(value) ? Math.max(latest, value) : latest;
  }, 0);
}

function episodeShelfOrderValue(episode) {
  const sortOrder = Number(episode?.sortOrder);
  if (Number.isFinite(sortOrder)) return sortOrder;
  const timestamp = Date.parse(episode?.createdAt || episode?.updatedAt || "");
  return Number.isFinite(timestamp) ? -timestamp : Number.MAX_SAFE_INTEGER;
}

function sortEpisodesForShelf(episodes = []) {
  return [...episodes].sort((a, b) => {
    return (
      episodeShelfOrderValue(a) - episodeShelfOrderValue(b) ||
      newestTimestamp([b]) - newestTimestamp([a]) ||
      String(a.title || "").localeCompare(String(b.title || ""))
    );
  });
}

function sortEpisodesForDashboard(episodes = [], sortMode = "user", sortDirection = "desc") {
  const list = Array.isArray(episodes) ? episodes : [];
  const direction = sortDirection === "asc" ? "asc" : "desc";
  if (sortMode === "date") {
    return [...list].sort((a, b) => {
      const dateCompare = newestTimestamp([a]) - newestTimestamp([b]);
      return (direction === "asc" ? dateCompare : -dateCompare) || String(a.title || "").localeCompare(String(b.title || ""));
    });
  }
  if (sortMode === "title") {
    return [...list].sort((a, b) => {
      const titleCompare = String(a.title || "").localeCompare(String(b.title || ""), undefined, {
        numeric: true,
        sensitivity: "base"
      });
      return (direction === "asc" ? titleCompare : -titleCompare) || newestTimestamp([b]) - newestTimestamp([a]);
    });
  }
  return sortEpisodesForShelf(list);
}

function friendlyDate(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Not saved yet";
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function episodeOutputsOfType(episode, type) {
  return (episode?.outputs || []).filter((output) => output.type === type);
}

function latestYoutubeUploadForEpisode(episode) {
  return episodeOutputsOfType(episode, "youtube_upload")
    .filter((output) => output.videoId || output.watchUrl || output.localUrl)
    .sort((a, b) => outputCreatedAtValue(b) - outputCreatedAtValue(a))[0] || null;
}

function youtubeUploadHref(output) {
  if (!output) return "";
  if (output.watchUrl) return output.watchUrl;
  if (output.localUrl) return output.localUrl;
  return output.videoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(output.videoId)}` : "";
}

function savedPanelOpen(panelState = {}, key = "", fallback = false) {
  if (!key) return Boolean(fallback);
  const value = panelState?.[key];
  return typeof value === "boolean" ? value : Boolean(fallback);
}

const panelStateStorageKey = "newtbuilder:panelState:v1";

function normalizePanelState(panelState = {}) {
  const normalized = {};
  if (!panelState || typeof panelState !== "object") return normalized;
  for (const [key, value] of Object.entries(panelState)) {
    if (typeof value === "boolean") normalized[key] = value;
  }
  return normalized;
}

function readPanelStateStore() {
  if (typeof window === "undefined" || !window.localStorage) return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(panelStateStorageKey) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function readStoredPanelState(scopeKey = "") {
  if (!scopeKey) return {};
  return normalizePanelState(readPanelStateStore()[scopeKey]);
}

function writeStoredPanelState(scopeKey = "", panelState = {}) {
  if (!scopeKey || typeof window === "undefined" || !window.localStorage) return;
  try {
    const store = readPanelStateStore();
    window.localStorage.setItem(
      panelStateStorageKey,
      JSON.stringify({
        ...store,
        [scopeKey]: normalizePanelState(panelState)
      })
    );
  } catch {
    // Local persistence is best-effort; the episode draft still carries the saved state.
  }
}

function episodePreviewImage(episode) {
  const thumbnails = episodeOutputsOfType(episode, "thumbnail_image");
  const selectedId = episode?.drafts?.selectedThumbnailOutputId || "";
  const selectedThumbnail = thumbnails.find((thumb) => thumb.id === selectedId || thumb.isSelected);
  const aiThumbnail = visibleThumbnailCandidates(thumbnails)[0];
  const fallbackAsset = (episode?.assets || []).find((asset) => asset.type === "image" && asset.localUrl);
  return selectedThumbnail?.localUrl || aiThumbnail?.localUrl || fallbackAsset?.localUrl || "";
}

function showPreviewImage(episodes = []) {
  return episodes.map(episodePreviewImage).find(Boolean) || "";
}

function episodeStatusSummary(episode) {
  if (episodeOutputsOfType(episode, "youtube_upload").some((output) => output.videoId)) {
    return { label: "uploaded", tone: "good" };
  }
  if (episodeOutputsOfType(episode, "finished_master").length) {
    return { label: "finished", tone: "good" };
  }
  if (episodeOutputsOfType(episode, "final_video").length) {
    return { label: "rendered", tone: "good" };
  }
  if (episodeOutputsOfType(episode, "preview_video").length) {
    return { label: "preview", tone: "neutral" };
  }
  if ((episode?.productionMap || []).length) {
    return { label: "mapped", tone: "neutral" };
  }
  if (String(episode?.scriptText || "").trim()) {
    return { label: "script", tone: "warn" };
  }
  return { label: "draft", tone: "neutral" };
}

function ShowLibrary({
  shows,
  allEpisodes,
  activeShowId,
  busy,
  onOpenShow,
  onRenameShow,
  onDeleteShow
}) {
  const episodesByShow = useMemo(() => {
    const groups = new Map();
    for (const episode of allEpisodes || []) {
      const showId = episode.showId || "";
      if (!groups.has(showId)) groups.set(showId, []);
      groups.get(showId).push(episode);
    }
    return groups;
  }, [allEpisodes]);

  return (
    <section className="showLibraryView">
      <div className="libraryHeader">
        <div>
          <span className="eyebrow">Show Library</span>
          <h2>NewtBuilder Shows</h2>
        </div>
      </div>

      <div className="showCardGrid">
        {shows.map((show) => {
          const showEpisodes = episodesByShow.get(show.id) || [];
          const previewImage = showPreviewImage(showEpisodes);
          const latestEpisodeTime = newestTimestamp(showEpisodes);
          const showTime = Date.parse(show.updatedAt || show.createdAt || "");
          const updatedAt = latestEpisodeTime
            ? new Date(Math.max(latestEpisodeTime, Number.isFinite(showTime) ? showTime : 0)).toISOString()
            : show.updatedAt || show.createdAt;
          return (
            <article className={`showCard ${show.id === activeShowId ? "active" : ""}`} key={show.id}>
              <button className="showCardPreview" type="button" onClick={() => onOpenShow(show.id)} disabled={busy}>
                {previewImage ? <img src={previewImage} alt="" /> : <Clapperboard size={34} />}
              </button>
              <div className="showCardBody">
                <div className="showCardTitleRow">
                  <div>
                    <h3>{show.name}</h3>
                    <span>{showEpisodes.length} episode{showEpisodes.length === 1 ? "" : "s"}</span>
                  </div>
                  <Pill tone={show.id === activeShowId ? "good" : "neutral"}>{show.id === activeShowId ? "active" : "saved"}</Pill>
                </div>
                <p>{show.description || "No description yet."}</p>
                <div className="showCardMeta">
                  <span>{show.shortFormat?.resolution || show.shortFormat?.aspectRatio || "Format unset"}</span>
                  <span>Updated {friendlyDate(updatedAt)}</span>
                </div>
                <div className="buttonRow">
                  <button className="primaryButton" type="button" onClick={() => onOpenShow(show.id)} disabled={busy}>
                    Open Show
                  </button>
                  <button className="iconButton" type="button" onClick={() => onRenameShow(show)} disabled={busy} title="Rename show">
                    <Pencil size={16} />
                  </button>
                  <button className="iconButton dangerIcon" type="button" onClick={() => onDeleteShow(show)} disabled={busy} title="Delete show">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ShowDashboard({
  show,
  episodes,
  busy,
  onCreateEpisode,
  onOpenEpisode,
  onOpenEpisodeReview,
  onRenameEpisode,
  onDuplicateEpisode,
  onReorderEpisodes
}) {
  const [episodeViewMode, setEpisodeViewMode] = useState("thumbnails");
  const [episodeSortMode, setEpisodeSortMode] = useState("user");
  const [episodeSortDirection, setEpisodeSortDirection] = useState("desc");
  const orderedEpisodes = useMemo(
    () => sortEpisodesForDashboard(episodes, episodeSortMode, episodeSortDirection),
    [episodes, episodeSortMode, episodeSortDirection]
  );
  const [draggedEpisodeId, setDraggedEpisodeId] = useState("");
  const [dropTargetEpisodeId, setDropTargetEpisodeId] = useState("");
  const dragEnabled = episodeSortMode === "user";
  const directionalSort = episodeSortMode === "date" || episodeSortMode === "title";
  const sortDirectionLabel =
    episodeSortMode === "title"
      ? episodeSortDirection === "asc"
        ? "A to Z"
        : "Z to A"
      : episodeSortDirection === "asc"
        ? "Oldest first"
        : "Newest first";
  const latestTime = newestTimestamp(episodes);
  const renderedCount = episodes.filter((episode) => episodeOutputsOfType(episode, "final_video").length).length;
  const uploadedCount = episodes.filter((episode) => episodeOutputsOfType(episode, "youtube_upload").some((output) => output.videoId)).length;

  useEffect(() => {
    if (dragEnabled) return;
    setDraggedEpisodeId("");
    setDropTargetEpisodeId("");
  }, [dragEnabled]);

  function finishEpisodeDrop(targetEpisodeId, insertAfter = false) {
    if (!dragEnabled) return;
    const draggedId = draggedEpisodeId;
    setDraggedEpisodeId("");
    setDropTargetEpisodeId("");
    if (!draggedId || draggedId === targetEpisodeId) return;
    const currentIds = orderedEpisodes.map((episode) => episode.id);
    const nextIds = currentIds.filter((id) => id !== draggedId);
    const targetIndex = targetEpisodeId ? nextIds.indexOf(targetEpisodeId) : nextIds.length - 1;
    const insertIndex = targetEpisodeId && targetIndex >= 0 ? targetIndex + (insertAfter ? 1 : 0) : nextIds.length;
    nextIds.splice(insertIndex, 0, draggedId);
    onReorderEpisodes?.(nextIds);
  }

  function changeEpisodeSortMode(mode) {
    setEpisodeSortMode(mode);
    if (mode === "title") setEpisodeSortDirection("asc");
    if (mode === "date") setEpisodeSortDirection("desc");
  }

  if (!show) {
    return (
      <section className="showDashboardView">
        <div className="emptyState">Create a show to start.</div>
      </section>
    );
  }

  return (
    <section className="showDashboardView">
      <div className="dashboardHeader">
        <div>
          <span className="eyebrow">Show</span>
          <h2>{show.name}</h2>
          <p>{show.description || "No description yet."}</p>
        </div>
      </div>

      <div className="dashboardMetricGrid">
        <Metric icon={Clapperboard} label="Episodes" value={episodes.length} />
        <Metric icon={Film} label="Rendered" value={renderedCount} />
        <Metric icon={Youtube} label="Uploaded" value={uploadedCount} />
        <Metric icon={Gauge} label="Format" value={show.shortFormat?.resolution || show.shortFormat?.aspectRatio || "Not set"} />
      </div>

      <div className="episodeShelfHeader">
        <div>
          <span className="eyebrow">Episodes</span>
          <h3>{episodes.length ? "Saved Episodes" : "No episodes yet"}</h3>
        </div>
        <div className="episodeShelfControls">
          <span>{latestTime ? `Last edited ${friendlyDate(latestTime)}` : "Fresh show"}</span>
          <div className="episodeViewToggle" aria-label="Episode view">
            <button
              type="button"
              className={episodeViewMode === "thumbnails" ? "active" : ""}
              onClick={() => setEpisodeViewMode("thumbnails")}
            >
              <LayoutGrid size={15} />
              Thumbnails
            </button>
            <button
              type="button"
              className={episodeViewMode === "list" ? "active" : ""}
              onClick={() => setEpisodeViewMode("list")}
            >
              <List size={15} />
              List
            </button>
          </div>
          <label className="episodeSortControl">
            <span>Sort</span>
            <select value={episodeSortMode} onChange={(event) => changeEpisodeSortMode(event.target.value)}>
              <option value="user">User order</option>
              <option value="date">Date</option>
              <option value="title">Title</option>
            </select>
          </label>
          {directionalSort ? (
            <button
              type="button"
              className="episodeSortDirectionButton"
              onClick={() => setEpisodeSortDirection((value) => (value === "asc" ? "desc" : "asc"))}
              title={`Sort ${sortDirectionLabel}`}
              aria-label={`Sort ${sortDirectionLabel}`}
            >
              {episodeSortDirection === "asc" ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
              {sortDirectionLabel}
            </button>
          ) : null}
        </div>
      </div>

      {orderedEpisodes.length ? (
        <div
          className={`episodeCardGrid ${episodeViewMode}`}
          onDragOver={(event) => {
            if (!dragEnabled || !draggedEpisodeId) return;
            event.preventDefault();
          }}
          onDrop={(event) => {
            if (!dragEnabled || !draggedEpisodeId) return;
            event.preventDefault();
            finishEpisodeDrop("");
          }}
        >
          {orderedEpisodes.map((episode) => {
            const status = episodeStatusSummary(episode);
            const previewImage = episodePreviewImage(episode);
            const youtubeUpload = latestYoutubeUploadForEpisode(episode);
            const youtubeHref = youtubeUploadHref(youtubeUpload);
            const isDragging = draggedEpisodeId === episode.id;
            const isDropTarget = dropTargetEpisodeId === episode.id && draggedEpisodeId !== episode.id;
            return (
              <article
                className={`episodeCard ${episodeViewMode === "list" ? "listRow" : ""} ${isDragging ? "dragging" : ""} ${isDropTarget ? "dropTarget" : ""}`}
                key={episode.id}
                draggable={!busy && dragEnabled}
                onDragStart={(event) => {
                  if (!dragEnabled) return;
                  setDraggedEpisodeId(episode.id);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", episode.id);
                }}
                onDragEnter={() => {
                  if (dragEnabled && draggedEpisodeId && draggedEpisodeId !== episode.id) setDropTargetEpisodeId(episode.id);
                }}
                onDragOver={(event) => {
                  if (!dragEnabled || !draggedEpisodeId || draggedEpisodeId === episode.id) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setDropTargetEpisodeId(episode.id);
                }}
                onDrop={(event) => {
                  if (!dragEnabled || !draggedEpisodeId) return;
                  event.preventDefault();
                  event.stopPropagation();
                  const rect = event.currentTarget.getBoundingClientRect();
                  const insertAfter =
                    episodeViewMode === "list"
                      ? event.clientY > rect.top + rect.height / 2
                      : event.clientX > rect.left + rect.width / 2;
                  finishEpisodeDrop(episode.id, insertAfter);
                }}
                onDragEnd={() => {
                  setDraggedEpisodeId("");
                  setDropTargetEpisodeId("");
                }}
              >
                <button className="episodeCardPreview" type="button" onClick={() => onOpenEpisode(episode.id)} disabled={busy}>
                  {previewImage ? <img src={previewImage} alt="" /> : <Film size={30} />}
                </button>
                <div className="episodeCardBody">
                  <div className="showCardTitleRow">
                    <div>
                      <h3>{episode.title}</h3>
                      <span>Updated {friendlyDate(episode.updatedAt || episode.createdAt)}</span>
                    </div>
                    <Pill tone={status.tone}>{status.label}</Pill>
                  </div>
                  <div className="episodeCardStats">
                    <span>{episode.plan?.wordCount || 0} words</span>
                    <span>{formatSeconds(episode.plan?.estimatedSeconds || 0)}</span>
                    <span>{(episode.productionMap || []).length} shots</span>
                  </div>
                  {youtubeHref ? (
                    <a className="episodeYoutubeLink" href={youtubeHref} target="_blank" rel="noreferrer">
                      <Youtube size={15} />
                      YouTube
                    </a>
                  ) : null}
                  <div className="buttonRow">
                    <button className="primaryButton" type="button" onClick={() => onOpenEpisode(episode.id)} disabled={busy}>
                      Open Studio
                    </button>
                    <button className="secondaryButton" type="button" onClick={() => onOpenEpisodeReview(episode.id)} disabled={busy}>
                      Open Review
                    </button>
                    <button
                      className="secondaryButton"
                      type="button"
                      onClick={() => onDuplicateEpisode(episode)}
                      disabled={busy}
                      title="Duplicate setup for the next episode"
                    >
                      <Copy size={16} />
                      Duplicate
                    </button>
                    <button className="iconButton" type="button" onClick={() => onRenameEpisode(episode)} disabled={busy} title="Rename episode">
                      <Pencil size={16} />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="emptyState">
          <button className="primaryButton" type="button" onClick={onCreateEpisode} disabled={busy}>
            <Plus size={18} />
            New Episode
          </button>
        </div>
      )}
    </section>
  );
}

export default function App() {
  const [health, setHealth] = useState(null);
  const [shows, setShows] = useState([]);
  const [episodes, setEpisodes] = useState([]);
  const [allEpisodes, setAllEpisodes] = useState([]);
  const [activeShowId, setActiveShowId] = useState("");
  const [activeEpisodeId, setActiveEpisodeId] = useState("");
  const [appView, setAppView] = useState("library");
  const [activeTab, setActiveTab] = useState("studio");
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [status, setStatus] = useState("");
  const [generationProgressItems, setGenerationProgressItems] = useState([]);
  const [showDraft, setShowDraft] = useState(null);
  const [episodeDraft, setEpisodeDraft] = useState(null);
  const [voices, setVoices] = useState([]);
  const [voicesStatus, setVoicesStatus] = useState("Loading voices...");
  const [voicesSource, setVoicesSource] = useState("unavailable");
  const [maskEditorLineId, setMaskEditorLineId] = useState("");
  const [launchReadiness, setLaunchReadiness] = useState(null);
  const [storedPanelStateScopeKey, setStoredPanelStateScopeKey] = useState("");
  const [storedPanelState, setStoredPanelState] = useState({});
  const autosaveTimerRef = useRef(null);
  const autosaveInFlightRef = useRef(false);
  const finishingUploadInFlightRef = useRef(false);

  const activeShow = useMemo(
    () => shows.find((show) => show.id === activeShowId) || shows[0] || null,
    [shows, activeShowId]
  );
  const activeEpisode = useMemo(
    () => episodes.find((episode) => episode.id === activeEpisodeId) || episodes[0] || null,
    [episodes, activeEpisodeId]
  );
  const panelStateScopeKey =
    activeShow?.id && activeEpisode?.id ? `${activeShow.id}:${activeEpisode.id}` : "";
  const activeGenerationProgress = useMemo(
    () => latestGenerationProgress(generationProgressItems),
    [generationProgressItems]
  );

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    setShowDraft(activeShow ? structuredClone(activeShow) : null);
  }, [activeShow?.id]);

  useEffect(() => {
    setEpisodeDraft(activeEpisode ? structuredClone(activeEpisode) : null);
    setLaunchReadiness(null);
  }, [activeEpisode?.id]);

  useEffect(() => {
    setStoredPanelStateScopeKey(panelStateScopeKey);
    setStoredPanelState(readStoredPanelState(panelStateScopeKey));
  }, [panelStateScopeKey]);

  useEffect(() => {
    const episodeId = activeEpisode?.id;
    if (!episodeId) {
      setGenerationProgressItems([]);
      return undefined;
    }

    const lastUpdated = progressUpdatedAtValue(activeGenerationProgress);
    const progressIsRecent = lastUpdated && Date.now() - lastUpdated < 10 * 60 * 1000;
    const shouldPoll = busy || (generationProgressIsActive(activeGenerationProgress) && progressIsRecent);
    if (!shouldPoll) return undefined;

    let cancelled = false;
    async function pollProgress() {
      try {
        const response = await fetch(`${API}/api/episodes/${encodeURIComponent(episodeId)}/comfyui-progress`);
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled) setGenerationProgressItems(Array.isArray(data.items) ? data.items : []);
      } catch {
        // Progress is supplemental; the main render request owns error reporting.
      }
    }

    pollProgress();
    const timer = window.setInterval(pollProgress, 1250);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeEpisode?.id, busy, busyAction, activeGenerationProgress?.key, activeGenerationProgress?.status, activeGenerationProgress?.updatedAt]);

  useEffect(() => {
    if (!activeShowId) return;
    setAllEpisodes((prev) => [
      ...episodes,
      ...prev.filter((episode) => episode.showId !== activeShowId)
    ]);
  }, [episodes, activeShowId]);

  async function request(path, options = {}) {
    const res = await fetch(`${API}${path}`, {
      headers: options.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
      ...options
    });
    if (!res.ok) {
      const text = await res.text();
      let message = text || `Request failed: ${res.status}`;
      let payload = null;
      try {
        payload = JSON.parse(text);
        message = payload.error || message;
      } catch {
        // Keep the raw response text when the server does not return JSON.
      }
      const error = new Error(message);
      error.payload = payload;
      throw error;
    }
    return res.json();
  }

  function youtubeAuthStatusMessage(message) {
    const text = String(message || "");
    const lower = text.toLowerCase();
    if (
      lower.includes("expired or revoked") ||
      lower.includes("invalid_grant") ||
      lower.includes("token refresh failed") ||
      lower.includes("youtube oauth is not configured")
    ) {
      return "YouTube needs to be reconnected before uploading. Click Connect YouTube, approve consent, return to NewtBuilder, then try Upload to YouTube again.";
    }
    if (lower.includes("insufficient authentication scopes")) {
      return "YouTube needs one more reconnect so NewtBuilder has the latest upload and status permissions. Click Reconnect YouTube, approve the updated permissions, then try again.";
    }
    return text;
  }

  useEffect(() => {
    if (busy || autosaveInFlightRef.current) return undefined;

    const showNeedsSave = Boolean(
      showDraft?.id &&
        activeShow?.id === showDraft.id &&
        JSON.stringify(showDraft) !== JSON.stringify(activeShow)
    );
    const episodeNeedsSave = Boolean(
      episodeDraft?.id &&
        activeEpisode?.id === episodeDraft.id &&
        JSON.stringify(episodeDraft) !== JSON.stringify(activeEpisode)
    );
    if (!showNeedsSave && !episodeNeedsSave) return undefined;

    const showSnapshot = showNeedsSave ? structuredClone(showDraft) : null;
    const episodeSnapshot = episodeNeedsSave ? structuredClone(episodeDraft) : null;
    const showSignature = showSnapshot ? JSON.stringify(showSnapshot) : "";
    const episodeSignature = episodeSnapshot ? JSON.stringify(episodeSnapshot) : "";

    autosaveTimerRef.current = window.setTimeout(async () => {
      autosaveInFlightRef.current = true;
      try {
        let savedShow = null;
        if (showSnapshot) {
          const show = await request(`/api/shows/${showSnapshot.id}`, {
            method: "PATCH",
            body: JSON.stringify(showSnapshot)
          });
          savedShow = show;
          setShows((prev) => [show, ...prev.filter((item) => item.id !== show.id)]);
          setShowDraft((prev) =>
            prev?.id === show.id && JSON.stringify(prev) === showSignature ? structuredClone(show) : prev
          );
        }

        if (episodeSnapshot) {
          const episode = await request(`/api/episodes/${episodeSnapshot.id}`, {
            method: "PATCH",
            body: JSON.stringify({
              title: episodeSnapshot.title,
              scriptText: episodeSnapshot.scriptText,
              format: savedShow && episodeSnapshot.showId === savedShow.id ? savedShow.shortFormat : episodeSnapshot.format,
              productionMap: episodeSnapshot.productionMap,
              productionMapEditedAt: episodeSnapshot.productionMapEditedAt,
              drafts: episodeSnapshot.drafts,
              automation: episodeSnapshot.automation
            })
          });
          setEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
          setEpisodeDraft((prev) =>
            prev?.id === episode.id && JSON.stringify(prev) === episodeSignature ? structuredClone(episode) : prev
          );
        }
        if (savedShow) {
          await refreshEpisodesAfterShowSave(savedShow.id);
        }
      } catch (error) {
        setStatus(`Autosave failed: ${error.message}`);
      } finally {
        autosaveInFlightRef.current = false;
      }
    }, AUTOSAVE_DELAY_MS);

    return () => {
      window.clearTimeout(autosaveTimerRef.current);
    };
  }, [showDraft, episodeDraft, activeShow, activeEpisode, busy]);

  async function loadAll() {
    setBusy(true);
    try {
      const [healthData, showData, allEpisodeData, voicesData] = await Promise.all([
        request("/api/health"),
        request("/api/shows"),
        request("/api/episodes"),
        request("/api/voices").catch(() => ({ voices: [], source: "unavailable" }))
      ]);
      setHealth(healthData);
      setVoices(voicesData.voices || []);
      setVoicesSource(voicesData.source || "unavailable");
      setVoicesStatus(
        voiceStatusText({
          count: voicesData.voices?.length || 0,
          source: voicesData.source || "unavailable",
          elevenLabsConnected: Boolean(healthData.integrations?.elevenlabs)
        })
      );
      setShows(showData);
      setAllEpisodes(allEpisodeData);
      const nextShowId = activeShowId || showData[0]?.id || "";
      setActiveShowId(nextShowId);
      const episodeData = await request(`/api/episodes${nextShowId ? `?showId=${nextShowId}` : ""}`);
      setEpisodes(episodeData);
      if (!activeEpisodeId && episodeData[0]) {
        setActiveEpisodeId(episodeData[0].id);
      }
      return true;
    } catch (error) {
      setStatus(error.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function reloadAllAfterRestart(attempt = 1) {
    const maxAttempts = 10;
    window.setTimeout(async () => {
      const ok = await loadAll();
      if (ok) {
        setStatus("NewtBuilder backend reconnected and shows reloaded.");
        return;
      }
      if (attempt < maxAttempts) {
        reloadAllAfterRestart(attempt + 1);
      } else {
        setStatus("NewtBuilder backend is still restarting. Try Refresh Status in a moment.");
      }
    }, attempt === 1 ? 1800 : 1500);
  }

  async function openShow(showId) {
    if (!showId) return;
    setActiveShowId(showId);
    setAppView("show");
    setActiveTab("studio");
    await reloadEpisodes(showId);
  }

  function openEpisode(episodeId) {
    if (!episodeId) return;
    setActiveEpisodeId(episodeId);
    setActiveTab("studio");
    setAppView("episode");
  }

  function openEpisodeReview(episodeId) {
    if (!episodeId) return;
    setActiveEpisodeId(episodeId);
    setActiveTab("approvals");
    setAppView("episode");
  }

  function openShowDashboard() {
    setAppView("show");
    setActiveTab("studio");
  }

  function openShowSettings() {
    setAppView("episode");
    setActiveTab("settings");
  }

  async function reloadEpisodes(showId = activeShowId) {
    const episodeData = await request(`/api/episodes${showId ? `?showId=${showId}` : ""}`);
    setEpisodes(episodeData);
    if (!episodeData.find((episode) => episode.id === activeEpisodeId)) {
      setActiveEpisodeId(episodeData[0]?.id || "");
    }
  }

  async function refreshEpisodesAfterShowSave(showId) {
    const [allEpisodeData, showEpisodeData] = await Promise.all([
      request("/api/episodes"),
      request(`/api/episodes${showId ? `?showId=${showId}` : ""}`)
    ]);
    setAllEpisodes(allEpisodeData);
    setEpisodes(showEpisodeData);
    if (!showEpisodeData.find((episode) => episode.id === activeEpisodeId)) {
      setActiveEpisodeId(showEpisodeData[0]?.id || "");
    }
    setEpisodeDraft((prev) => {
      if (!prev?.id) return prev;
      const refreshed = allEpisodeData.find((episode) => episode.id === prev.id);
      return refreshed ? structuredClone(refreshed) : prev;
    });
  }

  async function createShow() {
    setBusy(true);
    try {
      const show = await request("/api/shows", {
        method: "POST",
        body: JSON.stringify({
          name: `Show ${shows.length + 1}`,
          description: "",
          creative: {
            audience: "episode viewers",
            visualStyle: "cinematic animated episodes",
            tone: "sharp, warm, fast-moving",
            thumbnailStyle: "bold expression, clean background, high contrast",
            defaultCta: "Follow for the next episode.",
            recurringHashtags: ["#animatedseries", "#episode"]
          }
        })
      });
      setShows((prev) => [show, ...prev]);
      setActiveShowId(show.id);
      setEpisodes([]);
      setActiveEpisodeId("");
      setAllEpisodes((prev) => prev.filter((episode) => episode.showId !== show.id));
      setAppView("show");
      setStatus("Show created.");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveShow() {
    if (!showDraft) return;
    setBusy(true);
    try {
      const show = await request(`/api/shows/${showDraft.id}`, {
        method: "PATCH",
        body: JSON.stringify(showDraft)
      });
      setShows((prev) => [show, ...prev.filter((item) => item.id !== show.id)]);
      setShowDraft(structuredClone(show));
      await refreshEpisodesAfterShowSave(show.id);
      setStatus("Show profile saved.");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function renameActiveShow() {
    return renameShow(activeShow);
  }

  async function renameShow(showToRename) {
    if (!showToRename) return;
    const nextName = globalThis.prompt?.("Rename show", showToRename.name);
    if (!nextName || nextName.trim() === showToRename.name) return;
    setBusy(true);
    try {
      const show = await request(`/api/shows/${showToRename.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ...showToRename, name: nextName.trim() })
      });
      setShows((prev) => [show, ...prev.filter((item) => item.id !== show.id)]);
      if (activeShowId === show.id) setShowDraft(structuredClone(show));
      setStatus("Show renamed.");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteActiveShow() {
    return deleteShow(activeShow);
  }

  async function deleteShow(showToDelete) {
    if (!showToDelete) return;
    const ok = globalThis.confirm?.(`Delete "${showToDelete.name}" and its episodes/assets?`);
    if (!ok) return;
    setBusy(true);
    try {
      const result = await request(`/api/shows/${showToDelete.id}`, { method: "DELETE" });
      const nextShows = result.shows || [];
      setShows(nextShows);
      const nextShowId = nextShows[0]?.id || "";
      setActiveShowId(nextShowId);
      const nextEpisodes = nextShowId ? await request(`/api/episodes?showId=${nextShowId}`) : [];
      setEpisodes(nextEpisodes);
      setAllEpisodes((prev) => prev.filter((episode) => episode.showId !== showToDelete.id));
      setActiveEpisodeId(nextEpisodes[0]?.id || "");
      setAppView(nextShows.length ? "library" : "show");
      setStatus("Show deleted.");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function createEpisode() {
    if (!activeShow) return;
    setBusy(true);
    try {
      await createEpisodeForShow(activeShow);
      setAppView("episode");
      setActiveTab("studio");
      setStatus("Episode created.");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function createEpisodeForShow(show = activeShow) {
    if (!show) {
      throw new Error("Create or select a show before adding episode assets.");
    }
    const episode = await request("/api/episodes", {
      method: "POST",
      body: JSON.stringify({ showId: show.id, title: `${show.name} Episode` })
    });
    setEpisodes((prev) => [episode, ...prev]);
    setAllEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
    setActiveEpisodeId(episode.id);
    setEpisodeDraft(structuredClone(episode));
    return episode;
  }

  async function renameEpisode(episodeToRename = activeEpisode) {
    if (!episodeToRename) return;
    const nextTitle = globalThis.prompt?.("Rename episode", episodeToRename.title);
    if (!nextTitle || nextTitle.trim() === episodeToRename.title) return;
    setBusy(true);
    try {
      const episode = await request(`/api/episodes/${episodeToRename.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: nextTitle.trim() })
      });
      setEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
      setAllEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
      if (activeEpisodeId === episode.id) {
        setEpisodeDraft(structuredClone(episode));
      }
      setStatus("Episode renamed.");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function duplicateEpisode(episodeToDuplicate = activeEpisode) {
    if (!episodeToDuplicate) return;
    setBusy(true);
    try {
      const episode = await request(`/api/episodes/${episodeToDuplicate.id}/duplicate`, {
        method: "POST"
      });
      setEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
      setAllEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
      setActiveEpisodeId(episode.id);
      setEpisodeDraft(structuredClone(episode));
      setAppView("episode");
      setActiveTab("studio");
      setStatus(`Duplicated setup as ${episode.title}. Add the new script and build the plan.`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function refreshHealthStatus(message = "Server status refreshed.") {
    const healthData = await request("/api/health");
    setHealth(healthData);
    if (message) setStatus(message);
    return healthData;
  }

  async function reorderEpisodes(episodeIds = []) {
    if (!activeShowId || !episodeIds.length) return;
    const previousEpisodes = episodes;
    const previousAllEpisodes = allEpisodes;
    const optimisticOrder = new Map(episodeIds.map((id, index) => [id, index]));
    const optimisticEpisodes = sortEpisodesForShelf(
      episodes.map((episode) =>
        optimisticOrder.has(episode.id) ? { ...episode, sortOrder: optimisticOrder.get(episode.id) } : episode
      )
    );

    setEpisodes(optimisticEpisodes);
    setAllEpisodes((prev) =>
      prev.map((episode) =>
        episode.showId === activeShowId && optimisticOrder.has(episode.id)
          ? { ...episode, sortOrder: optimisticOrder.get(episode.id) }
          : episode
      )
    );

    try {
      const { episodes: orderedEpisodes, allEpisodes: orderedAllEpisodes } = await request("/api/episodes/reorder", {
        method: "PATCH",
        body: JSON.stringify({ showId: activeShowId, episodeIds })
      });
      setEpisodes(orderedEpisodes);
      if (orderedAllEpisodes) setAllEpisodes(orderedAllEpisodes);
      setStatus("Episode order saved.");
    } catch (error) {
      setEpisodes(previousEpisodes);
      setAllEpisodes(previousAllEpisodes);
      setStatus(error.message);
    }
  }

  async function ensureEpisodeForUpload() {
    if (episodeDraft) return episodeDraft;
    if (activeEpisode) return activeEpisode;
    return createEpisodeForShow(activeShow);
  }

  async function saveStudioAndReview() {
    const draft = episodeDraft || activeEpisode;
    if (!draft) return;
    setBusy(true);
    try {
      let savedShow = null;
      if (showDraft) {
        const show = await request(`/api/shows/${showDraft.id}`, {
          method: "PATCH",
          body: JSON.stringify(showDraft)
        });
        savedShow = show;
        setShows((prev) => [show, ...prev.filter((item) => item.id !== show.id)]);
        setShowDraft(structuredClone(show));
      }
      const episode = await request(`/api/episodes/${draft.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...draft,
          format: savedShow && draft.showId === savedShow.id ? savedShow.shortFormat : draft.format
        })
      });
      setEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
      setActiveEpisodeId(episode.id);
      setEpisodeDraft(structuredClone(episode));
      if (savedShow) {
        await refreshEpisodesAfterShowSave(savedShow.id);
      }
      setStatus("Episode saved.");
      return episode;
    } catch (error) {
      setStatus(error.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  function updateEpisodePanelOpen(panelKey, isOpen) {
    if (!panelKey) return;
    const nextOpen = Boolean(isOpen);
    if (panelStateScopeKey) {
      setStoredPanelStateScopeKey(panelStateScopeKey);
      setStoredPanelState((prev) => {
        const current = storedPanelStateScopeKey === panelStateScopeKey ? prev : readStoredPanelState(panelStateScopeKey);
        if (current[panelKey] === nextOpen) return current;
        const next = {
          ...current,
          [panelKey]: nextOpen
        };
        writeStoredPanelState(panelStateScopeKey, next);
        return next;
      });
    }
    setEpisodeDraft((prev) => {
      if (!prev) return prev;
      const currentPanelState = prev.drafts?.ui?.panelState || {};
      if (currentPanelState[panelKey] === nextOpen) return prev;
      return {
        ...prev,
        drafts: {
          ...(prev.drafts || {}),
          ui: {
            ...(prev.drafts?.ui || {}),
            panelState: {
              ...currentPanelState,
              [panelKey]: nextOpen
            }
          }
        }
      };
    });
  }

  async function saveEpisodeAsPackage() {
    const savedEpisode = await saveStudioAndReview();
    const episodeId = savedEpisode?.id || activeEpisode?.id || episodeDraft?.id;
    if (!episodeId) return;
    setBusy(true);
    setBusyAction("save-as-package");
    try {
      setStatus("Choose a parent folder for the episode package...");
      const selection = await request("/api/system/choose-folder", {
        method: "POST",
        body: JSON.stringify({
          title: "Choose parent folder for this NewtBuilder episode package"
        })
      });
      if (!selection.path) {
        setStatus("Save As canceled.");
        return;
      }
      setStatus("Saving episode package...");
      const result = await request(`/api/episodes/${episodeId}/package/save-as`, {
        method: "POST",
        body: JSON.stringify({ parentPath: selection.path })
      });
      if (result.episode) {
        setEpisodes((prev) => [result.episode, ...prev.filter((item) => item.id !== result.episode.id)]);
        setAllEpisodes((prev) => [result.episode, ...prev.filter((item) => item.id !== result.episode.id)]);
        setEpisodeDraft(structuredClone(result.episode));
      }
      setStatus(`Episode package saved to ${result.package?.packagePath || selection.path}.`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusyAction("");
      setBusy(false);
    }
  }

  async function restartNewtBuilderServer() {
    const ok = globalThis.confirm?.("Restart the NewtBuilder backend now? The page may need a few seconds to reconnect.");
    if (!ok) return;
    setBusy(true);
    setBusyAction("restart-newtbuilder");
    try {
      await request("/api/system/newtbuilder/restart", { method: "POST" });
      setStatus("NewtBuilder backend is restarting...");
      reloadAllAfterRestart();
    } catch (error) {
      setStatus(`NewtBuilder restart requested. ${error.message || "Reconnect in a few seconds."}`);
      reloadAllAfterRestart();
    } finally {
      setBusyAction("");
      setBusy(false);
    }
  }

  async function restartComfyUiServer() {
    const ok = globalThis.confirm?.("Restart the configured ComfyUI backend now?");
    if (!ok) return;
    setBusy(true);
    setBusyAction("restart-comfyui");
    try {
      const result = await request("/api/system/comfyui/restart", { method: "POST" });
      if (result.health) setHealth(result.health);
      else await refreshHealthStatus("");
      setStatus(result.message || "ComfyUI restarted.");
    } catch (error) {
      setStatus(error.message);
      refreshHealthStatus("").catch(() => {});
    } finally {
      setBusyAction("");
      setBusy(false);
    }
  }

  async function buildPlan() {
    if (!episodeDraft) return;
    if ((episodeDraft.productionMap || []).length && episodeDraft.productionMapEditedAt) {
      const shouldRebuild = window.confirm(
        "Rebuilding the plan will replace your manually edited production map order and deleted rows. Continue?"
      );
      if (!shouldRebuild) return;
    }
    setBusy(true);
    try {
      const episode = await request(`/api/episodes/${episodeDraft.id}/build-plan`, {
        method: "POST",
        body: JSON.stringify({ scriptText: episodeDraft.scriptText, format: episodeDraft.format || activeShow?.shortFormat })
      });
      setEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
      setActiveEpisodeId(episode.id);
      setEpisodeDraft(structuredClone(episode));
      setActiveTab("studio");
      setStatus("Script plan refreshed.");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function runPipeline() {
    if (!activeEpisode) return;
    setBusyAction("build-preview");
    setBusy(true);
    try {
      let episodeForRun = activeEpisode;
      if (episodeDraft?.id === activeEpisode.id && (episodeDraft.productionMap || []).length) {
        episodeForRun = await request(`/api/episodes/${activeEpisode.id}/production-map`, {
          method: "PATCH",
          body: JSON.stringify({
            productionMap: episodeDraft.productionMap,
            productionMapEditedAt: episodeDraft.productionMapEditedAt
          })
        });
      }
      const { episode, job, report } = await request(`/api/episodes/${episodeForRun.id}/run`, {
        method: "POST",
        body: JSON.stringify({})
      });
      setEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
      setEpisodeDraft(structuredClone(episode));
      setStatus(report?.localUrl ? `${job.summary} Report saved locally.` : job.summary);
    } catch (error) {
      setStatus(youtubeAuthStatusMessage(error.message));
    } finally {
      setBusyAction("");
      setBusy(false);
    }
  }

  async function renderFinalEpisode({ regenerateVideos = true } = {}) {
    if (!activeEpisode) return;
    setBusyAction(regenerateVideos ? "render-final" : "rebuild-final");
    setBusy(true);
    try {
      let episodeForRender = activeEpisode;
      if (episodeDraft?.id === activeEpisode.id) {
        episodeForRender = await request(`/api/episodes/${activeEpisode.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            title: episodeDraft.title,
            scriptText: episodeDraft.scriptText,
            format: episodeDraft.format,
            productionMap: episodeDraft.productionMap,
            productionMapEditedAt: episodeDraft.productionMapEditedAt,
            drafts: episodeDraft.drafts,
            automation: episodeDraft.automation
          })
        });
        setEpisodes((prev) => [episodeForRender, ...prev.filter((item) => item.id !== episodeForRender.id)]);
        setEpisodeDraft(structuredClone(episodeForRender));
      }

      const { episode, job } = await request(`/api/episodes/${episodeForRender.id}/final-render`, {
        method: "POST",
        body: JSON.stringify({ regenerateVideos })
      });
      setEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
      setEpisodeDraft(structuredClone(episode));
      setStatus(job.summary);
    } catch (error) {
      if (error.payload?.episode) {
        const episode = error.payload.episode;
        setEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
        setEpisodeDraft(structuredClone(episode));
      }
      setStatus(error.message);
    } finally {
      setBusyAction("");
      setBusy(false);
    }
  }

  async function uploadFinishingLayerFiles(files) {
    if (!activeEpisode || !files?.length || finishingUploadInFlightRef.current) return;
    const uploadFiles = uniqueUploadFiles([...files]);
    if (!uploadFiles.length) return;
    const fd = new FormData();
    uploadFiles.forEach((file) => fd.append("assets", file));
    finishingUploadInFlightRef.current = true;
    setBusyAction("finishing-upload");
    setBusy(true);
    try {
      const { episode, layers, skippedCount = 0 } = await request(`/api/episodes/${activeEpisode.id}/finishing-layers/assets`, {
        method: "POST",
        body: fd
      });
      setEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
      setEpisodeDraft(structuredClone(episode));
      const addedCount = layers?.length || 0;
      setStatus(
        skippedCount
          ? `Added ${addedCount} finishing layer${addedCount === 1 ? "" : "s"}; skipped ${skippedCount} duplicate${skippedCount === 1 ? "" : "s"}.`
          : `Added ${addedCount} finishing layer${addedCount === 1 ? "" : "s"}.`
      );
    } catch (error) {
      setStatus(error.message);
    } finally {
      finishingUploadInFlightRef.current = false;
      setBusyAction("");
      setBusy(false);
    }
  }

  async function saveFinishingLayers(layers) {
    if (!activeEpisode) return null;
    setBusyAction("finishing-save");
    setBusy(true);
    try {
      const { episode } = await request(`/api/episodes/${activeEpisode.id}/finishing-layers`, {
        method: "PATCH",
        body: JSON.stringify({ layers })
      });
      setEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
      setEpisodeDraft(structuredClone(episode));
      setStatus("Finishing layer timeline saved.");
      return episode;
    } catch (error) {
      setStatus(error.message);
      return null;
    } finally {
      setBusyAction("");
      setBusy(false);
    }
  }

  async function exportFinishedMaster(layers) {
    if (!activeEpisode) return;
    setBusyAction("finishing-export");
    setBusy(true);
    try {
      const { episode, finishedMaster } = await request(`/api/episodes/${activeEpisode.id}/finishing/export`, {
        method: "POST",
        body: JSON.stringify({ layers })
      });
      setEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
      setEpisodeDraft(structuredClone(episode));
      setStatus(`Finished master exported: ${finishedMaster.output?.fileName || "finished master"}.`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusyAction("");
      setBusy(false);
    }
  }

  async function generateFinishingMusic(musicBrief) {
    if (!activeEpisode) return;
    setBusyAction("finishing-music");
    setBusy(true);
    try {
      const { episode, layer } = await request(`/api/episodes/${activeEpisode.id}/finishing/music`, {
        method: "POST",
        body: JSON.stringify(musicBrief || {})
      });
      setEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
      setEpisodeDraft(structuredClone(episode));
      setStatus(`Generated music layer: ${layer?.fileName || "ElevenLabs music bed"}.`);
    } catch (error) {
      if (error.payload?.episode) {
        const episode = error.payload.episode;
        setEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
        setEpisodeDraft(structuredClone(episode));
      }
      setStatus(error.message);
    } finally {
      setBusyAction("");
      setBusy(false);
    }
  }

  async function generateFinishingLaughTrack(laughTrackBrief) {
    if (!activeEpisode) return;
    setBusyAction("finishing-laugh-track");
    setBusy(true);
    try {
      const { episode, layer, layers, output } = await request(`/api/episodes/${activeEpisode.id}/finishing/laugh-track`, {
        method: "POST",
        body: JSON.stringify(laughTrackBrief || {})
      });
      setEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
      setEpisodeDraft(structuredClone(episode));
      const cueCount = Array.isArray(layers) ? layers.length : layer ? 1 : 0;
      const placementNote = output?.placementWarning ? ` ${output.placementWarning}` : "";
      setStatus(
        cueCount === 0
          ? `Generated laugh track audio, but no new cue placements were added.${placementNote}`
          : cueCount > 1
            ? `Generated laugh track and placed ${cueCount} new cues: ${layer?.fileName || "ElevenLabs laugh track"}.${placementNote}`
            : `Generated laugh track layer: ${layer?.fileName || "ElevenLabs laugh track"}.${placementNote}`
      );
    } catch (error) {
      if (error.payload?.episode) {
        const episode = error.payload.episode;
        setEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
        setEpisodeDraft(structuredClone(episode));
      }
      setStatus(error.message);
    } finally {
      setBusyAction("");
      setBusy(false);
    }
  }

  async function generateFinishingApplauseTrack(applauseTrackBrief) {
    if (!activeEpisode) return;
    setBusyAction("finishing-applause-track");
    setBusy(true);
    try {
      const { episode, layer, layers, output } = await request(`/api/episodes/${activeEpisode.id}/finishing/applause-track`, {
        method: "POST",
        body: JSON.stringify(applauseTrackBrief || {})
      });
      setEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
      setEpisodeDraft(structuredClone(episode));
      const cueCount = Array.isArray(layers) ? layers.length : layer ? 1 : 0;
      const placementNote = output?.placementWarning ? ` ${output.placementWarning}` : "";
      setStatus(
        cueCount === 0
          ? `Generated applause track audio, but no new cue placements were added.${placementNote}`
          : cueCount > 1
            ? `Generated applause track and placed ${cueCount} new cues: ${layer?.fileName || "ElevenLabs applause track"}.${placementNote}`
            : `Generated applause track layer: ${layer?.fileName || "ElevenLabs applause track"}.${placementNote}`
      );
    } catch (error) {
      if (error.payload?.episode) {
        const episode = error.payload.episode;
        setEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
        setEpisodeDraft(structuredClone(episode));
      }
      setStatus(error.message);
    } finally {
      setBusyAction("");
      setBusy(false);
    }
  }

  async function generateThumbnails(thumbnailBrief = {}) {
    if (!activeEpisode) return;
    setBusyAction("thumbnails");
    setBusy(true);
    try {
      const { episode, thumbnails } = await request(`/api/episodes/${activeEpisode.id}/thumbnails/generate`, {
        method: "POST",
        body: JSON.stringify({ thumbnailBrief })
      });
      setEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
      setEpisodeDraft(structuredClone(episode));
      setStatus(`Generated ${thumbnails.outputs?.length || 0} ${thumbnails.provider || "AI"} thumbnail candidates.`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusyAction("");
      setBusy(false);
    }
  }

  async function selectThumbnail(thumbnail) {
    if (!activeEpisode || !thumbnail?.id) return;
    setBusy(true);
    try {
      const { episode } = await request(`/api/episodes/${activeEpisode.id}/thumbnails/${thumbnail.id}/select`, {
        method: "PATCH",
        body: JSON.stringify({})
      });
      setEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
      setEpisodeDraft(structuredClone(episode));
      setStatus(`Selected final thumbnail: ${thumbnail.name || thumbnail.fileName}.`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function savePublishingDraft(nextDrafts) {
    if (!activeEpisode || !nextDrafts) return null;
    const sourceDraft = episodeDraft?.id === activeEpisode.id ? episodeDraft : activeEpisode;
    const mergedDrafts = {
      ...(sourceDraft.drafts || {}),
      ...nextDrafts
    };
    setBusy(true);
    try {
      if (activeShow && nextDrafts.youtube) {
        const currentShow = showDraft?.id === activeShow.id ? showDraft : activeShow;
        const nextShow = structuredClone(currentShow);
        const youtube = nextDrafts.youtube || {};
        nextShow.platforms = {
          ...(nextShow.platforms || {}),
          youtube: {
            ...(nextShow.platforms?.youtube || {}),
            privacyStatus: "private",
            categoryId: youtube.categoryId || nextShow.platforms?.youtube?.categoryId || "24",
            notifySubscribers: Boolean(youtube.notifySubscribers),
            madeForKids: Boolean(youtube.madeForKids),
            containsSyntheticMedia: youtube.containsSyntheticMedia !== false,
            defaultTags: Array.isArray(youtube.tags) && youtube.tags.length ? youtube.tags : nextShow.platforms?.youtube?.defaultTags || []
          }
        };
        const show = await request(`/api/shows/${activeShow.id}`, {
          method: "PATCH",
          body: JSON.stringify(nextShow)
        });
        setShows((prev) => [show, ...prev.filter((item) => item.id !== show.id)]);
        setShowDraft(structuredClone(show));
      }
      const episode = await request(`/api/episodes/${activeEpisode.id}`, {
        method: "PATCH",
        body: JSON.stringify({ drafts: mergedDrafts })
      });
      setEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
      setEpisodeDraft(structuredClone(episode));
      setStatus(
        nextDrafts.youtube
          ? "YouTube prep saved. Project YouTube defaults updated for future episodes."
          : "Publishing prep saved."
      );
      return episode;
    } catch (error) {
      setStatus(error.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function exportFinalPackage(nextDrafts = null) {
    if (!activeEpisode) return;
    setBusy(true);
    try {
      const { episode, package: uploadPackage } = await request(`/api/episodes/${activeEpisode.id}/package/export`, {
        method: "POST",
        body: JSON.stringify(nextDrafts ? { drafts: nextDrafts } : {})
      });
      setEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
      setEpisodeDraft(structuredClone(episode));
      setStatus(`Final package exported: ${uploadPackage.output?.fileName || "upload package"}.`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function checkLaunchReadiness() {
    if (!activeEpisode) return;
    setBusyAction("launch-readiness");
    setBusy(true);
    try {
      const readiness = await request(`/api/episodes/${activeEpisode.id}/launch-readiness`);
      setLaunchReadiness(readiness);
      setStatus(readiness.summary || "Launch readiness checked.");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusyAction("");
      setBusy(false);
    }
  }

  async function uploadYoutubeDraft(nextDrafts = null) {
    if (!activeEpisode) return;
    const existingUpload = (activeEpisode.outputs || []).find((output) => output.type === "youtube_upload" && output.videoId);
    const ok = globalThis.confirm?.(
      existingUpload?.videoId
        ? `Republish as a new private YouTube upload? YouTube does not allow replacing the video file on an existing upload, so ${existingUpload.videoId} will stay on YouTube until you remove it in Studio.`
        : "Upload this episode to YouTube privately? This sends the final video and thumbnail to YouTube, but it will not publish publicly."
    );
    if (!ok) return;
    setBusyAction("youtube-upload");
    setBusy(true);
    try {
      const shortsThumbnailRequested = Boolean(nextDrafts?.youtube?.shortsThumbnail);
      const { episode, job, upload } = await request(`/api/episodes/${activeEpisode.id}/youtube/upload-draft`, {
        method: "POST",
        body: JSON.stringify(nextDrafts ? { drafts: nextDrafts } : {})
      });
      setEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
      setEpisodeDraft(structuredClone(episode));
      const shortsThumbnailStatus = shortsThumbnailRequested
        ? upload?.shortsThumbnailApplied
          ? ` Shorts thumbnail frame added to upload (${upload.shortsThumbnailFrameSeconds || 0.75}s).`
          : " Shorts thumbnail was requested, but the upload did not confirm the appended frame. Restart the NewtBuilder API and republish."
        : "";
      setStatus(
        `${job.summary}${shortsThumbnailStatus}${upload?.thumbnailWarning ? ` ${upload.thumbnailWarning}` : ""}`
      );
    } catch (error) {
      setStatus(youtubeAuthStatusMessage(error.message));
    } finally {
      setBusyAction("");
      setBusy(false);
    }
  }

  async function retryYoutubeThumbnail() {
    if (!activeEpisode) return;
    const ok = globalThis.confirm?.(
      "Retry setting the selected thumbnail on the existing private YouTube upload? This sends only the thumbnail to YouTube and will not upload a duplicate video."
    );
    if (!ok) return;
    setBusyAction("youtube-thumbnail");
    setBusy(true);
    try {
      const { episode, job, upload } = await request(`/api/episodes/${activeEpisode.id}/youtube/retry-thumbnail`, {
        method: "POST"
      });
      setEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
      setEpisodeDraft(structuredClone(episode));
      setStatus(`${job.summary}${upload?.thumbnailWarning ? ` ${upload.thumbnailWarning}` : ""}`);
    } catch (error) {
      setStatus(youtubeAuthStatusMessage(error.message));
    } finally {
      setBusyAction("");
      setBusy(false);
    }
  }

  async function checkYoutubeStatus() {
    if (!activeEpisode) return;
    setBusyAction("youtube-status");
    setBusy(true);
    try {
      const { episode, job, youtubeStatus } = await request(`/api/episodes/${activeEpisode.id}/youtube/check-status`, {
        method: "POST"
      });
      setEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
      setEpisodeDraft(structuredClone(episode));
      setStatus(`${job.summary}: ${youtubeStatus.privacyStatus || "unknown privacy"}, ${youtubeStatus.uploadStatus || "unknown upload status"}.`);
    } catch (error) {
      setStatus(youtubeAuthStatusMessage(error.message));
    } finally {
      setBusyAction("");
      setBusy(false);
    }
  }

  async function connectYoutube() {
    setBusy(true);
    try {
      const { authUrl, redirectUri } = await request("/api/youtube/connect-url");
      setStatus(`Opening Google sign-in. Redirect URI: ${redirectUri}`);
      globalThis.location.assign(authUrl);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function regenerateLineAudio(line) {
    if (!activeEpisode || !line?.id) return;
    setBusy(true);
    try {
      const { episode } = await request(`/api/episodes/${activeEpisode.id}/audio-lines/${line.id}/regenerate`, {
        method: "POST",
        body: JSON.stringify({ line })
      });
      setEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
      setEpisodeDraft(structuredClone(episode));
      setStatus(`Audio regenerated for line ${line.index}.`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function setLineAudioStatus(line, status) {
    if (!activeEpisode || !line?.id) return;
    setBusy(true);
    try {
      const { episode } = await request(`/api/episodes/${activeEpisode.id}/audio-lines/${line.id}/review`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
      setEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
      setEpisodeDraft(structuredClone(episode));
      setStatus(`Line ${line.index} audio marked ${status}.`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function rebuildAudioMix() {
    if (!activeEpisode) return;
    setBusyAction("rebuild-audio");
    setBusy(true);
    try {
      setStatus("Rebuilding audio review mix...");
      const { episode, job, report } = await request(`/api/episodes/${activeEpisode.id}/audio/rebuild-mix`, {
        method: "POST",
        body: JSON.stringify({})
      });
      setEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
      setEpisodeDraft(structuredClone(episode));
      setStatus(report?.localUrl ? `${job.summary} Report saved locally.` : job.summary);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusyAction("");
      setBusy(false);
    }
  }

  async function regenerateAllAudio() {
    if (!activeEpisode) return;
    setBusyAction("regenerate-audio");
    setBusy(true);
    try {
      setStatus("Regenerating all dialogue audio...");
      const workingEpisode = episodeDraft?.id === activeEpisode.id ? episodeDraft : activeEpisode;
      const { episode, job, report } = await request(`/api/episodes/${activeEpisode.id}/audio/regenerate-all`, {
        method: "POST",
        body: JSON.stringify({
          productionMap: workingEpisode.productionMap || [],
          productionMapEditedAt: workingEpisode.productionMapEditedAt || ""
        })
      });
      setEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
      setEpisodeDraft(structuredClone(episode));
      setStatus(report?.localUrl ? `${job.summary} Report saved locally.` : job.summary);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusyAction("");
      setBusy(false);
    }
  }

  async function generateInsertVideo(line) {
    if (!activeEpisode || !line?.id) return;
    setBusyAction(`insert:${line.id}`);
    setBusy(true);
    try {
      const { episode } = await request(`/api/episodes/${activeEpisode.id}/insert-lines/${line.id}/generate-video`, {
        method: "POST",
        body: JSON.stringify({ line })
      });
      setEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
      setEpisodeDraft(structuredClone(episode));
      setStatus(`Insert video generated for line ${line.index}.`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusyAction("");
      setBusy(false);
    }
  }

  async function generateDialogueVideo(line) {
    if (!activeEpisode || !line?.id) return;
    setBusyAction(`dialogue-video:${line.id}`);
    setBusy(true);
    setStatus(`Starting shot video generation for line ${line.index}...`);
    try {
      const { episode } = await request(`/api/episodes/${activeEpisode.id}/dialogue-lines/${line.id}/generate-video`, {
        method: "POST",
        body: JSON.stringify({ line })
      });
      setEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
      setEpisodeDraft(structuredClone(episode));
      setStatus(`Shot video generated for line ${line.index}. Rebuild Final will use the latest shot clips.`);
    } catch (error) {
      const episode = error.payload?.episode;
      if (episode) {
        setEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
        setEpisodeDraft(structuredClone(episode));
      }
      setStatus(error.message);
    } finally {
      setBusyAction("");
      setBusy(false);
    }
  }

  async function selectDialogueVideoTake(line, take) {
    if (!activeEpisode || !line?.id || !take) return;
    setBusyAction(`dialogue-video-take:${line.id}`);
    setBusy(true);
    try {
      const { episode } = await request(`/api/episodes/${activeEpisode.id}/dialogue-lines/${line.id}/video-take`, {
        method: "PATCH",
        body: JSON.stringify({ takeId: take.id || "", localUrl: take.localUrl || take.proxyLocalUrl || take.fileName || "" })
      });
      setEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
      setEpisodeDraft(structuredClone(episode));
      setStatus(`Selected shot video take for line ${line.index}. Rebuild Final will use this clip.`);
    } catch (error) {
      const episode = error.payload?.episode;
      if (episode) {
        setEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
        setEpisodeDraft(structuredClone(episode));
      }
      setStatus(error.message);
    } finally {
      setBusyAction("");
      setBusy(false);
    }
  }

  async function generateMissingDialogueVideos() {
    if (!activeEpisode) return;
    let workingEpisode = episodeDraft?.id === activeEpisode.id ? structuredClone(episodeDraft) : structuredClone(activeEpisode);
    const targets = (workingEpisode.productionMap || []).filter(
      (line) => line.lineType !== "insert" && line.audioTake?.localUrl && !line.videoTake?.localUrl
    );
    if (!targets.length) {
      setStatus("No missing dialogue shot videos with ready audio.");
      return;
    }

    setBusy(true);
    try {
      for (const target of targets) {
        const line = (workingEpisode.productionMap || []).find((item) => item.id === target.id) || target;
        setBusyAction(`dialogue-video:${line.id}`);
        setStatus(`Generating shot video for line ${line.index}...`);
        const { episode } = await request(`/api/episodes/${workingEpisode.id}/dialogue-lines/${line.id}/generate-video`, {
          method: "POST",
          body: JSON.stringify({ line })
        });
        workingEpisode = episode;
        setEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
        setEpisodeDraft(structuredClone(episode));
      }
      setStatus(`Generated ${targets.length} shot video${targets.length === 1 ? "" : "s"}. Rebuild Final will use the latest shot clips.`);
    } catch (error) {
      const episode = error.payload?.episode;
      if (episode) {
        setEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
        setEpisodeDraft(structuredClone(episode));
      }
      setStatus(error.message);
    } finally {
      setBusyAction("");
      setBusy(false);
    }
  }

  async function uploadInsertVideo(line, files) {
    if (!activeEpisode || !line?.id || !files?.[0]) return;
    const form = new FormData();
    form.append("video", files[0]);
    form.append("line", JSON.stringify(line));
    setBusyAction(`insert-upload:${line.id}`);
    setBusy(true);
    try {
      const { episode, line: uploadedLine } = await request(`/api/episodes/${activeEpisode.id}/insert-lines/${line.id}/upload-video`, {
        method: "POST",
        body: form
      });
      setEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
      setEpisodeDraft(structuredClone(episode));
      const warning = uploadedLine?.videoTake?.warning ? ` ${uploadedLine.videoTake.warning}` : "";
      setStatus(`Uploaded custom insert video for line ${line.index}.${warning}`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusyAction("");
      setBusy(false);
    }
  }

  async function saveDrawnMask(line, maskDataUrl) {
    if (!activeEpisode || !line?.id) return;
    setBusy(true);
    try {
      const { episode, appliedLineCount } = await request(`/api/episodes/${activeEpisode.id}/lines/${line.id}/drawn-mask`, {
        method: "POST",
        body: JSON.stringify({
          line,
          maskDataUrl,
          productionMap: episodeDraft?.productionMap || activeEpisode.productionMap || []
        })
      });
      setEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
      setEpisodeDraft(structuredClone(episode));
      const extra = appliedLineCount > 1 ? ` Applied to ${appliedLineCount} matching lines.` : "";
      setStatus(`Drawn mask saved for line ${line.index}.${extra}`);
      setMaskEditorLineId("");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function clearLineMask(line) {
    if (!activeEpisode || !line?.id) return;
    const baseEpisode = episodeDraft?.id === activeEpisode.id ? episodeDraft : activeEpisode;
    const productionMapEditedAt = new Date().toISOString();
    const productionMap = (baseEpisode.productionMap || []).map((item) =>
      item.id === line.id
        ? {
            ...item,
            maskAssetId: "",
            needsMask: false,
            maskAutoApplyDisabled: false,
            maskRefreshToken: createLocalId("mask-refresh"),
            invertMask: false,
            videoStatus: "pending",
            videoTake: null,
            videoTakes: []
          }
        : item
    );
    setBusy(true);
    try {
      const episode = await request(`/api/episodes/${activeEpisode.id}/production-map`, {
        method: "PATCH",
        body: JSON.stringify({ productionMap, productionMapEditedAt })
      });
      setEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
      setEpisodeDraft(structuredClone(episode));
      setStatus(`Mask cleared for line ${line.index}. Auto mask is ready to regenerate.`);
      setMaskEditorLineId("");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function setApproval(gateId, nextStatus = "approved") {
    if (!activeEpisode) return;
    setBusy(true);
    try {
      const episode = await request(`/api/episodes/${activeEpisode.id}/approvals/${gateId}`, {
        method: "POST",
        body: JSON.stringify({ status: nextStatus })
      });
      setEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
      setEpisodeDraft(structuredClone(episode));
      setStatus(`${gateId.replace("_", " ")} updated.`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleScriptFile(file) {
    if (!file) return;
    const fd = new FormData();
    fd.append("script", file);
    setBusy(true);
    try {
      const targetEpisode = await ensureEpisodeForUpload();
      const episode = await request(`/api/episodes/${targetEpisode.id}/script`, {
        method: "POST",
        body: fd
      });
      setEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
      setActiveEpisodeId(episode.id);
      setEpisodeDraft(structuredClone(episode));
      setStatus("Script uploaded.");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function uploadAssets(files, role = "general") {
    if (!files?.length) return;
    const fd = new FormData();
    const shotType = shotAssetTypes.find((type) => type.role === role);
    fd.append("role", role);
    fd.append("roleLabel", shotType?.label || "General Asset");
    Array.from(files).forEach((file) => fd.append("assets", file));
    setBusy(true);
    try {
      const targetEpisode = await ensureEpisodeForUpload();
      const episode = await request(`/api/episodes/${targetEpisode.id}/assets`, {
        method: "POST",
        body: fd
      });
      setEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
      setEpisodeDraft(structuredClone(episode));
      setStatus("Assets uploaded.");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteAsset(assetId) {
    if (!assetId || !activeEpisode) return;
    setBusy(true);
    try {
      const episode = await request(`/api/episodes/${activeEpisode.id}/assets/${assetId}`, {
        method: "DELETE"
      });
      setEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
      setEpisodeDraft(structuredClone(episode));
      setStatus("Asset deleted.");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function updateAssetTags(assetId, speakingTag) {
    if (!assetId || !activeEpisode) return;
    try {
      const episode = await request(`/api/episodes/${activeEpisode.id}/assets/${assetId}`, {
        method: "PATCH",
        body: JSON.stringify({ speakingTag })
      });
      setEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
      setEpisodeDraft(structuredClone(episode));
      setStatus("Image character tags saved.");
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function updateAssetLipSyncDefaults(assetId, patch) {
    if (!assetId || !activeEpisode) return;
    try {
      const episode = await request(`/api/episodes/${activeEpisode.id}/assets/${assetId}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
      });
      setEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
      setEpisodeDraft(structuredClone(episode));
      setStatus("Cast Visual defaults saved.");
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function generateAssetLipSyncPrompt(assetId, provider = "") {
    if (!assetId || !activeEpisode) return;
    setBusyAction(`asset-prompt:${assetId}`);
    setBusy(true);
    try {
      const { episode } = await request(`/api/episodes/${activeEpisode.id}/assets/${assetId}/lipsync-prompt`, {
        method: "POST",
        body: JSON.stringify({ provider })
      });
      setEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
      setEpisodeDraft(structuredClone(episode));
      setStatus(`Cast Visual prompt generated for ${lipSyncModelLabel(provider)}.`);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusyAction("");
      setBusy(false);
    }
  }

  function resetDraftRenderApproval(next, note = "Production changed after render review.") {
    if (!next?.approvals?.length) return;
    next.approvals = next.approvals.map((gate) =>
      gate.id === "render_preview"
        ? {
            ...gate,
            status: "pending",
            approvedAt: "",
            note
          }
        : gate
    );
  }

  function updateProductionLine(lineId, patch) {
    setEpisodeDraft((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      const clearsVideoTake =
        Object.prototype.hasOwnProperty.call(patch, "videoTake") &&
        patch.videoTake === null &&
        !Object.prototype.hasOwnProperty.call(patch, "videoTakes");
      const effectivePatch = clearsVideoTake ? { ...patch, videoTakes: [] } : patch;
      const patchedMap = (next.productionMap || []).map((line) =>
        line.id === lineId ? { ...line, ...effectivePatch } : line
      );
      next.productionMap = applyStoredSpeakerMasksToLines(patchedMap, next.assets || []);
      next.productionMapEditedAt = new Date().toISOString();
      resetDraftRenderApproval(next);
      return next;
    });
  }

  function deleteProductionLine(lineId) {
    setEpisodeDraft((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      next.productionMap = reindexProductionMap((next.productionMap || []).filter((line) => line.id !== lineId));
      next.productionMapEditedAt = new Date().toISOString();
      resetDraftRenderApproval(next);
      return next;
    });
    setStatus("Production row removed. Script source text was not changed.");
  }

  function reorderProductionLine(sourceLineId, targetLineId, placement = "before") {
    if (!sourceLineId || !targetLineId || sourceLineId === targetLineId) return;
    setEpisodeDraft((prev) => {
      if (!prev) return prev;
      const lines = [...(prev.productionMap || [])];
      const sourceIndex = lines.findIndex((line) => line.id === sourceLineId);
      if (sourceIndex < 0) return prev;
      const [moved] = lines.splice(sourceIndex, 1);
      const targetIndex = lines.findIndex((line) => line.id === targetLineId);
      if (targetIndex < 0) return prev;
      const insertIndex = placement === "after" ? targetIndex + 1 : targetIndex;
      const next = structuredClone(prev);
      lines.splice(insertIndex, 0, moved);
      next.productionMap = reindexProductionMap(lines);
      next.productionMapEditedAt = new Date().toISOString();
      resetDraftRenderApproval(next);
      return next;
    });
    setStatus("Production map order updated. Script source text was not changed.");
  }

  function groupProductionLines(lineIds) {
    const ids = new Set(lineIds || []);
    if (ids.size < 2) return;
    setEpisodeDraft((prev) => {
      if (!prev) return prev;
      const lines = [...(prev.productionMap || [])];
      const selectedIndexes = lines
        .map((line, index) => (ids.has(line.id) ? index : -1))
        .filter((index) => index >= 0)
        .sort((a, b) => a - b);
      if (selectedIndexes.length < 2) return prev;
      const first = selectedIndexes[0];
      const last = selectedIndexes.at(-1);
      const rangeIds = lines.slice(first, last + 1).map((line) => line.id);
      if (rangeIds.length !== selectedIndexes.length) {
        const ok = globalThis.confirm?.("Group the selected range? This includes the rows between your selected rows.");
        if (!ok) return prev;
      }
      const defaultTitle = `Group ${first + 1}-${last + 1}`;
      const promptedTitle = globalThis.prompt?.("Group name", defaultTitle);
      if (promptedTitle === null) return prev;
      const title = String(promptedTitle || defaultTitle).trim() || defaultTitle;
      const groupId = `group-${Date.now()}-${Math.round(Math.random() * 100000)}`;
      const rangeSet = new Set(rangeIds);
      const next = structuredClone(prev);
      next.productionMap = lines.map((line) =>
        rangeSet.has(line.id)
          ? {
              ...line,
              groupId,
              groupTitle: title
            }
          : line
      );
      next.productionMapEditedAt = new Date().toISOString();
      resetDraftRenderApproval(next);
      return next;
    });
    setStatus("Production rows grouped. Script source text was not changed.");
  }

  function ungroupProductionLines(lineIds) {
    const ids = new Set(lineIds || []);
    if (!ids.size) return;
    setEpisodeDraft((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      next.productionMap = (next.productionMap || []).map((line) =>
        ids.has(line.id) ? { ...line, groupId: "", groupTitle: "" } : line
      );
      next.productionMapEditedAt = new Date().toISOString();
      resetDraftRenderApproval(next);
      return next;
    });
    setStatus("Selected production rows ungrouped.");
  }

  function setProductionCharacter(lineId, characterId) {
    const character = (activeShow?.characters || []).find((item) => item.id === characterId);
    updateProductionLine(lineId, {
      characterId,
      voiceId: character?.voiceId || "",
      audioStatus: "pending",
      audioTake: null,
      videoStatus: "pending",
      videoTake: null
    });
  }

  function updateShowDraft(path, value) {
    setShowDraft((prev) => {
      const next = structuredClone(prev);
      let target = next;
      for (let i = 0; i < path.length - 1; i += 1) {
        if (!target[path[i]] || typeof target[path[i]] !== "object") {
          target[path[i]] = {};
        }
        target = target[path[i]];
      }
      target[path[path.length - 1]] = value;
      return next;
    });
  }

  function applyAutomationPreset(values) {
    setShowDraft((prev) => ({
      ...prev,
      automation: {
        ...prev.automation,
        ...values
      }
    }));
  }

  function updateEpisodeDraft(path, value) {
    setEpisodeDraft((prev) => {
      const next = structuredClone(prev);
      let target = next;
      for (let i = 0; i < path.length - 1; i += 1) {
        if (!target[path[i]] || typeof target[path[i]] !== "object") {
          target[path[i]] = {};
        }
        target = target[path[i]];
      }
      target[path[path.length - 1]] = value;
      return next;
    });
  }

  function setShowAspect(aspectRatio) {
    const resolution = aspectRatio === "16:9" ? "1920x1080" : "1080x1920";
    setShowDraft((prev) => ({
      ...prev,
      shortFormat: {
        ...prev.shortFormat,
        aspectRatio,
        resolution
      }
    }));
  }

  function setShowResolution(resolution) {
    updateShowDraft(["shortFormat", "resolution"], resolution);
  }

  function setEpisodeAspect(aspectRatio) {
    const resolution = aspectRatio === "16:9" ? "1920x1080" : "1080x1920";
    setEpisodeDraft((prev) => ({
      ...prev,
      format: {
        ...prev.format,
        aspectRatio,
        resolution
      }
    }));
  }

  function updateCharacter(index, patch) {
    setShowDraft((prev) => {
      const next = structuredClone(prev);
      next.characters = (next.characters || []).map((character, i) =>
        i === index ? { ...character, ...patch } : character
      );
      return next;
    });
  }

  function addCharacter() {
    const id = globalThis.crypto?.randomUUID?.() || `character-${Date.now()}`;
    setShowDraft((prev) => ({
      ...prev,
      characters: [
        ...(prev.characters || []),
        {
          id,
          name: "New Character",
          role: "",
          voiceId: "",
          visualNotes: ""
        }
      ]
    }));
  }

  function removeCharacter(index) {
    setShowDraft((prev) => ({
      ...prev,
      characters: (prev.characters || []).filter((_, i) => i !== index)
    }));
  }

  const integrations = health?.integrations || {};
  const safety = health?.safety || { publishingEnabled: false, mode: "local-test-only" };
  const youtubeAuth = health?.youtube || {};
  const selectedFormat = episodeDraft?.format || activeEpisode?.format || activeShow?.shortFormat || {};
  const plan = episodeDraft?.plan || activeEpisode?.plan || {};
  const approvals =
    episodeDraft?.id === activeEpisode?.id
      ? episodeDraft?.approvals || activeEpisode?.approvals || []
      : activeEpisode?.approvals || [];
  const preRenderApprovalIds = new Set(["script_plan", "voice_audio"]);
  const preRenderGates = approvals.filter((gate) => preRenderApprovalIds.has(gate.id));
  const preRenderApprovalsReady =
    preRenderGates.length === preRenderApprovalIds.size &&
    preRenderGates.every((gate) => gate.status === "approved" || gate.status === "auto");
  const drafts = episodeDraft?.id === activeEpisode?.id ? episodeDraft?.drafts || {} : activeEpisode?.drafts || {};
  const storedPanelStateForScope =
    storedPanelStateScopeKey === panelStateScopeKey ? storedPanelState : readStoredPanelState(panelStateScopeKey);
  const uiPanelState = {
    ...(drafts.ui?.panelState || {}),
    ...storedPanelStateForScope
  };
  const activeAutomation = showDraft?.automation || {};
  const socialConfig = showDraft?.platforms?.social || activeShow?.platforms?.social || {};
  const promotionTemplates = normalizePromotionTemplates(socialConfig.templates);
  const episodePublishDescription =
    activeEpisode?.description ||
    drafts.youtube?.description ||
    activeEpisode?.plan?.summary ||
    showDraft?.description ||
    activeShow?.description ||
    "";
  const campaignConfig = {
    ...socialConfig,
    templates: promotionTemplates,
    showName: showDraft?.name || activeShow?.name || "",
    hashtags: showDraft?.creative?.recurringHashtags || activeShow?.creative?.recurringHashtags || [],
    cta: showDraft?.creative?.defaultCta || activeShow?.creative?.defaultCta || ""
  };
  const productionMap = episodeDraft?.productionMap || activeEpisode?.productionMap || [];
  const workingAssets =
    episodeDraft?.id === activeEpisode?.id
      ? episodeDraft?.assets || activeEpisode?.assets || []
      : activeEpisode?.assets || [];
  const previewOutputs = (activeEpisode?.outputs || []).filter((output) => output.type === "preview_video");
  const previewOutput = previewOutputs[0] || null;
  const finalOutputs = (activeEpisode?.outputs || []).filter((output) => output.type === "final_video");
  const baseFinalOutput = finalOutputs[0] || null;
  const finishedMasterOutputs = (activeEpisode?.outputs || []).filter((output) => output.type === "finished_master");
  const finishedMasterOutput = finishedMasterOutputs[0] || null;
  const finalOutput =
    [...finishedMasterOutputs, ...finalOutputs].sort((a, b) => outputCreatedAtValue(b) - outputCreatedAtValue(a))[0] ||
    null;
  const manifestOutputs = (activeEpisode?.outputs || []).filter((output) => output.type === "render_manifest");
  const finalManifestOutputs = (activeEpisode?.outputs || []).filter((output) => output.type === "final_render_manifest");
  const audioOutputs = (activeEpisode?.outputs || []).filter((output) => output.type === "audio_mix");
  const audioOutput = audioOutputs[0] || null;
  const finalAudioOutputs = (activeEpisode?.outputs || []).filter((output) => output.type === "final_audio_mix");
  const reportOutputs = (activeEpisode?.outputs || []).filter((output) => output.type === "build_report");
  const packageOutputs = (activeEpisode?.outputs || []).filter((output) => output.type === "package_export");
  const youtubeUploadOutputs = (activeEpisode?.outputs || []).filter((output) => output.type === "youtube_upload");
  const thumbnailOutputs = visibleThumbnailCandidates(
    (activeEpisode?.outputs || []).filter((output) => output.type === "thumbnail_image")
  );
  const renderReviewGate = approvals.find((gate) => gate.id === "render_preview");
  const renderReviewApproved = !renderReviewGate || renderReviewGate.status === "approved" || renderReviewGate.status === "auto";
  const renderReadiness = buildRenderReadiness({
    productionMap,
    assets: workingAssets,
    approvals,
    audioOutput,
    previewOutput,
    renderReviewApproved,
    dialogueClipRequired: true,
    selectedFormat,
    plan
  });
  const previewBuildReady = Boolean(activeEpisode && preRenderApprovalsReady && renderReadiness.setupReady);
  const finalRenderReady = Boolean(activeEpisode && renderReadiness.finalReady);

  const assetCounts = useMemo(() => {
    const counts = {};
    for (const asset of workingAssets) {
      const role = asset.shotRole || "general";
      counts[role] = (counts[role] || 0) + 1;
    }
    return counts;
  }, [workingAssets]);
  const assetsByRole = useMemo(() => {
    const groups = {};
    for (const type of shotAssetTypes) {
      groups[type.role] = [];
    }
    for (const asset of workingAssets) {
      const role = asset.shotRole || "general";
      if (!groups[role]) groups[role] = [];
      groups[role].push(asset);
    }
    return groups;
  }, [workingAssets]);
  const visualAssets = useMemo(
    () => workingAssets.filter((asset) => asset.type === "image" && asset.shotRole !== "mask"),
    [workingAssets]
  );
  const maskAssets = useMemo(
    () => workingAssets.filter((asset) => asset.type === "image" && asset.shotRole === "mask"),
    [workingAssets]
  );
  const productionShotTypes = shotAssetTypes.filter((type) => type.role !== "mask");
  const uploadShotTypes = shotAssetTypes.filter((type) => type.role !== "mask");
  const maskEditorLine = productionMap.find((line) => line.id === maskEditorLineId) || null;
  const maskEditorImage = maskEditorLine ? visualAssets.find((asset) => asset.id === maskEditorLine.assetId) || null : null;
  const maskEditorMask = maskEditorLine ? maskAssets.find((asset) => asset.id === maskEditorLine.maskAssetId) || null : null;
  const workspacePanelResetKey = `${activeShow?.id || ""}:${activeEpisode?.id || ""}:${activeTab}`;
  const productionMapPanelProps = {
    productionMap,
    show: activeShow,
    format: selectedFormat,
    characters: activeShow?.characters || [],
    voices,
    shotTypes: productionShotTypes,
    visualAssets,
    maskAssets,
    onUpdate: updateProductionLine,
    onSetCharacter: setProductionCharacter,
    onDeleteLine: deleteProductionLine,
    onReorderLine: reorderProductionLine,
    onGroupLines: groupProductionLines,
    onUngroupLines: ungroupProductionLines,
    onRegenerateAudio: regenerateLineAudio,
    onSetAudioStatus: setLineAudioStatus,
    onOpenMaskEditor: setMaskEditorLineId,
    onGenerateDialogueVideo: generateDialogueVideo,
    onSelectDialogueVideoTake: selectDialogueVideoTake,
    onGenerateMissingDialogueVideos: generateMissingDialogueVideos,
    onGenerateInsertVideo: generateInsertVideo,
    onUploadInsertVideo: uploadInsertVideo,
    onSave: saveStudioAndReview,
    resetKey: workspacePanelResetKey,
    defaultOpen: savedPanelOpen(uiPanelState, "studio.productionMap"),
    onOpenChange: (isOpen) => updateEpisodePanelOpen("studio.productionMap", isOpen),
    busy,
    busyAction
  };
  const currentShowEpisodes = episodes.filter((episode) => !activeShowId || episode.showId === activeShowId);
  const libraryView = appView === "library";
  const showDashboardView = appView === "show";
  const workspaceView = appView === "episode";

  useEffect(() => {
    if (workspaceView && !workspaceTabKeys.has(activeTab)) {
      setActiveTab("studio");
    }
  }, [activeTab, workspaceView]);

  const headerTitle = libraryView ? "NewtBuilder" : activeShow?.name || "Show";
  const headerSubtitle = libraryView
    ? "Show Library"
    : showDashboardView
      ? "Episodes"
      : activeTab === "settings"
        ? "Show Settings"
        : activeEpisode?.title || "Episode Workspace";

  return (
    <div className={`appShell ${workspaceView ? "" : "noTabs"}`}>
      <header className="topbar">
        <div className="brandCluster">
          <div className="brandMark">
            <WandSparkles size={24} />
          </div>
          <div>
            <h1>{headerTitle}</h1>
            <p>{headerSubtitle}</p>
          </div>
        </div>

        <div className="topActions">
          {!libraryView ? (
            <button className="secondaryButton" type="button" onClick={() => setAppView("library")} disabled={busy}>
              <Clapperboard size={16} />
              All Shows
            </button>
          ) : null}
          {!libraryView ? (
            <select value={activeShowId} onChange={(event) => openShow(event.target.value)} aria-label="Current show">
              {shows.map((show) => (
                <option key={show.id} value={show.id}>
                  {show.name}
                </option>
              ))}
            </select>
          ) : null}
          {workspaceView ? (
            <button className="secondaryButton" type="button" onClick={openShowDashboard} disabled={!activeShow || busy}>
              <Film size={16} />
              Episodes
            </button>
          ) : null}
          {workspaceView ? (
            <>
              <button className="secondaryButton" type="button" onClick={saveStudioAndReview} disabled={!activeEpisode || busy}>
                <Save size={16} />
                Save
              </button>
              <button className="secondaryButton" type="button" onClick={saveEpisodeAsPackage} disabled={!activeEpisode || busy}>
                <FolderOpen size={16} />
                Save As
              </button>
            </>
          ) : null}
          {libraryView ? (
            <button className="primaryButton" onClick={createShow} disabled={busy}>
              <Plus size={18} />
              New Show
            </button>
          ) : (
            <>
              <button className="iconButton" onClick={renameActiveShow} title="Rename show" disabled={!activeShow || busy}>
                <Pencil size={17} />
              </button>
              <button className="iconButton dangerIcon" onClick={deleteActiveShow} title="Delete show" disabled={!activeShow || busy}>
                <Trash2 size={17} />
              </button>
              <button
                className={activeTab === "settings" && workspaceView ? "iconButton active" : "iconButton"}
                onClick={openShowSettings}
                title="Settings"
                aria-label="Settings"
                disabled={!activeShow || busy}
              >
                <Settings2 size={17} />
              </button>
              {workspaceView ? (
                <button className="secondaryButton" type="button" onClick={() => renameEpisode()} disabled={!activeEpisode || busy}>
                  <Pencil size={16} />
                  Rename Episode
                </button>
              ) : null}
              <button className="primaryButton" onClick={createEpisode} disabled={!activeShow || busy}>
                <Plus size={18} />
                New Episode
              </button>
            </>
          )}
        </div>
      </header>

      {workspaceView ? (
        <nav className="tabbar">
          {targetTabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              className={activeTab === key ? "active" : ""}
              onClick={() => setActiveTab(key)}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>
      ) : null}

      <main>
        {libraryView && (
          <ShowLibrary
            shows={shows}
            allEpisodes={allEpisodes}
            activeShowId={activeShowId}
            busy={busy}
            onOpenShow={openShow}
            onRenameShow={renameShow}
            onDeleteShow={deleteShow}
          />
        )}

        {showDashboardView && (
          <ShowDashboard
            show={activeShow}
            episodes={currentShowEpisodes}
            busy={busy}
            onCreateEpisode={createEpisode}
            onOpenEpisode={openEpisode}
            onOpenEpisodeReview={openEpisodeReview}
            onRenameEpisode={renameEpisode}
            onDuplicateEpisode={duplicateEpisode}
            onReorderEpisodes={reorderEpisodes}
          />
        )}

        {workspaceView && activeTab === "studio" && (
          <section className="overviewBand studioActionBand">
            <div className="metrics">
              <Metric icon={Gauge} label="Format" value={selectedFormat.resolution || selectedFormat.aspectRatio || "Not set"} />
              <Metric icon={FileText} label="Script" value={`${plan.wordCount || 0} words`} />
              <Metric icon={Play} label="Estimate" value={formatSeconds(plan.estimatedSeconds)} />
            </div>
          </section>
        )}

        {workspaceView && activeTab === "studio" && (
          <div className="studioGrid">
            {showDraft && (
              <CollapsiblePanel
                className="showIdentityPanel"
                eyebrow="Show"
                title="Identity"
                defaultOpen={savedPanelOpen(uiPanelState, "studio.identity")}
                resetKey={workspacePanelResetKey}
                onOpenChange={(isOpen) => updateEpisodePanelOpen("studio.identity", isOpen)}
                action={
                  <button className="secondaryButton" onClick={saveShow} disabled={busy}>
                    <Save size={17} />
                    Save Profile
                  </button>
                }
              >
                <div className="identityCompactRow">
                  <Field label="Show name">
                    <input value={showDraft.name} onChange={(event) => updateShowDraft(["name"], event.target.value)} />
                  </Field>
                  <Field label="Description">
                    <textarea
                      value={showDraft.description}
                      onChange={(event) => updateShowDraft(["description"], event.target.value)}
                      rows={1}
                    />
                  </Field>
                </div>
              </CollapsiblePanel>
            )}

            {showDraft && (
              <CollapsiblePanel
                className="characterPanel"
                eyebrow="Cast"
                title="Characters & Visuals"
                defaultOpen={savedPanelOpen(uiPanelState, "studio.characters")}
                resetKey={workspacePanelResetKey}
                onOpenChange={(isOpen) => updateEpisodePanelOpen("studio.characters", isOpen)}
                action={
                  <div className="buttonRow">
                    <Pill tone={voicesSource === "elevenlabs" ? "good" : "warn"}>
                      {voicesSource === "elevenlabs" ? "ElevenLabs" : "Demo voices"}
                    </Pill>
                    <Pill tone={(activeEpisode?.assets || []).some((asset) => asset.type === "image") ? "good" : "neutral"}>
                      {(activeEpisode?.assets || []).filter((asset) => asset.type === "image").length} images
                    </Pill>
                    <button className="secondaryButton" onClick={addCharacter}>
                      <Plus size={16} />
                      Character
                    </button>
                    <button className="secondaryButton" type="button" onClick={saveShow} disabled={busy}>
                      <Save size={16} />
                      Save
                    </button>
                  </div>
                }
              >
                <p className="helperText">{voicesStatus}</p>
                <div className="characterList">
                  {(showDraft.characters || []).map((character, index) => (
                    <article className="characterRow" key={character.id || index}>
                      <label className="field compactCharacterField">
                        <span>Name</span>
                        <input
                          value={character.name}
                          onChange={(event) => updateCharacter(index, { name: event.target.value })}
                        />
                      </label>
                      <label className="field compactCharacterField">
                        <span>Role</span>
                        <input
                          value={character.role}
                          onChange={(event) => updateCharacter(index, { role: event.target.value })}
                          placeholder="Main, guest..."
                        />
                      </label>
                      <label className="field compactCharacterField characterVoiceField">
                        <span>Voice</span>
                        <select
                          value={character.voiceId || ""}
                          onChange={(event) => updateCharacter(index, { voiceId: event.target.value })}
                        >
                          <VoiceSelectOptions voices={voices} currentValue={character.voiceId} />
                        </select>
                      </label>
                      <label className="field compactCharacterField characterNotesField">
                        <span>Visual notes</span>
                        <textarea
                          value={character.visualNotes}
                          onChange={(event) => updateCharacter(index, { visualNotes: event.target.value })}
                          rows={1}
                          placeholder="What this character should look like, which uploads belong to them..."
                        />
                      </label>
                      <button className="quietButton iconOnly characterRemoveButton" onClick={() => removeCharacter(index)} title="Remove character">
                        <Trash2 size={15} />
                      </button>
                    </article>
                  ))}
                </div>
                <CastVisualLibrary
                  episodeId={activeEpisode?.id || ""}
                  uploadShotTypes={uploadShotTypes}
                  assets={visualAssets}
                  onUpload={uploadAssets}
                  onDelete={deleteAsset}
                  onUpdateTags={updateAssetTags}
                  onUpdateAsset={updateAssetLipSyncDefaults}
                  onGenerateLipSyncPrompt={generateAssetLipSyncPrompt}
                  showDefaultLipSyncModel={showDraft.production?.defaultLipSyncModel || "fabric"}
                  busyAction={busyAction}
                />
              </CollapsiblePanel>
            )}

            <CollapsiblePanel
              className="scriptPanel"
              eyebrow="Episode"
              title="Script Package"
              defaultOpen={savedPanelOpen(uiPanelState, "studio.script")}
              resetKey={workspacePanelResetKey}
              onOpenChange={(isOpen) => updateEpisodePanelOpen("studio.script", isOpen)}
              action={
                <div className="buttonRow">
                  <label className="secondaryButton">
                    <Upload size={17} />
                    Upload Script
                    <input
                      type="file"
                      accept=".pdf,.txt,.md,.rtf,application/pdf,text/plain,text/markdown"
                      onChange={(event) => handleScriptFile(event.target.files?.[0])}
                    />
                  </label>
                  <button className="secondaryButton" type="button" onClick={saveStudioAndReview} disabled={!episodeDraft || busy}>
                    <Save size={16} />
                    Save
                  </button>
                </div>
              }
            >
              {!episodeDraft && (
                <div className="notice">
                  <ChevronRight size={17} />
                  No episode yet. Upload a script, upload shot images, or click New Episode to start a draft.
                </div>
              )}

              <textarea
                className="scriptArea"
                value={episodeDraft?.scriptText || ""}
                onChange={(event) => updateEpisodeDraft(["scriptText"], event.target.value)}
                placeholder="Paste or upload an episode script..."
                disabled={!episodeDraft}
              />

              <div className="buttonRow">
                <button className="primaryButton" onClick={buildPlan} disabled={!episodeDraft || busy}>
                  <Sparkles size={18} />
                  Build Plan
                </button>
                <button className="secondaryButton" type="button" onClick={saveStudioAndReview} disabled={!episodeDraft || busy}>
                  <Save size={16} />
                  Save Script
                </button>
              </div>
            </CollapsiblePanel>

            <ProductionMapPanel {...productionMapPanelProps} />

          </div>
        )}

        {workspaceView && activeTab === "settings" && showDraft && (
          <section className="settingsView">
            <div className="editorBand">
              <div>
                <span className="eyebrow">Show Settings</span>
                <h3>Automation, Format & Publishing</h3>
              </div>
              <button className="primaryButton" onClick={saveShow} disabled={busy}>
                <Save size={18} />
                Save Settings
              </button>
            </div>

            <div className="settingsStack">
              <section className="settingsGroup">
                <div className="settingsGroupHeader">
                  <span className="eyebrow">Core Setup</span>
                  <h3>Format & Production Defaults</h3>
                </div>
                <div className="settingsGroupGrid">
                  <div className="workPanel">
                    <div className="panelHeader">
                      <div>
                        <span className="eyebrow">Format</span>
                        <h3>Episode Format</h3>
                      </div>
                    </div>
                    <Field label="Aspect">
                      <SegmentedControl
                        value={showDraft.shortFormat.aspectRatio}
                        options={[
                          { value: "9:16", label: "9:16 Vertical" },
                          { value: "16:9", label: "16:9 Wide" }
                        ]}
                        onChange={setShowAspect}
                      />
                    </Field>
                    <div className="twoColumn">
                      <Field label="Resolution">
                        <select
                          value={showDraft.shortFormat.resolution}
                          onChange={(event) => setShowResolution(event.target.value)}
                        >
                          {(formatResolutionOptions[showDraft.shortFormat.aspectRatio] || formatResolutionOptions["9:16"]).map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="WPM">
                        <input
                          type="number"
                          value={showDraft.shortFormat.wordsPerMinute}
                          onChange={(event) => updateShowDraft(["shortFormat", "wordsPerMinute"], Number(event.target.value))}
                        />
                      </Field>
                      <Field label="FPS">
                        <input
                          type="number"
                          value={showDraft.shortFormat.fps}
                          onChange={(event) => updateShowDraft(["shortFormat", "fps"], Number(event.target.value))}
                        />
                      </Field>
                    </div>
                  </div>

                  <div className="workPanel">
                    <div className="panelHeader">
                      <div>
                        <span className="eyebrow">Production</span>
                        <h3>Defaults</h3>
                      </div>
                    </div>
                    <div className="twoColumn">
                      <Field label="Default lip-sync model">
                        <select
                          value={showDraft.production?.defaultLipSyncModel || "fabric"}
                          onChange={(event) => updateShowDraft(["production", "defaultLipSyncModel"], event.target.value)}
                        >
                          {lipSyncModelOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="InfiniteTalk backend">
                        <select
                          value={showDraft.production?.infiniteTalkBackend || "fal"}
                          onChange={(event) => updateShowDraft(["production", "infiniteTalkBackend"], event.target.value)}
                        >
                          {infiniteTalkBackendOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Insert trim seconds">
                        <input
                          type="number"
                          min="1"
                          max="10"
                          value={showDraft.production?.defaultInsertTrimSeconds || INSERT_TRIM_DEFAULT_SECONDS}
                          onChange={(event) =>
                            updateShowDraft(["production", "defaultInsertTrimSeconds"], Number(event.target.value))
                          }
                        />
                      </Field>
                    </div>
                    <Toggle
                      checked={Boolean(showDraft.production?.defaultExpressiveBodyMotion)}
                      onChange={(checked) => updateShowDraft(["production", "defaultExpressiveBodyMotion"], checked)}
                      label="Expressive body default"
                      icon={Activity}
                    />
                    {showDraft.production?.infiniteTalkBackend === "local" && !integrations.infinitalkLocal ? (
                      <div className="manualPublishNotice warning">
                        Local InfiniteTalk needs LOCAL_INFINITALK_REPO_DIR in .env before shot videos can render locally.
                      </div>
                    ) : null}
                    {showDraft.production?.infiniteTalkBackend === "comfyui" && !integrations.infinitalkComfyUi ? (
                      <div className="manualPublishNotice warning">
                        ComfyUI InfiniteTalk needs ComfyUI running and COMFYUI_INFINITALK_WORKFLOW set to an API-format workflow.
                      </div>
                    ) : null}
                    <div className="manualPublishNotice">
                      Model defaults apply when a new script plan is built. The InfiniteTalk backend applies to InfiniteTalk shots at render time.
                    </div>
                  </div>
                </div>
              </section>

              <section className="settingsGroup">
                <div className="settingsGroupHeader">
                  <span className="eyebrow">Automation</span>
                  <h3>Manual / Auto Workflow</h3>
                </div>
                <div className="workPanel">
                  <div className="automationPresetRow">
                    {automationPresets.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        className="secondaryButton"
                        onClick={() => applyAutomationPreset(preset.values)}
                      >
                        <WandSparkles size={15} />
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <div className="automationStageGrid">
                    {automationControls.map(({ key, label, phase, description, icon: Icon }) => {
                      const enabled = Boolean(activeAutomation[key]);
                      return (
                        <article key={key} className={`automationStageCard ${enabled ? "auto" : "manual"}`}>
                          <div className="automationStageTop">
                            <div className="automationStageIcon">
                              <Icon size={17} />
                            </div>
                            <div>
                              <span>{phase}</span>
                              <strong>{label}</strong>
                            </div>
                            <button
                              type="button"
                              className={`automationModeSwitch ${enabled ? "auto" : "manual"}`}
                              onClick={() => updateShowDraft(["automation", key], !enabled)}
                            >
                              {enabled ? "Auto" : "Manual"}
                            </button>
                          </div>
                          <p>{description}</p>
                        </article>
                      );
                    })}
                  </div>
                  <div className="manualPublishNotice">
                    Auto upload creates private YouTube uploads only. Public release and non-YouTube promotion stay manual.
                  </div>
                </div>
              </section>

              <section className="settingsGroup">
                <div className="settingsGroupHeader">
                  <span className="eyebrow">Publishing</span>
                  <h3>YouTube & Promotion Defaults</h3>
                </div>
                <div className="settingsGroupGrid">
                  <div className="workPanel">
                    <div className="panelHeader">
                      <div>
                        <span className="eyebrow">YouTube</span>
                        <h3>Publishing Defaults</h3>
                      </div>
                    </div>
                    <div className="twoColumn">
                      <Field label="YouTube privacy">
                        <input value="Private draft" readOnly />
                      </Field>
                      <Field label="Category">
                        <input
                          value={showDraft.platforms.youtube.categoryId}
                          onChange={(event) => updateShowDraft(["platforms", "youtube", "categoryId"], event.target.value)}
                        />
                      </Field>
                    </div>
                    <Field label="Default tags">
                      <input
                        value={(showDraft.platforms.youtube.defaultTags || []).join(", ")}
                        onChange={(event) =>
                          updateShowDraft(
                            ["platforms", "youtube", "defaultTags"],
                            event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean)
                          )
                        }
                      />
                    </Field>
                    <Field label="Recurring hashtags">
                      <input
                        value={(showDraft.creative.recurringHashtags || []).join(", ")}
                        onChange={(event) =>
                          updateShowDraft(
                            ["creative", "recurringHashtags"],
                            event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean)
                          )
                        }
                      />
                    </Field>
                  </div>

                  <div className="workPanel promotionTemplatePanel">
                    <div className="panelHeader">
                      <div>
                        <span className="eyebrow">Promotion</span>
                        <h3>Reusable Templates</h3>
                      </div>
                    </div>
                    <div className="templateTokenHint">
                      Tokens: {"{{title}}"}, {"{{hook}}"}, {"{{youtube_url}}"}, {"{{show}}"}, {"{{hashtags}}"}, {"{{cta}}"}
                    </div>
                    <div className="promotionTemplateGrid">
                      {promotionTemplateFields.map((field) => (
                        <Field key={field.key} label={field.label}>
                          <textarea
                            value={promotionTemplates[field.key] || ""}
                            rows={field.rows}
                            onChange={(event) =>
                              updateShowDraft(["platforms", "social", "templates", field.key], event.target.value)
                            }
                          />
                        </Field>
                      ))}
                    </div>
                  </div>
                </div>
              </section>

              <section className="settingsGroup">
                <div className="settingsGroupHeader">
                  <span className="eyebrow">Creative & Connections</span>
                  <h3>Style Rules & Provider Status</h3>
                </div>
                <div className="settingsGroupGrid">
                  <div className="workPanel">
                    <div className="panelHeader">
                      <div>
                        <span className="eyebrow">Creative</span>
                        <h3>Rules</h3>
                      </div>
                    </div>
                    <Field label="Visual style">
                      <textarea
                        value={showDraft.creative.visualStyle}
                        onChange={(event) => updateShowDraft(["creative", "visualStyle"], event.target.value)}
                        rows={4}
                      />
                    </Field>
                    <Field label="Thumbnail style">
                      <textarea
                        value={showDraft.creative.thumbnailStyle}
                        onChange={(event) => updateShowDraft(["creative", "thumbnailStyle"], event.target.value)}
                        rows={4}
                      />
                    </Field>
                    <Field label="Default CTA">
                      <input
                        value={showDraft.creative.defaultCta}
                        onChange={(event) => updateShowDraft(["creative", "defaultCta"], event.target.value)}
                      />
                    </Field>
                  </div>

                  <div className="workPanel">
                    <div className="panelHeader">
                      <div>
                        <span className="eyebrow">Connections</span>
                        <h3>Provider Status</h3>
                      </div>
                    </div>
                    <div className="connectionStatusGrid">
                      {integrationSetupRows.map((row) => {
                        const configured = Boolean(integrations[row.key]);
                        return (
                          <article key={row.key} className={`connectionStatus ${configured ? "ready" : ""}`}>
                            <div>
                              <span>{row.label}</span>
                              <p>{row.purpose}</p>
                            </div>
                            <div>
                              <strong>{configured ? "connected" : "not set"}</strong>
                              <code>{row.env}</code>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </div>

                  <RuntimeStatusPanel
                    health={health}
                    busy={busy}
                    busyAction={busyAction}
                    onRefresh={() => refreshHealthStatus()}
                    onRestartNewtBuilder={restartNewtBuilderServer}
                    onRestartComfyUi={restartComfyUiServer}
                  />
                </div>
              </section>
            </div>
          </section>
        )}

        {workspaceView && activeTab === "approvals" && (
          <section className="approvalsView">
            <div className="editorBand">
              <div>
                <span className="eyebrow">Review Gates</span>
                <h3>{activeEpisode?.title || "No episode selected"}</h3>
              </div>
            </div>
            <AutomationRunbookPanel
              automation={activeAutomation}
              safety={safety}
              approvals={approvals}
              open={savedPanelOpen(uiPanelState, "approvals.automationRunbook")}
              onOpenChange={(isOpen) => updateEpisodePanelOpen("approvals.automationRunbook", isOpen)}
              onApprove={setApproval}
            />
            <FinalReviewPanel
              episodeId={activeEpisode?.id || ""}
              episodeTitle={activeEpisode?.title || episodeDraft?.title || ""}
              episodeDescription={episodePublishDescription}
              audioOutput={audioOutput}
              previewOutput={previewOutput}
              finalOutput={finalOutput}
              baseFinalOutput={baseFinalOutput}
              finishedMasterOutput={finishedMasterOutput}
              previewOutputs={previewOutputs}
              finalOutputs={finalOutputs}
              finishedMasterOutputs={finishedMasterOutputs}
              manifestOutputs={manifestOutputs}
              finalManifestOutputs={finalManifestOutputs}
              audioOutputs={audioOutputs}
              finalAudioOutputs={finalAudioOutputs}
              reportOutputs={reportOutputs}
              packageOutputs={packageOutputs}
              thumbnailOutputs={thumbnailOutputs}
              drafts={drafts}
              panelState={uiPanelState}
              onPanelOpenChange={updateEpisodePanelOpen}
              selectedFormat={selectedFormat}
              socialConfig={campaignConfig}
              integrations={integrations}
              youtubeAuth={youtubeAuth}
              safety={safety}
              launchReadiness={launchReadiness}
              generationProgress={activeGenerationProgress}
              hasProductionMap={productionMap.length > 0}
              readiness={renderReadiness}
              canBuildPreview={previewBuildReady}
              canRenderFinal={finalRenderReady}
              busy={busy}
              busyAction={busyAction}
              onRebuildAudio={rebuildAudioMix}
              onRegenerateAudio={regenerateAllAudio}
              onBuildPreview={runPipeline}
              onRebuildFinal={() => renderFinalEpisode({ regenerateVideos: false })}
              onRenderFinal={renderFinalEpisode}
              onUploadFinishingLayers={uploadFinishingLayerFiles}
              onSaveFinishingLayers={saveFinishingLayers}
              onExportFinishedMaster={exportFinishedMaster}
              onGenerateFinishingMusic={generateFinishingMusic}
              onGenerateFinishingLaughTrack={generateFinishingLaughTrack}
              onGenerateFinishingApplauseTrack={generateFinishingApplauseTrack}
              onGenerateThumbnails={generateThumbnails}
              onSelectThumbnail={selectThumbnail}
              onSavePublishingDraft={savePublishingDraft}
              onExportPackage={exportFinalPackage}
              onCheckLaunchReadiness={checkLaunchReadiness}
              onUploadYoutubeDraft={uploadYoutubeDraft}
              onRetryYoutubeThumbnail={retryYoutubeThumbnail}
              onCheckYoutubeStatus={checkYoutubeStatus}
              onConnectYoutube={connectYoutube}
              youtubeUploadOutputs={youtubeUploadOutputs}
            />
            <div className="jobLog">
              {(activeEpisode?.jobLog || []).slice(0, 25).map((item) => (
                <p key={item.id}>
                  <span>{new Date(item.at).toLocaleTimeString()}</span>
                  {item.message}
                </p>
              ))}
            </div>
          </section>
        )}
      </main>

      <footer className="statusbar">
        {activeGenerationProgress ? (
          <div className={`footerGenerationProgress ${activeGenerationProgress.status || ""}`}>
            <span>{generationProgressTitle(activeGenerationProgress)}</span>
            <div className="footerProgressBar">
              <i style={{ width: `${Math.max(generationProgressPercent(activeGenerationProgress) || 4, generationProgressIsActive(activeGenerationProgress) ? 8 : 100)}%` }} />
            </div>
          </div>
        ) : null}
        <div className="statusText">
          {busy ? <RefreshCw className="spin" size={16} /> : <BadgeCheck size={16} />}
          <span>{status || "Ready."}</span>
        </div>
      </footer>

      {maskEditorLine && (
        <MaskEditorModal
          line={maskEditorLine}
          imageAsset={maskEditorImage}
          maskAsset={maskEditorMask}
          busy={busy}
          onClose={() => setMaskEditorLineId("")}
          onSave={saveDrawnMask}
          onClear={clearLineMask}
        />
      )}
    </div>
  );
}

function Metric({ icon: Icon, label, value }) {
  return (
    <div className="metric">
      <Icon size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function RuntimeStatusPanel({
  health,
  busy,
  busyAction,
  onRefresh,
  onRestartNewtBuilder,
  onRestartComfyUi
}) {
  const comfyUi = health?.comfyUi || {};
  const apiReady = Boolean(health?.ok);
  const comfyReady = Boolean(comfyUi.reachable);
  const apiLabel = apiReady ? "running" : "unknown";
  const comfyLabel = comfyReady ? "running" : comfyUi.autoStartEnabled ? "auto-start ready" : "offline";
  const newtBusy = busyAction === "restart-newtbuilder";
  const comfyBusy = busyAction === "restart-comfyui";

  return (
    <div className="workPanel runtimeStatusPanel">
      <div className="panelHeader">
        <div>
          <span className="eyebrow">Runtime</span>
          <h3>Server Status</h3>
        </div>
        <button className="secondaryButton" type="button" onClick={onRefresh} disabled={busy}>
          <RefreshCw size={16} />
          Refresh Status
        </button>
      </div>
      <div className="runtimeStatusGrid">
        <article className={`connectionStatus ${apiReady ? "ready" : ""}`}>
          <div>
            <span>NewtBuilder backend</span>
            <p>{health?.server?.baseUrl || "API health endpoint"}</p>
          </div>
          <div>
            <strong>{apiLabel}</strong>
            <code>{health?.dataDirectory || "data path unavailable"}</code>
          </div>
        </article>
        <article className={`connectionStatus ${comfyReady ? "ready" : ""}`}>
          <div>
            <span>ComfyUI backend</span>
            <p>{comfyUi.baseUrl || "COMFYUI_BASE_URL not resolved"}</p>
          </div>
          <div>
            <strong>{comfyLabel}</strong>
            <code>{comfyUi.workflow || comfyUi.error || "workflow not configured"}</code>
          </div>
        </article>
      </div>
      <div className="buttonRow">
        <button className="secondaryButton" type="button" onClick={onRestartNewtBuilder} disabled={busy}>
          {newtBusy ? <RefreshCw className="spin" size={16} /> : <Power size={16} />}
          Reboot NewtBuilder
        </button>
        <button className="secondaryButton" type="button" onClick={onRestartComfyUi} disabled={busy}>
          {comfyBusy ? <RefreshCw className="spin" size={16} /> : <Server size={16} />}
          Reboot ComfyUI
        </button>
      </div>
    </div>
  );
}

function CollapsiblePanel({
  className = "",
  eyebrow,
  title,
  action = null,
  children,
  defaultOpen = false,
  resetKey = "",
  onOpenChange
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  useEffect(() => {
    setIsOpen(defaultOpen);
  }, [defaultOpen, resetKey]);

  function toggleOpen() {
    setIsOpen((value) => {
      const next = !value;
      onOpenChange?.(next);
      return next;
    });
  }

  return (
    <section className={`workPanel collapsiblePanel ${isOpen ? "open" : "closed"} ${className}`}>
      <div className="panelHeader collapsibleHeader">
        <button
          type="button"
          className="collapseTitle"
          onClick={toggleOpen}
          aria-expanded={isOpen}
        >
          <ChevronRight size={18} className={isOpen ? "open" : ""} />
          <div>
            <span className="eyebrow">{eyebrow}</span>
            <h3>{title}</h3>
          </div>
        </button>
        {action}
      </div>
      {isOpen && <div className="collapsibleBody">{children}</div>}
    </section>
  );
}

function RenderReadinessPanel({ readiness, open = false, onOpenChange }) {
  const setupChecks = readiness.checks.filter((check) => check.group === "setup");
  const reviewChecks = readiness.checks.filter((check) => check.group === "review");

  return (
    <details className="reviewDetails readinessPanel" open={open} onToggle={(event) => onOpenChange?.(event.currentTarget.open)}>
      <summary>
        <span>Preflight Checklist</span>
        <Pill tone={readiness.tone}>{readiness.label}</Pill>
      </summary>

      <div className="readinessColumns">
        <div>
          <h4>Setup</h4>
          <div className="readinessGrid">
            {setupChecks.map((check) => (
              <ReadinessItem key={check.id} check={check} />
            ))}
          </div>
        </div>
        <div>
          <h4>Review</h4>
          <div className="readinessGrid">
            {reviewChecks.map((check) => (
              <ReadinessItem key={check.id} check={check} />
            ))}
          </div>
        </div>
      </div>
    </details>
  );
}

function ReadinessItem({ check }) {
  const isReady = check.status === "pass";
  return (
    <div className={`readinessItem ${check.status}`}>
      <div className="readinessIcon">{isReady ? <Check size={16} /> : <CircleAlert size={16} />}</div>
      <div>
        <strong>{check.label}</strong>
        <span>{check.detail}</span>
      </div>
      <Pill tone={readinessTone(check.status)}>{isReady ? "ready" : check.status}</Pill>
    </div>
  );
}

function defaultThumbnailBrief({ drafts = {}, selectedFormat = {} }) {
  const aspect = selectedFormat.aspectRatio === "9:16" ? "9x16" : "16x9";
  const superText = drafts.youtube?.title || "New Episode";
  const details = [drafts.youtube?.description, (drafts.youtube?.tags || []).join(" ")]
    .filter(Boolean)
    .join("\n\n")
    .trim();
  const defaults = {
    superText,
    prompt: `Create a ${aspect} YouTube thumbnail that includes the selected still frame, a dynamic super, and the provided episode information.`,
    details,
    stillFrame: "middle"
  };
  const saved = drafts.thumbnailBrief && typeof drafts.thumbnailBrief === "object" ? drafts.thumbnailBrief : {};
  const hasSavedText = ["superText", "prompt", "details"].some((key) => String(saved[key] || "").trim());
  return hasSavedText ? { ...defaults, ...saved } : defaults;
}

function visibleThumbnailCandidates(outputs = []) {
  const aiOutputs = outputs.filter(
    (output) => String(output.provider || "").includes("gpt-image") || String(output.fileName || "").includes("-ai.")
  );
  return (aiOutputs.length ? aiOutputs : outputs).slice(0, 3);
}

function AutomationRunbookPanel({ automation = {}, safety = {}, approvals = [], open = false, onOpenChange, onApprove }) {
  const autoStages = automationControls.filter((stage) => automation[stage.key]);
  const privateUploadActive = Boolean(automation.uploadYoutube);
  const approvalGates = (Array.isArray(approvals) ? approvals : []).filter((gate) =>
    ["script_plan", "voice_audio", "render_preview"].includes(gate.id)
  );

  return (
    <details
      className="reviewDetails automationRunbookPanel"
      open={open}
      onToggle={(event) => onOpenChange?.(event.currentTarget.open)}
    >
      <summary>
        <span>Automation Runbook</span>
        <Pill tone={autoStages.length ? "good" : "neutral"}>{autoStages.length} auto</Pill>
      </summary>
      <div className="automationRunbookBody">
        {approvalGates.length ? (
          <div className="approvalStack automationApprovalGates">
            {approvalGates.map((gate) => (
              <ApprovalGate key={gate.id} gate={gate} onApprove={onApprove} />
            ))}
          </div>
        ) : null}
        <div className="automationRunbookGrid">
          {automationControls.map(({ key, label, phase, icon: Icon }) => {
            const enabled = Boolean(automation[key]);
            return (
              <article key={key} className={`automationRunbookItem ${enabled ? "auto" : "manual"}`}>
                <Icon size={16} />
                <div>
                  <span>{phase}</span>
                  <strong>{label}</strong>
                </div>
                <Pill tone={enabled ? "good" : "neutral"}>{enabled ? "auto" : "manual"}</Pill>
              </article>
            );
          })}
        </div>
        <div className="manualPublishNotice">
          {privateUploadActive
            ? "YouTube automation can upload privately only. Public publishing still requires the manual handoff checklist."
            : "YouTube upload is manual. Use YouTube Publish after final render and thumbnail selection."}
        </div>
        {safety.publishingEnabled ? (
          <div className="manualPublishNotice warning">
            Publishing mode is enabled. Current safety boundary: private YouTube uploads only.
          </div>
        ) : null}
      </div>
    </details>
  );
}

function RenderGenerationPanel({ manifestOutput, manifestEntry, open = false, onOpenChange }) {
  const detailsProps = {
    className: "renderGenerationPanel",
    open,
    onToggle: (event) => onOpenChange?.(event.currentTarget.open)
  };

  if (!manifestOutput) {
    return (
      <details {...detailsProps}>
        <summary className="renderGenerationSummary">
          <ChevronRight className="renderGenerationChevron" size={17} aria-hidden="true" />
          <div className="renderGenerationTitle">
            <span className="eyebrow">Generation Used</span>
            <strong>No final manifest found</strong>
          </div>
          <Pill tone="warn">missing</Pill>
        </summary>
        <p>No render manifest is linked to this final video.</p>
      </details>
    );
  }

  if (!manifestEntry || manifestEntry.status === "loading") {
    return (
      <details {...detailsProps}>
        <summary className="renderGenerationSummary">
          <ChevronRight className="renderGenerationChevron" size={17} aria-hidden="true" />
          <div className="renderGenerationTitle">
            <span className="eyebrow">Generation Used</span>
            <strong>Loading render manifest</strong>
          </div>
          <RefreshCw className="spin renderRunningIcon" size={16} aria-label="Loading render manifest" />
        </summary>
      </details>
    );
  }

  if (manifestEntry.status === "error") {
    return (
      <details {...detailsProps}>
        <summary className="renderGenerationSummary">
          <ChevronRight className="renderGenerationChevron" size={17} aria-hidden="true" />
          <div className="renderGenerationTitle">
            <span className="eyebrow">Generation Used</span>
            <strong>Manifest unavailable</strong>
          </div>
          <Pill tone="warn">error</Pill>
        </summary>
        <p>{manifestEntry.error || "Unable to load this render manifest."}</p>
      </details>
    );
  }

  const summary = renderGenerationSummary(manifestEntry.manifest);
  if (!summary) return null;

  return (
    <details {...detailsProps}>
      <summary className="renderGenerationSummary">
        <ChevronRight className="renderGenerationChevron" size={17} aria-hidden="true" />
        <div className="renderGenerationTitle">
          <span className="eyebrow">Generation Used</span>
          <strong>{summary.modelSummary}</strong>
        </div>
        <Pill tone={summary.warnings.length ? "warn" : "good"}>
          {summary.warnings.length ? `${summary.warnings.length} warning${summary.warnings.length === 1 ? "" : "s"}` : "recorded"}
        </Pill>
      </summary>
      <div className="renderGenerationBody">
        <div className="renderGenerationStats">
          <span>
            <strong>Format</strong>
            {summary.formatLabel}
          </span>
          <span>
            <strong>Audio</strong>
            {summary.audioLabel}
          </span>
          <span>
            <strong>Runtime</strong>
            {summary.totalLabel}
          </span>
          <span>
            <strong>Created</strong>
            {dateTimeLabel(summary.createdAt)}
          </span>
        </div>
        <div className="renderLineModelGrid">
          {summary.lines.map((line) => (
            <article key={`${line.index}-${line.providerLabel}-${line.model}`} className="renderLineModel">
              <div className="renderLineModelHeader">
                <strong>Line {line.index}{line.speaker ? ` - ${line.speaker}` : ""}</strong>
                <Pill tone={line.generatedClip ? "good" : "neutral"}>{line.providerLabel}</Pill>
              </div>
              <p>{line.model || line.source || "No generated model clip recorded"}</p>
              <span>{[line.shotRole, line.imageName].filter(Boolean).join(" - ") || "No source asset recorded"}</span>
              {line.providerOptions ? <span>{line.providerOptions}</span> : null}
              {line.generatedAt ? <span>Generated {dateTimeLabel(line.generatedAt)}</span> : null}
              {line.prompt ? <small>{clampCopy(line.prompt, 260)}</small> : null}
              {line.warning ? <small className="warningText">{line.warning}</small> : null}
            </article>
          ))}
        </div>
      </div>
    </details>
  );
}

function FinalOutputLink({ video, index, finalOutputs, finalManifestOutputs, manifestCache }) {
  const manifestOutput = finalManifestForReviewOutput(video, finalOutputs, finalManifestOutputs);
  const manifestEntry = manifestOutput?.localUrl ? manifestCache[manifestOutput.localUrl] : null;
  const summary = renderGenerationSummary(manifestEntry?.manifest);
  const summaryText =
    summary?.modelSummary ||
    (manifestEntry?.status === "loading" ? "Loading generation details" : "No generation details");

  return (
    <a className="outputLinkWithMeta" href={video.localUrl} target="_blank" rel="noreferrer">
      <Film size={16} />
      <span>
        <strong>Final #{index + 1}</strong>
        <small>{video.name}</small>
        <em>{summaryText}</em>
      </span>
    </a>
  );
}

function FinalReviewPanel({
  episodeId,
  episodeTitle,
  episodeDescription,
  audioOutput,
  previewOutput,
  finalOutput,
  baseFinalOutput,
  finishedMasterOutput,
  previewOutputs,
  finalOutputs,
  finishedMasterOutputs = [],
  manifestOutputs,
  finalManifestOutputs,
  audioOutputs,
  finalAudioOutputs,
  reportOutputs,
  packageOutputs,
  youtubeUploadOutputs = [],
  thumbnailOutputs,
  drafts,
  panelState = {},
  onPanelOpenChange,
  selectedFormat,
  socialConfig,
  integrations,
  youtubeAuth,
  safety,
  launchReadiness,
  generationProgress,
  hasProductionMap,
  readiness,
  canBuildPreview,
  canRenderFinal,
  busy,
  busyAction,
  onRebuildAudio,
  onRegenerateAudio,
  onBuildPreview,
  onRebuildFinal,
  onRenderFinal,
  onUploadFinishingLayers,
  onSaveFinishingLayers,
  onExportFinishedMaster,
  onGenerateFinishingMusic,
  onGenerateFinishingLaughTrack,
  onGenerateFinishingApplauseTrack,
  onGenerateThumbnails,
  onSelectThumbnail,
  onSavePublishingDraft,
  onExportPackage,
  onCheckLaunchReadiness,
  onUploadYoutubeDraft,
  onRetryYoutubeThumbnail,
  onCheckYoutubeStatus,
  onConnectYoutube
}) {
  const hasOutputs =
    finalOutputs.length ||
    finishedMasterOutputs.length ||
    previewOutputs.length ||
    finalManifestOutputs.length ||
    manifestOutputs.length ||
    finalAudioOutputs.length ||
    audioOutputs.length ||
    packageOutputs.length ||
    youtubeUploadOutputs.length ||
    thumbnailOutputs.length ||
    reportOutputs.length;
  const outputCount =
    finalOutputs.length +
    finishedMasterOutputs.length +
    previewOutputs.length +
    finalManifestOutputs.length +
    manifestOutputs.length +
    finalAudioOutputs.length +
    audioOutputs.length +
    packageOutputs.length +
    youtubeUploadOutputs.length +
    thumbnailOutputs.length +
    reportOutputs.length;
  const renderBusy =
    busyAction === "rebuild-audio" ||
    busyAction === "regenerate-audio" ||
    busyAction === "build-preview" ||
    busyAction === "rebuild-final" ||
    busyAction === "render-final";
  const thumbnailBusy = busyAction === "thumbnails";
  const progressPercent = generationProgressPercent(generationProgress);
  const showGenerationProgress = Boolean(generationProgress && (renderBusy || busyAction?.startsWith("dialogue-video:") || generationProgressIsActive(generationProgress)));
  const selectedThumbnailId = drafts.selectedThumbnailOutputId || thumbnailOutputs.find((thumb) => thumb.isSelected)?.id || "";
  const selectedThumbnail = thumbnailOutputs.find((thumb) => thumb.id === selectedThumbnailId) || null;
  const latestPackage = packageOutputs[0] || null;
  const latestYoutubeUpload = youtubeUploadOutputs[0] || null;
  const packageReady = Boolean(finalOutput && selectedThumbnail);
  const savedThumbnailBrief = drafts.thumbnailBrief && typeof drafts.thumbnailBrief === "object" ? drafts.thumbnailBrief : {};
  const youtubeTagsKey = Array.isArray(drafts.youtube?.tags) ? drafts.youtube.tags.join("|") : "";
  const thumbnailBriefDefaults = useMemo(
    () => defaultThumbnailBrief({ drafts, selectedFormat }),
    [
      selectedFormat.aspectRatio,
      drafts.youtube?.title,
      drafts.youtube?.description,
      youtubeTagsKey,
      savedThumbnailBrief.superText,
      savedThumbnailBrief.prompt,
      savedThumbnailBrief.details,
      savedThumbnailBrief.stillFrame
    ]
  );
  const [thumbnailBrief, setThumbnailBrief] = useState(thumbnailBriefDefaults);
  const [reviewVideoMode, setReviewVideoMode] = useState("auto");
  const [reviewRefreshToken, setReviewRefreshToken] = useState(0);
  const [finalReviewIndex, setFinalReviewIndex] = useState(0);
  const [loadedReviewDimensions, setLoadedReviewDimensions] = useState(null);
  const [finalManifestCache, setFinalManifestCache] = useState({});

  const finalReviewOutputs = useMemo(
    () => [...finishedMasterOutputs, ...finalOutputs].sort((a, b) => outputCreatedAtValue(b) - outputCreatedAtValue(a)),
    [finishedMasterOutputs, finalOutputs]
  );
  const finalManifestKey = useMemo(
    () => finalManifestOutputs.map((output) => output.localUrl).filter(Boolean).join("|"),
    [finalManifestOutputs]
  );
  const maxFinalReviewIndex = Math.max(0, finalReviewOutputs.length - 1);
  const selectedFinalIndex = Math.min(finalReviewIndex, maxFinalReviewIndex);
  const selectedFinalOutput = finalReviewOutputs[selectedFinalIndex] || finalOutput;

  const selectedReviewMode =
    reviewVideoMode === "preview" && previewOutput
      ? "preview"
      : reviewVideoMode === "final" && selectedFinalOutput
        ? "final"
        : selectedFinalOutput
          ? "final"
          : previewOutput
            ? "preview"
            : "none";
  const reviewVideo = selectedReviewMode === "preview" ? previewOutput : selectedReviewMode === "final" ? selectedFinalOutput : null;
  const reviewVideoToken = [selectedReviewMode, reviewVideo?.id, reviewVideo?.createdAt, reviewRefreshToken]
    .filter(Boolean)
    .join("-");
  const reviewVideoUrl = cacheBustedUrl(reviewVideo?.localUrl, reviewVideoToken);
  const reviewDimensionFormat = {
    ...selectedFormat,
    aspectRatio: reviewVideo?.aspectRatio || selectedFormat.aspectRatio,
    resolution: reviewVideo?.resolution || selectedFormat.resolution,
    width: Number(reviewVideo?.width) > 0 ? reviewVideo.width : selectedFormat.width,
    height: Number(reviewVideo?.height) > 0 ? reviewVideo.height : selectedFormat.height
  };
  const metadataDimensions = loadedReviewDimensions?.token === reviewVideoToken ? loadedReviewDimensions : null;
  const reviewDimensions = formatDimensions({
    ...reviewDimensionFormat,
    width: metadataDimensions?.width || reviewDimensionFormat.width,
    height: metadataDimensions?.height || reviewDimensionFormat.height
  });
  const reviewDisplayScale = 0.5;
  const reviewDisplayDimensions = {
    width: Math.max(1, Math.round(reviewDimensions.width * reviewDisplayScale)),
    height: Math.max(1, Math.round(reviewDimensions.height * reviewDisplayScale))
  };
  const reviewDimensionLabel = `${reviewDisplayDimensions.width} x ${reviewDisplayDimensions.height} (50% of ${reviewDimensions.width} x ${reviewDimensions.height})`;
  const reviewVideoStyle = {
    width: `${reviewDisplayDimensions.width}px`,
    height: `${reviewDisplayDimensions.height}px`,
    maxWidth: "none",
    maxHeight: "none",
    aspectRatio: `${reviewDisplayDimensions.width} / ${reviewDisplayDimensions.height}`
  };
  const reviewViewportStyle = {
    width: `${reviewDisplayDimensions.width}px`,
    height: `${reviewDisplayDimensions.height}px`,
    minWidth: `${reviewDisplayDimensions.width}px`,
    minHeight: `${reviewDisplayDimensions.height}px`,
    maxWidth: "none",
    maxHeight: "none",
    aspectRatio: `${reviewDisplayDimensions.width} / ${reviewDisplayDimensions.height}`
  };
  const finalReviewCountLabel =
    selectedReviewMode === "final" && finalReviewOutputs.length > 1
      ? ` - final ${selectedFinalIndex + 1}/${finalReviewOutputs.length}`
      : "";
  const selectedReviewManifestOutput =
    selectedReviewMode === "final"
      ? finalManifestForReviewOutput(selectedFinalOutput, finalOutputs, finalManifestOutputs)
      : null;
  const selectedReviewManifestEntry = selectedReviewManifestOutput?.localUrl
    ? finalManifestCache[selectedReviewManifestOutput.localUrl]
    : null;

  useEffect(() => {
    setThumbnailBrief(thumbnailBriefDefaults);
  }, [episodeId, thumbnailBriefDefaults]);

  useEffect(() => {
    const urls = finalManifestOutputs.map((output) => output.localUrl).filter(Boolean);
    if (!urls.length) return undefined;
    let cancelled = false;

    setFinalManifestCache((prev) => {
      const next = { ...prev };
      for (const url of urls) {
        if (!next[url]?.manifest) next[url] = { status: "loading", manifest: null, error: "" };
      }
      return next;
    });

    Promise.all(
      urls.map(async (url) => {
        try {
          const response = await fetch(`${API}${url}`);
          if (!response.ok) throw new Error(`Manifest request failed: ${response.status}`);
          return [url, { status: "ready", manifest: await response.json(), error: "" }];
        } catch (error) {
          return [url, { status: "error", manifest: null, error: error?.message || "Unable to load manifest." }];
        }
      })
    ).then((entries) => {
      if (cancelled) return;
      setFinalManifestCache((prev) => {
        const next = { ...prev };
        for (const [url, entry] of entries) next[url] = entry;
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [finalManifestKey]);

  useEffect(() => {
    setFinalReviewIndex((index) => Math.min(index, Math.max(0, finalReviewOutputs.length - 1)));
  }, [finalReviewOutputs.length]);

  useEffect(() => {
    setLoadedReviewDimensions(null);
  }, [reviewVideoToken]);

  useEffect(() => {
    if (reviewVideoMode === "preview" && !previewOutput) setReviewVideoMode("auto");
    if (reviewVideoMode === "final" && !selectedFinalOutput) setReviewVideoMode("auto");
  }, [selectedFinalOutput, previewOutput, reviewVideoMode]);

  const updateThumbnailBrief = (key, value) => {
    setThumbnailBrief((prev) => ({ ...prev, [key]: value }));
  };

  async function handleSaveThumbnailBrief() {
    await onSavePublishingDraft?.({ thumbnailBrief });
  }

  async function handleBuildPreview() {
    setReviewVideoMode("preview");
    setReviewRefreshToken((value) => value + 1);
    await onBuildPreview();
    setReviewRefreshToken((value) => value + 1);
  }

  async function handleRenderFinal() {
    setReviewVideoMode("final");
    setFinalReviewIndex(0);
    setReviewRefreshToken((value) => value + 1);
    await onRenderFinal({ regenerateVideos: true });
    setFinalReviewIndex(0);
    setReviewRefreshToken((value) => value + 1);
  }

  async function handleRebuildFinal() {
    setReviewVideoMode("final");
    setFinalReviewIndex(0);
    setReviewRefreshToken((value) => value + 1);
    await onRebuildFinal();
    setFinalReviewIndex(0);
    setReviewRefreshToken((value) => value + 1);
  }

  function handleReviewVideoMetadata(event) {
    const width = Number(event.currentTarget.videoWidth);
    const height = Number(event.currentTarget.videoHeight);
    if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
      setLoadedReviewDimensions({
        token: reviewVideoToken,
        width: Math.round(width),
        height: Math.round(height)
      });
    }
  }

  function handleSavedPanelToggle(panelKey, event) {
    onPanelOpenChange?.(panelKey, event.currentTarget.open);
  }

  return (
    <div className="finalReviewPanel">
      <details
        className="reviewDetails renderControlPanel"
        open={savedPanelOpen(panelState, "approvals.renderControl")}
        onToggle={(event) => handleSavedPanelToggle("approvals.renderControl", event)}
      >
        <summary>
          <span className="summaryTitleWithIcon">
            Render Control
            {renderBusy ? <RefreshCw className="spin renderRunningIcon" size={16} aria-label="Render running" /> : null}
          </span>
          <Pill tone={finalOutput ? "good" : integrations.youtube ? "good" : "neutral"}>
            {finalOutput ? "final ready" : integrations.youtube ? "YouTube linked" : "Local draft"}
          </Pill>
        </summary>
        <div className="renderControlBody">
      <div className="renderCommandBar">
        <Pill tone={finalOutput ? "good" : integrations.youtube ? "good" : "neutral"}>
          {finalOutput ? "final ready" : integrations.youtube ? "YouTube linked" : "Local draft"}
        </Pill>
        <div className="buttonRow">
          <button className="secondaryButton" onClick={onRebuildAudio} disabled={!hasProductionMap || busy}>
            <RefreshCw size={16} />
            Rebuild Audio
          </button>
          <button
            className="secondaryButton"
            onClick={onRegenerateAudio}
            disabled={!hasProductionMap || busy}
            title="Regenerate every dialogue audio line and rebuild the audio review mix"
          >
            <RefreshCw size={16} />
            Regenerate Audio
          </button>
          <button
            className="secondaryButton"
            onClick={handleBuildPreview}
            disabled={!canBuildPreview || busy}
            title={canBuildPreview ? "Create or refresh the local preview" : readiness.setupReady ? "Select an episode first" : "Clear the Render Readiness setup checks first"}
          >
            <Play size={17} />
            Build Preview
          </button>
          <button
            className="secondaryButton"
            onClick={handleRebuildFinal}
            disabled={!canRenderFinal || busy}
            title={canRenderFinal ? "Reuse existing shot videos, generate only missing clips, remix audio, and rebuild the final render" : "Complete the Render Readiness setup checks first"}
          >
            <RefreshCw size={17} />
            Rebuild Final
          </button>
          <button
            className="runButton"
            onClick={handleRenderFinal}
            disabled={!canRenderFinal || busy}
            title={canRenderFinal ? "Regenerate all dialogue shot videos from the current audio, remix audio, and create the final render" : "Complete the Render Readiness setup checks first"}
          >
            <Film size={17} />
            Render Final
          </button>
        </div>
      </div>

      {showGenerationProgress ? (
        <div className={`generationProgress ${generationProgress?.status || ""}`}>
          <div className="generationProgressHeader">
            <div>
              <span className="eyebrow">ComfyUI Progress</span>
              <strong>{generationProgressTitle(generationProgress)}</strong>
            </div>
            <span>{progressPercent > 0 ? `${progressPercent}%` : generationProgress?.status || "running"}</span>
          </div>
          <div className="generationProgressBar" aria-label={generationProgressTitle(generationProgress)}>
            <span style={{ width: `${Math.max(progressPercent || 4, generationProgressIsActive(generationProgress) ? 8 : 100)}%` }} />
          </div>
          <p>{generationProgressDetail(generationProgress)}</p>
        </div>
      ) : null}

      <div className={`finalReviewGrid ${reviewVideo ? "" : "audioOnly"}`}>
        <div className="finalAudioCard">
          <div className="audioReviewHeader">
            <div>
              <span className="eyebrow">Audio Preview</span>
              <strong>{audioOutput?.name || "No mix yet"}</strong>
            </div>
          </div>
          {audioOutput?.localUrl ? (
            <audio controls preload="metadata" src={audioOutput.localUrl} />
          ) : (
            <div className="emptyState compact">No audio preview yet.</div>
          )}
        </div>

        {reviewVideo && (
          <div className="previewBlock">
            <div className="previewCanvas">
              <div
                className="previewViewport"
                aria-label={`Video displayed at ${reviewDimensionLabel}`}
                style={reviewViewportStyle}
              >
                <video
                  key={reviewVideoToken}
                  src={reviewVideoUrl}
                  width={reviewDisplayDimensions.width}
                  height={reviewDisplayDimensions.height}
                  controls
                  playsInline
                  style={reviewVideoStyle}
                  onLoadedMetadata={handleReviewVideoMetadata}
                />
              </div>
            </div>
            <div className="previewMetaRow">
              <div>
                <strong>{selectedReviewMode === "final" ? "Final local render" : "Local episode preview"}</strong>
                <p>{reviewVideo.name} - display {reviewDimensionLabel}{finalReviewCountLabel}</p>
              </div>
              <div className="previewMetaActions">
                {previewOutput && finalOutput ? (
                  <div className="segmentedControl compact">
                    <button
                      type="button"
                      className={selectedReviewMode === "preview" ? "active" : ""}
                      onClick={() => setReviewVideoMode("preview")}
                    >
                      Preview
                    </button>
                    <button
                      type="button"
                      className={selectedReviewMode === "final" ? "active" : ""}
                      onClick={() => setReviewVideoMode("final")}
                    >
                      Final
                    </button>
                  </div>
                ) : null}
                {selectedReviewMode === "final" && finalReviewOutputs.length > 1 ? (
                  <div className="finalStepControls" aria-label="Final display navigation">
                    <button
                      type="button"
                      className="quietButton iconOnly"
                      onClick={() =>
                        setFinalReviewIndex((index) => (index + finalReviewOutputs.length - 1) % finalReviewOutputs.length)
                      }
                      title="Previous final display"
                      aria-label="Previous final display"
                    >
                      <ChevronLeft size={15} />
                    </button>
                    <span>{selectedFinalIndex + 1}/{finalReviewOutputs.length}</span>
                    <button
                      type="button"
                      className="quietButton iconOnly"
                      onClick={() => setFinalReviewIndex((index) => (index + 1) % finalReviewOutputs.length)}
                      title="Next final display"
                      aria-label="Next final display"
                    >
                      <ChevronRight size={15} />
                    </button>
                  </div>
                ) : null}
                <button
                  type="button"
                  className="quietButton iconOnly"
                  onClick={() => setReviewRefreshToken((value) => value + 1)}
                  title="Reload displayed video"
                >
                  <RefreshCw size={15} />
                </button>
              </div>
            </div>
            {selectedReviewMode === "final" ? (
              <RenderGenerationPanel
                manifestOutput={selectedReviewManifestOutput}
                manifestEntry={selectedReviewManifestEntry}
                open={savedPanelOpen(panelState, "approvals.renderGeneration")}
                onOpenChange={(isOpen) => onPanelOpenChange?.("approvals.renderGeneration", isOpen)}
              />
            ) : null}
          </div>
        )}
      </div>
        </div>
      </details>

      <RenderReadinessPanel
        readiness={readiness}
        open={savedPanelOpen(panelState, "approvals.preflight")}
        onOpenChange={(isOpen) => onPanelOpenChange?.("approvals.preflight", isOpen)}
      />

      <FinishingLayersPanel
        baseFinalOutput={baseFinalOutput}
        finishedMasterOutput={finishedMasterOutput}
        layers={drafts.finishingLayers || []}
        panelState={panelState}
        open={savedPanelOpen(panelState, "approvals.finishingLayers")}
        onOpenChange={(isOpen) => onPanelOpenChange?.("approvals.finishingLayers", isOpen)}
        onPanelOpenChange={onPanelOpenChange}
        busy={busy}
        busyAction={busyAction}
        integrations={integrations}
        onUploadLayers={onUploadFinishingLayers}
        onSaveLayers={onSaveFinishingLayers}
        onExportMaster={onExportFinishedMaster}
        onGenerateMusic={onGenerateFinishingMusic}
        onGenerateLaughTrack={onGenerateFinishingLaughTrack}
        onGenerateApplauseTrack={onGenerateFinishingApplauseTrack}
      />

      <details
        className="reviewDetails thumbnailReviewPanel"
        open={savedPanelOpen(panelState, "approvals.thumbnail")}
        onToggle={(event) => handleSavedPanelToggle("approvals.thumbnail", event)}
      >
        <summary>
          <span className="summaryTitleWithIcon">
            Thumbnail
            {thumbnailBusy ? <RefreshCw className="spin renderRunningIcon" size={16} aria-label="Thumbnail generation running" /> : null}
          </span>
          <Pill tone={selectedThumbnailId ? "good" : thumbnailOutputs.length ? "neutral" : "warn"}>
            {selectedThumbnailId ? "selected" : thumbnailOutputs.length ? "ready" : "needed"}
          </Pill>
        </summary>
        <div className="thumbnailReviewBody">
          <div className="thumbnailReviewHeader">
            <button className="secondaryButton" onClick={handleSaveThumbnailBrief} disabled={busy}>
              <Save size={16} />
              Save Inputs
            </button>
            <button className="secondaryButton" onClick={() => onGenerateThumbnails(thumbnailBrief)} disabled={!reviewVideo || busy}>
              <Image size={16} />
              Generate AI Thumbnails
            </button>
          </div>
          <div className="thumbnailBriefGrid">
            <Field label="Dynamic super">
              <input
                value={thumbnailBrief.superText}
                onChange={(event) => updateThumbnailBrief("superText", event.target.value)}
                placeholder="Big readable thumbnail text"
              />
            </Field>
            <Field label="Image 2 prompt">
              <textarea
                value={thumbnailBrief.prompt}
                onChange={(event) => updateThumbnailBrief("prompt", event.target.value)}
                rows={3}
              />
            </Field>
            <Field label="Provided information">
              <textarea
                value={thumbnailBrief.details}
                onChange={(event) => updateThumbnailBrief("details", event.target.value)}
                rows={3}
                placeholder="Story hook, emotion, character moment, or thumbnail direction"
              />
            </Field>
          </div>
          {thumbnailOutputs.length ? (
            <div className="thumbnailOutputGrid">
              {thumbnailOutputs.slice(0, 6).map((thumb) => (
                <button
                  type="button"
                  className={`thumbnailOutputCard ${selectedThumbnailId === thumb.id ? "selected" : ""}`}
                  key={thumb.id}
                  onClick={() => onSelectThumbnail(thumb)}
                  disabled={busy}
                >
                  <img src={thumb.localUrl} alt="" style={mediaAspectStyle(thumb)} />
                  <span>{thumb.name || thumb.fileName}</span>
                  <strong>{selectedThumbnailId === thumb.id ? "Final thumbnail" : "Select thumbnail"}</strong>
                </button>
              ))}
            </div>
          ) : (
            <div className="emptyState compact">Build a preview or final render, then generate AI thumbnail candidates.</div>
          )}
        </div>
      </details>

      <FinalPackagePanel
        finalOutput={finalOutput}
        selectedThumbnail={selectedThumbnail}
        latestPackage={latestPackage}
        youtubeDraft={drafts.youtube || {}}
        episodeTitle={episodeTitle}
        episodeDescription={episodeDescription}
        panelState={panelState}
        open={savedPanelOpen(panelState, "approvals.youtubePublish")}
        onOpenChange={(isOpen) => onPanelOpenChange?.("approvals.youtubePublish", isOpen)}
        onPanelOpenChange={onPanelOpenChange}
        socialConfig={socialConfig}
        ready={packageReady}
        busy={busy}
        busyAction={busyAction}
        integrations={integrations}
        youtubeAuth={youtubeAuth}
        safety={safety}
        launchReadiness={launchReadiness}
        latestYoutubeUpload={latestYoutubeUpload}
        onSavePublishingDraft={onSavePublishingDraft}
        onExportPackage={onExportPackage}
        onCheckLaunchReadiness={onCheckLaunchReadiness}
        onUploadYoutubeDraft={onUploadYoutubeDraft}
        onRetryYoutubeThumbnail={onRetryYoutubeThumbnail}
        onCheckYoutubeStatus={onCheckYoutubeStatus}
        onConnectYoutube={onConnectYoutube}
      />

      {hasOutputs ? (
        <details
          className="reviewDetails"
          open={savedPanelOpen(panelState, "approvals.localOutputs")}
          onToggle={(event) => handleSavedPanelToggle("approvals.localOutputs", event)}
        >
          <summary>
            <span>Local Outputs</span>
            <Pill tone="neutral">{outputCount} files</Pill>
          </summary>
          <div className="reportList">
            {finishedMasterOutputs.slice(0, 2).map((video) => (
              <a key={video.id} href={video.localUrl} target="_blank" rel="noreferrer">
                <Film size={16} />
                <span>{video.name || "Finished master"}</span>
              </a>
            ))}
            {finalOutputs.map((video, index) => (
              <FinalOutputLink
                key={video.id}
                video={video}
                index={index}
                finalOutputs={finalOutputs}
                finalManifestOutputs={finalManifestOutputs}
                manifestCache={finalManifestCache}
              />
            ))}
            {previewOutputs.slice(0, 2).map((video) => (
              <a key={video.id} href={video.localUrl} target="_blank" rel="noreferrer">
                <Film size={16} />
                <span>{video.name}</span>
              </a>
            ))}
            {finalManifestOutputs.slice(0, 2).map((manifest) => (
              <a key={manifest.id} href={manifest.localUrl} target="_blank" rel="noreferrer">
                <ListChecks size={16} />
                <span>{manifest.name}</span>
              </a>
            ))}
            {manifestOutputs.slice(0, 2).map((manifest) => (
              <a key={manifest.id} href={manifest.localUrl} target="_blank" rel="noreferrer">
                <ListChecks size={16} />
                <span>{manifest.name}</span>
              </a>
            ))}
            {finalAudioOutputs.slice(0, 1).map((audio) => (
              <a key={audio.id} href={audio.localUrl} target="_blank" rel="noreferrer">
                <Play size={16} />
                <span>{audio.name}</span>
              </a>
            ))}
            {audioOutputs.slice(0, 1).map((audio) => (
              <a key={audio.id} href={audio.localUrl} target="_blank" rel="noreferrer">
                <Play size={16} />
                <span>{audio.name}</span>
              </a>
            ))}
            {packageOutputs.slice(0, 2).map((pkg) => (
              <a key={pkg.id} href={pkg.localUrl} target="_blank" rel="noreferrer">
                <FileText size={16} />
                <span>{pkg.name || pkg.fileName}</span>
              </a>
            ))}
            {youtubeUploadOutputs.slice(0, 2).map((upload) => (
              <a key={upload.id} href={upload.watchUrl || upload.localUrl} target="_blank" rel="noreferrer">
                <Youtube size={16} />
                <span>{upload.name || "YouTube upload"}</span>
              </a>
            ))}
            {thumbnailOutputs.slice(0, 6).map((thumb) => (
              <a key={thumb.id} href={thumb.localUrl} target="_blank" rel="noreferrer">
                <Image size={16} />
                <span>{thumb.name || thumb.fileName}</span>
              </a>
            ))}
            {reportOutputs.slice(0, 4).map((report) => (
              <a key={report.id} href={report.localUrl} target="_blank" rel="noreferrer">
                <FileText size={16} />
                <span>{report.name}</span>
              </a>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function FinishingLayersPanel({
  baseFinalOutput,
  finishedMasterOutput,
  layers = [],
  panelState = {},
  open = false,
  onOpenChange,
  onPanelOpenChange,
  busy,
  busyAction,
  integrations = {},
  onUploadLayers,
  onSaveLayers,
  onExportMaster,
  onGenerateMusic,
  onGenerateLaughTrack,
  onGenerateApplauseTrack
}) {
  const imageVideoInputRef = useRef(null);
  const audioInputRef = useRef(null);
  const programVideoRef = useRef(null);
  const finishingPanelRef = useRef(null);
  const audioPreviewRefs = useRef(new Map());
  const resumePreviewAfterSeekRef = useRef(false);
  const seekResumeTimerRef = useRef(null);
  const layersKey = JSON.stringify(layers || []);
  const initialFinishingLayers = normalizeFinishingLayersForUi(layers);
  const previousLayerIdsRef = useRef(new Set(initialFinishingLayers.map((layer) => layer.id)));
  const undoStackRef = useRef([]);
  const [draftLayers, setDraftLayers] = useState(() => initialFinishingLayers);
  const [selectedLayerId, setSelectedLayerId] = useState("");
  const [undoCount, setUndoCount] = useState(0);
  const [previewTime, setPreviewTime] = useState(0);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [musicBrief, setMusicBrief] = useState({
    description: "Instrumental background music that follows the video's energy, supports dialogue, and stays light enough for spoken lines to remain clear.",
    tags: "warm, playful, cinematic, light, instrumental",
    volume: 0.28
  });
  const [laughTrackBrief, setLaughTrackBrief] = useState({
    description: "Warm studio audience laugh track for a late-night comedy monologue: natural laughs, small chuckles, no words, no applause.",
    durationSeconds: 8,
    promptInfluence: 0.35,
    energy: 55,
    volume: 0.22,
    autoPlace: true,
    autoCueCount: true,
    maxCues: 100,
    cueDurationSeconds: 2.4,
    startNudgeSeconds: -0.1
  });
  const [applauseTrackBrief, setApplauseTrackBrief] = useState({
    description: "Warm studio audience applause for a late-night show: clean clapping, light cheering, no laughter, no words, no music.",
    durationSeconds: 10,
    promptInfluence: 0.35,
    energy: 60,
    volume: 0.24,
    autoPlace: true,
    autoCueCount: true,
    maxCues: 12,
    cueDurationSeconds: 3.2
  });

  useEffect(() => {
    const nextLayers = normalizeFinishingLayersForUi(JSON.parse(layersKey || "[]"));
    const previousIds = previousLayerIdsRef.current;
    const addedLayer = nextLayers.find((layer) => !previousIds.has(layer.id));
    setDraftLayers(nextLayers);
    setSelectedLayerId((current) => addedLayer?.id || (nextLayers.some((layer) => layer.id === current) ? current : nextLayers[0]?.id || ""));
    previousLayerIdsRef.current = new Set(nextLayers.map((layer) => layer.id));
    undoStackRef.current = [];
    setUndoCount(0);
  }, [layersKey]);

  const baseTimelineSeconds = Math.max(
    1,
    Number(baseFinalOutput?.durationSeconds || finishedMasterOutput?.durationSeconds || 0) || 1
  );
  const timelineSeconds = baseTimelineSeconds;
  const timelineTicks = finishingTimelineTicks(timelineSeconds);
  const playheadLeft = Math.min(100, Math.max(0, (previewTime / timelineSeconds) * 100));
  const activePreviewLayers = finishedMasterOutput
    ? []
    : draftLayers.filter((layer) => {
        if (!["image", "video"].includes(layer.type) || layer.enabled === false) return false;
        const start = Number(layer.startSeconds) || 0;
        const end = start + (Number(layer.durationSeconds) || 0);
        return previewTime >= start && previewTime <= end;
      });
  const audioPreviewLayers = finishedMasterOutput
    ? []
    : draftLayers.filter((layer) => layer.type === "audio" && layer.enabled !== false && layer.localUrl);
  const audioLayers = draftLayers.filter((layer) => layer.type === "audio");
  const visualLayers = draftLayers.filter((layer) => layer.type !== "audio");
  const audioLayerCount = audioLayers.length;
  const hasLayers = draftLayers.length > 0;
  const uploadBusy = busyAction === "finishing-upload";
  const exportBusy = busyAction === "finishing-export";
  const saveBusy = busyAction === "finishing-save";
  const musicBusy = busyAction === "finishing-music";
  const laughTrackBusy = busyAction === "finishing-laugh-track";
  const applauseTrackBusy = busyAction === "finishing-applause-track";
  const elevenMusicReady = Boolean(integrations?.elevenlabs);

  function updateMusicBrief(key, value) {
    setMusicBrief((prev) => ({
      ...prev,
      [key]: key === "volume" ? clampTimelineValue(Number(value) || 0, 0, 2) : value
    }));
  }

  function updateLaughTrackBrief(key, value) {
    setLaughTrackBrief((prev) => {
      const numericRanges = {
        durationSeconds: [0.5, 30],
        promptInfluence: [0, 1],
        energy: [0, 100],
        volume: [0, 2],
        maxCues: [1, 100],
        cueDurationSeconds: [0.5, 30],
        startNudgeSeconds: [-0.5, 1]
      };
      const range = numericRanges[key];
      return {
        ...prev,
        [key]: range ? clampTimelineValue(Number(value) || 0, range[0], range[1]) : value
      };
    });
  }

  function updateApplauseTrackBrief(key, value) {
    setApplauseTrackBrief((prev) => {
      const numericRanges = {
        durationSeconds: [0.5, 30],
        promptInfluence: [0, 1],
        energy: [0, 100],
        volume: [0, 2],
        maxCues: [1, 100],
        cueDurationSeconds: [0.5, 30]
      };
      const range = numericRanges[key];
      return {
        ...prev,
        [key]: range ? clampTimelineValue(Number(value) || 0, range[0], range[1]) : value
      };
    });
  }

  function pushUndoSnapshot(label = "Edit layers") {
    const snapshot = normalizeFinishingLayersForUi(draftLayers);
    const snapshotKey = JSON.stringify(snapshot);
    const previousKey = undoStackRef.current.at(-1)?.key;
    if (!snapshot.length && !draftLayers.length) return;
    if (previousKey === snapshotKey) return;
    undoStackRef.current = [...undoStackRef.current, { key: snapshotKey, label, layers: snapshot }].slice(-50);
    setUndoCount(undoStackRef.current.length);
  }

  function restoreUndoSnapshot() {
    const entry = undoStackRef.current.pop();
    if (!entry) return false;
    const nextLayers = normalizeFinishingLayersForUi(entry.layers);
    setDraftLayers(nextLayers);
    setSelectedLayerId((current) => (nextLayers.some((layer) => layer.id === current) ? current : nextLayers[0]?.id || ""));
    setUndoCount(undoStackRef.current.length);
    pauseAudioPreview();
    return true;
  }

  function updateLayer(id, patch, options = {}) {
    if (options.recordUndo !== false) pushUndoSnapshot("Edit layer");
    setDraftLayers((prev) =>
      prev.map((layer) =>
        layer.id === id
          ? normalizeFinishingLayerForUi({
              ...layer,
              ...patch
            })
          : layer
      )
    );
  }

  function pauseAudioPreview() {
    audioPreviewRefs.current.forEach((audio) => {
      audio.pause();
    });
  }

  function setMediaTime(media, seconds) {
    if (!media) return;
    try {
      const nextTime = Math.max(0, Number(seconds) || 0);
      if (typeof media.fastSeek === "function") {
        media.fastSeek(nextTime);
      } else {
        media.currentTime = nextTime;
      }
    } catch {
      // Browser media can reject seeks until metadata is ready.
    }
  }

  function audioLayerPreviewState(layer, time) {
    const start = Number(layer.startSeconds) || 0;
    const duration = Math.max(0, Number(layer.durationSeconds) || 0);
    const relativeTime = time - start;
    const active = relativeTime >= 0 && relativeTime <= duration;
    const sourceDuration = Math.max(0, Number(layer.sourceDurationSeconds) || duration);
    const sourceTime = Math.min(Math.max(0, relativeTime), Math.max(0, sourceDuration - 0.05));
    const fadeIn = Math.max(0, Number(layer.fadeInSeconds) || 0);
    const fadeOut = Math.max(0, Number(layer.fadeOutSeconds) || 0);
    const fadeInScale = fadeIn > 0 ? clampTimelineValue(relativeTime / fadeIn, 0, 1) : 1;
    const fadeOutScale = fadeOut > 0 ? clampTimelineValue((duration - relativeTime) / fadeOut, 0, 1) : 1;
    const volume = clampTimelineValue((Number(layer.volume) || 0) * Math.min(fadeInScale, fadeOutScale), 0, 1);
    return { active, sourceTime, volume };
  }

  function syncAudioPreview({ forceSeek = false, shouldPlay } = {}) {
    const video = programVideoRef.current;
    const time = Number(video?.currentTime ?? previewTime) || 0;
    const playAudio = shouldPlay ?? Boolean(video && !video.paused && !video.ended);
    const activeAudioIds = new Set(audioPreviewLayers.map((layer) => layer.id));

    audioPreviewRefs.current.forEach((audio, id) => {
      if (!activeAudioIds.has(id)) audio.pause();
    });

    audioPreviewLayers.forEach((layer) => {
      const audio = audioPreviewRefs.current.get(layer.id);
      if (!audio) return;
      const state = audioLayerPreviewState(layer, time);
      audio.volume = state.volume;
      if (!state.active) {
        audio.pause();
        return;
      }
      if (forceSeek || Math.abs((Number(audio.currentTime) || 0) - state.sourceTime) > 0.35) {
        setMediaTime(audio, state.sourceTime);
      }
      if (playAudio && audio.paused) {
        audio.play().catch(() => {});
      } else if (!playAudio && !audio.paused) {
        audio.pause();
      }
    });
  }

  function finishPreviewSeek(seconds) {
    const video = programVideoRef.current;
    const nextTime = roundTimelineValue(clampTimelineValue(seconds, 0, timelineSeconds));
    setPreviewTime(nextTime);
    syncAudioPreview({ forceSeek: true, shouldPlay: false });

    if (!resumePreviewAfterSeekRef.current || !video) {
      resumePreviewAfterSeekRef.current = false;
      return;
    }

    resumePreviewAfterSeekRef.current = false;
    if (seekResumeTimerRef.current) {
      window.clearTimeout(seekResumeTimerRef.current);
    }
    seekResumeTimerRef.current = window.setTimeout(() => {
      video.play().then(() => syncAudioPreview({ forceSeek: true, shouldPlay: true })).catch(() => {});
    }, 90);
  }

  useEffect(() => {
    syncAudioPreview();
  }, [draftLayers, previewTime, finishedMasterOutput?.id]);

  useEffect(
    () => () => {
      pauseAudioPreview();
      if (seekResumeTimerRef.current) {
        window.clearTimeout(seekResumeTimerRef.current);
      }
    },
    []
  );

  function removeLayer(id) {
    pushUndoSnapshot("Delete layer");
    setDraftLayers((prev) => prev.filter((layer) => layer.id !== id));
    setSelectedLayerId((current) => (current === id ? "" : current));
  }

  function duplicateLayer(layer) {
    pushUndoSnapshot("Duplicate layer");
    const duplicateRootId = layer.duplicatedFromLayerId || layer.id;
    const nextStartSeconds = nextDuplicateLayerStart(layer, draftLayers, timelineSeconds);
    const copy = normalizeFinishingLayerForUi({
      ...layer,
      id: createLocalId("finishing-layer"),
      name: `${layer.name || finishingLayerTypeLabel(layer.type)} copy`,
      duplicatedFromLayerId: duplicateRootId,
      startSeconds: nextStartSeconds,
      createdAt: new Date().toISOString()
    });
    setDraftLayers((prev) => {
      const index = prev.findIndex((item) => item.id === layer.id);
      if (index < 0) return [...prev, copy];
      return [...prev.slice(0, index + 1), copy, ...prev.slice(index + 1)];
    });
    setSelectedLayerId(copy.id);
  }

  function uploadFiles(files) {
    if (!files?.length) return;
    onUploadLayers?.(files);
  }

  function togglePreviewPlayback() {
    const video = programVideoRef.current;
    if (!video || !baseFinalOutput) return;
    if (video.paused || video.ended) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }

  function isTextEditingTarget(target) {
    const tagName = String(target?.tagName || "").toLowerCase();
    return ["input", "textarea", "select"].includes(tagName) || Boolean(target?.isContentEditable);
  }

  useEffect(() => {
    function handleFinishingKeys(event) {
      const panel = finishingPanelRef.current;
      if (!panel?.open) return;
      if (isTextEditingTarget(event.target)) return;

      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "z") {
        if (restoreUndoSnapshot()) {
          event.preventDefault();
        }
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
        togglePreviewPlayback();
      }
    }

    window.addEventListener("keydown", handleFinishingKeys);
    return () => window.removeEventListener("keydown", handleFinishingKeys);
  }, [draftLayers, baseFinalOutput]);

  function seekPreview(seconds, options = {}) {
    const { pauseForSeek = true, resumeAfterSeek = true } = options;
    const nextTime = roundTimelineValue(clampTimelineValue(seconds, 0, timelineSeconds));
    if (seekResumeTimerRef.current) {
      window.clearTimeout(seekResumeTimerRef.current);
      seekResumeTimerRef.current = null;
    }
    setPreviewTime(nextTime);
    const video = programVideoRef.current;
    if (video && Number.isFinite(video.duration || timelineSeconds)) {
      const wasPlaying = !video.paused && !video.ended;
      if (pauseForSeek && wasPlaying) {
        video.pause();
      }
      pauseAudioPreview();
      resumePreviewAfterSeekRef.current = Boolean(resumeAfterSeek && wasPlaying);
      setMediaTime(video, Math.min(nextTime, Math.max(0, (video.duration || timelineSeconds) - 0.02)));
    }
    syncAudioPreview({ forceSeek: true, shouldPlay: false });
  }

  function timelineSecondsFromPointer(event, element = event.currentTarget) {
    const rect = element?.getBoundingClientRect();
    if (!rect?.width) return previewTime;
    return (clampTimelineValue(event.clientX - rect.left, 0, rect.width) / rect.width) * timelineSeconds;
  }

  function startTimelineScrub(event) {
    if (!baseFinalOutput) return;
    event.preventDefault();
    const video = programVideoRef.current;
    const wasPlaying = Boolean(video && !video.paused && !video.ended);
    let finalScrubTime = previewTime;
    if (wasPlaying) {
      video.pause();
      pauseAudioPreview();
      setIsPreviewPlaying(false);
    }
    const scrubElement = event.currentTarget.classList?.contains("timelinePlayheadHandle")
      ? event.currentTarget.closest(".timelineRuler")
      : event.currentTarget;
    finalScrubTime = timelineSecondsFromPointer(event, scrubElement);
    seekPreview(finalScrubTime, { pauseForSeek: false, resumeAfterSeek: false });

    function handlePointerMove(moveEvent) {
      finalScrubTime = timelineSecondsFromPointer(moveEvent, scrubElement);
      seekPreview(finalScrubTime, { pauseForSeek: false, resumeAfterSeek: false });
    }

    function stopScrub() {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopScrub);
      window.removeEventListener("pointercancel", stopScrub);
      resumePreviewAfterSeekRef.current = wasPlaying;
      if (seekResumeTimerRef.current) {
        window.clearTimeout(seekResumeTimerRef.current);
      }
      seekResumeTimerRef.current = window.setTimeout(() => finishPreviewSeek(finalScrubTime), 90);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopScrub, { once: true });
    window.addEventListener("pointercancel", stopScrub, { once: true });
  }

  function startTimelineEdit(event, layer, mode) {
    if (busy || !baseFinalOutput) return;
    event.preventDefault();
    event.stopPropagation();
    pushUndoSnapshot("Edit timeline");
    setSelectedLayerId(layer.id);

    const lane = event.currentTarget.closest(".timelineLane");
    const rect = lane?.getBoundingClientRect();
    if (!rect?.width) return;

    const initialPointerX = event.clientX;
    const initialStart = Number(layer.startSeconds) || 0;
    const initialDuration = Math.max(0.1, Number(layer.durationSeconds) || 0.1);
    const initialHoldStart = Math.max(0, Number(layer.holdStartSeconds) || 0);
    const secondsPerPixel = timelineSeconds / rect.width;
    const minDuration = 0.1;

    function handlePointerMove(moveEvent) {
      const deltaSeconds = (moveEvent.clientX - initialPointerX) * secondsPerPixel;
      let nextStart = initialStart;
      let nextDuration = initialDuration;
      let nextHoldStart = initialHoldStart;

      if (mode === "move") {
        nextStart = clampTimelineValue(initialStart + deltaSeconds, 0, Math.max(0, timelineSeconds - initialDuration));
      }

      if (mode === "trim-start") {
        const maxStart = initialStart + initialDuration - minDuration;
        nextStart = clampTimelineValue(initialStart + deltaSeconds, 0, maxStart);
        nextDuration = initialDuration + initialStart - nextStart;
        const startDelta = nextStart - initialStart;
        nextHoldStart =
          layer.type === "video"
            ? clampTimelineValue(initialHoldStart - startDelta, 0, Math.max(0, nextDuration - minDuration))
            : 0;
      }

      if (mode === "trim-end") {
        nextDuration = clampTimelineValue(initialDuration + deltaSeconds, minDuration, Math.max(minDuration, timelineSeconds - initialStart));
      }

      updateLayer(layer.id, {
        startSeconds: roundTimelineValue(nextStart),
        durationSeconds: roundTimelineValue(nextDuration),
        holdStartSeconds: roundTimelineValue(nextHoldStart)
      }, { recordUndo: false });
    }

    function stopTimelineEdit() {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopTimelineEdit);
      window.removeEventListener("pointercancel", stopTimelineEdit);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopTimelineEdit, { once: true });
    window.addEventListener("pointercancel", stopTimelineEdit, { once: true });
  }

  function renderLayerCard(layer) {
    return (
      <article
        key={layer.id}
        className={`finishingLayerCard ${layer.type} ${selectedLayerId === layer.id ? "selected" : ""}`}
        onClick={() => setSelectedLayerId(layer.id)}
      >
        <div className="finishingLayerHeader">
          <div>
            <strong>{layer.name}</strong>
            <span>{finishingLayerTypeLabel(layer.type)}</span>
          </div>
          <div className="buttonRow" onClick={(event) => event.stopPropagation()}>
            <Toggle
              checked={layer.enabled}
              onChange={(checked) => updateLayer(layer.id, { enabled: checked })}
              label={layer.enabled ? "On" : "Off"}
              icon={Check}
            />
            <button type="button" className="quietButton" onClick={() => duplicateLayer(layer)} disabled={busy}>
              <Copy size={15} />
              Duplicate
            </button>
            <button type="button" className="quietButton" onClick={() => removeLayer(layer.id)} disabled={busy}>
              <Trash2 size={15} />
              Delete
            </button>
          </div>
        </div>
        <div className="finishingLayerControls">
          <Field label="Start">
            <input
              type="number"
              min="0"
              step="0.1"
              value={layer.startSeconds}
              onChange={(event) => updateLayer(layer.id, { startSeconds: event.target.value })}
            />
          </Field>
          <Field label="Duration">
            <input
              type="number"
              min="0.1"
              step="0.1"
              value={layer.durationSeconds}
              onChange={(event) => updateLayer(layer.id, { durationSeconds: event.target.value })}
            />
          </Field>
          {layer.type !== "audio" ? (
            <>
              <Field label="X %">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={layer.xPercent}
                  onChange={(event) => updateLayer(layer.id, { xPercent: event.target.value })}
                />
              </Field>
              <Field label="Y %">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={layer.yPercent}
                  onChange={(event) => updateLayer(layer.id, { yPercent: event.target.value })}
                />
              </Field>
              <Field label="Width %">
                <input
                  type="number"
                  min="1"
                  max="220"
                  step="1"
                  value={layer.widthPercent}
                  onChange={(event) => updateLayer(layer.id, { widthPercent: event.target.value })}
                />
              </Field>
              <Field label="Opacity">
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={layer.opacity}
                  onChange={(event) => updateLayer(layer.id, { opacity: event.target.value })}
                />
              </Field>
            </>
          ) : (
            <>
              <Field label="Volume">
                <input
                  type="number"
                  min="0"
                  max="2"
                  step="0.05"
                  value={layer.volume}
                  onChange={(event) => updateLayer(layer.id, { volume: event.target.value })}
                />
              </Field>
              <Field label="Fade in">
                <input
                  type="number"
                  min="0"
                  max="10"
                  step="0.1"
                  value={layer.fadeInSeconds}
                  onChange={(event) => updateLayer(layer.id, { fadeInSeconds: event.target.value })}
                />
              </Field>
              <Field label="Fade out">
                <input
                  type="number"
                  min="0"
                  max="10"
                  step="0.1"
                  value={layer.fadeOutSeconds}
                  onChange={(event) => updateLayer(layer.id, { fadeOutSeconds: event.target.value })}
                />
              </Field>
            </>
          )}
        </div>
      </article>
    );
  }

  return (
    <details
      className="reviewDetails finishingLayersPanel"
      ref={finishingPanelRef}
      open={open}
      onToggle={(event) => onOpenChange?.(event.currentTarget.open)}
    >
      <summary>
        <span>Finishing Layers</span>
        <Pill tone={finishedMasterOutput ? "good" : hasLayers ? "neutral" : "warn"}>
          {finishedMasterOutput ? "master ready" : hasLayers ? `${draftLayers.length} layers` : "optional"}
        </Pill>
      </summary>
      <div className="finishingBody">
        <div className="finishingHeader">
          <div>
            <strong>{finishedMasterOutput ? "Finished master exported" : baseFinalOutput ? "Add final graphics or sound" : "Render final video first"}</strong>
            <span>
              {finishedMasterOutput
                ? "YouTube Publish will use the finished master."
                : "Add image/video overlays or extra audio after the episode render, without changing the original final render."}
            </span>
          </div>
          <div className="buttonRow">
            <input
              ref={imageVideoInputRef}
              type="file"
              multiple
              accept="image/*,video/*"
              onChange={(event) => {
                uploadFiles(event.target.files);
                event.target.value = "";
              }}
            />
            <input
              ref={audioInputRef}
              type="file"
              multiple
              accept="audio/*"
              onChange={(event) => {
                uploadFiles(event.target.files);
                event.target.value = "";
              }}
            />
            <button
              type="button"
              className="secondaryButton"
              onClick={() => imageVideoInputRef.current?.click()}
              disabled={!baseFinalOutput || busy}
            >
              {uploadBusy ? <RefreshCw className="spin" size={16} /> : <Upload size={16} />}
              Add Graphic/Video
            </button>
            <button
              type="button"
              className="secondaryButton"
              onClick={() => audioInputRef.current?.click()}
              disabled={!baseFinalOutput || busy}
            >
              {uploadBusy ? <RefreshCw className="spin" size={16} /> : <Play size={16} />}
              Add Audio
            </button>
          </div>
        </div>

        {baseFinalOutput ? (
            <div className="finishingPreviewGrid">
              <div className="finishingBasePreview">
              <div className="finishingProgramMonitor">
                <video
                  ref={programVideoRef}
                  src={(finishedMasterOutput || baseFinalOutput).localUrl}
                  playsInline
                  onClick={togglePreviewPlayback}
                  onLoadedMetadata={(event) => {
                    setPreviewTime(event.currentTarget.currentTime || 0);
                    syncAudioPreview({ forceSeek: true, shouldPlay: false });
                  }}
                  onPlay={() => {
                    setIsPreviewPlaying(true);
                    syncAudioPreview({ forceSeek: true, shouldPlay: true });
                  }}
                  onPause={() => {
                    setIsPreviewPlaying(false);
                    pauseAudioPreview();
                  }}
                  onEnded={() => {
                    setIsPreviewPlaying(false);
                    pauseAudioPreview();
                  }}
                  onTimeUpdate={(event) => {
                    setPreviewTime(event.currentTarget.currentTime || 0);
                    syncAudioPreview();
                  }}
                  onSeeked={(event) => {
                    finishPreviewSeek(event.currentTarget.currentTime || 0);
                  }}
                />
                <button
                  type="button"
                  className="programPlayButton"
                  onClick={togglePreviewPlayback}
                  disabled={!baseFinalOutput}
                  aria-label={isPreviewPlaying ? "Pause preview" : "Play preview"}
                  title="Play preview. Spacebar also toggles playback."
                >
                  {isPreviewPlaying ? <Pause size={22} /> : <Play size={22} />}
                </button>
                {audioPreviewLayers.map((layer) => (
                  <audio
                    key={layer.id}
                    ref={(node) => {
                      if (node) {
                        audioPreviewRefs.current.set(layer.id, node);
                      } else {
                        audioPreviewRefs.current.delete(layer.id);
                      }
                    }}
                    className="finishingAudioPreview"
                    src={layer.localUrl}
                    preload="auto"
                  />
                ))}
                {activePreviewLayers.map((layer) => (
                  <div
                    key={layer.id}
                    className={`programOverlayLayer ${layer.type}`}
                    style={{
                      left: `${layer.xPercent}%`,
                      top: `${layer.yPercent}%`,
                      width: `${layer.widthPercent}%`,
                      opacity: layer.opacity
                    }}
                  >
                    <ProgramOverlayMedia layer={layer} previewTime={previewTime} />
                  </div>
                ))}
              </div>
              <div className="finishingBasePreviewInfo">
                <strong>{finishedMasterOutput ? "Finished master preview" : "Base final render"}</strong>
                <span>{(finishedMasterOutput || baseFinalOutput).fileName || (finishedMasterOutput || baseFinalOutput).name}</span>
              </div>
            </div>
            <div className="finishingTimeline">
              <div className="timelineScale">
                <span />
                <div className="timelineRuler" onPointerDown={startTimelineScrub}>
                  {timelineTicks.map((tick) => (
                    <span key={tick.seconds} style={{ left: `${tick.left}%` }}>
                      {formatSeconds(tick.seconds)}
                    </span>
                  ))}
                  <button
                    type="button"
                    className="timelinePlayheadHandle"
                    style={{ left: `${playheadLeft}%` }}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      startTimelineScrub(event);
                    }}
                    aria-label="Scrub timeline"
                  />
                </div>
              </div>
              <div className="timelineRows">
                <div className="timelineRow base">
                  <span className="timelineTrackLabel">V1</span>
                  <div className="timelineLane" onPointerDown={startTimelineScrub}>
                    <span className="timelinePlayhead" style={{ left: `${playheadLeft}%` }} />
                    <span className="timelineBaseBar">Final render</span>
                  </div>
                </div>
                {draftLayers.map((layer, index) => (
                  <div key={layer.id} className={`timelineRow ${layer.type} ${selectedLayerId === layer.id ? "selected" : ""} ${layer.enabled ? "" : "disabled"}`}>
                    <span className="timelineTrackLabel">{layer.type === "audio" ? `A${index + 1}` : `V${index + 2}`}</span>
                    <div className="timelineLane" onPointerDown={startTimelineScrub}>
                      <span className="timelinePlayhead" style={{ left: `${playheadLeft}%` }} />
                      <button
                        type="button"
                        className="timelineLayerBar"
                        style={finishingLayerBarStyle(layer, timelineSeconds)}
                        title={`${layer.name} ${formatSeconds(layer.startSeconds)}-${formatSeconds(layer.startSeconds + layer.durationSeconds)}`}
                        onPointerDown={(event) => startTimelineEdit(event, layer, "move")}
                        onClick={() => setSelectedLayerId(layer.id)}
                      >
                        {finishingLayerHoldSegments(layer).map((segment) => (
                          <span
                            key={segment.type}
                            className={`timelineHoldSegment ${segment.type}`}
                            style={segment.style}
                          />
                        ))}
                        <span
                          className="timelineTrimHandle start"
                          onPointerDown={(event) => startTimelineEdit(event, layer, "trim-start")}
                        />
                        <span className="timelineLayerThumb">
                          {layer.type === "image" && layer.localUrl ? <img src={layer.localUrl} alt="" /> : null}
                          {layer.type === "video" && layer.localUrl ? <video src={layer.localUrl} muted playsInline preload="metadata" /> : null}
                          {layer.type === "audio" ? <span className="timelineAudioWave" /> : null}
                        </span>
                        <span className="timelineLayerText">
                          <strong>{layer.name}</strong>
                          <em>{formatSeconds(layer.startSeconds)} - {formatSeconds(layer.startSeconds + layer.durationSeconds)}</em>
                        </span>
                        <span
                          className="timelineTrimHandle end"
                          onPointerDown={(event) => startTimelineEdit(event, layer, "trim-end")}
                        />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="emptyState compact">Render Final before adding finishing layers.</div>
        )}

        <details
          className="finishingAudioLayerSection"
          open={savedPanelOpen(panelState, "approvals.audioLayers")}
          onToggle={(event) => onPanelOpenChange?.("approvals.audioLayers", event.currentTarget.open)}
        >
          <summary>
            <span>Audio Layers</span>
            <Pill tone={audioLayerCount ? "neutral" : "warn"}>
              {audioLayerCount ? `${audioLayerCount} audio` : "optional"}
            </Pill>
          </summary>
          <div className="finishingAudioLayerBody">
            <div className="finishingMusicPanel">
          <div className="finishingMusicHeader">
            <div>
              <strong>AI Music</strong>
              <span>
                Generate a music bed from the current final video, then adjust it as an audio layer before exporting.
              </span>
            </div>
            <button
              type="button"
              className="secondaryButton"
              onClick={() => onGenerateMusic?.(musicBrief)}
              disabled={!baseFinalOutput || !elevenMusicReady || busy}
              title={
                !baseFinalOutput
                  ? "Render Final before generating music."
                  : !elevenMusicReady
                    ? "Connect ElevenLabs before generating music."
                    : "Generate a local audio layer from ElevenLabs Video-to-Music."
              }
            >
              {musicBusy ? <RefreshCw className="spin" size={16} /> : <Music size={16} />}
              Generate Music
            </button>
          </div>
          <div className="musicBriefGrid">
            <Field label="Music prompt">
              <textarea
                rows={3}
                value={musicBrief.description}
                onChange={(event) => updateMusicBrief("description", event.target.value)}
                placeholder="Describe the underscore style, pace, and emotional feel."
              />
            </Field>
            <Field label="Style tags">
              <input
                value={musicBrief.tags}
                onChange={(event) => updateMusicBrief("tags", event.target.value)}
                placeholder="warm, playful, cinematic"
              />
            </Field>
            <Field label="Volume">
              <input
                type="number"
                min="0"
                max="2"
                step="0.05"
                value={musicBrief.volume}
                onChange={(event) => updateMusicBrief("volume", event.target.value)}
              />
            </Field>
          </div>
          <span className={`musicIntegrationStatus ${elevenMusicReady ? "ready" : ""}`}>
            {elevenMusicReady ? "ElevenLabs connected" : "ElevenLabs not connected"}
          </span>
        </div>

        <div className="finishingMusicPanel">
          <div className="finishingMusicHeader">
            <div>
              <strong>Laugh Track</strong>
              <span>
                Generate audience laughter as a separate audio layer, then place and mix it before exporting.
              </span>
            </div>
            <button
              type="button"
              className="secondaryButton"
              onClick={() => onGenerateLaughTrack?.({ ...laughTrackBrief, finishingLayers: draftLayers })}
              disabled={!baseFinalOutput || !elevenMusicReady || busy}
              title={
                !baseFinalOutput
                  ? "Render Final before generating a laugh track."
                  : !elevenMusicReady
                    ? "Connect ElevenLabs before generating a laugh track."
                    : "Generate a local audio layer from ElevenLabs sound effects."
              }
            >
              {laughTrackBusy ? <RefreshCw className="spin" size={16} /> : <Activity size={16} />}
              Generate Laugh Track
            </button>
          </div>
          <div className="musicBriefGrid laughTrackBriefGrid">
            <Field label="Laugh prompt">
              <textarea
                rows={3}
                value={laughTrackBrief.description}
                onChange={(event) => updateLaughTrackBrief("description", event.target.value)}
                placeholder="Describe the audience, intensity, timing, and any sounds to avoid."
              />
            </Field>
            <Field label="Duration">
              <input
                type="number"
                min="0.5"
                max="30"
                step="0.5"
                value={laughTrackBrief.durationSeconds}
                onChange={(event) => updateLaughTrackBrief("durationSeconds", event.target.value)}
              />
            </Field>
            <Field label="Prompt influence">
              <input
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={laughTrackBrief.promptInfluence}
                onChange={(event) => updateLaughTrackBrief("promptInfluence", event.target.value)}
              />
            </Field>
            <Field label={`Energy ${Math.round(Number(laughTrackBrief.energy) || 0)}`}>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={laughTrackBrief.energy}
                onChange={(event) => updateLaughTrackBrief("energy", event.target.value)}
              />
            </Field>
            <Field label="Volume">
              <input
                type="number"
                min="0"
                max="2"
                step="0.05"
                value={laughTrackBrief.volume}
                onChange={(event) => updateLaughTrackBrief("volume", event.target.value)}
              />
            </Field>
          </div>
          <div className="laughTrackPlacementControls">
            <Toggle
              checked={laughTrackBrief.autoPlace}
              onChange={(checked) => updateLaughTrackBrief("autoPlace", checked)}
              label="Auto-place cues"
              icon={Check}
            />
            <Toggle
              checked={laughTrackBrief.autoCueCount}
              onChange={(checked) => updateLaughTrackBrief("autoCueCount", checked)}
              label="Auto cue count"
              icon={Check}
            />
            <Field label="Max cues">
              <input
                type="number"
                min="1"
                max="100"
                step="1"
                value={laughTrackBrief.maxCues}
                onChange={(event) => updateLaughTrackBrief("maxCues", event.target.value)}
                disabled={!laughTrackBrief.autoPlace}
              />
            </Field>
            <Field label="Laugh length">
              <input
                type="number"
                min="0.5"
                max="30"
                step="0.25"
                value={laughTrackBrief.cueDurationSeconds}
                onChange={(event) => updateLaughTrackBrief("cueDurationSeconds", event.target.value)}
                disabled={!laughTrackBrief.autoPlace}
              />
            </Field>
            <Field label="Start nudge">
              <input
                type="number"
                min="-0.5"
                max="1"
                step="0.01"
                value={laughTrackBrief.startNudgeSeconds}
                onChange={(event) => updateLaughTrackBrief("startNudgeSeconds", event.target.value)}
                disabled={!laughTrackBrief.autoPlace}
                title="Negative values start laughter earlier; -0.10 is about 3 frames at 30fps."
              />
            </Field>
          </div>
          <span className={`musicIntegrationStatus ${elevenMusicReady ? "ready" : ""}`}>
            {elevenMusicReady ? "ElevenLabs sound effects ready" : "ElevenLabs not connected"}
          </span>
        </div>

        <div className="finishingMusicPanel">
          <div className="finishingMusicHeader">
            <div>
              <strong>Applause Track</strong>
              <span>
                Generate applause as its own audio layer for openings, closings, transitions, or big reveals.
              </span>
            </div>
            <button
              type="button"
              className="secondaryButton"
              onClick={() => onGenerateApplauseTrack?.({ ...applauseTrackBrief, finishingLayers: draftLayers })}
              disabled={!baseFinalOutput || !elevenMusicReady || busy}
              title={
                !baseFinalOutput
                  ? "Render Final before generating applause."
                  : !elevenMusicReady
                    ? "Connect ElevenLabs before generating applause."
                    : "Generate a local applause audio layer from ElevenLabs sound effects."
              }
            >
              {applauseTrackBusy ? <RefreshCw className="spin" size={16} /> : <Activity size={16} />}
              Generate Applause
            </button>
          </div>
          <div className="musicBriefGrid laughTrackBriefGrid">
            <Field label="Applause prompt">
              <textarea
                rows={3}
                value={applauseTrackBrief.description}
                onChange={(event) => updateApplauseTrackBrief("description", event.target.value)}
                placeholder="Describe the applause size, energy, room, and any sounds to avoid."
              />
            </Field>
            <Field label="Duration">
              <input
                type="number"
                min="0.5"
                max="30"
                step="0.5"
                value={applauseTrackBrief.durationSeconds}
                onChange={(event) => updateApplauseTrackBrief("durationSeconds", event.target.value)}
              />
            </Field>
            <Field label="Prompt influence">
              <input
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={applauseTrackBrief.promptInfluence}
                onChange={(event) => updateApplauseTrackBrief("promptInfluence", event.target.value)}
              />
            </Field>
            <Field label={`Energy ${Math.round(Number(applauseTrackBrief.energy) || 0)}`}>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={applauseTrackBrief.energy}
                onChange={(event) => updateApplauseTrackBrief("energy", event.target.value)}
              />
            </Field>
            <Field label="Volume">
              <input
                type="number"
                min="0"
                max="2"
                step="0.05"
                value={applauseTrackBrief.volume}
                onChange={(event) => updateApplauseTrackBrief("volume", event.target.value)}
              />
            </Field>
          </div>
          <div className="laughTrackPlacementControls">
            <Toggle
              checked={applauseTrackBrief.autoPlace}
              onChange={(checked) => updateApplauseTrackBrief("autoPlace", checked)}
              label="Auto-place cues"
              icon={Check}
            />
            <Toggle
              checked={applauseTrackBrief.autoCueCount}
              onChange={(checked) => updateApplauseTrackBrief("autoCueCount", checked)}
              label="Auto cue count"
              icon={Check}
            />
            <Field label="Max cues">
              <input
                type="number"
                min="1"
                max="100"
                step="1"
                value={applauseTrackBrief.maxCues}
                onChange={(event) => updateApplauseTrackBrief("maxCues", event.target.value)}
                disabled={!applauseTrackBrief.autoPlace}
              />
            </Field>
            <Field label="Applause length">
              <input
                type="number"
                min="0.5"
                max="30"
                step="0.25"
                value={applauseTrackBrief.cueDurationSeconds}
                onChange={(event) => updateApplauseTrackBrief("cueDurationSeconds", event.target.value)}
                disabled={!applauseTrackBrief.autoPlace}
              />
            </Field>
          </div>
          <span className={`musicIntegrationStatus ${elevenMusicReady ? "ready" : ""}`}>
            {elevenMusicReady ? "ElevenLabs sound effects ready" : "ElevenLabs not connected"}
          </span>
            </div>
            {audioLayers.length ? (
              <div className="finishingLayerList audioLayerList">
                {audioLayers.map(renderLayerCard)}
              </div>
            ) : null}
          </div>
        </details>

        {visualLayers.length ? (
          <div className="finishingLayerList">
            {visualLayers.map((layer) => (
              <article
                key={layer.id}
                className={`finishingLayerCard ${layer.type} ${selectedLayerId === layer.id ? "selected" : ""}`}
                onClick={() => setSelectedLayerId(layer.id)}
              >
                <div className="finishingLayerHeader">
                  <div>
                    <strong>{layer.name}</strong>
                    <span>{finishingLayerTypeLabel(layer.type)}</span>
                  </div>
                  <div className="buttonRow" onClick={(event) => event.stopPropagation()}>
                    <Toggle
                      checked={layer.enabled}
                      onChange={(checked) => updateLayer(layer.id, { enabled: checked })}
                      label={layer.enabled ? "On" : "Off"}
                      icon={Check}
                    />
                    <button type="button" className="quietButton" onClick={() => duplicateLayer(layer)} disabled={busy}>
                      <Copy size={15} />
                      Duplicate
                    </button>
                    <button type="button" className="quietButton" onClick={() => removeLayer(layer.id)} disabled={busy}>
                      <Trash2 size={15} />
                      Delete
                    </button>
                  </div>
                </div>
                <div className="finishingLayerControls">
                  <Field label="Start">
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={layer.startSeconds}
                      onChange={(event) => updateLayer(layer.id, { startSeconds: event.target.value })}
                    />
                  </Field>
                  <Field label="Duration">
                    <input
                      type="number"
                      min="0.1"
                      step="0.1"
                      value={layer.durationSeconds}
                      onChange={(event) => updateLayer(layer.id, { durationSeconds: event.target.value })}
                    />
                  </Field>
                  {layer.type !== "audio" ? (
                    <>
                      <Field label="X %">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="1"
                          value={layer.xPercent}
                          onChange={(event) => updateLayer(layer.id, { xPercent: event.target.value })}
                        />
                      </Field>
                      <Field label="Y %">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="1"
                          value={layer.yPercent}
                          onChange={(event) => updateLayer(layer.id, { yPercent: event.target.value })}
                        />
                      </Field>
                      <Field label="Width %">
                        <input
                          type="number"
                          min="1"
                          max="220"
                          step="1"
                          value={layer.widthPercent}
                          onChange={(event) => updateLayer(layer.id, { widthPercent: event.target.value })}
                        />
                      </Field>
                      <Field label="Opacity">
                        <input
                          type="number"
                          min="0"
                          max="1"
                          step="0.05"
                          value={layer.opacity}
                          onChange={(event) => updateLayer(layer.id, { opacity: event.target.value })}
                        />
                      </Field>
                    </>
                  ) : (
                    <>
                      <Field label="Volume">
                        <input
                          type="number"
                          min="0"
                          max="2"
                          step="0.05"
                          value={layer.volume}
                          onChange={(event) => updateLayer(layer.id, { volume: event.target.value })}
                        />
                      </Field>
                      <Field label="Fade in">
                        <input
                          type="number"
                          min="0"
                          max="10"
                          step="0.1"
                          value={layer.fadeInSeconds}
                          onChange={(event) => updateLayer(layer.id, { fadeInSeconds: event.target.value })}
                        />
                      </Field>
                      <Field label="Fade out">
                        <input
                          type="number"
                          min="0"
                          max="10"
                          step="0.1"
                          value={layer.fadeOutSeconds}
                          onChange={(event) => updateLayer(layer.id, { fadeOutSeconds: event.target.value })}
                        />
                      </Field>
                    </>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : null}

        <div className="packageActions">
          <button
            className="secondaryButton"
            type="button"
            onClick={restoreUndoSnapshot}
            disabled={!undoCount || busy}
            title="Undo last finishing layer edit. Command-Z also works while this section is open."
          >
            <Undo2 size={16} />
            Undo
          </button>
          <button className="secondaryButton" type="button" onClick={() => onSaveLayers?.(draftLayers)} disabled={!baseFinalOutput || busy}>
            {saveBusy ? <RefreshCw className="spin" size={16} /> : <Save size={16} />}
            Save Layers
          </button>
          <button className="runButton" type="button" onClick={() => onExportMaster?.(draftLayers)} disabled={!baseFinalOutput || busy}>
            {exportBusy ? <RefreshCw className="spin" size={17} /> : <Film size={17} />}
            Export Finished Master
          </button>
          {finishedMasterOutput?.localUrl ? (
            <a className="secondaryButton" href={finishedMasterOutput.localUrl} target="_blank" rel="noreferrer">
              <Film size={16} />
              Open Master
            </a>
          ) : null}
        </div>
      </div>
    </details>
  );
}

function ProgramOverlayMedia({ layer, previewTime }) {
  const videoRef = useRef(null);
  const start = Number(layer.startSeconds) || 0;
  const relativeTime = Math.max(0, previewTime - start);
  const sourceDuration = Math.max(0, Number(layer.sourceDurationSeconds) || 0);
  const frontHold = Math.max(0, Number(layer.holdStartSeconds) || 0);
  const inFrontHold = layer.type === "video" && sourceDuration > 0 && relativeTime < frontHold;
  const inEndHold = layer.type === "video" && sourceDuration > 0 && relativeTime >= frontHold + sourceDuration;
  const holdFrame = inFrontHold || inEndHold;
  const sourceRelativeTime = Math.max(0, relativeTime - frontHold);
  const targetTime = inFrontHold ? 0 : inEndHold ? Math.max(0, sourceDuration - 0.05) : sourceRelativeTime;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || layer.type !== "video") return;
    try {
      const maxTime = Number.isFinite(video.duration) && video.duration > 0 ? Math.max(0, video.duration - 0.05) : targetTime;
      video.currentTime = Math.min(targetTime, maxTime);
    } catch {
      // Browser media can reject seeks until metadata is ready.
    }
  }, [layer.type, layer.localUrl, targetTime]);

  if (layer.type === "image") {
    return <img src={layer.localUrl} alt="" />;
  }

  if (layer.type === "video") {
    return (
      <>
        <video
          ref={videoRef}
          src={layer.localUrl}
          muted
          playsInline
          preload="metadata"
          onLoadedMetadata={() => {
            const video = videoRef.current;
            if (!video) return;
            try {
              video.currentTime = Math.min(targetTime, Math.max(0, (video.duration || sourceDuration || targetTime) - 0.05));
            } catch {
              // Browser media can reject seeks until metadata is ready.
            }
          }}
        />
        {holdFrame ? <span className="programHoldBadge">hold</span> : null}
      </>
    );
  }

  return null;
}

function normalizeFinishingLayersForUi(layers = []) {
  const normalized = (Array.isArray(layers) ? layers : []).map(normalizeFinishingLayerForUi).filter(Boolean);
  const seen = new Set();
  return normalized.filter((layer) => {
    if (layer.duplicatedFromLayerId) return true;
    const key = finishingLayerUiDedupeKey(layer);
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeFinishingLayerForUi(layer) {
  if (!layer?.id) return null;
  const type = ["image", "video", "audio"].includes(layer.type) ? layer.type : "image";
  return {
    ...layer,
    type,
    duplicatedFromLayerId: String(layer.duplicatedFromLayerId || "").trim(),
    cueKind: compactText(String(layer.cueKind || "").trim(), 24),
    cueLineId: String(layer.cueLineId || "").trim(),
    cueLineIndex: Math.max(0, Math.round(Number(layer.cueLineIndex) || 0)),
    cueScore: uiNumber(layer.cueScore, 0, 0, 99),
    cueIntensity: uiNumber(layer.cueIntensity, 0, 0, 1),
    cueConfidence: uiNumber(layer.cueConfidence, 0, 0, 1),
    cueSource: compactText(String(layer.cueSource || "").trim(), 60),
    cueReason: compactText(String(layer.cueReason || "").trim(), 220),
    enabled: layer.enabled !== false,
    startSeconds: uiNumber(layer.startSeconds, 0, 0, 9999),
    durationSeconds: uiNumber(layer.durationSeconds, 3, 0.1, 9999),
    sourceDurationSeconds: uiNumber(layer.sourceDurationSeconds, type === "image" ? 0 : layer.durationSeconds, 0, 9999),
    holdStartSeconds: uiNumber(layer.holdStartSeconds, 0, 0, 9999),
    sourceFileSize: Math.max(0, Math.round(Number(layer.sourceFileSize) || 0)),
    xPercent: uiNumber(layer.xPercent, type === "video" ? 0 : 5, 0, 100),
    yPercent: uiNumber(layer.yPercent, type === "video" ? 0 : 5, 0, 100),
    widthPercent: uiNumber(layer.widthPercent, type === "video" ? 100 : 35, 1, 220),
    opacity: uiNumber(layer.opacity, 1, 0, 1),
    volume: uiNumber(layer.volume, 0.8, 0, 2),
    fadeInSeconds: uiNumber(layer.fadeInSeconds, 0, 0, 10),
    fadeOutSeconds: uiNumber(layer.fadeOutSeconds, 0, 0, 10)
  };
}

function uiNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number * 1000) / 1000));
}

function uniqueUploadFiles(files = []) {
  const seen = new Set();
  return files.filter((file) => {
    const key = [file.name, file.size, file.type, file.lastModified].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function finishingLayerUiDedupeKey(layer) {
  const fileName = String(layer.fileName || layer.name || "").trim().toLowerCase();
  if (!layer.type || !fileName) return "";
  return [
    layer.type,
    fileName,
    layer.sourceDurationSeconds || "unknown-duration",
    layer.holdStartSeconds,
    layer.startSeconds,
    layer.durationSeconds,
    layer.xPercent,
    layer.yPercent,
    layer.widthPercent,
    layer.opacity,
    layer.volume,
    layer.fadeInSeconds,
    layer.fadeOutSeconds
  ].join("|");
}

function nextDuplicateLayerStart(layer, layers = [], timelineSeconds = 1) {
  const duration = Math.max(0.1, Number(layer.durationSeconds) || 0.1);
  const maxStart = Math.max(0, Number(timelineSeconds || 0) - duration);
  let start = clampTimelineValue((Number(layer.startSeconds) || 0) + 0.5, 0, maxStart);
  const existingStarts = new Set(
    (Array.isArray(layers) ? layers : [])
      .filter((item) => item?.id !== layer.id && item?.type === layer.type && item?.fileName === layer.fileName)
      .map((item) => roundTimelineValue(Number(item.startSeconds) || 0).toFixed(3))
  );
  let guard = 0;
  while (existingStarts.has(roundTimelineValue(start).toFixed(3)) && guard < 30) {
    start = clampTimelineValue(start + 0.5, 0, maxStart);
    guard += 1;
  }
  return roundTimelineValue(start);
}

function createLocalId(prefix = "id") {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function finishingLayerTypeLabel(type) {
  return {
    image: "Graphic overlay",
    video: "Video overlay",
    audio: "Audio layer"
  }[type] || "Layer";
}

function finishingLayerBarStyle(layer, totalSeconds) {
  const total = Math.max(0.1, Number(totalSeconds) || 1);
  const start = Math.max(0, Number(layer.startSeconds) || 0);
  const duration = Math.max(0.1, Number(layer.durationSeconds) || 0.1);
  return {
    left: `${Math.min(100, (start / total) * 100)}%`,
    width: `${Math.min(100, (duration / total) * 100)}%`
  };
}

function finishingLayerHoldSegments(layer) {
  if (layer.type !== "video" || !(Number(layer.sourceDurationSeconds) > 0)) return [];
  const duration = Math.max(0.1, Number(layer.durationSeconds) || 0.1);
  const sourceDuration = Math.max(0, Number(layer.sourceDurationSeconds) || 0);
  const frontHold = Math.min(duration, Math.max(0, Number(layer.holdStartSeconds) || 0));
  const sourceEnd = Math.min(duration, frontHold + sourceDuration);
  const endHold = Math.max(0, duration - sourceEnd);
  const segments = [];
  if (frontHold > 0.05) {
    segments.push({
      type: "start",
      style: {
        left: "0%",
        width: `${Math.max(0, (frontHold / duration) * 100)}%`
      }
    });
  }
  if (endHold > 0.05) {
    segments.push({
      type: "end",
      style: {
        left: `${Math.min(100, (sourceEnd / duration) * 100)}%`,
        width: `${Math.max(0, (endHold / duration) * 100)}%`
      }
    });
  }
  return segments;
}

function finishingTimelineTicks(totalSeconds) {
  const total = Math.max(1, Number(totalSeconds) || 1);
  const divisions = total <= 30 ? 5 : total <= 120 ? 6 : 8;
  return Array.from({ length: divisions + 1 }, (_, index) => {
    const seconds = roundTimelineValue((total / divisions) * index);
    return {
      seconds,
      left: Math.min(100, Math.max(0, (seconds / total) * 100))
    };
  });
}

function clampTimelineValue(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function roundTimelineValue(value) {
  return Math.round((Number(value) || 0) * 10) / 10;
}

function FinalPackagePanel({
  finalOutput,
  selectedThumbnail,
  latestPackage,
  latestYoutubeUpload,
  youtubeDraft,
  episodeTitle = "",
  episodeDescription = "",
  panelState = {},
  open = false,
  onOpenChange,
  onPanelOpenChange,
  socialConfig = {},
  ready,
  busy,
  busyAction,
  integrations,
  youtubeAuth,
  safety,
  launchReadiness,
  onSavePublishingDraft,
  onExportPackage,
  onCheckLaunchReadiness,
  onUploadYoutubeDraft,
  onRetryYoutubeThumbnail,
  onCheckYoutubeStatus,
  onConnectYoutube
}) {
  const youtubeDraftKey = JSON.stringify(youtubeDraft || {});
  const defaultYoutubeTitle = String(episodeTitle || "").trim();
  const defaultYoutubeDescription = String(episodeDescription || "").trim();
  const youtubeFormDefaults = (draft = {}) => ({
    title: draft.title || defaultYoutubeTitle,
    description: draft.description || defaultYoutubeDescription,
    tagsText: (draft.tags || []).join(", "),
    privacyStatus: "private",
    categoryId: draft.categoryId || "24",
    madeForKids: Boolean(draft.madeForKids),
    notifySubscribers: Boolean(draft.notifySubscribers),
    containsSyntheticMedia: draft.containsSyntheticMedia !== false,
    shortsThumbnail: Boolean(draft.shortsThumbnail),
    plannedPublishAt: draft.plannedPublishAt || "",
    publishNotes: draft.publishNotes || "",
    readyToPublish: Boolean(draft.readyToPublish),
    readyToPublishAt: draft.readyToPublishAt || "",
    handoffChecklist: {
      ...youtubeHandoffDefaults,
      ...(draft.handoffChecklist || {})
    },
    promotion: {
      ...youtubePromotionDefaults,
      ...(draft.promotion || {})
    }
  });
  const [youtubeForm, setYoutubeForm] = useState(() => ({
    ...youtubeFormDefaults(youtubeDraft)
  }));

  useEffect(() => {
    const next = JSON.parse(youtubeDraftKey || "{}");
    setYoutubeForm(youtubeFormDefaults(next));
  }, [youtubeDraftKey, defaultYoutubeTitle, defaultYoutubeDescription]);

  function updateYoutubeForm(key, value) {
    setYoutubeForm((prev) => ({
      ...prev,
      [key]: value,
      ...(key === "readyToPublish" || key === "readyToPublishAt"
        ? {}
        : {
            readyToPublish: false,
            readyToPublishAt: ""
          })
    }));
  }

  function publishingPayload() {
    return {
      youtube: {
        title: youtubeForm.title.trim().slice(0, 100),
        description: youtubeForm.description.trim(),
        tags: commaList(youtubeForm.tagsText).slice(0, 30),
        privacyStatus: "private",
        categoryId: youtubeForm.categoryId.trim() || "24",
        madeForKids: Boolean(youtubeForm.madeForKids),
        notifySubscribers: Boolean(youtubeForm.notifySubscribers),
        containsSyntheticMedia: Boolean(youtubeForm.containsSyntheticMedia),
        shortsThumbnail: Boolean(youtubeForm.shortsThumbnail),
        plannedPublishAt: youtubeForm.plannedPublishAt || "",
        publishNotes: youtubeForm.publishNotes.trim(),
        readyToPublish: Boolean(youtubeForm.readyToPublish),
        readyToPublishAt: youtubeForm.readyToPublishAt || "",
        handoffChecklist: {
          ...youtubeHandoffDefaults,
          ...(youtubeForm.handoffChecklist || {})
        },
        promotion: {
          ...youtubePromotionDefaults,
          ...(youtubeForm.promotion || {})
        }
      }
    };
  }

  function saveDraft() {
    return onSavePublishingDraft?.(publishingPayload());
  }

  function exportPackage() {
    return onExportPackage?.(publishingPayload());
  }

  function uploadPrivateDraft() {
    return onUploadYoutubeDraft?.(publishingPayload());
  }

  function retryThumbnail() {
    return onRetryYoutubeThumbnail?.();
  }

  function checkStatus() {
    return onCheckYoutubeStatus?.();
  }

  function updateHandoffCheck(key, checked) {
    setYoutubeForm((prev) => ({
      ...prev,
      handoffChecklist: {
        ...youtubeHandoffDefaults,
        ...(prev.handoffChecklist || {}),
        [key]: checked
      },
      readyToPublish: false,
      readyToPublishAt: ""
    }));
  }

  function updatePromotionField(key, value) {
    setYoutubeForm((prev) => ({
      ...prev,
      promotion: {
        ...youtubePromotionDefaults,
        ...(prev.promotion || {}),
        [key]: value
      },
      readyToPublish: false,
      readyToPublishAt: ""
    }));
  }

  function generatePromotionCopy() {
    const templates = normalizePromotionTemplates(socialConfig.templates);
    const context = promotionTemplateContext({
      title: youtubeForm.title,
      description: youtubeForm.description,
      watchUrl: latestYoutubeUpload?.watchUrl,
      showName: socialConfig.showName,
      hashtags: socialConfig.hashtags,
      cta: socialConfig.cta
    });
    const promotion = {
      communityPost: clampCopy(renderPromotionTemplate(templates.youtubeCommunity, context), youtubePromotionLimits.communityPost),
      pinnedComment: clampCopy(renderPromotionTemplate(templates.pinnedComment, context), youtubePromotionLimits.pinnedComment)
    };
    setYoutubeForm((prev) => ({
      ...prev,
      promotion,
      readyToPublish: false,
      readyToPublishAt: ""
    }));
  }

  function markReadyToPublish() {
    const readyAt = new Date().toISOString();
    setYoutubeForm((prev) => ({
      ...prev,
      readyToPublish: true,
      readyToPublishAt: readyAt
    }));
    return onSavePublishingDraft?.({
      youtube: {
        ...publishingPayload().youtube,
        readyToPublish: true,
        readyToPublishAt: readyAt
      }
    });
  }

  const youtubeReady = Boolean(integrations?.youtube);
  const youtubeNeedsReconnectForStatus = Boolean(youtubeAuth?.needsReconnectForStatus);
  const youtubeCanReadStatus = youtubeAuth?.canReadStatus !== false;
  const publishingUnlocked = Boolean(safety?.publishingEnabled);
  const launchReady = !launchReadiness || launchReadiness.canUploadPrivateDraft !== false;
  const canUploadDraft = ready && youtubeReady && publishingUnlocked && launchReady && !busy;
  const uploadBusy = busyAction === "youtube-upload";
  const thumbnailRetryBusy = busyAction === "youtube-thumbnail";
  const statusBusy = busyAction === "youtube-status";
  const canRetryThumbnail = Boolean(latestYoutubeUpload?.videoId && selectedThumbnail && youtubeReady && publishingUnlocked && !busy);
  const canCheckStatus = Boolean(latestYoutubeUpload?.videoId && youtubeReady && youtubeCanReadStatus && !busy);
  const liveYoutubeStatus = latestYoutubeUpload?.youtubeStatus || {};
  const thumbnailStatus = latestYoutubeUpload?.thumbnailSet
    ? "Custom thumbnail set"
    : latestYoutubeUpload?.thumbnailWarning
      ? "Thumbnail needs attention"
      : latestYoutubeUpload?.videoId
        ? "Waiting for thumbnail"
        : selectedThumbnail
          ? "Ready for upload"
          : "Select a thumbnail first";
  const thumbnailTone = latestYoutubeUpload?.thumbnailSet
    ? "good"
    : latestYoutubeUpload?.thumbnailWarning
      ? "warn"
      : selectedThumbnail
        ? "neutral"
        : "warn";
  const youtubeSummaryTone = latestYoutubeUpload?.videoId ? (latestYoutubeUpload.thumbnailSet ? "good" : "warn") : ready ? "good" : "warn";
  const youtubeSummaryLabel = latestYoutubeUpload?.videoId ? (latestYoutubeUpload.thumbnailSet ? "draft ready" : "thumb warning") : ready ? "ready" : "needed";
  const readyToPublish = Boolean(youtubeForm.readyToPublish);
  const handoffChecklist = {
    ...youtubeHandoffDefaults,
    ...(youtubeForm.handoffChecklist || {})
  };
  const completedHandoffChecks = youtubeHandoffChecks.filter(([key]) => handoffChecklist[key]).length;
  const handoffComplete = completedHandoffChecks === youtubeHandoffChecks.length;
  const youtubePromotion = {
    ...youtubePromotionDefaults,
    ...(youtubeForm.promotion || {})
  };
  const promotionReady = Boolean(youtubePromotion.communityPost.trim() && youtubePromotion.pinnedComment.trim());
  const statusCheckedLabel = liveYoutubeStatus.checkedAt ? new Date(liveYoutubeStatus.checkedAt).toLocaleString() : "Not checked yet";
  const youtubeWatchUrl = latestYoutubeUpload?.watchUrl || latestYoutubeUpload?.localUrl || "";
  const youtubeStudioUrl = latestYoutubeUpload?.studioUrl || "";
  const plannedPublishLabel = youtubeForm.plannedPublishAt ? dateTimeLabel(youtubeForm.plannedPublishAt) : "No schedule target";
  const shortsThumbnailRequested = Boolean(youtubeForm.shortsThumbnail);
  const shortsThumbnailUploadLabel = latestYoutubeUpload?.shortsThumbnailApplied
    ? `added${latestYoutubeUpload.shortsThumbnailFrameSeconds ? ` (${latestYoutubeUpload.shortsThumbnailFrameSeconds}s)` : ""}`
    : shortsThumbnailRequested
      ? "not confirmed"
      : "not requested";
  const completionState = latestYoutubeUpload?.videoId
    ? readyToPublish
      ? "Ready for manual publishing"
      : "Private draft uploaded"
    : ready
      ? "Ready for private draft"
      : "Finish render package";
  const finalQaChecks = [
    {
      id: "final-video",
      label: "Final render",
      detail: finalOutput?.name || finalOutput?.fileName || "Render final video",
      status: finalOutput?.localUrl ? "pass" : "fail"
    },
    {
      id: "thumbnail",
      label: "Final thumbnail",
      detail: selectedThumbnail?.name || selectedThumbnail?.fileName || "Select one thumbnail",
      status: selectedThumbnail?.localUrl ? "pass" : "fail"
    },
    {
      id: "metadata",
      label: "YouTube metadata",
      detail: youtubeForm.title.trim()
        ? `${Math.min(youtubeForm.title.trim().length, 100)}/100 title chars`
        : "Add title and description",
      status: youtubeForm.title.trim() && youtubeForm.description.trim() ? "pass" : "warning"
    },
    {
      id: "draft",
      label: "YouTube",
      detail: latestYoutubeUpload?.videoId || "Upload to YouTube",
      status: latestYoutubeUpload?.videoId ? "pass" : "warning"
    },
    {
      id: "thumb-status",
      label: "YouTube thumbnail",
      detail: thumbnailStatus,
      status: latestYoutubeUpload?.thumbnailSet ? "pass" : latestYoutubeUpload?.videoId ? "warning" : "warning"
    },
    {
      id: "schedule",
      label: "Schedule plan",
      detail: plannedPublishLabel,
      status: youtubeForm.plannedPublishAt || handoffChecklist.scheduledManually ? "pass" : "warning"
    }
  ];
  const completedFinalQaChecks = finalQaChecks.filter((check) => check.status === "pass").length;

  return (
    <details
      className="reviewDetails finalPackagePanel"
      open={open}
      onToggle={(event) => onOpenChange?.(event.currentTarget.open)}
    >
      <summary>
        <span>YouTube Publish</span>
        <Pill tone={youtubeSummaryTone}>{youtubeSummaryLabel}</Pill>
      </summary>
      <div className="finalPackageBody">
        <div className={`episodeCompletePanel ${latestYoutubeUpload?.videoId ? "uploaded" : ""}`}>
          <div className="episodeCompleteHeader">
            <div>
              <span className="eyebrow">YouTube Publish</span>
              <strong>{completionState}</strong>
              <p>Review the finished render, selected thumbnail, YouTube upload, and manual schedule status from one place.</p>
            </div>
            <Pill tone={latestYoutubeUpload?.videoId ? (readyToPublish ? "good" : "neutral") : ready ? "good" : "warn"}>
              {latestYoutubeUpload?.videoId ? (readyToPublish ? "ready" : "draft") : ready ? "package ready" : "needs work"}
            </Pill>
          </div>
          <div className="episodeReviewGrid">
            <article>
              <Film size={17} />
              <div>
                <span>Final video</span>
                <strong>{finalOutput?.name || finalOutput?.fileName || "No final render yet"}</strong>
                {finalOutput?.localUrl ? (
                  <a href={finalOutput.localUrl} target="_blank" rel="noreferrer">Open final render</a>
                ) : null}
              </div>
            </article>
            <article>
              <Youtube size={17} />
              <div>
                <span>YouTube</span>
                <strong>{latestYoutubeUpload?.videoId || "Not uploaded yet"}</strong>
                {youtubeWatchUrl ? (
                  <a href={youtubeWatchUrl} target="_blank" rel="noreferrer">Open YouTube</a>
                ) : null}
              </div>
            </article>
            <article>
              <MonitorUp size={17} />
              <div>
                <span>Schedule status</span>
                <strong>{handoffChecklist.scheduledManually ? "Scheduled in Studio" : plannedPublishLabel}</strong>
                {youtubeStudioUrl ? (
                  <a href={youtubeStudioUrl} target="_blank" rel="noreferrer">Open Studio</a>
                ) : null}
              </div>
            </article>
          </div>
          <div className="finalQaChecklist">
            <div className="finalQaHeader">
              <div>
                <strong>Final QA Checklist</strong>
                <span>Warnings are allowed, but they keep release attention visible.</span>
              </div>
              <Pill tone={completedFinalQaChecks === finalQaChecks.length ? "good" : "neutral"}>
                {completedFinalQaChecks}/{finalQaChecks.length}
              </Pill>
            </div>
            <div className="finalQaGrid">
              {finalQaChecks.map((check) => (
                <div key={check.id} className={`finalQaItem ${check.status}`}>
                  <div className="readinessIcon">
                    {check.status === "pass" ? <Check size={15} /> : <CircleAlert size={15} />}
                  </div>
                  <div>
                    <strong>{check.label}</strong>
                    <span>{check.detail}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {selectedThumbnail?.localUrl ? (
            <div className="episodeThumbnailStrip">
              <img src={selectedThumbnail.localUrl} alt="" style={mediaAspectStyle(selectedThumbnail)} />
              <div>
                <span className="eyebrow">Selected Thumbnail</span>
                <strong>{selectedThumbnail.name || selectedThumbnail.fileName}</strong>
              </div>
            </div>
          ) : null}
        </div>

        <div className="packageAssetGrid">
          <article>
            <Film size={17} />
            <div>
              <strong>Final video</strong>
              <span>{finalOutput?.name || finalOutput?.fileName || "Render final video first"}</span>
            </div>
          </article>
          <article>
            <Image size={17} />
            <div>
              <strong>Final thumbnail</strong>
              <span>{selectedThumbnail?.name || selectedThumbnail?.fileName || "Select a thumbnail first"}</span>
            </div>
          </article>
          <article>
            <Youtube size={17} />
            <div>
              <strong>YouTube</strong>
              <span>
                {latestYoutubeUpload?.videoId
                  ? `Private draft ${latestYoutubeUpload.videoId}`
                  : youtubeNeedsReconnectForStatus
                    ? "Reconnect to read status"
                    : youtubeReady
                    ? publishingUnlocked
                      ? "Ready to upload private draft"
                      : "Publishing lock is on"
                    : "OAuth not connected"}
              </span>
            </div>
          </article>
          <article>
            <BadgeCheck size={17} />
            <div>
              <strong>Thumbnail status</strong>
              <span>{thumbnailStatus}</span>
            </div>
          </article>
          <article>
            <MonitorUp size={17} />
            <div>
              <strong>Publish readiness</strong>
              <span>{readyToPublish ? "Ready for manual publish" : "Not marked ready"}</span>
            </div>
          </article>
        </div>

        <LaunchReadinessPanel
          readiness={launchReadiness}
          open={savedPanelOpen(panelState, "approvals.launchReadiness")}
          onOpenChange={(isOpen) => onPanelOpenChange?.("approvals.launchReadiness", isOpen)}
          busy={busy}
          busyAction={busyAction}
          onCheck={onCheckLaunchReadiness}
        />

        {latestYoutubeUpload?.videoId ? (
          <div className={`youtubeHandoffStatus ${latestYoutubeUpload.thumbnailSet ? "ready" : "warning"}`}>
            <div>
              <strong>Private draft uploaded</strong>
              <span>
                {latestYoutubeUpload.videoId}
                {latestYoutubeUpload.thumbnailWarning ? ` - ${latestYoutubeUpload.thumbnailWarning}` : ""}
                {latestYoutubeUpload.shortsThumbnailApplied ? " - Shorts thumbnail frame added" : ""}
              </span>
            </div>
            <Pill tone={thumbnailTone}>{latestYoutubeUpload.thumbnailSet ? "thumbnail set" : "thumbnail warning"}</Pill>
          </div>
        ) : null}

        {latestYoutubeUpload?.videoId ? (
          <div className="youtubeDraftManager">
            <div className="draftManagerHeader">
              <div>
                <strong>YouTube Manager</strong>
                <span>Checks YouTube state and keeps scheduling decisions inside NewtBuilder.</span>
              </div>
              <Pill tone="neutral">manual publish only</Pill>
            </div>
            <div className="draftStatusGrid">
              <article>
                <span>Privacy</span>
                <strong>{liveYoutubeStatus.privacyStatus || latestYoutubeUpload.privacyStatus || "private"}</strong>
              </article>
              <article>
                <span>Upload</span>
                <strong>{liveYoutubeStatus.uploadStatus || "unchecked"}</strong>
              </article>
              <article>
                <span>Processing</span>
                <strong>{liveYoutubeStatus.processingStatus || "unchecked"}</strong>
              </article>
              <article className={latestYoutubeUpload.shortsThumbnailApplied ? "ready" : shortsThumbnailRequested ? "warning" : ""}>
                <span>Shorts frame</span>
                <strong>{shortsThumbnailUploadLabel}</strong>
              </article>
              <article>
                <span>Last checked</span>
                <strong>{statusCheckedLabel}</strong>
              </article>
            </div>
            <div className="handoffChecklist">
              <div className="draftManagerHeader">
                <div>
                  <strong>Manual Handoff Checklist</strong>
                  <span>Track the checks that happen outside NewtBuilder before public release.</span>
                </div>
                <Pill tone={handoffComplete ? "good" : "neutral"}>
                  {completedHandoffChecks}/{youtubeHandoffChecks.length}
                </Pill>
              </div>
              <div className="handoffChecklistGrid">
                {youtubeHandoffChecks.map(([key, label]) => (
                  <label key={key} className={`handoffCheck ${handoffChecklist[key] ? "checked" : ""}`}>
                    <input
                      type="checkbox"
                      checked={Boolean(handoffChecklist[key])}
                      onChange={(event) => updateHandoffCheck(key, event.target.checked)}
                    />
                    <span className="handoffCheckIcon">
                      <Check size={14} />
                    </span>
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </div>
            {youtubeNeedsReconnectForStatus ? (
              <div className="manualPublishNotice warning">
                YouTube is connected for uploads, but status checks need one more Google reconnect to approve readonly access.
              </div>
            ) : null}
            <div className="manualPublishNotice">
              YouTube does not let NewtBuilder replace the video file on an existing upload. To replace this draft, republish a new private draft, then delete the old upload or leave it private in Studio.
            </div>
            {shortsThumbnailRequested && latestYoutubeUpload?.videoId && !latestYoutubeUpload.shortsThumbnailApplied ? (
              <div className="manualPublishNotice warning">
                Shorts Thumbnail is on, but this upload did not confirm that the final-frame thumbnail was added. Restart the NewtBuilder API, then republish this draft.
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="packageMetadata">
          <Field label="YouTube title">
            <input value={youtubeForm.title} maxLength={100} onChange={(event) => updateYoutubeForm("title", event.target.value)} />
          </Field>
          <Field label="YouTube privacy">
            <input value="Private draft" readOnly />
          </Field>
          <Field label="Description">
            <textarea value={youtubeForm.description} rows={5} onChange={(event) => updateYoutubeForm("description", event.target.value)} />
          </Field>
          <Field label="Tags">
            <input value={youtubeForm.tagsText} onChange={(event) => updateYoutubeForm("tagsText", event.target.value)} />
          </Field>
          <Field label="Category ID">
            <input value={youtubeForm.categoryId} onChange={(event) => updateYoutubeForm("categoryId", event.target.value)} />
          </Field>
          <Field label="Manual schedule target">
            <input
              type="datetime-local"
              value={youtubeForm.plannedPublishAt}
              onChange={(event) => updateYoutubeForm("plannedPublishAt", event.target.value)}
            />
          </Field>
          <Field label="Publish notes">
            <textarea
              value={youtubeForm.publishNotes}
              rows={3}
              placeholder="Manual launch notes, client approval, or reminders"
              onChange={(event) => updateYoutubeForm("publishNotes", event.target.value)}
            />
          </Field>
          <div className="packageToggleGrid">
            <Toggle
              checked={youtubeForm.containsSyntheticMedia}
              onChange={(checked) => updateYoutubeForm("containsSyntheticMedia", checked)}
              label="Synthetic media"
              icon={Sparkles}
            />
            <Toggle
              checked={youtubeForm.madeForKids}
              onChange={(checked) => updateYoutubeForm("madeForKids", checked)}
              label="Made for kids"
              icon={BadgeCheck}
            />
            <Toggle
              checked={youtubeForm.notifySubscribers}
              onChange={(checked) => updateYoutubeForm("notifySubscribers", checked)}
              label="Notify subs"
              icon={MonitorUp}
            />
            <Toggle
              checked={youtubeForm.shortsThumbnail}
              onChange={(checked) => updateYoutubeForm("shortsThumbnail", checked)}
              label="Shorts thumbnail"
              icon={Film}
            />
          </div>
          {youtubeForm.shortsThumbnail ? (
            <div className="manualPublishNotice">
              Shorts Thumbnail adds the selected thumbnail as the final held frame of the uploaded video so YouTube Shorts can pick it from the video. The local final render stays unchanged.
            </div>
          ) : null}
          <div className="manualPublishNotice">
            NewtBuilder uploads private drafts only. The schedule target and notes are saved here, then applied manually in YouTube Studio.
          </div>
        </div>

        <details
          className="advancedYoutubeActions youtubePromotionPanel"
          open={savedPanelOpen(panelState, "approvals.youtubePromotion")}
          onToggle={(event) => onPanelOpenChange?.("approvals.youtubePromotion", event.currentTarget.open)}
        >
          <summary>
            <span>Promotion Prep</span>
            <Pill tone={promotionReady ? "good" : "neutral"}>{promotionReady ? "drafted" : "YouTube only"}</Pill>
          </summary>
          <div className="promotionPrepBody">
            <div className="promotionPrepHeader">
              <span>Prepare copy for a manual YouTube Community post and pinned comment.</span>
              <button className="secondaryButton" type="button" onClick={generatePromotionCopy} disabled={busy}>
                <WandSparkles size={16} />
                Draft Copy
              </button>
            </div>
            <div className="promotionCopyGrid">
              <Field label="Community post">
                <textarea
                  value={youtubePromotion.communityPost}
                  rows={5}
                  placeholder="Draft a Community post after the episode is published."
                  onChange={(event) => updatePromotionField("communityPost", event.target.value)}
                />
              </Field>
              <Field label="Pinned comment">
                <textarea
                  value={youtubePromotion.pinnedComment}
                  rows={5}
                  placeholder="Draft the comment to pin below the uploaded episode."
                  onChange={(event) => updatePromotionField("pinnedComment", event.target.value)}
                />
              </Field>
            </div>
            <div className="manualPublishNotice">
              These drafts are saved with YouTube Publish and included in the export package. Posting remains manual.
            </div>
          </div>
        </details>

        <div className="packageActions primaryYoutubeActions">
          <button className="secondaryButton" onClick={saveDraft} disabled={busy}>
            <Save size={16} />
            Save YouTube Publish
          </button>
          <button className="secondaryButton" onClick={onConnectYoutube} disabled={busy}>
            <Youtube size={16} />
            {youtubeReady ? "Reconnect YouTube" : "Connect YouTube"}
          </button>
          {latestYoutubeUpload?.videoId ? (
            <button
              className="secondaryButton"
              onClick={checkStatus}
              disabled={!canCheckStatus}
              title={
                youtubeNeedsReconnectForStatus
                  ? "Reconnect YouTube to approve status-read access"
                  : "Pull the current private draft status from YouTube"
              }
            >
              {statusBusy ? <RefreshCw className="spin" size={16} /> : <Activity size={16} />}
              Check YouTube Status
            </button>
          ) : null}
          {!latestYoutubeUpload?.videoId ? (
            <button
              className="runButton"
              onClick={uploadPrivateDraft}
              disabled={!canUploadDraft}
              title={
                canUploadDraft
                  ? "Upload this final video and thumbnail privately to YouTube"
                  : !ready
                    ? "Render final video and select a thumbnail first"
                    : !youtubeReady
                      ? "Add YouTube OAuth credentials first"
                    : !publishingUnlocked
                      ? "Set NEWTBUILDER_ENABLE_PUBLISHING=true to unlock private draft uploads"
                      : !launchReady
                        ? "Clear the Launch Readiness blockers first"
                        : "Upload is unavailable"
              }
            >
              {uploadBusy ? <RefreshCw className="spin" size={17} /> : <MonitorUp size={17} />}
              Upload to YouTube
            </button>
          ) : null}
          {latestYoutubeUpload?.videoId ? (
            <button
              className="runButton"
              onClick={uploadPrivateDraft}
              disabled={!canUploadDraft}
              title={
                canUploadDraft
                  ? "Upload the current final video and thumbnail privately to YouTube"
                  : !ready
                    ? "Render final video and select a thumbnail first"
                    : !youtubeReady
                      ? "Add YouTube OAuth credentials first"
                    : !publishingUnlocked
                      ? "Set NEWTBUILDER_ENABLE_PUBLISHING=true to unlock private draft uploads"
                      : !launchReady
                        ? "Clear the Launch Readiness blockers first"
                        : "Republish is unavailable"
              }
            >
              {uploadBusy ? <RefreshCw className="spin" size={17} /> : <Upload size={17} />}
              Republish to YouTube
            </button>
          ) : null}
          {latestYoutubeUpload?.videoId && !readyToPublish ? (
            <button
              className="secondaryButton"
              onClick={markReadyToPublish}
              disabled={busy || !handoffComplete}
              title={handoffComplete ? "Mark this episode ready for manual publishing" : "Complete the manual handoff checklist first"}
            >
              <BadgeCheck size={16} />
              Mark Ready
            </button>
          ) : null}
          {latestYoutubeUpload?.studioUrl ? (
            <a className="secondaryButton" href={latestYoutubeUpload.studioUrl} target="_blank" rel="noreferrer">
              <MonitorUp size={16} />
              Open Studio
            </a>
          ) : null}
          {latestYoutubeUpload?.videoId && !latestYoutubeUpload.thumbnailSet ? (
            <button
              className="secondaryButton"
              onClick={retryThumbnail}
              disabled={!canRetryThumbnail}
              title={
                canRetryThumbnail
                  ? "Retry setting the selected thumbnail on the existing YouTube upload"
                  : "Connect YouTube, unlock publishing, and select a thumbnail first"
              }
            >
              {thumbnailRetryBusy ? <RefreshCw className="spin" size={16} /> : <Image size={16} />}
              Retry Thumbnail
            </button>
          ) : null}
        </div>

        <details
          className="advancedYoutubeActions"
          open={savedPanelOpen(panelState, "approvals.youtubeAdvanced")}
          onToggle={(event) => onPanelOpenChange?.("approvals.youtubeAdvanced", event.currentTarget.open)}
        >
          <summary>Advanced & files</summary>
          <div className="packageActions">
            <button className="secondaryButton" onClick={exportPackage} disabled={!ready || busy}>
              <FileText size={17} />
              Export Package
            </button>
            {latestYoutubeUpload?.videoId ? (
              <div className="manualPublishNotice">
                Existing YouTube uploads can update metadata and thumbnails, but replacing the video file requires a new upload.
              </div>
            ) : null}
            {latestPackage?.localUrl ? (
              <>
                <a className="secondaryButton" href={latestPackage.localUrl} target="_blank" rel="noreferrer">
                  <FileText size={16} />
                  Metadata
                </a>
                {latestPackage.textLocalUrl ? (
                  <a className="secondaryButton" href={latestPackage.textLocalUrl} target="_blank" rel="noreferrer">
                    <FileText size={16} />
                    Upload Text
                  </a>
                ) : null}
                {(latestPackage.promotionTextLocalUrl || latestPackage.campaignTextLocalUrl) ? (
                  <a
                    className="secondaryButton"
                    href={latestPackage.promotionTextLocalUrl || latestPackage.campaignTextLocalUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <WandSparkles size={16} />
                    Promotion Packet
                  </a>
                ) : null}
              </>
            ) : null}
            {latestYoutubeUpload?.watchUrl ? (
              <a className="secondaryButton" href={latestYoutubeUpload.watchUrl} target="_blank" rel="noreferrer">
                <Youtube size={16} />
                Open Draft
              </a>
            ) : null}
          </div>
        </details>
      </div>
    </details>
  );
}

function LaunchReadinessPanel({ readiness, open = false, onOpenChange, busy, busyAction, onCheck }) {
  const checkBusy = busyAction === "launch-readiness";
  const tone = readiness?.ready ? "good" : readiness ? "danger" : "neutral";
  const label = readiness?.ready ? "ready" : readiness ? "blocked" : "unchecked";
  const groups = [
    ["episode", "Episode"],
    ["render", "Render"],
    ["youtube", "YouTube"]
  ];

  return (
    <div className="launchReadinessPanel">
      <div className="launchReadinessHeader">
        <div>
          <strong>Pre-upload QA</strong>
          <span>{readiness?.summary || "Checks the completed episode, thumbnail, YouTube auth, and private draft safety without uploading."}</span>
        </div>
        <div className="launchReadinessActions">
          <Pill tone={tone}>{label}</Pill>
          <button className="secondaryButton" type="button" onClick={onCheck} disabled={busy && !checkBusy}>
            {checkBusy ? <RefreshCw className="spin" size={16} /> : <ListChecks size={16} />}
            Check
          </button>
        </div>
      </div>

      {readiness?.checks?.length ? (
        <details
          className="launchReadinessDetails"
          open={open}
          onToggle={(event) => onOpenChange?.(event.currentTarget.open)}
        >
          <summary>
            <span>QA checks</span>
            <Pill tone={readiness.ready ? "good" : "danger"}>
              {readiness.blockers?.length || 0} blockers
            </Pill>
          </summary>
          <div className="launchReadinessGrid">
            {groups.map(([groupId, title]) => {
              const checks = readiness.checks.filter((check) => check.group === groupId);
              if (!checks.length) return null;
              return (
                <div key={groupId} className="launchReadinessGroup">
                  <h4>{title}</h4>
                  {checks.map((check) => (
                    <div key={check.id} className={`readinessItem compact ${check.status}`}>
                      <div className="readinessIcon">
                        {check.status === "pass" ? <Check size={15} /> : <CircleAlert size={15} />}
                      </div>
                      <div>
                        <strong>{check.label}</strong>
                        <span>{check.detail}</span>
                      </div>
                      <Pill tone={readinessTone(check.status)}>{check.status}</Pill>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function ApprovalGate({ gate, onApprove, compact = false }) {
  const tone = statusTone(gate.status);
  return (
    <article className={`approvalGate ${compact ? "compact" : ""}`}>
      <div className="gateIcon">
        {gate.status === "approved" || gate.status === "auto" ? <Check size={18} /> : <ListChecks size={18} />}
      </div>
      <div>
        <strong>{gate.title}</strong>
        <span>{gate.stage}</span>
      </div>
      <Pill tone={tone}>{gate.status}</Pill>
      {!compact && (
        <div className="gateActions">
          <button className="secondaryButton" onClick={() => onApprove(gate.id, "approved")}>
            <Check size={16} />
            {gate.actionLabel}
          </button>
          <button className="quietButton" onClick={() => onApprove(gate.id, "blocked")}>
            Hold
          </button>
        </div>
      )}
    </article>
  );
}

const productionMapInteractiveSelector = [
  "button",
  "input",
  "select",
  "textarea",
  "label",
  "a",
  "audio",
  "video",
  "canvas",
  "[contenteditable='true']",
  ".insertTrimRail",
  ".thumbnailScrubRail",
  ".maskEditorBackdrop"
].join(",");

function productionMapInteractiveElement(target) {
  return target instanceof Element && Boolean(target.closest(productionMapInteractiveSelector));
}

function productionMapInteractiveEvent(event) {
  return productionMapInteractiveElement(event.target);
}

function ProductionMapPanel({
  productionMap,
  show,
  format,
  characters,
  voices,
  shotTypes,
  visualAssets,
  maskAssets,
  onUpdate,
  onSetCharacter,
  onDeleteLine,
  onReorderLine,
  onGroupLines,
  onUngroupLines,
  onRegenerateAudio,
  onSetAudioStatus,
  onOpenMaskEditor,
  onGenerateDialogueVideo,
  onSelectDialogueVideoTake,
  onGenerateMissingDialogueVideos,
  onGenerateInsertVideo,
  onUploadInsertVideo,
  onSave,
  resetKey,
  defaultOpen = false,
  onOpenChange,
  busyAction,
  busy
}) {
  const hasLines = productionMap.length > 0;
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [selectedLineIds, setSelectedLineIds] = useState(() => new Set());
  const [dragLineId, setDragLineId] = useState("");
  const [dropTarget, setDropTarget] = useState(null);
  const [collapsedGroupIds, setCollapsedGroupIds] = useState(() => new Set());
  const groupBlocks = useMemo(() => productionMapGroupBlocks(productionMap), [productionMap]);
  const selectedIds = useMemo(() => [...selectedLineIds], [selectedLineIds]);
  const selectedLines = useMemo(
    () => productionMap.filter((line) => selectedLineIds.has(line.id)),
    [productionMap, selectedLineIds]
  );
  const selectedGroupedLines = selectedLines.filter((line) => line.groupId);
  const missingDialogueVideoCount = productionMap.filter(
    (line) => line.lineType !== "insert" && line.audioTake?.localUrl && !line.videoTake?.localUrl
  ).length;

  useEffect(() => {
    setIsOpen(defaultOpen);
  }, [defaultOpen, resetKey]);

  useEffect(() => {
    setSelectedLineIds((current) => {
      if (!current.size) return current;
      const available = new Set(productionMap.map((line) => line.id));
      const next = new Set([...current].filter((lineId) => available.has(lineId)));
      return next.size === current.size ? current : next;
    });
  }, [productionMap]);

  useEffect(() => {
    setCollapsedGroupIds((current) => {
      const available = new Set(groupBlocks.filter((block) => block.type === "group").map((block) => block.groupId));
      const next = new Set([...current].filter((groupId) => available.has(groupId)));
      return next.size === current.size ? current : next;
    });
  }, [groupBlocks]);

  useEffect(() => {
    function handleKeyDown(event) {
      const isDeleteKey = event.key === "Delete" || event.key === "Backspace";
      if (!isDeleteKey || !selectedLineIds.size || productionMapInteractiveElement(document.activeElement)) return;
      if (document.querySelector(".maskEditorBackdrop")) return;
      const selectedIndexes = productionMap
        .map((line, index) => (selectedLineIds.has(line.id) ? index : -1))
        .filter((index) => index >= 0);
      if (!selectedIndexes.length) return;
      event.preventDefault();
      const lastIndex = selectedIndexes.at(-1);
      const nextSelection = productionMap[lastIndex + 1]?.id || productionMap[selectedIndexes[0] - 1]?.id || "";
      for (const lineId of selectedIds) {
        onDeleteLine(lineId);
      }
      setSelectedLineIds(nextSelection ? new Set([nextSelection]) : new Set());
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onDeleteLine, productionMap, selectedIds, selectedLineIds]);

  function assetsForLine(line) {
    const selected = visualAssets.find((asset) => asset.id === line.assetId);
    const matching = visualAssets.filter((asset) => asset.shotRole === line.shotRole);
    const options = matching.length ? matching : visualAssets;
    return selected && !options.some((asset) => asset.id === selected.id) ? [selected, ...options] : options;
  }

  function updateShotRole(line, shotRole) {
    onUpdate(line.id, {
      shotRole,
      assetId: "",
      needsMask: false,
      maskAssetId: "",
      invertMask: false,
      videoStatus: "pending",
      videoTake: null
    });
  }

  function selectRow(event, lineId) {
    if (productionMapInteractiveEvent(event)) return;
    setSelectedLineIds((current) => {
      if (event.shiftKey && current.size) {
        const anchorId = [...current].at(-1);
        const anchorIndex = productionMap.findIndex((line) => line.id === anchorId);
        const targetIndex = productionMap.findIndex((line) => line.id === lineId);
        if (anchorIndex >= 0 && targetIndex >= 0) {
          const [start, end] = [Math.min(anchorIndex, targetIndex), Math.max(anchorIndex, targetIndex)];
          return new Set(productionMap.slice(start, end + 1).map((line) => line.id));
        }
      }
      if (event.metaKey || event.ctrlKey) {
        const next = new Set(current);
        if (next.has(lineId)) next.delete(lineId);
        else next.add(lineId);
        return next;
      }
      return new Set([lineId]);
    });
  }

  function startDrag(event, lineId) {
    if (productionMapInteractiveEvent(event)) {
      event.preventDefault();
      return;
    }
    if (!selectedLineIds.has(lineId)) {
      setSelectedLineIds(new Set([lineId]));
    }
    setDragLineId(lineId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", lineId);
  }

  function updateDropTarget(event, lineId) {
    if (!dragLineId || dragLineId === lineId) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const placement = event.clientY > rect.top + rect.height / 2 ? "after" : "before";
    setDropTarget({ lineId, placement });
    event.dataTransfer.dropEffect = "move";
  }

  function finishDrop(event, lineId) {
    event.preventDefault();
    const sourceLineId = event.dataTransfer.getData("text/plain") || dragLineId;
    if (sourceLineId && sourceLineId !== lineId) {
      const rect = event.currentTarget.getBoundingClientRect();
      const placement = event.clientY > rect.top + rect.height / 2 ? "after" : "before";
      onReorderLine(sourceLineId, lineId, placement);
      setSelectedLineIds(new Set([sourceLineId]));
    }
    setDragLineId("");
    setDropTarget(null);
  }

  function toggleGroup(groupId) {
    setCollapsedGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  function toggleOpen() {
    setIsOpen((value) => {
      const next = !value;
      onOpenChange?.(next);
      return next;
    });
  }

  return (
    <section className={`workPanel productionMapPanel collapsiblePanel ${isOpen ? "open" : "closed"}`}>
      <div className="panelHeader collapsibleHeader">
        <button
          type="button"
          className="collapseTitle"
          onClick={toggleOpen}
          aria-expanded={isOpen}
        >
          <ChevronRight size={18} className={isOpen ? "open" : ""} />
          <div>
            <span className="eyebrow">Script Production Map</span>
            <h3>Voices, Shots & Masks</h3>
          </div>
        </button>
        <div className="buttonRow">
          <button className="secondaryButton" type="button" onClick={onSave} disabled={busy}>
            <Save size={15} />
            Save Map
          </button>
          {selectedLineIds.size >= 2 ? (
            <button className="secondaryButton" type="button" onClick={() => onGroupLines(selectedIds)}>
              <Plus size={15} />
              Group selected
            </button>
          ) : null}
          {selectedGroupedLines.length ? (
            <button className="quietButton" type="button" onClick={() => onUngroupLines(selectedIds)}>
              Ungroup
            </button>
          ) : null}
          {missingDialogueVideoCount ? (
            <button
              className="secondaryButton"
              type="button"
              onClick={onGenerateMissingDialogueVideos}
              disabled={busy}
            >
              {busyAction?.startsWith("dialogue-video:") ? <RefreshCw className="spin" size={15} /> : <Film size={15} />}
              Generate missing videos
            </button>
          ) : null}
          {selectedLineIds.size ? <Pill tone="good">{selectedLineIds.size} selected</Pill> : null}
          <Pill tone={groupBlocks.some((block) => block.type === "group") ? "good" : "neutral"}>
            {groupBlocks.filter((block) => block.type === "group").length} groups
          </Pill>
          <Pill tone={hasLines ? "good" : "neutral"}>{productionMap.length} lines</Pill>
        </div>
      </div>

      {isOpen && (hasLines ? (
        <div className="productionBlockList">
          {groupBlocks.map((block) => {
            if (block.type === "line") {
              const line = block.line;
              const isInsert = line.lineType === "insert";
              const selectedAsset = visualAssets.find((asset) => asset.id === line.assetId);
              const selectedMask = maskAssets.find((asset) => asset.id === line.maskAssetId);
              const isSelected = selectedLineIds.has(line.id);
              const isDragging = dragLineId === line.id;
              const dropPlacement = dropTarget?.lineId === line.id ? dropTarget.placement : "";
              const reviewStatus = isInsert
                ? line.videoStatus || (line.videoTake?.localUrl ? "generated" : "pending")
                : line.audioStatus || (line.audioTake?.localUrl ? "pending" : "missing");
              return (
                <ProductionLineRow
                  key={line.id}
                  line={line}
                  show={show}
                  format={format}
                  isInsert={isInsert}
                  selectedAsset={selectedAsset}
                  selectedMask={selectedMask}
                  isSelected={isSelected}
                  isDragging={isDragging}
                  dropPlacement={dropPlacement}
                  reviewStatus={reviewStatus}
                  characters={characters}
                  voices={voices}
                  shotTypes={shotTypes}
                  assetsForLine={assetsForLine}
                  busy={busy}
                  busyAction={busyAction}
                  onSelect={selectRow}
                  onDragStart={startDrag}
                  onDragOver={updateDropTarget}
                  onDrop={finishDrop}
                  onClearDrop={() => setDropTarget(null)}
                  onUpdate={onUpdate}
                  onSetCharacter={onSetCharacter}
                  onUpdateShotRole={updateShotRole}
                  onRegenerateAudio={onRegenerateAudio}
                  onSetAudioStatus={onSetAudioStatus}
                  onOpenMaskEditor={onOpenMaskEditor}
                  onGenerateDialogueVideo={onGenerateDialogueVideo}
                  onSelectDialogueVideoTake={onSelectDialogueVideoTake}
                  onGenerateInsertVideo={onGenerateInsertVideo}
                  onUploadInsertVideo={onUploadInsertVideo}
                  onDragEnd={() => {
                    setDragLineId("");
                    setDropTarget(null);
                  }}
                />
              );
            }

            const groupCollapsed = collapsedGroupIds.has(block.groupId);
            return (
              <section className={`productionGroupBlock ${groupCollapsed ? "collapsed" : ""}`} key={block.blockId}>
                <button
                  type="button"
                  className="productionGroupHeader"
                  onClick={() => toggleGroup(block.groupId)}
                  aria-expanded={!groupCollapsed}
                >
                  <ChevronRight size={16} className={groupCollapsed ? "" : "open"} />
                  <span>{block.groupTitle}</span>
                  <Pill tone="neutral">{block.lines.length} lines</Pill>
                </button>
                {!groupCollapsed && (
                  <div className="productionLineList">
                    {block.lines.map((line) => {
                      const isInsert = line.lineType === "insert";
                      const selectedAsset = visualAssets.find((asset) => asset.id === line.assetId);
                      const selectedMask = maskAssets.find((asset) => asset.id === line.maskAssetId);
                      const isSelected = selectedLineIds.has(line.id);
                      const isDragging = dragLineId === line.id;
                      const dropPlacement = dropTarget?.lineId === line.id ? dropTarget.placement : "";
                      const reviewStatus = isInsert
                        ? line.videoStatus || (line.videoTake?.localUrl ? "generated" : "pending")
                        : line.audioStatus || (line.audioTake?.localUrl ? "pending" : "missing");
                      return (
                        <ProductionLineRow
                          key={line.id}
                          line={line}
                          show={show}
                          format={format}
                          isInsert={isInsert}
                          selectedAsset={selectedAsset}
                          selectedMask={selectedMask}
                          isSelected={isSelected}
                          isDragging={isDragging}
                          dropPlacement={dropPlacement}
                          reviewStatus={reviewStatus}
                          characters={characters}
                          voices={voices}
                          shotTypes={shotTypes}
                          assetsForLine={assetsForLine}
                          busy={busy}
                          busyAction={busyAction}
                          onSelect={selectRow}
                          onDragStart={startDrag}
                          onDragOver={updateDropTarget}
                          onDrop={finishDrop}
                          onClearDrop={() => setDropTarget(null)}
                          onUpdate={onUpdate}
                          onSetCharacter={onSetCharacter}
                          onUpdateShotRole={updateShotRole}
                          onRegenerateAudio={onRegenerateAudio}
                          onSetAudioStatus={onSetAudioStatus}
                          onOpenMaskEditor={onOpenMaskEditor}
                          onGenerateDialogueVideo={onGenerateDialogueVideo}
                          onSelectDialogueVideoTake={onSelectDialogueVideoTake}
                          onGenerateInsertVideo={onGenerateInsertVideo}
                          onUploadInsertVideo={onUploadInsertVideo}
                          onDragEnd={() => {
                            setDragLineId("");
                            setDropTarget(null);
                          }}
                        />
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="emptyState">Build a plan from a dialogue script to create line assignments.</div>
      ))}
    </section>
  );
}

function ProductionLineRow({
  line,
  show,
  format,
  isInsert,
  selectedAsset,
  selectedMask,
  isSelected,
  isDragging,
  dropPlacement,
  reviewStatus,
  characters,
  voices,
  shotTypes,
  assetsForLine,
  busy,
  onSelect,
  onDragStart,
  onDragOver,
  onDrop,
  onClearDrop,
  onUpdate,
  onSetCharacter,
  onUpdateShotRole,
  onRegenerateAudio,
  onSetAudioStatus,
  onOpenMaskEditor,
  onGenerateDialogueVideo,
  onSelectDialogueVideoTake,
  onGenerateInsertVideo,
  onUploadInsertVideo,
  busyAction,
  onDragEnd
}) {
  const lipSyncOverrideModel = lineLipSyncOverrideModel(line);
  const inheritedLipSyncModel =
    assetLipSyncModel(selectedAsset) ||
    optionalLipSyncModel(show?.production?.defaultLipSyncModel) ||
    "fabric";
  const lipSyncModel = resolvedLipSyncModelForLine(line, selectedAsset, show);
  const globalLipSyncPrompt = assetLipSyncPrompt(selectedAsset);
  const lineInputPromptOverride = lineLipSyncInputPromptOverride(line);
  const displayedLipSyncPrompt = lineLipSyncInputPrompt(line, selectedAsset);
  const promptLocked = line.lipSyncInputPromptLocked !== false;
  const animationStrengthOverride = lineAnimationStrengthOverride(line);
  const effectiveAnimationStrength = resolvedAnimationStrengthForLine(line, selectedAsset);
  const defaultRendererLabel = selectedAsset
    ? `Use visual default (${lipSyncModelLabel(inheritedLipSyncModel)})`
    : `Use show default (${lipSyncModelLabel(inheritedLipSyncModel)})`;
  const insertUploadMode = isInsert && line.insertVideoMode === "upload";
  const showScriptEditor = !insertUploadMode;
  const maskExpected = !isInsert && !line.maskAutoApplyDisabled && lineExpectsSpeakerMask(line, selectedAsset);
  const maskHint = !isInsert && !line.maskAutoApplyDisabled && selectedAsset ? speakerMaskSuggestionHint(line, selectedAsset) : "";
  const hasMask = Boolean(line.maskAssetId);
  const hasLineAudio = Boolean(line.audioTake?.localUrl);
  const hasLineVideo = Boolean(line.videoTake?.localUrl || line.videoTake?.proxyLocalUrl);
  const shotReady = isInsert ? hasLineVideo && reviewStatus !== "failed" : hasLineAudio && hasLineVideo && line.videoStatus !== "failed";
  const shotPartial = !shotReady && (hasLineAudio || hasLineVideo);

  function updateScriptText(text) {
    if (isInsert) {
      onUpdate(line.id, {
        text,
        videoStatus: "pending",
        videoTake: null,
        videoInSeconds: 0,
        videoOutSeconds: 0
      });
      return;
    }

    onUpdate(line.id, {
      text,
      audioStatus: "pending",
      audioTake: null,
      videoStatus: "pending",
      videoTake: null
    });
  }

  return (
    <article
      className={[
        "productionLine",
        isInsert ? "insertProductionLine" : "",
        isSelected ? "selected" : "",
        isDragging ? "dragging" : "",
        shotReady ? "shotReady" : "",
        shotPartial ? "shotPartial" : "",
        dropPlacement ? `drop-${dropPlacement}` : ""
      ].filter(Boolean).join(" ")}
      draggable
      tabIndex={0}
      aria-selected={isSelected}
      onClick={(event) => onSelect(event, line.id)}
      onDragStart={(event) => {
        if (productionMapInteractiveEvent(event)) {
          event.preventDefault();
          return;
        }
        onDragStart(event, line.id);
      }}
      onDragOver={(event) => onDragOver(event, line.id)}
      onDragLeave={(event) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
          onClearDrop();
        }
      }}
      onDrop={(event) => onDrop(event, line.id)}
      onDragEnd={onDragEnd}
    >
      <div className="lineIndex" title="Drag row to reorder">#{line.index}</div>
      <div className="lineScript">
        <div className="lineTitleRow">
          <strong>{line.speaker || "Speaker"}</strong>
          <Pill tone={isInsert ? videoStatusTone(reviewStatus) : audioStatusTone(reviewStatus)}>
            {isInsert ? videoStatusLabel(reviewStatus) : audioStatusLabel(reviewStatus)}
          </Pill>
          {!isInsert ? (
            <Pill tone={hasLineVideo && line.videoStatus !== "failed" ? "good" : line.videoStatus === "failed" ? "danger" : "neutral"}>
              {videoStatusLabel(line.videoStatus || (hasLineVideo ? "generated" : "pending"))}
            </Pill>
          ) : null}
        </div>
        {showScriptEditor ? (
          <label className="dialogueEditField">
            <span>{isInsert ? "Insert line" : "Dialogue"}</span>
            <textarea
              value={line.text || ""}
              rows={isInsert ? 3 : 2}
              onChange={(event) => updateScriptText(event.target.value)}
              placeholder={isInsert ? "Describe the insert action..." : "Edit dialogue..."}
            />
          </label>
        ) : null}
        {isInsert ? null : (
          <>
            <label className="audioTagField">
              <span>V3 tags</span>
              <input
              value={line.audioTags || ""}
              onChange={(event) =>
                onUpdate(line.id, {
                  audioTags: event.target.value,
                  audioStatus: "pending",
                  audioTake: null,
                  videoStatus: "pending",
                  videoTake: null
                })
              }
              placeholder="[happy] [whispers]"
            />
            </label>
          <LineAudioReview
            line={line}
            status={reviewStatus}
              busy={busy}
              onRegenerateAudio={onRegenerateAudio}
            onSetAudioStatus={onSetAudioStatus}
            onSetAudienceCue={(mode) => onUpdate(line.id, audienceLaughCuePatch(line, mode))}
          />
          <LineDialogueVideoReview
            line={line}
            busy={busy}
            busyAction={busyAction}
            onGenerateDialogueVideo={onGenerateDialogueVideo}
            onSelectDialogueVideoTake={onSelectDialogueVideoTake}
          />
        </>
      )}
      </div>

      {isInsert ? (
        <InsertShotControls
          line={line}
          assets={assetsForLine(line)}
          busy={busy}
          busyAction={busyAction}
          onUpdate={onUpdate}
          onGenerateInsertVideo={onGenerateInsertVideo}
          onUploadInsertVideo={onUploadInsertVideo}
        />
      ) : (
        <>
          <div className="lineAssignmentGrid">
            <Field label="Character">
              <select value={line.characterId || ""} onChange={(event) => onSetCharacter(line.id, event.target.value)}>
                <option value="">Unassigned</option>
                {characters.map((character) => (
                  <option key={character.id} value={character.id}>
                    {character.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Voice">
              <select
                value={line.voiceId || ""}
                onChange={(event) =>
                  onUpdate(line.id, {
                    voiceId: event.target.value,
                    audioStatus: "pending",
                    audioTake: null,
                    videoStatus: "pending",
                    videoTake: null
                  })
                }
              >
                <VoiceSelectOptions voices={voices} currentValue={line.voiceId} />
              </select>
            </Field>

            <Field label="Shot">
              <select value={line.shotRole || "character_one_shot"} onChange={(event) => onUpdateShotRole(line, event.target.value)}>
                {shotTypes.map((type) => (
                  <option key={type.role} value={type.role}>
                    {type.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Image">
              <select
                value={line.assetId || ""}
                onChange={(event) => {
                  const assetId = event.target.value;
                  onUpdate(line.id, {
                    assetId,
                    assetAutoAssignDisabled: !assetId,
                    needsMask: false,
                    maskAssetId: "",
                    maskAutoApplyDisabled: false,
                    invertMask: false,
                    lipSyncPromptOverride: "",
                    lipSyncInputPromptOverride: "",
                    lipSyncInputPromptLocked: true,
                    animationStrengthOverride: null,
                    videoStatus: "pending",
                    videoTake: null
                  });
                }}
              >
                <option value="">Choose image...</option>
                {assetsForLine(line).map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {assetLabel(asset)}
                  </option>
                ))}
              </select>
            </Field>

            <label className="audioTagField shotPromptField">
              <span>Shot prompt</span>
              <textarea
                value={line.videoPrompt || ""}
                rows={2}
                onChange={(event) =>
                  onUpdate(line.id, {
                    videoPrompt: event.target.value,
                    videoStatus: "pending",
                    videoTake: null
                  })
                }
                placeholder="Optional motion, blocking, or expression direction for this shot"
              />
            </label>

            {lipSyncModel !== "fabric" ? (
              <div className="lipSyncPromptReview">
                <div className="lipSyncPromptHeader">
                  <span>Input prompt</span>
                  <div className="lipSyncPromptHeaderActions">
                    <Pill tone={lineInputPromptOverride ? "good" : "neutral"}>
                      {lineInputPromptOverride ? "shot" : "global"}
                    </Pill>
                    <button
                      type="button"
                      className="quietButton iconOnly promptLockButton"
                      onClick={() => onUpdate(line.id, { lipSyncInputPromptLocked: !promptLocked })}
                      title={promptLocked ? "Unlock prompt" : "Lock prompt"}
                    >
                      {promptLocked ? <Lock size={14} /> : <Unlock size={14} />}
                    </button>
                  </div>
                </div>
                <textarea
                  value={displayedLipSyncPrompt}
                  rows={5}
                  disabled={promptLocked}
                  onChange={(event) =>
                    onUpdate(line.id, {
                      lipSyncInputPromptOverride: event.target.value,
                      lipSyncPromptOverride: "",
                      videoStatus: "pending",
                      videoTake: null
                    })
                  }
                  placeholder="No Cast Visual prompt yet"
                />
                {lineInputPromptOverride && globalLipSyncPrompt ? (
                  <div className="lipSyncGeneratedPrompt">
                    <span>Global default</span>
                    <small>{globalLipSyncPrompt}</small>
                  </div>
                ) : null}
                <div className="lipSyncPromptActions">
                  <button
                    type="button"
                    className="quietButton"
                    onClick={() =>
                      onUpdate(line.id, {
                        lipSyncInputPromptOverride: "",
                        lipSyncPromptOverride: "",
                        lipSyncInputPromptLocked: true,
                        videoStatus: "pending",
                        videoTake: null
                      })
                    }
                    disabled={promptLocked || !lineInputPromptOverride}
                  >
                    Use Global
                  </button>
                  <button
                    type="button"
                    className="quietButton"
                    onClick={() => onUpdate(line.id, { lipSyncInputPromptLocked: true })}
                    disabled={promptLocked}
                  >
                    Lock
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="lineVisualControls">
            <ShotMaskCard
              imageAsset={selectedAsset}
              maskAsset={selectedMask}
              format={format}
              hasMask={hasMask}
              maskNeeded={maskExpected && !hasMask}
              maskHint={maskHint}
              busy={busy}
              onOpen={() => onOpenMaskEditor(line.id)}
            />
            <Field label="Lip-sync renderer">
              <select
                value={lipSyncOverrideModel}
                onChange={(event) =>
                  onUpdate(line.id, {
                    lipSyncModel: event.target.value,
                    lipSyncModelOverride: event.target.value,
                    lipSyncPromptOverride: "",
                    videoStatus: "pending",
                    videoTake: null
                  })
                }
              >
                <option value="">{defaultRendererLabel}</option>
                {lipSyncModelOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
            {lipSyncModel !== "fabric" ? (
              <Toggle
                checked={Boolean(line.expressiveBodyMotion)}
                onChange={(checked) =>
                  onUpdate(line.id, {
                    expressiveBodyMotion: checked,
                    videoStatus: "pending",
                    videoTake: null
                  })
                }
                label="Expressive body"
                icon={Activity}
              />
            ) : null}
            <AnimationStrengthControl
              label="Animation strength"
              value={effectiveAnimationStrength}
              sourceLabel={animationStrengthOverride === null ? "global" : "shot"}
              onChange={(value) =>
                onUpdate(line.id, {
                  animationStrengthOverride: value,
                  videoStatus: "pending",
                  videoTake: null,
                  videoError: "",
                  videoWarning: ""
                })
              }
              onReset={
                animationStrengthOverride === null
                  ? null
                  : () =>
                      onUpdate(line.id, {
                        animationStrengthOverride: null,
                        videoStatus: "pending",
                        videoTake: null,
                        videoError: "",
                        videoWarning: ""
                      })
              }
            />
          </div>
        </>
      )}
    </article>
  );
}

function ShotMaskCard({ imageAsset, maskAsset, format, hasMask, maskNeeded, maskHint, busy, onOpen }) {
  const previewStyle = mediaAspectStyle(imageAsset) || mediaAspectStyle(format);

  return (
    <div className="shotMaskCard">
      <div className="shotMaskPreview" style={previewStyle}>
        {imageAsset?.localUrl ? (
          <img src={imageAsset.localUrl} alt="" />
        ) : (
          <span>No image</span>
        )}
        {hasMask ? <Pill tone="good">mask</Pill> : null}
        {!hasMask && maskNeeded ? <Pill tone="warn">mask needed</Pill> : null}
      </div>
      <button type="button" className="secondaryButton" onClick={onOpen} disabled={busy || !imageAsset?.localUrl}>
        <Pencil size={15} />
        {maskAsset ? "Edit Mask" : maskNeeded ? "Create Mask" : "Add Mask"}
      </button>
      {!hasMask && maskHint ? <div className="maskSuggestionHint">{maskHint}</div> : null}
    </div>
  );
}

function MaskEditorModal({ line, imageAsset, maskAsset, busy, onClose, onSave, onClear }) {
  const canvasRef = useRef(null);
  const lastPointRef = useRef(null);
  const dirtyRef = useRef(false);
  const [tool, setTool] = useState("brush");
  const [brushSize, setBrushSize] = useState(150);
  const [canvasReady, setCanvasReady] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [closeBusy, setCloseBusy] = useState(false);
  const canSuggestMask = canSuggestSpeakerMask(line, imageAsset);
  const suggestionHint = speakerMaskSuggestionHint(line, imageAsset);

  useEffect(() => {
    let cancelled = false;
    setCanvasReady(false);
    const canvas = canvasRef.current;
    if (!canvas || !imageAsset?.localUrl) return undefined;

    const image = new window.Image();
    image.onload = async () => {
      if (cancelled) return;
      canvas.width = image.naturalWidth || 1920;
      canvas.height = image.naturalHeight || 1080;
      clearCanvas(canvas);
      if (maskAsset?.localUrl) {
        await paintExistingMask(canvas, maskAsset.localUrl);
      } else {
        paintSuggestedSpeakerMask(canvas, { line, imageAsset });
      }
      dirtyRef.current = false;
      if (!cancelled) setCanvasReady(true);
    };
    image.src = imageAsset.localUrl;

    return () => {
      cancelled = true;
    };
  }, [imageAsset?.fileName, imageAsset?.localUrl, imageAsset?.shotRole, line?.shotRole, line?.speaker, maskAsset?.localUrl]);

  function beginDraw(event) {
    if (!canvasReady) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const point = canvasPoint(event);
    lastPointRef.current = point;
    dirtyRef.current = true;
    setIsDrawing(true);
    paintStroke(point, point);
  }

  function continueDraw(event) {
    if (!isDrawing || !lastPointRef.current) return;
    event.preventDefault();
    const point = canvasPoint(event);
    paintStroke(lastPointRef.current, point);
    lastPointRef.current = point;
  }

  function endDraw(event) {
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    lastPointRef.current = null;
    setIsDrawing(false);
  }

  function canvasPoint(event) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height
    };
  }

  function paintStroke(from, to) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    const scaledBrushSize = brushSize * (canvas.width / Math.max(rect.width, 1));
    const alpha = MASK_PREVIEW_ALPHA / 255;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = scaledBrushSize;
    ctx.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
    ctx.strokeStyle = `rgba(126, 220, 170, ${alpha})`;
    ctx.fillStyle = `rgba(126, 220, 170, ${alpha})`;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(to.x, to.y, scaledBrushSize / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    if (tool === "brush") normalizeMaskPreviewRegion(canvas, from, to, scaledBrushSize);
  }

  function clearMask() {
    const canvas = canvasRef.current;
    if (canvas) {
      clearCanvas(canvas);
      dirtyRef.current = true;
    }
  }

  function suggestMask() {
    const canvas = canvasRef.current;
    if (!canvas || !canvasReady) return;
    if (!suggestedSpeakerMaskRegion(canvas, { line, imageAsset })) return;
    clearCanvas(canvas);
    paintSuggestedSpeakerMask(canvas, { line, imageAsset });
    dirtyRef.current = true;
  }

  function saveMask() {
    const canvas = canvasRef.current;
    if (!canvas || !canvasReady) return;
    if (!canvasHasMaskPixels(canvas)) {
      onClear?.(line);
      return;
    }
    dirtyRef.current = false;
    onSave(line, exportMaskPng(canvas));
  }

  async function closeEditor() {
    const canvas = canvasRef.current;
    if (!dirtyRef.current || !canvas || !canvasReady) {
      onClose?.();
      return;
    }
    setCloseBusy(true);
    try {
      if (!canvasHasMaskPixels(canvas)) {
        await onClear?.(line);
        return;
      }
      dirtyRef.current = false;
      await onSave?.(line, exportMaskPng(canvas));
    } finally {
      setCloseBusy(false);
    }
  }

  return (
    <div className="maskEditorBackdrop" role="dialog" aria-modal="true">
      <div className="maskEditorPanel">
        <div className="maskEditorHeader">
          <div>
            <span className="eyebrow">Mask Editor</span>
            <h3>
              #{line.index} {line.speaker || "Speaker"}
            </h3>
          </div>
          <button type="button" className="quietButton iconOnly" onClick={closeEditor} disabled={busy || closeBusy}>
            <X size={18} />
          </button>
        </div>

        <div className="maskCanvasFrame">
          {imageAsset?.localUrl ? <img src={imageAsset.localUrl} alt="" draggable="false" /> : null}
          <canvas
            ref={canvasRef}
            onPointerDown={beginDraw}
            onPointerMove={continueDraw}
            onPointerUp={endDraw}
            onPointerCancel={endDraw}
          />
        </div>
        {!maskAsset && suggestionHint ? <div className="maskSuggestionHint">{suggestionHint}</div> : null}

        <div className="maskEditorToolbar">
          <div className="segmentedMini">
            <button type="button" className={tool === "brush" ? "active" : ""} onClick={() => setTool("brush")}>
              <Pencil size={15} />
              Brush
            </button>
            <button type="button" className={tool === "eraser" ? "active" : ""} onClick={() => setTool("eraser")}>
              <Eraser size={15} />
              Erase
            </button>
          </div>
          <label className="brushSlider">
            <span>Size {brushSize}</span>
            <input
              type="range"
              min="36"
              max="520"
              step="8"
              value={brushSize}
              onChange={(event) => setBrushSize(Number(event.target.value))}
            />
          </label>
          <button type="button" className="quietButton" onClick={clearMask} disabled={busy || closeBusy || !canvasReady}>
            <Trash2 size={15} />
            Clear
          </button>
          <button
            type="button"
            className="quietButton"
            onClick={suggestMask}
            disabled={busy || closeBusy || !canvasReady || !canSuggestMask}
            title={canSuggestMask ? "Suggest a speaker matte from the shot asset tags" : "Suggested masks need a grouped MS/WS shot asset with two or more speaking tags"}
          >
            <WandSparkles size={15} />
            Suggest
          </button>
          <button type="button" className="primaryButton" onClick={saveMask} disabled={busy || closeBusy || !canvasReady}>
            <Save size={16} />
            Create Mask
          </button>
        </div>
      </div>
    </div>
  );
}

function clearCanvas(canvas) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function paintExistingMask(canvas, maskUrl) {
  return new Promise((resolve) => {
    const image = new window.Image();
    image.onload = () => {
      const scratch = document.createElement("canvas");
      scratch.width = canvas.width;
      scratch.height = canvas.height;
      const scratchCtx = scratch.getContext("2d", { willReadFrequently: true });
      scratchCtx.drawImage(image, 0, 0, scratch.width, scratch.height);
      const source = scratchCtx.getImageData(0, 0, scratch.width, scratch.height);
      const output = scratchCtx.createImageData(source.width, source.height);
      for (let index = 0; index < source.data.length; index += 4) {
        const luminance = source.data[index] * 0.2126 + source.data[index + 1] * 0.7152 + source.data[index + 2] * 0.0722;
        if (luminance > 12 && source.data[index + 3] > 8) {
          output.data[index] = 126;
          output.data[index + 1] = 220;
          output.data[index + 2] = 170;
          output.data[index + 3] = MASK_PREVIEW_ALPHA;
        }
      }
      const ctx = canvas.getContext("2d");
      ctx.putImageData(output, 0, 0);
      resolve();
    };
    image.onerror = () => resolve();
    image.src = maskUrl;
  });
}

function paintSuggestedSpeakerMask(canvas, { line, imageAsset }) {
  const region = suggestedSpeakerMaskRegion(canvas, { line, imageAsset });
  if (!region) return false;
  const ctx = canvas.getContext("2d");
  const alpha = MASK_PREVIEW_ALPHA / 255;
  ctx.save();
  ctx.fillStyle = `rgba(126, 220, 170, ${alpha})`;
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(region.left, region.top, region.width, region.height, region.radius);
  } else {
    ctx.rect(region.left, region.top, region.width, region.height);
  }
  ctx.fill();
  ctx.restore();
  normalizeMaskPreviewRegion(
    canvas,
    { x: region.left, y: region.top },
    { x: region.left + region.width, y: region.top + region.height },
    0
  );
  return true;
}

function suggestedSpeakerMaskRegion(canvas, { line, imageAsset }) {
  if (!canvas?.width || !canvas?.height) return null;
  const speakerRole = targetSpeakerMaskRole(line, imageAsset);
  const binding = assetShotBinding(imageAsset);
  const roles = binding.roles || [];
  const shotRole = binding.shotRole || imageAsset?.shotRole || line?.shotRole || "";

  const roleIndex = roles.indexOf(speakerRole);
  if (roles.length < 2 || roleIndex === -1 || !["medium_two_shot", "wide_shot"].includes(shotRole)) return null;

  const region = suggestedFilenameLaneRegion({ roleCount: roles.length, roleIndex, shotRole });
  const left = canvas.width * region.x;
  const width = canvas.width * region.width;
  const top = canvas.height * region.y;
  const height = canvas.height * region.height;

  return {
    left,
    top,
    width,
    height,
    radius: Math.min(width * 0.28, height * 0.14, 140)
  };
}

function suggestedFilenameLaneRegion({ roleCount, roleIndex, shotRole }) {
  const count = clamp(roleCount, 2, 4);
  const index = Math.min(roleIndex, count - 1);
  const isWide = shotRole === "wide_shot";
  const y = isWide ? 0.025 : 0.05;
  const height = isWide ? 0.95 : 0.9;

  if (count === 2) {
    return {
      x: index === 0 ? 0.035 : 0.525,
      y,
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
      y,
      height
    };
  }

  const laneWidth = 1 / count;
  const sidePadRatio = 0.04;
  return {
    x: laneWidth * index + laneWidth * sidePadRatio,
    y,
    width: laneWidth * (1 - sidePadRatio * 2),
    height
  };
}

function canSuggestSpeakerMask(line, imageAsset) {
  const speakerRole = targetSpeakerMaskRole(line, imageAsset);
  const binding = assetShotBinding(imageAsset);
  const shotRole = binding.shotRole || imageAsset?.shotRole || line?.shotRole || "";
  return (
    ["medium_two_shot", "wide_shot"].includes(shotRole) &&
    (binding.roles || []).length >= 2 &&
    (binding.roles || []).includes(speakerRole)
  );
}

function speakerMaskSuggestionHint(line, imageAsset) {
  const binding = assetShotBinding(imageAsset);
  const shotRole = binding.shotRole || imageAsset?.shotRole || line?.shotRole || "";
  if (!["medium_two_shot", "wide_shot"].includes(shotRole)) return "";
  const roles = binding.roles || [];
  if (roles.length < 2) {
    return "Auto-mask needs an MS/WS shot asset with two or more speaking tags.";
  }
  const speakerRole = targetSpeakerMaskRole(line, imageAsset);
  if (!roles.includes(speakerRole)) {
    return `Auto-mask could not find @${speakerRole} in this shot asset's speaking tags.`;
  }
  return "";
}

function targetSpeakerMaskRole(line, imageAsset) {
  const speakerKey = keyForMaskMatch(line?.speaker);
  return speakerKey ? speakerMaskRole(line.speaker) : assetSpeakingRole(imageAsset) || "GUEST";
}

function speakerMaskRole(speaker) {
  const key = String(speaker || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
  if (key === "MAX") return "MAX";
  if (key === "PIP" || key === "POP") return "PIP";
  return key || "";
}

function normalizeMaskPreviewRegion(canvas, from, to, brushSize) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const pad = Math.ceil(brushSize);
  const left = Math.max(0, Math.floor(Math.min(from.x, to.x) - pad));
  const top = Math.max(0, Math.floor(Math.min(from.y, to.y) - pad));
  const right = Math.min(canvas.width, Math.ceil(Math.max(from.x, to.x) + pad));
  const bottom = Math.min(canvas.height, Math.ceil(Math.max(from.y, to.y) + pad));
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  const data = ctx.getImageData(left, top, width, height);

  for (let index = 0; index < data.data.length; index += 4) {
    if (data.data[index + 3] > 8) {
      data.data[index] = 126;
      data.data[index + 1] = 220;
      data.data[index + 2] = 170;
      data.data[index + 3] = MASK_PREVIEW_ALPHA;
    }
  }

  ctx.putImageData(data, left, top);
}

function exportMaskPng(sourceCanvas) {
  const sourceCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
  const source = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = sourceCanvas.width;
  outputCanvas.height = sourceCanvas.height;
  const outputCtx = outputCanvas.getContext("2d");
  const output = outputCtx.createImageData(outputCanvas.width, outputCanvas.height);
  for (let index = 0; index < output.data.length; index += 4) {
    const painted = source.data[index + 3] > 8;
    const value = painted ? 255 : 0;
    output.data[index] = value;
    output.data[index + 1] = value;
    output.data[index + 2] = value;
    output.data[index + 3] = 255;
  }
  outputCtx.putImageData(output, 0, 0);
  return outputCanvas.toDataURL("image/png");
}

function canvasHasMaskPixels(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] > 8) return true;
  }
  return false;
}

function LineInsertVideoReview({
  line,
  inPoint = 0,
  outPoint = 0,
  clipDuration = 0,
  previewTime = 0
}) {
  const videoRef = useRef(null);
  const [isPlayingTrim, setIsPlayingTrim] = useState(false);
  const take = line.videoTake || null;
  const hasVideo = Boolean(take?.localUrl);
  const previewLeft = clipDuration ? (inPoint / clipDuration) * 100 : 0;
  const previewWidth = clipDuration ? ((outPoint - inPoint) / clipDuration) * 100 : 100;
  const proxyUrl = take?.proxyLocalUrl || take?.localUrl || "";
  const dimensionLabel = mediaDimensionLabel(take);

  useEffect(() => {
    setIsPlayingTrim(false);
    if (!videoRef.current) return;
    videoRef.current.pause();
    videoRef.current.load();
  }, [proxyUrl]);

  useEffect(() => {
    if (isPlayingTrim) return;
    if (!hasVideo || !videoRef.current) return;
    const video = videoRef.current;
    const nextTime = clamp(Number(previewTime) || 0, 0, Math.max(0, Number(clipDuration) || 0));
    if (Number.isFinite(nextTime) && Math.abs((video.currentTime || 0) - nextTime) > 0.05) {
      video.currentTime = nextTime;
    }
    video.pause();
  }, [clipDuration, hasVideo, isPlayingTrim, previewTime, proxyUrl]);

  useEffect(() => {
    if (!isPlayingTrim || !videoRef.current) return undefined;
    const video = videoRef.current;
    const startTime = clamp(Number(inPoint) || 0, 0, Math.max(0, Number(clipDuration) || 0));
    const endTime = clamp(Number(outPoint) || clipDuration, startTime, Math.max(startTime, Number(clipDuration) || startTime));
    let frameId = 0;

    function stopAtOutPoint() {
      if (!videoRef.current) return;
      if (video.ended || video.currentTime >= endTime) {
        video.pause();
        video.currentTime = startTime;
        setIsPlayingTrim(false);
        return;
      }
      frameId = window.requestAnimationFrame(stopAtOutPoint);
    }

    frameId = window.requestAnimationFrame(stopAtOutPoint);
    return () => window.cancelAnimationFrame(frameId);
  }, [clipDuration, inPoint, isPlayingTrim, outPoint]);

  function playTrimPreview() {
    const video = videoRef.current;
    if (!video) return;

    if (isPlayingTrim) {
      video.pause();
      setIsPlayingTrim(false);
      return;
    }

    video.currentTime = clamp(Number(inPoint) || 0, 0, Math.max(0, Number(clipDuration) || 0));
    video.play().then(() => setIsPlayingTrim(true)).catch(() => setIsPlayingTrim(false));
  }

  return (
    <div className="lineAudioReview lineVideoReview">
      {hasVideo ? (
        <>
          {dimensionLabel ? (
            <div className="lineAudioMeta">
              <span>{take?.model || "Shot video"}</span>
              <span>{dimensionLabel}</span>
            </div>
          ) : null}
          <div className="trimPreviewShell">
            <video key={proxyUrl} ref={videoRef} muted playsInline preload="metadata" src={proxyUrl} style={mediaAspectStyle(take)} />
            <button
              type="button"
              className={`trimPreviewPlay ${isPlayingTrim ? "playing" : ""}`}
              onClick={playTrimPreview}
              aria-label={isPlayingTrim ? "Pause trimmed preview" : "Play trimmed preview"}
            >
              {isPlayingTrim ? <Pause size={16} /> : <Play size={16} fill="currentColor" />}
            </button>
          </div>
          <div className="previewTrimMeter">
            <div className="previewTrimActive" style={{ left: `${previewLeft}%`, width: `${previewWidth}%` }} />
          </div>
          {take?.warning ? <div className="lineAudioWarning">{take.warning}</div> : null}
        </>
      ) : (
        <div className="lineAudioEmpty">Choose an insert image to generate, or upload your own video clip.</div>
      )}
    </div>
  );
}

function LineDialogueVideoReview({ line, busy, busyAction, onGenerateDialogueVideo, onSelectDialogueVideoTake }) {
  const take = line.videoTake || null;
  const videoTakes = lineVideoTakeOptions(line);
  const activeTakeKey = videoTakeKey(take);
  const foundTakeIndex = videoTakes.findIndex((candidate) => videoTakeKey(candidate) === activeTakeKey);
  const activeTakeIndex = foundTakeIndex >= 0 ? foundTakeIndex : 0;
  const hasVideo = Boolean(take?.localUrl || take?.proxyLocalUrl);
  const previewUrl = take?.proxyLocalUrl || take?.localUrl || "";
  const hasAudio = Boolean(line.audioTake?.localUrl);
  const isGenerating = busyAction === `dialogue-video:${line.id}`;
  const isSelecting = busyAction === `dialogue-video-take:${line.id}`;
  const buttonLabel = hasVideo ? "Regenerate Video" : "Generate Video";
  const dimensionLabel = mediaDimensionLabel(take);
  const previousTake = videoTakes[activeTakeIndex - 1] || null;
  const nextTake = videoTakes[activeTakeIndex + 1] || null;
  const videoMessage =
    take?.warning ||
    line.videoWarning ||
    line.videoError ||
    (line.videoStatus === "failed" ? "Shot video failed. Check the render status, then try regenerating the video." : "");

  return (
    <div className="lineAudioReview lineDialogueVideoReview">
      <div className="lineAudioMeta">
        <span>{take?.model || "No shot video yet"}</span>
        {dimensionLabel ? <span>{dimensionLabel}</span> : null}
        {take?.durationSeconds ? <span>{formatSeconds(take.durationSeconds)}</span> : null}
        {videoTakes.length > 1 ? <span>{activeTakeIndex + 1} / {videoTakes.length}</span> : null}
      </div>
      {hasVideo ? (
        <video key={previewUrl} controls playsInline preload="metadata" src={previewUrl} style={mediaAspectStyle(take)} />
      ) : (
        <div className="lineAudioEmpty">Generate this shot video after the line audio is ready.</div>
      )}
      {videoMessage ? <div className="lineAudioWarning">{videoMessage}</div> : null}
      <div className="lineAudioActions">
        {videoTakes.length > 1 ? (
          <div className="lineVideoTakeStepper" aria-label="Shot video take navigation">
            <button
              type="button"
              className="quietButton iconOnly"
              onClick={() => previousTake && onSelectDialogueVideoTake?.(line, previousTake)}
              disabled={busy || !previousTake}
              title="Previous generated take"
              aria-label="Previous generated take"
            >
              <ChevronLeft size={15} />
            </button>
            <span>{activeTakeIndex + 1} / {videoTakes.length}</span>
            <button
              type="button"
              className="quietButton iconOnly"
              onClick={() => nextTake && onSelectDialogueVideoTake?.(line, nextTake)}
              disabled={busy || !nextTake}
              title="Next generated take"
              aria-label="Next generated take"
            >
              <ChevronRight size={15} />
            </button>
          </div>
        ) : null}
        <button
          type="button"
          className="quietButton"
          onClick={() => onGenerateDialogueVideo(line)}
          disabled={busy || !hasAudio}
          title={hasAudio ? buttonLabel : "Generate line audio before shot video"}
        >
          {isGenerating || isSelecting ? <RefreshCw className="spin" size={15} /> : <Film size={15} />}
          {isGenerating ? "Generating..." : isSelecting ? "Selecting..." : buttonLabel}
        </button>
      </div>
    </div>
  );
}

function InsertShotControls({ line, assets, busy, busyAction, onUpdate, onGenerateInsertVideo, onUploadInsertVideo }) {
  const trackRef = useRef(null);
  const [dragMode, setDragMode] = useState("");
  const [previewTime, setPreviewTime] = useState(Number(line.videoInSeconds || 0));
  const selectedAsset = assets.find((asset) => asset.id === line.assetId);
  const insertMode = line.insertVideoMode || "reference";
  const isUploadMode = insertMode === "upload";
  const needsEndImage = insertMode === "first_last_frame";
  const take = line.videoTake || null;
  const hasVideo = Boolean(take?.localUrl);
  const proxyUrl = take?.proxyLocalUrl || take?.localUrl || "";
  const isGenerating = busyAction === `insert:${line.id}`;
  const isUploading = busyAction === `insert-upload:${line.id}`;
  const canGenerate = !isUploadMode && Boolean(line.assetId && (!needsEndImage || line.insertEndAssetId));
  const clipDuration = Math.max(0.35, Number(take?.durationSeconds || line.estimatedSeconds || 4));
  const inPoint = clamp(Number(line.videoInSeconds || 0), 0, Math.max(0, clipDuration - 0.35));
  const defaultOut = Math.min(clipDuration, Math.max(inPoint + 0.35, inPoint + INSERT_TRIM_DEFAULT_SECONDS));
  const fallbackOut = Math.min(clipDuration, Math.max(inPoint + 0.35, Number(line.videoOutSeconds) || defaultOut));
  const outPoint = clamp(fallbackOut, inPoint + 0.35, clipDuration);
  const trimLeft = clipDuration ? (inPoint / clipDuration) * 100 : 0;
  const trimWidth = clipDuration ? ((outPoint - inPoint) / clipDuration) * 100 : 100;
  const frameSlots = Array.from({ length: 8 });

  useEffect(() => {
    if (!dragMode) setPreviewTime(inPoint);
  }, [dragMode, inPoint]);

  useEffect(() => {
    if (!dragMode) return undefined;
    function handleMove(event) {
      applyPointer(dragMode, event);
    }
    function handleUp() {
      setDragMode("");
    }
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [dragMode, clipDuration, inPoint, outPoint]);

  function timeFromPointer(event) {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect?.width) return 0;
    return clamp(((event.clientX - rect.left) / rect.width) * clipDuration, 0, clipDuration);
  }

  function setInPoint(value) {
    const nextIn = clamp(Number(value) || 0, 0, Math.max(0, outPoint - 0.35));
    setPreviewTime(roundTenths(nextIn));
    onUpdate(line.id, { videoInSeconds: roundTenths(nextIn) });
  }

  function setOutPoint(value) {
    const nextOut = clamp(Number(value) || 0, inPoint + 0.35, clipDuration);
    setPreviewTime(roundTenths(Math.max(0, nextOut - 0.05)));
    onUpdate(line.id, { videoOutSeconds: roundTenths(nextOut) });
  }

  function applyPointer(mode, event) {
    const time = timeFromPointer(event);
    if (mode === "in") {
      setInPoint(time);
    } else if (mode === "out") {
      setOutPoint(time);
    } else if (mode === "scrub") {
      setPreviewTime(roundTenths(clamp(time, inPoint, outPoint)));
    }
  }

  function startDrag(mode, event) {
    event.preventDefault();
    event.stopPropagation();
    setDragMode(mode);
    applyPointer(mode, event);
  }

  return (
    <div className={`insertShotControls ${isUploadMode ? "uploadMode" : ""}`}>
      <Field label="Video mode">
        <select
          value={insertMode}
          onChange={(event) => {
            const nextMode = event.target.value;
            onUpdate(line.id, {
              insertVideoMode: nextMode,
              insertEndAssetId: nextMode === "first_last_frame" ? line.insertEndAssetId || "" : "",
              videoTake: null,
              videoStatus: "pending",
              videoInSeconds: 0,
              videoOutSeconds: 0
            });
          }}
        >
          <option value="reference">Reference image</option>
          <option value="first_frame">First frame</option>
          <option value="first_last_frame">First + last frame</option>
          <option value="upload">Video upload</option>
        </select>
      </Field>

      {!isUploadMode ? (
        <Field label="Insert image">
          <select
            value={line.assetId || ""}
            onChange={(event) =>
              onUpdate(line.id, {
                assetId: event.target.value,
                videoTake: null,
                videoStatus: "pending",
                videoInSeconds: 0,
                videoOutSeconds: 0
              })
            }
          >
            <option value="">Choose image...</option>
            {assets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {assetLabel(asset)}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      {!isUploadMode && needsEndImage ? (
        <Field label="Last frame image">
          <select
            value={line.insertEndAssetId || ""}
            onChange={(event) =>
              onUpdate(line.id, {
                insertEndAssetId: event.target.value,
                videoTake: null,
                videoStatus: "pending",
                videoInSeconds: 0,
                videoOutSeconds: 0
              })
            }
          >
            <option value="">Choose image...</option>
            {assets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {assetLabel(asset)}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      {!isUploadMode ? (
        <Field label="Shot prompt">
          <textarea
            value={line.videoPrompt || line.text || ""}
            rows={3}
            onChange={(event) =>
              onUpdate(line.id, {
                videoPrompt: event.target.value,
                videoTake: null,
                videoStatus: "pending",
                videoInSeconds: 0,
                videoOutSeconds: 0
              })
            }
            placeholder="Describe the insert action to generate"
          />
        </Field>
      ) : null}

      {hasVideo || !isUploadMode ? (
        <InsertVideoTrimEditor
          line={line}
          selectedAsset={selectedAsset}
          proxyUrl={proxyUrl}
          hasVideo={hasVideo}
          inPoint={inPoint}
          outPoint={outPoint}
          clipDuration={clipDuration}
          previewTime={previewTime}
          frameSlots={frameSlots}
          trimLeft={trimLeft}
          trimWidth={trimWidth}
          trackRef={trackRef}
          onStartDrag={startDrag}
        />
      ) : null}

      {hasVideo ? (
        <>
          {!isUploadMode ? (
            <button
              type="button"
              className="secondaryButton insertGenerateButton"
              onClick={() => onGenerateInsertVideo(line)}
              disabled={busy || !canGenerate}
            >
              {isGenerating ? <RefreshCw className="spin" size={15} /> : <Sparkles size={15} />}
              {isGenerating ? "Generating..." : "Regenerate Video"}
            </button>
          ) : null}
          <label className="secondaryButton insertGenerateButton insertUploadButton">
            {isUploading ? <RefreshCw className="spin" size={15} /> : <Upload size={15} />}
            {isUploading ? "Uploading..." : isUploadMode ? "Replace Uploaded Video" : "Replace With Video"}
            <input
              type="file"
              accept="video/mp4,video/quicktime,video/webm,video/*"
              disabled={busy || !isUploadMode}
              onChange={(event) => {
                onUploadInsertVideo?.(line, event.target.files);
                event.target.value = "";
              }}
            />
          </label>
        </>
      ) : (
        <div className="insertActionRow">
          {!isUploadMode ? (
            <button
              type="button"
              className="secondaryButton insertGenerateButton"
              onClick={() => onGenerateInsertVideo(line)}
              disabled={busy || !canGenerate}
            >
              {isGenerating ? <RefreshCw className="spin" size={15} /> : <Sparkles size={15} />}
              {isGenerating ? "Generating..." : "Generate Video"}
            </button>
          ) : null}
          <label className="secondaryButton insertGenerateButton insertUploadButton">
            {isUploading ? <RefreshCw className="spin" size={15} /> : <Upload size={15} />}
            {isUploading ? "Uploading..." : "Upload Video"}
            <input
              type="file"
              accept="video/mp4,video/quicktime,video/webm,video/*"
              disabled={busy || !isUploadMode}
              onChange={(event) => {
                onUploadInsertVideo?.(line, event.target.files);
                event.target.value = "";
              }}
            />
          </label>
        </div>
      )}
    </div>
  );
}

function InsertVideoTrimEditor({
  line,
  selectedAsset,
  proxyUrl,
  hasVideo,
  inPoint,
  outPoint,
  clipDuration,
  previewTime,
  frameSlots,
  trimLeft,
  trimWidth,
  trackRef,
  onStartDrag
}) {
  return (
    <div className="insertPreviewGrid">
      <LineInsertVideoReview
        line={line}
        inPoint={inPoint}
        outPoint={outPoint}
        clipDuration={clipDuration}
        previewTime={previewTime}
      />

      {hasVideo ? (
        <div className="iphoneTrimEditor">
          <div className="trimFilmArea">
            <div
              className="iphoneFilmstrip"
              ref={trackRef}
              onPointerDown={(event) => onStartDrag("scrub", event)}
            >
              {frameSlots.map((_, index) => (
                <div className="filmFrame" key={index}>
                  {proxyUrl ? (
                    <InsertFilmstripFrame
                      src={proxyUrl}
                      fallbackSrc={selectedAsset?.localUrl}
                      time={(clipDuration * (index + 0.5)) / frameSlots.length}
                      clipDuration={clipDuration}
                    />
                  ) : selectedAsset?.localUrl ? (
                    <img src={selectedAsset.localUrl} alt="" />
                  ) : null}
                </div>
              ))}
              <div className="filmDim filmDimLeft" style={{ width: `${trimLeft}%` }} />
              <div className="filmDim filmDimRight" style={{ left: `${trimLeft + trimWidth}%` }} />
              <div className="trimSelection" style={{ left: `${trimLeft}%`, width: `${trimWidth}%` }}>
                <button
                  type="button"
                  className="trimHandle trimHandleIn"
                  aria-label="Trim in point"
                  style={{ left: 0 }}
                  onPointerDown={(event) => onStartDrag("in", event)}
                >
                  <span />
                </button>
                <button
                  type="button"
                  className="trimHandle trimHandleOut"
                  aria-label="Trim out point"
                  style={{ right: 0 }}
                  onPointerDown={(event) => onStartDrag("out", event)}
                >
                  <span />
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function InsertFilmstripFrame({ src, fallbackSrc, time = 0, clipDuration = 0 }) {
  const videoRef = useRef(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return undefined;
    let cancelled = false;

    function seekFrame() {
      if (cancelled) return;
      const duration = Number(video.duration || clipDuration || 0);
      const target = clamp(Number(time) || 0, 0, Math.max(0, duration - 0.05));
      try {
        video.currentTime = target;
      } catch {
        // Some codecs do not allow seeking until the browser has read more metadata.
      }
    }

    function markLoaded() {
      if (!cancelled) setLoaded(true);
    }

    setLoaded(false);
    video.addEventListener("loadedmetadata", seekFrame);
    video.addEventListener("seeked", markLoaded);
    video.addEventListener("loadeddata", markLoaded);
    video.load();
    if (video.readyState >= 1) seekFrame();

    return () => {
      cancelled = true;
      video.removeEventListener("loadedmetadata", seekFrame);
      video.removeEventListener("seeked", markLoaded);
      video.removeEventListener("loadeddata", markLoaded);
    };
  }, [clipDuration, src, time]);

  return (
    <>
      {fallbackSrc ? <img className={loaded ? "filmFrameFallback hidden" : "filmFrameFallback"} src={fallbackSrc} alt="" /> : null}
      <video ref={videoRef} muted playsInline preload="metadata" src={src} className={loaded ? "" : "loading"} />
    </>
  );
}

function LineAudioReview({ line, status, busy, onRegenerateAudio, onSetAudioStatus, onSetAudienceCue }) {
  const take = line.audioTake || null;
  const hasAudio = Boolean(take?.localUrl);
  const laughCueMode = audienceLaughCueMode(line);
  const cueOptions = [
    { mode: "auto", label: "Auto", icon: Activity, title: "Let NewtBuilder decide whether this line is a punchline." },
    { mode: "force", label: "Add Laugh", icon: Plus, title: "Force a laugh cue immediately after this line's audio." },
    { mode: "none", label: "No Laugh", icon: X, title: "Prevent auto laugh placement on this line." }
  ];

  return (
    <div className="lineAudioReview">
      <div className="lineAudioMeta">
        <span>{take?.mode || "No clip yet"}</span>
        {take?.durationSeconds ? <span>{formatSeconds(take.durationSeconds)}</span> : null}
      </div>
      <div className={`lineAudienceCueControls ${laughCueMode !== "auto" ? `cue-${laughCueMode}` : ""}`}>
        <span>Laugh cue</span>
        <div className="segmentedMini cueSegmented" role="group" aria-label="Laugh cue placement">
          {cueOptions.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.mode}
                type="button"
                className={laughCueMode === option.mode ? "active" : ""}
                onClick={() => onSetAudienceCue?.(option.mode)}
                disabled={busy}
                title={option.title}
              >
                <Icon size={14} />
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
      {hasAudio ? (
        <audio controls preload="metadata" src={take.localUrl} />
      ) : (
        <div className="lineAudioEmpty">Generate this line after the voice and tags are set.</div>
      )}
      {take?.warning ? <div className="lineAudioWarning">{take.warning}</div> : null}
      <div className="lineAudioActions">
        <button
          type="button"
          className="quietButton"
          onClick={() => onRegenerateAudio(line)}
          disabled={busy}
        >
          <RefreshCw size={15} />
          Regenerate
        </button>
        <button
          type="button"
          className="quietButton"
          onClick={() => onSetAudioStatus(line, "approved")}
          disabled={!hasAudio || busy || status === "approved"}
        >
          <Check size={15} />
          Approve
        </button>
        <button
          type="button"
          className="quietButton"
          onClick={() => onSetAudioStatus(line, "hold")}
          disabled={!hasAudio || busy || status === "hold"}
        >
          Hold
        </button>
      </div>
    </div>
  );
}

function audioStatusTone(status) {
  if (status === "approved") return "good";
  if (status === "hold") return "warn";
  if (status === "missing") return "danger";
  return "neutral";
}

function audioStatusLabel(status) {
  if (status === "approved") return "audio approved";
  if (status === "hold") return "audio hold";
  if (status === "missing") return "no audio";
  return "audio pending";
}

function videoStatusTone(status) {
  if (status === "approved" || status === "generated" || status === "cached") return "good";
  if (status === "hold") return "warn";
  if (status === "failed") return "danger";
  return "neutral";
}

function videoStatusLabel(status) {
  if (status === "approved") return "video approved";
  if (status === "generated") return "video ready";
  if (status === "cached") return "video cached";
  if (status === "hold") return "video hold";
  if (status === "failed") return "video failed";
  return "video pending";
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function roundTenths(value) {
  return Math.round((Number(value) || 0) * 10) / 10;
}

function shotTypeForRole(role) {
  return shotAssetTypes.find((type) => type.role === role) || null;
}

function shotTypeLabelForRole(role) {
  return shotTypeForRole(role)?.label || "";
}

function assetLabel(asset) {
  const binding = assetShotBinding(asset);
  const bindingLabel = shotBindingLabel(binding);
  const typeLabel = shotTypeLabelForRole(asset.shotRole) || asset.roleLabel || bindingLabel;
  return `${asset.fileName}${typeLabel ? ` (${typeLabel})` : ""}`;
}

function applyStoredSpeakerMasksToLines(lines = [], assets = []) {
  const assetList = Array.isArray(assets) ? assets : [];
  const assetById = new Map(assetList.map((asset) => [asset.id, asset]));
  const maskAssets = assetList.filter((asset) => asset.shotRole === "mask" && asset.metadata?.speakerMaskKey);
  const maskById = new Map(maskAssets.map((asset) => [asset.id, asset]));

  return (Array.isArray(lines) ? lines : []).map((line) => {
    if (line.lineType === "insert") {
      return { ...line, needsMask: false };
    }

    const imageAsset = assetById.get(line.assetId);
    const canUseMask = lineCanUseSpeakerMask(line, imageAsset);
    const expectsMask = lineExpectsSpeakerMask(line, imageAsset);
    if (!canUseMask) {
      return { ...line, needsMask: false, maskAssetId: "", invertMask: false };
    }
    if (line.maskAutoApplyDisabled) {
      return { ...line, needsMask: false, maskAssetId: "", invertMask: false };
    }

    const existingMask = maskById.get(line.maskAssetId);
    const matchingMask = speakerMaskMatchesLine(existingMask, line)
      ? existingMask
      : maskAssets.find((asset) => speakerMaskMatchesLine(asset, line));

    return {
      ...line,
      needsMask: Boolean(expectsMask || matchingMask),
      maskAssetId: matchingMask?.id || "",
      invertMask: Boolean(matchingMask && line.invertMask)
    };
  });
}

function lineCanUseSpeakerMask(line, asset) {
  if (!line || line.lineType === "insert" || !asset) return false;
  const shotRole = String(line.shotRole || asset.shotRole || "");
  const assetShotRole = String(asset.shotRole || "");
  return ["medium_two_shot", "wide_shot"].includes(shotRole) || ["medium_two_shot", "wide_shot"].includes(assetShotRole);
}

function lineExpectsSpeakerMask(line, asset) {
  if (!lineCanUseSpeakerMask(line, asset)) return false;
  return assetSpeakerRoles(asset).length > 1;
}

function speakerMaskMatchesLine(maskAsset, line) {
  if (!maskAsset || !line) return false;
  const lineRefreshToken = String(line.maskRefreshToken || "").trim();
  const assetRefreshToken = String(maskAsset.metadata?.maskRefreshToken || "").trim();
  return (
    String(maskAsset.metadata?.sourceImageAssetId || "") === String(line.assetId || "") &&
    String(maskAsset.metadata?.speakerMaskKey || "") === speakerMaskReuseKey(line) &&
    (lineRefreshToken ? assetRefreshToken === lineRefreshToken : !assetRefreshToken)
  );
}

function speakerMaskReuseKey(line) {
  const characterId = String(line?.characterId || "").trim();
  if (characterId) return `character:${characterId}`;
  const speakerKey = keyForMaskMatch(line?.speaker);
  return speakerKey ? `speaker:${speakerKey}` : `speaker-type:${speakerTypeForMask(line?.speaker)}`;
}

function speakerTypeForMask(speaker) {
  const key = keyForMaskMatch(speaker);
  if (key === "max") return "max";
  if (key === "pip" || key === "pop") return "pip";
  return key || "guest";
}

function keyForMaskMatch(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function assetShotBinding(asset) {
  const shotRole = asset?.shotRole || "";
  return {
    prefix: shotRolePrefixForRole(shotRole),
    shotRole,
    roles: assetSpeakerRoles(asset)
  };
}

function assetSpeakerRoles(asset) {
  return parseCharacterTagRoles(asset?.metadata?.speakingTag || asset?.metadata?.characterTags);
}

function assetSpeakingRole(asset) {
  return parseCharacterTagRoles(asset?.metadata?.speakingTag || asset?.metadata?.characterTags)[0] || "";
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
  return [...new Set((tagged.length ? tagged : fallback).map((tag) => speakerMaskRole(tag)))];
}

function normalizeSpeakingTag(value) {
  const tagged = [...String(value || "").matchAll(/@([A-Za-z0-9_-]{1,48})/g)].map((match) => match[1]);
  const fallback = tagged.length
    ? tagged
    : String(value || "")
        .split(/[,\s]+/)
        .map((part) => part.trim().replace(/^@/, ""))
        .filter(Boolean);
  const roles = [...new Set(fallback.map((tag) => speakerMaskRole(tag)).filter(Boolean))].slice(0, 8);
  return roles.map((role) => `@${role.toLowerCase().slice(0, 48)}`).join(" ");
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

function shotFilenameBinding(fileName) {
  const stem = String(fileName || "")
    .replace(/\.[^.]+$/, "")
    .toUpperCase()
    .replace(/\s+/g, "_");
  const parts = stem.split("_").filter(Boolean);
  const prefix = parts[0] || "";
  const shotRole = {
    CU: "character_one_shot",
    MS: "medium_two_shot",
    WS: "wide_shot",
    INS: "insert_shot",
    MASK: "mask"
  }[prefix] || "";
  const roles = rolesFromFilenameParts(parts.slice(1));
  return { prefix, shotRole, roles };
}

function rolesFromFilenameParts(parts = []) {
  const roles = [];
  for (const part of parts) {
    const partRoles = rolesFromFilenameSegment(part);
    if (!partRoles.length && roles.length) break;
    roles.push(...partRoles);
  }
  return [...new Set(roles)];
}

function rolesFromFilenameSegment(segment) {
  const roles = [];
  const tokens = String(segment || "")
    .toUpperCase()
    .replace(/\bAND\b/g, "-")
    .split(/[-+&]+/)
    .filter(Boolean);
  for (const token of tokens) {
    if (token === "ALL") {
      roles.push("MAX", "PIP", "GUEST");
    } else if (token === "MAX") {
      roles.push("MAX");
    } else if (token === "PIP" || token === "POP") {
      roles.push("PIP");
    } else if (token === "GUEST" || isGuestNameToken(token)) {
      roles.push("GUEST");
    }
  }
  return [...new Set(roles)];
}

function isGuestNameToken(token) {
  if (!token || ["TALKING", "SPEAKING", "SHOT", "WIDE", "MEDIUM", "CU", "MS", "WS", "INSERT", "INS", "LEFT", "RIGHT", "CENTER", "MIDDLE", "MID", "VERT", "VERTICAL", "PORTRAIT", "HORZ", "HORIZ", "HORIZONTAL", "LANDSCAPE", "TABLE", "ROOM", "CLUBHOUSE", "REACTION", "BACKGROUND", "BG", "FG"].includes(token)) {
    return false;
  }
  return !/^\d+$/.test(token);
}

function shotBindingLabel(binding) {
  const roleText = binding?.roles?.length ? binding.roles.join("/") : "";
  if (!binding?.shotRole) return roleText;
  return [binding.prefix, roleText].filter(Boolean).join(" ");
}

function CastVisualLibrary({
  episodeId = "",
  uploadShotTypes,
  assets = [],
  onUpload,
  onDelete,
  onUpdateTags,
  onUpdateAsset,
  onGenerateLipSyncPrompt,
  showDefaultLipSyncModel,
  busyAction
}) {
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const shotTypes = uploadShotTypes.filter((type) => type.role !== "mask");
  const defaultShotRole = shotTypes[0]?.role || "character_one_shot";
  const storyboardAssets = (assets || [])
    .filter((asset) => asset.type === "image")
    .sort((a, b) => Date.parse(a.createdAt || "") - Date.parse(b.createdAt || ""));
  const selectedAsset = storyboardAssets.find((asset) => asset.id === selectedAssetId) || null;

  useEffect(() => {
    setSelectedAssetId("");
  }, [episodeId]);

  useEffect(() => {
    if (selectedAssetId && !storyboardAssets.some((asset) => asset.id === selectedAssetId)) {
      setSelectedAssetId("");
    }
  }, [selectedAssetId, storyboardAssets]);

  function openAsset(assetId) {
    setSelectedAssetId(assetId);
  }

  function saveShotRole(asset, role) {
    const shotType = shotTypeForRole(role);
    onUpdateAsset?.(asset.id, {
      shotRole: shotType?.role || role,
      roleLabel: shotType?.label || labelForShotRoleFallback(role)
    });
  }

  return (
    <div className="castVisualLibrary">
      <div className="castSubheader">
        <span className="eyebrow">Cast Visuals</span>
        <strong>Shot Assets</strong>
      </div>

      <div className="shotAssetToolbar">
        <label className="shotDrop addShotAssetButton">
          <Upload size={17} />
          <span>Add new Shot Asset</span>
          <input
            type="file"
            multiple
            accept="image/*"
            onChange={(event) => onUpload(event.target.files, defaultShotRole)}
          />
        </label>
        <span>Double-click a storyboard tile to edit details.</span>
      </div>

      {storyboardAssets.length ? (
        <div className="storyboardAssetGrid">
          {storyboardAssets.map((asset) => (
            <StoryboardAssetTile
              key={asset.id}
              asset={asset}
              shotTypes={shotTypes}
              onOpen={() => openAsset(asset.id)}
              onDelete={() => onDelete?.(asset.id)}
              onChangeShotRole={(role) => saveShotRole(asset, role)}
            />
          ))}
        </div>
      ) : null}

      {!storyboardAssets.length ? <div className="assetEmpty">No shot assets yet.</div> : null}

      {selectedAsset ? (
        <AssetDetailModal
          asset={selectedAsset}
          shotTypes={shotTypes}
          showDefaultLipSyncModel={showDefaultLipSyncModel}
          busy={busyAction === `asset-prompt:${selectedAsset.id}`}
          onClose={() => setSelectedAssetId("")}
          onDelete={() => {
            onDelete?.(selectedAsset.id);
            setSelectedAssetId("");
          }}
          onSave={(patch) => onUpdateAsset?.(selectedAsset.id, patch)}
          onGenerateLipSyncPrompt={(provider) => onGenerateLipSyncPrompt?.(selectedAsset.id, provider)}
        />
      ) : null}
    </div>
  );
}

function StoryboardAssetTile({ asset, shotTypes, onOpen, onDelete, onChangeShotRole }) {
  const bindingLabel = shotBindingLabel(assetShotBinding(asset));
  const shotRole = asset.shotRole || "character_one_shot";

  return (
    <article
      className={`storyboardAssetTile ${shotRole}`}
      role="button"
      tabIndex={0}
      title="Double-click to edit shot asset details"
      onDoubleClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter") onOpen?.();
      }}
    >
      <div className="storyboardAssetImage">
        {bindingLabel ? <strong className="assetBindingChip">{bindingLabel}</strong> : null}
        <img src={asset.localUrl} alt={asset.fileName} />
        <button
          type="button"
          className="assetDelete"
          onClick={(event) => {
            event.stopPropagation();
            onDelete?.();
          }}
          title="Delete image"
        >
          <Trash2 size={14} />
        </button>
      </div>
      <div className="storyboardAssetMeta">
        <strong>{asset.fileName}</strong>
        <select
          value={shotRole}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onChange={(event) => onChangeShotRole?.(event.target.value)}
        >
          {shotTypes.map((type) => (
            <option key={type.role} value={type.role}>
              {type.label}
            </option>
          ))}
        </select>
      </div>
    </article>
  );
}

function AssetDetailModal({
  asset,
  shotTypes,
  showDefaultLipSyncModel,
  busy,
  onClose,
  onDelete,
  onSave,
  onGenerateLipSyncPrompt
}) {
  const savedShotRole = asset.shotRole || "character_one_shot";
  const savedTags = normalizeSpeakingTag(asset?.metadata?.speakingTag || asset?.metadata?.characterTags || "");
  const savedModel = assetLipSyncModel(asset);
  const savedPrompt = assetLipSyncPrompt(asset);
  const savedAnimationStrength = assetAnimationStrength(asset);
  const [shotRoleDraft, setShotRoleDraft] = useState(savedShotRole);
  const [tagsDraft, setTagsDraft] = useState(savedTags);
  const [modelDraft, setModelDraft] = useState(savedModel);
  const [promptDraft, setPromptDraft] = useState(savedPrompt);
  const [animationStrengthDraft, setAnimationStrengthDraft] = useState(savedAnimationStrength);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const isInsert = shotRoleDraft === "insert_shot";
  const effectiveModel = modelDraft || optionalLipSyncModel(showDefaultLipSyncModel) || "fabric";

  useEffect(() => {
    setShotRoleDraft(savedShotRole);
    setTagsDraft(savedTags);
    setModelDraft(savedModel);
    setPromptDraft(savedPrompt);
    setAnimationStrengthDraft(savedAnimationStrength);
    setSaveError("");
    setSaveBusy(false);
  }, [asset?.id, savedShotRole, savedTags, savedModel, savedPrompt, savedAnimationStrength]);

  async function saveDetails() {
    if (saveBusy) return;
    const shotType = shotTypeForRole(shotRoleDraft);
    setSaveBusy(true);
    setSaveError("");
    try {
      await onSave?.({
        shotRole: shotType?.role || shotRoleDraft,
        roleLabel: shotType?.label || labelForShotRoleFallback(shotRoleDraft),
        speakingTag: normalizeSpeakingTag(tagsDraft),
        lipSyncModel: optionalLipSyncModel(modelDraft),
        lipSyncPrompt: compactText(promptDraft.trim(), LIPSYNC_INPUT_PROMPT_MAX_LENGTH),
        animationStrength: normalizeAnimationStrength(animationStrengthDraft)
      });
      onClose?.();
    } catch (error) {
      setSaveError(error?.message || "Could not save shot asset.");
      setSaveBusy(false);
    }
  }

  return (
    <div className="maskEditorBackdrop" role="dialog" aria-modal="true">
      <div className="maskEditorPanel assetDetailPanel">
        <div className="maskEditorHeader">
          <div>
            <span className="eyebrow">Shot Asset</span>
            <strong>{asset.fileName}</strong>
          </div>
          <button type="button" className="quietButton iconOnly" onClick={onClose} title="Close">
            <X size={17} />
          </button>
        </div>

        <div className="assetDetailGrid">
          <div className="assetDetailPreview">
            <img src={asset.localUrl} alt={asset.fileName} />
          </div>
          <div className="assetDetailControls">
            <Field label="Shot type">
              <select value={shotRoleDraft} onChange={(event) => setShotRoleDraft(event.target.value)}>
                {shotTypes.map((type) => (
                  <option key={type.role} value={type.role}>
                    {type.label}
                  </option>
                ))}
              </select>
            </Field>

            {isInsert ? (
              <div className="assetDetailNotice">
                Insert shots are used as cutaways or action references. They use the insert-video controls in the Production Map instead of dialogue lip-sync defaults.
              </div>
            ) : (
              <>
                <Field label="Speaking tag">
                  <input
                    value={tagsDraft}
                    onChange={(event) => setTagsDraft(event.target.value)}
                    placeholder="@name"
                  />
                </Field>
                <Field label="Global model">
                  <select value={modelDraft} onChange={(event) => setModelDraft(event.target.value)}>
                    <option value="">Show default ({lipSyncModelLabel(showDefaultLipSyncModel)})</option>
                    {lipSyncModelOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <AnimationStrengthControl
                  label="Global animation strength"
                  value={animationStrengthDraft}
                  onChange={setAnimationStrengthDraft}
                />
                <label className="field">
                  <span>Global prompt</span>
                  <textarea
                    value={promptDraft}
                    rows={8}
                    onChange={(event) => setPromptDraft(event.target.value)}
                    placeholder="Generate from image or write a reusable visual reference prompt"
                  />
                </label>
              </>
            )}
          </div>
        </div>

        {saveError ? <div className="assetDetailError">{saveError}</div> : null}

        <div className="maskEditorToolbar">
          <button type="button" className="quietButton" onClick={onDelete} disabled={saveBusy}>
            <Trash2 size={15} />
            Delete
          </button>
          <div className="buttonRow">
            {!isInsert ? (
              <button type="button" className="secondaryButton" onClick={() => onGenerateLipSyncPrompt?.(effectiveModel)} disabled={busy || saveBusy}>
                <WandSparkles size={15} />
                {busy ? "Generating" : `Generate for ${lipSyncModelLabel(effectiveModel)}`}
              </button>
            ) : null}
            <button type="button" className="primaryButton" onClick={saveDetails} disabled={saveBusy}>
              {saveBusy ? <RefreshCw className="spin" size={16} /> : <Save size={16} />}
              {saveBusy ? "Saving" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function labelForShotRoleFallback(role) {
  return shotTypeLabelForRole(role) || "Shot Asset";
}

function AssetTagsField({ asset, onSave }) {
  const savedTags = normalizeSpeakingTag(asset?.metadata?.speakingTag || asset?.metadata?.characterTags || "");
  const [draft, setDraft] = useState(savedTags);

  useEffect(() => {
    setDraft(savedTags);
  }, [asset?.id, savedTags]);

  function saveTags() {
    const normalized = normalizeSpeakingTag(draft);
    if (normalized === savedTags) {
      setDraft(normalized);
      return;
    }
    setDraft(normalized);
    onSave?.(normalized);
  }

  return (
    <label className="assetTagsField">
      <span>Speaking tag</span>
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={saveTags}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
        placeholder="@name"
      />
    </label>
  );
}

function AssetLipSyncDefaults({ asset, showDefaultLipSyncModel, busy, onSave, onGenerate }) {
  const savedModel = assetLipSyncModel(asset);
  const savedPrompt = assetLipSyncPrompt(asset);
  const [modelDraft, setModelDraft] = useState(savedModel);
  const [promptDraft, setPromptDraft] = useState(savedPrompt);
  const effectiveModel = modelDraft || optionalLipSyncModel(showDefaultLipSyncModel) || "fabric";

  useEffect(() => {
    setModelDraft(savedModel);
  }, [asset?.id, savedModel]);

  useEffect(() => {
    setPromptDraft(savedPrompt);
  }, [asset?.id, savedPrompt]);

  function savePrompt() {
    const normalized = compactText(promptDraft.trim(), LIPSYNC_INPUT_PROMPT_MAX_LENGTH);
    if (normalized === savedPrompt) {
      setPromptDraft(normalized);
      return;
    }
    setPromptDraft(normalized);
    onSave?.({ lipSyncPrompt: normalized });
  }

  function saveModel(value) {
    const normalized = optionalLipSyncModel(value);
    setModelDraft(normalized);
    if (normalized !== savedModel) {
      onSave?.({ lipSyncModel: normalized });
    }
  }

  return (
    <div className="assetLipSyncDefaults">
      <label className="assetDefaultModel">
        <span>Global model</span>
        <select value={modelDraft} onChange={(event) => saveModel(event.target.value)}>
          <option value="">Show default ({lipSyncModelLabel(showDefaultLipSyncModel)})</option>
          {lipSyncModelOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="assetPromptField">
        <span>Global prompt</span>
        <textarea
          value={promptDraft}
          rows={4}
          onChange={(event) => setPromptDraft(event.target.value)}
          onBlur={savePrompt}
          placeholder="Generate from image or write a reusable visual reference prompt"
        />
      </label>
      <div className="assetPromptActions">
        <button type="button" className="quietButton" onClick={savePrompt}>
          Save
        </button>
        <button type="button" className="secondaryButton" onClick={() => onGenerate?.(effectiveModel)} disabled={busy}>
          <WandSparkles size={14} />
          {busy ? "Generating" : `Generate for ${lipSyncModelLabel(effectiveModel)}`}
        </button>
      </div>
    </div>
  );
}
