/* 워크멘토 아침 브리핑 PDF 생성기 v1
   gov-feeds.json → 핵심 뉴스 자동 선별 → briefings/YYYY-MM-DD.pdf + index.json
   GitHub Actions에서 매일 아침 실행 (한글 폰트: fonts-noto-cjk 필요)
   실행: node scripts/build-briefing.mjs  (저장소 루트 기준) */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, existsSync } from "node:fs";
import PDFDocument from "pdfkit";

/* ───────── 설정 ───────── */
const SITE = "https://www.workmentor.co.kr";
const SUPA = "https://aggndijeezodnfrnqpwp.supabase.co";
const SUPA_KEY = "sb_publishable_gAJZTg5K7lS39m-4nkcQpw_GRaHWqk4";
const NAMES = { money: "정책자금·지원금", tax: "세무·회계", labor: "노무·인사", guide: "세무·노무 실무", fund: "금융·관세", law: "법무·공정거래", biz: "중소기업 정책" };
const KW = /지원|모집|자금|바우처|공고|신청|접수/;   /* 중소기업 실익 키워드 (build-news-v3와 동일) */
const KEEP_DAYS = 60;                                /* 보존 일수 — 저장소 용량 상한 */
const BRAND = "#F26F1F", INK = "#1F2430", SUB = "#6C7386", LINE = "#E5E8EF", GOLD = "#B98A2F";

const FONT_R = [process.env.BRIEF_FONT, "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"].filter(Boolean);
const FONT_B = [process.env.BRIEF_FONT_BOLD, "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"].filter(Boolean);

/* ───────── 데이터 준비 ───────── */
if (!existsSync("gov-feeds.json")) { console.error("gov-feeds.json 없음 — 수집이 먼저 실행되어야 합니다"); process.exit(1); }
const data = JSON.parse(readFileSync("gov-feeds.json", "utf-8"));

const kst = new Date(Date.now() + 9 * 3600 * 1000);
const ymd = kst.toISOString().slice(0, 10);
const [Y, M, D] = ymd.split("-").map(Number);
const WD = ["일", "월", "화", "수", "목", "금", "토"][kst.getUTCDay()];
const HH = String(kst.getUTCHours()).padStart(2, "0"), MI = String(kst.getUTCMinutes()).padStart(2, "0");

function fmtKST(s) {
  const d = new Date(s);
  if (isNaN(d)) return "";
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  const p = n => String(n).padStart(2, "0");
  return `${p(k.getUTCMonth() + 1)}.${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}
const tOf = x => { const d = new Date(x.date); return isNaN(d) ? 0 : d.getTime(); };
const dedupeKey = t => String(t || "").replace(/\s+/g, "").slice(0, 22);

/* 오늘의 TOP: 전 그룹 풀 → 키워드 가점 + 최신성 → 상위 7 (제목 중복 제거) */
const pool = [];
for (const [key, rows] of Object.entries(data.groups || {})) {
  for (const x of rows || []) pool.push({ ...x, group: key });
}
const scored = pool
  .map(x => ({ ...x, s: (KW.test(x.title) ? 2 : 0) + tOf(x) / 1e13 }))
  .sort((a, b) => b.s - a.s);
const seen = new Set(), TOP = [];
for (const x of scored) {
  const k = dedupeKey(x.title);
  if (seen.has(k)) continue;
  seen.add(k); TOP.push(x);
  if (TOP.length >= 7) break;
}

/* 분류별 최신 3건 (TOP과 중복 제외) */
const SECTIONS = [];
for (const [key, name] of Object.entries(NAMES)) {
  const rows = (data.groups?.[key] || []).filter(x => !seen.has(dedupeKey(x.title))).slice(0, 3);
  rows.forEach(x => seen.add(dedupeKey(x.title)));
  if (rows.length) SECTIONS.push({ name, rows });
}

/* 워크멘토 해설 (관리자가 사이트에서 작성한 gov_notes — 실패해도 계속) */
let NOTES = {};
try {
  const r = await fetch(SUPA + "/rest/v1/gov_notes?select=group_key,note", {
    headers: { apikey: SUPA_KEY, Authorization: "Bearer " + SUPA_KEY },
    signal: AbortSignal.timeout(10000),
  });
  if (r.ok) for (const row of await r.json()) if (row.note) NOTES[row.group_key] = row.note;
} catch (_) { /* 해설 없이 진행 */ }

if (!TOP.length) { console.error("선별된 뉴스 0건 — 브리핑 생성 중단"); process.exit(1); }

/* ───────── PDF 생성 ───────── */
mkdirSync("briefings", { recursive: true });
const doc = new PDFDocument({ size: "A4", margins: { top: 54, bottom: 60, left: 48, right: 48 }, bufferPages: true, info: { Title: `워크멘토 아침 브리핑 ${ymd}`, Author: "워크멘토" } });
const out = `briefings/${ymd}.pdf`;
const chunks = [];
doc.on("data", c => chunks.push(c));

let fontOK = false;
for (let i = 0; i < FONT_R.length && !fontOK; i++) {
  try { doc.registerFont("KR", FONT_R[i], "NotoSansCJKkr-Regular"); doc.registerFont("KRB", FONT_B[i] || FONT_R[i], "NotoSansCJKkr-Bold"); fontOK = true; } catch (_) {}
}
if (!fontOK) { console.error("한글 폰트 로드 실패 — 워크플로의 fonts-noto-cjk 설치 단계를 확인하세요"); process.exit(1); }

const W = doc.page.width, L = doc.page.margins.left, R = W - doc.page.margins.right, CW = R - L;
const bottomY = () => doc.page.height - doc.page.margins.bottom;
function ensure(h) { if (doc.y + h > bottomY()) doc.addPage(); }

/* 헤더 밴드 */
doc.rect(0, 0, W, 6).fill(BRAND);
doc.moveDown(0.2);
doc.font("KRB").fontSize(21).fillColor(INK).text("워크멘토 아침 브리핑", L, 34);
doc.font("KRB").fontSize(11).fillColor(BRAND).text("WorkMentor", L, 40, { width: CW, align: "right" });
doc.font("KR").fontSize(10).fillColor(SUB).text(`${Y}년 ${M}월 ${D}일 (${WD}) · ${HH}:${MI} 발행 · 중소기업 필수 정책·경영 뉴스`, L, doc.y + 2);
doc.moveTo(L, doc.y + 8).lineTo(R, doc.y + 8).lineWidth(0.8).strokeColor(LINE).stroke();
doc.y += 16;

/* 섹션 1 — 오늘의 핵심 */
doc.font("KRB").fontSize(13.5).fillColor(BRAND).text("오늘의 핵심");
doc.y += 4;
TOP.forEach((x, i) => {
  ensure(44);
  const y0 = doc.y;
  doc.font("KRB").fontSize(11.5).fillColor(BRAND).text(String(i + 1), L, y0, { width: 16 });
  doc.font("KRB").fontSize(11.5).fillColor(INK).text(x.title, L + 20, y0, { width: CW - 20, link: x.url || undefined });
  doc.font("KR").fontSize(8.5).fillColor(SUB).text(`${NAMES[x.group] || ""} · ${x.source || "언론 보도"} · ${fmtKST(x.date)}`, L + 20, doc.y + 1, { width: CW - 20 });
  doc.y += 7;
});

/* 섹션 2 — 분류별 주요 소식 */
doc.y += 4; ensure(60);
doc.font("KRB").fontSize(13.5).fillColor(BRAND).text("분류별 주요 소식", L);
doc.y += 4;
for (const sec of SECTIONS) {
  ensure(52);
  doc.font("KRB").fontSize(11).fillColor(INK).text(sec.name, L);
  doc.moveTo(L, doc.y + 2).lineTo(L + 64, doc.y + 2).lineWidth(1.4).strokeColor(BRAND).stroke();
  doc.y += 7;
  for (const x of sec.rows) {
    ensure(30);
    const y0 = doc.y;
    doc.font("KR").fontSize(10).fillColor(BRAND).text("●", L + 2, y0 + 1, { width: 10 });
    doc.font("KR").fontSize(10.5).fillColor(INK).text(x.title, L + 14, y0, { width: CW - 14, link: x.url || undefined });
    doc.font("KR").fontSize(8.5).fillColor(SUB).text(`${x.source || "언론 보도"} · ${fmtKST(x.date)}`, L + 14, doc.y + 1, { width: CW - 14 });
    doc.y += 6;
  }
  /* 해설 박스 */
  const noteKey = Object.entries(NAMES).find(([, n]) => n === sec.name)?.[0];
  const note = noteKey && NOTES[noteKey];
  if (note) {
    ensure(40);
    const y0 = doc.y;
    const nh = doc.font("KR").fontSize(9.5).heightOfString(note, { width: CW - 26 }) + 16;
    doc.rect(L, y0, CW, nh).fillColor("#FFF7EE").fill();
    doc.rect(L, y0, 3, nh).fillColor(GOLD).fill();
    doc.font("KRB").fontSize(9).fillColor(GOLD).text("워크멘토 해설", L + 12, y0 + 6);
    doc.font("KR").fontSize(9.5).fillColor(INK).text(note, L + 12, doc.y + 1, { width: CW - 26 });
    doc.y = y0 + nh + 8;
  }
  doc.y += 4;
}

/* 푸터 (전 페이지) — 하단 여백을 임시 해제해 자동 페이지 추가 방지 */
const range = doc.bufferedPageRange();
for (let i = range.start; i < range.start + range.count; i++) {
  doc.switchToPage(i);
  const ob = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  const fy = doc.page.height - 40;
  doc.moveTo(L, fy - 6).lineTo(R, fy - 6).lineWidth(0.6).strokeColor(LINE).stroke();
  doc.font("KR").fontSize(8).fillColor(SUB)
    .text(`workmentor.co.kr · 출처: 각 언론사(구글뉴스 검색) · 본 브리핑은 자동 생성·선별되었습니다 · 유료회원 전용`, L, fy, { width: CW, align: "left", lineBreak: false });
  doc.text(`${i + 1} / ${range.count}`, L, fy, { width: CW, align: "right", lineBreak: false });
  doc.page.margins.bottom = ob;
}

doc.end();
await new Promise(res => doc.on("end", res));
writeFileSync(out, Buffer.concat(chunks));
console.log(`PDF 생성: ${out} (${Buffer.concat(chunks).length.toLocaleString()} bytes, TOP ${TOP.length}건 + ${SECTIONS.length}개 분류)`);

/* ───────── index.json 갱신 + 보존 정책 ───────── */
const idxPath = "briefings/index.json";
let idx = [];
try { idx = JSON.parse(readFileSync(idxPath, "utf-8")); } catch (_) {}
idx = idx.filter(b => b.date !== ymd);   /* 같은 날 재실행 → 교체 */
idx.unshift({ date: ymd, title: `${M}월 ${D}일 (${WD}) 아침 브리핑`, file: `briefings/${ymd}.pdf`, top: TOP[0].title, count: TOP.length + SECTIONS.reduce((s, x) => s + x.rows.length, 0) });
idx = idx.slice(0, KEEP_DAYS);
writeFileSync(idxPath, JSON.stringify(idx, null, 1));

/* 오래된 PDF 삭제 (index에 없는 파일) */
const kept = new Set(idx.map(b => b.file.split("/").pop()));
for (const f of readdirSync("briefings")) {
  if (/^\d{4}-\d{2}-\d{2}\.pdf$/.test(f) && !kept.has(f)) { try { unlinkSync("briefings/" + f); console.log("보존 기간 경과 삭제:", f); } catch (_) {} }
}
console.log(`index.json 갱신: ${idx.length}건 보관`);
