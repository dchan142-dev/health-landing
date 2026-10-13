const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const s={stage:'welcome',q:0,answers:[],replied:false,paid:false,chapter:0,mode:'after',hna:{},hi:0,hnaContext:'booking',sample:'',returnStage:'welcome',auto:false,booking:{}};
let clips={},currentClip='';
fetch('clips.json').then(r=>r.json()).then(data=>{clips=data;media(currentClip);}).catch(()=>{$('mediaNote').textContent='參考稿暫時未載入，仍可直接作答。';});
const b=(label,act,cls='primary')=>`<button class="${cls}" data-act="${act}">${label}</button>`;
const actions=(...items)=>`<div class="actions">${items.join('')}</div>`;
const card=(title,content,cls='')=>`<div class="card ${cls}"><h2>${title}</h2>${content}</div>`;
const dataRows=()=>HD.questions.map((q,i)=>`<div class="data-row"><small>${i+1} · ${HD.tags[i]}</small>${esc(HD.label(s.answers,i)||'未回答')}<br><button class="text" data-edit="${i}">修改呢個答案</button></div>`).join('');
const chips=(until=s.q)=>`<div class="connected">${s.answers.slice(0,until+1).map((a,i)=>`<span class="chip"><small>${HD.tags[i]}</small>${esc(HD.label(s.answers,i))}</span>`).join('')}</div>`;
const sources=()=>`<details class="source-links"><summary>解讀依據與限制</summary><p>呢個係按回答整理嘅教育性示例，唔係已驗證嘅診斷工具。先後及尿量感覺用作線索，不能證明成因。</p><a href="https://patients.uroweb.org/wp-content/uploads/2023/09/Nocturia_FINAL_22Sept23-2.pdf" target="_blank" rel="noopener">EAU：夜尿、相關因素與評估</a><a href="https://patients.uroweb.org/condition/nocturia/treatment-options/self-management-of-nocturia-symptoms" target="_blank" rel="noopener">EAU：飲水時間、飲品與生活安排</a><a href="https://patients.uroweb.org/condition/nocturia/treatment-options/bladder-diary-for-nocturia" target="_blank" rel="noopener">EAU：量度資料點樣幫助評估</a><a href="https://www.niddk.nih.gov/health-information/urologic-diseases/urinary-retention/symptoms-causes" target="_blank" rel="noopener">NIDDK：排唔到尿的求醫提醒</a><a href="https://www.nhs.uk/symptoms/blood-in-urine/" target="_blank" rel="noopener">NHS：血尿的求醫提醒</a><p class="small">已於 2026-10-10 核對相關來源；新題目、解讀規則、產品資料仍需逐項正式審核。</p></details>`;
const dimensions=['精神與日間活力','飲食與消化感受','睡眠與壓力感受','活動與肢體能力','自我照顧的信心'];
function select(id,label,values){return `<label for="${id}">${label}</label><select id="${id}" data-hna><option value="">請選擇，冇預設答案</option>${values.map(v=>`<option${s.hna[id]===v?' selected':''}>${esc(v)}</option>`).join('')}</select>`;}
function textField(id,label){return `<label for="${id}">${label}（選填）</label><textarea id="${id}" data-hna maxlength="500">${esc(s.hna[id])}</textarea>`;}
function media(id){
  const v=$('video');const valid=!!id;document.body.classList.toggle('no-clip',!valid);
  $('play').hidden=!valid;$('transcript').hidden=!valid;$('video').hidden=!valid;$('still').hidden=valid;
  $('guide').querySelector('.eyebrow').textContent=valid?'Duncan · 本人預錄引導':'Duncan 封面 · 自動文字回應';
  $('guideTitle').textContent=clips[id]?.title||(valid?'聽短片，或者直接揀答案。':s.stage==='quiz'?'你嘅回答，逐步連起來。':'按你嘅回答，繼續拆解。');
  $('script').textContent=clips[id]?.script||'參考稿載入中。';
  $('mediaNote').textContent=valid?'可以直接作答，唔使等播完。':'自動文字解讀；此步驟未有新片。';
  if(id===currentClip&&v.getAttribute('src'))return;
  v.pause();$('play').textContent='▶ 播放本段';currentClip=id;
  if(valid){v.poster=`media/${id}.jpg`;v.src=`media/${id}.mp4`;if(s.auto)v.play().catch(()=>{});}
  else {v.removeAttribute('src');v.load();}
}
$('video').addEventListener('error',()=>{$('mediaNote').textContent='短片暫時未能播放。你仍可以睇文字同直接作答。';});
$('video').addEventListener('play',()=>{$('play').textContent='Ⅱ 暫停本段';});
$('video').addEventListener('pause',()=>{$('play').textContent='▶ 播放 / 重播';});
$('play').addEventListener('click',()=>{const v=$('video');v.paused?v.play().catch(()=>{$('mediaNote').textContent='播放未成功，可直接睇文字。';}):v.pause();});
function go(stage){s.stage=stage;render();window.scrollTo({top:0,behavior:'instant'});}
function question(i){s.q=i;s.replied=false;go('quiz');}
function reset(){Object.assign(s,{stage:'welcome',q:0,answers:[],replied:false,paid:false,chapter:0,hna:{},hi:0,sample:'',returnStage:'welcome',booking:{}});render();window.scrollTo(0,0);}
function invalidate(){s.paid=false;s.chapter=0;s.hna.confirmed=false;}
function hnaScreen(){
  if(s.hi===0)return `<h1>你最想改變嘅，係生活邊部分？</h1><p class="lead">六題答案已沿用。呢度先陪你釐清需要。</p>${select('goal','你目前最重視甚麼？',['夜晚休息好啲','日頭精神好啲','活動自在啲','照顧自己更有信心','其他目標，想再傾','仲未諗清楚'])}${textField('meaning','改善咗，對你有咩意義？')}<p class="small">例如想有精神陪家人。唔需要揀系統認為最好嘅答案。</p>`;
  if(s.hi===1)return `<h1>了解你而家嘅生活背景。</h1><div class="note">你已講過：${esc(HD.label(s.answers,0))}、${esc(HD.label(s.answers,1))}。唔使重填。</div>${select('sleep','通常每晚大約瞓幾耐？',['少於五小時','五至七小時','七小時以上','唔肯定'])}${select('routine','日常活動最接近邊種？',['大部分時間坐住','有日常步行或活動','有規律運動','情況不固定 / 唔肯定'])}${select('meds','有冇固定用藥或補充品？',['有，願意稍後核對','冇','唔肯定'])}${textField('context','有冇健康背景或生活限制想補充？')}<p class="small">Demo 請用假資料。具體藥名及健康資料正式服務另作核對；唔好自行改藥。</p>`;
  if(s.hi>=2&&s.hi<=6){let d=s.hi-2;return `<p class="eyebrow">五個生活面向 · ${d+1} / 5</p><h1>${dimensions[d]}</h1><p class="lead">先了解你點睇現況，再了解想去到邊。</p>${select('now'+d,'目前感受 · 1 低 / 10 高',[...Array.from({length:10},(_,i)=>String(i+1)),'未能評分'])}${select('wish'+d,'希望達到 · 1 低 / 10 高',[...Array.from({length:10},(_,i)=>String(i+1)),'想先討論'])}${textField('why'+d,'呢個期望對你有咩意思？')}<div class="note">係你嘅主觀感受與期望，唔係疾病分數。差距唔會轉成風險或購買需要。</div>`;}
  if(s.hi===7)return `<h1>用咩步調，先適合你？</h1>${select('pace','希望點樣開始？',['先理解，再決定','想盡快了解可行安排','要配合家庭或工作','想同顧問商量'])}${select('help','你目前想要咩協助？',['先自己了解選擇','希望有人一齊梳理','先加入群組慢慢了解','未決定'])}${select('willing','目前願意投入到邊一步？',['先了解資料','願意了解需另議費用的服務','想先了解所需時間與投入','未能決定'])}${textField('limits','有咩安排暫時做唔到，或唔希望？')}`;
  return `<h1>邊種安排值得一齊討論？</h1><p class="lead">先講偏好，具體方案同費用未確定。</p>${select('plan','目前想先了解甚麼？',['生活安排與自我管理','營養與相關產品資料','顧問協助與跟進方式','幾種選擇一齊比較','未知道，想先梳理'])}${textField('questions','有咩要先問清楚，先能作決定？')}<p class="small">冇預選方案。呢度唔會要求你同意未知費用、產品或服務。</p>`;
}
function needsSummary(){return `<div class="card tint"><h2>你想要嘅改變</h2><p>${esc(s.hna.goal||'尚未整理')}</p>${s.hna.meaning?`<p>因為你重視：${esc(s.hna.meaning)}</p>`:''}<p>步調：${esc(s.hna.pace||'未決定')}<br>協助：${esc(s.hna.help||'未決定')}</p></div>${dimensions.map((d,i)=>`<div class="data-row"><small>${d} · 主觀自評</small>目前 ${esc(s.hna['now'+i]||'未填')} → 希望 ${esc(s.hna['wish'+i]||'未填')}${s.hna['why'+i]?`<p>${esc(s.hna['why'+i])}</p>`:''}</div>`).join('')}<div class="card"><h3>要一齊核對嘅背景與安排</h3><p>睡眠：${esc(s.hna.sleep)}<br>活動：${esc(s.hna.routine)}<br>用藥／補充品：${esc(s.hna.meds)}</p>${s.hna.context?`<p>${esc(s.hna.context)}</p>`:''}<p>投入意願：${esc(s.hna.willing)}<br>希望了解：${esc(s.hna.plan)}</p>${s.hna.limits?`<p>限制：${esc(s.hna.limits)}</p>`:''}${s.hna.questions?`<p>想問清楚：${esc(s.hna.questions)}</p>`:''}</div>`;}
function render(){
  let h='',clip='',phase='由你嘅一晚開始';const r=HD.result(s.answers);let q=HD.questions[s.q];
  document.body.classList.toggle('answered',s.stage==='quiz'&&s.replied);
  document.body.classList.toggle('quizzing',s.stage==='quiz');
  $('modeLabel').textContent=`目前：${s.mode==='before'?'A · 付款前梳理':'B · 了解 HMCS 時梳理'}。只是比較，未定案。`;
  $('progress').innerHTML=s.stage==='quiz'?`<div class="progress">${HD.questions.map((_,i)=>`<i class="${i<s.q+(s.replied?1:0)?'on':''}"></i>`).join('')}</div>`:'';
  $('phase').parentElement.querySelector('[data-act="pause"]').hidden=['pause','safetyInfo','done'].includes(s.stage);
  if(s.stage==='welcome'){
    clip='01-welcome';h=`<p class="eyebrow">夜尿 · 六題初步線索</p><h1>夜晚成日起身，<br>想了解點解。</h1><p class="lead">由你真實嘅一晚開始。<br>逐題揀，我哋逐步睇線索。</p><div class="note">初步線索同求醫提醒免費。<br>適合嘅情況，先介紹完整自動解讀。</div>${actions(b('開始了解我嘅情況 →','start'))}<p class="small">短片可手動播放，唔使睇完先答。今次係體驗版，付款、商店及預約只作示範。</p>`;
  }
  if(s.stage==='quiz'){
    clip=s.replied?'':q.clip;phase=`六題初步線索 · ${s.q+1} / 6${s.sample?' · 示例答案':''}`;
    if(s.replied&&s.q===1&&s.answers[1]===1)clip='15-sleep-reply';
    if(s.replied&&s.q===5&&[1,2].includes(s.answers[5]))clip='16-safety-reply';
    h=`<h1>${q.title}</h1>`;
    if(s.replied){h+=`<div class="reply"><p class="answer">你揀咗：${esc(HD.label(s.answers,s.q))}</p><p>${esc(HD.feedback(s.answers,s.q))}</p></div>${s.q>=2?`<details><summary>睇累積線索 · ${s.q+1} 項</summary>${chips()}</details>`:''}${actions(b(s.q===5?'睇我嘅初步線索 →':'繼續下一題 →','next'),b('改返呢個答案','change','quiet'))}`;}
    else {h+=`<p class="lead">${q.hint}</p><div class="options">${q.options.map((v,i)=>{const chosen=q.multi?(s.answers[s.q]||[]).includes(i):s.answers[s.q]===i;return `<button data-answer="${i}" class="${chosen?'selected':''}" aria-pressed="${chosen}"><span>${esc(v)}</span><span class="circle" aria-hidden="true">${chosen?'✓':''}</span></button>`;}).join('')}</div>${q.multi||s.answers[s.q]!==undefined?actions(b(q.multi?'確認呢幾項 →':'沿用呢個答案 →','confirm')):''}<p class="error" id="error" role="alert"></p>`;}
    if(s.q)h+=b('← 返回上一題','back','quiet');
  }
  if(s.stage==='preview'){
    phase='你嘅初步線索 · 免費';
    if(r.type==='incomplete'){h=`<h1>仲有資料未齊。</h1>${actions(b('返回六題','quiz'))}`;}
    else if(r.type==='safety'){clip=s.answers[5]===3?'':'16-safety-reply';h=`<h1>${r.title}</h1><div class="warning"><p>${esc(r.intro)}</p><p>唔使付款，亦唔需要等 HMCS。</p></div><details><summary>睇返你嘅六題回答</summary>${dataRows()}</details>${sources()}${actions(b('重新體驗六題','restart'),b('查看所有免費求醫提醒','safetyInfo','quiet'))}`;}
    else if(!r.sell){h=`<h1>${r.title}</h1><div class="reply"><p>${esc(r.intro)}</p></div><details><summary>睇返你真正講過嘅六項</summary>${dataRows()}</details><div class="card"><h2>目前可以點做？</h2><p>${r.type==='review'?'持續困擾時，帶住呢啲情況同醫護討論；唔好自行改藥。':'想進一步了解，可先釐清醒來先後、實際尿量、持續時間及生活影響；持續困擾宜同醫護討論。'}</p><p>呢組資料暫未有足夠完整自動解讀，今次唔推解鎖。</p></div>${sources()}${actions(b('我想先慢慢了解','community'),b('修改回答','editAll','secondary'))}`;}
    else {
      clip=r.type==='fluid'?'08-preview':'';
      h=`<h1>${r.title}</h1>${r.type==='fluid'?'<div class="flow"><span>尿意<br>先醒</span><b>＋</b><span>每次<br>唔少</span><b>＋</b><span>晚間<br>飲水集中</span></div>':'<div class="flow"><span>先醒</span><b>→</b><span>再去廁所</span><b>？</b><span>醒來原因<br>仍未知</span></div>'}<p>${esc(r.intro)}</p><div class="card gold"><span class="label">仲未解開嘅問題</span><h2>${esc(r.unknown)}</h2><p class="small">完整解讀會拆開相符線索、其他方向、欠缺資料同下一步理由；唔會承諾找出唯一成因。</p></div><details><summary>睇返六題，或修改答案</summary>${dataRows()}</details><div class="note">免費提醒：持續影響睡眠或生活，宜求醫評估；唔好缺水或自行改藥。</div>${actions(b('睇清楚完整解讀有乜 →','unlock'),b('我想先慢慢了解','community','quiet'))}`;
    }
  }
  if(s.stage==='checkout'){
    phase='完整解讀 · 示範解鎖';
    h=`<h1>你買嘅，係回答背後嘅理解。</h1>${card('按你呢組答案整理',`<p>${r.type==='fluid'?'飲水時間線索，為何值得先了解？':'先醒再去，為何要分開了解睡眠同排尿？'}</p><div class="reason"><span class="label">① 答案與原理</span>逐項講清支持甚麼、不能證明甚麼。</div><div class="reason"><span class="label">② 對照其他方向</span>邊啲回答令另一方向值得保留。</div><div class="reason"><span class="label">③ 未知與下一步</span>解釋要補甚麼資料，先能分清；選擇同理由。</div><div class="reason"><span class="label">④ 後續選擇</span>自己了解、HMCS 或群組，按你需要揀。</div>`,'tint')}<p><strong>報告價格：未定</strong></p><p class="small">網站自動交付；不包含 Duncan 真人逐份審核、諮詢或 HMCS。唔係診斷，亦不保證改善效果。</p><div class="note">體驗版不收款、不輸入支付資料。報告解鎖同 Cosway 購物分開。</div>${s.hna.confirmed?`<p class="small">已沿用你希望「${esc(s.hna.goal)}」嘅需求摘要。</p>`:''}${actions(b('模擬解鎖，睇完整示例 →','pay'),b('取消，返回免費預覽','preview','quiet'))}`;
  }
  if(s.stage==='report'){
    phase=`完整自動解讀 · ${s.chapter+1} / 4`;clip=r.type==='fluid'?(s.chapter===0?'10-report-why':s.chapter===3?'11-report-next':''):'';
    const nav=['答案依據','其他方向','未知因素','下一步'];
    h=`<div class="chapter-nav" aria-label="報告章節">${nav.map((v,i)=>`<button data-chapter="${i}" class="${s.chapter===i?'active':''}" ${s.chapter===i?'aria-current="step"':''}>${i+1} ${v}</button>`).join('')}</div>`;
    if(s.chapter===0)h+=`<h1>${r.type==='fluid'?'點解先了解飲水時間？':'點解要將醒來同排尿拆開？'}</h1><p>${esc(r.why)}</p>${card('有你嘅回答做依據',`<div class="reason"><span class="label">你嘅經過</span>${esc(HD.label(s.answers,1))}<p class="small">${r.type==='fluid'?'尿意先出現，提供先後線索；不能單憑先後判病。':'先醒再去，不能當成已證明尿意令你醒。'}</p></div><div class="reason"><span class="label">你嘅感覺</span>${esc(HD.label(s.answers,2))}<p class="small">只係同日頭比較嘅感覺，唔係夜間總尿量。</p></div><div class="reason"><span class="label">你嘅晚間習慣</span>${esc(HD.label(s.answers,3))}<p class="small">提供可核對的生活因素；未知道實際種類、份量或每晚是否一樣。</p></div>`,'tint')}<div class="note">${esc(HD.label(s.answers,0))}講頻密程度；唔會轉成疾病機率。</div>`;
    if(s.chapter===1)h+=`<h1>點解唔直接套另一個解釋？</h1><p>${esc(r.contrast)}</p>${card('飲水時間',`<p>${s.answers[3]===0?'你有報告晚間集中飲水，所以值得核對。':s.answers[3]===1?'你有提到茶、咖啡或酒；種類與時間值得核對。':'你冇報告晚間飲得集中，所以「飲水太多」未有答案支持。'}</p>`)}${card('睡眠經過',`<p>${s.answers[1]===1?'你話先醒再去，令睡眠被打斷值得了解；仍未知道醒來原因。':'你話尿意先醒，但未問過睡眠質素、醒後是否容易再睡，所以不能排除睡眠因素。'}</p>`)}${card('排尿與其他情況',`<p>${s.answers[2]===1?'你話每次明顯少；少量排尿唔等於已診斷膀胱問題。':s.answers[2]===2?'每次唔同，唔適合用單一尿量模式作解釋。':'每次感覺唔少，仍然未量度，不能判定夜間尿量偏多。'}</p><p class="small">${HD.other(s.answers).includes(5)?'你唔肯定有冇其他情況，相關資料仍然未知。':'你冇留意到其他情況，唔等於已檢查或排除。'}</p>`)}<p class="small">以上係按回答比較值得了解嘅方向，唔係疾病排序。</p>`;
    if(s.chapter===2)h+=`<h1>邊啲資料，會令理解改變？</h1>${card('感覺未等於實際尿量',`<p>知道日間、夜間每次嘅時間與尿量，先有資料分清係尿量安排、少量排尿，定其他情況。醫護可能建議量度記錄作評估。</p>`,'tint')}${card('背景仍未核對',`<p>持續幾耐、對生活嘅影響、睡眠質素、完整用藥及健康背景都未齊。六題冇問到，唔代表冇影響。</p><p>你第五題係「${esc(HD.label(s.answers,4))}」，唔會當成已排除所有因素。</p>`)}${card('點解要保留未知？',`<p>即使線索相符，唔同因素亦可能同時存在。現有資料不能承諾一個原因、一件產品，或者一定有效嘅方案。</p>`)}<p class="small">量度記錄係可能協助醫護理解嘅工具；呢份解讀嘅交付核心係答案嘅理由同限制。</p>`;
    if(s.chapter===3)h+=`<h1>你可以點揀，先有理由。</h1>${card('按目前線索，先了解呢一步',`<p>${esc(r.next)}</p>`,'tint')}${card('甚麼時候值得醫護協助？',`<p>持續影響睡眠或日間生活、情況改變，或者想分清原因時，帶住回答摘要同醫護討論。新血尿、尿痛、發燒，或排唔到尿，請按免費求醫提醒處理。</p>`)}${s.hna.confirmed?card('你希望得到嘅改變',`<p>你希望「${esc(s.hna.goal)}」${s.hna.meaning?`，因為「${esc(s.hna.meaning)}」`:''}。後續討論會沿用呢個需要；唔會因為期望大，就判定要買服務。</p>`):''}<p>現有答案不足以決定你需要某件產品。下一步可以自己了解選擇、先了解 HMCS，或者慢慢建立認識。</p><details><summary>睇返完整回答摘要</summary>${dataRows()}</details>${sources()}`;
    h+=actions(b(s.chapter<3?'繼續拆解 →':'睇我嘅三個選擇 →',s.chapter<3?'chapterNext':'routes'),s.chapter?b('← 上一章','chapterBack','quiet'):'');
  }
  if(s.stage==='routes'){
    clip='12-routes';phase='下一步 · 按你需要';h=`<h1>點樣繼續，由你話事。</h1><p class="lead">想自己睇、搵協助，定慢慢了解，都可以。</p>${s.hna.confirmed?`<div class="note">你希望「${esc(s.hna.help)}」。下面保留所有選擇，唔會替你決定。</div>`:''}<button class="route" data-act="shop"><span class="icon" aria-hidden="true">↗</span><span>自己了解方案與產品<small>先睇用途、限制與購買方式，再決定。</small></span></button><button class="route" data-act="hmcs"><span class="icon" aria-hidden="true">◎</span><span>希望有人同我梳理<small>先了解 HMCS 的協助，再商議服務與費用。</small></span></button><button class="route" data-act="community"><span class="icon" aria-hidden="true">＋</span><span>未想決定，慢慢了解<small>了解群組入口，按自己步調繼續。</small></span></button>${b('睇返完整解讀','report','quiet')}`;
  }
  if(s.stage==='shop'){
    phase='方案與產品 · 承接示意';h=`<h1>先睇清楚，再決定買唔買。</h1>${card('生活安排的方向',`<p>${esc(r.next||'現有資料仍需核對；持續困擾宜求醫評估。')}</p>`,'tint')}${card('相關產品與商店',`<p>產品資訊需要列明用途、適合及不適合情況、用藥注意、價格與購買方式。</p><p>現有答案未建立合理產品配對，所以今次未展示指定商品。</p>`)}<div class="note">商店網址、產品及 Cosway 銜接未核對。本頁未接真實商店；購物付款與報告解鎖分開。</div>${actions(b('想有人幫我理解選擇','hmcs'),b('返回三個選擇','routes','quiet'))}`;
  }
  if(s.stage==='community'){
    phase='慢慢建立了解';h=`<h1>未想決定，都可以繼續。</h1><p class="lead">先跟住日常分享同直播，慢慢了解自己需要甚麼；唔使而家承諾買產品或服務。</p>${card('Facebook / WhatsApp 群組入口',`<p>以下先展示承接位置；實際群組內容及網址仍待核對。</p>${b('Facebook 群組 · 示意','group','secondary')}${b('WhatsApp 群組 · 示意','group','quiet')}<p id="groupNote" role="status" class="small">未連結真實群組，撳掣唔會加入。</p>`)}${actions(b('返回剛才嘅進度','return'))}`;
  }
  if(s.stage==='hmcs'){
    clip='13-hmcs';phase='HMCS · 先理解服務';h=`<h1>先釐清你想要嘅，再討論方案。</h1><ol class="step-list"><li>整理需要，確認你期望得到咩協助。</li><li>確認意願及適合程度，合適才安排線下。</li><li>按需要評估數據、解讀詳細報告，討論方案與費用。</li><li>你認同安排與費用，先確認是否開始。</li></ol><div class="note">HMCS 另議服務與費用；報告解鎖唔包含人工服務，亦唔自動代表適合 HMCS。</div>${s.hna.confirmed?`<p>已整理你希望「${esc(s.hna.goal)}」，相關答案同需要會沿用。</p>`:'<p>你嘅六題答案已帶過嚟。接下來補充目標、現況與期望，陪你整理需要。</p>'}${actions(b(s.hna.confirmed?'沿用需要摘要，了解安排 →':'一齊梳理我嘅需要 →','hmcsNext'),b('我想先慢慢了解','community','quiet'))}`;
  }
  if(s.stage==='hna'){
    phase=`需求梳理示例 · ${s.hi+1} / 9`;clip=s.hi===0?'09-hna':'';h=hnaScreen()+`<p id="error" class="error" role="alert"></p>${actions(b(s.hi===8?'睇返我嘅需要摘要 →':'繼續整理 →','hnaNext'),s.hi?b('← 上一步','hnaBack','quiet'):b('暫時唔整理，返回','hnaCancel','quiet'))}<p class="small">示範保留 HNA 的需求及共識用途；九屏唔係正式欄位刪減定案。無預選分數、方案或同意。</p>`;
  }
  if(s.stage==='hnaReply'){
    phase='你嘅需要 · 逐步整理';h=`<h1>呢部分已記低。</h1><div class="reply"><p>${hnaReflect()}</p></div><p class="small">呢個係按你選擇回映需要，唔係健康判斷。</p>${actions(b(s.hi===8?'睇完整需要摘要 →':'繼續下一部分 →','hnaContinue'),b('修改呢部分','hna','quiet'))}`;
  }
  if(s.stage==='consensus'){
    phase='需要摘要 · 由你確認';h=`<h1>有冇理解到你想要嘅？</h1>${needsSummary()}<label class="tick"><input id="agree" type="checkbox">呢個摘要反映我而家嘅想法；唔代表接受未知方案、費用或承諾購買。</label><p id="error" class="error" role="alert"></p>${actions(b(s.hnaContext==='checkout'?'確認摘要，睇解鎖交付 →':'確認摘要，了解安排 →','agree'),b('我想修改','hnaEdit','quiet'))}`;
  }
  if(s.stage==='booking'){
    clip='14-booking';phase='服務意向 · 本機示範';h=`<h1>先確認合適，再落實見面。</h1><details><summary>沿用需要摘要，唔使重填</summary>${needsSummary()}</details><label for="contact">測試稱呼（只填假資料）</label><input id="contact" type="text" maxlength="80" placeholder="例如 Demo" value="${esc(s.booking.contact)}"><label for="time">方便了解安排的時段</label><select id="time"><option value="">請選擇</option>${['平日早上','平日下午','其他，需要商量','未知道'].map(v=>`<option${s.booking.time===v?' selected':''}>${v}</option>`).join('')}</select><label class="tick"><input id="intent" type="checkbox" ${s.booking.intent?'checked':''}>我願意先了解需另議費用的服務，再確認是否安排見面。</label><p id="error" class="error" role="alert"></p><p class="small">Demo 不收電話、不傳送意向、不佔用時段。正式流程先確認服務預期、適合程度及安排。</p>${actions(b('模擬提交服務意向','submit'),b('返回 HMCS','hmcs','quiet'))}`;
  }
  if(s.stage==='done'){
    phase='模擬旅程完成';h=`<h1>已到服務意向<br>待確認呢一步。</h1><div class="card tint"><p>正式流程會先確認需要、服務與費用，再雙方落實見面。</p><p>今次沒有扣款、傳送資料、通知 Duncan 或建立預約。</p></div>${actions(b('返回三個選擇','routes'),b('重新體驗','restart','quiet'))}`;
  }
  if(s.stage==='pause'){
    phase='先停一停';h=`<h1>唔使一次做晒。</h1><p>今個分頁仍保留你已選嘅回答。可以返嚟繼續，亦可以先了解群組入口。</p><div class="note">Demo 只在本分頁記住資料；刷新或關閉會清除。未完成唔代表你冇改善意願。</div>${actions(b('繼續剛才嘅進度','return'),b('先慢慢了解','community','secondary'))}`;
  }
  if(s.stage==='safetyInfo'){
    phase='求醫提醒 · 永遠免費';h=`<h1>有新不適，先求醫。</h1><div class="warning"><h2>即時求醫</h2><p>如果現在想排但排唔到尿，或者有嚴重腹痛，請即時求醫。</p><h2>盡快求醫</h2><p>新血尿、尿痛、發燒，應盡快向醫護了解。唔使等自測、付款或 HMCS。</p></div><p>持續影響睡眠或生活，亦宜作醫護評估。唔好自行改藥、令自己缺水，或用網上解讀取代求醫。</p>${sources()}${actions(b('返回剛才嘅進度','return'))}`;
  }
  $('phase').textContent=phase;$('screen').innerHTML=h;media(clip);
}
function saveHna(){const fields=[...$('screen').querySelectorAll('[data-hna]')];fields.forEach(el=>s.hna[el.id]=el.value);s.hna.confirmed=false;return fields.filter(el=>el.tagName==='SELECT').every(el=>el.value);}
function hnaReflect(){if(s.hi===0)return `你最重視「${s.hna.goal}」${s.hna.meaning?`，因為「${s.hna.meaning}」`:''}。呢個需要會成為之後比較安排嘅重點。`;if(s.hi===1)return `已記低你嘅睡眠「${s.hna.sleep}」、活動「${s.hna.routine}」同用藥／補充品「${s.hna.meds}」。六題資料仍然沿用，正式服務會再核對細節。`;if(s.hi<=6){const i=s.hi-2;return `你對「${dimensions[i]}」目前選 ${s.hna['now'+i]}，希望 ${s.hna['wish'+i]}${s.hna['why'+i]?`，因為「${s.hna['why'+i]}」`:''}。我哋保留你嘅主觀期望，唔會將分數差距變成必須購買嘅理由。`;}if(s.hi===7)return `你希望「${s.hna.pace}」，目前想「${s.hna.help}」，願意投入到「${s.hna.willing}」。下一步安排應先配合呢個步調。`;return `你想先了解「${s.hna.plan}」${s.hna.questions?`，並問清楚「${s.hna.questions}」`:''}。呢個係討論方向，唔代表已選定方案。`;}
function startHna(context){s.hnaContext=context;s.hi=0;go('hna');}
document.addEventListener('click',e=>{
  const mode=e.target.closest('[data-mode]');if(mode){s.mode=mode.dataset.mode;reset();return;}
  const sample=e.target.closest('[data-sample]');if(sample){reset();const name=sample.dataset.sample;s.sample=name;s.answers={fluid:[2,0,0,0,[4],0],sleep:[2,1,1,2,[4],0],unknown:[4,3,3,3,[5],0],safety:[2,0,0,0,[4],2]}[name];question(0);return;}
  const edit=e.target.closest('[data-edit]');if(edit){invalidate();question(Number(edit.dataset.edit));return;}
  const ch=e.target.closest('[data-chapter]');if(ch){s.chapter=Number(ch.dataset.chapter);go('report');return;}
  const answer=e.target.closest('[data-answer]');if(answer){const i=Number(answer.dataset.answer);invalidate();if(HD.questions[s.q].multi){let selected=[...(s.answers[s.q]||[])];if(i>=4)selected=selected.includes(i)?[]:[i];else {selected=selected.filter(v=>v<4);selected=selected.includes(i)?selected.filter(v=>v!==i):[...selected,i];}s.answers[s.q]=selected;render();}else{s.answers[s.q]=i;s.replied=true;render();window.scrollTo(0,0);}return;}
  const button=e.target.closest('[data-act]');if(!button)return;let act=button.dataset.act;
  // No report route may bypass simulated entitlement or the safety/content gate.
  if(['checkout','pay','report','chapterNext','chapterBack','routes','unlock'].includes(act)&&(!HD.result(s.answers).sell)){go('preview');return;}
  if(['report','chapterNext','chapterBack','routes'].includes(act)&&!s.paid){go('preview');return;}
  switch(act){
    case 'start':question(0);break;
    case 'quiz':question(s.q);break;
    case 'confirm':if(s.answers[s.q]===undefined||(Array.isArray(s.answers[s.q])&&!s.answers[s.q].length)){$('error').textContent='請選一項；未清楚可以揀「唔肯定」。';break;}s.replied=true;render();window.scrollTo(0,0);break;
    case 'change':s.replied=false;render();break;
    case 'next':if(!s.replied)break;s.q===5?go('preview'):question(s.q+1);break;
    case 'back':question(s.q-1);break;
    case 'editAll':question(0);break;
    case 'unlock':s.mode==='before'?startHna('checkout'):go('checkout');break;
    case 'pay':s.paid=true;s.chapter=0;go('report');break;
    case 'chapterNext':s.chapter=Math.min(3,s.chapter+1);go('report');break;
    case 'chapterBack':s.chapter=Math.max(0,s.chapter-1);go('report');break;
    case 'hmcsNext':s.hna.confirmed?go('booking'):startHna('booking');break;
    case 'hnaNext':if(!saveHna()){$('error').textContent='請選擇，未清楚可揀「唔肯定／未能評分／想先討論」。';break;}go('hnaReply');break;
    case 'hnaContinue':s.hi===8?go('consensus'):(s.hi++,go('hna'));break;
    case 'hnaBack':saveHna();s.hi--;go('hna');break;
    case 'hnaEdit':s.hi=0;go('hna');break;
    case 'hnaCancel':go(s.hnaContext==='checkout'?'preview':'hmcs');break;
    case 'agree':if(!$('agree').checked){$('error').textContent='請先確認摘要反映你嘅想法；如有唔同，可以修改。';break;}s.hna.confirmed=true;go(s.hnaContext==='checkout'?'checkout':'booking');break;
    case 'pause':if(s.stage==='hna')saveHna();if(s.stage==='booking')saveBooking();s.returnStage=s.stage;go('pause');break;
    case 'safetyInfo':if(s.stage==='safetyInfo')break;if(s.stage==='hna')saveHna();if(s.stage==='booking')saveBooking();if(!['pause','community'].includes(s.stage))s.returnStage=s.stage;go('safetyInfo');break;
    case 'community':if(!['community','pause','safetyInfo'].includes(s.stage))s.returnStage=s.stage;go('community');break;
    case 'return':go(s.returnStage);break;
    case 'group':$('groupNote').textContent='此入口只係示意：真實群組網址未核對，沒有加入任何群組。';break;
    case 'submit':saveBooking();if(!s.booking.contact.trim()||!s.booking.time||!s.booking.intent){$('error').textContent='請填測試稱呼、選時段，並確認願意先了解服務。';break;}go('done');break;
    case 'restart':reset();break;
    default:go(act);
  }
});
function saveBooking(){s.booking={contact:$('contact').value,time:$('time').value,intent:$('intent').checked};}
render();
