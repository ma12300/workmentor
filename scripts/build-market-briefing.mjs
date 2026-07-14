/* 워크멘토 투자 브리핑 생성기 v1 — 아침판·저녁판·자정판 (하루 3회)
   구글뉴스 RSS 수집(순수 코드, LLM·API키 불필요) → 챕터별 선별 → briefings/YYYY-MM-DD-market-{판}.pdf
   GitHub Actions에서 실행 (한글 폰트: fonts-noto-cjk 필요) · 같은 날 앞선 판과 중복 기사 자동 제거
   실행: node scripts/build-market-briefing.mjs   테스트: MARKET_MOCK=1 node scripts/build-market-briefing.mjs */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import PDFDocument from "pdfkit";

/* ───────── 설정 ───────── */
const BRAND = "#F26F1F", INK = "#1F2430", SUB = "#6C7386", LINE = "#E5E8EF", NAVY = "#25436B";
const FRESH_H = 36;              /* 신선도 창(시간) — 이보다 오래된 기사는 제외 */
const PER_TOPIC = 4;             /* 토픽당 최대 기사 수 */
const TOP_N = 7;                 /* 오늘의 핵심 건수 */
const KEEP_ENTRIES = 240;        /* index.json 보존 건수(정책+투자 공용) */

const CHAPTERS = [
  { name: "제1장 미국 증시", topics: [
    ["S&P500·미국 증시", "S&P500 미국증시 다우"],
    ["나스닥·기술주", "나스닥 지수 기술주"],
    ["ETF 자금 동향", "미국 ETF 자금 유입"],
    ["연준·미국 금리", "연준 FOMC 파월 금리"],
  ]},
  { name: "제2장 빅테크·테마", topics: [
    ["매그니피센트7", "엔비디아 애플 마이크로소프트 아마존 메타 알파벳 주가"],
    ["테슬라·일론 머스크", "테슬라 일론머스크"],
    ["IT·AI 산업", "AI 인공지능 반도체 산업"],
    ["최신 테마·트렌드", "테마주 신성장 산업 트렌드"],
  ]},
  { name: "제3장 매크로·원자재", topics: [
    ["금융 일반", "금융시장 국채 금리 동향"],
    ["환율", "원달러 환율 외환시장"],
    ["원자재", "국제유가 금값 구리 원자재"],
  ]},
  { name: "제4장 국내 시장", topics: [
    ["국내 증시", "코스피 코스닥 외국인 수급"],
    ["코스피 주요 기업", "삼성전자 SK하이닉스 현대차 LG에너지솔루션"],
    ["국내 부동산", "부동산 아파트 분양 시장"],
    ["국내 대출·가계부채", "가계대출 주택담보대출 대출규제"],
  ]},
  { name: "제5장 가상화폐·규제", topics: [
    ["비트코인", "비트코인 시세 BTC"],
    ["이더리움·알트코인", "이더리움 알트코인 ETH"],
    ["가상화폐 일반", "가상화폐 코인 거래소 규제"],
    ["미국 크립토 입법", "GENIUS Act CLARITY 법안 스테이블코인 입법"],
  ]},
];

/* ───────── 시간·판 결정 (KST) ───────── */
const kst = new Date(Date.now() + 9 * 3600 * 1000);
const ymd = kst.toISOString().slice(0, 10);
const [Y, M, D] = ymd.split("-").map(Number);
const WD = ["일", "월", "화", "수", "목", "금", "토"][kst.getUTCDay()];
const H = kst.getUTCHours(), MI = String(kst.getUTCMinutes()).padStart(2, "0");
const EDITION = H >= 5 && H < 13 ? "아침판" : H >= 13 && H < 21 ? "저녁판" : "자정판";

const p2 = n => String(n).padStart(2, "0");
function fmtKST(s) {
  const d = new Date(s); if (isNaN(d)) return "";
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  return `${p2(k.getUTCMonth() + 1)}.${p2(k.getUTCDate())} ${p2(k.getUTCHours())}:${p2(k.getUTCMinutes())}`;
}
const dedupeKey = t => String(t || "").replace(/\s+/g, "").slice(0, 22);
const decode = s => String(s || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();

/* ───────── 수집 (구글뉴스 RSS, 의존성 없음) ───────── */
async function fetchTopic(q) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=ko&gl=KR&ceid=KR:ko`;
  try {
    const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 workmentor-briefing" }, signal: AbortSignal.timeout(12000) });
    if (!r.ok) return [];
    const xml = await r.text();
    const items = [];
    for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const b = m[1];
      const title = decode((b.match(/<title>([\s\S]*?)<\/title>/) || [])[1]);
      const link = decode((b.match(/<link>([\s\S]*?)<\/link>/) || [])[1]);
      const date = decode((b.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1]);
      const source = decode((b.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1]);
      if (title) items.push({ title, url: link, date, source });
    }
    return items;
  } catch (_) { return []; }
}

function mockTopic(name, i) {
  return Array.from({ length: 3 }, (_, j) => ({
    title: `[목데이터] ${name} 관련 주요 뉴스 헤드라인 예시 ${j + 1} — 시장 흐름 점검`,
    url: "https://www.workmentor.co.kr",
    date: new Date(Date.now() - (j + i) * 3600e3).toUTCString(),
    source: "테스트통신",
  }));
}

const MOCK = process.env.MARKET_MOCK === "1";
const now = Date.now(), freshMs = FRESH_H * 3600e3;
const tOf = x => { const d = new Date(x.date); return isNaN(d) ? 0 : d.getTime(); };

/* 같은 날 앞선 판에서 이미 실은 기사 키 (중복 발행 방지) */
mkdirSync("briefings", { recursive: true });
const seenPath = "briefings/market-seen.json";
let seenState = { date: ymd, keys: [] };
try { const s = JSON.parse(readFileSync(seenPath, "utf-8")); if (s.date === ymd) seenState = s; } catch (_) {}
const seen = new Set(seenState.keys);

const chapters = [];
let total = 0;
for (let ci = 0; ci < CHAPTERS.length; ci++) {
  const ch = { name: CHAPTERS[ci].name, sections: [] };
  for (const [label, q] of CHAPTERS[ci].topics) {
    let rows = MOCK ? mockTopic(label, ci) : await fetchTopic(q);
    rows = rows
      .filter(x => now - tOf(x) < freshMs)
      .sort((a, b) => tOf(b) - tOf(a))
      .filter(x => { const k = dedupeKey(x.title); if (seen.has(k)) return false; seen.add(k); return true; })
      .slice(0, PER_TOPIC);
    ch.sections.push({ label, rows });
    total += rows.length;
  }
  if (ch.sections.some(s => s.rows.length)) chapters.push(ch);
}

if (total === 0) { console.error("새 뉴스 0건 — 이번 판 발행 생략(정상 종료)"); process.exit(0); }

/* 오늘의 핵심: 전체에서 최신순 TOP_N (챕터 다양성 우선) */
const TOP = [];
outer: for (let round = 0; TOP.length < TOP_N && round < PER_TOPIC; round++) {
  for (const ch of chapters) for (const s of ch.sections) {
    const x = s.rows[round];
    if (x && !TOP.includes(x)) { TOP.push({ ...x, cat: s.label }); if (TOP.length >= TOP_N) break outer; }
  }
}

/* ───────── PDF ───────── */
const FONT_R = [process.env.BRIEF_FONT, "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"].filter(Boolean);
const FONT_B = [process.env.BRIEF_FONT_BOLD, "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", "/usr/share/fonts/opentype/noto/NotoSansCJK-Black.ttc", ...FONT_R].filter(Boolean);
const doc = new PDFDocument({ size: "A4", margins: { top: 54, bottom: 60, left: 48, right: 48 }, bufferPages: true, info: { Title: `워크멘토 투자 브리핑 ${ymd} ${EDITION}`, Author: "워크멘토" } });
const out = `briefings/${ymd}-market-${EDITION}.pdf`;
const chunks = [];
doc.on("data", c => chunks.push(c));

let ok = false;
for (const f of FONT_R) { try { doc.registerFont("KR", f, "NotoSansCJKkr-Regular"); ok = true; break; } catch (_) {} }
if (!ok) { console.error("한글 폰트 로드 실패"); process.exit(1); }
ok = false;
for (const f of FONT_B) { try { doc.registerFont("KRB", f, "NotoSansCJKkr-Bold"); ok = true; break; } catch (_) { try { doc.registerFont("KRB", f, "NotoSansCJKkr-Black"); ok = true; break; } catch (_) {} } }
if (!ok) doc.registerFont("KRB", FONT_R[FONT_R.length - 1], "NotoSansCJKkr-Regular");

const W = doc.page.width, L = doc.page.margins.left, R = W - doc.page.margins.right, CW = R - L;
const bottomY = () => doc.page.height - doc.page.margins.bottom;
function ensure(h) { if (doc.y + h > bottomY()) doc.addPage(); }

/* 헤더 */
doc.rect(0, 0, W, 6).fill(NAVY);
doc.font("KRB").fontSize(21).fillColor(INK).text(`워크멘토 투자 브리핑 · ${EDITION}`, L, 34);
doc.font("KRB").fontSize(11).fillColor(NAVY).text("WorkMentor Market", L, 40, { width: CW, align: "right" });
doc.font("KR").fontSize(10).fillColor(SUB).text(`${Y}년 ${M}월 ${D}일 (${WD}) · ${p2(H)}:${MI} 발행 · 미국증시·빅테크·매크로·국내·가상화폐 ${total}건`, L, doc.y + 2);
doc.moveTo(L, doc.y + 8).lineTo(R, doc.y + 8).lineWidth(0.8).strokeColor(LINE).stroke();
doc.y += 16;

/* 오늘의 핵심 */
doc.font("KRB").fontSize(13.5).fillColor(NAVY).text(`${EDITION} 핵심 ${TOP.length}`);
doc.y += 4;
TOP.forEach((x, i) => {
  ensure(44);
  const y0 = doc.y;
  doc.font("KRB").fontSize(11.5).fillColor(NAVY).text(String(i + 1), L, y0, { width: 16 });
  doc.font("KRB").fontSize(11.5).fillColor(INK).text(x.title, L + 20, y0, { width: CW - 20, link: x.url || undefined });
  doc.font("KR").fontSize(8.5).fillColor(SUB).text(`${x.cat} · ${x.source || "언론 보도"} · ${fmtKST(x.date)}`, L + 20, doc.y + 1, { width: CW - 20 });
  doc.y += 7;
});

/* 챕터 */
for (const ch of chapters) {
  doc.y += 6; ensure(70);
  doc.rect(L, doc.y, CW, 24).fillColor("#F0F3F8").fill();
  doc.font("KRB").fontSize(12.5).fillColor(NAVY).text(ch.name, L + 10, doc.y + 6);
  doc.y += 32;
  for (const s of ch.sections) {
    if (!s.rows.length) continue;
    ensure(50);
    doc.font("KRB").fontSize(11).fillColor(INK).text(s.label, L);
    doc.moveTo(L, doc.y + 2).lineTo(L + 64, doc.y + 2).lineWidth(1.4).strokeColor(BRAND).stroke();
    doc.y += 7;
    for (const x of s.rows) {
      ensure(30);
      const y0 = doc.y;
      doc.font("KR").fontSize(10).fillColor(BRAND).text("●", L + 2, y0 + 1, { width: 10 });
      doc.font("KR").fontSize(10.5).fillColor(INK).text(x.title, L + 14, y0, { width: CW - 14, link: x.url || undefined });
      doc.font("KR").fontSize(8.5).fillColor(SUB).text(`${x.source || "언론 보도"} · ${fmtKST(x.date)}`, L + 14, doc.y + 1, { width: CW - 14 });
      doc.y += 6;
    }
    doc.y += 4;
  }
}

/* 푸터 */
const range = doc.bufferedPageRange();
for (let i = range.start; i < range.start + range.count; i++) {
  doc.switchToPage(i);
  const ob = doc.page.margins.bottom; doc.page.margins.bottom = 0;
  const fy = doc.page.height - 40;
  doc.moveTo(L, fy - 6).lineTo(R, fy - 6).lineWidth(0.6).strokeColor(LINE).stroke();
  doc.font("KR").fontSize(8).fillColor(SUB)
    .text(`workmentor.co.kr · 출처: 각 언론사(구글뉴스 검색) · 자동 생성·선별 · 투자 판단의 책임은 이용자에게 있습니다`, L, fy, { width: CW, align: "left", lineBreak: false });
  doc.text(`${i + 1} / ${range.count}`, L, fy, { width: CW, align: "right", lineBreak: false });
  doc.page.margins.bottom = ob;
}

doc.end();
await new Promise(res => doc.on("end", res));
writeFileSync(out, Buffer.concat(chunks));
console.log(`PDF 생성: ${out} (${Buffer.concat(chunks).length.toLocaleString()} bytes, 핵심 ${TOP.length} + 총 ${total}건, ${chapters.length}개 장)`);

/* seen 상태 저장 (다음 판 중복 방지) */
writeFileSync(seenPath, JSON.stringify({ date: ymd, keys: [...seen].slice(-2000) }));

/* index.json 갱신 (정책 브리핑과 공용) */
const idxPath = "briefings/index.json";
let idx = [];
try { idx = JSON.parse(readFileSync(idxPath, "utf-8")); } catch (_) {}
idx = idx.filter(b => !(b.date === ymd && b.edition === EDITION && b.kind === "market"));
idx.unshift({ date: ymd, kind: "market", edition: EDITION, title: `${M}월 ${D}일 (${WD}) 투자 브리핑 · ${EDITION}`, file: out, top: TOP[0].title, count: total });
idx = idx.slice(0, KEEP_ENTRIES);
writeFileSync(idxPath, JSON.stringify(idx, null, 1));

/* 보존: index에 없는 market PDF 삭제 */
const kept = new Set(idx.map(b => (b.file || "").split("/").pop()));
for (const f of readdirSync("briefings")) {
  if (/-market-.+\.pdf$/.test(f) && !kept.has(f)) { try { unlinkSync("briefings/" + f); console.log("보존 기간 경과 삭제:", f); } catch (_) {} }
}
console.log(`index.json 갱신 완료 (${EDITION})`);
