"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { PITCH_LIMIT, NAME_LIMIT } from "@/lib/config";

const MapView = dynamic(() => import("./MapView"), { ssr: false, loading: () => <div className="map" /> });

const COLORS = ["#f97316", "#2563eb", "#16a34a", "#9333ea", "#db2777", "#0891b2", "#ca8a04", "#dc2626", "#4f46e5", "#059669"];
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

function Avatar({ id, name, small }) {
  return (
    <div className={`av${small ? " sm" : ""}`} style={{ background: colorFor(id) }}>
      {initial(name)}
    </div>
  );
}

function PitchInput({ value, onChange, disabled, autoFocus }) {
  const over = value.length > PITCH_LIMIT;
  return (
    <div>
      <textarea
        className={`pitchbox${over ? " over picky" : ""}`}
        placeholder={'e.g. "vegetarian and broke lol" or "anything but pizza"'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        autoFocus={autoFocus}
        maxLength={PITCH_LIMIT + 60}
      />
      <div className={`counter${over ? " over" : ""}`}>
        <span>{over ? "dont be picky 😒" : "What do you want? Keep it short."}</span>
        <span>
          {value.length}/{PITCH_LIMIT}
        </span>
      </div>
    </div>
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
  const [editing, setEditing] = useState(false);
  const [finding, setFinding] = useState(false);
  const [toast, setToast] = useState("");

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
            if (invite) setJoinCode(invite.toUpperCase());
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
      if (invite) setJoinCode(invite.toUpperCase());
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
    setEditing(false);
    setView("landing");
  };

  const share = async () => {
    const url = `${window.location.origin}/?g=${code}`;
    try {
      if (navigator.share) await navigator.share({ title: "picky", text: `Where should we eat? Join ${group?.display || code} on picky`, url });
      else {
        await navigator.clipboard.writeText(url);
        setToast("Link copied!");
        setTimeout(() => setToast(""), 1500);
      }
    } catch {}
  };

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
    setFinding(true);
    setEditing(false);
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
      else if (d.error) {
        setToast(d.error);
        setTimeout(() => setToast(""), 2500);
      }
    } catch {}
    setFinding(false);
  };

  const setThumb = async (val) => {
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
  const mapProps = useMemo(
    () =>
      result
        ? {
            center: result.center,
            places: result.places,
            winnerId: result.winnerId,
            backupIds: (result.backups || []).map((b) => b.id),
            ruledOutIds: (result.ruledOut || []).map((b) => b.id),
          }
        : null,
    [result?.foundAt] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const winner = result ? placeById[result.winnerId] : null;

  // =================== VIEWS ===================
  if (view === "loading") return <main className="app" />;

  if (view === "landing") {
    return (
      <main className="app">
        <div className="hero">
          <div className="brand">
            pick<span>y</span>
          </div>
          <div className="tag">Ends the "idk, where do you want to eat?" loop in 30 seconds.</div>
        </div>

        <div className="card">
          <div className="label">Got a group code?</div>
          <input
            className="input code-input"
            placeholder="TACO42"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && joinGroup()}
            autoCapitalize="characters"
            autoComplete="off"
            maxLength={12}
          />
          <button className="btn dark" onClick={joinGroup} disabled={busy || !joinCode.trim()}>
            Join group →
          </button>
        </div>

        <div className="or">OR</div>

        <div className="card">
          <div className="label">Starting the hunt?</div>
          <button className="btn" style={{ marginTop: 0 }} onClick={createGroup} disabled={busy}>
            🍽️ Make a new group
          </button>
          <div className="hint">You'll be the leader. You hit "Find" when everyone's in.</div>
        </div>
        {error && <div className="err">{error}</div>}
      </main>
    );
  }

  const topbar = (
    <div className="topbar">
      <button className="mini-brand" style={{ background: "none" }} onClick={leave} title="Leave group">
        pick<span>y</span>
      </button>
      <div className="codechip">
        Group<b>{group?.display || code}</b>
      </div>
    </div>
  );

  if (view === "pitch") {
    const over = pitch.length > PITCH_LIMIT;
    return (
      <main className="app">
        {topbar}
        <div className="card">
          <div className="label">Your name</div>
          <input
            className="input"
            placeholder="Aisha"
            value={name}
            maxLength={NAME_LIMIT}
            onChange={(e) => onEdit(e.target.value, pitch)}
            autoFocus
          />
        </div>
        <div className="card">
          <div className="label">Your pitch</div>
          <PitchInput value={pitch} onChange={(v) => onEdit(name, v)} />
          <button className="btn" onClick={submitPitch} disabled={!name.trim() || !pitch.trim() || over}>
            Pitch it →
          </button>
          <div className="hint">Diet, budget, cravings, vetoes, how far you'll walk. The AI makes it work for everyone.</div>
        </div>
      </main>
    );
  }

  // ---------- room ----------
  const showFinding = status === "finding" || (finding && status !== "done");

  if (status === "done" && result && winner) {
    const fitFor = (m) => (result.perPerson || []).find((p) => p.memberId === m.id || p.name === m.name);
    return (
      <main className="app">
        {topbar}
        <div className="mapwrap">
          <MapView {...mapProps} />
          <div className="maplegend">{result.places.length} places nearby · ⭐ = the pick</div>
        </div>

        <div className="pick">
          <small>⭐ THE PICK FOR ALL {active.length} OF YOU</small>
          <h2>{winner.name}</h2>
          <div className="meta">
            {winner.walkMin} min walk{winner.cuisine ? ` · ${winner.cuisine}` : ""}
            {winner.hours ? ` · ${winner.hours.length > 28 ? "hours listed" : winner.hours}` : ""}
          </div>
          {result.headline && <div className="headline">{result.headline}</div>}
          <div className="fit">
            {active.map((m) => {
              const f = fitFor(m);
              return (
                <div key={m.id}>
                  <Avatar id={m.id} name={m.name} small />
                  <span>
                    <b>{m.name}:</b> {f?.reason || "works for you"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {result.backups?.length > 0 && (
          <div className="card" style={{ marginTop: 14 }}>
            <div className="label">Backups if it's packed</div>
            {result.backups.map((b) =>
              placeById[b.id] ? (
                <div className="alt" key={b.id}>
                  <b>{placeById[b.id].name}</b>
                  <span>
                    {placeById[b.id].walkMin} min · {b.note}
                  </span>
                </div>
              ) : null
            )}
          </div>
        )}

        {result.ruledOut?.length > 0 && (
          <div className="card">
            <div className="label">Why the others lost</div>
            <div className="why">
              {result.ruledOut.map((r) =>
                placeById[r.id] ? (
                  <div key={r.id}>
                    🚫 <b>{placeById[r.id].name}</b>: {r.reason}
                  </div>
                ) : null
              )}
            </div>
          </div>
        )}
        {result.mock && <div className="demo">Demo mode: {result.note}</div>}

        <div className="sticky">
          <div className="sticky-inner">
            {allIn ? (
              <>
                <div className="allin">Everyone's in 🎉 Let's eat.</div>
                <div className="dirs">
                  <a className="g" href={`https://www.google.com/maps/dir/?api=1&destination=${winner.lat},${winner.lng}&travelmode=walking`} target="_blank" rel="noreferrer">
                    🚶 Directions to {winner.name.length > 16 ? "there" : winner.name}
                  </a>
                  <a className="a" href={`https://maps.apple.com/?daddr=${winner.lat},${winner.lng}&dirflg=w`} target="_blank" rel="noreferrer">
                    Apple Maps
                  </a>
                </div>
              </>
            ) : (
              <>
                <div className="thumbs">
                  <div className="thumbrow">
                    {active.map((m) => (
                      <div key={m.id} style={{ opacity: m.thumb ? 1 : 0.3 }}>
                        <Avatar id={m.id} name={m.name} small />
                      </div>
                    ))}
                  </div>
                  {thumbsCount}/{active.length} are down
                </div>
                {iAmIn ? (
                  <button className={`thumbbtn${me?.thumb ? " on" : ""}`} onClick={() => setThumb(!me?.thumb)}>
                    {me?.thumb ? "👍 You're in, waiting on the others" : "👍 I'm down"}
                  </button>
                ) : (
                  <div className="waitnote">Waiting for everyone to thumbs-up…</div>
                )}
              </>
            )}
          </div>
        </div>
      </main>
    );
  }

  if (showFinding) {
    return (
      <main className="app">
        {topbar}
        <div className="finding">
          <div className="spinner">🍜</div>
          <h2>Finding the one place that works for all {pitchedCount} of you…</h2>
          <p>Checking what's open nearby against everyone's pitch.</p>
        </div>
      </main>
    );
  }

  // waiting room
  const over = pitch.length > PITCH_LIMIT;
  return (
    <main className="app">
      {topbar}
      <div className="share">
        <button onClick={share}>📨 Invite friends</button>
        <button onClick={() => navigator.clipboard?.writeText(group?.display || code).then(() => { setToast("Code copied!"); setTimeout(() => setToast(""), 1500); })}>
          📋 Copy code
        </button>
      </div>
      {toast && <div className="hint" style={{ textAlign: "center", marginTop: -8, marginBottom: 10, fontWeight: 700 }}>{toast}</div>}

      <div className="label">
        The table · {pitchedCount} {pitchedCount === 1 ? "person" : "people"} in
      </div>
      <div className="members">
        {visible.map((m) => {
          const mine = m.id === memberId;
          const typing = !mine && serverNow - m.typingAt < 2500;
          const shownPitch = mine ? pitch : m.pitch;
          const shownName = mine ? name : m.name;
          return (
            <div className="member" key={m.id}>
              <Avatar id={m.id} name={shownName} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="mname">
                  {shownName || "New friend"}
                  {m.id === group?.leaderId && <span className="leader">LEADER</span>}
                  {mine && <span className="you">YOU</span>}
                  {mine && !editing && status === "waiting" && (
                    <button className="editlink" onClick={() => setEditing(true)}>
                      ✏️ edit
                    </button>
                  )}
                </div>
                {mine && editing ? (
                  <div style={{ marginTop: 8 }}>
                    <PitchInput value={pitch} onChange={(v) => onEdit(name, v)} autoFocus />
                    <button
                      className="btn dark"
                      style={{ marginTop: 6, padding: 11 }}
                      disabled={over || !pitch.trim()}
                      onClick={() => {
                        setEditing(false);
                        clearTimeout(idleTimer.current);
                        queueSave({ pitch, typing: false }, true);
                      }}
                    >
                      Done
                    </button>
                  </div>
                ) : (
                  <div className={`mpitch${shownPitch ? "" : " empty"}`}>{shownPitch ? `"${shownPitch}"` : "thinking…"}</div>
                )}
                {typing && (
                  <div className="typing">
                    <span className="dots">
                      <i />
                      <i />
                      <i />
                    </span>
                    {m.name || "Someone"} is typing
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {group?.error && <div className="err">{group.error}</div>}

      <div className="sticky">
        <div className="sticky-inner">
          {isLeader ? (
            <button className="btn" onClick={find} disabled={finding || pitchedCount === 0}>
              🔍 Find food for {pitchedCount} {pitchedCount === 1 ? "person" : "people"}
            </button>
          ) : (
            <div className="waitnote">⏳ Waiting for {leaderName} to hit Find… you can still edit your pitch.</div>
          )}
        </div>
      </div>
    </main>
  );
}
