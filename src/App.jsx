import React, { useEffect, useMemo, useState } from "react";

/**
 * Tok – prototype local (2v2) with optional bots
 * -------------------------------------------------
 * V4 – Bifurcation complète selon ta planche
 *  - Tour = 48 cases (anneau principal)
 *  - Sortie vers la GAUCHE (antihoraire)
 *  - À +4 : fourche -> on peut rester sur l'anneau OU monter
 *  - Montée = 4 cases (up1..up4) -> up4 = PORTAIL (sommet)
 *  - Depuis un PORTAIL, au **tour suivant**, on peut se téléporter vers l'un des 3 autres portails
 *  - Après un portail (téléporté ou non), la descente = 4 cases (down1..down4), puis on rejoint l'anneau au point +12
 *
 * Simplifications:
 *  - Les couloirs d'écurie et conditions de victoire ne sont pas encore câblés (à ajouter ensuite)
 *  - Traversée d'écuries vides: à venir
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
const TRACK_LEN = 48; // ✅ tour complet = 48 cases
const COLORS = ["yellow", "red", "blue", "green"]; // joueurs 0..3, équipes (0,2) & (1,3)
const DIRECTION = -1; // ➜ ANTihoraire: avancer = décrémenter les index

// ✨ Ajuste ces 4 indices pour faire coïncider EXACTEMENT la case de sortie avec ta planche.
// Astuce: passe la souris sur les ronds du plateau, le tooltip affiche "Case X".
const START_INDEXES = [2, 14, 26, 38]; // Jaune, Rouge, Bleu, Vert (à ajuster visuellement)

// Indices dérivés pour chaque joueur
function confForPlayer(idx) {
  const s = START_INDEXES[idx];
  return {
    color: COLORS[idx],
    startIndex: s,                        // case d'entrée
    forkIndex: forward(s, 4),             // +4 = début de montée possible
    portalIndex: null,                    // sommet est HORS anneau (up4)
    rejoinIndex: forward(s, 12)           // +12 = retour sur anneau après descente
  };
}

// Les 4 portails sommets: on les identifie par joueur (0..3)
// Un portail est atteint après 4 cases de montée depuis forkIndex
const PORTAL_IDS = [0, 1, 2, 3];

const TEAM_OF = (p) => (p % 2 === 0 ? 0 : 1);

function initialPawns() {
  return Array.from({ length: 4 }, () => ({ location: { kind: "base" }, pieux: false, firstMove: true }));
}

function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

// ---------- Déplacements avec sens antihoraire + bifurcation ----------
function modTrack(x) { let v = x % TRACK_LEN; if (v < 0) v += TRACK_LEN; return v; }
function forward(from, steps) { return modTrack(from + DIRECTION * steps); } // avance vers la GAUCHE

// Convertit une position en un label unique pour l'occupation
function posKey(pos) {
  const k = pos.kind;
  if (k === "track") return `T:${pos.idx}`;
  if (k === "up" || k === "down") return `${k[0].toUpperCase()}:${pos.base}:${pos.step}`; // base = index joueur (0..3)
  if (k === "portal") return `P:${pos.base}`; // base = index joueur (0..3)
  return k; // base / home
}

// Vérifie si une case est occupée
function occupantAt(state, targetKey) {
  for (let pi = 0; pi < 4; pi++) {
    const pl = state.players[pi];
    for (let pj = 0; pj < 4; pj++) {
      const p = pl.pawns[pj];
      if (p.location && posKey(p.location) === targetKey) return { owner: pi, pawnIdx: pj };
    }
  }
  return null;
}

// Chemin pas-à-pas en tenant compte des fourches
function computePathForward(state, playerIndex, startPos, steps) {
  const path = []; // tableau de positions (sans la position de départ)
  let cur = startPos;
  const conf = confForPlayer(playerIndex);
  for (let i = 0; i < steps; i++) {
    // Avance d'1 étape
    if (cur.kind === "track") {
      const nextIdx = forward(cur.idx, 1);
      // Si on arrive exactement sur la case fork, c'est juste une case de l'anneau.
      // La montée n'est possible que si on CHOISIT une action spéciale (voir plus bas) –
      // mais ici on reste sur l'anneau pour les déplacements "fwd" standard.
      cur = { kind: "track", idx: nextIdx };
    } else if (cur.kind === "up") {
      if (cur.step < 4) cur = { kind: "up", base: cur.base, step: cur.step + 1 };
      else cur = { kind: "portal", base: cur.base }; // up4 -> portail
    } else if (cur.kind === "portal") {
      // Pas d'avance depuis un portail sans téléportation -> on commence la descente au prochain mouvement
      cur = { kind: "down", base: cur.base, step: 1 };
    } else if (cur.kind === "down") {
      if (cur.step < 4) cur = { kind: "down", base: cur.base, step: cur.step + 1 };
      else {
        // down4 -> retour sur l'anneau au rejoinIndex correspondant
        const rejoin = confForPlayer(cur.base).rejoinIndex;
        cur = { kind: "track", idx: rejoin };
      }
    } else {
      // base/home ne devraient pas passer ici
      return [];
    }
    path.push(cur);
  }
  return path;
}

// Spécifique: entrer dans la montée à partir de la case fork (doit commencer EXACTEMENT sur la fork)
function computePathUpFromFork(playerIndex, steps) {
  const base = playerIndex; // utilise l'index joueur pour identifier la branche
  const path = [];
  let cur = { kind: "up", base, step: 1 }; // premier cran de montée
  for (let i = 1; i <= steps; i++) {
    if (cur.kind === "up" && cur.step < 4) {
      // avancer au prochain cran de montée
      path.push({ ...cur });
      cur = { kind: "up", base, step: cur.step + 1 };
    } else if (cur.kind === "up" && cur.step === 4) {
      // on arrive au portail
      path.push({ kind: "portal", base });
      cur = { kind: "portal", base };
    } else if (cur.kind === "portal") {
      // depuis le portail, avancer = début de descente
      cur = { kind: "down", base, step: 1 };
      path.push({ ...cur });
    } else if (cur.kind === "down") {
      if (cur.step < 4) {
        cur = { kind: "down", base, step: cur.step + 1 };
        path.push({ ...cur });
      } else {
        const rejoin = confForPlayer(base).rejoinIndex;
        cur = { kind: "track", idx: rejoin };
        path.push({ ...cur });
      }
    }
  }
  return path;
}

function isBlockedByOccupants(state, moverRef, path) {
  // règle: pas de saut. Capture possible uniquement sur la DERNIÈRE case, si adverse et non pieux.
  if (!path.length) return false;
  const lastKey = posKey(path[path.length - 1]);
  for (let i = 0; i < path.length; i++) {
    const k = posKey(path[i]);
    const occ = occupantAt(state, k);
    const isLast = k === lastKey;
    if (occ) {
      if (!isLast) return true;
      if (TEAM_OF(occ.owner) === TEAM_OF(moverRef.owner)) return true;
      const pawn = state.players[occ.owner].pawns[occ.pawnIdx];
      if (pawn.pieux) return true;
    }
  }
  return false;
}

// ---------- Génération de coups ----------
function legalMoves(state, playerIndex) {
  const moves = [];
  const player = state.players[playerIndex];
  const hand = player.hand;
  const conf = confForPlayer(playerIndex);

  for (const card of hand) {
    const ranksToTry = card.joker ? ["A","2","3","4","5","6","7","8","9","10","J","Q","K"] : [card.rank];
    for (const rank of ranksToTry) {
      // Valet (swap)
      if (rank === "J") {
        const all = [];
        state.players.forEach((pl, pi) => pl.pawns.forEach((pw, pj) => {
          const k = pw.location.kind;
          if (k !== "base" && k !== "home") all.push({ owner: pi, idx: pj, key: posKey(pw.location) });
        }));
        for (let a = 0; a < all.length; a++) for (let b = a + 1; b < all.length; b++) if (all[a].key !== all[b].key)
          moves.push({ type: "swap", cardId: card.id, usingRank: rank, A: all[a], B: all[b] });
        continue;
      }

      // 5: avancer partenaire/adverse (pas soi) sur leur chemin actuel (anneau, up, portal->down)
      if (rank === "5") {
        state.players.forEach((pl, pi) => {
          if (pi === playerIndex) return;
          pl.pawns.forEach((pw, pj) => {
            if (pw.location.kind === "base" || pw.location.kind === "home") return;
            const path = computePathForward(state, pi, pw.location, 5);
            if (!isBlockedByOccupants(state, { owner: pi, pawnIdx: pj }, path))
              moves.push({ type: "movePath", cardId: card.id, usingRank: rank, owner: pi, pawnIdx: pj, path });
          });
        });
        continue;
      }

      // 4: reculer = avancer HORAIRE (on inverse la direction -> on simule avec 48-steps?)
      if (rank === "4") {
        player.pawns.forEach((pw, pj) => {
          if (pw.location.kind === "track") {
            // reculer de 4 sur l'anneau uniquement
            const tmpStart = { kind: "track", idx: modTrack(pw.location.idx - DIRECTION * 0) };
            const path = []; let cur = pw.location;
            for (let i = 0; i < 4; i++) { cur = { kind: "track", idx: modTrack(cur.idx - DIRECTION * 1) }; path.push(cur); }
            if (!isBlockedByOccupants(state, { owner: playerIndex, pawnIdx: pj }, path))
              moves.push({ type: "movePath", cardId: card.id, usingRank: rank, owner: playerIndex, pawnIdx: pj, path });
          }
        });
        continue;
      }

      // A/K: sortir OU avancer (A=1, K=13)
      if (rank === "A" || rank === "K") {
        const canStart = player.pawns.some((p) => p.location.kind === "base");
        if (canStart) moves.push({ type: "start", cardId: card.id, usingRank: rank });
      }

      // Avances classiques (y compris 7 split simplifié)
      if (["A","2","3","6","7","8","9","10","Q","K"].includes(rank)) {
        const steps = rank === "A" ? 1 : rank === "K" ? 13 : rankToValue(rank);

        if (rank === "7") {
          const splits = [[7],[6,1],[5,2],[4,3]]; // sur ses propres pions uniquement
          for (const split of splits) {
            const options = enumerateSevenSplits(state, playerIndex, split);
            moves.push(...options.map((pathOps) => ({ type: "sevenPaths", cardId: card.id, usingRank: rank, pathOps })));
          }
        } else {
          // Avancer selon la position actuelle
          player.pawns.forEach((pw, pj) => {
            if (pw.location.kind === "base" || pw.location.kind === "home") return;
            let path = computePathForward(state, playerIndex, pw.location, steps);
            if (!isBlockedByOccupants(state, { owner: playerIndex, pawnIdx: pj }, path))
              moves.push({ type: "movePath", cardId: card.id, usingRank: rank, owner: playerIndex, pawnIdx: pj, path });

            // Option spéciale: si on est EXACTEMENT sur la fork -> possibilité de MONTER
            if (pw.location.kind === "track" && pw.location.idx === conf.forkIndex) {
              const upPath = computePathUpFromFork(playerIndex, steps);
              if (upPath.length && !isBlockedByOccupants(state, { owner: playerIndex, pawnIdx: pj }, upPath))
                moves.push({ type: "movePath", cardId: card.id, usingRank: rank, owner: playerIndex, pawnIdx: pj, path: upPath, tag: "monte" });
            }
          });
        }
      }
    }
  }

  return moves;
}

function enumerateSevenSplits(state, playerIndex, split) {
  // Génère des séquences de chemins indépendantes (sur ses pions)
  const myRefs = [];
  state.players[playerIndex].pawns.forEach((pw, pj) => { if (pw.location.kind !== "base" && pw.location.kind !== "home") myRefs.push({ owner: playerIndex, pawnIdx: pj }); });
  const results = [];

  function backtrack(i, acc) {
    if (i === split.length) { results.push(acc); return; }
    for (const ref of myRefs) {
      const startPos = state.players[ref.owner].pawns[ref.pawnIdx].location;
      const path = computePathForward(state, playerIndex, startPos, split[i]);
      if (!isBlockedByOccupants(state, ref, path)) backtrack(i + 1, [...acc, { ref, path }]);

      // depuis la fork, possibilité de montée
      const conf = confForPlayer(playerIndex);
      if (startPos.kind === "track" && startPos.idx === conf.forkIndex) {
        const upPath = computePathUpFromFork(playerIndex, split[i]);
        if (!isBlockedByOccupants(state, ref, upPath)) backtrack(i + 1, [...acc, { ref, path: upPath }]);
      }
    }
  }
  backtrack(0, []);
  return results;
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
    const conf = confForPlayer(playerIndex);
    const entryKey = posKey({ kind: "track", idx: conf.startIndex });
    const occ = occupantAt(S, entryKey);
    if (occ) {
      if (TEAM_OF(occ.owner) !== TEAM_OF(playerIndex) && !S.players[occ.owner].pawns[occ.pawnIdx].pieux) {
        S.players[occ.owner].pawns[occ.pawnIdx] = { location: { kind: "base" }, pieux: false, firstMove: true };
      } else {
        S.log.push(entry(playerIndex, `Sortie impossible: case d'entrée bloquée.`));
        return S;
      }
    }
    const pawnId = player.pawns.findIndex((p) => p.location.kind === "base");
    if (pawnId >= 0) {
      player.pawns[pawnId] = { location: { kind: "track", idx: conf.startIndex }, pieux: true, firstMove: true };
      S.log.push(entry(playerIndex, `Sort un pion (pieux).`));
    }
    return S;
  }

  if (move.type === "movePath") {
    const { owner, pawnIdx, path } = move;
    const pawn = S.players[owner].pawns[pawnIdx];
    if (!path.length) return S;
    const last = path[path.length - 1];
    // capture sur la case finale si adverse
    const occ = occupantAt(S, posKey(last));
    if (occ && TEAM_OF(occ.owner) !== TEAM_OF(owner)) {
      const opPawn = S.players[occ.owner].pawns[occ.pawnIdx];
      if (!opPawn.pieux) S.players[occ.owner].pawns[occ.pawnIdx] = { location: { kind: "base" }, pieux: false, firstMove: true };
    }
    pawn.location = last;
    pawn.pieux = false;
    pawn.firstMove = false;
    // Si on s'arrête sur un portail, on pourra TELEPORTER au prochain tour
    if (last.kind === "portal") {
      const otherChoices = PORTAL_IDS.filter((p) => p !== last.base);
      S.pendingPortal = { owner, pawnIdx, fromPortal: last.base, choices: otherChoices };
    }
    S.log.push(entry(playerIndex, `Avance (${move.usingRank})${move.tag === "monte" ? " en montée" : ""}.`));
    return S;
  }

  if (move.type === "sevenPaths") {
    for (const op of move.pathOps) {
      const { ref, path } = op;
      if (!path.length) continue;
      const last = path[path.length - 1];
      const occ = occupantAt(S, posKey(last));
      if (occ && TEAM_OF(occ.owner) !== TEAM_OF(ref.owner)) {
        const opPawn = S.players[occ.owner].pawns[occ.pawnIdx];
        if (!opPawn.pieux) S.players[occ.owner].pawns[occ.pawnIdx] = { location: { kind: "base" }, pieux: false, firstMove: true };
      }
      const pawn = S.players[ref.owner].pawns[ref.pawnIdx];
      pawn.location = last; pawn.pieux = false; pawn.firstMove = false;
      if (last.kind === "portal") {
        const otherChoices = PORTAL_IDS.filter((p) => p !== last.base);
        S.pendingPortal = { owner: ref.owner, pawnIdx: ref.pawnIdx, fromPortal: last.base, choices: otherChoices };
      }
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
  const score = (m) => (m.type === "start" ? 90 : m.type === "movePath" ? 70 : m.type === "sevenPaths" ? 75 : m.type === "swap" ? 40 : 10);
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

  function checkVictory(S) { /* TODO couloirs d'écurie */ }

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
  function usePortal(destPortalId) {
    setState((prev) => {
      const S = clone(prev); if (!S.pendingPortal) return S; const { owner, pawnIdx, choices } = S.pendingPortal; if (!choices.includes(destPortalId)) return S;
      // Téléporte vers un autre sommet
      const pawn = S.players[owner].pawns[pawnIdx];
      pawn.location = { kind: "portal", base: destPortalId };
      pawn.pieux = false; pawn.firstMove = false;
      S.log.push(entry(state.turn, `Téléportation vers portail ${destPortalId}.`)); S.pendingPortal = null; return S;
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
                  <button key={c} className="px-3 py-1 rounded-2xl shadow bg-white" onClick={() => usePortal(c)}>Sommet {c}</button>
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
  // Dessin: anneau = 48 points; on marque les forks (+4) et les sorties
  return (
    <div className="relative w-full aspect-square bg-gradient-to-br from-amber-100 to-amber-200 rounded-2xl">
      {[...Array(TRACK_LEN)].map((_, i) => {
        const angle = (2 * Math.PI * i) / TRACK_LEN; // repère visuel
        const r = 42; const cx = 50 + r * Math.cos(angle); const cy = 50 + r * Math.sin(angle);
        const occ = findOccTrack(state, i);
        const isStart = START_INDEXES.includes(i);
        const isFork = START_INDEXES.some((s) => modTrack(s + DIRECTION * 4) === i);
        return (
          <div key={i} className={`absolute -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full border flex items-center justify-center text-[10px] ${isFork ? "bg-amber-300 border-amber-700" : isStart ? "bg-amber-200 border-amber-600" : "bg-white border-neutral-400"}`} style={{ left: `${cx}%`, top: `${cy}%` }} title={`Case ${i}`}>
            {occ && <PawnDot color={state.players[occ.owner].color} />}
          </div>
        );
      })}

      {/* Portails (sommets) schématiques autour du cercle */}
      {PORTAL_IDS.map((id) => {
        const s = START_INDEXES[id];
        const angle = (2 * Math.PI * modTrack(s + DIRECTION * 8)) / TRACK_LEN; // projeter visuellement le sommet
        const r = 30; const cx = 50 + r * Math.cos(angle); const cy = 50 + r * Math.sin(angle);
        const occ = findOccPortal(state, id);
        return (
          <div key={id} className="absolute -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full border bg-purple-200 border-purple-700 flex items-center justify-center text-[10px]" style={{ left: `${cx}%`, top: `${cy}%` }} title={`Sommet ${id}`}>
            {occ && <PawnDot color={state.players[occ.owner].color} />}
          </div>
        );
      })}
    </div>
  );
}

function findOccTrack(state, idx) {
  return occupantAt(state, posKey({ kind: "track", idx }));
}
function findOccPortal(state, base) {
  return occupantAt(state, posKey({ kind: "portal", base }));
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
            {moves.slice(0, 18).map((m, i) => (
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
  if (m.type === "movePath") return `${m.usingRank}${m.tag === "monte" ? " (monter)" : ""}`;
  if (m.type === "sevenPaths") return `7 décomposé`;
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
        {moves.slice(0, 20).map((m, i) => (
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
