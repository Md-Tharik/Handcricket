// ════════════════════════════════════════════════
//  HAND CRICKET  –  app.js
//  Firebase v9 modular SDK + full game logic
// ════════════════════════════════════════════════

import { initializeApp }          from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, doc, getDoc, updateDoc, onSnapshot, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── PASTE YOUR FIREBASE CONFIG HERE ──────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyChkWoAEh2EoD8J5c4LLNq1r0vOwncvzSs",
  authDomain: "hand-cricket-705af.firebaseapp.com",
  projectId: "hand-cricket-705af",
  storageBucket: "hand-cricket-705af.firebasestorage.app",
  messagingSenderId: "415173214464",
  appId: "1:415173214464:web:676584c36ddc8e3e97f3e5",
  measurementId: "G-PVC0CL5WQG"
};
// ─────────────────────────────────────────────────────────────────────────────

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

// ════════════════ STATE ════════════════
const params = new URLSearchParams(window.location.search);
const ROOM_ID = params.get("room");

if (!ROOM_ID) {
  alert("No room ID in URL. Going back to lobby.");
  window.location.href = "index.html";
}

// Stable per-tab player ID stored in sessionStorage
let MY_ID = sessionStorage.getItem("hc_player_id");
if (!MY_ID) {
  MY_ID = "p_" + Math.random().toString(36).slice(2, 9);
  sessionStorage.setItem("hc_player_id", MY_ID);
}

let mySlot = null;   // "p1" | "p2"

// ── FIX: Track which ballCount value we are currently resolving.
//    -1 means "not locked". This prevents the boolean resolveLocked
//    from staying true across multiple balls.
let resolveLockedForBall = -1;

let unsubscribe = null;

const roomRef = doc(db, "rooms", ROOM_ID);

// ════════════════ HELPERS ════════════════
const $ = id => document.getElementById(id);

function showScreen(name) {
  ["waiting","toss","playing","innings-break","game-over"].forEach(s => {
    const el = $(`screen-${s}`);
    if (el) el.classList.add("hidden");
  });
  const target = $(`screen-${name}`);
  if (target) target.classList.remove("hidden");
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ════════════════ JOIN LOGIC ════════════════
async function joinRoom() {
  const snap = await getDoc(roomRef);
  if (!snap.exists()) {
    alert("Room not found!");
    window.location.href = "index.html";
    return;
  }

  const data = snap.data();

  if (data.p1?.id === MY_ID) {
    mySlot = "p1";
  } else if (data.p2?.id === MY_ID) {
    mySlot = "p2";
  } else if (!data.p1?.id) {
    mySlot = "p1";
    await updateDoc(roomRef, { "p1.id": MY_ID });
  } else if (!data.p2?.id) {
    mySlot = "p2";
    await updateDoc(roomRef, {
      "p2.id": MY_ID,
      "status": "toss"
    });
  } else {
    alert("Room is full!");
    window.location.href = "index.html";
    return;
  }

  setupInviteLink();
  startListening();
}

function setupInviteLink() {
  const url = window.location.href;
  const el = $("invite-url-text");
  if (el) el.textContent = url;

  const copyBtn = $("copy-link-btn");
  if (copyBtn) {
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(url).then(() => {
        const conf = $("copy-confirm");
        conf.classList.add("show");
        setTimeout(() => conf.classList.remove("show"), 2000);
      });
    });
  }
}

// ════════════════ FIRESTORE LISTENER ════════════════
function startListening() {
  unsubscribe = onSnapshot(roomRef, snap => {
    if (!snap.exists()) return;
    const data = snap.data();
    handleStateChange(data);
  });
}

async function handleStateChange(data) {
  switch (data.status) {
    case "waiting":       renderWaiting(data);     break;
    case "toss":          renderToss(data);         break;
    case "playing":       renderPlaying(data);      break;
    case "innings_break": renderInningsBreak(data); break;
    case "game_over":     renderGameOver(data);     break;
  }
}

// ════════════════ WAITING SCREEN ════════════════
function renderWaiting(data) {
  showScreen("waiting");
}

// ════════════════════════════════════════════════
//  TOSS – 3-phase flow
//
//  Phase 1  (p1OddEven is null):
//    • P1 sees Odd / Even buttons. P2 sees "Waiting for opponent to pick..."
//
//  Phase 2  (p1OddEven set, toss.winner is null):
//    • Everyone sees what P1 chose (e.g. "Opponent chose: ODD")
//    • Both players pick a number 1–6
//    • When both numbers are in, P1 resolves and writes toss.winner
//
//  Phase 3  (toss.winner set):
//    • Show result line: "3 + 5 = 8 (Even)"
//    • Winner sees Bat / Bowl buttons
//    • Loser sees "Waiting for opponent to choose..."
//    • Winner's click sets roles and transitions to "playing"
// ════════════════════════════════════════════════

function renderToss(data) {
  showScreen("toss");

  const themSlot  = mySlot === "p1" ? "p2" : "p1";
  const p1OddEven = data.p1?.tossOddEven;   // "odd" | "even" | null
  const myTossNum = data[mySlot]?.tossNum;   // 1–6 | null

  // Hide all sub-sections first, then reveal what's needed
  const sections = [
    "toss-phase1-p1", "toss-phase1-p2",
    "toss-phase2-info",
    "toss-phase2-num-pick", "toss-phase2-num-waiting",
    "toss-phase3-result",
    "toss-phase3-bat-bowl", "toss-phase3-loser-wait"
  ];
  sections.forEach(id => { const el = $(id); if (el) el.classList.add("hidden"); });

  // ── Phase 1 ──────────────────────────────────────
  if (!p1OddEven) {
    if (mySlot === "p1") {
      $("toss-phase1-p1").classList.remove("hidden");
    } else {
      $("toss-phase1-p2").classList.remove("hidden");
    }
    return;
  }

  // ── Phase 2 ──────────────────────────────────────
  // Show what P1 chose to everyone
  $("toss-phase2-info").classList.remove("hidden");
  $("toss-p1-choice-label").textContent =
    mySlot === "p1"
      ? `You chose: ${p1OddEven.toUpperCase()} 🎯`
      : `Opponent chose: ${p1OddEven.toUpperCase()} 🎯`;

  if (!data.toss?.winner) {
    if (!myTossNum) {
      $("toss-phase2-num-pick").classList.remove("hidden");
    } else {
      $("toss-phase2-num-waiting").classList.remove("hidden");
      $("toss-num-picked-text").textContent = `You picked ${myTossNum} ✓`;
    }

    // Both picked → P1 resolves
    const p1Num = data.p1?.tossNum;
    const p2Num = data.p2?.tossNum;
    if (p1Num && p2Num && mySlot === "p1") {
      resolveToss(data, p1Num, p2Num);
    }
    return;
  }

  // ── Phase 3 ──────────────────────────────────────
  $("toss-phase3-result").classList.remove("hidden");

  const sum   = (data.p1?.tossNum || 0) + (data.p2?.tossNum || 0);
  const isOdd = sum % 2 !== 0;
  const iWon  = data.toss.winner === mySlot;

  $("toss-result-sum").textContent =
    `${data.p1?.tossNum} + ${data.p2?.tossNum} = ${sum} (${isOdd ? "Odd" : "Even"})`;
  $("toss-result-winner").textContent =
    iWon ? "🏆 You won the toss!" : "😬 Opponent won the toss.";

  if (iWon) {
    $("toss-phase3-bat-bowl").classList.remove("hidden");
  } else {
    $("toss-phase3-loser-wait").classList.remove("hidden");
  }
}

async function resolveToss(data, p1Num, p2Num) {
  const sum    = p1Num + p2Num;
  const isOdd  = sum % 2 !== 0;
  const winner = (data.p1.tossOddEven === "odd" && isOdd) ||
                 (data.p1.tossOddEven === "even" && !isOdd) ? "p1" : "p2";

  await updateDoc(roomRef, {
    "toss.winner": winner,
    "toss.sum":    sum,
  });
}

// ── Odd/Even buttons (P1 only) ──
document.querySelectorAll(".toss-oddeven-btn").forEach(btn => {
  btn.addEventListener("click", async () => {
    if (mySlot !== "p1") return;
    document.querySelectorAll(".toss-oddeven-btn").forEach(b => b.disabled = true);
    await updateDoc(roomRef, { "p1.tossOddEven": btn.dataset.choice });
  });
});

// ── Toss number grid (both players) ──
const tossNumGrid = $("toss-num-grid");
if (tossNumGrid && !tossNumGrid.dataset.bound) {
  tossNumGrid.dataset.bound = "1";
  tossNumGrid.addEventListener("click", async e => {
    const btn = e.target.closest(".toss-num-btn");
    if (!btn || btn.disabled) return;
    tossNumGrid.querySelectorAll(".toss-num-btn").forEach(b => b.disabled = true);
    await updateDoc(roomRef, { [`${mySlot}.tossNum`]: parseInt(btn.dataset.num) });
  });
}

// ── Bat/Bowl choice (toss winner only) ──
document.querySelectorAll(".bat-bowl-btn").forEach(btn => {
  btn.addEventListener("click", async () => {
    document.querySelectorAll(".bat-bowl-btn").forEach(b => b.disabled = true);
    const choice = btn.dataset.choice; // "bat" | "bowl"

    const snap   = await getDoc(roomRef);
    const winner = snap.data().toss.winner;
    const loser  = winner === "p1" ? "p2" : "p1";

    await updateDoc(roomRef, {
      [`${winner}.role`]: choice,
      [`${loser}.role`]:  choice === "bat" ? "bowl" : "bat",
    });

    await sleep(600);
    await updateDoc(roomRef, { status: "playing" });
  });
});

// ════════════════ PLAYING SCREEN ════════════════

function renderPlaying(data) {
  showScreen("playing");

  const me   = data[mySlot];
  const them = data[mySlot === "p1" ? "p2" : "p1"];

  // Labels
  $("p1-label").textContent = mySlot === "p1" ? "You" : "Opponent";
  $("p2-label").textContent = mySlot === "p2" ? "You" : "Opponent";
  $("p1-role").textContent  = data.p1.role === "bat" ? "🏏 Batting" : "🎳 Bowling";
  $("p2-role").textContent  = data.p2.role === "bat" ? "🏏 Batting" : "🎳 Bowling";

  // Scores
  setScore("p1-score", data.p1.totalScore);
  setScore("p2-score", data.p2.totalScore);

  // Innings / target
  $("innings-label").textContent = `${data.currentInnings === 1 ? "1st" : "2nd"} Innings`;
  if (data.target) {
    $("target-label").textContent = `Target: ${data.target}`;
  }

  const currentBall = data.ballCount || 0;

  // ── FIX: Unlock whenever both moves are null and the locked ball is done ──
  if (data.p1.move === null && data.p2.move === null) {
    if (resolveLockedForBall <= currentBall) {
      resolveLockedForBall = -1;
    }
  }

  const alreadyLocked = resolveLockedForBall === currentBall;
  const canPick = me.move === null && !alreadyLocked;

  // Status text
  if (me.move !== null && them.move === null) {
    $("status-text").textContent = "Waiting for opponent...";
  } else if (canPick) {
    $("status-text").textContent =
      me.role === "bat" ? "You're batting! Pick a number:" : "You're bowling! Pick a number:";
  }

  // Buttons
  const grid = $("number-grid");
  const btns = grid.querySelectorAll(".num-btn");
  btns.forEach(btn => {
    btn.disabled = !canPick;
    btn.classList.remove("selected");
    if (me.move !== null && parseInt(btn.dataset.num) === me.move) {
      btn.classList.add("selected");
    }
  });

  // ── FIX: Lock by ballCount, not by boolean ──
  if (data.p1.move !== null && data.p2.move !== null && resolveLockedForBall !== currentBall) {
    resolveLockedForBall = currentBall;
    triggerReveal(data);
  }

  // Last ball
  if (data.lastResult) {
    $("last-ball-nums").textContent = `You: ${data.lastResult.myMove} | Them: ${data.lastResult.themMove}`;
    $("last-ball-runs").textContent = data.lastResult.out ? "OUT!" : `+${data.lastResult.runs}`;
    $("last-ball-runs").style.color = data.lastResult.out ? "var(--red)" : "var(--ink)";
  }

  renderTally(data);
}

// ── Number button handler (bound once) ──
const numGrid = $("number-grid");
if (numGrid && !numGrid.dataset.bound) {
  numGrid.dataset.bound = "1";
  numGrid.addEventListener("click", async e => {
    const btn = e.target.closest(".num-btn");
    if (!btn || btn.disabled) return;
    const num = parseInt(btn.dataset.num);
    btn.classList.add("selected");
    numGrid.querySelectorAll(".num-btn").forEach(b => b.disabled = true);
    await updateDoc(roomRef, { [`${mySlot}.move`]: num });
    $("status-text").textContent = "Waiting for opponent...";
  });
}

function setScore(id, val) {
  const el  = $(id);
  const old = el.textContent;
  if (old !== String(val)) {
    el.setAttribute("data-old", old);
    el.textContent = val;
    el.classList.remove("updated");
    void el.offsetWidth;
    el.classList.add("updated");
    setTimeout(() => el.classList.remove("updated"), 2000);
  }
}

// ── Reveal countdown overlay ──
async function triggerReveal(data) {
  const overlay   = $("reveal-overlay");
  const countdown = $("reveal-countdown");
  overlay.classList.remove("hidden");

  for (let i = 3; i >= 1; i--) {
    countdown.textContent = i;
    await sleep(500);
  }
  countdown.textContent = "✊";
  await sleep(300);
  overlay.classList.add("hidden");

  // Only P1 writes to avoid race
  if (mySlot === "p1") {
    await resolveMove(data);
  }
}

// ── Resolve a single ball ──
async function resolveMove(data) {
  const p1Move = data.p1.move;
  const p2Move = data.p2.move;
  const batter = data.p1.role === "bat" ? "p1" : "p2";
  const bower  = batter === "p1" ? "p2" : "p1";
  const isOut  = p1Move === p2Move;

  const batterScore = data[batter].totalScore;
  const ballCount   = (data.ballCount || 0) + 1;

  const update = {
    "p1.move": null,
    "p2.move": null,
    ballCount:  ballCount,
    lastResult: {
      myMove:   p1Move,
      themMove: p2Move,
      out:      isOut,
      runs:     isOut ? 0 : data[batter].move
    }
  };

  if (isOut) {
    if (data.currentInnings === 1) {
      update[`${batter}.role`] = "bowl";
      update[`${bower}.role`]  = "bat";
      update.status            = "innings_break";
      update.target            = batterScore + 1;
      update.currentInnings    = 2;
    } else {
      update.status = "game_over";
    }
  } else {
    const newScore = batterScore + data[batter].move;
    update[`${batter}.totalScore`] = newScore;

    if (data.currentInnings === 2 && data.target && newScore >= data.target) {
      update.status = "game_over";
    }
  }

  if (isOut) await showOutOverlay();

  await updateDoc(roomRef, update);
}

async function showOutOverlay() {
  const overlay = $("out-overlay");
  overlay.classList.remove("hidden");
  await sleep(2000);
  overlay.classList.add("hidden");
}

// ── Score tally ──
function renderTally(data) {
  const tally = $("score-tally");
  if (!tally) return;
  const runs = data.runHistory || [];
  tally.innerHTML = runs.map(r =>
    r === "OUT"
      ? `<span class="tally-num out-marker">W</span>`
      : `<span class="tally-num">${r}</span>`
  ).join("");
}

// ════════════════ INNINGS BREAK ════════════════
function renderInningsBreak(data) {
  showScreen("innings-break");
  $("innings-break-text").textContent =
    `1st innings over!\nScore: ${data.p1.totalScore} vs ${data.p2.totalScore}\nTarget: ${data.target} runs`;

  if (mySlot === "p1") {
    setTimeout(async () => {
      const snap = await getDoc(roomRef);
      if (snap.data().status === "innings_break") {
        await updateDoc(roomRef, { status: "playing" });
      }
    }, 4000);
  }
}

// ════════════════ GAME OVER ════════════════
function renderGameOver(data) {
  showScreen("game-over");

  $("final-score-p1").textContent = `You (P1): ${data.p1.totalScore}`;
  $("final-score-p2").textContent = `Opponent (P2): ${data.p2.totalScore}`;

  const s1 = data.p1.totalScore, s2 = data.p2.totalScore;
  let winner = "";
  if (s1 > s2)      winner = "🏆 Player 1 wins!";
  else if (s2 > s1) winner = "🏆 Player 2 wins!";
  else              winner = "🤝 It's a tie!";

  $("winner-text").textContent = winner;

  // Clone to remove any old listener
  const btn    = $("play-again-btn");
  const newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);
  newBtn.addEventListener("click", () => { window.location.href = "index.html"; });
}

// ════════════════ OUT OVERLAY – react to lastResult (non-P1) ════════════════
let lastOutBall = -1;
onSnapshot(roomRef, snap => {
  if (!snap.exists()) return;
  const d = snap.data();
  if (d.lastResult?.out && d.ballCount !== lastOutBall) {
    lastOutBall = d.ballCount;
    if (mySlot !== "p1") showOutOverlay(); // P1 already shows it in resolveMove
  }
});

// ════════════════ BOOT ════════════════
joinRoom();
