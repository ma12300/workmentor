/* 워크멘토 뉴스 아카이브 생성기 — gov-feeds.json → news/ 정적 페이지 (SEO용)
   수집 로봇이 매 실행마다 함께 돌려 news/index.html, news/날짜.html, sitemap-news.xml 생성 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";

if (!existsSync("gov-feeds.json")) { console.log("gov-feeds.json 없음 — 건너뜀"); process.exit(0); }
const data = JSON.parse(readFileSync("gov-feeds.json", "utf-8"));
const SITE = "https://www.workmentor.co.kr";
const NAMES = { tax: "세무·회계", labor: "노무·인사", fund: "금융·관세", law: "법무·공정거래", biz: "중소기업 정책" };
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
  body { margin: 0; font-family: 'Pretendard', 'Malgun Gothic', sans-serif; background: #F7F5F1; color: #2A3142; }
  header { background: linear-gradient(180deg, #423E38, #37332E); color: #fff; padding: 26px 20px; text-align: center; }
  header a { color: #F97B33; text-decoration: none; font-weight: 800; font-size: 22px; }
  header p { margin: 8px 0 0; color: #D6D1C8; font-size: 13.5px; }
  main { max-width: 860px; margin: 0 auto; padding: 26px 16px 60px; }
  h2 { font-size: 19px; color: #1F2637; border-left: 4px solid #F97B33; padding-left: 10px; margin: 34px 0 12px; }
  ul { list-style: none; padding: 0; margin: 0; }
  li { background: #fff; border: 1px solid #E6E2DB; border-radius: 10px; padding: 13px 15px; margin-bottom: 9px; }
  li a { color: #1F2637; text-decoration: none; font-weight: 600; font-size: 15px; line-height: 1.5; }
  li a:hover { color: #F97B33; }
  .meta { color: #6C7386; font-size: 12px; margin-top: 4px; }
  .sum { color: #4A5265; font-size: 13px; margin: 6px 0 0; line-height: 1.6; }
  .cta { display: block; text-align: center; background: #F97B33; color: #fff; font-weight: 800; padding: 14px; border-radius: 10px; text-decoration: none; margin: 30px 0 8px; }
  .arch a { color: #3E63DD; text-decoration: none; margin-right: 12px; font-size: 13.5px; line-height: 2; display: inline-block; }
  footer { text-align: center; color: #8A8F9E; font-size: 12px; padding: 20px; }
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

function digestBody(d) {
  let out = `<p style="color:#6C7386; font-size:13px;">수집 기준: ${esc(d.updatedAt)} (30분마다 자동 갱신) · 출처: 각 언론사</p>`;
  for (const [key, name] of Object.entries(NAMES)) {
    const rows = (d.groups[key] || []).slice(0, 20);
    if (!rows.length) continue;
    out += `<h2>${name} 뉴스</h2>\n<ul>\n`;
    for (const x of rows) {
      out += `<li><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a>
<div class="meta">${esc(x.source)} · ${esc(String(x.date).slice(0, 16))}</div>
${x.summary ? `<p class="sum">${esc(x.summary.slice(0, 140))}</p>` : ""}</li>\n`;
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

writeFileSync("news/index.html",
  page(`중소기업 정책 뉴스 브리핑 — 세무·노무·금융·법률 실시간 | 워크멘토`,
       `30분마다 갱신되는 중소기업 필수 정책 뉴스. 기획재정부, 국세청, 고용노동부, 금융위원회, 공정거래위원회, 중소벤처기업부 관련 최신 보도 모음.`,
       `/news/`, body + archive));

const urls = [`${SITE}/news/`, ...dates.slice(0, 60).map(dt => `${SITE}/news/${dt}.html`)];
writeFileSync("news/sitemap-news.xml",
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  urls.map(u => `  <url><loc>${u}</loc><lastmod>${today}</lastmod></url>`).join("\n") +
  `\n</urlset>`);

console.log(`news 페이지 생성 완료: index + ${today}.html + sitemap (아카이브 ${dates.length}일)`);
