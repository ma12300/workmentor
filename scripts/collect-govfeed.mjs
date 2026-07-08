/* 워크멘토 정부 피드 수집기 — GitHub Actions에서 30분마다 실행
   8개 부처 RSS(정책브리핑) → gov-feeds.json (분류 그룹별 최신 25건) */

const GOV_FEEDS = {
  tax:   [["기획재정부", "https://www.korea.kr/rss/dept_moef.xml"], ["국세청", "https://www.korea.kr/rss/dept_nts.xml"]],
  labor: [["고용노동부", "https://www.korea.kr/rss/dept_moel.xml"]],
  law:   [["법무부", "https://www.korea.kr/rss/dept_moj.xml"], ["공정거래위원회", "https://www.korea.kr/rss/dept_ftc.xml"]],
  fund:  [["금융위원회", "https://www.korea.kr/rss/dept_fsc.xml"], ["관세청", "https://www.korea.kr/rss/dept_customs.xml"]],
  biz:   [["중소벤처기업부", "https://www.korea.kr/rss/dept_mss.xml"]],
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
function parseRss(xml, source) {
  const items = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  return items.map(b => ({
    title: decode(pick(b, "title")),
    url: decode(pick(b, "link")),
    date: decode(pick(b, "pubDate")) || decode(pick(b, "dc:date")),
    summary: decode(pick(b, "description")).slice(0, 300),
    source,
  })).filter(r => r.title && r.url);
}

async function fetchFeed(label, url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, {
        headers: {
          "User-Agent": UA,
          "Accept": "application/rss+xml, application/xml, text/xml, */*",
          "Accept-Language": "ko-KR,ko;q=0.9",
          "Referer": "https://www.korea.kr/etc/rss.do",
        },
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const rows = parseRss(await r.text(), label);
      console.log(`  ✓ ${label}: ${rows.length}건`);
      return rows;
    } catch (e) {
      console.log(`  ✗ ${label} (시도 ${attempt}/3): ${e.message}`);
      if (attempt < 3) await new Promise(res => setTimeout(res, 2500 * attempt));
    }
  }
  return [];
}

const out = { updatedAt: new Date().toISOString(), groups: {} };
for (const [key, feeds] of Object.entries(GOV_FEEDS)) {
  console.log(`[${key}]`);
  const all = (await Promise.all(feeds.map(([l, u]) => fetchFeed(l, u)))).flat();
  const t = x => { const d = new Date(x.date); return isNaN(d) ? 0 : d.getTime(); };
  all.sort((a, b) => t(b) - t(a));
  out.groups[key] = all.slice(0, 25);
}

const total = Object.values(out.groups).reduce((s, a) => s + a.length, 0);
console.log(`총 ${total}건 수집 완료`);

/* 전부 실패(0건)면 기존 파일을 지우지 않도록 저장 생략 */
import { writeFileSync, existsSync } from "node:fs";
if (total > 0 || !existsSync("gov-feeds.json")) {
  writeFileSync("gov-feeds.json", JSON.stringify(out, null, 1));
  console.log("gov-feeds.json 저장");
} else {
  console.log("수집 0건 — 기존 파일 유지");
}
