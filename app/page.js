"use client";
// picky — the whole phone flow on one page: landing → pitch → the table → finding → the pick → everyone's in.
// State, polling and API calls are unchanged from main; only the views are new (see the UI reference canvas).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { PITCH_LIMIT, NAME_LIMIT } from "@/lib/config";
import Halftone from "./components/Halftone";
import Mascot from "./components/Mascot";


const COLORS = ["#1d8a4b", "#d6336c", "#2b6fe0", "#e5520a", "#7048e8", "#0c8599", "#b8860b", "#c2255c", "#4f46e5", "#2f9e44"];
function colorFor(id = "") {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}
function initial(name) {
  return (name || "?").trim().charAt(0).toUpperCase() || "?";
}
function newId() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
}
const SESSION_KEY = "picky:session";
const loadSession = () => {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
};
const saveSession = (s) => {
  try {
    s ? localStorage.setItem(SESSION_KEY, JSON.stringify(s)) : localStorage.removeItem(SESSION_KEY);
  } catch {}
};
// "taco42" → "TACO-42" while typing. Dashes and case never matter to the server.
const formatCode = (v) => {
  const n = String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  const m = n.match(/^([A-Z]+)(\d+)$/);
  return m ? `${m[1]}-${m[2]}` : n;
};
const shortHours = (h) => (!h ? "" : h.length > 22 ? "" : h);
const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------------- icons (stroke SVG) ---------------- */
const Icon = ({ d, size = 22, width = 2.4, children }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d ? <path d={d} /> : children}
  </svg>
);
const ArrowRight = () => <Icon d="M5 12h14M13 6l6 6-6 6" size={24} />;
const ArrowUp = () => <Icon d="M12 19V5M6 11l6-6 6 6" size={30} />;
const Search = () => <Icon size={24} width={2.6}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></Icon>;
const Share = () => <Icon size={20} width={2}><path d="M12 15V3M7 8l5-5 5 5" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" /></Icon>;
const QrIcon = () => <Icon size={20} width={2}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3M21 14v7h-4M14 18v3" /></Icon>;
const Pencil = () => <Icon size={17} width={2}><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></Icon>;
const Walk = () => <Icon size={24} width={2.2}><circle cx="13" cy="4" r="2" /><path d="M10 21l2-6 3 3v3M8 12l3-4 4 2 3 3M11 8l-1 5" /></Icon>;
const MapIcon = () => <Icon size={26} width={2}><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z" /><path d="M9 4v14M15 6v14" /></Icon>;

function Avatar({ id, name, small, leader }) {
  return (
    <span className={`avatar${small ? " sm" : ""}`} style={{ background: colorFor(id) }} aria-hidden="true">
      {initial(name)}
      {leader && <span className="star">★</span>}
    </span>
  );
}

function TopBar({ display, onLeave, onCopy, tone = "", restart = false }) {
  return (
    <header className={`topbar ${tone}`}>
      {restart ? (
        <>
          <button className="wordmark again" onClick={onLeave} aria-label="picky: start a new group">
            picky
            <span className="again-ico" aria-hidden="true">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></svg>
            </span>
          </button>
          <div className="again-note" aria-hidden="true">
            <svg width="56" height="52" viewBox="0 0 56 52" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M50 46 C 30 44, 14 34, 10 8" /><path d="M3 16 L10 6 L18 14" /></svg>
            <span>tap to pick again</span>
          </div>
        </>
      ) : (
        <button className="wordmark" onClick={onLeave} title="Leave group">picky</button>
      )}
      <button className="chip" onClick={onCopy} aria-label={`Group code ${display}, tap to copy`}>{display}</button>
    </header>
  );
}

export default function Home() {
  const [view, setView] = useState("loading"); // landing | pitch | room
  const [code, setCode] = useState("");
  const [memberId, setMemberId] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [group, setGroup] = useState(null);
  const [members, setMembers] = useState([]);
  const [serverNow, setServerNow] = useState(Date.now());

  const [name, setName] = useState("");
  const [pitch, setPitch] = useState("");
  const [finding, setFinding] = useState(false);
  const [toast, setToast] = useState("");
  const [showQR, setShowQR] = useState(false);
  const [qr, setQr] = useState("");
  const [burst, setBurst] = useState(0);
  const pitchBox = useRef(null);
  const thumbBtn = useRef(null);
  const findBtn = useRef(null);

  const say = (t, ms = 1800) => {
    setToast(t);
    setTimeout(() => setToast(""), ms);
  };

  // ---------- boot: resume session or prefill invite code ----------
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const invite = params.get("g");
    const s = loadSession();
    if (s?.code && (!invite || invite.toUpperCase().replace(/[^A-Z0-9]/g, "") === s.code)) {
      fetch(`/api/groups/${s.code}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!d) {
            saveSession(null);
            if (invite) setJoinCode(formatCode(invite));
            return setView("landing");
          }
          setCode(s.code);
          setMemberId(s.memberId);
          const me = d.members.find((m) => m.id === s.memberId);
          if (me) {
            setName(me.name || "");
            setPitch(me.pitch || "");
          }
          setGroup(d.group);
          setMembers(d.members);
          setView(me?.name || d.group.status !== "waiting" ? "room" : "pitch");
        })
        .catch(() => setView("landing"));
    } else {
      if (invite) setJoinCode(formatCode(invite));
      setView("landing");
    }
  }, []);

  // ---------- polling ----------
  useEffect(() => {
    if (!code || (view !== "pitch" && view !== "room")) return;
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch(`/api/groups/${code}`, { cache: "no-store" });
        if (!r.ok) return;
        const d = await r.json();
        if (!alive) return;
        setGroup(d.group);
        setMembers(d.members);
        setServerNow(d.serverNow);
      } catch {}
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [code, view]);

  // ---------- saving my name/pitch (throttled, with typing pings) ----------
  const pending = useRef(null);
  const lastSent = useRef(0);
  const sendTimer = useRef(null);
  const idleTimer = useRef(null);

  const flush = useCallback(async () => {
    const p = pending.current;
    pending.current = null;
    if (!p || !code || !memberId) return;
    lastSent.current = Date.now();
    try {
      await fetch(`/api/groups/${code}/member`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId, ...p }),
      });
    } catch {}
  }, [code, memberId]);

  const queueSave = useCallback(
    (payload, immediate = false) => {
      pending.current = { ...(pending.current || {}), ...payload };
      clearTimeout(sendTimer.current);
      const wait = immediate ? 0 : Math.max(0, 500 - (Date.now() - lastSent.current));
      sendTimer.current = setTimeout(flush, wait);
    },
    [flush]
  );

  const onEdit = (nextName, nextPitch) => {
    // Crossing the limit shakes the box (it's a reaction, so it only fires once per crossing).
    if (nextPitch.length > PITCH_LIMIT && pitch.length <= PITCH_LIMIT && pitchBox.current?.animate && !reduced()) {
      pitchBox.current.animate(
        [{ transform: "none" }, { transform: "translateX(-9px) rotate(-1deg)" }, { transform: "translateX(8px) rotate(1deg)" }, { transform: "translateX(-6px)" }, { transform: "translateX(4px)" }, { transform: "none" }],
        { duration: 380, easing: "cubic-bezier(.36,.07,.19,.97)" }
      );
    }
    setName(nextName);
    setPitch(nextPitch);
    const payload = { name: nextName, typing: true };
    if (nextPitch.length <= PITCH_LIMIT) payload.pitch = nextPitch;
    queueSave(payload);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => queueSave({ typing: false }), 2500);
  };

  // ---------- actions ----------
  const enterGroup = (g, mId) => {
    setCode(g.code);
    setMemberId(mId);
    setGroup(g);
    saveSession({ code: g.code, memberId: mId });
    window.history.replaceState(null, "", `?g=${g.code}`);
  };

  const createGroup = async () => {
    setBusy(true);
    setError("");
    const mId = newId();
    try {
      const r = await fetch("/api/groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memberId: mId }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Couldn't create group");
      enterGroup(d.group, mId);
      await fetch(`/api/groups/${d.group.code}/member`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memberId: mId }) });
      setView("pitch");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const joinGroup = async () => {
    const c = joinCode.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!c) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/groups/${c}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "No group with that code");
      const prev = loadSession();
      const mId = prev?.code === c ? prev.memberId : newId();
      enterGroup(d.group, mId);
      setMembers(d.members);
      if (d.group.status === "waiting") {
        await fetch(`/api/groups/${c}/member`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memberId: mId }) });
        setView("pitch");
      } else setView("room");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const submitPitch = () => {
    clearTimeout(idleTimer.current);
    queueSave({ name, pitch, typing: false }, true);
    setView("room");
  };

  const leave = () => {
    saveSession(null);
    window.history.replaceState(null, "", "/");
    setCode("");
    setGroup(null);
    setMembers([]);
    setName("");
    setPitch("");
    setShowQR(false);
    setView("landing");
  };

  const copyCode = () => {
    navigator.clipboard?.writeText(group?.display || code).then(() => say("Code copied")).catch(() => {});
  };

  const share = async () => {
    const url = `${window.location.origin}/?g=${code}`;
    try {
      if (navigator.share) await navigator.share({ title: "picky", text: `Where should we eat? Join ${group?.display || code} on picky`, url });
      else {
        await navigator.clipboard.writeText(url);
        say("Invite link copied");
      }
    } catch {}
  };

  useEffect(() => {
    if (!showQR || !code) return;
    QRCode.toDataURL(`${window.location.origin}/?g=${code}`, { margin: 1, width: 240, color: { dark: "#22170f", light: "#fffaf2" } })
      .then(setQr)
      .catch(() => {});
  }, [showQR, code]);

  const getLocation = () =>
    new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 6000, maximumAge: 60000 }
      );
    });

  const find = async () => {
    findBtn.current?.classList.remove("squash");
    void findBtn.current?.offsetWidth;
    findBtn.current?.classList.add("squash");
    setFinding(true);
    clearTimeout(idleTimer.current);
    pending.current = { ...(pending.current || {}), typing: false };
    await flush();
    const loc = await getLocation();
    try {
      const r = await fetch(`/api/groups/${code}/find`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId, ...(loc || {}) }),
      });
      const d = await r.json();
      if (d.group) setGroup(d.group);
      else if (d.error) say(d.error, 2500);
    } catch {}
    setFinding(false);
  };

  const setThumb = async (val) => {
    if (val && thumbBtn.current?.animate && !reduced()) {
      thumbBtn.current.animate([{ transform: "scale(1)" }, { transform: "scale(.88)" }, { transform: "scale(1.15)" }, { transform: "scale(1)" }], {
        duration: 520,
        easing: "cubic-bezier(.34,1.56,.64,1)",
      });
      setBurst((b) => b + 1);
    }
    setMembers((ms) => ms.map((m) => (m.id === memberId ? { ...m, thumb: val } : m)));
    await fetch(`/api/groups/${code}/member`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberId, thumb: val }),
    });
  };

  // ---------- derived ----------
  const result = group?.result || null;
  const status = group?.status;
  const display = group?.display || formatCode(code);
  const isLeader = group && memberId && group.leaderId === memberId;
  const visible = members.filter((m) => m.name || m.pitch || serverNow - m.typingAt < 2500 || m.id === memberId);
  const active = members.filter((m) => m.name || m.pitch);
  const leaderName = members.find((m) => m.id === group?.leaderId)?.name || "the leader";
  const me = members.find((m) => m.id === memberId);
  const pitchedCount = active.length;
  const thumbsCount = active.filter((m) => m.thumb).length;
  const iAmIn = active.some((m) => m.id === memberId);
  const allIn = active.length > 0 && thumbsCount === active.length;
  const placeById = useMemo(() => Object.fromEntries((result?.places || []).map((p) => [p.id, p])), [result?.foundAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const winner = result ? placeById[result.winnerId] : null;
  const toastEl = toast ? <div className="toast" role="status">{toast}</div> : null;

  // =================== VIEWS ===================
  if (view === "loading") return <main className="screen" />;

  /* ---------- landing ---------- */
  if (view === "landing") {
    const typed = joinCode.replace(/[^A-Z0-9]/gi, "").length;
    const valid = typed >= 3;
    return (
      <main className="landing">
        <div className="land-map"><Halftone phase="idle" focus={{ x: 0.66, y: 0.5 }} /></div>
        <div className="land-fade" />
        <span className="wordmark">picky</span>
        <section className="land-copy">
          <div>
            <h1 className="idk">eats?</h1>
            <p className="idk-sub">find a spot everyone agrees on</p>
          </div>
          <form className="land-form" onSubmit={(e) => { e.preventDefault(); if (valid && !busy) joinGroup(); }}>
            <div className="code-row">
              <label className="sr" htmlFor="code">Group code</label>
              <input id="code" className="code-input" placeholder="ENTER-CODE" value={joinCode} autoComplete="off" autoCapitalize="characters" spellCheck={false}
                onChange={(e) => setJoinCode(formatCode(e.target.value))} />
              <button className="round ink" type="submit" aria-label="Join group" disabled={!valid || busy}><ArrowRight /></button>
            </div>
            <div className="land-or" aria-hidden="true"><span>OR</span></div>
            <button className="pill orange start" type="button" onClick={createGroup} disabled={busy || typed > 0}>Start Group</button>
            {error && <p className="err" role="alert">{error}</p>}
          </form>
        </section>
      </main>
    );
  }

  const topbar = (tone, restart = false) => <TopBar display={display} onLeave={leave} onCopy={copyCode} tone={tone} restart={restart} />;
  const sideMap = (phase) => <Halftone phase={phase} friends={Math.max(1, active.length)} focus={{ x: 0.55, y: 0.48 }} seed={19} />;

  /* ---------- pitch ---------- */
  if (view === "pitch") {
    const over = pitch.length > PITCH_LIMIT;
    return (
      <div className="split">
        <aside className="side" aria-hidden="true">{sideMap("waiting")}</aside>
        <main className="screen main">
          {topbar()}
          <div className="pitch-body">
            <div>
              <label className="sr" htmlFor="name">Your name</label>
              <input id="name" className="name-input" placeholder="your name" value={name} maxLength={NAME_LIMIT} autoComplete="given-name" autoFocus={!name}
                onChange={(e) => onEdit(e.target.value, pitch)} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <label className="sr" htmlFor="pitch">Your pitch</label>
              <div ref={pitchBox} className={`pitch-box${over ? " over" : ""}`}>
                <textarea id="pitch" className="pitch-text" placeholder="list food restrictions and preferences" value={pitch} aria-invalid={over} aria-describedby="count"
                  autoFocus={!!name} onChange={(e) => onEdit(name, e.target.value)} />
              </div>
              <div className={`meter${over ? " over" : ""}`}>
                <div className="bar"><i style={{ transform: `scaleX(${Math.min(1, pitch.length / PITCH_LIMIT)})` }} /></div>
                <span id="count" className="count" aria-live="polite">{pitch.length}/{PITCH_LIMIT}</span>
              </div>
            </div>
          </div>
          <div className="pitch-foot">
            {over ? (
              <div className="peek" role="alert">
                <span className="bubble">dont be picky 😒</span>
                <Mascot mood="side" size={108} className="mascot" title="Dumpling, side-eyeing you" />
              </div>
            ) : <span />}
            <button className="round orange" aria-label="Pitch it" onClick={submitPitch} disabled={!name.trim() || !pitch.trim() || over}><ArrowUp /></button>
          </div>
        </main>
      </div>
    );
  }

  const showFinding = status === "finding" || (finding && status !== "done");

  /* ---------- everyone's in ---------- */
  if (status === "done" && result && winner && allIn) {
    const letters = "Let’s eat.".split("");
    return (
      <main className="go-screen">
        <div className="flood">
          {topbar("", true)}
          <div className="go-body">
            <Mascot mood="happy" size={126} className="mascot" title="Dumpling, happy" />
            <h1 className="lets" aria-label="Let's eat.">
              {letters.map((c, i) => <span key={i} aria-hidden="true" style={{ animationDelay: `${300 + i * 60}ms` }}>{c}</span>)}
            </h1>
            <p className="go-where">{winner.name} · {winner.walkMin} min</p>
            <div className="go-avatars">
              {active.map((m, i) => <span key={m.id} style={{ animationDelay: `${500 + i * 100}ms` }} className="avatar-wrap"><Avatar id={m.id} name={m.name} /></span>)}
            </div>
          </div>
          <div className="go-actions">
            <a className="pill ink xl" href={`https://www.google.com/maps/dir/?api=1&destination=${winner.lat},${winner.lng}&travelmode=walking`} target="_blank" rel="noreferrer">
              <Walk /> Walk there
            </a>
            <a className="round paper" href={`https://maps.apple.com/?daddr=${winner.lat},${winner.lng}&dirflg=w`} target="_blank" rel="noreferrer" aria-label="Open in Apple Maps"><MapIcon /></a>
          </div>
        </div>
        {toastEl}
      </main>
    );
  }

  /* ---------- the pick ---------- */
  if (status === "done" && result && winner) {
    const fitFor = (m) => (result.perPerson || []).find((p) => p.memberId === m.id || p.name === m.name);
    const label = result.provider === "claude" ? "CLAUDE’S PICK" : "THE PICK";
    const meta = [`${winner.walkMin} min`, winner.cuisine || winner.kind, shortHours(winner.hours)].filter(Boolean).join(" · ");
    const n = Math.max(1, active.length);
    return (
      <div className="pick-screen split">
        <aside className="side pick-map" aria-hidden="true">
          <Halftone phase="done" friends={n} focus={{ x: 0.55, y: 0.5 }} seed={19} />
        </aside>
        <main className="main" style={{ display: "flex", flexDirection: "column" }}>
          {topbar("over")}
          <section className="drawer" aria-label={`The pick: ${winner.name}`}>
            <span className="eyebrow">★ {label}</span>
            <h1 className="pick-name">{winner.name}</h1>
            <span className="pick-meta">{meta}</span>
            <ul className="reasons">
              {active.map((m) => (
                <li key={m.id}><Avatar id={m.id} name={m.name} small /><span>{fitFor(m)?.reason || "works for you"}</span></li>
              ))}
            </ul>
            {result.mock && <span className="demo-tag">demo mode</span>}
            <div className="thumb-zone">
              <button ref={thumbBtn} className={`thumb${me?.thumb ? " on" : ""}`} aria-pressed={!!me?.thumb} aria-label={me?.thumb ? "You're down. Tap to undo" : "I'm down"}
                disabled={!iAmIn} onClick={() => setThumb(!me?.thumb)}>👍</button>
              <span className="thumb-pulse" aria-hidden="true" />
              {burst > 0 && Array.from({ length: 10 }, (_, i) => {
                const a = (i / 10) * Math.PI * 2, r = 110 + (i % 2) * 22;
                return <span key={`${burst}-${i}`} className="burst" aria-hidden="true" style={{ "--dx": `${Math.round(Math.cos(a) * r)}px`, "--dy": `${Math.round(Math.sin(a) * r)}px` }} />;
              })}
              {active.map((m, i) => {
                const a = Math.PI * (0.75 + (i / n) * 1.5) + (n === 1 ? Math.PI * 0.75 : 0);
                const x = 150 + Math.cos(a) * 104, y = 130 + Math.sin(a) * 104;
                return (
                  <span key={m.id} className={`orbit${m.thumb ? " on" : ""}`} title={`${m.name}${m.thumb ? " is down" : ""}`}
                    style={{ left: x, top: y, background: m.thumb ? colorFor(m.id) : undefined }}>{initial(m.name)}</span>
                );
              })}
            </div>
            <p className="sr" aria-live="polite">{thumbsCount} of {active.length} are down</p>
          </section>
        </main>
        {toastEl}
      </div>
    );
  }

  /* ---------- finding ---------- */
  if (showFinding) {
    return (
      <main className="finding-screen">
        <div className="bg" aria-hidden="true"><Halftone phase="finding" dark friends={Math.max(1, pitchedCount)} focus={{ x: 0.5, y: 0.42 }} seed={31} /></div>
        <div className="finding-fade" />
        {topbar("dark")}
        <div className="finding-copy" aria-live="polite">
          <h1 className="finding-word">finding.</h1>
          <p>{pitchedCount} {pitchedCount === 1 ? "PITCH" : "PITCHES"} · REAL PLACES NEARBY</p>
        </div>
      </main>
    );
  }

  /* ---------- the table ---------- */
  return (
    <div className="split">
      <aside className="side" aria-hidden="true">{sideMap("waiting")}</aside>
      <main className="screen main">
        {topbar()}
        <div className="strip" aria-hidden="true">{sideMap("waiting")}</div>
        <div className="table-head">
          <h1 className="serif-h">{pitchedCount} at the<br />table</h1>
          <div className="icon-row">
            <button className="icon-btn" onClick={share} aria-label="Share invite link"><Share /></button>
            <button className="icon-btn" onClick={() => setShowQR((v) => !v)} aria-pressed={showQR} aria-label="Show QR code"><QrIcon /></button>
          </div>
        </div>
        {showQR && qr && (
          <div className="qr-card">
            <img src={qr} alt={`QR code to join ${display}`} />
            <span className="qr-code">{display}</span>
          </div>
        )}
        <ul className="members">
          {visible.map((m, i) => {
            const mine = m.id === memberId;
            const typing = !mine && serverNow - m.typingAt < 2500;
            const shownPitch = mine ? pitch : m.pitch;
            const shownName = mine ? name : m.name;
            return (
              <li key={m.id} className={`member${typing ? " typing-now" : ""}`} style={{ animationDelay: `${Math.min(i, 6) * 60}ms` }}>
                <Avatar id={m.id} name={shownName} leader={m.id === group?.leaderId} />
                <div className="body">
                  <div className="who">
                    <span className="nm">{shownName || "New friend"}</span>
                    {mine && status === "waiting" && (
                      <button className="edit" aria-label="Edit your pitch" onClick={() => setView("pitch")}><Pencil /></button>
                    )}
                  </div>
                  {typing ? (
                    <span className="dots" role="img" aria-label={`${m.name || "Someone"} is typing`}><i /><i /><i /></span>
                  ) : (
                    <span className={`said${shownPitch ? "" : " empty"}`}>{shownPitch || "thinking…"}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        <div className="dock">
          {group?.error && <p className="err" role="alert">{group.error}</p>}
          {isLeader ? (
            <button ref={findBtn} className="pill orange xl find-btn" onClick={find} disabled={finding || pitchedCount === 0}>
              Find <Search />
            </button>
          ) : (
            <p className="wait">{leaderName} hits find</p>
          )}
        </div>
      </main>
      {toastEl}
    </div>
  );
}
