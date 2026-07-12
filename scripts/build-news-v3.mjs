/* 워크멘토 뉴스 아카이브 생성기 v3 — gov-feeds.json → news/ 정적 페이지 (SEO용)
   수집 로봇이 매 실행마다 함께 돌려 news/index.html, news/날짜.html, sitemap-news.xml 생성 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";

if (!existsSync("gov-feeds.json")) { console.log("gov-feeds.json 없음 — 건너뜀"); process.exit(0); }
const data = JSON.parse(readFileSync("gov-feeds.json", "utf-8"));
const SITE = "https://www.workmentor.co.kr";
const NAMES = { money: "정책자금·지원금", tax: "세무·회계", labor: "노무·인사", guide: "세무·노무 실무", fund: "금융·관세", law: "법무·공정거래", biz: "중소기업 정책" };
const SUPA = "https://aggndijeezodnfrnqpwp.supabase.co";
const SUPA_KEY = "sb_publishable_gAJZTg5K7lS39m-4nkcQpw_GRaHWqk4";
/* 분류별 워크멘토 해설 (관리자가 사이트에서 작성) */
let NOTES = {};
try {
  const r = await fetch(SUPA + "/rest/v1/gov_notes?select=group_key,note", {
    headers: { apikey: SUPA_KEY, Authorization: "Bearer " + SUPA_KEY },
  });
  if (r.ok) for (const row of await r.json()) if (row.note) NOTES[row.group_key] = row.note;
} catch (_) {}
const kst = new Date(Date.now() + 9 * 3600 * 1000);
const today = kst.toISOString().slice(0, 10);

const esc = s => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function page(title, desc, path, body) {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}" />
<link rel="canonical" href="${SITE}${path}" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(desc)}" />
<meta name="robots" content="index, follow" />
<style>
  * { -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, 'Pretendard', 'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; background: #F3F0EA; color: #2A3142; }
  header { background: linear-gradient(180deg, #443F39, #34302B); color: #fff; padding: 28px 20px; text-align: center; box-shadow: 0 2px 10px rgba(0,0,0,0.18); }
  header a { color: #F97B33; text-decoration: none; font-weight: 800; font-size: 23px; letter-spacing: -0.01em; }
  header p { margin: 8px 0 0; color: #D6D1C8; font-size: 13.5px; }
  main { max-width: 860px; margin: 0 auto; padding: 28px 16px 60px; }
  h2 { font-size: 20px; color: #1F2637; margin: 36px 0 14px; letter-spacing: -0.01em; }
  h2 .cat { display: inline-block; margin-left: 8px; font-size: 12.5px; font-weight: 700; color: #B85C1E; background: #FCE9DB; border: 1px solid #F5CDAE; border-radius: 99px; padding: 3px 11px; vertical-align: 3px; }
  ul { list-style: none; padding: 0; margin: 0; }
  li { background: linear-gradient(180deg, #FFFFFF 0%, #FBFAF7 100%);
       border: 1px solid #DDD7CD; border-top-color: #EDE9E1; border-bottom-color: #CFC8BC;
       border-left: 4px solid #F97B33; border-right: 4px solid #E2DCD2;
       border-radius: 12px; padding: 14px 16px; margin-bottom: 11px;
       box-shadow: inset 0 1px 0 rgba(255,255,255,0.95), 0 2px 5px rgba(66,62,56,0.09), 0 7px 16px rgba(66,62,56,0.06);
       overflow-wrap: anywhere; }
  li:hover { border-left-color: #E8620F; box-shadow: inset 0 1px 0 rgba(255,255,255,0.95), 0 4px 9px rgba(66,62,56,0.13), 0 10px 22px rgba(66,62,56,0.08); }
  li a { color: #1B2233; text-decoration: none; font-weight: 700; font-size: 15.5px; line-height: 1.55; word-break: keep-all; overflow-wrap: anywhere; }
  li a:hover { color: #E8620F; }
  .meta { color: #67707F; font-size: 12.5px; margin-top: 5px; }
  .cta { display: block; text-align: center; background: linear-gradient(180deg, #FB8A47, #F26F1F); color: #fff; font-weight: 800; padding: 15px; border-radius: 11px; text-decoration: none; margin: 32px 0 8px; box-shadow: 0 4px 12px rgba(242,111,31,0.35); }
  .arch a { color: #3E63DD; text-decoration: none; margin-right: 12px; font-size: 13.5px; line-height: 2.1; display: inline-block; }
  footer { text-align: center; color: #8A8F9E; font-size: 12px; padding: 22px; }
</style>
</head>
<body>
<header>
  <a href="${SITE}/">WorkMentor</a>
  <p>일과 사람 그리고 정책 지원의 멘토 — 중소기업 실시간 정책·뉴스 아카이브</p>
</header>
<main>
${body}
<a class="cta" href="${SITE}/#lessons">⚡ 실시간 전체 뉴스·자료는 워크멘토 경영수업에서 보기</a>
</main>
<footer>워크멘토 · 대표 윤홍인 · 사업자등록번호 133-16-02411 · <a href="${SITE}/" style="color:#8A8F9E;">workmentor.co.kr</a></footer>
</body>
</html>`;
}

function fmtKST(s) {
  const d = new Date(s);
  if (isNaN(d)) return "";
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  const p = n => String(n).padStart(2, "0");
  return `${p(k.getUTCMonth() + 1)}.${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}
function digestBody(d) {
  const upKST = new Date(new Date(d.updatedAt).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
  let out = `<p style="color:#6C7386; font-size:13px;">수집 기준: ${esc(upKST)} (한국시간) · 15분마다 자동 갱신 · 출처: 각 언론사</p>`;
  for (const [key, name] of Object.entries(NAMES)) {
    const rows = (d.groups[key] || []).slice(0, 20);
    if (!rows.length) continue;
    out += `<h2>주요 뉴스<span class="cat">${name}</span></h2>\n`;
    if (NOTES[key]) out += `<p style="background:#FFF7EF; border:1px solid #F5CDAE; border-left:4px solid #F97B33; border-radius:10px; padding:12px 15px; font-size:13.5px; color:#5A4632; line-height:1.65;">💬 <b>워크멘토 해설</b> — ${esc(NOTES[key])}</p>\n`;
    out += `<ul>\n`;
    for (const x of rows) {
      out += `<li><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a>
<div class="meta">${esc(x.source)} · ${fmtKST(x.date)}</div></li>\n`;
    }
    out += `</ul>\n`;
  }
  return out;
}

mkdirSync("news", { recursive: true });
const body = digestBody(data);
const keywords = "중소기업 세무 노무 금융 법률 정책 뉴스";

writeFileSync(`news/${today}.html`,
  page(`${today} 중소기업 정책 뉴스 브리핑 — 세무·노무·금융·법률 | 워크멘토`,
       `${today} 기획재정부·국세청·고용노동부·금융위·공정위·중기부 관련 주요 뉴스 모음. ${keywords}`,
       `/news/${today}.html`, body));

const dates = readdirSync("news").filter(f => /^\d{4}-\d{2}-\d{2}\.html$/.test(f)).map(f => f.slice(0, 10)).sort().reverse();
const archive = `<h2>지난 브리핑 아카이브</h2><p class="arch">` +
  dates.slice(0, 30).map(dt => `<a href="${dt}.html">${dt}</a>`).join(" ") + `</p>`;

const wkBanner = `<a href="weekly.html" style="display:block; text-align:center; background:linear-gradient(180deg,#4A4540,#37332E); color:#FFD9BC; font-weight:800; padding:13px; border-radius:11px; text-decoration:none; margin:0 0 22px; box-shadow:0 3px 10px rgba(0,0,0,0.15);">🏆 이번 주 지원금·정책자금 TOP10 보러가기 →</a>`;
writeFileSync("news/index.html",
  page(`중소기업 정책 뉴스 브리핑 — 세무·노무·금융·법률 실시간 | 워크멘토`,
       `15분마다 갱신되는 중소기업 필수 정책 뉴스. 기획재정부, 국세청, 고용노동부, 금융위원회, 공정거래위원회, 중소벤처기업부 관련 최신 보도 모음.`,
       `/news/`, wkBanner + body + archive));

/* ── ② 이번 주 주목할 지원금·정책자금 TOP10 ── */
const kw = /지원|모집|자금|바우처|공고|신청|접수/;
const pool = ["money", "fund", "biz"].flatMap(k => (data.groups[k] || []).map(x => ({ ...x, g: k })));
const scored = pool.map(x => ({ ...x, s: (kw.test(x.title) ? 2 : 0) + (new Date(x.date).getTime() || 0) / 1e13 }))
  .sort((a, b) => b.s - a.s);
const seenT = new Set(); const top = [];
for (const x of scored) { const key = x.title.slice(0, 20); if (!seenT.has(key)) { seenT.add(key); top.push(x); } if (top.length >= 10) break; }
const wk = Math.ceil(kst.getUTCDate() / 7);
const wkLabel = `${kst.getUTCMonth() + 1}월 ${wk}주차`;
let wbody = `<p style="color:#6C7386; font-size:13px;">${wkLabel} · 정책자금·지원금 관련 주요 소식 TOP10 — 15분마다 자동 선별</p>`;
if (NOTES.money) wbody += `<p style="background:#FFF7EF; border:1px solid #F5CDAE; border-left:4px solid #F97B33; border-radius:10px; padding:12px 15px; font-size:13.5px; color:#5A4632;">💬 <b>워크멘토 해설</b> — ${esc(NOTES.money)}</p>`;
wbody += `<ul>` + top.map((x, i) => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener"><b style="color:#F26F1F;">${i + 1}.</b> ${esc(x.title)}</a><div class="meta">${esc(x.source)} · ${fmtKST(x.date)}</div></li>`).join("\n") + `</ul>`;
writeFileSync("news/weekly.html",
  page(`이번 주 지원금·정책자금 TOP10 (${wkLabel}) | 워크멘토`,
       `${wkLabel} 소상공인·중소기업이 주목할 정책자금, 지원금, 바우처 소식 TOP10. 매주 자동 갱신.`,
       `/news/weekly.html`, wbody));

/* ── ④ 네이버 블로그용 초안 (복사-붙여넣기 원고) ── */
const pick3 = k => (data.groups[k] || []).slice(0, 3);
const secTxt = (label, k) => {
  const rows = pick3(k);
  if (!rows.length) return "";
  let t = `■ ${label}\n`;
  for (const x of rows) t += `· ${x.title} (${x.source})\n  ${x.url}\n`;
  if (NOTES[k]) t += `💬 워크멘토 해설: ${NOTES[k]}\n`;
  return t + "\n";
};
const md = kst.getUTCMonth() + 1, dd = kst.getUTCDate();
const draft = `[제목 후보 — 하나 골라 쓰세요]
1) ${md}/${dd} 사장님 필독! 오늘의 지원금·세무·노무 뉴스 총정리
2) ${wkLabel} 소상공인 정책자금 소식 TOP — 놓치면 손해
3) 오늘의 중소기업 브리핑: 지원금·세무·노무 핵심만 (${md}.${dd})

[본문 — 아래부터 복사해서 붙여넣기]
안녕하세요, 기업 경영의 멘토 '워크멘토'입니다.
15분마다 자동 수집되는 중소기업 필수 뉴스 중 오늘의 핵심만 추렸습니다.

${secTxt("정책자금·지원금", "money")}${secTxt("세무·회계", "tax")}${secTxt("노무·인사", "labor")}${secTxt("중소기업 정책", "biz")}▶ 전체 실시간 브리핑 (15분마다 갱신)
https://www.workmentor.co.kr/news/

▶ 이번 주 지원금 TOP10 한눈에
https://www.workmentor.co.kr/news/weekly.html

▶ 우리 회사 맞춤 지원사업 찾기·기업 연결
https://www.workmentor.co.kr

#소상공인지원금 #정책자금 #중소기업 #부가세신고 #노무관리 #창업지원금 #워크멘토
`;
writeFileSync("news/naver-draft.txt", draft);

const urls = [`${SITE}/news/`, `${SITE}/news/weekly.html`, ...dates.slice(0, 60).map(dt => `${SITE}/news/${dt}.html`)];
writeFileSync("news/sitemap-news.xml",
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  urls.map(u => `  <url><loc>${u}</loc><lastmod>${today}</lastmod></url>`).join("\n") +
  `\n</urlset>`);

console.log(`news 페이지 생성 완료: index + ${today}.html + sitemap (아카이브 ${dates.length}일)`);
