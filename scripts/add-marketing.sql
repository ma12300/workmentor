-- ============================================================
-- 마케팅 허브 (marketing/index.html) 클라우드 동기화 테이블
-- Supabase 대시보드 → SQL Editor에서 1회 실행 (재실행해도 안전)
-- ============================================================

-- 접근 판별: 총관리자(check_admin) 또는 '마케팅 허브(mkt)' 권한이 있는 부관리자
-- security definer — members 테이블 RLS와 무관하게 판별 가능
create or replace function mkt_allowed() returns boolean
language sql stable security definer set search_path = public as $$
  select check_admin() or exists (
    select 1 from members m
    where m.id = auth.uid()
      and m.sub_admin
      and coalesce(m.approved, true)
      and (',' || coalesce(m.perms, '') || ',') like '%,mkt,%'
  );
$$;

-- mkt_state: 대시보드 전체 상태를 담는 단일 JSON 문서 저장소
--   (settings 테이블의 id='api' JSON 패턴과 동일한 방식)
--   행: id='main' 하나만 사용.
--   GitHub Actions 자동 발행 스크립트는 service role 키로 접근(RLS 통과).
create table if not exists mkt_state (
  id text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table mkt_state enable row level security;

drop policy if exists "mkt admin read" on mkt_state;
drop policy if exists "mkt admin write" on mkt_state;
drop policy if exists "mkt admin update" on mkt_state;
create policy "mkt admin read" on mkt_state
  for select using (mkt_allowed());
create policy "mkt admin write" on mkt_state
  for insert with check (mkt_allowed());
create policy "mkt admin update" on mkt_state
  for update using (mkt_allowed());

-- mkt_publog: 자동 발행 원장 (append-only)
--   자동 발행 스크립트만 기록(service role). 발행 전에 (topic, channel)을
--   먼저 선점(claim)하므로, 상태 문서가 어떤 경합으로 덮여도
--   같은 콘텐츠가 외부 채널에 두 번 발행되는 일이 없다.
create table if not exists mkt_publog (
  tid text not null,
  ch text not null,
  url text default '',
  at timestamptz not null default now(),
  primary key (tid, ch)
);

alter table mkt_publog enable row level security;

drop policy if exists "mkt publog read" on mkt_publog;
create policy "mkt publog read" on mkt_publog
  for select using (mkt_allowed());
-- insert/update 정책 없음 — service role(자동 발행 스크립트) 전용 기록
