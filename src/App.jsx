import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  BadgeCheck,
  Bot,
  Check,
  ChevronRight,
  CircleAlert,
  Clapperboard,
  Copy,
  Eraser,
  Film,
  FileText,
  Gauge,
  Image,
  ListChecks,
  MonitorUp,
  Music,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  Sparkles,
  Trash2,
  Undo2,
  Upload,
  WandSparkles,
  X,
  Youtube
} from "lucide-react";

const API = import.meta.env.VITE_API_URL || "";
const INSERT_TRIM_DEFAULT_SECONDS = 2;
const AUTOSAVE_DELAY_MS = 4000;
const MASK_PREVIEW_ALPHA = 118;

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
    label: "Private draft upload",
    phase: "Publishing",
    description: "Send private YouTube drafts only. Public release remains manual.",
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

const targetTabs = [
  { key: "studio", label: "Studio", icon: Clapperboard },
  { key: "approvals", label: "Approvals", icon: ListChecks }
];

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
    (line) => lineExpectsSpeakerMask(line, assetById.get(line.assetId)) && !String(line.maskAssetId || "").trim()
  );
  const missingInsertVideos = insertLines.filter((line) => !line.videoTake?.localUrl && !line.videoTake?.proxyLocalUrl);
  const missingInsertTrims = insertLines.filter((line) => {
    if (!line.videoTake?.localUrl && !line.videoTake?.proxyLocalUrl) return false;
    return Number(line.videoOutSeconds || 0) <= Number(line.videoInSeconds || 0);
  });
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
      missingInsertVideos.length === 0 && missingInsertTrims.length === 0,
      insertLines.length
        ? `${insertLines.length - missingInsertVideos.length}/${insertLines.length} inserts generated${
            missingInsertTrims.length ? `, ${missingInsertTrims.length} need trim points` : ""
          }`
        : "No insert lines in this script"
    ),
    readinessCheck(
      "approvals",
      "Required approvals",
      pendingPreRenderApprovals.length === 0,
      pendingPreRenderApprovals.length
        ? `${pendingPreRenderApprovals.length} required approvals still need attention`
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
      "preview_video",
      "Preview video",
      Boolean(previewOutput?.localUrl),
      previewOutput?.localUrl ? "Local preview is available" : "Build Preview before final render",
      "warning",
      "review"
    ),
    readinessCheck(
      "render_review",
      "Preview approval",
      Boolean(renderReviewApproved),
      renderReviewApproved ? "Episode Render gate is approved" : "Approve Episode Render after watching the preview",
      "warning",
      "review"
    )
  ];

  const setupReady = setupChecks.every((check) => check.status !== "fail");
  const finalReady = setupReady && reviewChecks.every((check) => check.status === "pass");
  return {
    checks: [...setupChecks, ...reviewChecks],
    setupReady,
    finalReady,
    tone: finalReady ? "good" : setupReady ? "warn" : "danger",
    label: finalReady ? "Ready for final render" : setupReady ? "Ready for preview" : "Needs setup"
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

function lipSyncModelForLine(line) {
  return String(line?.lipSyncModel || "").trim().toLowerCase() === "kling" ? "kling" : "fabric";
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

function friendlyDate(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Not saved yet";
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function episodeOutputsOfType(episode, type) {
  return (episode?.outputs || []).filter((output) => output.type === type);
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
  onRenameEpisode
}) {
  const latestTime = newestTimestamp(episodes);
  const renderedCount = episodes.filter((episode) => episodeOutputsOfType(episode, "final_video").length).length;
  const uploadedCount = episodes.filter((episode) => episodeOutputsOfType(episode, "youtube_upload").some((output) => output.videoId)).length;

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
        <span>{latestTime ? `Last edited ${friendlyDate(latestTime)}` : "Fresh show"}</span>
      </div>

      {episodes.length ? (
        <div className="episodeCardGrid">
          {episodes.map((episode) => {
            const status = episodeStatusSummary(episode);
            const previewImage = episodePreviewImage(episode);
            return (
              <article className="episodeCard" key={episode.id}>
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
                  <div className="buttonRow">
                    <button className="primaryButton" type="button" onClick={() => onOpenEpisode(episode.id)} disabled={busy}>
                      Open Studio
                    </button>
                    <button className="secondaryButton" type="button" onClick={() => onOpenEpisodeReview(episode.id)} disabled={busy}>
                      Open Review
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
  const [showDraft, setShowDraft] = useState(null);
  const [episodeDraft, setEpisodeDraft] = useState(null);
  const [voices, setVoices] = useState([]);
  const [voicesStatus, setVoicesStatus] = useState("Loading voices...");
  const [voicesSource, setVoicesSource] = useState("unavailable");
  const [maskEditorLineId, setMaskEditorLineId] = useState("");
  const [launchReadiness, setLaunchReadiness] = useState(null);
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
      return "YouTube needs to be reconnected before uploading. Click Connect YouTube, approve consent, return to NewtBuilder, then try Upload Private Draft again.";
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
        if (showSnapshot) {
          const show = await request(`/api/shows/${showSnapshot.id}`, {
            method: "PATCH",
            body: JSON.stringify(showSnapshot)
          });
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
              format: episodeSnapshot.format,
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
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
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
      if (showDraft) {
        const show = await request(`/api/shows/${showDraft.id}`, {
          method: "PATCH",
          body: JSON.stringify(showDraft)
        });
        setShows((prev) => [show, ...prev.filter((item) => item.id !== show.id)]);
        setShowDraft(structuredClone(show));
      }
      const episode = await request(`/api/episodes/${draft.id}`, {
        method: "PATCH",
        body: JSON.stringify(draft)
      });
      setEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
      setActiveEpisodeId(episode.id);
      setEpisodeDraft(structuredClone(episode));
      setStatus("Episode saved.");
    } catch (error) {
      setStatus(error.message);
    } finally {
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
        body: JSON.stringify({ scriptText: episodeDraft.scriptText, format: activeShow?.shortFormat || episodeDraft.format })
      });
      setEpisodes((prev) => [episode, ...prev.filter((item) => item.id !== episode.id)]);
      setActiveEpisodeId(episode.id);
      setEpisodeDraft(structuredClone(episode));
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

  async function renderFinalEpisode() {
    if (!activeEpisode) return;
    setBusyAction("render-final");
    setBusy(true);
    try {
      const { episode, job } = await request(`/api/episodes/${activeEpisode.id}/final-render`, {
        method: "POST",
        body: JSON.stringify({})
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
        ? `Upload a new private YouTube draft? The existing draft ${existingUpload.videoId} will stay on YouTube.`
        : "Upload this episode to YouTube as a private draft? This sends the final video and thumbnail to YouTube, but it will not publish publicly."
    );
    if (!ok) return;
    setBusyAction("youtube-upload");
    setBusy(true);
    try {
      const { episode, job, upload } = await request(`/api/episodes/${activeEpisode.id}/youtube/upload-draft`, {
        method: "POST",
        body: JSON.stringify(nextDrafts ? { drafts: nextDrafts } : {})
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

  async function retryYoutubeThumbnail() {
    if (!activeEpisode) return;
    const ok = globalThis.confirm?.(
      "Retry setting the selected thumbnail on the existing private YouTube draft? This sends only the thumbnail to YouTube and will not upload a duplicate video."
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

  function updateProductionLine(lineId, patch) {
    setEpisodeDraft((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      const patchedMap = (next.productionMap || []).map((line) =>
        line.id === lineId ? { ...line, ...patch } : line
      );
      next.productionMap = applyStoredSpeakerMasksToLines(patchedMap, next.assets || []);
      next.productionMapEditedAt = new Date().toISOString();
      return next;
    });
  }

  function deleteProductionLine(lineId) {
    setEpisodeDraft((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      next.productionMap = reindexProductionMap((next.productionMap || []).filter((line) => line.id !== lineId));
      next.productionMapEditedAt = new Date().toISOString();
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
      return next;
    });
    setStatus("Selected production rows ungrouped.");
  }

  function setProductionCharacter(lineId, characterId) {
    const character = (activeShow?.characters || []).find((item) => item.id === characterId);
    updateProductionLine(lineId, {
      characterId,
      voiceId: character?.voiceId || ""
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
  const selectedFormat = activeShow?.shortFormat || episodeDraft?.format || {};
  const plan = episodeDraft?.plan || activeEpisode?.plan || {};
  const approvals = activeEpisode?.approvals || [];
  const preRenderApprovalIds = new Set(["script_plan", "voice_audio"]);
  const preRenderGates = approvals.filter((gate) => preRenderApprovalIds.has(gate.id));
  const preRenderApprovalsReady =
    preRenderGates.length === preRenderApprovalIds.size &&
    preRenderGates.every((gate) => gate.status === "approved" || gate.status === "auto");
  const drafts = episodeDraft?.id === activeEpisode?.id ? episodeDraft?.drafts || {} : activeEpisode?.drafts || {};
  const activeAutomation = showDraft?.automation || {};
  const socialConfig = showDraft?.platforms?.social || activeShow?.platforms?.social || {};
  const promotionTemplates = normalizePromotionTemplates(socialConfig.templates);
  const campaignConfig = {
    ...socialConfig,
    templates: promotionTemplates,
    showName: showDraft?.name || activeShow?.name || "",
    hashtags: showDraft?.creative?.recurringHashtags || activeShow?.creative?.recurringHashtags || [],
    cta: showDraft?.creative?.defaultCta || activeShow?.creative?.defaultCta || ""
  };
  const productionMap = episodeDraft?.productionMap || activeEpisode?.productionMap || [];
  const previewOutputs = (activeEpisode?.outputs || []).filter((output) => output.type === "preview_video");
  const previewOutput = previewOutputs[0] || null;
  const finalOutputs = (activeEpisode?.outputs || []).filter((output) => output.type === "final_video");
  const baseFinalOutput = finalOutputs[0] || null;
  const finishedMasterOutputs = (activeEpisode?.outputs || []).filter((output) => output.type === "finished_master");
  const finishedMasterOutput = finishedMasterOutputs[0] || null;
  const finalOutput = finishedMasterOutput || baseFinalOutput;
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
    assets: episodeDraft?.assets || activeEpisode?.assets || [],
    approvals,
    audioOutput,
    previewOutput,
    renderReviewApproved,
    selectedFormat,
    plan
  });
  const previewBuildReady = Boolean(activeEpisode && preRenderApprovalsReady && renderReadiness.setupReady);
  const finalRenderReady = Boolean(activeEpisode && renderReadiness.finalReady);

  const assetCounts = useMemo(() => {
    const counts = {};
    for (const asset of activeEpisode?.assets || []) {
      const role = asset.shotRole || "general";
      counts[role] = (counts[role] || 0) + 1;
    }
    return counts;
  }, [activeEpisode]);
  const assetsByRole = useMemo(() => {
    const groups = {};
    for (const type of shotAssetTypes) {
      groups[type.role] = [];
    }
    for (const asset of activeEpisode?.assets || []) {
      const role = asset.shotRole || "general";
      if (!groups[role]) groups[role] = [];
      groups[role].push(asset);
    }
    return groups;
  }, [activeEpisode]);
  const visualAssets = useMemo(
    () => (activeEpisode?.assets || []).filter((asset) => asset.type === "image" && asset.shotRole !== "mask"),
    [activeEpisode]
  );
  const maskAssets = useMemo(
    () => (activeEpisode?.assets || []).filter((asset) => asset.type === "image" && asset.shotRole === "mask"),
    [activeEpisode]
  );
  const productionShotTypes = shotAssetTypes.filter((type) => type.role !== "mask");
  const uploadShotTypes = shotAssetTypes.filter((type) => type.role !== "mask");
  const maskEditorLine = productionMap.find((line) => line.id === maskEditorLineId) || null;
  const maskEditorImage = maskEditorLine ? visualAssets.find((asset) => asset.id === maskEditorLine.assetId) || null : null;
  const maskEditorMask = maskEditorLine ? maskAssets.find((asset) => asset.id === maskEditorLine.maskAssetId) || null : null;
  const currentShowEpisodes = episodes.filter((episode) => !activeShowId || episode.showId === activeShowId);
  const libraryView = appView === "library";
  const showDashboardView = appView === "show";
  const workspaceView = appView === "episode";
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
          />
        )}

        {workspaceView && activeTab === "studio" && (
          <section className="overviewBand studioActionBand">
            <button className="primaryButton saveAllButton" onClick={saveStudioAndReview} disabled={!episodeDraft || busy}>
              <Save size={18} />
              Save Episode
            </button>
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
                defaultOpen={false}
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
                defaultOpen={false}
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
                  uploadShotTypes={uploadShotTypes}
                  assetCounts={assetCounts}
                  assetsByRole={assetsByRole}
                  onUpload={uploadAssets}
                  onDelete={deleteAsset}
                  onUpdateTags={updateAssetTags}
                />
              </CollapsiblePanel>
            )}

            <CollapsiblePanel
              className="scriptPanel"
              eyebrow="Episode"
              title="Script Package"
              defaultOpen={false}
              action={
                <label className="secondaryButton">
                  <Upload size={17} />
                  Upload Script
                  <input
                    type="file"
                    accept=".pdf,.txt,.md,.rtf,application/pdf,text/plain,text/markdown"
                    onChange={(event) => handleScriptFile(event.target.files?.[0])}
                  />
                </label>
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
              </div>
            </CollapsiblePanel>

            <ProductionMapPanel
              productionMap={productionMap}
              characters={activeShow?.characters || []}
              voices={voices}
              shotTypes={productionShotTypes}
              visualAssets={visualAssets}
              maskAssets={maskAssets}
              onUpdate={updateProductionLine}
              onSetCharacter={setProductionCharacter}
              onDeleteLine={deleteProductionLine}
              onReorderLine={reorderProductionLine}
              onGroupLines={groupProductionLines}
              onUngroupLines={ungroupProductionLines}
              onRegenerateAudio={regenerateLineAudio}
              onSetAudioStatus={setLineAudioStatus}
              onOpenMaskEditor={setMaskEditorLineId}
              onGenerateInsertVideo={generateInsertVideo}
              onUploadInsertVideo={uploadInsertVideo}
              busy={busy}
              busyAction={busyAction}
            />

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
                        <input value={showDraft.shortFormat.resolution} readOnly />
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
                          <option value="fabric">Fabric</option>
                          <option value="kling">Kling</option>
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
                      label="Kling expressive body default"
                      icon={Activity}
                    />
                    <div className="manualPublishNotice">
                      These defaults apply when a new script plan is built. Existing mapped lines keep their current per-shot settings.
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
                    Auto upload creates private YouTube drafts only. Public release and non-YouTube promotion stay manual.
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
                      <Field label="Draft privacy">
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
            <div className="approvalStack topGates">
              {approvals.map((gate) => (
                <ApprovalGate key={gate.id} gate={gate} onApprove={setApproval} />
              ))}
            </div>
            <AutomationRunbookPanel automation={activeAutomation} safety={safety} />
            <FinalReviewPanel
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
              selectedFormat={selectedFormat}
              socialConfig={campaignConfig}
              integrations={integrations}
              youtubeAuth={youtubeAuth}
              safety={safety}
              launchReadiness={launchReadiness}
              hasProductionMap={productionMap.length > 0}
              readiness={renderReadiness}
              canBuildPreview={previewBuildReady}
              canRenderFinal={finalRenderReady}
              busy={busy}
              busyAction={busyAction}
              onRebuildAudio={rebuildAudioMix}
              onBuildPreview={runPipeline}
              onRenderFinal={renderFinalEpisode}
              onUploadFinishingLayers={uploadFinishingLayerFiles}
              onSaveFinishingLayers={saveFinishingLayers}
              onExportFinishedMaster={exportFinishedMaster}
              onGenerateFinishingMusic={generateFinishingMusic}
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

function CollapsiblePanel({ className = "", eyebrow, title, action = null, children, defaultOpen = false }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <section className={`workPanel collapsiblePanel ${isOpen ? "open" : "closed"} ${className}`}>
      <div className="panelHeader collapsibleHeader">
        <button
          type="button"
          className="collapseTitle"
          onClick={() => setIsOpen((value) => !value)}
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

function RenderReadinessPanel({ readiness }) {
  const setupChecks = readiness.checks.filter((check) => check.group === "setup");
  const reviewChecks = readiness.checks.filter((check) => check.group === "review");

  return (
    <details className="reviewDetails readinessPanel">
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
  return {
    superText,
    prompt: `Create a ${aspect} YouTube thumbnail that includes the selected still frame, a dynamic super, and the provided episode information.`,
    details
  };
}

function visibleThumbnailCandidates(outputs = []) {
  const aiOutputs = outputs.filter(
    (output) => String(output.provider || "").includes("gpt-image") || String(output.fileName || "").includes("-ai.")
  );
  return (aiOutputs.length ? aiOutputs : outputs).slice(0, 3);
}

function AutomationRunbookPanel({ automation = {}, safety = {} }) {
  const autoStages = automationControls.filter((stage) => automation[stage.key]);
  const privateUploadActive = Boolean(automation.uploadYoutube);

  return (
    <details className="reviewDetails automationRunbookPanel">
      <summary>
        <span>Automation Runbook</span>
        <Pill tone={autoStages.length ? "good" : "neutral"}>{autoStages.length} auto</Pill>
      </summary>
      <div className="automationRunbookBody">
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
            ? "YouTube automation can upload private drafts only. Public publishing still requires the manual handoff checklist."
            : "YouTube upload is manual. Use YouTube Prep after final render and thumbnail selection."}
        </div>
        {safety.publishingEnabled ? (
          <div className="manualPublishNotice warning">
            Publishing mode is enabled. Current safety boundary: private YouTube draft uploads only.
          </div>
        ) : null}
      </div>
    </details>
  );
}

function FinalReviewPanel({
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
  selectedFormat,
  socialConfig,
  integrations,
  youtubeAuth,
  safety,
  launchReadiness,
  hasProductionMap,
  readiness,
  canBuildPreview,
  canRenderFinal,
  busy,
  busyAction,
  onRebuildAudio,
  onBuildPreview,
  onRenderFinal,
  onUploadFinishingLayers,
  onSaveFinishingLayers,
  onExportFinishedMaster,
  onGenerateFinishingMusic,
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
  const reviewVideo = finalOutput || previewOutput;
  const renderBusy = busyAction === "rebuild-audio" || busyAction === "build-preview" || busyAction === "render-final";
  const thumbnailBusy = busyAction === "thumbnails";
  const selectedThumbnailId = drafts.selectedThumbnailOutputId || thumbnailOutputs.find((thumb) => thumb.isSelected)?.id || "";
  const selectedThumbnail = thumbnailOutputs.find((thumb) => thumb.id === selectedThumbnailId) || null;
  const latestPackage = packageOutputs[0] || null;
  const latestYoutubeUpload = youtubeUploadOutputs[0] || null;
  const packageReady = Boolean(finalOutput && selectedThumbnail);
  const thumbnailBriefDefaults = useMemo(
    () => defaultThumbnailBrief({ drafts, selectedFormat }),
    [drafts, selectedFormat.aspectRatio]
  );
  const [thumbnailBrief, setThumbnailBrief] = useState(thumbnailBriefDefaults);

  useEffect(() => {
    setThumbnailBrief(thumbnailBriefDefaults);
  }, [thumbnailBriefDefaults]);

  const updateThumbnailBrief = (key, value) => {
    setThumbnailBrief((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <section className="workPanel finalReviewPanel">
      <div className="panelHeader">
        <div>
          <span className="eyebrow">Render Control</span>
          <div className="renderTitleRow">
            <h3>Preview & Final Render</h3>
            {renderBusy ? <RefreshCw className="spin renderRunningIcon" size={17} aria-label="Render running" /> : null}
          </div>
        </div>
      </div>

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
            onClick={onBuildPreview}
            disabled={!canBuildPreview || busy}
            title={canBuildPreview ? "Create or refresh the local preview" : readiness.setupReady ? "Select an episode first" : "Clear the Render Readiness setup checks first"}
          >
            <Play size={17} />
            Build Preview
          </button>
          <button
            className="runButton"
            onClick={onRenderFinal}
            disabled={!canRenderFinal || busy}
            title={canRenderFinal ? "Create final local render" : "Complete the Render Readiness review checks first"}
          >
            <Film size={17} />
            Render Final
          </button>
        </div>
      </div>

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
            <video
              src={reviewVideo.localUrl}
              controls
              playsInline
              style={{ aspectRatio: selectedFormat.aspectRatio === "9:16" ? "9 / 16" : "16 / 9" }}
            />
            <div>
              <strong>{finalOutput ? "Final local render" : "Local episode preview"}</strong>
              <p>{reviewVideo.name}</p>
            </div>
          </div>
        )}
      </div>

      <RenderReadinessPanel readiness={readiness} />

      <FinishingLayersPanel
        baseFinalOutput={baseFinalOutput}
        finishedMasterOutput={finishedMasterOutput}
        layers={drafts.finishingLayers || []}
        busy={busy}
        busyAction={busyAction}
        integrations={integrations}
        onUploadLayers={onUploadFinishingLayers}
        onSaveLayers={onSaveFinishingLayers}
        onExportMaster={onExportFinishedMaster}
        onGenerateMusic={onGenerateFinishingMusic}
      />

      <details className="reviewDetails thumbnailReviewPanel">
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
                  <img src={thumb.localUrl} alt="" />
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
        <details className="reviewDetails">
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
            {finalOutputs.slice(0, 2).map((video) => (
              <a key={video.id} href={video.localUrl} target="_blank" rel="noreferrer">
                <Film size={16} />
                <span>{video.name}</span>
              </a>
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
                <span>{upload.name || "YouTube private draft"}</span>
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
    </section>
  );
}

function FinishingLayersPanel({
  baseFinalOutput,
  finishedMasterOutput,
  layers = [],
  busy,
  busyAction,
  integrations = {},
  onUploadLayers,
  onSaveLayers,
  onExportMaster,
  onGenerateMusic
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
  const hasLayers = draftLayers.length > 0;
  const uploadBusy = busyAction === "finishing-upload";
  const exportBusy = busyAction === "finishing-export";
  const saveBusy = busyAction === "finishing-save";
  const musicBusy = busyAction === "finishing-music";
  const elevenMusicReady = Boolean(integrations?.elevenlabs);

  function updateMusicBrief(key, value) {
    setMusicBrief((prev) => ({
      ...prev,
      [key]: key === "volume" ? clampTimelineValue(Number(value) || 0, 0, 2) : value
    }));
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
    const copy = normalizeFinishingLayerForUi({
      ...layer,
      id: createLocalId("finishing-layer"),
      name: `${layer.name || finishingLayerTypeLabel(layer.type)} copy`,
      duplicatedFromLayerId: layer.id,
      startSeconds: clampTimelineValue((Number(layer.startSeconds) || 0) + 0.5, 0, Math.max(0, timelineSeconds - (Number(layer.durationSeconds) || 0.1))),
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

  return (
    <details className="reviewDetails finishingLayersPanel" ref={finishingPanelRef}>
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
                ? "YouTube Prep will use the finished master."
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

        {draftLayers.length ? (
          <div className="finishingLayerList">
            {draftLayers.map((layer) => (
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
  const [youtubeForm, setYoutubeForm] = useState(() => ({
    title: youtubeDraft.title || "",
    description: youtubeDraft.description || "",
    tagsText: (youtubeDraft.tags || []).join(", "),
    privacyStatus: "private",
    categoryId: youtubeDraft.categoryId || "24",
    madeForKids: Boolean(youtubeDraft.madeForKids),
    notifySubscribers: Boolean(youtubeDraft.notifySubscribers),
    containsSyntheticMedia: youtubeDraft.containsSyntheticMedia !== false,
    plannedPublishAt: youtubeDraft.plannedPublishAt || "",
    publishNotes: youtubeDraft.publishNotes || "",
    readyToPublish: Boolean(youtubeDraft.readyToPublish),
    readyToPublishAt: youtubeDraft.readyToPublishAt || "",
    handoffChecklist: {
      ...youtubeHandoffDefaults,
      ...(youtubeDraft.handoffChecklist || {})
    },
    promotion: {
      ...youtubePromotionDefaults,
      ...(youtubeDraft.promotion || {})
    }
  }));

  useEffect(() => {
    const next = JSON.parse(youtubeDraftKey || "{}");
    setYoutubeForm({
      title: next.title || "",
      description: next.description || "",
      tagsText: (next.tags || []).join(", "),
      privacyStatus: "private",
      categoryId: next.categoryId || "24",
      madeForKids: Boolean(next.madeForKids),
      notifySubscribers: Boolean(next.notifySubscribers),
      containsSyntheticMedia: next.containsSyntheticMedia !== false,
      plannedPublishAt: next.plannedPublishAt || "",
      publishNotes: next.publishNotes || "",
      readyToPublish: Boolean(next.readyToPublish),
      readyToPublishAt: next.readyToPublishAt || "",
      handoffChecklist: {
        ...youtubeHandoffDefaults,
        ...(next.handoffChecklist || {})
      },
      promotion: {
        ...youtubePromotionDefaults,
        ...(next.promotion || {})
      }
    });
  }, [youtubeDraftKey]);

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
      label: "Private draft",
      detail: latestYoutubeUpload?.videoId || "Upload private YouTube draft",
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
    <details className="reviewDetails finalPackagePanel" open>
      <summary>
        <span>{latestYoutubeUpload?.videoId ? "Episode Complete" : "YouTube Prep"}</span>
        <Pill tone={youtubeSummaryTone}>{youtubeSummaryLabel}</Pill>
      </summary>
      <div className="finalPackageBody">
        <div className={`episodeCompletePanel ${latestYoutubeUpload?.videoId ? "uploaded" : ""}`}>
          <div className="episodeCompleteHeader">
            <div>
              <span className="eyebrow">Episode Complete</span>
              <strong>{completionState}</strong>
              <p>Review the finished render, selected thumbnail, YouTube draft, and manual schedule status from one place.</p>
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
                <span>YouTube draft</span>
                <strong>{latestYoutubeUpload?.videoId || "Not uploaded yet"}</strong>
                {youtubeWatchUrl ? (
                  <a href={youtubeWatchUrl} target="_blank" rel="noreferrer">Open draft</a>
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
              <img src={selectedThumbnail.localUrl} alt="" />
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
              <strong>YouTube draft</strong>
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
              </span>
            </div>
            <Pill tone={thumbnailTone}>{latestYoutubeUpload.thumbnailSet ? "thumbnail set" : "thumbnail warning"}</Pill>
          </div>
        ) : null}

        {latestYoutubeUpload?.videoId ? (
          <div className="youtubeDraftManager">
            <div className="draftManagerHeader">
              <div>
                <strong>YouTube Draft Manager</strong>
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
          </div>
        ) : null}

        <div className="packageMetadata">
          <Field label="YouTube title">
            <input value={youtubeForm.title} maxLength={100} onChange={(event) => updateYoutubeForm("title", event.target.value)} />
          </Field>
          <Field label="Draft privacy">
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
          </div>
          <div className="manualPublishNotice">
            NewtBuilder uploads private drafts only. The schedule target and notes are saved here, then applied manually in YouTube Studio.
          </div>
        </div>

        <details className="advancedYoutubeActions youtubePromotionPanel">
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
              These drafts are saved with YouTube Prep and included in the export package. Posting remains manual.
            </div>
          </div>
        </details>

        <div className="packageActions primaryYoutubeActions">
          <button className="secondaryButton" onClick={saveDraft} disabled={busy}>
            <Save size={16} />
            Save YouTube Prep
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
                  ? "Upload this final video and thumbnail as a private YouTube draft"
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
              Upload Private Draft
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
                  ? "Retry setting the selected thumbnail on the existing YouTube draft"
                  : "Connect YouTube, unlock publishing, and select a thumbnail first"
              }
            >
              {thumbnailRetryBusy ? <RefreshCw className="spin" size={16} /> : <Image size={16} />}
              Retry Thumbnail
            </button>
          ) : null}
        </div>

        <details className="advancedYoutubeActions">
          <summary>Advanced & files</summary>
          <div className="packageActions">
            <button className="secondaryButton" onClick={exportPackage} disabled={!ready || busy}>
              <FileText size={17} />
              Export Package
            </button>
            {latestYoutubeUpload?.videoId ? (
              <button
                className="secondaryButton"
                onClick={uploadPrivateDraft}
                disabled={!canUploadDraft}
                title="Create another private YouTube draft from the current final video and thumbnail"
              >
                {uploadBusy ? <RefreshCw className="spin" size={17} /> : <MonitorUp size={17} />}
                Upload New Draft
              </button>
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

function LaunchReadinessPanel({ readiness, busy, busyAction, onCheck }) {
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
        <details className="launchReadinessDetails">
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
  onGenerateInsertVideo,
  onUploadInsertVideo,
  busyAction,
  busy
}) {
  const hasLines = productionMap.length > 0;
  const [isOpen, setIsOpen] = useState(false);
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
      invertMask: false
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

  return (
    <section className={`workPanel productionMapPanel collapsiblePanel ${isOpen ? "open" : "closed"}`}>
      <div className="panelHeader collapsibleHeader">
        <button
          type="button"
          className="collapseTitle"
          onClick={() => setIsOpen((value) => !value)}
          aria-expanded={isOpen}
        >
          <ChevronRight size={18} className={isOpen ? "open" : ""} />
          <div>
            <span className="eyebrow">Script Production Map</span>
            <h3>Voices, Shots & Masks</h3>
          </div>
        </button>
        <div className="buttonRow">
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
  onGenerateInsertVideo,
  onUploadInsertVideo,
  busyAction,
  onDragEnd
}) {
  const lipSyncModel = lipSyncModelForLine(line);
  const insertUploadMode = isInsert && line.insertVideoMode === "upload";
  const showScriptEditor = !insertUploadMode;
  const maskExpected = !isInsert && lineExpectsSpeakerMask(line, selectedAsset);
  const hasMask = Boolean(line.maskAssetId);

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
      audioTake: null
    });
  }

  return (
    <article
      className={[
        "productionLine",
        isInsert ? "insertProductionLine" : "",
        isSelected ? "selected" : "",
        isDragging ? "dragging" : "",
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
                onChange={(event) => onUpdate(line.id, { audioTags: event.target.value })}
                placeholder="[happy] [whispers]"
              />
            </label>
            <LineAudioReview
              line={line}
              status={reviewStatus}
              busy={busy}
              onRegenerateAudio={onRegenerateAudio}
              onSetAudioStatus={onSetAudioStatus}
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
              <select value={line.voiceId || ""} onChange={(event) => onUpdate(line.id, { voiceId: event.target.value })}>
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
                onChange={(event) =>
                  onUpdate(line.id, {
                    assetId: event.target.value,
                    needsMask: false,
                    maskAssetId: "",
                    invertMask: false
                  })
                }
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
                onChange={(event) => onUpdate(line.id, { videoPrompt: event.target.value })}
                placeholder="Optional motion, blocking, or expression direction for this shot"
              />
            </label>
          </div>

          <div className="lineVisualControls">
            <ShotMaskCard
              imageAsset={selectedAsset}
              maskAsset={selectedMask}
              hasMask={hasMask}
              maskNeeded={maskExpected && !hasMask}
              busy={busy}
              onOpen={() => onOpenMaskEditor(line.id)}
            />
            <Toggle
              checked={lipSyncModel === "kling"}
              onChange={(checked) => onUpdate(line.id, { lipSyncModel: checked ? "kling" : "fabric" })}
              label="Use Kling"
              icon={Clapperboard}
            />
            {lipSyncModel === "kling" ? (
              <Toggle
                checked={Boolean(line.expressiveBodyMotion)}
                onChange={(checked) => onUpdate(line.id, { expressiveBodyMotion: checked })}
                label="Expressive body"
                icon={Activity}
              />
            ) : null}
          </div>
        </>
      )}
    </article>
  );
}

function ShotMaskCard({ imageAsset, maskAsset, hasMask, maskNeeded, busy, onOpen }) {
  return (
    <div className="shotMaskCard">
      <div className="shotMaskPreview">
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
    </div>
  );
}

function MaskEditorModal({ line, imageAsset, maskAsset, busy, onClose, onSave }) {
  const canvasRef = useRef(null);
  const lastPointRef = useRef(null);
  const [tool, setTool] = useState("brush");
  const [brushSize, setBrushSize] = useState(150);
  const [canvasReady, setCanvasReady] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
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
    if (canvas) clearCanvas(canvas);
  }

  function suggestMask() {
    const canvas = canvasRef.current;
    if (!canvas || !canvasReady) return;
    if (!suggestedSpeakerMaskRegion(canvas, { line, imageAsset })) return;
    clearCanvas(canvas);
    paintSuggestedSpeakerMask(canvas, { line, imageAsset });
  }

  function saveMask() {
    const canvas = canvasRef.current;
    if (!canvas || !canvasReady) return;
    onSave(line, exportMaskPng(canvas));
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
          <button type="button" className="quietButton iconOnly" onClick={onClose} disabled={busy}>
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
          <button type="button" className="quietButton" onClick={clearMask} disabled={busy || !canvasReady}>
            <Trash2 size={15} />
            Clear
          </button>
          <button
            type="button"
            className="quietButton"
            onClick={suggestMask}
            disabled={busy || !canvasReady || !canSuggestMask}
            title={canSuggestMask ? "Suggest a speaker matte from the filename role order" : "Suggested masks need a grouped MS/WS filename with two or more cast roles"}
          >
            <WandSparkles size={15} />
            Suggest
          </button>
          <button type="button" className="primaryButton" onClick={saveMask} disabled={busy || !canvasReady}>
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
    return "Auto-suggest needs an MS/WS filename with two or more visible roles, like WS_MAX-PIP_01.png.";
  }
  const speakerRole = targetSpeakerMaskRole(line, imageAsset);
  if (!roles.includes(speakerRole)) {
    return `Auto-suggest could not find ${speakerRole} in this filename's role order.`;
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
  return "GUEST";
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
          <div className="trimPreviewShell">
            <video key={proxyUrl} ref={videoRef} muted playsInline preload="metadata" src={proxyUrl} />
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

function LineAudioReview({ line, status, busy, onRegenerateAudio, onSetAudioStatus }) {
  const take = line.audioTake || null;
  const hasAudio = Boolean(take?.localUrl);

  return (
    <div className="lineAudioReview">
      <div className="lineAudioMeta">
        <span>{take?.mode || "No clip yet"}</span>
        {take?.durationSeconds ? <span>{formatSeconds(take.durationSeconds)}</span> : null}
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
  if (status === "approved" || status === "generated") return "good";
  if (status === "hold") return "warn";
  if (status === "failed") return "danger";
  return "neutral";
}

function videoStatusLabel(status) {
  if (status === "approved") return "video approved";
  if (status === "generated") return "video ready";
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

function assetLabel(asset) {
  const binding = assetShotBinding(asset);
  const bindingLabel = shotBindingLabel(binding);
  return `${asset.fileName}${bindingLabel || asset.roleLabel ? ` (${bindingLabel || asset.roleLabel})` : ""}`;
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
  const assetShotRole = shotFilenameBinding(asset.fileName).shotRole || String(asset.shotRole || "");
  return ["medium_two_shot", "wide_shot"].includes(shotRole) || ["medium_two_shot", "wide_shot"].includes(assetShotRole);
}

function lineExpectsSpeakerMask(line, asset) {
  if (!lineCanUseSpeakerMask(line, asset)) return false;
  return assetSpeakerRoles(asset).length > 1;
}

function speakerMaskMatchesLine(maskAsset, line) {
  if (!maskAsset || !line) return false;
  return (
    String(maskAsset.metadata?.sourceImageAssetId || "") === String(line.assetId || "") &&
    String(maskAsset.metadata?.speakerMaskKey || "") === speakerMaskReuseKey(line)
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
  return "guest";
}

function keyForMaskMatch(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function assetShotBinding(asset) {
  return shotFilenameBinding(asset?.fileName);
}

function assetSpeakerRoles(asset) {
  return shotFilenameBinding(asset?.fileName).roles;
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
  const first = fallback[0] || "";
  return first ? `@${first.slice(0, 48)}` : "";
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
  if (!token || ["TALKING", "SPEAKING", "SHOT", "WIDE", "MEDIUM", "CU", "MS", "WS", "INSERT", "INS", "LEFT", "RIGHT", "CENTER", "MIDDLE", "MID", "TABLE", "ROOM", "CLUBHOUSE", "REACTION", "BACKGROUND", "BG", "FG"].includes(token)) {
    return false;
  }
  return !/^\d+$/.test(token);
}

function shotBindingLabel(binding) {
  const roleText = binding?.roles?.length ? binding.roles.join("/") : "";
  if (!binding?.shotRole) return roleText;
  return [binding.prefix, roleText].filter(Boolean).join(" ");
}

function CastVisualLibrary({ uploadShotTypes, assetCounts, assetsByRole, onUpload, onDelete, onUpdateTags }) {
  const characterShotTypes = uploadShotTypes.filter((type) => type.role !== "insert_shot");
  const insertShotType = uploadShotTypes.find((type) => type.role === "insert_shot");

  return (
    <div className="castVisualLibrary">
      <div className="castSubheader">
        <span className="eyebrow">Cast Visuals</span>
        <strong>Shot Images</strong>
      </div>
      <div className="shotUploadGrid castShotUploadGrid">
        {characterShotTypes.map((type) => (
          <ShotUploadCard
            key={type.role}
            type={type}
            count={assetCounts[type.role] || 0}
            assets={assetsByRole[type.role] || []}
            onUpload={(files) => onUpload(files, type.role)}
            onDelete={onDelete}
            onUpdateTags={onUpdateTags}
          />
        ))}
      </div>
      {insertShotType ? (
        <>
          <div className="castSubheader compact">
            <span className="eyebrow">Episode Inserts</span>
            <strong>Insert Shots</strong>
          </div>
          <div className="shotUploadGrid insertShotUploadGrid">
            <ShotUploadCard
              type={insertShotType}
              count={assetCounts[insertShotType.role] || 0}
              assets={assetsByRole[insertShotType.role] || []}
              onUpload={(files) => onUpload(files, insertShotType.role)}
              onDelete={onDelete}
              onUpdateTags={onUpdateTags}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}

function ShotUploadCard({ type, count, assets, onUpload, onDelete, onUpdateTags }) {
  const Icon = type.icon;
  const previewAssets = (assets || []).filter((asset) => asset.type === "image");

  return (
    <article className="shotUploadCard">
      <div className="shotUploadHeader">
        <div className="shotIcon">
          <Icon size={18} />
        </div>
        <div>
          <strong>{type.label}</strong>
          <p>{type.hint}</p>
        </div>
        <Pill tone={count ? "good" : "neutral"}>{count}</Pill>
      </div>

      <label className="shotDrop">
        <Upload size={18} />
        <span>Upload images</span>
        <input
          type="file"
          multiple
          accept="image/*"
          onChange={(event) => onUpload(event.target.files)}
        />
      </label>

      {previewAssets.length ? (
        <div className="assetPreviewGrid">
          {previewAssets.map((asset) => (
            <div key={asset.id} className="assetThumb">
              <div className="assetThumbImage">
                {shotBindingLabel(assetShotBinding(asset)) ? (
                  <strong className="assetBindingChip">{shotBindingLabel(assetShotBinding(asset))}</strong>
                ) : null}
                <img src={asset.localUrl} alt={asset.fileName} />
                <button type="button" className="assetDelete" onClick={() => onDelete(asset.id)} title="Delete image">
                  <Trash2 size={14} />
                </button>
                <span>{asset.fileName}</span>
              </div>
              {asset.shotRole !== "insert_shot" ? (
                <AssetTagsField asset={asset} onSave={(tags) => onUpdateTags?.(asset.id, tags)} />
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="assetEmpty">No images yet.</div>
      )}
    </article>
  );
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
