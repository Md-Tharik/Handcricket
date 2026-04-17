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

let mySlot        = null;   // "p1" | "p2"
let resolveLocked = false;  // prevent double-resolve
let unsubscribe   = null;

const roomRef = doc(db, "rooms", ROOM_ID);

// ════════════════ HELPERS ════════════════
const $ = id => document.getElementById(id);

function showScreen(name) {
  ["waiting","toss","playing","innings-break","game-over"].forEach(s => {
    $(`screen-${s}`).classList.add("hidden");
  });
  $(`screen-${name}`).classList.remove("hidden");
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
    case "waiting":      renderWaiting(data); break;
    case "toss":         renderToss(data);    break;
    case "playing":      renderPlaying(data); break;
    case "innings_break":renderInningsBreak(data); break;
    case "game_over":    renderGameOver(data); break;
  }
}

// ════════════════ WAITING SCREEN ════════════════
function renderWaiting(data) {
  showScreen("waiting");
}

// ════════════════ TOSS SCREEN ════════════════
function renderToss(data) {
  showScreen("toss");

  const myToss   = data[mySlot]?.tossChoice;
  const themSlot = mySlot === "p1" ? "p2" : "p1";
  const themToss = data[themSlot]?.tossChoice;

  // Already chose?
  if (myToss) {
    $("toss-choice-area").classList.add("hidden");
    $("toss-waiting").classList.remove("hidden");
    $("toss-pick-label").style.display = "block";
    $("toss-pick-label").textContent = `You picked: ${myToss.toUpperCase()}`;
  }

  // Both chose → resolve toss (only p1 writes to avoid race)
  if (myToss && themToss && !data.toss?.winner) {
    if (mySlot === "p1") {
      resolveToss(data);
    }
  }

  // Show result if winner decided
  if (data.toss?.winner) {
    $("toss-choice-area").classList.add("hidden");
    $("toss-waiting").classList.add("hidden");
    $("toss-result").classList.remove("hidden");

    const myNum   = data[mySlot]?.tossNum   || 0;
    const themNum = data[themSlot]?.tossNum  || 0;
    const sum     = myNum + themNum;
    const isOdd   = sum % 2 !== 0;
    const winnerSlot = data.toss.winner;
    const iWon    = winnerSlot === mySlot;

    $("toss-result-text").textContent =
      `${myNum} + ${themNum} = ${sum} (${isOdd ? "Odd" : "Even"})\n` +
      (iWon ? "✓ You won the toss! You bat first." : "Opponent won the toss. You bowl first.");
  }
}

async function resolveToss(data) {
  const p1Num  = Math.floor(Math.random() * 6) + 1;
  const p2Num  = Math.floor(Math.random() * 6) + 1;
  const sum    = p1Num + p2Num;
  const isOdd  = sum % 2 !== 0;
  const p1Choice = data.p1.tossChoice;  // "odd" or "even"
  const winner   = (p1Choice === "odd" && isOdd) || (p1Choice === "even" && !isOdd) ? "p1" : "p2";
  const loser    = winner === "p1" ? "p2" : "p1";

  await updateDoc(roomRef, {
    "toss.winner": winner,
    "toss.sum":    sum,
    "p1.tossNum":  p1Num,
    "p2.tossNum":  p2Num,
    [`p1.role`]:   winner === "p1" ? "bat" : "bowl",
    [`p2.role`]:   winner === "p2" ? "bat" : "bowl",
  });

  await sleep(3000);
  await updateDoc(roomRef, { status: "playing" });
}

// ════════════════ PLAYING SCREEN ════════════════
let lastRenderedBall = -1;

function renderPlaying(data) {
  showScreen("playing");

  const me   = data[mySlot];
  const them = data[mySlot === "p1" ? "p2" : "p1"];

  // Labels
  $("p1-label").textContent  = mySlot === "p1" ? "You" : "Opponent";
  $("p2-label").textContent  = mySlot === "p2" ? "You" : "Opponent";
  $("p1-role").textContent   = data.p1.role === "bat" ? "🏏 Batting" : "🎳 Bowling";
  $("p2-role").textContent   = data.p2.role === "bat" ? "🏏 Batting" : "🎳 Bowling";

  // Scores with "crossed out" animation
  setScore("p1-score", data.p1.totalScore);
  setScore("p2-score", data.p2.totalScore);

  // Innings / target
  $("innings-label").textContent = `${data.currentInnings === 1 ? "1st" : "2nd"} Innings`;
  if (data.target) {
    $("target-label").textContent = `Target: ${data.target}`;
  }

  // Status text
  const myRole = me.role;
  if (me.move !== null && them.move === null) {
    $("status-text").textContent = "Waiting for opponent...";
  } else if (me.move === null) {
    $("status-text").textContent = myRole === "bat" ? "You're batting! Pick a number:" : "You're bowling! Pick a number:";
  }

  // Buttons state
  const grid = $("number-grid");
  const btns = grid.querySelectorAll(".num-btn");
  const canPick = me.move === null && !resolveLocked;

  btns.forEach(btn => {
    btn.disabled = !canPick;
    btn.classList.remove("selected");
    if (me.move !== null && parseInt(btn.dataset.num) === me.move) {
      btn.classList.add("selected");
    }
  });

  // Reveal logic: both picked → trigger animation
  if (data.p1.move !== null && data.p2.move !== null && !resolveLocked) {
    resolveLocked = true;
    triggerReveal(data);
  }

  // Last ball
  if (data.lastResult) {
    $("last-ball-nums").textContent = `You: ${data.lastResult.myMove} | Them: ${data.lastResult.themMove}`;
    $("last-ball-runs").textContent = data.lastResult.out ? "OUT!" : `+${data.lastResult.runs}`;
    $("last-ball-runs").style.color = data.lastResult.out ? "var(--red)" : "var(--ink)";
  }

  // Score tally
  renderTally(data);

  // Unlock after move reset
  if (data.p1.move === null && data.p2.move === null) {
    resolveLocked = false;
  }
}

// ── Attach number button handlers (once) ──
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
  const el = $(id);
  const old = el.textContent;
  if (old !== String(val)) {
    el.setAttribute("data-old", old);
    el.textContent = val;
    el.classList.remove("updated");
    void el.offsetWidth; // reflow
    el.classList.add("updated");
    setTimeout(() => el.classList.remove("updated"), 2000);
  }
}

// ── Reveal animation ──
async function triggerReveal(data) {
  const overlay = $("reveal-overlay");
  const countdown = $("reveal-countdown");
  overlay.classList.remove("hidden");

  for (let i = 3; i >= 1; i--) {
    countdown.textContent = i;
    await sleep(500);
  }
  countdown.textContent = "✊";
  await sleep(300);
  overlay.classList.add("hidden");

  // Only p1 resolves to avoid double-write
  if (mySlot === "p1") {
    await resolveMove(data);
  }
}

// ── Resolve a ball ──
async function resolveMove(data) {
  const p1Move = data.p1.move;
  const p2Move = data.p2.move;
  const batter = data.p1.role === "bat" ? "p1" : "p2";
  const bower  = batter === "p1" ? "p2" : "p1";
  const isOut  = p1Move === p2Move;

  const batterScore = data[batter].totalScore;
  const ballCount   = (data.ballCount || 0) + 1;

  const myMove   = data[mySlot].move;
  const themMove = data[mySlot === "p1" ? "p2" : "p1"].move;

  const update = {
    "p1.move": null,
    "p2.move": null,
    ballCount: ballCount,
    lastResult: {
      myMove:   p1Move,
      themMove: p2Move,
      out:      isOut,
      runs:     isOut ? 0 : data[batter].move
    }
  };

  if (isOut) {
    // Show OUT overlay briefly, handle innings
    if (data.currentInnings === 1) {
      // Switch roles, start 2nd innings
      update[`${batter}.role`] = "bowl";
      update[`${bower}.role`]  = "bat";
      update.status            = "innings_break";
      update.target            = batterScore + 1;
      update.currentInnings    = 2;
    } else {
      // Game over
      update.status = "game_over";
    }
  } else {
    // Add runs to batter
    update[`${batter}.totalScore`] = batterScore + data[batter].move;

    // Check if target exceeded in 2nd innings
    if (data.currentInnings === 2 && data.target && (batterScore + data[batter].move) >= data.target) {
      update.status = "game_over";
      update[`${batter}.totalScore`] = batterScore + data[batter].move;
    }
  }

  // Show OUT overlay on all clients via lastResult flag
  if (isOut) {
    await showOutOverlay();
  }

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
  const batted    = data.p1.role === "bowl" ? "p1" : "p2"; // just swapped
  const firstScore = data.p1.role === "bowl" ? data.p1.totalScore : data.p2.totalScore;
  $("innings-break-text").textContent =
    `1st innings over!\nScore: ${data.p1.totalScore} vs ${data.p2.totalScore}\nTarget: ${data.target} runs`;

  // p1 auto-transitions after delay
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
  if (s1 > s2)       winner = "🏆 Player 1 wins!";
  else if (s2 > s1)  winner = "🏆 Player 2 wins!";
  else               winner = "🤝 It's a tie!";

  $("winner-text").textContent = winner;

  $("play-again-btn").addEventListener("click", () => {
    window.location.href = "index.html";
  });
}

// ════════════════ TOSS BUTTON HANDLERS ════════════════
document.querySelectorAll(".toss-btn").forEach(btn => {
  btn.addEventListener("click", async () => {
    const choice = btn.dataset.choice;
    document.querySelectorAll(".toss-btn").forEach(b => b.disabled = true);
    await updateDoc(roomRef, { [`${mySlot}.tossChoice`]: choice });
    $("toss-choice-area").classList.add("hidden");
    $("toss-waiting").classList.remove("hidden");
    $("toss-pick-label").style.display = "block";
    $("toss-pick-label").textContent   = `You picked: ${choice.toUpperCase()}`;
  });
});

// ════════════════ OUT OVERLAY — react to lastResult ════════════════
// (Show on both clients when lastResult.out is set)
let lastOutBall = -1;
onSnapshot(roomRef, snap => {
  if (!snap.exists()) return;
  const d = snap.data();
  if (d.lastResult?.out && d.ballCount !== lastOutBall) {
    lastOutBall = d.ballCount;
    showOutOverlay();
  }
});

// ════════════════ BOOT ════════════════
joinRoom();
