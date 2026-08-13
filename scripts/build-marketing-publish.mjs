// ============================================================
// 마케팅 허브 자동 발행 — 예약된 승인 콘텐츠를 채널에 게시
//
// 동작:
//   1. Supabase mkt_state(id='main')에서 대시보드 상태를 읽는다 (service role)
//   2. status='scheduled'이고 발행 예정일(due)이 오늘(KST) 이전인 주제를 찾는다
//   3. 채널별로 발행한다.
//      중복 방지는 append-only 원장 mkt_publog(tid, ch)가 담당한다:
//      발행 "전에" 원장에 선점(claim) 기록 → 상태 문서가 대시보드와
//      경합해 덮여도 같은 글이 외부 채널에 두 번 나가지 않는다.
//      - home    : posts/<due>-<slug>-<id>.html 정적 페이지 생성 (항상 동작)
//      - x       : X API v2 스레드 발행 (X_API_KEY 등 4개 시크릿 있을 때)
//      - threads : Threads Graph API (THREADS_USER_ID/ACCESS_TOKEN 있을 때)
//      - naver   : 네이버 블로그 글쓰기 API (NAVER_REFRESH_TOKEN 세트 있을 때)
//      - youtube/insta : 영상·이미지 업로드가 필요해 자동화 제외(대시보드에서 수동)
//   4. 주제 하나를 처리할 때마다 즉시 상태를 저장한다(중단 대비).
//      저장 직전 최신 상태를 다시 읽어 이번 변경분만 병합 — 대시보드
//      편집을 덮어쓰는 창을 최소화한다.
//
// 필요 시크릿: SUPABASE_SERVICE_ROLE_KEY (필수), 나머지는 선택
// 의존성 없음 (Node 20+ 내장 fetch/crypto)
// ============================================================
import { writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import crypto from "node:crypto";

const SUPABASE_URL = "https://aggndijeezodnfrnqpwp.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SITE = "https://www.workmentor.co.kr";

if (!SERVICE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY가 없습니다 — 종료");
  process.exit(1);
}

const sbHeaders = {
  apikey: SERVICE_KEY,
  Authorization: "Bearer " + SERVICE_KEY,
  "Content-Type": "application/json",
};

// KST 기준 오늘 날짜 (Actions 러너는 UTC)
const kstNow = new Date(Date.now() + 9 * 3600e3);
const todayKst = kstNow.toISOString().slice(0, 10);

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ---------- 상태 문서 ----------
async function loadState() {
  const r = await fetch(SUPABASE_URL + "/rest/v1/mkt_state?id=eq.main&select=value", { headers: sbHeaders });
  if (!r.ok) throw new Error("mkt_state 조회 실패 " + r.status + " — add-marketing.sql 실행 여부를 확인하세요");
  const rows = await r.json();
  return rows.length ? rows[0].value : null;
}
// 이번 실행의 변경분만 최신 문서 위에 병합해 저장 (대시보드 편집 보호)
async function saveChanges(changes) {
  const fresh = (await loadState()) || {};
  fresh.log = Array.isArray(fresh.log) ? fresh.log : [];
  fresh.activity = Array.isArray(fresh.activity) ? fresh.activity : [];
  fresh.topics = Array.isArray(fresh.topics) ? fresh.topics : [];
  for (const l of changes.logs) {
    if (!fresh.log.some(x => x.tid === l.tid && x.ch === l.ch)) fresh.log.unshift(l);
  }
  for (const a of changes.acts) fresh.activity.unshift(a);
  if (fresh.activity.length > 200) fresh.activity.length = 200;
  for (const tid of changes.publishedTids) {
    const t = fresh.topics.find(x => x.id === tid);
    if (t) t.status = "published";
  }
  fresh.savedAt = Date.now();
  const r = await fetch(SUPABASE_URL + "/rest/v1/mkt_state?id=eq.main", {
    method: "PATCH",
    headers: { ...sbHeaders, Prefer: "return=minimal" },
    body: JSON.stringify({ value: fresh, updated_at: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error("mkt_state 저장 실패 " + r.status);
}

// ---------- 발행 원장 (mkt_publog) ----------
async function ledgerAll() {
  const r = await fetch(SUPABASE_URL + "/rest/v1/mkt_publog?select=tid,ch", { headers: sbHeaders });
  if (!r.ok) throw new Error("mkt_publog 조회 실패 " + r.status + " — 최신 add-marketing.sql을 다시 실행하세요");
  return await r.json();
}
// 발행 전에 선점 — 이미 있으면(다른 실행이 처리) false
async function ledgerClaim(tid, ch) {
  const r = await fetch(SUPABASE_URL + "/rest/v1/mkt_publog", {
    method: "POST",
    headers: { ...sbHeaders, Prefer: "return=minimal" },
    body: JSON.stringify({ tid, ch }),
  });
  if (r.status === 409) return false;   // 중복 키 = 이미 발행됨/선점됨
  if (!r.ok) throw new Error("mkt_publog 선점 실패 " + r.status);
  return true;
}
async function ledgerRelease(tid, ch) {
  // 발행 실패 시 선점 해제(다음 시간에 재시도) — 실패해도 치명적이지 않음(수동 발행 가능)
  await fetch(SUPABASE_URL + "/rest/v1/mkt_publog?tid=eq." + encodeURIComponent(tid) + "&ch=eq." + encodeURIComponent(ch), {
    method: "DELETE", headers: sbHeaders,
  }).catch(() => {});
}
async function ledgerUrl(tid, ch, url) {
  await fetch(SUPABASE_URL + "/rest/v1/mkt_publog?tid=eq." + encodeURIComponent(tid) + "&ch=eq." + encodeURIComponent(ch), {
    method: "PATCH", headers: { ...sbHeaders, Prefer: "return=minimal" },
    body: JSON.stringify({ url: url || "" }),
  }).catch(() => {});
}

// ---------- X 가중 글자수 (한글·CJK·이모지 = 2) ----------
function xWeight(str) {
  let w = 0;
  for (const chr of str) {
    const cp = chr.codePointAt(0);
    // twitter-text 근사: 라틴·일반 문장부호 범위만 1, 나머지(한글 포함) 2
    w += (cp <= 0x10FF || (cp >= 0x2000 && cp <= 0x206F)) ? 1 : 2;
  }
  return w;
}
function xClip(str, budget = 274) {
  if (xWeight(str) <= budget) return str;
  let out = "";
  for (const chr of str) {
    if (xWeight(out + chr) > budget - 2) break;
    out += chr;
  }
  return out + "…";
}

// ---------- 홈페이지 채널: 정적 페이지 생성 ----------
function mdToHtml(text) {
  // 대시보드 본문(마크다운 라이트) → HTML
  const lines = String(text || "").split("\n");
  let html = "", inUl = false;
  const closeUl = () => { if (inUl) { html += "</ul>\n"; inUl = false; } };
  for (const ln of lines) {
    const h = ln.match(/^(#{2,3})\s+(.+)/);
    if (h) { closeUl(); html += "<h" + h[1].length + ">" + esc(h[2]) + "</h" + h[1].length + ">\n"; continue; }
    if (/^- /.test(ln)) { if (!inUl) { html += "<ul>\n"; inUl = true; } html += "<li>" + esc(ln.slice(2).replace(/\*\*/g, "")) + "</li>\n"; continue; }
    closeUl();
    if (ln.trim()) html += "<p>" + esc(ln.replace(/\*\*/g, "")).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" rel="noopener">$1</a>') + "</p>\n";
  }
  closeUl();
  return html;
}
function postPage(title, bodyHtml, due) {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)} | 워크멘토</title>
<meta name="description" content="${esc(title)} — 워크멘토 소식" />
<link rel="canonical" href="${SITE}/posts/" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:site_name" content="워크멘토" />
<style>
body{font-family:'Noto Sans KR',sans-serif;background:#F5F6FA;color:#1A2233;line-height:1.8;word-break:keep-all;margin:0}
.wrap{max-width:760px;margin:0 auto;padding:28px 20px 80px}
.top{font-size:13px;margin-bottom:18px}.top a{color:#2757C9;text-decoration:none;font-weight:700}
article{background:#fff;border:1px solid #E2E5EE;border-radius:12px;padding:28px 26px}
h1{color:#17264B;font-size:24px;line-height:1.5;margin:0 0 6px}
.date{color:#7A8398;font-size:13px;margin-bottom:18px}
h2{color:#17264B;font-size:19px;margin:26px 0 8px;border-left:4px solid #F97B33;padding-left:10px}
h3{color:#17264B;font-size:16px;margin:18px 0 6px}
a{color:#2757C9;overflow-wrap:anywhere}
ul{padding-left:22px}
.cta{margin-top:26px;background:#FBF3E0;border-radius:10px;padding:16px;font-size:14px}
.cta a{font-weight:700}
</style>
</head>
<body>
<div class="wrap">
<div class="top"><a href="${SITE}/">← 워크멘토 홈</a> · <a href="./">소식 전체 보기</a></div>
<article>
<h1>${esc(title)}</h1>
<div class="date">${esc(due)} · 워크멘토</div>
${bodyHtml}
<div class="cta">더 많은 실시간 지원사업 공고와 기업 소식은 <a href="${SITE}/">워크멘토 홈페이지</a>에서 확인하세요.</div>
</article>
</div>
</body>
</html>`;
}
function rebuildPostsIndex() {
  const files = existsSync("posts") ? readdirSync("posts").filter(f => /^\d{4}-\d{2}-\d{2}-.+\.html$/.test(f)).sort().reverse() : [];
  const items = files.map(f => {
    const date = f.slice(0, 10);
    // 파일명 끝의 주제 id 꼬리표(-xxxxx)는 표시에서 제거
    const label = f.slice(11, -5).replace(/-[a-z0-9]{8,}$/i, "").replace(/-/g, " ");
    return `<li><span class="d">${date}</span><a href="${f}">${esc(label)}</a></li>`;
  }).join("\n");
  const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>워크멘토 소식</title>
<meta name="description" content="워크멘토가 전하는 지원사업·경영 소식 모음" />
<link rel="canonical" href="${SITE}/posts/" />
<style>
body{font-family:'Noto Sans KR',sans-serif;background:#F5F6FA;color:#1A2233;line-height:1.8;margin:0}
.wrap{max-width:760px;margin:0 auto;padding:28px 20px 80px}
h1{color:#17264B}h1 span{color:#F97B33}
ul{list-style:none;padding:0}
li{background:#fff;border:1px solid #E2E5EE;border-radius:10px;padding:12px 16px;margin-bottom:8px;display:flex;gap:12px;align-items:baseline}
li .d{color:#7A8398;font-size:12.5px;white-space:nowrap}
a{color:#1A2233;text-decoration:none;font-weight:700}a:hover{color:#2757C9}
.top a{color:#2757C9;font-size:13px;font-weight:700}
</style>
</head>
<body>
<div class="wrap">
<p class="top"><a href="${SITE}/">← 워크멘토 홈</a></p>
<h1>워크<span>멘토</span> 소식</h1>
<ul>
${items || "<li>아직 게시된 소식이 없습니다.</li>"}
</ul>
</div>
</body>
</html>`;
  writeFileSync("posts/index.html", html);
}
function publishHome(topic, cont) {
  mkdirSync("posts", { recursive: true });
  const slug = (cont.title || topic.title).replace(/[^\w가-힣]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "post";
  // 주제 id를 꼬리표로 붙여 같은 날짜·같은 제목이라도 파일이 겹치지 않게
  const file = `${topic.due || todayKst}-${slug}-${topic.id}.html`;
  // 홈페이지 변환물이 HTML이면 그대로, 아니면 본문을 변환
  const v = cont.variants && cont.variants.home && cont.variants.home.text || "";
  const inner = /<article>/.test(v) ? v.replace(/<!--[\s\S]*?-->/g, "").replace(/<\/?article>/g, "").replace(/<h1>[\s\S]*?<\/h1>/, "") : mdToHtml(cont.body);
  writeFileSync("posts/" + file, postPage(cont.title || topic.title, inner, topic.due || todayKst));
  rebuildPostsIndex();
  return SITE + "/posts/" + file;
}

// ---------- X(트위터): OAuth 1.0a 스레드 발행 ----------
const X_KEYS = ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET"];
function xReady() { return X_KEYS.every(k => process.env[k]); }
function oauth1Header(method, url, extraParams = {}) {
  const ck = process.env.X_API_KEY, cs = process.env.X_API_SECRET;
  const at = process.env.X_ACCESS_TOKEN, as = process.env.X_ACCESS_SECRET;
  const p = {
    oauth_consumer_key: ck,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: at,
    oauth_version: "1.0",
    ...extraParams,
  };
  const enc = encodeURIComponent;
  const paramStr = Object.keys(p).sort().map(k => enc(k) + "=" + enc(p[k])).join("&");
  const base = [method.toUpperCase(), enc(url), enc(paramStr)].join("&");
  const key = enc(cs) + "&" + enc(as);
  p.oauth_signature = crypto.createHmac("sha1", key).update(base).digest("base64");
  return "OAuth " + Object.keys(p).sort().map(k => enc(k) + '="' + enc(p[k]) + '"').join(", ");
}
async function publishX(cont) {
  const text = cont.variants && cont.variants.x && cont.variants.x.text || "";
  if (!text) throw new Error("x 변환물 없음");
  // "── 트윗 N ────" 구분자로 분할 + 가중 280 한도 방어 클립
  const tweets = text.split(/── 트윗 \d+ ─+\n?/).map(s => s.trim()).filter(Boolean).map(t => xClip(t));
  if (!tweets.length) throw new Error("트윗 분할 실패");
  let replyTo = null, firstId = null;
  for (const tw of tweets) {
    const body = replyTo ? { text: tw, reply: { in_reply_to_tweet_id: replyTo } } : { text: tw };
    const url = "https://api.twitter.com/2/tweets";
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: oauth1Header("POST", url), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok || !j.data) {
      // 스레드 중간 실패: 이미 나간 트윗이 있으면 성공으로 간주(재발행 금지),
      // 첫 트윗부터 실패했을 때만 오류로 올려 선점 해제 → 다음 시간 재시도
      if (firstId) { console.log("  (스레드 후속 트윗 일부 실패 — 첫 트윗은 발행됨)"); break; }
      throw new Error("X 발행 실패 " + r.status + " " + JSON.stringify(j).slice(0, 200));
    }
    replyTo = j.data.id;
    if (!firstId) firstId = j.data.id;
    await new Promise(res => setTimeout(res, 1200));
  }
  return "https://x.com/i/status/" + firstId;
}

// ---------- Threads ----------
function threadsReady() { return process.env.THREADS_USER_ID && process.env.THREADS_ACCESS_TOKEN; }
async function publishThreads(cont) {
  const text = cont.variants && cont.variants.threads && cont.variants.threads.text || "";
  if (!text) throw new Error("threads 변환물 없음");
  const tuid = process.env.THREADS_USER_ID, tok = process.env.THREADS_ACCESS_TOKEN;
  const mk = await fetch(`https://graph.threads.net/v1.0/${tuid}/threads?media_type=TEXT&text=${encodeURIComponent(text)}&access_token=${tok}`, { method: "POST" });
  const mj = await mk.json();
  if (!mk.ok || !mj.id) throw new Error("Threads 컨테이너 실패 " + JSON.stringify(mj).slice(0, 200));
  await new Promise(res => setTimeout(res, 2000));
  const pub = await fetch(`https://graph.threads.net/v1.0/${tuid}/threads_publish?creation_id=${mj.id}&access_token=${tok}`, { method: "POST" });
  const pj = await pub.json();
  if (!pub.ok || !pj.id) throw new Error("Threads 발행 실패 " + JSON.stringify(pj).slice(0, 200));
  return "https://www.threads.net/"; // API가 퍼머링크를 주지 않으면 프로필 기준
}

// ---------- 네이버 블로그 ----------
// 네이버 access token은 1시간 만료 → refresh token으로 매 실행 갱신
function naverReady() {
  return (process.env.NAVER_REFRESH_TOKEN && process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET) || process.env.NAVER_ACCESS_TOKEN;
}
async function naverToken() {
  if (process.env.NAVER_REFRESH_TOKEN && process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET) {
    const u = "https://nid.naver.com/oauth2.0/token?grant_type=refresh_token" +
      "&client_id=" + encodeURIComponent(process.env.NAVER_CLIENT_ID) +
      "&client_secret=" + encodeURIComponent(process.env.NAVER_CLIENT_SECRET) +
      "&refresh_token=" + encodeURIComponent(process.env.NAVER_REFRESH_TOKEN);
    const r = await fetch(u);
    const j = await r.json().catch(() => ({}));
    if (j.access_token) return j.access_token;
    throw new Error("네이버 토큰 갱신 실패: " + JSON.stringify(j).slice(0, 150));
  }
  return process.env.NAVER_ACCESS_TOKEN;   // 수동 발급 토큰(1시간 유효) 폴백
}
async function publishNaver(cont, topic) {
  const text = cont.variants && cont.variants.naver && cont.variants.naver.text || "";
  if (!text) throw new Error("naver 변환물 없음");
  const token = await naverToken();
  // 제목 후보 1번 추출, [본문] 이후만 게시
  const titleM = text.match(/1\)\s*(.+)/);
  const title = (titleM ? titleM[1] : (cont.title || topic.title)).trim();
  const bodyIdx = text.indexOf("[본문");
  const body = bodyIdx > -1 ? text.slice(text.indexOf("\n", bodyIdx) + 1).trim() : text;
  const r = await fetch("https://openapi.naver.com/blog/writePost.json", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
    body: "title=" + encodeURIComponent(title) + "&contents=" + encodeURIComponent(body.replace(/\n/g, "<br>")),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.message && j.message.error) throw new Error("네이버 발행 실패 " + r.status + " " + JSON.stringify(j).slice(0, 200));
  return (j.message && j.message.result && j.message.result.postUrl) || "";
}

// ---------- 메인 ----------
const state = await loadState();
if (!state || !Array.isArray(state.topics)) {
  console.log("mkt_state가 비어 있습니다 — 대시보드에서 데이터가 동기화된 뒤 동작합니다");
  process.exit(0);
}

const due = state.topics.filter(t => t.status === "scheduled" && t.due && t.due <= todayKst);
if (!due.length) {
  console.log("발행 예정 콘텐츠 없음 (" + todayKst + " KST) — 종료");
  process.exit(0);
}
console.log("발행 대상 " + due.length + "건:", due.map(t => t.title).join(" / "));

// 발행 원장 로드 — 중복 방지의 단일 진실
const ledger = await ledgerAll();
const inLedger = (tid, ch) => ledger.some(l => l.tid === tid && l.ch === ch);

const AUTO = {
  home: { ready: () => true, fn: (c, t) => Promise.resolve(publishHome(t, c)) },
  x: { ready: xReady, fn: c => publishX(c) },
  threads: { ready: threadsReady, fn: c => publishThreads(c) },
  naver: { ready: naverReady, fn: (c, t) => publishNaver(c, t) },
};

for (const topic of due) {
  const cont = state.contents && state.contents[topic.id];
  if (!cont || !cont.body) { console.log("· 건너뜀(본문 없음): " + topic.title); continue; }
  const targets = (topic.channels && topic.channels.length ? topic.channels : ["home"]);
  const changes = { logs: [], acts: [], publishedTids: [] };

  for (const ch of targets) {
    // 멱등: 원장 또는 상태 로그에 이미 있으면 건너뜀 (수동 발행 기록도 존중)
    if (inLedger(topic.id, ch) || (state.log || []).some(l => l.tid === topic.id && l.ch === ch)) continue;
    const ad = AUTO[ch];
    if (!ad) { console.log("· " + ch + ": 수동 발행 채널 — 대시보드에서 처리"); continue; }
    if (!ad.ready()) { console.log("· " + ch + ": API 시크릿 미설정 — 건너뜀"); continue; }
    // 발행 전 선점 — 어떤 경합에서도 중복 발행 차단
    if (!(await ledgerClaim(topic.id, ch))) { console.log("· " + ch + ": 이미 발행 원장에 있음 — 건너뜀"); continue; }
    try {
      const url = await ad.fn(cont, topic);
      await ledgerUrl(topic.id, ch, url);
      changes.logs.push({ id: uid(), tid: topic.id, ch, url: url || "", at: Date.now(), mode: "auto", views: 0, clicks: 0, title: cont.title || topic.title });
      changes.acts.push({ at: Date.now(), tx: "자동 발행: " + topic.title + " → " + ch });
      ledger.push({ tid: topic.id, ch });
      console.log("· " + ch + ": 발행 완료 " + (url || ""));
    } catch (e) {
      await ledgerRelease(topic.id, ch);   // 다음 시간에 재시도
      console.log("· " + ch + ": 실패 — " + e.message);
    }
  }

  // 대상 채널이 모두 발행되면 완료 처리 (수동 채널이 남았으면 scheduled 유지)
  const doneAll = targets.every(ch =>
    inLedger(topic.id, ch) ||
    (state.log || []).some(l => l.tid === topic.id && l.ch === ch) ||
    changes.logs.some(l => l.ch === ch));
  if (doneAll) {
    changes.publishedTids.push(topic.id);
    console.log("→ 모든 채널 발행 완료: " + topic.title);
  }

  // 주제 단위로 즉시 저장 — 중단·경합 대비 (최신 문서에 변경분만 병합)
  if (changes.logs.length || changes.publishedTids.length) {
    try { await saveChanges(changes); console.log("  상태 저장 완료"); }
    catch (e) { console.log("  상태 저장 실패(원장에는 기록됨): " + e.message); }
  }
}
console.log("실행 종료");
