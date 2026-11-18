import {
  AGE_RANGES, AXES_META, DAY_TO_AXIS, GENDERS, OFFLINE_STEPS, QUESTIONS,
  STORES, buildBookingDates, computeBMI, evaluateAxes, hasRedFlags,
} from "./quiz-data.mjs";

const MEDIA_ROOT = "/demo/reels-quiz/media/";
const STORAGE_TTL_MS = 48 * 60 * 60 * 1000;
const params = new URLSearchParams(location.search);
const dayParam = (params.get("day") || "").padStart(2, "0");
const day = Object.hasOwn(DAY_TO_AXIS, dayParam) ? dayParam : "01";
const axisParam = params.get("axis");
const axis = Object.hasOwn(AXES_META, axisParam) ? axisParam : DAY_TO_AXIS[day];
const devMode = params.get("dev") === "1";
const storageKey = `hd_reels_v3:${day}:${axis}${devMode ? ":dev" : ""}`;
const reportSteps = new Set(["report1", "offline_flow", "booking", "booking_done", "post_whatsapp"]);
const savedSteps = new Set(["welcome", "q1", ...Object.keys(QUESTIONS), "safety_stop", "review", "checkout", ...reportSteps]);
const emptyAnswers = { q1: "", q2: [], q3: [], q4: [], q5: [], q6: [], q7: "" };
const emptyUser = { name: "", phone: "", email: "", ageRange: "", gender: "", heightCm: "", weightKg: "", marketingConsent: false };
const firstDate = buildBookingDates()[0];
const state = window.state = {
  submissionId: crypto.randomUUID(),
  submissionToken: crypto.randomUUID(),
  day,
  axis,
  step: "welcome",
  phase: "video",
  editingFromReview: false,
  paidLocked: false,
  currentClipKey: "",
  localVideos: {},
  answers: { ...emptyAnswers },
  user: { ...emptyUser },
  hmcs: { loc: STORES[0], date: firstDate.iso, weekday: firstDate.weekday, dateLabel: firstDate.label, time: firstDate.slots[0] },
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
    sessionStorage.setItem(storageKey, JSON.stringify({
      ts: Date.now(), answers: state.answers, step: state.step, phase: state.phase,
      editingFromReview: state.editingFromReview, unmuted: state.unmuted, rate: state.rate,
      submissionId: state.submissionId, submissionToken: state.submissionToken,
      user: state.user, hmcs: state.hmcs, paidLocked: state.paidLocked,
    }));
  } catch {
    // The current session remains usable in browsers that block Web Storage.
  }
}

function restoreTabState() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey));
    if (!saved || Date.now() - saved.ts > STORAGE_TTL_MS) {
      sessionStorage.removeItem(storageKey);
      return;
    }
    state.answers = { ...emptyAnswers, ...saved.answers };
    state.unmuted = saved.unmuted !== false;
    state.rate = [1, 1.5, 2, 0.8].includes(saved.rate) ? saved.rate : 1;
    state.submissionId = saved.submissionId || state.submissionId;
    state.submissionToken = saved.submissionToken || state.submissionToken;
    state.hmcs = { ...state.hmcs, ...saved.hmcs };
    state.user = { ...emptyUser, ...saved.user };
    state.paidLocked = saved.paidLocked === true;
    if (savedSteps.has(saved.step)) {
      state.step = saved.step;
      state.phase = saved.phase === "panel" ? "panel" : "video";
      state.editingFromReview = saved.editingFromReview === true;
    }
    if (reportSteps.has(state.step) && !state.paidLocked) {
      state.step = "checkout";
      state.phase = "panel";
    }
    if (hasRedFlags(state.answers) && (reportSteps.has(state.step) || ["q7", "review", "checkout"].includes(state.step))) {
      state.step = "safety_stop";
      state.phase = "panel";
      state.paidLocked = false;
    }
  } catch {
    // A corrupted or unavailable draft must not prevent the quiz from opening.
  }
}

restoreTabState();

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
window.cyclePlaybackRate = function(e) {
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
  clearTimeout(stallTimer);
  videoStatus.hidden = true;
  videoLayerEl.classList.remove("video-unavailable");
}

function showVideoRecovery(message, allowManualPlay) {
  if (state.phase !== "video") return;
  clearTimeout(stallTimer);
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
  clearTimeout(stallTimer);
  stallTimer = setTimeout(() => {
    showVideoRecovery("影片暫時載入唔到，你可以重播或者繼續。", false);
  }, 10000);
}

videoEl.addEventListener("timeupdate", () => {
  if (Number.isFinite(videoEl.duration) && videoEl.duration - videoEl.currentTime <= 1.05) revealVideoCta();
});
videoEl.addEventListener("ended", () => {
  clearTimeout(stallTimer);
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

window.manualStartVideo = function(event) {
  event.stopPropagation();
  resetVideoCtaGuard();
  playSmoothly(true);
};

window.toggleMuteVideo = function(event) {
  event.stopPropagation();
  state.unmuted = userPreferredUnmuted = !userPreferredUnmuted;
  videoEl.muted = !userPreferredUnmuted;
  updateMuteBtnUI();
  saveTabState();
};

function playBlurredBackgroundLoop() {
  clearTimeout(stallTimer);
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

window.loadLocalVideos = function(files) {
  if (!devMode) return;
  for (const file of files) {
    if (state.localVideos[file.name]) URL.revokeObjectURL(state.localVideos[file.name]);
    state.localVideos[file.name] = URL.createObjectURL(file);
  }
  state.currentClipKey = "";
  renderStage();
};

window.replayCurrentVideo = function(event) {
  event.stopPropagation();
  resetVideoCtaGuard();
  if (videoEl.error) videoEl.load();
  try { videoEl.currentTime = 0; } catch { /* No seekable data yet. */ }
  playSmoothly(true);
};

window.enterPanelPhase = function() {
  if (window.state.step === "welcome") {
    goStep("q1", "video");
    return;
  }
  state.phase = "panel";
  saveTabState();
  playBlurredBackgroundLoop();
  applyPhaseUI();
};
window.replayStepVideo = function() {
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
  if (s === "q1") return (AXES_META[window.state.axis] || AXES_META.metabolic).clip;
  if (QUESTIONS[s]) return QUESTIONS[s].clip;
  if (s === "safety_stop") return "08-safety-stop";
  if (s === "review" || s === "checkout") return "10-review";
  if (s === "report1") return "11-report";
  if (s === "offline_flow") return "12-offline-flow";
  if (["booking", "booking_done", "post_whatsapp"].includes(s)) return "13-booking";
  return "01-welcome";
}
function applyPhaseUI() {
  const isVideoPhase = window.state.phase === "video";
  videoLayerEl.classList.toggle("blurred", !isVideoPhase);
  videoControlsEl.classList.toggle("hidden-phase", !isVideoPhase);
  glassPanelEl.classList.toggle("hidden-phase", isVideoPhase);
  videoControlsEl.inert = !isVideoPhase;
  glassPanelEl.inert = isVideoPhase;
}
window.toggleTheme = function() {
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
window.switchAxis = function(newAxis) {
  if (!devMode || !Object.hasOwn(AXES_META, newAxis)) return;
  window.state.axis = newAxis;
  window.state.answers.q1 = "";
  window.state.paidLocked = false;
  window.state.currentClipKey = "";
  saveTabState();
  goStep("q1", "video");
};
function getBodyInputWarning() {
  const u = window.state.user;
  const hRaw = String(u.heightCm || "").trim();
  const wRaw = String(u.weightKg || "").trim();
  const msgs = [];
  if (hRaw) {
    const h = Number(hRaw);
    if (!isFinite(h) || h < 130 || h > 210) {
      msgs.push(`你輸入嘅身高（${hRaw} cm）同香港成人常見範圍（130–210 cm）不符，請檢查有冇入錯單位（例如誤用米）或打錯數字。`);
    }
  }
  if (wRaw) {
    const w = Number(wRaw);
    if (!isFinite(w) || w < 30 || w > 180) {
      msgs.push(`你輸入嘅體重（${wRaw} kg）同香港成人常見範圍（30–180 kg）不符，請檢查有冇誤用磅（lbs）或打錯數字。`);
    }
  }
  return msgs.join(" ");
}
function syncUserFieldsFromDOM() {
  const nEl = document.getElementById("inpName");
  const pEl = document.getElementById("inpPhone");
  const eEl = document.getElementById("inpEmail");
  const aEl = document.getElementById("inpAgeRange");
  const gEl = document.getElementById("inpGender");
  const hEl = document.getElementById("inpHeight");
  const wEl = document.getElementById("inpWeight");
  if (nEl) window.state.user.name = nEl.value;
  if (pEl) window.state.user.phone = pEl.value;
  if (eEl) window.state.user.email = eEl.value;
  if (aEl) window.state.user.ageRange = aEl.value;
  if (gEl) window.state.user.gender = gEl.value;
  if (hEl) window.state.user.heightCm = hEl.value;
  if (wEl) state.user.weightKg = wEl.value;
  state.user.marketingConsent = document.getElementById("inpMarketing")?.checked ?? false;
}
function getUnlockErrors() {
  const u = window.state.user;
  const errs = [];
  if (!(u.name || "").trim() || u.name.trim().length > 80) errs.push("稱呼／姓名");
  if (!/^\d{8}$/.test(u.phone.trim())) errs.push("WhatsApp 電話（8 位香港號碼）");
  if (u.email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email.trim())) errs.push("有效電郵地址");
  if (!AGE_RANGES.includes(u.ageRange)) errs.push("年齡範圍");
  if (!GENDERS.includes(u.gender)) errs.push("性別");
  const h = Number(u.heightCm);
  if (!String(u.heightCm || "").trim() || !isFinite(h) || h < 130 || h > 210) errs.push("身高（130–210 cm）");
  const w = Number(u.weightKg);
  if (!String(u.weightKg || "").trim() || !isFinite(w) || w < 30 || w > 180) errs.push("體重（30–180 kg）");
  return errs;
}
function canUnlock() {
  return getUnlockErrors().length === 0;
}
let submissionPending = false;

async function sendRecordToBackend(eventType, button) {
  if (devMode) return true;
  if (submissionPending) return false;
  const st = state;
  const ev = evaluateAxes(st.axis, st.answers);
  const triage = eventType === "triage_aborted_level1";
  const payload = {
    submission_id: st.submissionId,
    submission_token: st.submissionToken,
    submitted_at: new Date().toISOString(),
    event_type: eventType,
    user: triage ? null : {
      ...st.user, name: st.user.name.trim(), phone: st.user.phone.trim(), email: st.user.email.trim(),
    },
    day_entry: st.day,
    axis_entry: st.axis,
    bmi: triage ? null : computeBMI(st.user.heightCm, st.user.weightKg),
    top_axis: triage ? null : ev.winnerId,
    ratios: triage ? null : ev.ratios,
    answers: triage ? { q6: st.answers.q6 } : st.answers,
    booking: eventType === "booking_intent" ? {
      store: st.hmcs.loc, date: st.hmcs.date, weekday: st.hmcs.weekday, timeSlot: st.hmcs.time,
    } : null,
  };
  const status = document.getElementById("submissionStatus");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  const label = button?.textContent;
  const panelBody = document.getElementById("panelBody");
  if (!triage) {
    submissionPending = true;
    panelBody.inert = true;
    if (button) {
      button.disabled = true;
      button.textContent = "正在儲存資料…";
    }
    if (status) status.textContent = "";
  }
  try {
    const response = await fetch("/api/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
      keepalive: triage,
    });
    if (!response.ok) throw new Error("Submission failed");
    return true;
  } catch {
    if (status) status.textContent = "暫時儲存唔到資料。請檢查網絡，再撳掣重試。";
    return false;
  } finally {
    clearTimeout(timeout);
    if (!triage) {
      submissionPending = false;
      panelBody.inert = false;
      if (button) {
        button.disabled = false;
        button.textContent = label;
      }
    }
  }
}

function getShortLabels(qid) {
  const st = window.state;
  const opts = qid === "q1" ? (AXES_META[st.axis] || AXES_META.metabolic).q1Opts : (QUESTIONS[qid] ? QUESTIONS[qid].opts : []);
  const map = new Map(opts.map(o => [o.val, o.short || o.label]));
  if (qid === "q1" || qid === "q7") {
    const v = st.answers[qid];
    return v ? [map.get(v) || v] : ["未選"];
  }
  const arr = st.answers[qid] || [];
  return arr.length ? arr.map(v => map.get(v) || v) : ["未選"];
}
window.goStep = function(targetStep, startPhase) {
  if (submissionPending || !savedSteps.has(targetStep)) return;
  if (reportSteps.has(targetStep) && !window.state.paidLocked) {
    targetStep = "checkout";
    startPhase = "panel";
  }
  const noVideoSteps = ["checkout", "booking_done", "post_whatsapp"];
  const defaultPhase = noVideoSteps.includes(targetStep) ? "panel" : "video";
  window.state.step = targetStep;
  window.state.phase = startPhase || defaultPhase;
  saveTabState();
  renderStage();
  document.getElementById('panelBody').scrollTop = 0;
};
window.renderStage = function() {
  const st = window.state;
  const s = st.step;
  const badge = document.getElementById("stepBadge");
  const title = document.getElementById("panelTitle");
  const body = document.getElementById("panelBody");
  const footer = document.getElementById("panelFooter");
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
              <div class="chip-wrap">${tags.map(t => `<span class="ans-chip">${t}</span>`).join("")}</div>
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
  // 必填個人資料解鎖頁（零捲動緊湊雙欄排版：簡短聲明置頂 ＋ 下拉選單 ＋ 7 項全部一屏睇齊）
  if (s === "checkout") {
    badge.textContent = "解鎖個人分析報告";
    title.textContent = "填寫個人資料，即時解鎖結果";
          body.innerHTML = `
      <div class="warn-box" style="padding:7px 10px; font-size:13.5px; line-height:1.35;">
        🔒 你提供嘅資料會用於問卷分析、報告同預約跟進。Health Decoder 團隊可用 WhatsApp 或電郵聯絡你。
      </div>
      <div class="grid-2col">
        <div>
          <label class="form-label" for="inpName">稱呼／姓名 *</label>
          <input class="inp-field" style="padding:8px 10px; font-size:15.5px;" id="inpName" maxlength="80" autocomplete="name" type="text" placeholder="陳先生／陳太" value="${escapeHtml(st.user.name)}" data-input="onUserFieldInput" data-change="onUserFieldInput" />
        </div>
        <div>
          <label class="form-label" for="inpPhone">WhatsApp 電話 *</label>
          <input class="inp-field" style="padding:8px 10px; font-size:15.5px;" id="inpPhone" maxlength="8" autocomplete="tel-national" inputmode="numeric" type="tel" placeholder="8 位數字" value="${escapeHtml(st.user.phone)}" data-input="onUserFieldInput" data-change="onUserFieldInput" />
        </div>
      </div>
      <div>
        <label class="form-label" for="inpEmail">電郵地址 *</label>
        <input class="inp-field" style="padding:8px 10px; font-size:15.5px;" id="inpEmail" maxlength="254" autocomplete="email" type="email" placeholder="example@email.com" value="${escapeHtml(st.user.email)}" data-input="onUserFieldInput" data-change="onUserFieldInput" />
      </div>
      <div class="grid-2col">
        <div>
          <label class="form-label" for="inpAgeRange">年齡範圍 *</label>
          <select class="inp-field" style="padding:8px 10px; font-size:15.5px;" id="inpAgeRange" data-change="onUserFieldInput">
            <option value="">請選擇</option>
            ${AGE_RANGES.map(a => `<option value="${a}" ${st.user.ageRange===a?'selected':''}>${a}</option>`).join("")}
          </select>
        </div>
        <div>
          <label class="form-label" for="inpGender">性別 *</label>
          <select class="inp-field" style="padding:8px 10px; font-size:15.5px;" id="inpGender" data-change="onUserFieldInput">
            <option value="">請選擇</option>
            ${GENDERS.map(g => `<option value="${g}" ${st.user.gender===g?'selected':''}>${g}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="grid-2col">
        <div>
          <label class="form-label" for="inpHeight">身高（cm）*</label>
          <input class="inp-field" style="padding:8px 10px; font-size:15.5px;" id="inpHeight" min="130" max="210" step="any" type="number" inputmode="decimal" placeholder="如 168" value="${escapeHtml(st.user.heightCm)}" data-input="onUserFieldInput" data-change="onUserFieldInput" />
        </div>
        <div>
          <label class="form-label" for="inpWeight">體重（kg）*</label>
          <input class="inp-field" style="padding:8px 10px; font-size:15.5px;" id="inpWeight" min="30" max="180" step="any" type="number" inputmode="decimal" placeholder="如 65" value="${escapeHtml(st.user.weightKg)}" data-input="onUserFieldInput" data-change="onUserFieldInput" />
        </div>
      </div>
      <label class="privacy-option"><input id="inpMarketing" type="checkbox" ${st.user.marketingConsent ? "checked" : ""} data-change="onUserFieldInput" />我願意收取 Health Decoder 嘅健康資訊同活動電郵。</label>
      <div class="warn-box" id="bodyWarnBox" role="status" style="${getBodyInputWarning() ? '' : 'display:none;'} padding:6px 10px; font-size:13px;">
        ⚠️ ${escapeHtml(getBodyInputWarning())}
      </div>
    `;
    footer.innerHTML = `
      <button type="button" class="btn-primary" id="unlockBtn" data-click="processUnlockReport">立即解鎖分析報告 →</button>
      <p class="submission-status" id="submissionStatus" role="status"></p>
      <button type="button" class="btn-secondary" data-click="goStep" data-arg1="review" data-arg2="panel">← 返回覆核答案</button>
    `;
    return;
  }
  const ev = evaluateAxes(st.axis, st.answers);
  const win = ev.winner;
  if (s === "report1") {
    badge.textContent = "專屬 4 軸分析報告";
    title.textContent = `主要火頭：${win.name}`;
    const barsHtml = ev.sortedIds.map(cid => {
      const c = AXES_META[cid];
      const pct = ev.ratios[cid];
      const isWin = cid === ev.winnerId;
      return `
        <div class="ratio-card ${isWin ? 'top-winner' : ''}">
          <div class="ratio-head">
            <span>${isWin ? '👑 主因：' : ''}${c.name}</span>
            <span>${pct}%</span>
          </div>
          <div class="ratio-track">
            <div class="ratio-fill" style="width:${Math.max(pct, 6)}%; background:${c.color};"></div>
          </div>
        </div>
      `;
    }).join("");
    const bmiInfo = computeBMI(st.user.heightCm, st.user.weightKg);
    const bmiHtml = bmiInfo ? `
      <div class="info-box" style="padding:9px 12px; font-size:14.5px; border-color:${bmiInfo.color};">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:3px;">
          <strong>📊 你的 BMI：${bmiInfo.bmi}（${bmiInfo.status}）</strong>
          <span style="font-size:12.5px; color:var(--ink-muted);">${st.user.gender || ''} · ${st.user.ageRange || ''}</span>
        </div>
        <div style="font-size:13.5px; line-height:1.38; color:var(--ink-sub);">${bmiInfo.risk}</div>
      </div>
    ` : "";
    body.innerHTML = `
      <p class="report-note">以下比例按自測答案及題目權重計算，供健康交流參考。</p>
      <div class="ratio-stack">${barsHtml}</div>
      <div class="info-box" style="font-size:15px; padding:9px 12px;">${win.why}</div>
      ${bmiHtml}
      <div class="warn-box" style="padding:8px 11px; font-size:13.5px;">
        🎁 想領取【完整問卷分析報告 PDF 版】留底保存？記得完成預約流程，以獲取領取 PDF 報告的方法。
      </div>
    `;
    footer.innerHTML = `
      <button type="button" class="btn-primary" data-click="goStep" data-arg1="offline_flow" data-arg2="video">下一步：了解首次線下見面流程 →</button>
      <button type="button" class="btn-secondary" data-click="replayStepVideo">↺ 重溫報告解讀影片</button>
    `;
    return;
  }
  if (s === "offline_flow") {
    badge.textContent = "首次線下會面流程";
    title.textContent = "第一次見面 6 步流程圖";
    const OFFLINE_STEPS = [
      { t: "微電流檢測", s: "即時評估身體各部份功能及健康狀況" },
      { t: "身體成份分析", s: "掌握內臟脂肪、肌肉與水分分佈" },
      { t: "深入聆聽處境與訴求", s: "了解生活習慣、困擾與最想改善目標" },
      { t: "初步分析結果及見解", s: "即場梳理背後核心火頭與方向" },
      { t: "一週深入分析方案（自願）", s: "若同意，交低醫院報告及藥單做詳細評估" },
      { t: "再約下一次見面詳細解讀", s: "一對一講解專屬深度改善計劃" }
    ];
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
      <button type="button" class="btn-primary" data-click="goStep" data-arg1="booking" data-arg2="video">下一步：揀選門市日期預約 →</button>
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
  const curDateObj = bookingDates.find(d => d.iso === st.hmcs.date) || bookingDates[0];
  Object.assign(st.hmcs, { date: curDateObj.iso, weekday: curDateObj.weekday, dateLabel: curDateObj.label });
    if (!curDateObj.slots.includes(st.hmcs.time)) {
      st.hmcs.time = curDateObj.slots[0];
    }
    body.innerHTML = `
      <div style="font-size:15px; font-weight:800; color:var(--ink-sub);">1. 選擇就腳門市：</div>
      <div class="grid-2col">
        ${STORES.map(l => `<button type="button" class="slot-btn ${st.hmcs.loc===l?'selected':''}" data-click="selectBookingStore" data-arg1="${l}">📍 ${l}</button>`).join("")}
      </div>
      <div style="font-size:15px; font-weight:800; color:var(--ink-sub);">2. 選擇意向日期（星期一至六）：</div>
      <div class="date-scroll">
        ${bookingDates.map(d => `<button type="button" class="slot-btn ${st.hmcs.date===d.iso?'selected':''}" style="font-size:13.5px;" data-click="selectBookingDate" data-arg1="${d.iso}" >${d.label}</button>`).join("")}
      </div>
      <div style="font-size:15px; font-weight:800; color:var(--ink-sub);">3. 選擇意向時段：</div>
      <div class="grid-3col">
        ${curDateObj.slots.map(t => `<button type="button" class="slot-btn ${st.hmcs.time===t?'selected':''}" style="font-size:14.5px;" data-click="selectBookingSlot" data-arg1="${t}">🕒 ${t}</button>`).join("")}
      </div>
      <div class="warn-box">
        ℹ️ 以上只屬你嘅意向門市、日期同時段，最後會以 WhatsApp 通訊正式確認預約。
      </div>
    `;
    footer.innerHTML = `
      <button type="button" class="btn-primary" id="bookingSubmitBtn" data-click="confirmBookingSubmit">送出意向預約（${st.hmcs.loc} · ${st.hmcs.dateLabel} · ${st.hmcs.time}）→</button>
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
    const waText = encodeURIComponent(`你好 Duncan 團隊，我想確認線下見面預約，並領取個人問卷分析報告 PDF 版。\n稱呼：${st.user.name.trim()}\n意向門市：${st.hmcs.loc}\n意向日期：${st.hmcs.date}\n意向時段：${st.hmcs.time}\n查閱編號：${st.submissionId}`);
    body.innerHTML = `
      <div class="info-box">
        意向門市：<strong>${st.hmcs.loc}門市</strong><br/>
        意向日期：<strong>${st.hmcs.dateLabel}</strong><br/>
        意向時段：<strong>${st.hmcs.time}</strong><br/>
        聯絡電話：<strong>${escapeHtml(st.user.phone)}</strong><br/>
        確認電郵：<strong>${escapeHtml(st.user.email)}</strong>
      </div>
      <div class="warn-box">
        🎁 <strong>完成 WhatsApp 確認預約即領取：</strong><br/>
        請在 WhatsApp 按「傳送」。Duncan 團隊確認預約後，會經 WhatsApp 送返一份【你嘅個人問卷分析報告 PDF 版】俾你留底保存。以上只係意向門市、日期同時段，最後以 WhatsApp 通訊作準。
      </div>
    `;
    footer.innerHTML = `
      <a href="https://wa.me/85298788564?text=${waText}" target="_blank" rel="noopener" class="btn-primary" data-click="onWhatsAppBookingClicked">💬 打開 WhatsApp 確認預約 →</a>
      <button type="button" class="btn-secondary" data-click="goStep" data-arg1="booking" data-arg2="panel">← 修改意向門市或時間</button>
    `;
    return;
  }
  // 已完成 WhatsApp 發送預約訊息後之最終分流頁（返回看報告 OR 加入 FB/WhatsApp 群組）
  if (s === "post_whatsapp") {
    badge.textContent = "WhatsApp 預約確認";
    title.textContent = "請喺 WhatsApp 傳送預約訊息";
    body.innerHTML = `
      <div class="info-box">
        如果你已傳送訊息，團隊收到後會同你落實見面預約。<br/><br/>
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
window.onWhatsAppBookingClicked = function() {
  setTimeout(() => goStep("post_whatsapp", "panel"), 250);
};
window.selectBookingDate = function(iso) {
  if (submissionPending) return;
  const date = buildBookingDates().find(entry => entry.iso === iso);
  if (!date) return;
  Object.assign(state.hmcs, { date: date.iso, weekday: date.weekday, dateLabel: date.label });
  if (!date.slots.includes(state.hmcs.time)) state.hmcs.time = date.slots[0];
  saveTabState();
  renderStage();
};
window.selectBookingStore = function(store) {
  if (submissionPending || !STORES.includes(store)) return;
  state.hmcs.loc = store;
  saveTabState();
  renderStage();
};
window.selectBookingSlot = function(slot) {
  if (submissionPending) return;
  const date = buildBookingDates().find(({ iso }) => iso === state.hmcs.date);
  if (!date?.slots.includes(slot)) return;
  state.hmcs.time = slot;
  saveTabState();
  renderStage();
};
window.confirmBookingSubmit = async function() {
  if (submissionPending || state.step !== "booking") return;
  const date = buildBookingDates().find(({ iso }) => iso === state.hmcs.date);
  if (!date?.slots.includes(state.hmcs.time)) {
    renderStage();
    document.getElementById("submissionStatus").textContent = "原先時段已過，請重新揀選。";
    return;
  }
  if (await sendRecordToBackend("booking_intent", document.getElementById("bookingSubmitBtn"))) {
    if (state.step === "booking") goStep("booking_done", "panel");
  }
};
window.onUserFieldInput = function() {
  syncUserFieldsFromDOM();
  saveTabState();
  const wb = document.getElementById("bodyWarnBox");
  if (wb) {
    const msg = getBodyInputWarning();
    wb.style.display = msg ? "block" : "none";
    wb.textContent = msg ? ("⚠️ " + msg) : "";
  }
};
window.pickSingle = function(qid, val) {
  if (window.state.paidLocked) return;
  window.state.answers[qid] = val;
  saveTabState();
  renderStage();
};
window.pickMulti = function(qid, val, isNone) {
  if (window.state.paidLocked) return;
  let cur = [...(window.state.answers[qid] || [])];
  const q = QUESTIONS[qid];
  const noneVals = q.opts.filter(o => o.isNone).map(o => o.val);
  if (isNone) {
    cur = [val];
  } else {
    cur = cur.filter(v => !noneVals.includes(v));
    if (cur.includes(val)) cur = cur.filter(v => v !== val);
    else cur.push(val);
  }
  window.state.answers[qid] = cur;
  saveTabState();
  renderStage();
};
window.reviseSafetyAnswer = function() {
  state.answers.q6 = [];
  state.submissionId = crypto.randomUUID();
  state.submissionToken = crypto.randomUUID();
  goStep("q6", "panel");
};
window.submitQuestion = function(qid) {
  if (state.step !== qid || state.paidLocked) return;
  const answer = state.answers[qid];
  if (!answer?.length) return;
  if (qid === "q6" && hasRedFlags(state.answers)) {
    state.editingFromReview = false;
    void sendRecordToBackend("triage_aborted_level1");
    goStep("safety_stop", "video");
    return;
  }
  if (state.editingFromReview) {
    state.editingFromReview = false;
    goStep("review", "panel");
    return;
  }
  const nextMap = { q1: "q2", q2: "q3", q3: "q4", q4: "q5", q5: "q6", q6: "q7", q7: "review" };
  goStep(nextMap[qid], "video");
};
window.editFromReview = function(qid) {
  if (window.state.paidLocked) return;
  window.state.editingFromReview = true;
  goStep(qid, "panel");
};
window.jumpStep = function(target) {
  if (!devMode) return;
  if (reportSteps.has(target) && !canUnlock()) {
    window.state.step = "checkout";
    window.state.phase = "panel";
    renderStage();
    return;
  }
  window.state.paidLocked = reportSteps.has(target);
  window.state.editingFromReview = false;
  goStep(target, target === "welcome" ? "video" : "panel");
};
window.stepBack = function() {
  if (window.state.editingFromReview) {
    window.state.editingFromReview = false;
    goStep("review", "panel");
    return;
  }
  const prevMap = {
    q1: "welcome", q2: "q1", q3: "q2", q4: "q3",
    q5: "q4", q6: "q5", safety_stop: "q6", q7: "q6",
    review: "q7", checkout: "review",
    offline_flow: "report1", booking: "offline_flow", booking_done: "booking", post_whatsapp: "booking_done"
  };
  const prev = prevMap[window.state.step];
  if (prev && !(window.state.paidLocked && ["review", "q7", "checkout"].includes(prev))) {
    goStep(prev, "panel");
  }
};
window.processUnlockReport = async function() {
  if (submissionPending || state.step !== "checkout") return;
  if (hasRedFlags(state.answers)) {
    void sendRecordToBackend("triage_aborted_level1");
    goStep("safety_stop", "video");
    return;
  }
  syncUserFieldsFromDOM();
  const errs = getUnlockErrors();
  if (errs.length) {
    const warning = document.getElementById("bodyWarnBox");
    warning.style.display = "block";
    warning.textContent = "⚠️ 請先填妥／修正：" + errs.join("、");
    return;
  }
  if (!devMode && Object.values(state.answers).some(answer => !answer.length)) {
    goStep("review", "panel");
    return;
  }
  saveTabState();
  if (await sendRecordToBackend("quiz_unlocked", document.getElementById("unlockBtn"))) {
    state.paidLocked = true;
    goStep("report1", "video");
  }
};

const actions = Object.freeze({
  confirmBookingSubmit, cyclePlaybackRate, editFromReview, enterPanelPhase, goStep, jumpStep,
  loadLocalVideos, manualStartVideo, onUserFieldInput, onWhatsAppBookingClicked, pickMulti,
  pickSingle, processUnlockReport, replayCurrentVideo, replayStepVideo, reviseSafetyAnswer,
  selectBookingDate, selectBookingSlot, selectBookingStore, stepBack, submitQuestion,
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

renderStage();
