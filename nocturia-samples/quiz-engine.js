/* Sample-only nocturia flow. No payment, no network, no WhatsApp. */
(function (global) {
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function start(cfg) {
    var quiz = global.NOCTURIA_QUIZ;
    var root = document.getElementById("app");
    var answers = {};
    var step = "welcome";
    var qIndex = 0;
    var stickToResponse = false;

    function scriptText(key, label) {
      var raw = (cfg.scripts && cfg.scripts[key]) || "";
      return raw.replace(/\{\{方向\}\}/g, label || "你嘅方向");
    }

    function slot(slotId, scriptKey, place, label) {
      var text = scriptText(scriptKey, label);
      return (
        '<div class="slot" data-slot="' + esc(slotId) + '">' +
          '<p class="slot-kicker">' + esc(cfg.formatLabel) + "位・" + esc(place) + "</p>" +
          '<button type="button" class="slot-btn" data-reveal="' + esc(slotId) + '" aria-expanded="false">' +
            esc(cfg.buttonLabel) +
          "</button>" +
          '<div class="slot-script" id="script-' + esc(slotId) + '" hidden>' +
            '<p class="draft-tag">草稿・待 Duncan 批</p>' +
            '<p class="script-text">「' + esc(text) + '」</p>' +
          "</div>" +
        "</div>"
      );
    }

    function progress(done) {
      var pct = Math.round((done / quiz.questions.length) * 100);
      return (
        '<div class="progress" aria-hidden="true"><span style="width:' + pct + '%"></span></div>' +
        '<p class="step-label">第 ' + done + " 題，共 " + quiz.questions.length + " 題</p>"
      );
    }

    function renderWelcome() {
      root.innerHTML =
        '<section class="card">' +
          progress(0).replace("第 0 題，共 6 題", "未開始・共 6 題") +
          "<h1>" + esc(cfg.welcomeTitle) + "</h1>" +
          '<p class="sub">' + esc(cfg.welcomeSub) + "</p>" +
          slot("welcome", "welcome", "歡迎畫面，開始按鈕上面") +
          '<button type="button" class="primary" data-go="q">開始，第 1 題</button>' +
          '<p class="fine">六條都係揀一句。答完先同你講個大概，再先到解鎖。樣本頁，未上線。</p>' +
        "</section>";
    }

    function renderQuestion() {
      var q = quiz.questions[qIndex];
      var selected = answers[q.id];
      var optHtml = q.options.map(function (opt) {
        var on = selected === opt.id ? " selected" : "";
        var danger = opt.red ? " danger-opt" : "";
        return (
          '<button type="button" class="choice' + on + danger + '" data-pick="' + esc(q.id) + ":" + esc(opt.id) + '" aria-pressed="' + (on ? "true" : "false") + '">' +
            esc(opt.label) +
          "</button>"
        );
      }).join("");

      var picked = null;
      if (selected) {
        for (var i = 0; i < q.options.length; i++) {
          if (q.options[i].id === selected) picked = q.options[i];
        }
      }

      var after = "";
      if (picked) {
        var warn = "";
        if (picked.red) {
          warn =
            '<div class="flag-box" role="alert">' +
              "<strong>" + esc(quiz.warningTitle) + "</strong>" +
              "<p>" + esc(quiz.warningBody) + "</p>" +
            "</div>";
        }
        var nextLabel = qIndex === quiz.questions.length - 1 ? "睇我嘅方向" : "下一題";
        if (picked.red) nextLabel = "我知道，繼續睇參考";
        after =
          warn +
          slot("after-" + q.id, q.id + "." + picked.id, "第 " + (qIndex + 1) + " 題答完之後") +
          '<button type="button" class="primary" data-go="next">' + esc(nextLabel) + "</button>";
      }

      var safety = q.safety
        ? '<div class="safety-note"><strong>安全題</strong>　有下面情況，請先睇醫生。揀完仍然可以繼續。</div>'
        : "";

      root.innerHTML =
        '<section class="card">' +
          progress(qIndex + 1) +
          safety +
          "<h1>" + esc(q.title) + "</h1>" +
          '<p class="sub">' + esc(q.hint) + "</p>" +
          '<div class="choices">' + optHtml + "</div>" +
          after +
          (qIndex > 0 ? '<button type="button" class="ghost" data-go="back">上一題</button>' : '<button type="button" class="ghost" data-go="welcome">返回歡迎</button>') +
        "</section>";
    }

    function renderResult() {
      var summary = quiz.summarize(answers);
      var warn = summary.redFlag
        ? '<div class="flag-box" role="alert"><strong>' + esc(quiz.warningTitle) + "</strong><p>" + esc(quiz.warningBody) + "</p></div>"
        : "";
      root.innerHTML =
        '<section class="card">' +
          '<div class="progress" aria-hidden="true"><span style="width:100%"></span></div>' +
          "<h1>" + esc(cfg.resultTitle) + "</h1>" +
          '<p class="sub">只供參考・完整內容未解鎖</p>' +
          warn +
          '<p class="result-label">你比較似：' + esc(summary.label) + "</p>" +
          '<p class="blurb">' + esc(summary.blurb) + "</p>" +
          slot("anticipation", "anticipation", "解鎖之前，方向預告下面", summary.label) +
          '<div class="tease">' +
            "<h2>完整報告會有呢三樣</h2>" +
            "<ol>" +
              "<li><strong>可能係點</strong><span>用你嘅方向，寫清楚而家最值得留意嘅感覺。</span><span class=\"mask\">詳細句子解鎖先顯示</span></li>" +
              "<li><strong>點解會咁</strong><span>用日常說話講，點解晚上會想去。</span><span class=\"mask\">詳細句子解鎖先顯示</span></li>" +
              "<li><strong>而家可以試</strong><span>幾件生活上可以試嘅小事，同埋邊啲情況要先問醫生。</span><span class=\"mask\">具體做法解鎖先顯示</span></li>" +
            "</ol>" +
          "</div>" +
          '<div class="unlock">' +
            "<h2>想睇完整報告</h2>" +
            '<p class="unlock-lead">一按信用卡解鎖。付款時先填名、電話同電郵。</p>' +
            '<p class="price">價錢待定</p>' +
            '<p class="price-note">正式價錢未定。樣本頁唔會寫死一個價錢。</p>' +
            '<form id="pay-form" action="#" method="post">' +
              '<label>你嘅名<input name="name" type="text" autocomplete="name" placeholder="你想點稱呼你" /></label>' +
              '<label>電話<input name="phone" type="tel" autocomplete="tel" inputmode="tel" placeholder="例如 9xxxxxxx" /></label>' +
              '<label>電郵<input name="email" type="email" autocomplete="email" inputmode="email" placeholder="例如 name@email.com" /></label>' +
              '<button type="button" class="primary pay" id="pay-btn">樣本：一按信用卡解鎖（未接通）</button>' +
            "</form>" +
            '<p class="pay-hint" id="pay-msg" role="status" hidden></p>' +
            '<p class="fine">撳上面唔會扣錢，亦未接通信用卡。資料只留喺你部電話，呢頁唔會送去任何地方。</p>' +
          "</div>" +
          '<button type="button" class="ghost" data-go="restart">由頭再測</button>' +
        "</section>";

      var payBtn = document.getElementById("pay-btn");
      var payMsg = document.getElementById("pay-msg");
      var form = document.getElementById("pay-form");
      form.addEventListener("submit", function (e) { e.preventDefault(); });
      payBtn.addEventListener("click", function () {
        payMsg.hidden = false;
        payMsg.textContent = "呢個係樣本按鈕，未接通信用卡。唔會扣錢，亦唔會儲起你填嘅名、電話同電郵。";
      });
    }

    function render() {
      if (step === "welcome") renderWelcome();
      else if (step === "q") renderQuestion();
      else renderResult();
      if (stickToResponse) {
        var anchor = root.querySelector(".flag-box, .slot");
        if (anchor) anchor.scrollIntoView({ block: "start" });
        stickToResponse = false;
      } else {
        global.scrollTo(0, 0);
      }
    }

    root.addEventListener("click", function (e) {
      var reveal = e.target.closest("[data-reveal]");
      if (reveal) {
        var id = reveal.getAttribute("data-reveal");
        var panel = document.getElementById("script-" + id);
        if (!panel) return;
        var open = panel.hasAttribute("hidden");
        if (open) panel.removeAttribute("hidden");
        else panel.setAttribute("hidden", "");
        reveal.setAttribute("aria-expanded", open ? "true" : "false");
        return;
      }
      var pick = e.target.closest("[data-pick]");
      if (pick) {
        var parts = pick.getAttribute("data-pick").split(":");
        answers[parts[0]] = parts[1];
        stickToResponse = true;
        render();
        return;
      }
      var go = e.target.closest("[data-go]");
      if (!go) return;
      var action = go.getAttribute("data-go");
      if (action === "q") {
        step = "q";
        qIndex = 0;
      } else if (action === "welcome") {
        step = "welcome";
      } else if (action === "back") {
        qIndex = Math.max(0, qIndex - 1);
      } else if (action === "next") {
        if (qIndex < quiz.questions.length - 1) qIndex += 1;
        else step = "result";
      } else if (action === "restart") {
        answers = {};
        step = "welcome";
        qIndex = 0;
      }
      render();
    });

    render();
  }

  global.NocturiaSample = { start: start };
})(window);
