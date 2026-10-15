/* Shared nocturia sample quiz.
   Question wording follows nocturia-elder-simple, split back toward the
   six dimensions on the main nocturia page. Both sample versions must
   use this file so the question set stays identical. */
(function (global) {
  var QUESTIONS = [
    {
      id: "q1",
      title: "一晚大概起幾多次？",
      hint: "揀一個最似嘅",
      options: [
        { id: "once", label: "大約 1 次" },
        { id: "few", label: "大約 2 至 3 次" },
        { id: "many", label: "4 次或更多" },
        { id: "unsure", label: "唔記得／唔肯定" }
      ]
    },
    {
      id: "q2",
      title: "起身嗰陣，尿係點？",
      hint: "揀最似嗰句",
      options: [
        { id: "lots", label: "好多，又好急" },
        { id: "little", label: "好少，但好急" },
        { id: "wait", label: "要等一陣先出到" },
        { id: "incidental", label: "唔急，醒咗先去" }
      ]
    },
    {
      id: "q3",
      title: "傍晚對腳係點？",
      hint: "揀最似嗰句",
      options: [
        { id: "edema", label: "腳腫、鞋好緊" },
        { id: "weak", label: "好少行路、腳軟" },
        { id: "both", label: "兩樣都有少少" },
        { id: "none", label: "都冇呢啲情況" }
      ]
    },
    {
      id: "q4",
      title: "小便順唔順？",
      hint: "揀最似嗰句",
      options: [
        { id: "slow", label: "要等、線幼、斷斷續續" },
        { id: "residual", label: "尿完覺得未清" },
        { id: "urge", label: "好急，忍唔住" },
        { id: "ok", label: "都算順" }
      ]
    },
    {
      id: "q5",
      title: "日頭同瞓覺，邊樣最似？",
      hint: "揀最似嗰句",
      options: [
        { id: "thirst", label: "日頭好口乾、飲好多水" },
        { id: "sleep", label: "打鼾、瞓得淺、易醒" },
        { id: "both", label: "兩樣都有少少" },
        { id: "none", label: "都唔係" }
      ]
    },
    {
      id: "q6",
      title: "有冇呢啲情況？",
      hint: "安全題。有就揀；冇就揀最後一句",
      safety: true,
      options: [
        { id: "leg", label: "一隻腳突然腫痛、行唔到", red: true },
        { id: "blood", label: "冇尿、尿有血、或者發燒", red: true },
        { id: "chest", label: "胸口痛、好難呼吸、半邊身冇力", red: true },
        { id: "none", label: "以上都冇" }
      ]
    }
  ];

  var BLURBS = {
    "腳腫多": "傍晚腳容易腫。瞓低之後，晚上可能會想去多幾次。",
    "行路少": "日頭行得少、腳軟，夜晚可能會起多啲。",
    "小便唔順": "你覺得出尿要等、未清，或者好急。呢個只係你講嘅感覺。",
    "口乾多飲": "日頭口乾飲得多，晚上都可能起多啲。",
    "瞓得唔穩": "瞓得淺、易醒。醒咗先去廁所，會睇落似起身好密。",
    "尿多又急": "你覺得尿多，而且急。",
    "尿少但急": "你覺得尿少，但好急。",
    "醒咗先去": "你多數係醒咗先去，尿意唔算急。",
    "幾樣都有": "你講嘅情況有幾樣一齊出現，好常見。",
    "暫時未見到明顯方向": "你嘅答案未指向一個特別方向。報告會如實講你答過嘅每項。"
  };

  function summarize(answers) {
    var signals = [];
    function add(name) {
      if (signals.indexOf(name) === -1) signals.push(name);
    }
    if (answers.q3 === "edema") add("腳腫多");
    if (answers.q3 === "weak") add("行路少");
    if (answers.q3 === "both") {
      add("腳腫多");
      add("行路少");
    }
    if (answers.q4 === "slow" || answers.q4 === "residual" || answers.q4 === "urge") add("小便唔順");
    if (answers.q5 === "thirst") add("口乾多飲");
    if (answers.q5 === "sleep") add("瞓得唔穩");
    if (answers.q5 === "both") {
      add("口乾多飲");
      add("瞓得唔穩");
    }

    var label;
    if (signals.length === 1) label = signals[0];
    else if (signals.length > 1) label = "幾樣都有";
    else if (answers.q2 === "lots") label = "尿多又急";
    else if (answers.q2 === "little") label = "尿少但急";
    else if (answers.q2 === "wait") label = "小便唔順";
    else if (answers.q2 === "incidental") label = "醒咗先去";
    else label = "暫時未見到明顯方向";

    var q6 = QUESTIONS[5];
    var picked = null;
    for (var i = 0; i < q6.options.length; i++) {
      if (q6.options[i].id === answers.q6) picked = q6.options[i];
    }
    return {
      label: label,
      blurb: BLURBS[label] || BLURBS["幾樣都有"],
      redFlag: !!(picked && picked.red)
    };
  }

  global.NOCTURIA_QUIZ = {
    questions: QUESTIONS,
    warningTitle: "請盡快睇醫生或急症",
    warningBody: "網上自測唔可以代替醫生。你可以繼續睇參考方向，但請你第一時間求醫。",
    summarize: summarize
  };
})(window);
