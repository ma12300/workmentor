/* 워크멘토 월간 맞춤 브리핑 이메일 발송기
   회원별 관심 데이터(activity) → 키워드 산출 → 지원사업(gov-feeds.json) 매칭 → 월 1회 이메일
   실행(GitHub Actions): node scripts/send-monthly-digest.mjs
   환경변수:
     SUPABASE_SERVICE_ROLE_KEY  (필수·시크릿) Supabase 서비스 키
     RESEND_API_KEY             (필수·시크릿) Resend 이메일 API 키
     MAIL_FROM   기본 "워크멘토 <onboarding@resend.dev>" — 도메인 인증 후 briefing@workmentor.co.kr 권장
     DRY_RUN=1   발송 없이 미리보기(digest-previews/)만 생성
     TEST_TO     지정 시 모든 메일을 이 주소로만 발송(테스트)
     MOCK=1      가짜 회원·활동 데이터로 로컬 테스트 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const SB_URL = process.env.SUPABASE_URL || "https://aggndijeezodnfrnqpwp.supabase.co";
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const RESEND = process.env.RESEND_API_KEY || "";
const FROM = process.env.MAIL_FROM || "워크멘토 <onboarding@resend.dev>";
const DRY = process.env.DRY_RUN === "1";
const TEST_TO = process.env.TEST_TO || "";
const MOCK = process.env.MOCK === "1";
const DAYS = 30, TOP_KW = 8, TOP_ITEMS = 8;

const GROUP_LABEL = { fund: "정책자금·지원금", biz: "중소기업 정책", tax: "세무·회계", labor: "노무·인사", money: "금융·관세", law: "법무·공정거래", guide: "교육·행사" };
const STOP = new Set(["지원","사업","공고","모집","안내","선정","계획","공모","신청","관련","위한","대상","기업","중소기업","및","제","차","년","월","일","the","and","for","억원","만원"]);

async function sbGet(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, authorization: `Bearer ${SB_KEY}` }, signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`Supabase ${path} → HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

/* ── 1. 데이터 로드 ───────────────────────────── */
let members, activity, companies;
if (MOCK) {
  members = [
    { id: "m1", company_name: "이강씨푸드", ceo_name: "이강", email: "test1@example.com", tier: "paid", approved: true },
    { id: "m2", company_name: "테크브릿지", ceo_name: "김브릿", email: "test2@example.com", tier: "free", approved: true },
  ];
  companies = [{ id: 1, name: "이강씨푸드" }, { id: 2, name: "테크브릿지" }];
  const now = Date.now();
  activity = [
    ...Array.from({ length: 6 }, (_, i) => ({ company_id: 1, kind: "지원사업", title: `수출바우처 물류 지원사업 공고 ${i}`, tags: "수출,물류,바우처", created_at: new Date(now - i * 86400e3).toISOString() })),
    ...Array.from({ length: 4 }, (_, i) => ({ company_id: 1, kind: "최신 정보", title: `수산식품 수출 판로 개척 세미나 ${i}`, tags: "수출,식품", created_at: new Date(now - i * 86400e3).toISOString() })),
    ...Array.from({ length: 5 }, (_, i) => ({ company_id: 2, kind: "지원사업", title: `AI 바우처 소프트웨어 개발 지원 ${i}`, tags: "AI,소프트웨어,바우처", created_at: new Date(now - i * 86400e3).toISOString() })),
  ];
} else {
  if (!SB_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY 미설정"); process.exit(1); }
  const since = new Date(Date.now() - DAYS * 86400e3).toISOString();
  members = await sbGet("members?select=id,company_name,ceo_name,email,tier,approved&approved=eq.true&order=created_at.desc&limit=1000");
  activity = await sbGet(`activity?select=company_id,kind,title,tags,created_at&created_at=gte.${since}&order=created_at.desc&limit=8000`);
  companies = await sbGet("companies?select=id,name&limit=2000");
}
members = members.filter(m => m.email && /.+@.+\..+/.test(m.email));

const feeds = JSON.parse(readFileSync("gov-feeds.json", "utf-8"));
const allItems = [];
for (const [g, arr] of Object.entries(feeds.groups || {})) {
  for (const it of arr || []) allItems.push({ ...it, group: g });
}
console.log(`회원 ${members.length}명 · 활동 ${activity.length}건 · 지원사업/정보 ${allItems.length}건 로드`);

/* ── 2. 회원 ↔ 활동 매칭 (기업명 정규화 비교) ───── */
const norm = s => String(s || "").replace(/\(주\)|주식회사|\s+/g, "").toLowerCase();
const coById = new Map(companies.map(c => [c.id, norm(c.name)]));
const actByCo = new Map(); // normName → rows
for (const a of activity) {
  const key = coById.get(a.company_id);
  if (!key) continue;
  if (!actByCo.has(key)) actByCo.set(key, []);
  actByCo.get(key).push(a);
}

/* ── 3. 키워드 산출 (관리자 관심 분석과 동일 로직) ─ */
function keywordsOf(rows) {
  const kw = {};
  for (const r of rows) {
    String(r.tags || "").split(",").map(s => s.trim()).filter(s => s.length >= 2 && !STOP.has(s)).forEach(t => kw[t] = (kw[t] || 0) + 3);
    String(r.title || "").split(/[^가-힣A-Za-z0-9]+/).filter(w => w.length >= 2 && !STOP.has(w) && !/^\d+$/.test(w)).forEach(w => kw[w] = (kw[w] || 0) + 1);
  }
  return Object.entries(kw).sort((a, b) => b[1] - a[1]).slice(0, TOP_KW);
}
const globalKw = keywordsOf(activity);
const globalTop = allItems.filter(i => i.group === "fund" || i.group === "biz").slice(0, 5);

/* ── 4. 회원별 맞춤 매칭 ─────────────────────── */
function matchItems(kws) {
  const scored = [];
  for (const it of allItems) {
    const text = (it.title + " " + (it.summary || ""));
    let score = 0; const hits = [];
    for (const [k, w] of kws) if (text.includes(k)) { score += w; hits.push(k); }
    if (it.group === "fund" || it.group === "biz") score *= 1.5; // 지원사업 우대
    if (score > 0) scored.push({ ...it, score, hits });
  }
  scored.sort((a, b) => b.score - a.score);
  /* 유사 기사 중복 제거(제목 앞 16자) + 같은 분야 쏠림 방지(분야당 최대 3건) */
  const seen = new Set(), perGroup = {}, out = [];
  const tokens = t => new Set(String(t).split(/[^가-힣A-Za-z0-9]+/).filter(w => w.length >= 2));
  for (const it of scored) {
    const key = String(it.title).replace(/\s+/g, "").slice(0, 16);
    if (seen.has(key)) continue;
    if ((perGroup[it.group] || 0) >= 3) continue;
    /* 2차: 이미 채택된 기사와 단어 60% 이상 겹치면 유사 기사로 보고 제외 */
    const tk = tokens(it.title);
    const similar = out.some(o => {
      const ot = tokens(o.title);
      let overlap = 0; tk.forEach(w => { if (ot.has(w)) overlap++; });
      return overlap / Math.max(1, Math.min(tk.size, ot.size)) >= 0.6;
    });
    if (similar) continue;
    seen.add(key); perGroup[it.group] = (perGroup[it.group] || 0) + 1;
    out.push(it);
    if (out.length >= TOP_ITEMS) break;
  }
  return out;
}

/* ── 5. 이메일 HTML ─────────────────────────── */
const kstNow = new Date(Date.now() + 9 * 3600e3);
const MONTH = `${kstNow.getUTCFullYear()}년 ${kstNow.getUTCMonth() + 1}월`;
const esc = s => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function emailHtml(m, kws, items, personalized) {
  const chip = k => `<span style="display:inline-block;background:#FFF3E9;color:#E06423;border-radius:20px;padding:3px 12px;font-size:12px;font-weight:700;margin:0 6px 6px 0;">${esc(k)}</span>`;
  const row = it => `
    <tr><td style="padding:12px 0;border-bottom:1px solid #EEF1F6;">
      <a href="${esc(it.url)}" style="color:#172648;font-size:15px;font-weight:700;text-decoration:none;">${esc(it.title)}</a><br/>
      <span style="font-size:12px;color:#8A93A6;">${esc(GROUP_LABEL[it.group] || it.group)} · ${esc(it.source || "")}</span>
      ${it.hits && it.hits.length ? `<span style="font-size:12px;color:#E06423;font-weight:700;"> · ⭐ ${esc(it.hits.slice(0, 3).join(", "))} 일치</span>` : ""}
    </td></tr>`;
  return `<!DOCTYPE html><html lang="ko"><body style="margin:0;background:#F5F6FA;font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 12px;">
  <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:14px;overflow:hidden;">
    <tr><td style="background:#172648;padding:26px 30px;">
      <p style="margin:0;color:#F97833;font-size:12px;font-weight:800;letter-spacing:2px;">WORKMENTOR MONTHLY</p>
      <p style="margin:6px 0 0;color:#fff;font-size:21px;font-weight:800;">${MONTH} 맞춤 지원사업 브리핑</p>
      <p style="margin:8px 0 0;color:#B9C3D8;font-size:13px;">${esc(m.company_name || "회원")}님을 위해 지난 한 달 관심 분야를 분석해 준비했습니다.</p>
    </td></tr>
    <tr><td style="padding:24px 30px 8px;">
      <p style="margin:0 0 10px;font-size:14px;font-weight:800;color:#172648;">${personalized ? "우리 회사 관심 키워드" : "이번 달 전체 회원 관심 키워드"}</p>
      <div>${kws.map(([k]) => chip(k)).join("")}</div>
    </td></tr>
    <tr><td style="padding:16px 30px 6px;">
      <p style="margin:0 0 4px;font-size:14px;font-weight:800;color:#172648;">${personalized ? "맞춤 추천 지원사업·정보" : "이번 달 주요 지원사업"} <span style="color:#F97833;">${items.length}건</span></p>
      <table width="100%" cellpadding="0" cellspacing="0">${items.map(row).join("")}</table>
    </td></tr>
    <tr><td style="padding:18px 30px 26px;">
      <a href="https://www.workmentor.co.kr" style="display:inline-block;background:#F97833;color:#fff;font-size:14px;font-weight:800;text-decoration:none;padding:12px 22px;border-radius:9px;">워크멘토에서 자세히 보기</a>
      <p style="margin:16px 0 0;font-size:11.5px;color:#9AA3B5;line-height:1.7;">본 메일은 워크멘토 회원에게 월 1회 발송됩니다. 열람 기록 기반 자동 분석·선별로 작성되었습니다.<br/>수신을 원치 않으시면 이 메일에 회신해 주세요. · 워크멘토 · workmentor.co.kr</p>
    </td></tr>
  </table></td></tr></table></body></html>`;
}

/* ── 6. 발송 ────────────────────────────────── */
async function sendMail(to, subject, html) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${RESEND}`, "content-type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], subject, html }),
    signal: AbortSignal.timeout(20000),
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`Resend HTTP ${r.status}: ${body.slice(0, 200)}`);
  return JSON.parse(body).id;
}

mkdirSync("digest-previews", { recursive: true });
let sent = 0, previewed = 0, failed = 0, generic = 0;
for (const m of members) {
  const rows = actByCo.get(norm(m.company_name)) || [];
  const personalized = rows.length >= 3;
  const kws = personalized ? keywordsOf(rows) : globalKw.slice(0, TOP_KW);
  let items = matchItems(kws);
  if (!items.length) items = globalTop.map(it => ({ ...it, hits: [] }));
  if (!personalized) generic++;
  const subject = `[워크멘토] ${MONTH} ${m.company_name || "회원"}님 맞춤 지원사업 브리핑 (${items.length}건)`;
  const html = emailHtml(m, kws, items, personalized);

  if (DRY) {
    writeFileSync(`digest-previews/${norm(m.company_name) || m.id}.html`, html);
    previewed++;
    console.log(`[미리보기] ${m.company_name} <${m.email}> · ${personalized ? "맞춤" : "공통"} · 추천 ${items.length}건 · 키워드: ${kws.slice(0, 4).map(k => k[0]).join(",")}`);
    continue;
  }
  try {
    await sendMail(TEST_TO || m.email, subject, html);
    sent++;
    console.log(`[발송] ${m.company_name} → ${TEST_TO || m.email}`);
    await new Promise(r => setTimeout(r, 700)); // Resend 속도 제한 예방
  } catch (e) { failed++; console.error(`[실패] ${m.company_name}: ${e.message}`); }
  if (TEST_TO) break; // 테스트 모드는 1통만
}
console.log(`완료 — 발송 ${sent} · 미리보기 ${previewed} · 실패 ${failed} · 공통버전 ${generic} (총 회원 ${members.length})`);
if (failed > 0 && sent === 0 && !DRY) process.exit(1);
