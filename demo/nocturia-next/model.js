/* Draft educational rules, not a diagnostic score. Each statement has answer evidence. */
window.HD = (() => {
  const questions = [
    { key:'frequency', title:'通常一晚，起身去幾多次廁所？', hint:'揀最接近你平時嘅情況。', clip:'02-frequency', options:['通常冇 / 偶爾先有','一次','兩至三次','四次或以上','唔肯定'] },
    { key:'waking', title:'係尿意叫醒你，定醒咗先去？', hint:'諗返最近一晚，邊個感覺行先？', clip:'03-waking', options:['尿意叫醒我','先醒咗，順便去','兩樣都有','唔肯定'] },
    { key:'volume', title:'夜晚每次，大概有幾多尿？', hint:'同日頭平時一次比較，講感覺就得。', clip:'04-volume', options:['差唔多，或者較多','明顯少好多','每次唔同','唔肯定'] },
    { key:'drinks', title:'瞓前兩三個鐘，通常飲啲乜？', hint:'冇啱錯，先睇時間同習慣。', clip:'05-drinks', options:['飲好多水或湯','茶、咖啡或酒','少量水，冇特別飲品','唔固定 / 唔肯定'] },
    { key:'other', title:'仲有邊啲情況一齊出現？', hint:'可以揀多項；冇留意過就揀「唔肯定」。', clip:'06-other', multi:true, options:['腳腫','打鼻鼾','有食利尿藥','尿流弱 / 排唔清 / 日頭尿急','冇留意到以上情況','唔肯定'] },
    { key:'safety', title:'最近有冇新出現嘅不適？', hint:'呢條幫你決定係繼續了解，定先搵醫護。', clip:'07-safety', options:['冇以下新不適','血尿 / 尿痛 / 發燒','想排但排唔到，或嚴重腹痛','唔肯定有冇新不適'] }
  ];
  const tags=['夜間次數','醒來先後','排尿感覺','飲水安排','其他情況','新不適'];
  const label=(a,i)=> Array.isArray(a[i]) ? a[i].map(v=>questions[i].options[v]).join('、') : questions[i].options[a[i]];
  const other=a=>Array.isArray(a[4])?a[4]:[];
  const hasOther=a=>other(a).some(v=>v<4);
  const fluid=a=>a[1]===0&&a[2]===0&&a[3]===0;
  function feedback(a,i) {
    const v=a[i];
    if(i===0) return ['已記低係偶爾先有。唔會單靠次數，將你當成有病。','已記低一晚一次。要唔要進一步了解，亦睇佢對你生活嘅影響。','已記低一晚兩至三次。下一步睇醒來先後，幫你分清線索。','已記低一晚四次或以上。如果持續困擾，值得同醫護傾；先了解其他回答。','唔使估。我哋將次數保留為未知，繼續睇你記得嘅感覺。'][v];
    if(i===1) return [`你話${label(a,0)}，而且係尿意先出現。次數講頻密程度，先後講經過；仍未知道原因。`,`你話${label(a,0)}，但係先醒咗再去。睡眠點樣中斷，值得一齊了解。`,`你話${label(a,0)}，兩種先後都有。唔會硬將每一晚歸成同一方向。`,'醒來先後暫時未知。後面會保留呢個缺口，唔會用預設補上。'][v];
    if(i===2) {
      if(v===3) return '未量過好正常。每次尿量暫時未知，唔會判定夜間尿量偏多。';
      if(a[1]===0&&v===0) return '尿意先醒，加上每次感覺唔少：值得了解夜間尿量同飲水時間。感覺仍然唔等於實際量度。';
      if(a[1]===1) return `先醒再去，加上「${label(a,2)}」。會將睡眠經過同排尿感覺分開理解，唔會直接叫你少飲水。`;
      if(v===1) return '每次明顯少，與每次大量排尿係唔同線索。之後亦要睇日頭有冇尿急或排唔清。';
      return `已記低「${label(a,2)}」，並連返「${label(a,1)}」。現階段唔適合只揀一個原因。`;
    }
    if(i===3) {
      if(fluid(a)) return '頭先係尿意先醒、每次又唔少；依家知道晚間飲水集中。呢三項放埋，支持先了解飲水時間，但仲未排除其他因素。';
      if(v===0) return `晚間飲得集中，但你之前講「${label(a,1)}」同「${label(a,2)}」。資料未足以將起夜全部歸因飲水。`;
      if(v===1) return `飲品種類同時間值得了解。連返「${label(a,1)}」，尿意同睡眠兩方面都要保留。`;
      if(v===2) return '你冇講晚間飲得集中，所以唔會將「飲水太多」當你嘅解釋。要繼續睇其他情況。';
      return '晚間習慣不固定，唔會當成穩定原因。前面嘅先後同尿量感覺仍然保留。';
    }
    if(i===4) {
      if(hasOther(a)) return `${label(a,4)}亦已記低。${fluid(a)?'即使有飲水時間線索，亦不能當成唯一解釋。':'呢啲資料需要分開向醫護核對。'}${other(a).includes(2)?'藥物唔好自行停用或改時間。':''}`;
      if(other(a).includes(5)) return '其他情況未清楚，所以仍有需要核對嘅地方。唔肯定唔會當成「冇」。';
      return '你暫時冇留意到呢啲情況；呢個回答可以保留，但唔等於已排除睡眠、用藥或其他健康因素。';
    }
    return ['六題已齊。你冇報告以上新不適；我哋會按你嘅回答整理線索，唔會當成已排除所有問題。','新血尿、尿痛或發燒應盡快求醫。呢個提醒免費，唔使等解鎖報告。','如果現在排唔到尿，或者有嚴重腹痛，請即時求醫，唔好等報告或 HMCS。','如果懷疑有新不適，先向醫護確認。資料未清楚時，唔推你付款。'][v];
  }
  function result(a) {
    if(a.length!==6 || questions.some((q,i)=> q.multi ? !Array.isArray(a[i])||!a[i].length||a[i].some(v=>!Number.isInteger(v)||v<0||v>=q.options.length)|| (a[i].some(v=>v>=4)&&a[i].length>1) : !Number.isInteger(a[i])||a[i]<0||a[i]>=q.options.length)) return {type:'incomplete',sell:false};
    if(a[5]!==0) return {type:'safety',sell:false,title:a[5]===2?'先處理排唔到尿或嚴重腹痛。':'先向醫護了解新不適。',intro:feedback(a,5)};
    if(a[0]===0) return {type:'limited',sell:false,title:'偶爾先有，先按需要了解。',intro:'你話通常冇或偶爾先有。未了解持續時間同生活影響，唔適合推你購買一份成因解讀。'};
    if(hasOther(a)) return {type:'review',sell:false,title:'呢組資料，先同醫護核對。',intro:`你亦提到${label(a,4)}。${fluid(a)?'飲水時間仍係線索，但唔足以解釋全部。':''}先核對相關情況，比直接買一份自動解讀更合適。`};
    if(fluid(a)) return {type:'fluid',sell:true,title:'飲水時間，值得放埋一齊睇。',intro:`你提供嘅夜間次數係「${label(a,0)}」、尿意先醒、每次感覺唔少，而且晚間飲水集中。呢組回答支持先了解飲水安排；未能確定夜間實際尿量，亦唔代表唯一原因。`,unknown:'飲水時間有幾大影響？定係睡眠、用藥等因素仍有份？',why:'晚間飲得集中，可能增加夜間需要排出嘅尿；你嘅先後同尿量感覺提供相符線索。呢個係值得了解嘅關聯，未經量度，唔代表已證明因果。',next:'如果冇醫護指定飲水安排，可先了解將飲水分散到日間、避免瞓前一次飲好多是否適合你。唔係叫你全日少飲水；唔好缺水或自行改藥。',contrast:'你冇選「先醒咗，順便去」，亦冇選「每次明顯少」。所以目前先談飲水安排有回答依據；但呢兩個回答不能排除睡眠或排尿問題。'};
    if(a[1]===1 && a[2]!==3 && a[3]!==3) return {type:'sleep',sell:true,title:'先醒，再去：經過值得拆開睇。',intro:`你提供嘅夜間次數係「${label(a,0)}」，係先醒咗再去，排尿感覺係「${label(a,2)}」。所以唔適合一開始就將每次醒來都歸因尿意。`,unknown:'係甚麼先令你醒？排尿同飲品習慣又有冇一齊影響？',why:'你提供嘅係先後線索：先醒、再排尿。睡眠被打斷同夜間排尿可能同時存在；呢個先後不能證明係失眠，亦不能排除泌尿問題。',next:'如果持續影響睡眠或日間生活，向醫護描述「先醒再去」同排尿感覺，一齊了解睡眠與泌尿情況；唔好單靠次數自行減水或買產品。',contrast:`你嘅飲水回答係「${label(a,3)}」。${a[3]===0?'晚間飲得集中仍值得核對，但先醒再去令「尿意叫醒你」呢條解釋未有支持。':a[3]===1?'茶、咖啡或酒可能同尿意或睡眠有關，現有資料未分清飲品種類同份量。':'你冇報告飲水集中，單靠現有資料不能將飲水太多當主要解釋。'}`};
    return {type:'limited',sell:false,title:'有線索，但未足夠解開。',intro:`已記低「${label(a,1)}」、「${label(a,2)}」同「${label(a,3)}」。${a[1]===2?'你嘅情況有不同先後，應分開了解。':'呢組回答未有足夠依據去提供完整個人方向。'}我哋先免費整理，唔推解鎖。`};
  }
  return {questions,tags,label,feedback,result,fluid,hasOther,other};
})();
