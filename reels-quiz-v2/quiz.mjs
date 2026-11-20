import {
  AGE_RANGES, AXES_META, DAY_TO_AXIS, GENDERS, OFFLINE_STEPS, QUESTIONS,
  STORES, buildBookingDates, computeBMI, evaluateAxes, hasRedFlags,
} from "./quiz-data.mjs";

const window = globalThis.window;
const { document, location, crypto } = window;
const MEDIA_ROOT = "/demo/reels-quiz/media/";
const STORAGE_TTL_MS = 48 * 60 * 60 * 1000;
const params = new URLSearchParams(location.search);
const dayParam = (params.get("day") || "").padStart(2, "0");
const day = Object.hasOwn(DAY_TO_AXIS, dayParam) ? dayParam : "01";
const axisParam = params.get("axis");
const axis = Object.hasOwn(AXES_META, axisParam) ? axisParam : DAY_TO_AXIS[day];
const localPreview = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
const devMode = localPreview && params.get("dev") === "1";
const storageKey = `hd_reels_v4:${day}:${axis}${devMode ? ":dev" : ""}`;
const reportSteps = new Set(["report1", "offline_flow", "booking", "booking_done", "post_whatsapp"]);
const savedSteps = new Set(["welcome", "q1", ...Object.keys(QUESTIONS), "safety_stop", "review", "checkout", ...reportSteps]);
const emptyAnswers = { q1: "", q2: [], q3: [], q4: [], q5: [], q6: [], q7: "" };
const emptyUser = { name: "", phone: "", email: "", ageRange: "", gender: "", heightCm: "", weightKg: "", marketingConsent: false };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emptyBooking = { loc: "", date: "", weekday: "", dateLabel: "", time: "" };
let acceptedRecord = null;
let resumeTarget = null;
let loadingSaved = false;
let resumeError = "";
let checkoutNotice = "";
let changesChannel = null;
let recordNeedsRefresh = false;
const state = window.state = {
  submissionId: null,
  submissionToken: null,
  pendingSubmission: null,
  lastSubmittedAt: "",
  bookingSuperseded: false,
  day,
  axis,
  step: "welcome",
  phase: "video",
  textFirst: false,
  whatsappOpened: false,
  whatsappConfirmed: false,
  editingFromReview: false,
  paidLocked: false,
  currentClipKey: "",
  localVideos: {},
  answers: { ...emptyAnswers },
  user: { ...emptyUser },
  hmcs: { ...emptyBooking },
  unmuted: true,
  rate: 1,
};

if (devMode) document.body.classList.add("dev-mode");
document.getElementById("axisJumpSel").value = state.axis;

function escapeHtml(value) {
  const escapes = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(value ?? "").replace(/[&<>"']/g, char => escapes[char]);
}

function saveTabState() {
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify({
      ts: Date.now(), answers: state.answers, step: state.step, phase: state.phase,
      textFirst: state.textFirst, whatsappOpened: state.whatsappOpened, whatsappConfirmed: state.whatsappConfirmed,
      editingFromReview: state.editingFromReview, unmuted: state.unmuted, rate: state.rate,
      submissionId: state.submissionId, submissionToken: state.submissionToken,
      user: state.user, hmcs: state.hmcs, paidLocked: state.paidLocked,
      pendingSubmission: state.pendingSubmission, lastSubmittedAt: state.lastSubmittedAt,
      bookingSuperseded: state.bookingSuperseded,
    }));
  } catch {
    // The current session remains usable in browsers that block Web Storage.
  }
}

function restoreAnswers(savedAnswers) {
  const questions = { q1: { mode: "single", opts: AXES_META[state.axis].q1Opts }, ...QUESTIONS };
  const answers = {};
  for (const [id, { mode, opts }] of Object.entries(questions)) {
    const saved = savedAnswers?.[id];
    const validOptions = new Map(opts.map(option => [option.val, option]));
    if (mode === "single") {
      answers[id] = validOptions.has(saved) ? saved : "";
      continue;
    }
    const validSelections = Array.isArray(saved) ? [...new Set(saved)].filter(value => validOptions.has(value)) : [];
    const selected = validSelections.filter(value => !validOptions.get(value).isNone);
    answers[id] = selected.length ? selected : validSelections.slice(0, 1);
  }
  return answers;
}

function restoreTabState() {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(storageKey));
    if (!saved || Date.now() - saved.ts > STORAGE_TTL_MS) {
      window.sessionStorage.removeItem(storageKey);
      return;
    }
    state.answers = restoreAnswers(saved.answers);
    state.unmuted = saved.unmuted !== false;
    state.rate = [1, 1.5, 2, 0.8].includes(saved.rate) ? saved.rate : 1;
    if (uuid.test(saved.submissionId) && uuid.test(saved.submissionToken) &&
        saved.submissionId.toLowerCase() !== saved.submissionToken.toLowerCase()) {
      state.submissionId = saved.submissionId.toLowerCase();
      state.submissionToken = saved.submissionToken.toLowerCase();
      const pending = saved.pendingSubmission;
      if (pending?.submission_id === state.submissionId && pending.submission_token === state.submissionToken &&
          ["quiz_unlocked", "booking_intent"].includes(pending.event_type) && Number.isFinite(Date.parse(pending.submitted_at))) {
        state.pendingSubmission = pending;
      }
      if (Number.isFinite(Date.parse(saved.lastSubmittedAt))) state.lastSubmittedAt = saved.lastSubmittedAt;
    }
    state.hmcs = { ...state.hmcs, ...saved.hmcs };
    state.user = { ...emptyUser, ...saved.user };
    state.textFirst = saved.textFirst === true;
    state.whatsappOpened = saved.whatsappOpened === true;
    state.whatsappConfirmed = saved.whatsappConfirmed === true;
    state.paidLocked = saved.paidLocked === true && Boolean(state.submissionId);
    state.bookingSuperseded = saved.bookingSuperseded === true;
    if (savedSteps.has(saved.step)) {
      state.step = saved.step;
      state.phase = saved.phase === "panel" ? "panel" : "video";
      state.editingFromReview = saved.editingFromReview === true;
    }
    if (state.step === "welcome") state.phase = "video";
    if (reportSteps.has(state.step) && !state.submissionId && !devMode) {
      state.step = "checkout";
      state.phase = "panel";
      state.hmcs = { ...emptyBooking };
      state.whatsappOpened = state.whatsappConfirmed = false;
    }
    if (hasRedFlags(state.answers) && (reportSteps.has(state.step) || ["q7", "review", "checkout"].includes(state.step))) {
      state.step = "safety_stop";
      state.phase = "panel";
      state.paidLocked = false;
    }
    if (!devMode && reportSteps.has(state.step)) resumeTarget = { step: state.step, phase: state.phase };
  } catch {
    // A corrupted or unavailable draft must not prevent the quiz from opening.
  }
}

restoreTabState();

const analyticsKey = "hd_reels_v4:analytics";
const source = params.get("platform") || params.get("src");
const platform = ["fb", "ig"].includes(source) ? source : "unknown";
function loadAnalytics() {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(analyticsKey));
    if (saved?.id && Array.isArray(saved.seen)) return saved;
  } catch {
    // Keep analytics independent of draft/storage availability.
  }
  return { id: crypto.randomUUID(), seen: [] };
}
const analytics = loadAnalytics();

async function trackEvent(event) {
  if (devMode) return;
  if (event === "start" || event === "checkout") {
    if (analytics.seen.includes(event)) return;
    analytics.seen.push(event);
  }
  try {
    window.sessionStorage.setItem(analyticsKey, JSON.stringify(analytics));
  } catch {
    // Still usable with storage disabled.
  }
  try {
    await window.fetch("/api/event-v2", {
      method: "POST", headers: { "content-type": "application/json" }, keepalive: true,
      credentials: "omit", referrerPolicy: "no-referrer",
      body: JSON.stringify({ analytics_id: analytics.id, event, platform, reel: day }),
    });
  } catch {
    // Analytics must never interrupt a questionnaire or WhatsApp navigation.
  }
}

const videoEl = document.getElementById("duncanVideo");
const videoLayerEl = document.getElementById("videoLayer");
const videoControlsEl = document.getElementById("videoControls");
const glassPanelEl = document.getElementById("glassPanel");
const skipVideoBtn = document.getElementById("skipVideoBtn");
const muteVideoBtn = document.getElementById("muteVideoBtn");
const startPlayBtn = document.getElementById("startPlayBtn");
const speedVideoBtn = document.getElementById("speedVideoBtn");
let userPreferredUnmuted = state.unmuted;
let userPlaybackRate = state.rate;
const SPEED_OPTIONS = [
  { rate: 1,   label: "語速：正常" },
  { rate: 1.5, label: "語速：快速" },
  { rate: 2,   label: "語速：極快" },
  { rate: 0.8, label: "語速：慢速" }
];
function cyclePlaybackRate(e) {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  const curIdx = SPEED_OPTIONS.findIndex(o => o.rate === userPlaybackRate);
  const next = SPEED_OPTIONS[(curIdx + 1) % SPEED_OPTIONS.length];
  userPlaybackRate = next.rate;
  state.rate = next.rate;
  saveTabState();
  videoEl.playbackRate = userPlaybackRate;
  if (speedVideoBtn) speedVideoBtn.textContent = next.label;
};
const videoStatus = document.getElementById("videoStatus");
let stallTimer;

function updateMuteBtnUI() {
  muteVideoBtn.textContent = userPreferredUnmuted ? "🔊 有聲" : "🔇 已靜音";
}

function revealVideoCta() {
  if (state.phase === "video") skipVideoBtn.classList.remove("delayed-hide");
}

function clearVideoStatus() {
  window.clearTimeout(stallTimer);
  videoStatus.hidden = true;
  videoLayerEl.classList.remove("video-unavailable");
}

function showVideoRecovery(message, allowManualPlay) {
  if (state.phase !== "video") return;
  window.clearTimeout(stallTimer);
  videoStatus.textContent = message;
  videoStatus.hidden = false;
  startPlayBtn.classList.toggle("hide", !allowManualPlay);
  if (!allowManualPlay) videoLayerEl.classList.add("video-unavailable");
  revealVideoCta();
}

function resetVideoCtaGuard() {
  clearVideoStatus();
  skipVideoBtn.classList.add("delayed-hide");
}

function armStallTimer() {
  window.clearTimeout(stallTimer);
  stallTimer = window.setTimeout(() => {
    showVideoRecovery("影片暫時載入唔到，你可以重播或者繼續。", false);
  }, 10000);
}

videoEl.addEventListener("timeupdate", () => {
  if (Number.isFinite(videoEl.duration) && videoEl.duration - videoEl.currentTime <= 1.05) revealVideoCta();
});
videoEl.addEventListener("ended", () => {
  window.clearTimeout(stallTimer);
  revealVideoCta();
});
videoEl.addEventListener("playing", () => {
  clearVideoStatus();
  startPlayBtn.classList.add("hide");
  if (state.phase === "video" && videoEl.duration - videoEl.currentTime > 1.05) {
    skipVideoBtn.classList.add("delayed-hide");
  }
});
videoEl.addEventListener("waiting", () => {
  if (state.phase === "video" && !videoEl.paused) armStallTimer();
});
videoEl.addEventListener("error", () => {
  showVideoRecovery("影片暫時播唔到，你可以重播或者繼續。", false);
});

function playSmoothly(forcePlayNow = false) {
  videoEl.loop = false;
  videoEl.muted = !userPreferredUnmuted;
  videoEl.playbackRate = userPlaybackRate;
  updateMuteBtnUI();
  speedVideoBtn.textContent = SPEED_OPTIONS.find(({ rate }) => rate === userPlaybackRate).label;
  if (!forcePlayNow && state.step === "welcome") {
    videoEl.pause();
    startPlayBtn.classList.remove("hide");
    return;
  }
  startPlayBtn.classList.add("hide");
  armStallTimer();
  const clipKey = state.currentClipKey;
  videoEl.play()?.catch(error => {
    if (clipKey !== state.currentClipKey || state.phase !== "video" || error.name === "AbortError") return;
    const canStart = error.name === "NotAllowedError";
    showVideoRecovery(canStart ? "請按開始播放，亦可以直接繼續。" : "影片暫時播唔到，你可以重播或者繼續。", canStart);
  });
}

function manualStartVideo(event) {
  event.stopPropagation();
  resetVideoCtaGuard();
  playSmoothly(true);
};

function toggleMuteVideo(event) {
  event.stopPropagation();
  state.unmuted = userPreferredUnmuted = !userPreferredUnmuted;
  videoEl.muted = !userPreferredUnmuted;
  updateMuteBtnUI();
  saveTabState();
};

function playBlurredBackgroundLoop() {
  window.clearTimeout(stallTimer);
  videoEl.muted = true;
  videoEl.loop = true;
  if (videoEl.paused) videoEl.play()?.catch(() => {});
}

function loadClipFile(clipKey, autoPlay) {
  if (state.currentClipKey !== clipKey) {
    state.currentClipKey = clipKey;
    videoEl.src = state.localVideos[clipKey + ".mp4"] || MEDIA_ROOT + clipKey + ".mp4";
    videoEl.load();
  }
  if (autoPlay) playSmoothly();
  else playBlurredBackgroundLoop();
}

function loadLocalVideos(files) {
  if (!devMode) return;
  for (const file of files) {
    if (state.localVideos[file.name]) URL.revokeObjectURL(state.localVideos[file.name]);
    state.localVideos[file.name] = URL.createObjectURL(file);
  }
  state.currentClipKey = "";
  renderStage();
};

function replayCurrentVideo(event) {
  event.stopPropagation();
  resetVideoCtaGuard();
  if (videoEl.error) videoEl.load();
  try { videoEl.currentTime = 0; } catch { /* No seekable data yet. */ }
  playSmoothly(true);
};

function enterPanelPhase() {
  if (state.step === "welcome") goStep("q1");
  else goStep(state.step, "panel");
}

function directAnswer() {
  state.textFirst = true;
  goStep(state.step === "welcome" ? "q1" : state.step, "panel");
}

function replayStepVideo() {
  if (submissionPending) return;
  state.phase = "video";
  saveTabState();
  applyPhaseUI();
  resetVideoCtaGuard();
  videoEl.currentTime = 0;
  loadClipFile(getStepClipKey(state.step), true);
};
function getStepClipKey(s) {
  if (s === "welcome") return "01-welcome";
  if (s === "q1") return (AXES_META[state.axis] || AXES_META.metabolic).clip;
  if (QUESTIONS[s]) return QUESTIONS[s].clip;
  if (s === "safety_stop") return "08-safety-stop";
  if (s === "review" || s === "checkout") return "10-review";
  if (s === "report1") return "11-report";
  if (s === "offline_flow") return "12-offline-flow";
  if (["booking", "booking_done", "post_whatsapp"].includes(s)) return "13-booking";
  return "01-welcome";
}
function applyPhaseUI() {
  const isVideoPhase = state.phase === "video";
  videoLayerEl.classList.toggle("blurred", !isVideoPhase);
  videoControlsEl.classList.toggle("hidden-phase", !isVideoPhase);
  glassPanelEl.classList.toggle("hidden-phase", isVideoPhase);
  videoControlsEl.inert = !isVideoPhase;
  glassPanelEl.inert = isVideoPhase;
}
function toggleTheme() {
  const b = document.body;
  const btn = document.getElementById("themeBtn");
  if (b.classList.contains("theme-dark")) {
    b.classList.remove("theme-dark"); b.classList.add("theme-light");
    if (btn) btn.textContent = "白底／深色";
  } else {
    b.classList.remove("theme-light"); b.classList.add("theme-dark");
    if (btn) btn.textContent = "深色／白底";
  }
};
function switchAxis(newAxis) {
  if (!devMode || !Object.hasOwn(AXES_META, newAxis)) return;
  state.axis = newAxis;
  state.answers.q1 = "";
  state.paidLocked = false;
  state.currentClipKey = "";
  saveTabState();
  goStep("q1", "video");
};
const checkoutFields = {
  inpName: { key: "name", valid: value => value.length > 0 && value.length <= 80 && !/[\u0000-\u001f\u007f]/.test(value), message: "請輸入稱呼或姓名（最多 80 個字），字與字之間可以用空格。" },
  inpPhone: { key: "phone", valid: value => /^\d{8}$/.test(value), message: "請輸入 8 位數字嘅香港 WhatsApp 電話。" },
  inpEmail: { key: "email", valid: value => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), message: "請輸入有效電郵地址。" },
  inpAgeRange: { key: "ageRange", valid: value => AGE_RANGES.includes(value), message: "請選擇年齡範圍。" },
  inpGender: { key: "gender", valid: value => GENDERS.includes(value), message: "請選擇性別。" },
  inpHeight: { key: "heightCm", valid: value => Number(value) >= 130 && Number(value) <= 210, message: "請用厘米輸入身高（130–210 cm）。" },
  inpWeight: { key: "weightKg", valid: value => Number(value) >= 30 && Number(value) <= 180, message: "請用公斤輸入體重（30–180 kg）。" },
};

function renderCheckoutField(id, label, attributes, options) {
  const value = state.user[checkoutFields[id].key];
  const errorId = `${id}Error`;
  const describedBy = id === "inpEmail" ? `emailHint ${errorId}` : errorId;
  const common = `id="${id}" class="inp-field" required aria-describedby="${describedBy}" data-input="onUserFieldInput" data-change="onUserFieldInput" data-pass="event"`;
  const control = options ? `
    <select ${common}>
      <option value="">請選擇</option>
      ${options.map(option => `<option value="${option}" ${value === option ? "selected" : ""}>${option}</option>`).join("")}
    </select>` : `<input ${common} ${attributes} value="${escapeHtml(value)}" />`;
  return `
    <div>
      <label class="form-label" for="${id}">${label} *</label>
      ${control}
      ${id === "inpEmail" ? '<p class="field-hint" id="emailHint">電郵會用作報告及預約跟進；健康資訊同活動電郵只會喺你另外勾選同意後寄出。</p>' : ''}
      <p class="field-error" id="${errorId}"></p>
    </div>`;
}

function syncUserFieldsFromDOM() {
  for (const [id, { key }] of Object.entries(checkoutFields)) {
    state.user[key] = document.getElementById(id).value;
  }
  state.user.marketingConsent = document.getElementById("inpMarketing").checked;
}

function getFieldError(id) {
  const { key, valid, message } = checkoutFields[id];
  const value = String(state.user[key] ?? "").trim();
  const control = document.getElementById(id);
  return valid(value) && !control?.validity.typeMismatch ? null : { id, errorId: `${id}Error`, message };
}

function getUnlockErrors() {
  return Object.keys(checkoutFields).map(getFieldError).filter(Boolean);
}

function showCheckoutErrors() {
  const summary = document.getElementById("checkoutErrors");
  const invalid = document.querySelectorAll('#panelBody [aria-invalid="true"]');
  const first = invalid[0];
  const message = first ? `有 ${invalid.length} 項資料要修正。${document.getElementById(`${first.id}Error`).textContent}` : "";
  summary.hidden = !first;
  if (summary.textContent !== message) summary.textContent = message;
}
let submissionPending = false;

function submissionPayload(eventType) {
  if (!state.submissionId) {
    state.submissionId = crypto.randomUUID();
    state.submissionToken = crypto.randomUUID();
    watchRecordChanges();
  }
  const triage = eventType === "triage_aborted_level1";
  const report = triage ? null : evaluateAxes(state.axis, state.answers);
  const pending = state.pendingSubmission;
  const payload = {
    schema_version: 2,
    submission_id: state.submissionId,
    submission_token: state.submissionToken,
    submitted_at: pending?.submitted_at ?? "",
    event_type: eventType,
    user: triage ? null : {
      ...state.user, name: state.user.name.trim(), phone: state.user.phone.trim(), email: state.user.email.trim(),
    },
    day_entry: state.day,
    axis_entry: state.axis,
    bmi: triage ? null : computeBMI(state.user.heightCm, state.user.weightKg),
    top_axis: report?.winnerId ?? null,
    ratios: report?.ratios ?? null,
    answers: triage ? { q6: state.answers.q6 } : state.answers,
    booking: eventType === "booking_intent" ? {
      store: state.hmcs.loc, date: state.hmcs.date, weekday: state.hmcs.weekday, timeSlot: state.hmcs.time,
    } : null,
  };
  if (pending?.event_type === eventType &&
      (eventType === "booking_intent" ? sameBooking(pending.booking, payload.booking) :
        JSON.stringify(pending) === JSON.stringify(payload))) return pending;
  const previous = Math.max(Date.parse(state.lastSubmittedAt) || 0, Date.parse(pending?.submitted_at) || 0);
  payload.submitted_at = new Date(Math.max(Date.now(), previous + 1)).toISOString();
  if (!triage) state.pendingSubmission = structuredClone(payload);
  saveTabState();
  return payload;
}

function sameBooking(a, b) {
  return Boolean(a && b && a.store === b.store && a.date === b.date && a.timeSlot === b.timeSlot);
}

function draftBooking() {
  return { store: state.hmcs.loc, date: state.hmcs.date, timeSlot: state.hmcs.time };
}

function setBookingSelection(booking) {
  state.hmcs = {
    loc: booking.store, date: booking.date, weekday: booking.weekday,
    dateLabel: `${booking.date}（${booking.weekday}）`, time: booking.timeSlot,
  };
}

function isAcceptedRecord(record) {
  if (record?.schema_version !== 2 || record.scoring_version !== "v2" || record.submission_id !== state.submissionId ||
      !["quiz_unlocked", "booking_intent"].includes(record.event_type) || !record.user?.name || !record.answers?.q7 ||
      !Number.isFinite(record.bmi?.bmi) || (record.top_axis !== null && !Object.hasOwn(AXES_META, record.top_axis))) return false;
  if (record.event_type === "booking_intent" && (!STORES.includes(record.booking?.store) ||
      !record.booking.date || !record.booking.weekday || !record.booking.timeSlot)) return false;
  return Object.keys(AXES_META).every(id => Number.isFinite(record.ratios?.[id]) && Array.isArray(record.evidence?.[id]));
}

function useAcceptedRecord(record) {
  acceptedRecord = record;
  state.day = record.day_entry;
  state.axis = record.axis_entry;
  state.user = { ...record.user };
  state.answers = structuredClone(record.answers);
  state.lastSubmittedAt = [state.lastSubmittedAt, record.submitted_at, record.unlock_submitted_at ?? ""].sort().at(-1);
}

async function requestRecord(payload, keepalive = false) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12000);
  try {
    const response = await window.fetch("/api/submit-v2", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
      signal: controller.signal, keepalive, credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store",
    });
    return { response, reply: await response.json() };
  } finally {
    window.clearTimeout(timeout);
  }
}

function refreshOpenRecord() {
  if (!recordNeedsRefresh || resumeTarget || submissionPending || !state.paidLocked ||
      !["report1", "booking_done", "post_whatsapp"].includes(state.step)) return;
  recordNeedsRefresh = false;
  resumeTarget = { step: state.step, phase: state.phase };
  void resumeSavedStep();
}

function watchRecordChanges() {
  changesChannel?.close();
  changesChannel = null;
  if (devMode || !state.submissionId || !window.BroadcastChannel) return;
  try {
    // Tabs exchange an invalidation only. Each tab reads the private record with its own token.
    changesChannel = new window.BroadcastChannel(`hd_reels_v4:change:${state.submissionId}`);
    changesChannel.onmessage = () => {
      recordNeedsRefresh = true;
      refreshOpenRecord();
    };
  } catch {
    // Returning to the page also refreshes its confirmation when tab messaging is unavailable.
  }
}

async function resumeSavedStep() {
  if (!resumeTarget || loadingSaved) return;
  recordNeedsRefresh = false;
  loadingSaved = true;
  resumeError = "";
  renderStage();
  try {
    const { response, reply } = await requestRecord({
      schema_version: 2, action: "resume", submission_id: state.submissionId, submission_token: state.submissionToken,
    });
    if ([403, 404].includes(response.status)) {
      acceptedRecord = null;
      state.paidLocked = false;
      state.pendingSubmission = null;
      state.hmcs = { ...emptyBooking };
      state.whatsappOpened = state.whatsappConfirmed = false;
      if (response.status === 403) state.submissionId = state.submissionToken = null;
      checkoutNotice = "未能重開原有報告，請核對資料再解鎖。";
      resumeTarget = null;
      goStep("checkout", "panel");
      return;
    }
    if (!response.ok || reply.ok !== true || !isAcceptedRecord(reply.record)) throw new Error();
    const { record } = reply;
    useAcceptedRecord(record);
    state.paidLocked = true;
    let { step, phase } = resumeTarget;
    resumeTarget = null;
    const pending = state.pendingSubmission;
    const pendingBooked = pending?.event_type === "booking_intent" && sameBooking(pending.booking, draftBooking()) &&
      record.booking && record.submitted_at >= pending.submitted_at;
    if (step === "booking_done" || step === "post_whatsapp" || (step === "booking" && pendingBooked)) {
      phase = "panel";
      if (record.booking) {
        if (!sameBooking(record.booking, draftBooking())) {
          state.whatsappOpened = state.whatsappConfirmed = false;
          state.bookingSuperseded = true;
        }
        setBookingSelection(record.booking);
        step = step === "post_whatsapp" && state.whatsappConfirmed ? "post_whatsapp" : "booking_done";
      } else {
        state.hmcs = { ...emptyBooking };
        state.whatsappOpened = state.whatsappConfirmed = false;
        step = "booking";
      }
      state.pendingSubmission = null;
    }
    goStep(step, phase);
  } catch {
    resumeError = "暫時載入唔到已儲存嘅資料。請檢查網絡，再試一次。";
  } finally {
    loadingSaved = false;
    if (resumeTarget) renderStage();
    else refreshOpenRecord();
  }
}

async function sendRecordToBackend(eventType, button) {
  if (submissionPending) return null;
  const payload = submissionPayload(eventType);
  const triage = eventType === "triage_aborted_level1";
  if (devMode) {
    const report = evaluateAxes(state.axis, state.answers);
    state.pendingSubmission = null;
    return { record: { ...payload, evidence: report.evidence, unlock_submitted_at: payload.submitted_at } };
  }
  const status = document.getElementById("submissionStatus");
  const label = button?.textContent;
  const panelBody = document.getElementById("panelBody");
  if (!triage) {
    submissionPending = true;
    panelBody.inert = true;
    button.disabled = true;
    button.textContent = "正在儲存資料…";
    status.textContent = "";
  }
  try {
    const { response, reply } = await requestRecord(payload, triage);
    if (triage) return null;
    const expectedConflict = eventType === "booking_intent" ? "superseded_booking" : "superseded_unlock";
    const conflict = response.status === 409 && reply.conflict === expectedConflict;
    if (!((response.ok && reply.ok === true) || conflict) || !isAcceptedRecord(reply.record) ||
        (eventType === "booking_intent" && !reply.record.booking)) {
      if (response.status === 400) {
        state.pendingSubmission = null;
        saveTabState();
        renderStage();
        document.getElementById("submissionStatus").textContent = "請核對答案、聯絡資料及預約時段，再撳掣重試。";
        return null;
      }
      throw new Error();
    }
    state.pendingSubmission = null;
    return reply;
  } catch {
    if (status) status.textContent = "暫時儲存唔到資料。請檢查網絡，再撳掣重試。";
    return null;
  } finally {
    if (!triage) {
      submissionPending = false;
      panelBody.inert = false;
      button.disabled = false;
      button.textContent = label;
      try { changesChannel?.postMessage("refresh"); } catch { /* Some webviews block tab messaging. */ }
    }
  }
}

function getShortLabels(qid) {
  const st = state;
  const opts = qid === "q1" ? (AXES_META[st.axis] || AXES_META.metabolic).q1Opts : (QUESTIONS[qid] ? QUESTIONS[qid].opts : []);
  const map = new Map(opts.map(o => [o.val, o.short || o.label]));
  if (qid === "q1" || qid === "q7") {
    const v = st.answers[qid];
    return v ? [map.get(v) || v] : ["未選"];
  }
  const arr = st.answers[qid] || [];
  return arr.length ? arr.map(v => map.get(v) || v) : ["未選"];
}
function goStep(targetStep, startPhase) {
  if (resumeTarget || submissionPending || !savedSteps.has(targetStep)) return;
  if (reportSteps.has(targetStep) && !state.paidLocked) {
    targetStep = "checkout";
    startPhase = "panel";
  }
  if (!devMode && ["booking_done", "post_whatsapp"].includes(targetStep) && !acceptedRecord?.booking) {
    targetStep = "booking";
    startPhase = "panel";
  }
  if (["q7", "review", "checkout"].includes(targetStep) && hasRedFlags(state.answers)) {
    openSafetyStop();
    return;
  }
  const noVideoSteps = ["checkout", "booking_done", "post_whatsapp"];
  const defaultPhase = state.textFirst || noVideoSteps.includes(targetStep) ? "panel" : "video";
  state.step = targetStep;
  state.phase = targetStep === "welcome" ? "video" : (startPhase || defaultPhase);
  saveTabState();
  if (!loadingSaved) refreshOpenRecord();
  if (!resumeTarget) renderStage();
  document.getElementById('panelBody').scrollTop = 0;
};
function renderStage() {
  const st = state;
  const s = st.step;
  const badge = document.getElementById("stepBadge");
  const title = document.getElementById("panelTitle");
  const body = document.getElementById("panelBody");
  const footer = document.getElementById("panelFooter");
  if (resumeTarget) {
    st.phase = "panel";
    applyPhaseUI();
    badge.textContent = "";
    title.textContent = "重開已儲存嘅資料";
    body.textContent = resumeError || "正在核對報告同預約紀錄…";
    footer.innerHTML = resumeError ? '<button type="button" class="btn-primary" data-click="resumeSavedStep">重新載入</button>' : "";
    return;
  }
  const sel = document.getElementById("quickJumpSel");
  if (sel && [...sel.options].some(o => o.value === s)) sel.value = s;
  const progMap = {
    welcome: 6, q1: 18, q2: 30, q3: 42, q4: 54, q5: 66, q6: 78,
    safety_stop: 78, q7: 88, review: 94, checkout: 98,
    report1: 100, offline_flow: 100, booking: 100, booking_done: 100, post_whatsapp: 100
  };
  const progress = progMap[s] || 6;
  const progressBar = document.getElementById("progFill");
  progressBar.style.width = progress + "%";
  progressBar.parentElement.setAttribute("aria-valuenow", progress);
  const clipKey = getStepClipKey(s);
  if (st.phase === "video") resetVideoCtaGuard();
  loadClipFile(clipKey, st.phase === "video");
  applyPhaseUI();
  if (s === "welcome") skipVideoBtn.textContent = "開始進行自測 →";
  else if (s === "q1" || QUESTIONS[s]) skipVideoBtn.textContent = "進入題目作答 →";
  else if (s === "review") skipVideoBtn.textContent = "核對答案 →";
  else skipVideoBtn.textContent = "繼續 →";
  const axisMeta = AXES_META[st.axis] || AXES_META.metabolic;
  if (s === "welcome") {
    badge.textContent = "Health Decoder";
    title.textContent = "";
    body.innerHTML = "";
    footer.innerHTML = "";
    return;
  }
  // Q1（只顯示純題號，絕不顯示軸線名稱或版本暗示）
  if (s === "q1") {
    if (st.phase === "panel") void trackEvent("start");
    badge.textContent = "問題 1 / 7";
    title.textContent = axisMeta.q1Title;
    const cur = st.answers.q1;
    body.innerHTML = `
      <div class="opt-stack">
        ${axisMeta.q1Opts.map(o => {
          const isSel = cur === o.val;
          return `
            <button type="button" aria-pressed="${isSel}" class="opt-btn ${isSel ? 'selected' : ''} ${o.isNone ? 'muted-opt' : ''}" data-click="pickSingle" data-arg1="q1" data-arg2="${o.val}">
              <span>${o.label}</span>
              <span class="check-box">${isSel ? '✓' : ''}</span>
            </button>
          `;
        }).join("")}
      </div>
    `;
    footer.innerHTML = `
      <button type="button" class="btn-primary" ${!cur ? 'disabled' : ''} data-click="submitQuestion" data-arg1="q1">
        ${st.editingFromReview ? '確認修改，返回覆核頁 →' : '確認送出 →'}
      </button>
      <div class="footer-row-2">
        <button type="button" class="btn-secondary" data-click="stepBack">← 返回</button>
        <button type="button" class="btn-secondary" data-click="replayStepVideo">↺ 重溫本題影片</button>
      </div>
    `;
    return;
  }
  // Q2 – Q7
  if (QUESTIONS[s]) {
    const q = QUESTIONS[s];
    badge.textContent = q.badge;
    title.textContent = q.title;
    if (q.mode === "single") {
      const cur = st.answers[q.id];
      body.innerHTML = `
        <div class="opt-stack">
          ${q.opts.map(o => {
            const isSel = cur === o.val;
            return `
              <button type="button" aria-pressed="${isSel}" class="opt-btn ${isSel ? 'selected' : ''} ${o.isNone ? 'muted-opt' : ''}" data-click="pickSingle" data-arg1="${q.id}" data-arg2="${o.val}">
                <span>${o.label}</span>
                <span class="check-box">${isSel ? '✓' : ''}</span>
              </button>
            `;
          }).join("")}
        </div>
      `;
      footer.innerHTML = `
        <button type="button" class="btn-primary" ${!cur ? 'disabled' : ''} data-click="submitQuestion" data-arg1="${q.id}">
          ${st.editingFromReview ? '確認修改，返回覆核頁 →' : '確認送出 →'}
        </button>
        <div class="footer-row-2">
          <button type="button" class="btn-secondary" data-click="stepBack">← 返回</button>
          <button type="button" class="btn-secondary" data-click="replayStepVideo">↺ 重溫本題影片</button>
        </div>
      `;
    } else {
      const arr = st.answers[q.id] || [];
      body.innerHTML = `
        <div class="grid-2col">
          ${q.opts.map(o => {
            const isSel = arr.includes(o.val);
            return `
              <button type="button" aria-pressed="${isSel}" class="grid-btn ${isSel ? 'selected' : ''} ${o.isNone ? 'muted-opt' : ''}" data-click="pickMulti" data-arg1="${q.id}" data-arg2="${o.val}" data-arg3="${!!o.isNone}">
                <span class="check-box">${isSel ? '✓' : ''}</span>
                <span>${o.label}</span>
              </button>
            `;
          }).join("")}
        </div>
      `;
      footer.innerHTML = `
        <button type="button" class="btn-primary" ${arr.length === 0 ? 'disabled' : ''} data-click="submitQuestion" data-arg1="${q.id}">
          ${st.editingFromReview ? '確認修改，返回覆核頁 →' : '確認送出 →'}
        </button>
        <div class="footer-row-2">
          <button type="button" class="btn-secondary" data-click="stepBack">← 返回</button>
          <button type="button" class="btn-secondary" data-click="replayStepVideo">↺ 重溫本題影片</button>
        </div>
      `;
    }
    return;
  }
  if (s === "safety_stop") {
    badge.textContent = "重要健康提醒";
    title.textContent = "請優先搵醫生檢查清楚";
    body.innerHTML = `
      <div class="info-box">
        留意到你揀咗急性風險訊號，安全起見，請你優先搵專科或者普通科醫生檢查清楚。留低所有報告紀錄，檢查穩陣之後隨時再約我傾深度改善方案。
      </div>
    `;
    footer.innerHTML = `
      <button type="button" class="btn-secondary" data-click="reviseSafetyAnswer">← 剛才揀錯，返回重選</button>
      <button type="button" class="btn-secondary" data-click="replayStepVideo">↺ 重溫提醒影片</button>
    `;
    return;
  }
  // 答案覆核頁（簡化短標籤 + 全寬橫列 Tag Chip，盡用版面空間唔截字）
  if (s === "review") {
    badge.textContent = "核對答案";
    title.textContent = "核對一下你剛才揀過嘅答案";
    const qList = [
      { id: "q1", label: "第 1 題" },
      { id: "q2", label: "第 2 題（糖脂血管）" },
      { id: "q3", label: "第 3 題（體力肌力）" },
      { id: "q4", label: "第 4 題（腸胃發炎）" },
      { id: "q5", label: "第 5 題（長期西藥）" },
      { id: "q6", label: "第 6 題（安全確認）" },
      { id: "q7", label: "第 7 題（優先目標）" }
    ];
    body.innerHTML = `
      <div class="review-list">
        ${qList.map(it => {
          const tags = getShortLabels(it.id);
          return `
            <button type="button" class="review-row" data-click="editFromReview" data-arg1="${it.id}">
              <div class="review-row-head">${it.label} <span>修改 ✎</span></div>
              <div class="chip-wrap">${tags.map(t => `<span class="ans-chip">${escapeHtml(t)}</span>`).join("")}</div>
            </button>
          `;
        }).join("")}
      </div>
    `;
    footer.innerHTML = `
      <button type="button" class="btn-primary" data-click="goStep" data-arg1="checkout" data-arg2="panel">確認無誤，下一步領取報告 →</button>
      <div class="footer-row-2">
        <button type="button" class="btn-secondary" data-click="stepBack">← 返回第 7 題</button>
        <button type="button" class="btn-secondary" data-click="replayStepVideo">↺ 重溫提示影片</button>
      </div>
    `;
    return;
  }
  if (s === "checkout") {
    void trackEvent("checkout");
    badge.textContent = "解鎖個人分析報告";
    title.textContent = "填寫個人資料，即時解鎖結果";
    body.innerHTML = `
      <div class="warn-box">
        🔒 你提供嘅資料會用於問卷分析、報告同預約跟進。Health Decoder 團隊可用 WhatsApp 或電郵聯絡你。
      </div>
      <div class="warn-box" id="checkoutErrors" role="alert" hidden></div>
      <fieldset class="checkout-fields">
        <legend>聯絡資料</legend>
        <div class="grid-2col">
          ${renderCheckoutField("inpName", "稱呼／姓名", 'maxlength="80" autocomplete="name" type="text" placeholder="陳先生／陳太"')}
          ${renderCheckoutField("inpPhone", "WhatsApp 電話", 'maxlength="8" autocomplete="tel-national" inputmode="numeric" type="tel" placeholder="8 位數字"')}
        </div>
        ${renderCheckoutField("inpEmail", "電郵地址", 'maxlength="254" autocomplete="email" type="email" placeholder="example@email.com"')}
      </fieldset>
      <fieldset class="checkout-fields">
        <legend>報告資料</legend>
        <div class="grid-2col">
          ${renderCheckoutField("inpAgeRange", "年齡範圍", "", AGE_RANGES)}
          ${renderCheckoutField("inpGender", "性別", "", GENDERS)}
          ${renderCheckoutField("inpHeight", "身高（cm）", 'min="130" max="210" step="any" type="number" inputmode="decimal" placeholder="如 168"')}
          ${renderCheckoutField("inpWeight", "體重（kg）", 'min="30" max="180" step="any" type="number" inputmode="decimal" placeholder="如 65"')}
        </div>
      </fieldset>
      <label class="privacy-option"><input id="inpMarketing" type="checkbox" ${st.user.marketingConsent ? "checked" : ""} data-change="onUserFieldInput" />我願意收取 Health Decoder 嘅健康資訊同活動電郵。</label>
    `;
    footer.innerHTML = `
      <button type="button" class="btn-primary" id="unlockBtn" data-click="processUnlockReport">立即解鎖分析報告 →</button>
      <p class="submission-status" id="submissionStatus" role="status"></p>
      <div class="footer-row-2">
        <button type="button" class="btn-secondary" data-click="goStep" data-arg1="review" data-arg2="panel">← 返回覆核答案</button>
        <button type="button" class="btn-secondary" data-click="replayStepVideo">↺ 重溫提示影片</button>
      </div>
    `;
    document.getElementById("submissionStatus").textContent = checkoutNotice;
    return;
  }
  if (s === "report1") {
    const record = acceptedRecord;
    const preview = devMode && !record ? evaluateAxes(st.axis, st.answers) : null;
    const result = preview ?? {
      winnerId: record.top_axis, winner: AXES_META[record.top_axis], ratios: record.ratios, evidence: record.evidence,
      sortedIds: Object.keys(AXES_META).sort((a, b) => record.ratios[b] - record.ratios[a]),
    };
    const { user, answers } = record ?? st;
    badge.textContent = "專屬 4 軸分析報告";
    title.textContent = result.winner ? `你今次嘅自評重點：${result.winner.name}` : "暫未見明顯自評重點";
    const barsHtml = result.sortedIds.map(cid => {
      const c = AXES_META[cid];
      const pct = result.ratios[cid];
      const isWin = cid === result.winnerId;
      return `
        <div class="ratio-card ${isWin ? 'top-winner' : ''}">
          <div class="ratio-head">
            <span>${c.name}${isWin ? '<small class="ratio-marker">較多相關訊號</small>' : ''}</span>
            <span>${pct}%</span>
          </div>
          <div class="ratio-track">
            <div class="ratio-fill" style="width:${pct}%; background:${c.color};"></div>
          </div>
        </div>
      `;
    }).join("");
    const bmiInfo = preview ? computeBMI(user.heightCm, user.weightKg) : record.bmi;
    const bmiHtml = bmiInfo ? `
      <div class="info-box" style="padding:9px 12px; font-size:14.5px; border-color:${bmiInfo.color};">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:3px;">
          <strong>📊 你的 BMI：${bmiInfo.bmi}（${bmiInfo.status}）</strong>
          <span style="font-size:12.5px; color:var(--ink-muted);">${escapeHtml(user.gender)} · ${escapeHtml(user.ageRange)}</span>
        </div>
        <div style="font-size:13.5px; line-height:1.38; color:var(--ink-sub);">${bmiInfo.risk}</div>
      </div>
    ` : "";
    body.innerHTML = `
      ${result.winner ? `
        <p class="report-note">以下比例按自測答案及題目權重計算，供健康交流參考。</p>` : `
        <p class="info-box">你喺第 2 至第 5 題未有揀到明確相關訊號，暫時未能分出重點。第一次見面可以由你最想了解嘅方向開始梳理。</p>`}
      <div class="ratio-stack">${barsHtml}</div>
      <dl class="report-priorities info-box">
        <dt>你一開始想了解</dt><dd>${escapeHtml(answers.q1 || "未選")}</dd>
        <dt>第一次見面最想優先傾</dt><dd>${escapeHtml(answers.q7 || "未選")}</dd>
      </dl>
      ${result.winner ? `
        <section class="report-evidence info-box">
          <h2>支持呢個自評重點嘅答案</h2>
          <ul>${result.evidence[result.winnerId].map(answer => `<li>${escapeHtml(answer)}</li>`).join("")}</ul>
        </section>` : ""}
      ${bmiHtml}
      <div class="warn-box" style="padding:8px 11px; font-size:13.5px;">
        🎁 想領取【完整問卷分析報告 PDF 版】留底保存？記得完成預約流程，以獲取領取 PDF 報告的方法。
      </div>
    `;
    footer.innerHTML = `
      <button type="button" class="btn-primary" data-click="goStep" data-arg1="booking" data-arg2="panel">揀選門市及時間 →</button>
      <div class="footer-row-2">
        <button type="button" class="btn-secondary" data-click="goStep" data-arg1="offline_flow" data-arg2="panel">了解第一次見面流程</button>
        <button type="button" class="btn-secondary" data-click="replayStepVideo">↺ 重溫報告解讀影片</button>
      </div>
    `;
    return;
  }
  if (s === "offline_flow") {
    badge.textContent = "首次線下會面流程";
    title.textContent = "第一次見面 6 步流程圖";
    body.innerHTML = `
      <div class="flow-wrap">
        ${OFFLINE_STEPS.map((fs, i) => `
          <div class="flow-node">
            <div class="flow-rail">
              <div class="flow-dot">${i + 1}</div>
              ${i < OFFLINE_STEPS.length - 1 ? '<div class="flow-line"></div>' : ''}
            </div>
            <div class="flow-card">
              <div class="flow-card-title">${fs.t}</div>
              <div class="flow-card-sub">${fs.s}</div>
            </div>
          </div>
        `).join("")}
      </div>
    `;
    footer.innerHTML = `
      <button type="button" class="btn-primary" data-click="goStep" data-arg1="booking" data-arg2="panel">下一步：揀選門市日期預約 →</button>
      <div class="footer-row-2">
        <button type="button" class="btn-secondary" data-click="goStep" data-arg1="report1" data-arg2="panel">← 返回 4 軸報告</button>
        <button type="button" class="btn-secondary" data-click="replayStepVideo">↺ 重溫影片</button>
      </div>
    `;
    return;
  }
  if (s === "booking") {
    badge.textContent = "預約意向登記";
    title.textContent = "揀選意向門市、日期同時段";
    const bookingDates = buildBookingDates();
    const store = STORES.includes(st.hmcs.loc) ? st.hmcs.loc : "";
    const date = store ? bookingDates.find(d => d.iso === st.hmcs.date) : undefined;
    const time = date?.slots.includes(st.hmcs.time) ? st.hmcs.time : "";
    const retry = sameBooking(st.pendingSubmission?.booking, draftBooking());
    body.innerHTML = `
      <h2 class="booking-label">1. 選擇就腳門市</h2>
      <div class="grid-2col">
        ${STORES.map(l => `<button type="button" class="slot-btn ${store === l ? 'selected' : ''}" aria-pressed="${store === l}" data-click="selectBookingStore" data-arg1="${l}">📍 ${l}</button>`).join("")}
      </div>
      ${store ? `
        <h2 class="booking-label">2. 選擇意向日期（星期一至六）</h2>
        <div class="date-scroll">
          ${bookingDates.map(d => `<button type="button" class="slot-btn ${date?.iso === d.iso ? 'selected' : ''}" aria-pressed="${date?.iso === d.iso}" data-click="selectBookingDate" data-arg1="${d.iso}">${d.label}</button>`).join("")}
        </div>` : ""}
      ${date ? `
        <h2 class="booking-label">3. 選擇意向時段</h2>
        <div class="grid-3col">
          ${date.slots.map(t => `<button type="button" class="slot-btn ${time === t ? 'selected' : ''}" aria-pressed="${time === t}" data-click="selectBookingSlot" data-arg1="${t}">${t}</button>`).join("")}
        </div>` : ""}
      <div class="warn-box">
        ℹ️ 以上只屬你嘅意向門市、日期同時段，最後會以 WhatsApp 通訊正式確認預約。
      </div>
    `;
    footer.innerHTML = `
      <button type="button" class="btn-primary" id="bookingSubmitBtn" data-click="confirmBookingSubmit" ${time || retry ? '' : 'disabled'}>${retry ? "重試原有預約意向" : "送出意向預約 →"}</button>
      <p class="submission-status" id="submissionStatus" role="status"></p>
      <div class="footer-row-2">
        <button type="button" class="btn-secondary" data-click="goStep" data-arg1="offline_flow" data-arg2="panel">← 返回流程圖</button>
        <button type="button" class="btn-secondary" data-click="replayStepVideo">↺ 重溫影片</button>
      </div>
    `;
    return;
  }
  // 預約意向確認頁（單一 WhatsApp 確認出口，絕無群組逃生門）
  if (s === "booking_done") {
    badge.textContent = "已登記預約意向";
    title.textContent = "✅ 請經 WhatsApp 確認預約";
    const booking = devMode ? acceptedRecord?.booking ?? { ...draftBooking(), weekday: st.hmcs.weekday } : acceptedRecord.booking;
    const contact = devMode ? st.user : acceptedRecord.user;
    const id = devMode ? st.submissionId : acceptedRecord.submission_id;
    const waText = encodeURIComponent(`你好 Duncan 團隊，我想確認線下見面預約，並領取個人問卷分析報告 PDF 版。\n稱呼：${contact.name.trim()}\n意向門市：${booking.store}\n意向日期：${booking.date}\n意向時段：${booking.timeSlot}\n查閱編號：${id}`);
    body.innerHTML = `
      ${st.bookingSuperseded ? '<p class="warn-box" role="status">另一個分頁已更新預約意向。以下係最新儲存嘅門市、日期同時段。</p>' : ""}
      <div class="info-box">
        意向門市：<strong>${escapeHtml(booking.store)}門市</strong><br/>
        意向日期：<strong>${escapeHtml(booking.date + "（" + booking.weekday + "）")}</strong><br/>
        意向時段：<strong>${escapeHtml(booking.timeSlot)}</strong><br/>
        聯絡電話：<strong>${escapeHtml(contact.phone)}</strong><br/>
        確認電郵：<strong>${escapeHtml(contact.email)}</strong>
      </div>
      <div class="warn-box">
        開啟後請喺 WhatsApp 按「傳送」，等團隊回覆確認。團隊確認預約後，會經 WhatsApp 送返你嘅個人問卷分析報告 PDF 版。
      </div>
    `;
    footer.innerHTML = `
      <a href="https://wa.me/85298788564?text=${waText}" target="_blank" rel="noopener" class="btn-primary" id="bookingWhatsAppLink" data-click="onWhatsAppBookingClicked">${st.whatsappOpened ? '重新打開 WhatsApp' : '打開 WhatsApp 確認預約 →'}</a>
      <button type="button" class="btn-secondary" id="confirmWhatsAppBtn" data-click="confirmWhatsAppSent" ${st.whatsappOpened ? '' : 'disabled'}>我已喺 WhatsApp 按「傳送」</button>
      <button type="button" class="btn-secondary" data-click="goStep" data-arg1="booking" data-arg2="panel">← 修改意向門市或時間</button>
    `;
    return;
  }
  // 已完成 WhatsApp 發送預約訊息後之最終分流頁（返回看報告 OR 加入 FB/WhatsApp 群組）
  if (s === "post_whatsapp") {
    badge.textContent = "WhatsApp 預約確認";
    title.textContent = "等團隊回覆確認預約";
    body.innerHTML = `
      <div class="info-box">
        團隊收到你嘅 WhatsApp 訊息後，會同你落實見面預約。<br/><br/>
        你依家可以選擇返回重溫你嘅 <strong>4 軸分析報告</strong>，或者加入免費健康交流群組：
      </div>
      <div class="opt-stack">
        <a href="https://chat.whatsapp.com/LPHAndy6hjH8gRLVzZacrw" target="_blank" rel="noopener" class="opt-btn" style="text-decoration:none;">
          <span>💬 加入 WhatsApp 健康交流群組</span>
          <span>加入 →</span>
        </a>
        <a href="https://www.facebook.com/share/g/1CCM9AMEyw/" target="_blank" rel="noopener" class="opt-btn" style="text-decoration:none;">
          <span>📘 加入 Facebook 健康交流群組</span>
          <span>加入 →</span>
        </a>
      </div>
    `;
    footer.innerHTML = `
      <button type="button" class="btn-primary" data-click="goStep" data-arg1="report1" data-arg2="panel">← 返回查看我的 4 軸分析報告</button>
      <button type="button" class="btn-secondary" data-click="goStep" data-arg1="booking" data-arg2="panel">← 返回修改意向預約</button>
    `;
    return;
  }
};
function onWhatsAppBookingClicked() {
  if (state.step !== "booking_done") return;
  state.whatsappOpened = true;
  saveTabState();
  document.getElementById("bookingWhatsAppLink").textContent = "重新打開 WhatsApp";
  document.getElementById("confirmWhatsAppBtn").disabled = false;
  void trackEvent("whatsapp_opened");
}

function confirmWhatsAppSent() {
  if (state.step !== "booking_done" || !state.whatsappOpened) return;
  state.whatsappConfirmed = true;
  goStep("post_whatsapp", "panel");
}

function saveOptionSelection() {
  const panel = document.getElementById("panelBody");
  const optionSelector = "button[data-click][aria-pressed]";
  const active = document.activeElement;
  const focused = panel.contains(active) && active.matches(optionSelector) ? active.dataset : null;
  const scrollTop = panel.scrollTop;

  saveTabState();
  renderStage();
  panel.scrollTop = scrollTop;
  if (!focused) return;

  const replacement = [...panel.querySelectorAll(optionSelector)].find(({ dataset }) =>
    dataset.click === focused.click && dataset.arg1 === focused.arg1 && dataset.arg2 === focused.arg2,
  );
  replacement?.focus({ preventScroll: true });
}

function selectBookingDate(iso) {
  if (submissionPending || !STORES.includes(state.hmcs.loc)) return;
  const date = buildBookingDates().find(entry => entry.iso === iso);
  if (!date || date.iso === state.hmcs.date) return;
  Object.assign(state.hmcs, { date: date.iso, weekday: date.weekday, dateLabel: date.label, time: "" });
  saveOptionSelection();
};
function selectBookingStore(store) {
  if (submissionPending || !STORES.includes(store)) return;
  state.hmcs.loc = store;
  saveOptionSelection();
};
function selectBookingSlot(slot) {
  if (submissionPending || !STORES.includes(state.hmcs.loc)) return;
  const date = buildBookingDates().find(({ iso }) => iso === state.hmcs.date);
  if (!date?.slots.includes(slot)) return;
  state.hmcs.time = slot;
  saveOptionSelection();
};
async function confirmBookingSubmit() {
  if (submissionPending || state.step !== "booking") return;
  const date = buildBookingDates().find(({ iso }) => iso === state.hmcs.date);
  const retry = sameBooking(state.pendingSubmission?.booking, draftBooking());
  if (!retry && (!STORES.includes(state.hmcs.loc) || !date?.slots.includes(state.hmcs.time))) {
    renderStage();
    document.getElementById("submissionStatus").textContent = "原先時段已過，請重新揀選。";
    return;
  }
  if (date) Object.assign(state.hmcs, { weekday: date.weekday, dateLabel: date.label });
  const reply = await sendRecordToBackend("booking_intent", document.getElementById("bookingSubmitBtn"));
  if (!reply) return;
  useAcceptedRecord(reply.record);
  setBookingSelection(reply.record.booking);
  state.whatsappOpened = state.whatsappConfirmed = false;
  state.bookingSuperseded = reply.conflict === "superseded_booking";
  if (!state.bookingSuperseded) void trackEvent("booking_intent");
  // A successful HTTP reply can arrive after a newer booking from another tab.
  // Recheck the saved selection before exposing the external WhatsApp link.
  recordNeedsRefresh = !devMode;
  goStep("booking_done", "panel");
};
function onUserFieldInput(event) {
  syncUserFieldsFromDOM();
  saveTabState();
  const field = event?.target;
  if (field?.hasAttribute("aria-invalid")) {
    const error = getFieldError(field.id);
    document.getElementById(`${field.id}Error`).textContent = error?.message ?? "";
    if (!error) field.removeAttribute("aria-invalid");
    showCheckoutErrors();
  }
};
function pickSingle(qid, val) {
  if (state.paidLocked) return;
  state.answers[qid] = val;
  saveOptionSelection();
};
function pickMulti(qid, val, isNone) {
  if (state.paidLocked) return;
  let cur = [...(state.answers[qid] || [])];
  const q = QUESTIONS[qid];
  const noneVals = q.opts.filter(o => o.isNone).map(o => o.val);
  if (isNone) {
    cur = [val];
  } else {
    cur = cur.filter(v => !noneVals.includes(v));
    if (cur.includes(val)) cur = cur.filter(v => v !== val);
    else cur.push(val);
  }
  state.answers[qid] = cur;
  saveOptionSelection();
};
function reviseSafetyAnswer() {
  state.answers.q6 = [];
  if (!state.pendingSubmission) state.submissionId = state.submissionToken = null;
  goStep("q6", "panel");
};
function openSafetyStop() {
  state.editingFromReview = false;
  state.paidLocked = false;
  goStep("safety_stop", "panel");
  void sendRecordToBackend("triage_aborted_level1");
}
function submitQuestion(qid) {
  if (state.step !== qid || state.paidLocked) return;
  const answer = state.answers[qid];
  if (!answer?.length) return;
  if (qid === "q6" && hasRedFlags(state.answers)) {
    openSafetyStop();
    return;
  }
  if (state.editingFromReview) {
    state.editingFromReview = false;
    goStep("review", "panel");
    return;
  }
  const nextMap = { q1: "q2", q2: "q3", q3: "q4", q4: "q5", q5: "q6", q6: "q7", q7: "review" };
  goStep(nextMap[qid]);
};
function editFromReview(qid) {
  if (state.paidLocked) return;
  state.editingFromReview = true;
  goStep(qid, "panel");
};
function jumpStep(target) {
  if (!devMode) return;
  if (reportSteps.has(target) && getUnlockErrors().length) {
    state.step = "checkout";
    state.phase = "panel";
    renderStage();
    return;
  }
  state.paidLocked = reportSteps.has(target);
  state.editingFromReview = false;
  goStep(target, target === "welcome" ? "video" : "panel");
};
function stepBack() {
  if (state.editingFromReview) {
    state.editingFromReview = false;
    goStep("review", "panel");
    return;
  }
  const prevMap = {
    q1: "welcome", q2: "q1", q3: "q2", q4: "q3",
    q5: "q4", q6: "q5", safety_stop: "q6", q7: "q6",
    review: "q7", checkout: "review",
    offline_flow: "report1", booking: "offline_flow", booking_done: "booking", post_whatsapp: "booking_done"
  };
  const prev = prevMap[state.step];
  if (prev && !(state.paidLocked && ["review", "q7", "checkout"].includes(prev))) {
    goStep(prev, "panel");
  }
};
async function processUnlockReport() {
  if (submissionPending || state.step !== "checkout") return;
  if (hasRedFlags(state.answers)) {
    openSafetyStop();
    return;
  }
  syncUserFieldsFromDOM();
  saveTabState();
  for (const id of Object.keys(checkoutFields)) {
    document.getElementById(id).removeAttribute("aria-invalid");
    document.getElementById(`${id}Error`).textContent = "";
  }
  const errs = getUnlockErrors();
  for (const { id, errorId, message } of errs) {
    document.getElementById(id).setAttribute("aria-invalid", "true");
    document.getElementById(errorId).textContent = message;
  }
  showCheckoutErrors();
  if (errs.length) {
    const first = document.getElementById(errs[0].id);
    first.scrollIntoView?.({ block: "nearest" });
    first.focus();
    return;
  }
  if (!devMode && Object.values(state.answers).some(answer => !answer.length)) {
    goStep("review", "panel");
    return;
  }
  const reply = await sendRecordToBackend("quiz_unlocked", document.getElementById("unlockBtn"));
  if (!reply) return;
  useAcceptedRecord(reply.record);
  if (reply.conflict === "superseded_unlock") {
    checkoutNotice = "另一個分頁已更新資料。已載入最新答案、聯絡資料同推廣選擇，請核對或修改後再儲存。";
    goStep("checkout", "panel");
    return;
  }
  checkoutNotice = "";
  state.paidLocked = true;
  void trackEvent("report_unlocked");
  goStep("report1");
};

const actions = Object.freeze({
  confirmBookingSubmit, confirmWhatsAppSent, cyclePlaybackRate, directAnswer, editFromReview, enterPanelPhase, goStep, jumpStep,
  loadLocalVideos, manualStartVideo, onUserFieldInput, onWhatsAppBookingClicked, pickMulti,
  pickSingle, processUnlockReport, replayCurrentVideo, replayStepVideo, reviseSafetyAnswer,
  resumeSavedStep, selectBookingDate, selectBookingSlot, selectBookingStore, stepBack, submitQuestion,
  switchAxis, toggleMuteVideo, toggleTheme,
});

for (const type of ["click", "input", "change"]) {
  document.querySelector("main").addEventListener(type, event => {
    const element = event.target.closest(`[data-${type}]`);
    if (!element) return;
    const name = element.dataset[type];
    if (!Object.hasOwn(actions, name)) return;
    const { arg1, arg2, arg3, pass } = element.dataset;
    if (pass === "event") actions[name](event);
    else if (pass === "value") actions[name](element.value);
    else if (pass === "files") actions[name](element.files);
    else actions[name](arg1, arg2, name === "pickMulti" ? arg3 === "true" : arg3);
  });
}

function refreshOnReturn() {
  if (devMode || !state.paidLocked) return;
  recordNeedsRefresh = true;
  refreshOpenRecord();
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refreshOnReturn();
});
window.addEventListener("pageshow", event => { if (event.persisted) refreshOnReturn(); });
watchRecordChanges();
void trackEvent("landing");
if (resumeTarget) void resumeSavedStep();
else renderStage();
