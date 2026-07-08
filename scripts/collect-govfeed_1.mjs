/* 워크멘토 정부 피드 수집기 v2 — GitHub Actions에서 30분마다 실행
   분류별 부처 키워드로 구글 뉴스 RSS 검색 → gov-feeds.json (그룹별 최신 25건)
   (korea.kr 직접 수집은 대다수 서버망을 차단하여 구글 뉴스 경유로 전환) */

const GROUP_QUERIES = {
  tax:   "기획재정부 OR 국세청",
  labor: "고용노동부",
  law:   "법무부 OR 공정거래위원회",
  fund:  "금융위원회 OR 관세청",
  biz:   "중소벤처기업부",
};

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function pick(block, tag) {
  const m = block.match(new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)</" + tag + ">", "i"));
  return m ? m[1] : "";
}
function decode(s) {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();
}
function parseRss(xml) {
  const items = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  return items.map(b => {
    const source = decode(pick(b, "source")) || "언론 보도";
    let title = decode(pick(b, "title"));
    if (source && title.endsWith(" - " + source)) title = title.slice(0, -(" - " + source).length);
    return {
      title,
      url: decode(pick(b, "link")),
      date: decode(pick(b, "pubDate")),
      summary: decode(pick(b, "description")).slice(0, 300),
      source,
    };
  }).filter(r => r.title && r.url);
}

async function fetchGroup(key, query) {
  const url = "https://news.google.com/rss/search?q=" + encodeURIComponent(query) + "&hl=ko&gl=KR&ceid=KR:ko";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9" },
        redirect: "follow",
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const rows = parseRss(await r.text());
      console.log(`  [${key}] ✓ ${rows.length}건 (${query})`);
      return rows;
    } catch (e) {
      console.log(`  [${key}] ✗ 시도 ${attempt}/3: ${e.message}`);
      if (attempt < 3) await new Promise(res => setTimeout(res, 2000 * attempt));
    }
  }
  return [];
}

const out = { updatedAt: new Date().toISOString(), groups: {} };
for (const [key, query] of Object.entries(GROUP_QUERIES)) {
  const rows = await fetchGroup(key, query);
  const t = x => { const d = new Date(x.date); return isNaN(d) ? 0 : d.getTime(); };
  rows.sort((a, b) => t(b) - t(a));
  out.groups[key] = rows.slice(0, 25);
}

const total = Object.values(out.groups).reduce((s, a) => s + a.length, 0);
console.log(`총 ${total}건 수집`);

import { writeFileSync } from "node:fs";
if (total === 0) {
  console.error("수집 0건 — 실패로 종료 (기존 gov-feeds.json 유지)");
  process.exit(1);
}
writeFileSync("gov-feeds.json", JSON.stringify(out, null, 1));
console.log("gov-feeds.json 저장 완료");
