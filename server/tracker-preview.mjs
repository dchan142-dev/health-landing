import { bootCloud } from "/daily-preview/cloud.mjs";
(async function () {
      const CLOUD = await bootCloud();
      const STORAGE_KEY = 'ms_lai_30d_5prod_meals_v2';
      const REMINDER_KEY = 'ms_lai_30d_reminders_v2';
      const START_DATE = '2026-11-23';
      const END_DATE = '2026-12-22';
      const BASELINE_WEIGHT = 39.0;
      const MEALS = [
        { key: 'breakfast', label: '🌅 早餐' },
        { key: 'lunch', label: '☀️ 午餐' },
        { key: 'snack', label: '🥛 營養奶／加餐' },
        { key: 'dinner', label: '🌙 晚餐' }
      ];

      let records = {};
      let chartInstance = null;
      let reminderTimer = null;
      let soundEnabled = true;
      let audioCtx = null;

      // Web Audio API 清脆溫馨音效（零外部音檔，完全離線可用）
      function ensureAudioCtx() {
        if (!soundEnabled) return null;
        try {
          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          if (!AudioContextClass) return null;
          if (!audioCtx) audioCtx = new AudioContextClass();
          if (audioCtx.state === 'suspended') audioCtx.resume();
          return audioCtx;
        } catch (e) {
          return null;
        }
      }

      // 輕點打卡／拍完相片的溫柔「叮」音效
      function playTapChime() {
        const ctx = ensureAudioCtx();
        if (!ctx) return;
        try {
          const now = ctx.currentTime;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(784, now); // G5
          osc.frequency.exponentialRampToValueAtTime(1046.5, now + 0.11); // C6
          gain.gain.setValueAtTime(0.001, now);
          gain.gain.linearRampToValueAtTime(0.14, now + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 0.24);
        } catch (e) {}
      }

      // 儲存打卡完成時的喜悅上行金星和弦音效
      function playCelebrationFanfare() {
        const ctx = ensureAudioCtx();
        if (!ctx) return;
        try {
          const now = ctx.currentTime;
          const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5]; // C5 E5 G5 C6 E6
          notes.forEach((freq, idx) => {
            const t = now + idx * 0.095;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = idx === notes.length - 1 ? 'triangle' : 'sine';
            osc.frequency.setValueAtTime(freq, t);
            gain.gain.setValueAtTime(0.001, t);
            gain.gain.linearRampToValueAtTime(0.18, t + 0.025);
            gain.gain.exponentialRampToValueAtTime(0.001, t + (idx === notes.length - 1 ? 0.65 : 0.32));
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(t);
            osc.stop(t + 0.7);
          });
        } catch (e) {}
      }

      function formatChineseFullDate(dateStr) {
        const d = new Date(dateStr + 'T00:00:00');
        const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
        const y = d.getFullYear();
        const m = d.getMonth() + 1;
        const day = d.getDate();
        return `${y}年${m}月${day}日（${weekdays[d.getDay()]}）`;
      }

      function shiftDate(dateStr, deltaDays) {
        const d = new Date(dateStr + 'T00:00:00');
        d.setDate(d.getDate() + deltaDays);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const nextStr = `${yyyy}-${mm}-${dd}`;
        if (nextStr < START_DATE) return START_DATE;
        if (nextStr > END_DATE) return END_DATE;
        return nextStr;
      }

      function loadStorage(key, fallback) { return key === STORAGE_KEY ? CLOUD.records : (CLOUD.reminder || fallback); }
      function saveStorage(key, val) {
        if (key === REMINDER_KEY) { CLOUD.reminder = val; if (CLOUD.ready) scheduleCloudSave(); }
        return true;
      }

      let toastTimeout = null;
      function showToast(msg) {
        const el = document.getElementById('toast');
        el.textContent = msg;
        el.classList.remove('hidden');
        if (toastTimeout) clearTimeout(toastTimeout);
        toastTimeout = setTimeout(() => el.classList.add('hidden'), 2800);
      }

      function getDayNumber(dateStr) {
        const start = new Date(START_DATE + 'T00:00:00');
        const cur = new Date(dateStr + 'T00:00:00');
        const diff = Math.round((cur - start) / 86400000) + 1;
        return Math.max(1, Math.min(30, diff));
      }

      function getDefaultDate() {
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const todayStr = `${yyyy}-${mm}-${dd}`;
        if (todayStr >= START_DATE && todayStr <= END_DATE) return todayStr;
        return START_DATE;
      }

      function createEmptyRecord(dateStr) {
        return {
          date: dateStr,
          enzymeMl: null,
          probioticDone: false,
          gutDone: false,
          astaDone: false,
          q10Done: false,
          weight: '',
          sbp: '',
          dbp: '',
          intakePct: null,
          comfort: '',
          stoolCount: '',
          stoolType: '',
          notes: '',
          meals: {
            breakfast: { note: '', photos: [] },
            lunch: { note: '', photos: [] },
            snack: { note: '', photos: [] },
            dinner: { note: '', photos: [] }
          }
        };
      }

      let formState = createEmptyRecord(getDefaultDate());
      records = loadStorage(STORAGE_KEY, {});
      const defaultReminder = {
        morning: '08:00',
        evening: '20:30',
        phoneEnabled: true,
        phone: '',
        emailEnabled: true,
        email: '',
        tasksEnabled: true,
        onboarded: false
      };
      let savedReminder = { ...defaultReminder, ...loadStorage(REMINDER_KEY, {}) };
      document.getElementById('input-morning-time').value = savedReminder.morning || '08:00';
      document.getElementById('input-evening-time').value = savedReminder.evening || '20:30';
      document.getElementById('chk-phone-remind').checked = Boolean(savedReminder.phoneEnabled);
      document.getElementById('input-user-phone').value = savedReminder.phone || '';
      document.getElementById('chk-email-remind').checked = Boolean(savedReminder.emailEnabled);
      document.getElementById('input-user-email').value = savedReminder.email || '';
      document.getElementById('chk-tasks-remind').checked = Boolean(savedReminder.tasksEnabled);
      updateReminderBadge(savedReminder);
      updateGoogleCalLinks(savedReminder.morning, savedReminder.evening);

      function loadDateToForm(dateStr) {
        if (!CLOUD.loading && CLOUD.ready && dateStr !== formState.date) { switchCloudDay(dateStr); return; }
        const existing = records[dateStr];
        if (existing) {
          const base = createEmptyRecord(dateStr);
          formState = {
            ...base,
            ...existing,
            date: dateStr,
            meals: {
              breakfast: { note: existing.meals?.breakfast?.note || '', photos: [...(existing.meals?.breakfast?.photos || [])] },
              lunch: { note: existing.meals?.lunch?.note || '', photos: [...(existing.meals?.lunch?.photos || [])] },
              snack: { note: existing.meals?.snack?.note || '', photos: [...(existing.meals?.snack?.photos || [])] },
              dinner: { note: existing.meals?.dinner?.note || '', photos: [...(existing.meals?.dinner?.photos || [])] }
            }
          };
        } else {
          formState = createEmptyRecord(dateStr);
        }
        renderFormUI(getDayNumber(dateStr));
      }

      function getTotalPhotosForRecord(r) {
        if (!r || !r.meals) return 0;
        return MEALS.reduce((sum, m) => sum + ((r.meals[m.key]?.photos || []).length), 0);
      }

      function updateFluidHint() {
        let ml = 0;
        if (formState.enzymeMl > 0) ml += formState.enzymeMl * 3; // 原液配兩倍水 = 3倍總液體
        if (formState.gutDone) ml += 20;
        document.getElementById('fluid-product-hint').textContent = `產品流質估計：${ml} mL`;
      }

      function renderFormUI(dayNum) {
        document.getElementById('input-date').value = formState.date;
        document.getElementById('day-number-pill').textContent = `第 ${dayNum} 天／共 30 天`;
        document.getElementById('hero-date-display').textContent = formatChineseFullDate(formState.date);
        const todayReal = getDefaultDate();
        const todayTag = document.getElementById('day-today-tag');
        if (formState.date === todayReal) {
          todayTag.textContent = '今日';
          todayTag.className = 'px-2.5 py-0.5 rounded-full text-xs font-semibold bg-white/25 text-white';
        } else if (formState.date < todayReal) {
          todayTag.textContent = '補填／回顧';
          todayTag.className = 'px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-200/30 text-amber-100';
        } else {
          todayTag.textContent = '預覽未來日子';
          todayTag.className = 'px-2.5 py-0.5 rounded-full text-xs font-semibold bg-white/15 text-teal-100';
        }
        document.getElementById('btn-prev-day').disabled = formState.date <= START_DATE;
        document.getElementById('btn-prev-day').classList.toggle('opacity-40', formState.date <= START_DATE);
        document.getElementById('btn-next-day').disabled = formState.date >= END_DATE;
        document.getElementById('btn-next-day').classList.toggle('opacity-40', formState.date >= END_DATE);

        const phaseBanner = document.getElementById('phase-banner');
        const enzymeHint = document.getElementById('enzyme-target-hint');
        if (dayNum <= 14) {
          phaseBanner.textContent = '第一階段（第 1–14 日）：酵素限量 10 mL／日，其餘四品（益生菌、腸快適、蝦青素、Q10）按正常份量服用，每餐拍照記錄。';
          enzymeHint.textContent = '今日限量：10 mL（配水合計約 30 mL 計入每日限水）';
        } else if (dayNum <= 28) {
          phaseBanner.textContent = '第二階段（第 15–28 日）：若頭 14 日無不適，酵素進階至 20 mL／日（連水約 60 mL），其餘四品維持正常服用。';
          enzymeHint.textContent = '今日目標：20 mL（配兩倍水合計約 60 mL，可分早晚各 10 mL）';
        } else {
          phaseBanner.textContent = '第三階段（第 29–30 日起）：若前 28 日均無特殊反應或不適且限水充足，才考慮加至正常份量 30 mL／日（連水約 90 mL）。';
          enzymeHint.textContent = '評估加量期：無不適才考慮 30 mL（連水約 90 mL），否則維持 20 mL';
        }

        // 覆診提示
        const visitText = document.getElementById('next-visit-text');
        if (dayNum === 14) {
          visitText.textContent = '📌 第 14 日檢查點：檢視頭兩週腸胃與血壓耐受，確認明日酵素是否由 10 mL 升至 20 mL';
        } else if (dayNum === 28) {
          visitText.textContent = '📌 第 28 日檢查點：檢視前四週有無特殊反應或不適，評估明日是否考慮加至正常份量 30 mL';
        } else if (formState.date === '2026-12-07') {
          visitText.textContent = '🏥 今日 12月7日 內科覆診：請帶同體重、飲食相片、排便及血壓紀錄給醫生參考';
        } else if (formState.date === '2026-12-08') {
          visitText.textContent = '🥗 今日 12月8日 營養部覆診：帶同每餐相片、食量比例與限水紀錄核對';
        } else if (formState.date === '2026-12-11') {
          visitText.textContent = '🏥 今日 12月11日 免疫科覆診：帶同近期身體與五品配合紀錄';
        } else {
          visitText.textContent = '近期覆診：12月7日 內科、12月8日 營養部、12月11日 免疫科';
        }

        // 除酵素前14日限量10mL外，其餘四品由第1日起均正常服用

        // 酵素
        document.querySelectorAll('.enzyme-btn').forEach(btn => {
          btn.classList.toggle('choice-selected', formState.enzymeMl === Number(btn.dataset.enzyme));
        });
        const badge = document.getElementById('enzyme-status-badge');
        if (formState.enzymeMl === null) {
          badge.textContent = '未填';
          badge.className = 'text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-200 text-slate-700';
        } else if (formState.enzymeMl === 0) {
          badge.textContent = '今日未飲';
          badge.className = 'text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-800';
        } else {
          badge.textContent = `已飲 ${formState.enzymeMl} mL`;
          badge.className = 'text-xs font-semibold px-2.5 py-1 rounded-full bg-teal-100 text-teal-800';
        }

        // 其餘四品
        setToggleBtn('toggle-probiotic', formState.probioticDone, '✓ 已食 1 包');
        setToggleBtn('toggle-gut', formState.gutDone, '✓ 已食 1 包');
        setToggleBtn('toggle-asta', formState.astaDone, '✓ 已服用');
        setToggleBtn('toggle-q10', formState.q10Done, '✓ 已服用');
        updateFluidHint();

        // 四餐文字與相片
        MEALS.forEach(m => {
          document.getElementById(`note-${m.key}`).value = formState.meals[m.key].note || '';
          renderMealPhotoGrid(m.key);
        });
        document.getElementById('meal-photo-total-badge').textContent = `今日已傳 ${getTotalPhotosForRecord(formState)} 張`;

        // 食量與感受
        document.querySelectorAll('.intake-btn').forEach(btn => {
          btn.classList.toggle('choice-selected', Number(btn.dataset.intake) === formState.intakePct);
        });
        document.querySelectorAll('.comfort-btn').forEach(btn => {
          btn.classList.toggle('choice-selected', btn.dataset.comfort === formState.comfort);
        });

        // 體重與血壓
        document.getElementById('input-weight').value = formState.weight;
        updateWeightHint();
        document.getElementById('input-sbp').value = formState.sbp || '';
        document.getElementById('input-dbp').value = formState.dbp || '';
        checkBpWarning();

        // 排便
        document.querySelectorAll('.stool-count-btn').forEach(btn => {
          btn.classList.toggle('choice-selected', btn.dataset.stoolCount === formState.stoolCount);
        });
        document.querySelectorAll('.stool-type-btn').forEach(btn => {
          btn.classList.toggle('choice-selected', btn.dataset.stoolType === formState.stoolType);
        });

        // 備註
        document.getElementById('input-notes').value = formState.notes || '';
        updateTopProgressUI();
      }

      function setToggleBtn(id, active, doneText) {
        const el = document.getElementById(id);
        el.textContent = active ? doneText : '未完成';
        el.classList.toggle('choice-selected', active);
      }

      function updateWeightHint() {
        const w = parseFloat(document.getElementById('input-weight').value);
        const hint = document.getElementById('weight-diff-hint');
        if (!isNaN(w) && w > 0) {
          const diff = (w - BASELINE_WEIGHT).toFixed(1);
          hint.textContent = `較基線 (39.0 kg)：${diff > 0 ? '+' : ''}${diff} kg（請同時留意腳腫有否增加）`;
        } else {
          hint.textContent = '如廁後、早餐前量度；請同時留意腳腫有否增加';
        }
      }

      function checkBpWarning() {
        const sbp = parseFloat(document.getElementById('input-sbp').value);
        const warn = document.getElementById('bp-warning');
        if (!isNaN(sbp) && sbp > 0 && sbp < 95) {
          warn.classList.remove('hidden');
        } else {
          warn.classList.add('hidden');
        }
      }

      function compressImage(file, maxDim = 480, quality = 0.62) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
              let w = img.width;
              let h = img.height;
              if (w > maxDim || h > maxDim) {
                if (w > h) {
                  h = Math.round((h * maxDim) / w);
                  w = maxDim;
                } else {
                  w = Math.round((w * maxDim) / h);
                  h = maxDim;
                }
              }
              const canvas = document.createElement('canvas');
              canvas.width = w;
              canvas.height = h;
              canvas.getContext('2d').drawImage(img, 0, 0, w, h);
              const compressed = canvas.toDataURL('image/jpeg', quality);
              if (compressed.length > 100000) { reject(new Error('相片較大，請選擇另一張相片或截圖。')); return; }
              resolve(compressed);
            };
            img.onerror = reject;
            img.src = e.target.result;
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      }

      function renderMealPhotoGrid(mealKey) {
        const grid = document.getElementById(`grid-${mealKey}`);
        grid.innerHTML = '';
        const photos = formState.meals[mealKey].photos || [];
        photos.forEach((src, idx) => {
          const wrap = document.createElement('div');
          wrap.className = 'relative aspect-square rounded-lg overflow-hidden border border-slate-200 bg-white';

          const img = document.createElement('img');
          img.src = src;
          img.alt = `${mealKey} 相片 ${idx + 1}`;
          img.className = 'w-full h-full object-cover cursor-pointer';
          img.addEventListener('click', () => {
            document.getElementById('modal-image-src').src = src;
            document.getElementById('modal-image').classList.remove('hidden');
          });

          const del = document.createElement('button');
          del.type = 'button';
          del.textContent = '✕';
          del.className = 'absolute top-1 right-1 w-6 h-6 rounded-full bg-slate-900/75 text-white text-xs font-bold flex items-center justify-center';
          del.addEventListener('click', () => {
            formState.meals[mealKey].photos.splice(idx, 1);
            renderMealPhotoGrid(mealKey);
            document.getElementById('meal-photo-total-badge').textContent = `今日已傳 ${getTotalPhotosForRecord(formState)} 張`;
          });

          wrap.appendChild(img);
          wrap.appendChild(del);
          grid.appendChild(wrap);
        });
      }

      // 事件綁定
      document.getElementById('input-date').addEventListener('change', (e) => {
        if (e.target.value) {
          playTapChime();
          loadDateToForm(e.target.value);
        }
      });
      document.getElementById('btn-prev-day').addEventListener('click', () => {
        playTapChime();
        loadDateToForm(shiftDate(formState.date, -1));
      });
      document.getElementById('btn-next-day').addEventListener('click', () => {
        playTapChime();
        loadDateToForm(shiftDate(formState.date, 1));
      });
      document.getElementById('btn-toggle-sound').addEventListener('click', () => {
        soundEnabled = !soundEnabled;
        document.getElementById('sound-icon').textContent = soundEnabled ? '🔊' : '🔇';
        document.getElementById('sound-label').textContent = soundEnabled ? '音效開' : '已靜音';
        if (soundEnabled) {
          playTapChime();
          showToast('已開啟打卡獎勵音效 🔊');
        } else {
          showToast('已暫時靜音 🔇');
        }
      });

      document.getElementById('btn-toggle-schedule').addEventListener('click', () => {
        document.getElementById('daily-schedule-box').classList.toggle('hidden');
      });

      document.querySelectorAll('.meal-photo-input').forEach(inp => {
        inp.addEventListener('change', async (e) => {
          const mealKey = inp.dataset.meal;
          const files = Array.from(e.target.files || []);
          if (!files.length) return;
          showToast('正在壓縮並加入膳食相片...');
          CLOUD.photosBusy = true;
          let added = 0;
          for (const f of files) {
            if (formState.meals[mealKey].photos.length >= 2) { showToast("每餐最多兩張相片，請先移除相片再加入。"); break; }
            try {
              const dataUrl = await compressImage(f);
              formState.meals[mealKey].photos.push(dataUrl);
              added++;
            } catch (err) {
              showToast('有相片未能讀取，請重試');
            }
          }
          renderMealPhotoGrid(mealKey);
          document.getElementById('meal-photo-total-badge').textContent = `今日已傳 ${getTotalPhotosForRecord(formState)} 張`;
          e.target.value = '';
          CLOUD.photosBusy = false;
          markCloudDirty();
          const saved = await saveCurrentDay(true);
          playTapChime();
          if (saved && added) showToast(`好叻！已上載 ${added} 張膳食相並自動儲存`);
        });
      });

      document.querySelectorAll('[data-meal-note]').forEach(inp => {
        inp.addEventListener('input', (e) => {
          formState.meals[inp.dataset.mealNote].note = e.target.value;
        });
      });

      document.querySelectorAll('.enzyme-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          formState.enzymeMl = Number(btn.dataset.enzyme);
          playTapChime();
          renderFormUI(getDayNumber(formState.date));
        });
      });

      document.getElementById('toggle-probiotic').addEventListener('click', () => {
        formState.probioticDone = !formState.probioticDone;
          playTapChime();
        renderFormUI(getDayNumber(formState.date));
      });
      document.getElementById('toggle-gut').addEventListener('click', () => {
        formState.gutDone = !formState.gutDone;
          playTapChime();
        renderFormUI(getDayNumber(formState.date));
      });
      document.getElementById('toggle-asta').addEventListener('click', () => {
        formState.astaDone = !formState.astaDone;
          playTapChime();
        renderFormUI(getDayNumber(formState.date));
      });
      document.getElementById('toggle-q10').addEventListener('click', () => {
        formState.q10Done = !formState.q10Done;
          playTapChime();
        renderFormUI(getDayNumber(formState.date));
      });

      document.getElementById('btn-weight-minus').addEventListener('click', () => {
        const cur = parseFloat(document.getElementById('input-weight').value) || BASELINE_WEIGHT;
        const next = Math.max(25, cur - 0.1).toFixed(1);
        document.getElementById('input-weight').value = next;
        formState.weight = next;
        updateWeightHint();
      });
      document.getElementById('btn-weight-plus').addEventListener('click', () => {
        const cur = parseFloat(document.getElementById('input-weight').value) || BASELINE_WEIGHT;
        const next = Math.min(80, cur + 0.1).toFixed(1);
        document.getElementById('input-weight').value = next;
        formState.weight = next;
        updateWeightHint();
      });
      document.getElementById('input-weight').addEventListener('input', (e) => {
        formState.weight = e.target.value;
        updateWeightHint();
      });

      document.getElementById('input-sbp').addEventListener('input', (e) => {
        formState.sbp = e.target.value;
        checkBpWarning();
      });
      document.getElementById('input-dbp').addEventListener('input', (e) => {
        formState.dbp = e.target.value;
      });

      document.querySelectorAll('.intake-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          formState.intakePct = Number(btn.dataset.intake);
          renderFormUI(getDayNumber(formState.date));
        });
      });
      document.querySelectorAll('.comfort-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          formState.comfort = btn.dataset.comfort;
          renderFormUI(getDayNumber(formState.date));
        });
      });
      document.querySelectorAll('.stool-count-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          formState.stoolCount = btn.dataset.stoolCount;
          renderFormUI(getDayNumber(formState.date));
        });
      });
      document.querySelectorAll('.stool-type-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          formState.stoolType = btn.dataset.stoolType;
          renderFormUI(getDayNumber(formState.date));
        });
      });
      document.getElementById('input-notes').addEventListener('input', (e) => {
        formState.notes = e.target.value;
      });

      function getCompletedDaysCount() {
        return Object.keys(records).length;
      }

      function getCurrentStreak() {
        const keys = Object.keys(records).sort();
        if (!keys.length) return 0;
        let streak = 1;
        for (let i = keys.length - 1; i > 0; i--) {
          const d1 = new Date(keys[i] + 'T00:00:00');
          const d0 = new Date(keys[i - 1] + 'T00:00:00');
          if (Math.round((d1 - d0) / 86400000) === 1) {
            streak++;
          } else {
            break;
          }
        }
        return streak;
      }

      function pickEncouragementMessage(dayNum, doneCount, photoCount, intakePct) {
        if (doneCount === 1) {
          return '欣賞你踏出第一步！由今日起每日記低少少，我哋一齊睇住身體慢慢穩返上嚟。';
        }
        if (doneCount === 7) {
          return '唔經唔覺已經完成第一個星期！你呢份準時同細心，已經幫腸胃同生活建立咗好穩嘅節奏。';
        }
        if (doneCount === 14) {
          return '完成頭兩星期適應期，真係好唔簡單！好欣賞你每日都咁認真配合，我哋準備好一齊檢視進階啦。';
        }
        if (doneCount === 30) {
          return '30天全部打卡完成！好多謝你呢一個月每日嘅堅持，你已經為自己累積咗一份非常紮實嘅健康底氣。';
        }
        if (photoCount >= 2) {
          return `今日影低咗 ${photoCount} 張膳食相，睇得出你好用心照顧自己每一餐。呢份認真已經幫身體行前一大步！`;
        }
        if (intakePct && intakePct >= 90) {
          return `今日食量去到 ${intakePct}%，好值得欣賞！身體慢慢儲緊營養同材料，繼續保持呢個舒服嘅節奏。`;
        }
        const pool = [
          '多謝你今日又準時照顧好自己，每一步小堅持都真係算數。',
          '身體修復需要時間，你每日穩穩陣陣跟住做，已經做得好好。',
          '又儲多一顆星星！欣賞你一直無放棄、默默為自己累積力氣。',
          '每一日嘅紀錄都幫我哋更了解你嘅身體，你好抵讚！',
          '唔使急、唔使勉強，似今日咁穩步完成，已經係最好嘅進步。',
          '睇住你一日一日儲起呢啲星星，好欣賞你對自己健康嘅這份用心。'
        ];
        return pool[(dayNum + doneCount) % pool.length];
      }

      function computeTodayCompletion() {
        let pts = 0;
        const total = 8; // 5 products + 1 meal photo + weight + stool
        if (formState.enzymeMl > 0) pts++;
        if (formState.probioticDone) pts++;
        if (formState.gutDone) pts++;
        if (formState.astaDone) pts++;
        if (formState.q10Done) pts++;
        if (getTotalPhotosForRecord(formState) > 0) pts++;
        if (formState.weight) pts++;
        if (formState.stoolCount) pts++;
        return { pts, total, pct: Math.round((pts / total) * 100) };
      }

      function updateTopProgressUI() {
        const doneCount = getCompletedDaysCount();
        const pct = Math.min(100, Math.round((doneCount / 30) * 100));
        document.getElementById('top-progress-text').textContent = `⭐ 已完成 ${doneCount} / 30 天（累積 ${doneCount} 顆金星）`;
        document.getElementById('top-remaining-text').textContent = doneCount >= 30 ? '全部達標 🎉' : `仲有 ${30 - doneCount} 天`;
        document.getElementById('top-progress-pct').textContent = `${pct}%`;
        document.getElementById('top-progress-bar').style.width = `${pct}%`;

        const todayComp = computeTodayCompletion();
        document.getElementById('today-live-score').textContent = `今日進度 ${todayComp.pct}%`;
        const cheerTitle = document.getElementById('cheer-card-title');
        const topEnc = document.getElementById('top-encouragement');
        const photoCount = getTotalPhotosForRecord(formState);
        const prodDone = (formState.enzymeMl > 0 ? 1 : 0) + (formState.probioticDone ? 1 : 0) + (formState.gutDone ? 1 : 0) + (formState.astaDone ? 1 : 0) + (formState.q10Done ? 1 : 0);

        if (todayComp.pct >= 85) {
          cheerTitle.textContent = '好叻呀 Ms Lai！今日幾乎全部完成！';
          topEnc.textContent = `今日已經完成 ${prodDone}/5 款產品同上載咗 ${photoCount} 張膳食相，記住按下面「儲存今日紀錄」拎埋今日顆金星獎勵⭐！`;
        } else if (todayComp.pct > 0) {
          cheerTitle.textContent = '做得好好！已經開始咗今日嘅照顧';
          topEnc.textContent = `你已經完成咗今日 ${todayComp.pct}% 進度（${prodDone}/5 款產品、${photoCount} 張餐食相），慢慢嚟、唔使急，身體會感受到你呢份用心。`;
        } else if (doneCount === 0) {
          cheerTitle.textContent = 'Ms Lai，歡迎開始我哋嘅 30 天同行！';
          topEnc.textContent = '唔使有壓力，今日只要順手影低每一餐、跟住服用五品，晚上按「儲存今日紀錄」就會點亮第一顆金星⭐。';
        } else {
          cheerTitle.textContent = `你已經儲到 ${doneCount} 顆金星，非常值得欣賞！`;
          topEnc.textContent = '每一個平凡日子嘅小堅持，都係幫身體慢慢儲力氣同長肉嘅基礎，今日我哋繼續穩穩陣陣咁行。';
        }
      }

      function launchStarParticles() {
        const stage = document.getElementById('star-burst-stage');
        stage.querySelectorAll('.star-particle').forEach(el => el.remove());
        const mainStar = document.getElementById('reward-main-star');
        mainStar.classList.remove('star-hero');
        void mainStar.offsetWidth;
        mainStar.classList.add('star-hero');

        const icons = ['⭐', '✨', '🌟', '💛', '🎉', '⭐'];
        const count = 24;
        for (let i = 0; i < count; i++) {
          const p = document.createElement('span');
          p.className = 'star-particle text-xl sm:text-2xl';
          p.textContent = icons[i % icons.length];
          const angle = (Math.PI * 2 * i) / count + (Math.random() * 0.3 - 0.15);
          const dist = 58 + Math.random() * 48;
          const tx = Math.round(Math.cos(angle) * dist) + 'px';
          const ty = Math.round(Math.sin(angle) * dist - 10) + 'px';
          const rot = Math.round(Math.random() * 180 - 90) + 'deg';
          p.style.setProperty('--tx', tx);
          p.style.setProperty('--ty', ty);
          p.style.setProperty('--rot', rot);
          stage.appendChild(p);
        }
      }

      function showRewardModal(dayNum) {
        const doneCount = getCompletedDaysCount();
        const pct = Math.min(100, Math.round((doneCount / 30) * 100));
        const streak = getCurrentStreak();
        const photoCount = getTotalPhotosForRecord(formState);
        const msg = pickEncouragementMessage(dayNum, doneCount, photoCount, formState.intakePct);

        document.getElementById('reward-badge').textContent = `第 ${dayNum} 日打卡完成・獲得 1 顆星星 ⭐`;
        document.getElementById('reward-title').textContent = `做得好！已累積 ${doneCount} 顆同行金星`;
        document.getElementById('reward-message').textContent = msg;
        document.getElementById('reward-progress-label').textContent = `30天總進度：${doneCount} / 30 天`;
        document.getElementById('reward-progress-pct').textContent = `${pct}%`;
        document.getElementById('reward-streak-text').textContent =
          streak > 1 ? `已連續打卡 ${streak} 天，保持這個輕鬆穩定的節奏就很好！` : `每一次記錄都在為自己累積健康底氣，繼續加油！`;

        const bar = document.getElementById('reward-progress-bar');
        bar.style.width = '0%';
        document.getElementById('modal-reward').classList.remove('hidden');
        launchStarParticles();
        playCelebrationFanfare();
        setTimeout(() => { bar.style.width = `${pct}%`; }, 120);
      }

      function renderStarCalendarWall() {
        const grid = document.getElementById('star-calendar-grid');
        if (!grid) return;
        const doneCount = getCompletedDaysCount();
        const pct = Math.min(100, Math.round((doneCount / 30) * 100));
        document.getElementById('progress-star-count').textContent = `⭐ ${doneCount} / 30`;
        document.getElementById('progress-wall-bar').style.width = `${pct}%`;

        grid.innerHTML = '';
        const start = new Date(START_DATE + 'T00:00:00');
        for (let i = 0; i < 30; i++) {
          const d = new Date(start.getTime() + i * 86400000);
          const yyyy = d.getFullYear();
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          const dd = String(d.getDate()).padStart(2, '0');
          const dateStr = `${yyyy}-${mm}-${dd}`;
          const done = Boolean(records[dateStr]);

          const cell = document.createElement('button');
          cell.type = 'button';
          cell.className = done
            ? 'rounded-xl p-2 border border-amber-300 bg-amber-50 hover:bg-amber-100 flex flex-col items-center justify-center transition'
            : 'rounded-xl p-2 border border-slate-200 bg-slate-50 hover:bg-slate-100 flex flex-col items-center justify-center transition';
          cell.innerHTML = `
            <span class="text-[11px] font-semibold ${done ? 'text-amber-900' : 'text-slate-500'}">D${i + 1}</span>
            <span class="text-lg leading-tight my-0.5">${done ? '⭐' : '☆'}</span>
            <span class="text-[10px] ${done ? 'text-amber-700' : 'text-slate-400'}">${mm}/${dd}</span>
          `;
          cell.addEventListener('click', () => {
            loadDateToForm(dateStr);
            switchTab('today');
          });
          grid.appendChild(cell);
        }
      }

      function captureCurrentDay() {
        formState.weight = document.getElementById('input-weight').value.trim();
        formState.sbp = document.getElementById('input-sbp').value.trim();
        formState.dbp = document.getElementById('input-dbp').value.trim();
        formState.notes = document.getElementById('input-notes').value.trim();
        MEALS.forEach(m => { formState.meals[m.key].note = document.getElementById(`note-${m.key}`).value.trim(); });
        return JSON.parse(JSON.stringify(formState));
      }
      let cloudTimer = null;
      let cloudRevision = 0;
      let cloudSavedRevision = 0;
      let cloudPending = null;
      function markCloudDirty() { cloudRevision++; CLOUD.status('有新內容，正在準備儲存…'); }
      function scheduleCloudSave() {
        if (!CLOUD.ready || CLOUD.loading) return;
        markCloudDirty(); clearTimeout(cloudTimer);
        cloudTimer = setTimeout(() => saveCurrentDay(true), 1400);
      }
      async function saveCurrentDay(silent = false) {
        clearTimeout(cloudTimer);
        if (cloudPending) { const ok = await cloudPending; if (!ok) return false; }
        if (!CLOUD.ready || CLOUD.photosBusy) return false;
        const snapshot = captureCurrentDay(), sentRevision = cloudRevision;
        cloudPending = (async () => {
          try {
            await CLOUD.save(snapshot, savedReminder);
            records[snapshot.date] = snapshot;
            cloudSavedRevision = sentRevision;
            updateTopProgressUI();
            if (sentRevision === cloudRevision && !silent) showRewardModal(getDayNumber(snapshot.date));
            return true;
          } catch (error) { showToast(error.message); return false; }
          finally { cloudPending = null; }
        })().catch(error => { console.error("Preview connection failed"); const status = document.getElementById("cloud-status"); if (status) status.textContent = "預覽連線未完成，請重新登入後再試。"; });
        return cloudPending;
      }
      async function switchCloudDay(dateStr) {
        if (CLOUD.photosBusy || CLOUD.loading) { document.getElementById("input-date").value = formState.date; return; }
        if (cloudRevision !== cloudSavedRevision || cloudPending) {
          const ok = await saveCurrentDay(true);
          if (!ok) { document.getElementById('input-date').value = formState.date; return; }
        }
        CLOUD.loading = true; document.body.inert = true;
        try { await CLOUD.refreshDay(dateStr); loadDateToForm(dateStr); }
        catch(error) { showToast(error.message); document.getElementById('input-date').value = formState.date; }
        finally { CLOUD.loading = false; document.body.inert = false; }
      }

      document.getElementById('btn-save-day').addEventListener('click', () => { ensureAudioCtx(); saveCurrentDay(false); });

      document.getElementById('btn-copy-whatsapp').addEventListener('click', () => {
        saveCurrentDay(true);
        const d = formState;
        const dayNum = getDayNumber(d.date);
        const mealLines = MEALS.map(m => {
          const info = d.meals[m.key];
          const pCount = (info.photos || []).length;
          if (!info.note && pCount === 0) return null;
          return `  ${m.label}：${info.note || '已拍照'}${pCount ? `（${pCount}張相）` : ''}`;
        }).filter(Boolean);

        const bpText = d.sbp || d.dbp ? `${d.sbp || '--'}/${d.dbp || '--'} mmHg` : '未量';
        const lines = [
          `【Ms Lai 每日膳食與五品紀錄｜${d.date}（第${dayNum}日）】`,
          `• 五品：酵素 ${d.enzymeMl === null ? '未填' : d.enzymeMl + 'mL'}｜益生菌${d.probioticDone ? '✓' : '✕'}｜腸快適${d.gutDone ? '✓' : '✕'}｜蝦青素${d.astaDone ? '✓' : '✕'}｜Q10${d.q10Done ? '✓' : '✕'}`,
          `• 晨起體重：${d.weight ? d.weight + ' kg' : '未量'}｜血壓：${bpText}`,
          `• 食量：${d.intakePct ? d.intakePct + '%' : '未填'}｜餐後感受：${d.comfort || '未填'}`,
          `• 排便：${d.stoolCount || '未填'}｜${d.stoolType || '未填'}`,
          mealLines.length ? `• 今日膳食：\n${mealLines.join('\n')}` : '• 今日膳食：未填',
          d.notes ? `• 備註：${d.notes}` : ''
        ].filter(Boolean).join('\n');

        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(lines).then(() => {
            showToast('已複製今日摘要！可直接貼上 WhatsApp 傳給 Duncan');
          }).catch(() => fallbackCopy(lines));
        } else {
          fallbackCopy(lines);
        }
      });

      function fallbackCopy(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand('copy');
          showToast('已複製今日摘要！可直接貼上 WhatsApp 傳給 Duncan');
        } catch (e) {
          showToast('請手動截圖或匯出 CSV');
        }
        document.body.removeChild(ta);
      }

      // 分頁切換
      function switchTab(target) {
        ['today', 'history', 'progress'].forEach(t => {
          const btn = document.getElementById(`tab-${t}`);
          const view = document.getElementById(`view-${t}`);
          btn.classList.toggle('tab-active', t === target);
          btn.classList.toggle('tab-inactive', t !== target);
          view.classList.toggle('hidden', t !== target);
        });
        if (target === 'history') renderHistory();
        if (target === 'progress') renderProgress();
      }
      document.getElementById('tab-today').addEventListener('click', () => switchTab('today'));
      document.getElementById('tab-history').addEventListener('click', () => switchTab('history'));
      document.getElementById('tab-progress').addEventListener('click', () => switchTab('progress'));

      // 過往相簿與紀錄
      function renderHistory() {
        const listEl = document.getElementById('history-list');
        const keys = Object.keys(records).sort((a, b) => b.localeCompare(a));
        if (!keys.length) {
          listEl.innerHTML = `<div class="bg-white rounded-2xl p-6 text-center text-slate-500 border border-slate-200 text-sm">暫時未有已儲存的紀錄，請先在「今日打卡」拍照或填寫並儲存。</div>`;
          return;
        }
        listEl.innerHTML = '';
        keys.forEach(dateStr => {
          const r = records[dateStr];
          const dayNum = getDayNumber(dateStr);
          const card = document.createElement('div');
          card.className = 'bg-white rounded-2xl p-4 shadow-sm border border-slate-200 space-y-2.5';

          const top = document.createElement('div');
          top.className = 'flex items-center justify-between gap-2';
          top.innerHTML = `
            <div class="flex items-center gap-2">
              <span class="font-bold text-slate-800">${dateStr}</span>
              <span class="px-2 py-0.5 rounded-full text-xs font-semibold bg-teal-50 text-teal-800 border border-teal-200">第 ${dayNum} 日</span>
            </div>
            <button type="button" class="edit-day-btn px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-700">編輯／補拍</button>
          `;
          top.querySelector('.edit-day-btn').addEventListener('click', () => {
            loadDateToForm(dateStr);
            switchTab('today');
          });

          const escapeText = value => String(value || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
          const meta = document.createElement('div');
          meta.className = 'text-xs sm:text-sm text-slate-600 grid grid-cols-2 gap-1.5';
          meta.innerHTML = `
            <span>體重：<strong>${r.weight ? r.weight + ' kg' : '--'}</strong></span>
            <span>食量：<strong>${r.intakePct ? r.intakePct + '%' : '--'}</strong>（${escapeText(r.comfort) || '未填'}）</span>
            <span>排便：<strong>${escapeText(r.stoolCount) || '--'}</strong>（${escapeText(r.stoolType) || '--'}）</span>
            <span>血壓：<strong>${r.sbp ? r.sbp + '/' + (r.dbp || '--') : '--'}</strong></span>
          `;

          const prods = document.createElement('p');
          prods.className = 'text-xs text-teal-900 bg-teal-50/70 rounded-lg px-2.5 py-1.5';
          prods.textContent = `五品：酵素 ${r.enzymeMl ?? '--'}mL｜益生菌${r.probioticDone ? '✓' : '✕'}｜腸快適${r.gutDone ? '✓' : '✕'}｜蝦青素${r.astaDone ? '✓' : '✕'}｜Q10${r.q10Done ? '✓' : '✕'}`;

          card.appendChild(top);
          card.appendChild(meta);
          card.appendChild(prods);

          // 按餐次顯示相片與飲食文字
          MEALS.forEach(m => {
            const info = r.meals?.[m.key];
            if (!info || (!info.note && !(info.photos && info.photos.length))) return;
            const mBox = document.createElement('div');
            mBox.className = 'bg-slate-50 rounded-xl p-2.5 space-y-1.5 border border-slate-200/70';
            const title = document.createElement('p');
            title.className = 'text-xs font-semibold text-slate-700';
            title.textContent = `${m.label}：${info.note || '（相片紀錄）'}`;
            mBox.appendChild(title);

            if (info.photos && info.photos.length) {
              const pRow = document.createElement('div');
              pRow.className = 'flex gap-2 overflow-x-auto';
              info.photos.forEach(src => {
                const img = document.createElement('img');
                img.src = src;
                img.className = 'w-16 h-16 rounded-lg object-cover border border-slate-200 shrink-0 cursor-pointer';
                img.addEventListener('click', () => {
                  document.getElementById('modal-image-src').src = src;
                  document.getElementById('modal-image').classList.remove('hidden');
                });
                pRow.appendChild(img);
              });
              mBox.appendChild(pRow);
            }
            card.appendChild(mBox);
          });

          listEl.appendChild(card);
        });
      }

      // 匯出 CSV
      document.getElementById('btn-export-csv').addEventListener('click', () => {
        const keys = Object.keys(records).sort();
        if (!keys.length) {
          showToast('暫時沒有紀錄可以匯出');
          return;
        }
        const headers = ['天數', '日期', '酵素(mL)', '三效益生菌', '腸快適', '蝦青素', 'Q10', '早餐', '午餐', '營養奶/加餐', '晚餐', '食量(%)', '餐後感受', '排便次數', '排便狀態', '晨起體重(kg)', '上壓', '下壓', '相片總數', '備註'];
        const rows = keys.map(k => {
          const r = records[k];
          const esc = (v) => `"${String(v ?? '').replace(/^[=+@-]/, "'").replace(/"/g, '""')}"`;
          return [
            getDayNumber(k), k, r.enzymeMl ?? '', r.probioticDone ? '是' : '否', r.gutDone ? '是' : '否',
            r.astaDone ? '是' : '否', r.q10Done ? '是' : '否',
            r.meals?.breakfast?.note || '', r.meals?.lunch?.note || '', r.meals?.snack?.note || '', r.meals?.dinner?.note || '',
            r.intakePct || '', r.comfort || '', r.stoolCount || '', r.stoolType || '',
            r.weight || '', r.sbp || '', r.dbp || '', getTotalPhotosForRecord(r), r.notes || ''
          ].map(esc).join(',');
        });
        const csv = '\uFEFF' + [headers.join(','), ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Ms_Lai_30天五品與膳食紀錄_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('已匯出 CSV 總表');
      });

      // 30天進度與圖表
      function renderProgress() {
        renderStarCalendarWall();
        const keys = Object.keys(records).sort();
        const totalDays = keys.length;
        document.getElementById('kpi-days').textContent = `${totalDays} / 30`;

        const weights = keys.map(k => parseFloat(records[k].weight)).filter(v => !isNaN(v) && v > 0);
        if (weights.length) {
          const latest = weights[weights.length - 1];
          const diff = (latest - BASELINE_WEIGHT).toFixed(1);
          document.getElementById('kpi-weight').textContent = `${latest.toFixed(1)} kg`;
          document.getElementById('kpi-weight-diff').textContent = `較基線 ${diff > 0 ? '+' : ''}${diff} kg`;
        } else {
          document.getElementById('kpi-weight').textContent = '-- kg';
          document.getElementById('kpi-weight-diff').textContent = '基線 39.0 kg';
        }

        const intakes = keys.map(k => records[k].intakePct).filter(v => v !== null && !isNaN(v));
        document.getElementById('kpi-intake').textContent = intakes.length
          ? `${Math.round(intakes.reduce((a, b) => a + b, 0) / intakes.length)}%`
          : '--%';

        const totalPhotos = keys.reduce((sum, k) => sum + getTotalPhotosForRecord(records[k]), 0);
        document.getElementById('kpi-photos').textContent = `${totalPhotos} 張`;

        if (totalDays > 0) {
          let expected = 0;
          let done = 0;
          keys.forEach(k => {
            const r = records[k];
            expected += 5;
            if (r.enzymeMl > 0) done++;
            if (r.probioticDone) done++;
            if (r.gutDone) done++;
            if (r.astaDone) done++;
            if (r.q10Done) done++;
          });
          document.getElementById('kpi-products').textContent = `應服五品達成：${expected ? Math.round((done / expected) * 100) : 0}%`;
        } else {
          document.getElementById('kpi-products').textContent = '應服五品達成：--%';
        }

        const ctx = document.getElementById('progress-chart').getContext('2d');
        if (chartInstance) chartInstance.destroy();

        const labels = keys.length ? keys.map(k => k.slice(5)) : ['11-23 (基線)'];
        const weightSeries = keys.length ? keys.map(k => parseFloat(records[k].weight) || null) : [39.0];
        const intakeSeries = keys.length ? keys.map(k => records[k].intakePct || null) : [75];

        chartInstance = new Chart(ctx, {
          type: 'line',
          data: {
            labels,
            datasets: [
              {
                label: '晨起體重 (kg)',
                data: weightSeries,
                borderColor: '#0f766e',
                backgroundColor: 'rgba(15, 118, 110, 0.12)',
                yAxisID: 'yWeight',
                tension: 0.25,
                spanGaps: true,
                pointRadius: 4
              },
              {
                label: '食量比例 (%)',
                data: intakeSeries,
                borderColor: '#d97706',
                backgroundColor: 'rgba(217, 119, 6, 0.1)',
                yAxisID: 'yIntake',
                tension: 0.25,
                spanGaps: true,
                pointRadius: 4
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
              yWeight: {
                type: 'linear',
                position: 'left',
                title: { display: true, text: '體重 (kg)' },
                suggestedMin: 37,
                suggestedMax: 42
              },
              yIntake: {
                type: 'linear',
                position: 'right',
                title: { display: true, text: '食量 (%)' },
                min: 0,
                max: 110,
                grid: { drawOnChartArea: false }
              }
            }
          }
        });
      }

      // 提醒 Modal 與圖片 Modal
      document.getElementById('btn-open-reminder').addEventListener('click', () => {
        document.getElementById('modal-reminder').classList.remove('hidden');
      });
      document.getElementById('btn-close-reminder').addEventListener('click', () => {
        document.getElementById('modal-reminder').classList.add('hidden');
      });
      document.getElementById('btn-close-image').addEventListener('click', () => {
        document.getElementById('modal-image').classList.add('hidden');
      });
      document.getElementById('btn-close-reward').addEventListener('click', () => {
        document.getElementById('modal-reward').classList.add('hidden');
      });
      document.getElementById('btn-reward-copy').addEventListener('click', () => {
        document.getElementById('modal-reward').classList.add('hidden');
        document.getElementById('btn-copy-whatsapp').click();
      });

      function readReminderForm(markOnboarded = false) {
        const current = {
          morning: document.getElementById('input-morning-time').value || '08:00',
          evening: document.getElementById('input-evening-time').value || '20:30',
          phoneEnabled: document.getElementById('chk-phone-remind').checked,
          phone: document.getElementById('input-user-phone').value.trim(),
          emailEnabled: document.getElementById('chk-email-remind').checked,
          email: document.getElementById('input-user-email').value.trim(),
          tasksEnabled: document.getElementById('chk-tasks-remind').checked,
          onboarded: markOnboarded ? true : Boolean(savedReminder.onboarded)
        };
        savedReminder = current;
        saveStorage(REMINDER_KEY, current);
        updateReminderBadge(current);
        updateGoogleCalLinks(current.morning, current.evening);
        return current;
      }

      function updateGoogleCalLinks(mStr, eStr) {
        const mClean = (mStr || '08:00').replace(':', '') + '00';
        const eClean = (eStr || '20:30').replace(':', '') + '00';
        const mEnd = add15Min(mStr || '08:00').replace(':', '') + '00';
        const eEnd = add15Min(eStr || '20:30').replace(':', '') + '00';
        const mUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent('Ms Lai 早上打卡：體重＋早餐拍照＋酵素')}&details=${encodeURIComponent('打開 Ms Lai 每日網頁輸入晨起體重、拍早餐相並打卡五品。')}&dates=20261123T${mClean}/20261123T${mEnd}&ctz=Asia/Hong_Kong&recur=RRULE:FREQ=DAILY;COUNT=30`;
        const eUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent('Ms Lai 晚上打卡：晚餐拍照＋排便＋回報')}&details=${encodeURIComponent('打開 Ms Lai 每日網頁補齊晚餐相片、排便與食量，複製摘要傳給 Duncan。')}&dates=20261123T${eClean}/20261123T${eEnd}&ctz=Asia/Hong_Kong&recur=RRULE:FREQ=DAILY;COUNT=30`;
        document.getElementById('link-gcal-morning').href = mUrl;
        document.getElementById('link-gcal-evening').href = eUrl;
      }

      function add15Min(hhmm) {
        const [h, m] = hhmm.split(':').map(Number);
        const total = (h * 60 + m + 15) % (24 * 60);
        return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
      }

      function updateReminderBadge(rem) {
        document.getElementById('reminder-badge-text').textContent = `${rem.morning} / ${rem.evening}`;
      }

      document.getElementById('input-morning-time').addEventListener('change', () => readReminderForm(false));
      document.getElementById('input-evening-time').addEventListener('change', () => readReminderForm(false));

      document.getElementById('btn-save-onboarding').addEventListener('click', () => {
        const rem = readReminderForm(true);
        document.getElementById('onboarding-pill').textContent = '已設定自動提示';
        document.getElementById('modal-reminder').classList.add('hidden');
        const channels = [];
        if (rem.phoneEnabled) channels.push('手機');
        if (rem.emailEnabled) channels.push('電郵');
        if (rem.tasksEnabled) channels.push('Tasks');
        showToast(`已更新每日 ${rem.morning} / ${rem.evening} 自動提示（${channels.join('・') || '已記錄'}）`);
      });

      document.getElementById('btn-skip-onboarding').addEventListener('click', () => {
        readReminderForm(true);
        document.getElementById('modal-reminder').classList.add('hidden');
        showToast('可隨時按右上角「每日提醒」重新設定');
      });

      document.getElementById('btn-download-ics').addEventListener('click', () => {
        const mVal = document.getElementById('input-morning-time').value || '08:00';
        const eVal = document.getElementById('input-evening-time').value || '20:30';
        saveStorage(REMINDER_KEY, { morning: mVal, evening: eVal });
        updateReminderBadge({ morning: mVal, evening: eVal });

        const mTime = mVal.replace(':', '') + '00';
        const eTime = eVal.replace(':', '') + '00';
        const ics = [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'PRODID:-//MsLai//30DayMealTracker//ZH',
          'BEGIN:VEVENT',
          'UID:mslai-morning-v2@tracker',
          `DTSTART;TZID=Asia/Hong_Kong:20261123T${mTime}`,
          'RRULE:FREQ=DAILY;COUNT=30',
          'SUMMARY:量晨起體重＋拍早餐相＋飲酵素',
          'DESCRIPTION:打開 Ms Lai 每日網頁輸入體重、拍早餐相片並按階段打卡五品（益生菌與抗生素相隔2小時）。',
          'BEGIN:VALARM',
          'TRIGGER:PT0M',
          'ACTION:DISPLAY',
          'DESCRIPTION:Reminder',
          'END:VALARM',
          'END:VEVENT',
          'BEGIN:VEVENT',
          'UID:mslai-evening-v2@tracker',
          `DTSTART;TZID=Asia/Hong_Kong:20261123T${eTime}`,
          'RRULE:FREQ=DAILY;COUNT=30',
          'SUMMARY:拍晚餐相＋記排便與食量＋傳給 Duncan',
          'DESCRIPTION:打開 Ms Lai 每日網頁補齊今日三餐相片、排便與食量，按複製摘要傳給 Duncan。',
          'BEGIN:VALARM',
          'TRIGGER:PT0M',
          'ACTION:DISPLAY',
          'DESCRIPTION:Reminder',
          'END:VALARM',
          'END:VEVENT',
          'END:VCALENDAR'
        ].join('\r\n');

        const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'Ms_Lai_30天每餐拍照與五品提醒.ics';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('已下載行事曆檔，打開即可加入每日鬧鐘提醒');
      });

      document.getElementById('btn-enable-browser-notif').addEventListener('click', () => {
        const rem = {
          morning: document.getElementById('input-morning-time').value || '08:00',
          evening: document.getElementById('input-evening-time').value || '20:30'
        };
        saveStorage(REMINDER_KEY, rem);
        updateReminderBadge(rem);

        if ('Notification' in window) {
          Notification.requestPermission().then(perm => {
            if (perm === 'granted') {
              new Notification('Ms Lai 每日膳食拍照提醒已開啟', {
                body: `此頁開啟期間可提醒打卡；關閉頁面後請使用手機行事曆提醒。`
              });
              showToast('已更新提醒時間並發送測試通知');
            } else {
              showToast('已更新提醒時間（建議使用上方「加入手機行事曆」最穩定）');
            }
          });
        } else {
          showToast('已更新提醒時間（建議使用上方「加入手機行事曆」最穩定）');
        }
      });

      if (reminderTimer) clearInterval(reminderTimer);
      reminderTimer = setInterval(() => {
        const rem = loadStorage(REMINDER_KEY, { morning: '08:00', evening: '20:30' });
        const now = new Date();
        const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        if ((hhmm === rem.morning || hhmm === rem.evening) && now.getSeconds() < 10) {
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('Ms Lai 打卡時間到了', { body: '記得拍低今餐相片並記錄五品、體重與排便。' });
          } else {
            showToast('⏰ 記得拍低今餐相片並記錄今日五品與體重');
          }
        }
      }, 10000);

      CLOUD.ready = true;
      document.addEventListener('input', event => {
        if (event.target.closest('#modal-reminder')) return;
        if (event.target.matches('input,textarea,select') && event.target.type !== 'file' && event.target.id !== 'input-date') scheduleCloudSave();
      });
      document.addEventListener('click', event => {
        if (event.target.closest('.enzyme-btn,.intake-btn,.comfort-btn,.stool-count-btn,.stool-type-btn,#toggle-probiotic,#toggle-gut,#toggle-asta,#toggle-q10,#btn-weight-minus,#btn-weight-plus,[id^="grid-"] button')) scheduleCloudSave();
      });
      window.addEventListener('beforeunload', event => {
        if (cloudRevision !== cloudSavedRevision || CLOUD.photosBusy) { event.preventDefault(); event.returnValue = ''; }
      });
      window.addEventListener('online', () => { if (cloudRevision !== cloudSavedRevision) saveCurrentDay(true); });
      document.addEventListener('visibilitychange', () => { if (document.hidden && cloudRevision !== cloudSavedRevision) saveCurrentDay(true); });
      document.getElementById('cloud-backup').addEventListener('click', () => CLOUD.backup(captureCurrentDay()));
      document.getElementById('cloud-logout').addEventListener('click', async () => {
        if (CLOUD.photosBusy) return;
        if (cloudRevision !== cloudSavedRevision && !(await saveCurrentDay(true))) return;
        await CLOUD.logout();
      });
      loadDateToForm(formState.date);
      updateTopProgressUI();
      if (!savedReminder.onboarded) {
        document.getElementById('onboarding-pill').textContent = '首次使用設定（30秒完成）';
        document.getElementById('modal-reminder').classList.remove('hidden');
      } else {
        document.getElementById('onboarding-pill').textContent = '每日自動提示設定';
      }
    })().catch(error => { console.error("Preview connection failed"); const status = document.getElementById("cloud-status"); if (status) status.textContent = "預覽連線未完成，請重新登入後再試。"; });
