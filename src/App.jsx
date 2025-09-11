import React, { useEffect, useMemo, useState } from "react";

/**
 * Tok – prototype local (2v2) with optional bots
 * -------------------------------------------------
 * V3 – Sens de déplacement ANTihoraire (vers la gauche) après la sortie.
 *  - 4 humains par défaut (bots désactivés, bouton pour activer au besoin)
 *  - Choix manuel du passage secret quand on s'arrête sur une pointe
 *  - Indices de sortie réglables pour coller à ta planche (START_INDEXES)
 *  - Distribution: 5 cartes puis 4, échange 1 carte entre partenaires
 *  - Règles cartes principales + Joker, 7 décomposable (base)
 *
 * À venir si tu veux (prochaine itération):
 *  - Traversée des écuries vides, couloirs d'arrivée complets et conditions de victoire sur "home"
 *  - Règles de fin avec le 7 (3 pions rentrés / dernier pion d'équipe) au millimètre
 */

// ---------- Helpers de cartes ----------
const SUITS = ["♠", "♥", "♦", "♣"]; // visuel
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

function buildDeck(includeJokers = true) {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ id: `${r}${s}-${Math.random()}`, rank: r, suit: s, joker: false });
  if (includeJokers) {
    deck.push({ id: `JokerA-${Math.random()}`, rank: "JOKER", suit: "", joker: true });
    deck.push({ id: `JokerB-${Math.random()}`, rank: "JOKER", suit: "", joker: true });
  }
  return shuffle(deck);
}

function shuffle(a) {
  const arr = [...a];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function rankToValue(rank) {
  switch (rank) {
    case "A": return 1;
    case "J": return 11;
    case "Q": return 12;
    case "K": return 13;
    default: return parseInt(rank, 10);
  }
}

// ---------- Plateau ----------
const TRACK_LEN = 56; // 14 cases par quadrant
const SECRET_PORTALS = [0, 14, 28, 42]; // pointes
const COLORS = ["yellow", "red", "blue", "green"]; // joueurs 0..3, équipes (0,2) & (1,3)
const DIRECTION = -1; // ➜ ANTihoraire: avancer = décrémenter les index

// ✨ Ajuste ces 4 indices pour faire coïncider EXACTEMENT la case de sortie avec ta planche.
// Astuce: passe la souris sur les ronds du plateau, le tooltip affiche "Case X".
const START_INDEXES = [2, 16, 30, 44]; // Jaune, Rouge, Bleu, Vert (à ajuster visuellement)

const PLAYER_CONF = COLORS.map((c, idx) => ({
  color: c,
  startIndex: START_INDEXES[idx],
  portalTarget: (START_INDEXES[idx] + 48) % TRACK_LEN // ≈ "+8" antihoraire depuis la sortie
}));

const TEAM_OF = (p) => (p % 2 === 0 ? 0 : 1);

function initialPawns() {
  return Array.from({ length: 4 }, () => ({ location: "base", pieux: false, firstMove: true }));
}

function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

// ---------- Déplacements avec sens antihoraire ----------
function modTrack(x) { let v = x % TRACK_LEN; if (v < 0) v += TRACK_LEN; return v; }
function forward(from, steps) { return modTrack(from + DIRECTION * steps); } // avance vers la GAUCHE
function pathIndicesForward(from, steps) { const out = []; for (let i = 1; i <= steps; i++) out.push(forward(from, i)); return out; }
function pathIndicesBackward(from, steps) { const out = []; for (let i = 1; i <= steps; i++) out.push(modTrack(from - DIRECTION * i)); return out; }
function isSecretPortal(idx) { return SECRET_PORTALS.includes(idx); }

// ---------- Outils d'occupation ----------
function occupantAt(state, trackIndex) {
  for (let pi = 0; pi < 4; pi++) {
    const pl = state.players[pi];
    for (let pj = 0; pj < 4; pj++) {
      const p = pl.pawns[pj];
      if (typeof p.location === "number" && p.location === trackIndex) return { owner: pi, pawnIdx: pj };
    }
  }
  return null;
}

function isPathBlocked(state, targetRef, path) {
  const last = path[path.length - 1];
  for (let i = 0; i < path.length; i++) {
    const idx = path[i];
    const occ = occupantAt(state, idx);
    const isLast = idx === last;
    if (occ) {
      if (!isLast) return true; // pas de saut
      if (TEAM_OF(occ.owner) === TEAM_OF(targetRef.owner)) return true; // allié bloque la case finale
      const pawn = state.players[occ.owner].pawns[occ.pawnIdx];
      if (pawn.pieux) return true; // adverse pieux intouchable
    }
  }
  return false;
}

// ---------- Génération de coups ----------
function legalMoves(state, playerIndex) {
  const moves = [];
  const player = state.players[playerIndex];
  const hand = player.hand;

  for (const card of hand) {
    const ranksToTry = card.joker ? ["A","2","3","4","5","6","7","8","9","10","J","Q","K"] : [card.rank];
    for (const rank of ranksToTry) {
      if (rank === "J") {
        // Valet: échanger deux pions (impact réel)
        const all = [];
        state.players.forEach((pl, pi) => pl.pawns.forEach((pw, pj) => { if (typeof pw.location === "number") all.push({ owner: pi, idx: pj, loc: pw.location }); }));
        for (let a = 0; a < all.length; a++) for (let b = a + 1; b < all.length; b++) if (all[a].loc !== all[b].loc)
          moves.push({ type: "swap", cardId: card.id, usingRank: rank, A: all[a], B: all[b] });
        continue;
      }

      if (rank === "5") {
        // 5: avancer partenaire ou adversaire (pas soi)
        state.players.forEach((pl, pi) => {
          if (pi === playerIndex) return;
          pl.pawns.forEach((pw, pj) => {
            if (typeof pw.location === "number") {
              const path = pathIndicesForward(pw.location, 5);
              if (!isPathBlocked(state, { owner: pi, pawnIdx: pj }, path)) moves.push({ type: "move", cardId: card.id, usingRank: rank, target: { owner: pi, pawnIdx: pj }, steps: 5, dir: "fwd" });
            }
          });
        });
        continue;
      }

      if (rank === "4") {
        // 4: reculer (donc avancer horaire)
        state.players[playerIndex].pawns.forEach((pw, pj) => {
          if (typeof pw.location === "number") {
            const path = pathIndicesBackward(pw.location, 4);
            if (!isPathBlocked(state, { owner: playerIndex, pawnIdx: pj }, path)) moves.push({ type: "move", cardId: card.id, usingRank: rank, target: { owner: playerIndex, pawnIdx: pj }, steps: 4, dir: "back" });
          }
        });
        continue;
      }

      if (rank === "A" || rank === "K") {
        // Sortir OU avancer (A=1, K=13)
        const canStart = player.pawns.some((p) => p.location === "base");
        if (canStart) moves.push({ type: "start", cardId: card.id, usingRank: rank });
      }

      // Avances classiques
      if (["A","2","3","6","7","8","9","10","Q","K"].includes(rank)) {
        const steps = rank === "A" ? 1 : rank === "K" ? 13 : rankToValue(rank);
        if (rank === "7") {
          // 7 décomposable (simple: proposer 7, 6+1, 5+2, 4+3 sur ses pions)
          const splits = [[7],[6,1],[5,2],[4,3]];
          for (const split of splits) {
            const options = enumerateSevenSplits(state, playerIndex, split);
            moves.push(...options.map((ops) => ({ type: "seven", cardId: card.id, usingRank: rank, ops })));
          }
        } else {
          state.players[playerIndex].pawns.forEach((pw, pj) => {
            if (typeof pw.location === "number") {
              const path = pathIndicesForward(pw.location, steps);
              if (!isPathBlocked(state, { owner: playerIndex, pawnIdx: pj }, path)) moves.push({ type: "move", cardId: card.id, usingRank: rank, target: { owner: playerIndex, pawnIdx: pj }, steps, dir: "fwd" });
            }
          });
        }
      }
    }
  }

  return moves;
}

function enumerateSevenSplits(state, playerIndex, split) {
  const ops = [];
  const my = [];
  state.players[playerIndex].pawns.forEach((pw, pj) => { if (typeof pw.location === "number") my.push({ owner: playerIndex, pawnIdx: pj }); });
  if (!my.length) return ops;
  function backtrack(i, acc) {
    if (i === split.length) { ops.push(acc); return; }
    for (const ref of my) {
      const from = state.players[ref.owner].pawns[ref.pawnIdx].location;
      const path = pathIndicesForward(from, split[i]);
      if (!isPathBlocked(state, ref, path)) backtrack(i + 1, [...acc, { target: ref, steps: split[i], dir: "fwd" }]);
    }
  }
  backtrack(0, []);
  return ops;
}

// ---------- Application des coups ----------
function applyMove(state, playerIndex, move) {
  const S = clone(state);
  const player = S.players[playerIndex];
  // Retire la carte
  const ci = player.hand.findIndex((c) => c.id === move.cardId);
  if (ci >= 0) player.hand.splice(ci, 1);

  if (move.type === "swap") {
    const a = S.players[move.A.owner].pawns[move.A.idx];
    const b = S.players[move.B.owner].pawns[move.B.idx];
    const la = a.location; a.location = b.location; b.location = la; a.pieux = false; b.pieux = false; a.firstMove = false; b.firstMove = false;
    S.log.push(entry(playerIndex, `Valet: interverti deux pions.`));
    return S;
  }

  if (move.type === "start") {
    const conf = PLAYER_CONF[playerIndex];
    const entry = conf.startIndex;
    const occ = occupantAt(S, entry);
    if (occ) {
      if (TEAM_OF(occ.owner) !== TEAM_OF(playerIndex) && !S.players[occ.owner].pawns[occ.pawnIdx].pieux) {
        S.players[occ.owner].pawns[occ.pawnIdx] = { location: "base", pieux: false, firstMove: true };
      } else {
        S.log.push(entry(playerIndex, `Sortie impossible: case d'entrée bloquée.`));
        return S;
      }
    }
    const pawnId = player.pawns.findIndex((p) => p.location === "base");
    if (pawnId >= 0) {
      player.pawns[pawnId] = { location: entry, pieux: true, firstMove: true };
      S.log.push(entry(playerIndex, `Sort un pion (pieux).`));
    }
    return S;
  }

  if (move.type === "move") {
    const { owner, pawnIdx, steps, dir } = move;
    const pawn = S.players[owner].pawns[pawnIdx];
    if (typeof pawn.location === "number") {
      const dest = dir === "fwd" ? forward(pawn.location, steps) : pathIndicesBackward(pawn.location, steps).slice(-1)[0];
      // capture finale si adverse
      const occ = occupantAt(S, dest);
      if (occ && TEAM_OF(occ.owner) !== TEAM_OF(owner)) {
        const opPawn = S.players[occ.owner].pawns[occ.pawnIdx];
        if (!opPawn.pieux) S.players[occ.owner].pawns[occ.pawnIdx] = { location: "base", pieux: false, firstMove: true };
      }
      pawn.location = dest;
      pawn.pieux = false;
      pawn.firstMove = false;
      if (isSecretPortal(dest)) S.pendingPortal = { owner, pawnIdx, from: dest, choices: SECRET_PORTALS.filter((p) => p !== dest) };
      S.log.push(entry(playerIndex, `Avance ${dir === "fwd" ? "+" : "-"}${steps}.`));
    }
    return S;
  }

  if (move.type === "seven") {
    for (const op of move.ops) {
      const { owner, pawnIdx, steps } = op;
      const pawn = S.players[owner].pawns[pawnIdx];
      if (typeof pawn.location !== "number") continue;
      const path = pathIndicesForward(pawn.location, steps);
      if (isPathBlocked(S, { owner, pawnIdx }, path)) continue;
      const dest = path[path.length - 1];
      const occ = occupantAt(S, dest);
      if (occ && TEAM_OF(occ.owner) !== TEAM_OF(owner)) {
        const opPawn = S.players[occ.owner].pawns[occ.pawnIdx];
        if (!opPawn.pieux) S.players[occ.owner].pawns[occ.pawnIdx] = { location: "base", pieux: false, firstMove: true };
      }
      pawn.location = dest;
      pawn.pieux = false;
      pawn.firstMove = false;
      if (isSecretPortal(dest)) S.pendingPortal = { owner, pawnIdx, from: dest, choices: SECRET_PORTALS.filter((p) => p !== dest) };
    }
    S.log.push(entry(playerIndex, `7 décomposé.`));
    return S;
  }

  return S;
}

function entry(playerIndex, text) { return { t: Date.now(), who: playerIndex, text }; }

// ---------- IA naïve ----------
function chooseBotMove(state, playerIndex) {
  const moves = legalMoves(state, playerIndex);
  if (!moves.length) return null;
  const score = (m) => (m.type === "start" ? 90 : m.type === "move" ? (m.dir === "fwd" ? 70 : 50) : m.type === "seven" ? 75 : m.type === "swap" ? 40 : 10);
  return moves.reduce((best, m) => (score(m) > score(best) ? m : best), moves[0]);
}

// ---------- Composant principal ----------
export default function App() {
  const [state, setState] = useState(() => newGame());
  const moves = useMemo(() => legalMoves(state, state.turn), [state]);

  useEffect(() => {
    const pl = state.players[state.turn];
    if (pl.isBot && !state.exchangePhase && !state.gameOver) {
      const timer = setTimeout(() => {
        if (pl.mustDiscard) { handleDiscardHand(); return; }
        const mv = chooseBotMove(state, state.turn);
        if (mv) applyAndNext(mv); else handleDiscardHand();
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [state]);

  function newGame() {
    const deck = buildDeck(true);
    const players = COLORS.map((color, i) => ({
      color,
      isBot: false, // 4 humains par défaut
      pawns: initialPawns(),
      hand: [],
      exchangedWithPartner: false,
      mustDiscard: false
    }));
    const S = { players, deck, discard: [], turn: 0, dealer: 0, exchangePhase: true, swappedCardBuffer: {}, pendingPortal: null, log: [], gameOver: false, roundDealCount: 0 };
    startRound(S);
    return S;
  }

  function startRound(S) {
    const give = S.roundDealCount === 0 ? 5 : 4;
    for (let i = 0; i < 4; i++) {
      const p = S.players[i];
      p.hand = p.hand.concat(S.deck.splice(0, give));
      p.exchangedWithPartner = false; p.mustDiscard = false;
    }
    if (S.deck.length === 2) S.discard.push(...S.deck.splice(0));
    S.exchangePhase = true; S.roundDealCount += 1; S.turn = S.dealer;
  }

  function nextTurnAfterPlay(S) {
    S.turn = (S.turn + 1) % 4;
    const everyoneEmpty = S.players.every((p) => p.hand.length === 0);
    if (everyoneEmpty) {
      if (S.deck.length < 16) S.deck.push(...shuffle(S.discard.splice(0)));
      startRound(S);
    }
  }

  function checkVictory(S) {
    // TODO V4: compter les pions "home" quand on implémente les couloirs d'écurie
  }

  function applyAndNext(move) { setState((prev) => { const S = applyMove(prev, prev.turn, move); checkVictory(S); if (!S.gameOver) nextTurnAfterPlay(S); return S; }); }
  function handleDiscardHand() { setState((prev) => { const S = clone(prev); const pl = S.players[S.turn]; S.discard.push(...pl.hand.splice(0)); S.log.push(entry(S.turn, "Jette sa main.")); nextTurnAfterPlay(S); return S; }); }
  function toggleBot(i) { setState((prev) => { const S = clone(prev); S.players[i].isBot = !S.players[i].isBot; return S; }); }
  function exchangeCard(i, cardId) {
    setState((prev) => {
      const S = clone(prev); if (!S.exchangePhase) return S; const partner = (i + 2) % 4;
      const hand = S.players[i].hand; const idx = hand.findIndex((c) => c.id === cardId); if (idx < 0) return S;
      const [card] = hand.splice(idx, 1); (S.swappedCardBuffer[partner] ||= []).push(card); S.players[i].exchangedWithPartner = true;
      const a = i, b = partner;
      if (S.players[a].exchangedWithPartner && S.players[b].exchangedWithPartner) {
        if (S.swappedCardBuffer[a]) { S.players[a].hand.push(...S.swappedCardBuffer[a]); delete S.swappedCardBuffer[a]; }
        if (S.swappedCardBuffer[b]) { S.players[b].hand.push(...S.swappedCardBuffer[b]); delete S.swappedCardBuffer[b]; }
        S.exchangePhase = false;
      }
      return S;
    });
  }
  function usePortal(dest) {
    setState((prev) => {
      const S = clone(prev); if (!S.pendingPortal) return S; const { owner, pawnIdx, choices } = S.pendingPortal; if (!choices.includes(dest)) return S;
      const pawn = S.players[owner].pawns[pawnIdx]; pawn.location = dest; pawn.pieux = false; pawn.firstMove = false;
      S.log.push(entry(state.turn, `Utilise un passage secret vers ${dest}.`)); S.pendingPortal = null; return S;
    });
  }

  return (
    <div className="min-h-screen w-full p-4 bg-neutral-100">
      <div className="max-w-6xl mx-auto grid grid-cols-12 gap-4">
        {/* Header */}
        <div className="col-span-12 flex items-center justify-between">
          <h1 className="text-2xl font-bold">Tok – Prototype</h1>
          <div className="flex gap-2">
            {state.pendingPortal && (
              <div className="flex gap-2 items-center">
                <span className="text-sm">Choisir passage :</span>
                {state.pendingPortal.choices.map((c) => (
                  <button key={c} className="px-3 py-1 rounded-2xl shadow bg-white" onClick={() => usePortal(c)}>{c}</button>
                ))}
              </div>
            )}
            <button className="px-3 py-1 rounded-2xl shadow bg-white" onClick={() => setState(newGame())}>Nouvelle partie</button>
          </div>
        </div>

        {/* Plateau */}
        <div className="col-span-8 bg-white rounded-2xl shadow p-4">
          <Board state={state} />
        </div>

        {/* Panneau latéral */}
        <div className="col-span-4 flex flex-col gap-4">
          <TurnPanel state={state} moves={moves} onPlay={applyAndNext} onDiscard={handleDiscardHand} />

          <div className="bg-white rounded-2xl shadow p-3">
            <h3 className="font-semibold mb-2">Joueurs</h3>
            <div className="grid grid-cols-2 gap-2">
              {state.players.map((p, i) => (
                <div key={i} className={`rounded-xl p-2 border ${i === state.turn ? "border-black" : "border-neutral-200"}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{labelPlayer(i)}</span>
                    <button className="text-xs px-2 py-1 rounded-full bg-neutral-100" onClick={() => toggleBot(i)}>{p.isBot ? "Bot" : "Humain"}</button>
                  </div>
                  <div className="text-sm opacity-70">Couleur: {p.color}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow p-3 max-h-64 overflow-auto">
            <h3 className="font-semibold mb-2">Historique</h3>
            <ul className="text-sm space-y-1">
              {state.log.slice().reverse().map((l, i) => (
                <li key={i}>
                  <span className="opacity-60 mr-1">{new Date(l.t).toLocaleTimeString()}</span>
                  {l.who >= 0 && <strong className="mr-1">{labelPlayer(l.who)}:</strong>}
                  {l.text}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Main du joueur courant */}
        <div className="col-span-12 bg-white rounded-2xl shadow p-4">
          <h3 className="font-semibold mb-2">Tour de {labelPlayer(state.turn)}</h3>
          {state.exchangePhase ? (
            <ExchangePanel state={state} onChoose={exchangeCard} />
          ) : (
            <HandPanel state={state} moves={moves} onPlay={applyAndNext} onDiscard={handleDiscardHand} />
          )}
        </div>
      </div>
    </div>
  );
}

function labelPlayer(i) { return ["J1 (Jaune)", "J2 (Rouge)", "J3 (Bleu)", "J4 (Vert)"][i]; }

function Board({ state }) {
  return (
    <div className="relative w-full aspect-square bg-gradient-to-br from-amber-100 to-amber-200 rounded-2xl">
      {/* Cercle */}
      {[...Array(TRACK_LEN)].map((_, i) => {
        const angle = (2 * Math.PI * i) / TRACK_LEN; // repère visuel (non lié au sens)
        const r = 42; const cx = 50 + r * Math.cos(angle); const cy = 50 + r * Math.sin(angle);
        const occ = occupantAt(state, i); const portal = isSecretPortal(i);
        return (
          <div key={i} className={`absolute -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full border flex items-center justify-center text-[10px] ${portal ? "bg-purple-200 border-purple-600" : "bg-white border-neutral-400"}`} style={{ left: `${cx}%`, top: `${cy}%` }} title={`Case ${i}`}>
            {occ && <PawnDot color={state.players[occ.owner].color} />}
          </div>
        );
      })}
      {/* Cases de sortie */}
      {PLAYER_CONF.map((conf, idx) => {
        const angle = (2 * Math.PI * conf.startIndex) / TRACK_LEN; const r = 34; const cx = 50 + r * Math.cos(angle); const cy = 50 + r * Math.sin(angle);
        return (
          <div key={idx} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${cx}%`, top: `${cy}%` }}>
            <div className="w-8 h-8 rounded-xl border-2 border-neutral-600 flex items-center justify-center" style={{ background: colorToken(COLORS[idx]) }}>S</div>
          </div>
        );
      })}
    </div>
  );
}

function PawnDot({ color }) { return <div className="w-3 h-3 rounded-full" style={{ background: colorToken(color) }} />; }

function colorToken(color) {
  switch (color) { case "yellow": return "#facc15"; case "red": return "#ef4444"; case "blue": return "#3b82f6"; case "green": return "#22c55e"; default: return "#9ca3af"; }
}

function TurnPanel({ state, moves, onPlay, onDiscard }) {
  return (
    <div className="bg-white rounded-2xl shadow p-3">
      <h3 className="font-semibold mb-2">Actions</h3>
      {state.exchangePhase ? (
        <div className="text-sm opacity-70">Phase d'échange en cours.</div>
      ) : (
        <>
          <div className="text-sm mb-2">Coups légaux: {moves.length}</div>
          <div className="flex flex-wrap gap-2">
            {moves.slice(0, 16).map((m, i) => (
              <button key={i} onClick={() => onPlay(m)} className="px-2 py-1 rounded-xl bg-neutral-100 text-sm">{renderMoveLabel(m)}</button>
            ))}
          </div>
          {moves.length === 0 && (
            <button onClick={onDiscard} className="mt-2 px-3 py-1 rounded-xl bg-neutral-100">Jeter la main</button>
          )}
        </>
      )}
    </div>
  );
}

function renderMoveLabel(m) {
  if (m.type === "start") return `Sortir (${m.usingRank})`;
  if (m.type === "move") return `${m.usingRank} : ${m.dir === "fwd" ? "+" : "-"}${m.steps}`;
  if (m.type === "seven") return `7 décomposé (${m.ops.map((o) => o.steps).join("+")})`;
  if (m.type === "swap") return `Valet: échanger`;
  return "Coup";
}

function HandPanel({ state, moves, onPlay, onDiscard }) {
  const me = state.players[state.turn];
  if (me.isBot) return <div className="opacity-60 text-sm">Bot en train de jouer...</div>;
  return (
    <div>
      <div className="mb-3 flex gap-2 flex-wrap">
        {me.hand.map((c) => (
          <span key={c.id} className={`px-3 py-2 rounded-xl shadow text-sm bg-white border ${c.joker ? "border-purple-500" : "border-neutral-300"}`}>
            {c.joker ? "JOKER" : `${c.rank}${c.suit}`}
          </span>
        ))}
      </div>
      <div className="flex gap-2 flex-wrap">
        {moves.slice(0, 18).map((m, i) => (
          <button key={i} onClick={() => onPlay(m)} className="px-3 py-2 rounded-xl bg-neutral-100">{renderMoveLabel(m)}</button>
        ))}
        {moves.length === 0 && (
          <button onClick={onDiscard} className="px-3 py-2 rounded-xl bg-neutral-100">Jeter la main</button>
        )}
      </div>
    </div>
  );
}

function ExchangePanel({ state, onChoose }) {
  const i = state.turn; const me = state.players[i]; const partner = (i + 2) % 4;
  if (me.isBot) return <div className="text-sm opacity-60">Phase d'échange: le bot choisit une carte à donner...</div>;
  return (
    <div>
      <div className="mb-2">Choisis <strong>1 carte</strong> à donner à ton partenaire ({labelPlayer(partner)}).</div>
      <div className="flex gap-2 flex-wrap">
        {me.hand.map((c) => (
          <button key={c.id} onClick={() => onChoose(i, c.id)} className={`px-3 py-2 rounded-xl shadow text-sm bg-white border ${c.joker ? "border-purple-500" : "border-neutral-300"}`}>
            {c.joker ? "JOKER" : `${c.rank}${c.suit}`}
          </button>
        ))}
      </div>
      <p className="text-xs opacity-60 mt-2">Tu verras la carte reçue quand votre partenaire aura aussi donné.</p>
    </div>
  );
}

