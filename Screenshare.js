/* ═══════════════════════════════════════════════════════════════
   워크멘토 화면 공유 + 원격 포인터 (screenshare.js)
   - 관리자 ↔ 회원 1:1, WebRTC P2P (서버 비용 0)
   - 신호 교환: Supabase Realtime broadcast
   - 보기 전용 + 포인터 안내 (OS 제어 없음 → 안전·합법)
   의존: 전역 sb(Supabase), CHAT(현재 방), MEMBER
   ═══════════════════════════════════════════════════════════════ */
(function () {
  const SS = {
    ch: null, pc: null, localStream: null, role: null, room: null,
    active: false, polite: false, makingOffer: false,
  };
  const ICE = {
    iceServers: [
      { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
      { urls: ["stun:global.stun.twilio.com:3478"] },
    ],
  };

  function roomKey() {
    if (window.CHAT) {
      if (CHAT.memberId) return "ss_m_" + CHAT.memberId;
      if (CHAT.companyId) return "ss_c_" + CHAT.companyId;
    }
    if (window.WM_ROOM) return window.WM_ROOM;   /* CHAT이 흔들려도 마지막 방 기억 */
    return null;
  }
  function noRoomMsg() {
    if (amAdmin()) return "먼저 위에서 [기업 선택] 또는 [개인 회원 방]을 선택해\n대화 상대를 연 뒤에 화면 공유를 사용할 수 있습니다.";
    return "먼저 소통방에 입장한 뒤(기업 코드 또는 개인 코드로 입장)\n화면 공유를 사용할 수 있습니다.";
  }
  function amAdmin() { return !!(window.MEMBER && MEMBER.isAdmin); }
  function $(id) { return document.getElementById(id); }

  function ui(prefix) {
    // prefix "" = 회원측, "a" = 관리자측
    return {
      wrap: $(prefix + "ssWrap"), video: $(prefix + "ssVideo"),
      startBtn: $(prefix + "ssStart"), stopBtn: $(prefix + "ssStop"),
      status: $(prefix + "ssStatus"), ptr: $(prefix + "ssPtr"),
      overlay: $(prefix + "ssOverlay"),
    };
  }
  function myUI() { return ui(amAdmin() ? "a" : ""); }

  function setStatus(t) {
    const u = myUI();
    if (u.status) u.status.textContent = t;
  }
  function showWrap(on) {
    const u = myUI();
    if (u.wrap) u.wrap.style.display = on ? "block" : "none";
  }

  async function ensureChannel() {
    const rk = roomKey();
    if (!rk) { alert(noRoomMsg()); return false; }
    if (SS.ch && SS.room === rk) return true;
    await teardownChannel();
    SS.room = rk;
    SS.polite = !amAdmin(); // 관리자=impolite, 회원=polite (충돌 시 양보)
    SS.ch = sb.channel(rk, { config: { broadcast: { self: false } } });
    SS.ch.on("broadcast", { event: "sig" }, ({ payload }) => onSignal(payload));
    await SS.ch.subscribe();
    return true;
  }
  async function teardownChannel() {
    if (SS.ch) { try { await sb.removeChannel(SS.ch); } catch (_) {} SS.ch = null; }
    SS.room = null;
  }
  function send(payload) {
    if (!SS.ch) return;
    SS.ch.send({ type: "broadcast", event: "sig", payload });
  }

  function newPC() {
    const pc = new RTCPeerConnection(ICE);
    pc.onicecandidate = e => { if (e.candidate) send({ kind: "ice", cand: e.candidate }); };
    pc.ontrack = e => {
      const u = myUI();
      if (u.video) { u.video.srcObject = e.streams[0]; u.video.play().catch(() => {}); }
      setStatus("상대 화면 수신 중");
    };
    pc.onconnectionstatechange = () => {
      if (["failed", "disconnected", "closed"].includes(pc.connectionState)) setStatus("연결 종료됨");
    };
    pc.onnegotiationneeded = async () => {
      try {
        SS.makingOffer = true;
        await pc.setLocalDescription();
        send({ kind: "sdp", sdp: pc.localDescription });
      } catch (_) {} finally { SS.makingOffer = false; }
    };
    return pc;
  }

  async function onSignal(p) {
    if (!p) return;
    if (p.kind === "bye") { stopViewing(); setStatus("상대가 공유를 종료했습니다."); return; }
    if (p.kind === "pointer") { drawPointer(p.x, p.y, p.name); return; }
    if (p.kind === "req-start") { /* 뷰어가 준비됨 알림 (공유자 참고용) */ return; }

    if (!SS.pc) SS.pc = newPC();
    const pc = SS.pc;
    try {
      if (p.kind === "sdp") {
        const desc = p.sdp;
        const offerCollision = desc.type === "offer" && (SS.makingOffer || pc.signalingState !== "stable");
        if (offerCollision && !SS.polite) return; // impolite는 무시
        await pc.setRemoteDescription(desc);
        if (desc.type === "offer") {
          await pc.setLocalDescription();
          send({ kind: "sdp", sdp: pc.localDescription });
          // offer를 받았다 = 내가 뷰어 → 오버레이 켜기
          enableViewerOverlay();
        }
      } else if (p.kind === "ice") {
        try { await pc.addIceCandidate(p.cand); } catch (_) {}
      }
    } catch (e) { console.warn("signal err", e); }
  }

  // ───────── 공유 시작 (내 화면을 상대에게) ─────────
  async function startShare() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      return alert("이 브라우저는 화면 공유를 지원하지 않습니다. 최신 크롬·엣지·웨일을 사용하세요.");
    }
    if (!(await ensureChannel())) return;
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 15, max: 30 } }, audio: false,
      });
    } catch (e) {
      return setStatus("화면 공유가 취소되었습니다.");
    }
    SS.localStream = stream;
    SS.active = true;
    SS.role = "sharer";
    if (!SS.pc) SS.pc = newPC();
    stream.getTracks().forEach(t => SS.pc.addTrack(t, stream));
    stream.getVideoTracks()[0].onended = () => stopShare();
    // 화질 옵션 반영
    applyQuality();
    const u = myUI();
    if (u.startBtn) u.startBtn.style.display = "none";
    if (u.stopBtn) u.stopBtn.style.display = "inline-block";
    if (u.video) { u.video.srcObject = null; } // 공유자는 자기 화면 프리뷰 생략(에코 방지)
    setStatus("내 화면 공유 중 — 상대가 보고 있습니다. 상대 포인터가 여기에 표시됩니다.");
    enableSharerPointerReceive();
    send({ kind: "req-start" });
  }

  function stopShare() {
    if (SS.localStream) { SS.localStream.getTracks().forEach(t => t.stop()); SS.localStream = null; }
    send({ kind: "bye" });
    resetPC();
    SS.active = false; SS.role = null;
    const u = myUI();
    if (u.startBtn) u.startBtn.style.display = "inline-block";
    if (u.stopBtn) u.stopBtn.style.display = "none";
    if (u.overlay) u.overlay.style.display = "none";
    setStatus("공유를 종료했습니다.");
  }

  function stopViewing() {
    resetPC();
    const u = myUI();
    if (u.video) u.video.srcObject = null;
    if (u.overlay) u.overlay.style.display = "none";
  }

  function resetPC() {
    if (SS.pc) { try { SS.pc.close(); } catch (_) {} SS.pc = null; }
  }

  // ───────── 원격 포인터 ─────────
  function enableViewerOverlay() {
    // 뷰어: 영상 위에서 마우스 움직이면 정규화 좌표 전송
    const u = myUI();
    if (!u.video || u.video._ptrBound) return;
    u.video._ptrBound = true;
    const name = (MEMBER && MEMBER.profile && MEMBER.profile.company_name) || (amAdmin() ? "관리자" : "회원");
    let last = 0;
    u.video.addEventListener("mousemove", ev => {
      const now = Date.now();
      if (now - last < 40) return; // 25fps 스로틀
      last = now;
      const r = u.video.getBoundingClientRect();
      const x = (ev.clientX - r.left) / r.width;
      const y = (ev.clientY - r.top) / r.height;
      if (x >= 0 && x <= 1 && y >= 0 && y <= 1) send({ kind: "pointer", x, y, name });
    });
  }
  function enableSharerPointerReceive() {
    const u = myUI();
    if (u.overlay) u.overlay.style.display = "block";
  }
  function drawPointer(x, y, name) {
    const u = myUI();
    if (!u.overlay || !u.ptr) return;
    u.overlay.style.display = "block";
    const r = u.overlay.getBoundingClientRect();
    u.ptr.style.left = (x * r.width) + "px";
    u.ptr.style.top = (y * r.height) + "px";
    u.ptr.style.display = "block";
    if (u.ptr._lbl) u.ptr._lbl.textContent = name || "상대";
    clearTimeout(u.ptr._t);
    u.ptr._t = setTimeout(() => { u.ptr.style.display = "none"; }, 2500);
  }

  // ───────── 화질 옵션 ─────────
  function applyQuality() {
    if (!SS.pc || !SS.localStream) return;
    const sel = $((amAdmin() ? "a" : "") + "ssQuality");
    const q = sel ? sel.value : "auto";
    const sender = SS.pc.getSenders().find(s => s.track && s.track.kind === "video");
    if (!sender) return;
    const params = sender.getParameters();
    if (!params.encodings || !params.encodings.length) params.encodings = [{}];
    const map = { low: 500e3, medium: 1500e3, high: 4000e3, auto: undefined };
    params.encodings[0].maxBitrate = map[q];
    const track = SS.localStream.getVideoTracks()[0];
    const cap = { low: 8, medium: 15, high: 30, auto: 15 };
    try { track.applyConstraints({ frameRate: cap[q] }); } catch (_) {}
    try { sender.setParameters(params); } catch (_) {}
  }

  // ───────── 정리 ─────────
  async function leave() {
    if (SS.active) stopShare(); else stopViewing();
    await teardownChannel();
    showWrap(false);
  }

  // 외부 노출
  window.SShare = {
    open: async function () {
      if (!roomKey()) { alert(noRoomMsg()); return; }
      showWrap(true);
      if (!(await ensureChannel())) { showWrap(false); return; }
      const who = amAdmin() ? "상대(회원)" : "관리자";
      setStatus("준비됨 — [화면 공유 시작]을 누르면 내 화면을 " + who + "에게 보여줍니다. " + who + "의 포인터가 여기에 표시됩니다.");
    },
    start: startShare,
    stop: function () { if (SS.active) stopShare(); else stopViewing(); },
    quality: applyQuality,
    leave: leave,
  };
})();