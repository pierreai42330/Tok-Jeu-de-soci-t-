import React, { useEffect, useMemo, useState } from "react";

/**
 * Tok – Prototype web (local + bots)
 * V5 — Bases (écuries) + Couloirs d’arrivée + Bifurcation complète
 * - Tour principal = 48 cases, déplacement vers la GAUCHE (antihoraire)
 * - A la sortie, à +4 : fourche -> on peut continuer ou MONTER (4 cases) -> SOMMET/PORTAIL
 * - Quand on S’ARRÊTE sur un portail, au TOUR SUIVANT on peut se téléporter vers l’un des 3 autres
 * - Après un sommet (téléporté ou non), on DESCEND 4 cases et on revient sur l’anneau à +12
 * - Chaque couleur a :
 *     • une BASE (écurie) avec 4 pions
 *     • une ENTRÉE DE COULOIR juste “au-dessus” de la sortie (offset 1 par défaut)
 *     • un COULOIR d’arrivée (HOME_LEN, ici 6)
 * - Un pion n’entre QUE dans son propre couloir. Entrée/avancée dans le couloir nécessite de tomber juste.
 * - Capture uniquement sur la case d’arrivée. Pions “pieux” (tout juste sortis) intouchables jusqu’au premier déplacement.
 *
 * A faire ensuite (si tu veux) :
 * - Traversée des écuries vides (autres couleurs) “en passage”
 * - Règle du 7 de fin (3 pions rentrés / dernier pion d’équipe)
 * - Condition de victoire (8 pions d’équipe rentrés)
 */

/* ---------------- Cartes ---------------- */

const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

function buildDeck(includeJokers = true) {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS)
    deck.push({ id: `${r}${s}-${Math.random()}`, rank: r, suit: s, joker: false });
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

/* ---------------- Plateau / Modèle ---------------- */

const TRACK_LEN = 48;                 // tour complet
const COLORS = ["yellow", "red", "blue", "green"];
const DIRECTION = -1;                 // sens gauche (antihoraire)

// Réglage visuel: où tombent les sorties sur ton plateau
const START_INDEXES = [2, 14, 26, 38]; // J1 jaune, J2 rouge, J3 bleu, J4 vert
const HOME_ENTRY_OFFSET = 1;          // l’entrée de couloir est à +1 depuis la sortie (sens gauche)
const HOME_LEN = 6;                   // nombre de cases dans le couloir d’arrivée

function forward(from, steps) { return modTrack(from + DIRECTION * steps); }
function modTrack(x) { let v = x % TRACK_LEN; if (v < 0) v += TRACK_LEN; return v; }
const TEAM_OF = (p) => (p % 2 === 0 ? 0 : 1);
const PORTAL_IDS = [0,1,2,3];         // 4 sommets de bifurcation (un par joueur)

function confForPlayer(i) {
  const s = START_INDEXES[i];
  return {
    color: COLORS[i],
    startIndex: s,                          // case où l’on sort
    forkIndex: forward(s, 4),               // +4 : début montée possible
    rejoinIndex: forward(s, 12),            // +12 : retour anneau après descente
    homeEntry: forward(s, HOME_ENTRY_OFFSET),
    homeLen: HOME_LEN
  };
}

function initialPawns() {
  // 4 pions en base
  return Array.from({ length: 4 }, () => ({ location: { kind: "base" }, pieux: false, firstMove: true }));
}

function clone(x){ return JSON.parse(JSON.stringify(x)); }

/* --- Position helpers --- */
function posKey(pos){
  const k = pos.kind;
  if (k==="track")  return `T:${pos.idx}`;
  if (k==="up"||k==="down") return `${k[0].toUpperCase()}:${pos.base}:${pos.step}`;
  if (k==="portal") return `P:${pos.base}`;
  if (k==="home")   return `H:${pos.base}:${pos.step}`; // step 1..HOME_LEN
  if (k==="base")   return `B:${pos.base||"x"}`;
  if (k==="goal")   return `G:${pos.base}`;
  return k;
}

function occupantAt(state, key){
  for(let pi=0;pi<4;pi++){
    const pl = state.players[pi];
    for(let pj=0;pj<4;pj++){
      const p = pl.pawns[pj];
      if (p.location && posKey(p.location)===key) return { owner:pi, pawnIdx:pj };
    }
  }
  return null;
}

/* ---------------- Chemins (avec fourche + couloir) ---------------- */

function computePathForward(state, playerIndex, startPos, steps){
  const path = [];
  let cur = startPos;
  const conf = confForPlayer(playerIndex);

  for(let i=0;i<steps;i++){
    if (cur.kind==="track"){
      const nextIdx = forward(cur.idx, 1);
      // entrée de couloir (uniquement sa propre couleur)
      if (nextIdx === conf.homeEntry){
        cur = { kind: "home", base: playerIndex, step: 1 };
      } else {
        cur = { kind: "track", idx: nextIdx };
      }
    } else if (cur.kind==="home"){
      if (cur.step < conf.homeLen) {
        cur = { kind: "home", base: cur.base, step: cur.step + 1 };
      } else {
        return path; // déjà au bout du couloir
      }
    } else if (cur.kind==="up"){
      if (cur.step < 4) cur = { kind: "up", base: cur.base, step: cur.step + 1 };
      else cur = { kind: "portal", base: cur.base };
    } else if (cur.kind==="portal"){
      // avancer depuis le portail => on commence la descente
      cur = { kind: "down", base: cur.base, step: 1 };
    } else if (cur.kind==="down"){
      if (cur.step < 4) cur = { kind: "down", base: cur.base, step: cur.step + 1 };
      else cur = { kind: "track", idx: confForPlayer(cur.base).rejoinIndex };
    } else {
      // base / goal ne bougent pas via computePathForward
      return [];
    }
    path.push(cur);
  }
  return path;
}

// Entrer dans la montée si on est EXACTEMENT sur la fork
function computePathUpFromFork(playerIndex, steps){
  const base = playerIndex;
  const path = [];
  let cur = { kind: "up", base, step: 1 };
  for(let i=1;i<=steps;i++){
    if (cur.kind==="up" && cur.step < 4) {
      path.push({ ...cur });
      cur = { kind: "up", base, step: cur.step + 1 };
    } else if (cur.kind==="up" && cur.step===4){
      path.push({ kind:"portal", base });
      cur = { kind:"portal", base };
    } else if (cur.kind==="portal"){
      cur = { kind:"down", base, step:1 };
      path.push({ ...cur });
    } else if (cur.kind==="down"){
      if (cur.step < 4){ cur = { kind:"down", base, step: cur.step + 1 }; path.push({ ...cur }); }
      else { const rj = confForPlayer(base).rejoinIndex; cur = { kind:"track", idx: rj }; path.push({ ...cur }); }
    }
  }
  return path;
}

function isBlockedByOccupants(state, moverRef, path){
  if (!path.length) return false;
  const lastKey = posKey(path[path.length-1]);
  for(let i=0;i<path.length;i++){
    const k = posKey(path[i]);
    const occ = occupantAt(state, k);
    const isLast = (k===lastKey);
    if (occ){
      if (!isLast) return true;                        // pas de saut
      if (TEAM_OF(occ.owner)===TEAM_OF(moverRef.owner)) return true; // allié bloque
      const pawn = state.players[occ.owner].pawns[occ.pawnIdx];
      if (pawn.pieux) return true;                     // pieux intouchable
    }
  }
  return false;
}

/* ---------------- Génération de coups ---------------- */

function legalMoves(state, playerIndex){
  const moves = [];
  const player = state.players[playerIndex];

  for (const card of player.hand){
    const ranksToTry = card.joker
      ? ["A","2","3","4","5","6","7","8","9","10","J","Q","K"]
      : [card.rank];

    for (const rank of ranksToTry){

      // Valet = échange
      if (rank==="J"){
        const all = [];
        state.players.forEach((pl,pi) => pl.pawns.forEach((pw,pj)=>{
          const k = pw.location.kind;
          if (k!=="base" && k!=="goal") all.push({ owner:pi, idx:pj, key: posKey(pw.location) });
        }));
        for(let a=0;a<all.length;a++) for(let b=a+1;b<all.length;b++) if (all[a].key!==all[b].key)
          moves.push({ type:"swap", cardId:card.id, usingRank:rank, A:all[a], B:all[b] });
        continue;
      }

      // 5: faire avancer partenaire/adversaire (pas soi)
      if (rank==="5"){
        state.players.forEach((pl,pi)=>{
          if (pi===playerIndex) return;
          pl.pawns.forEach((pw,pj)=>{
            if (pw.location.kind==="base" || pw.location.kind==="goal") return;
            const path = computePathForward(state, pi, pw.location, 5);
            if (!isBlockedByOccupants(state, {owner:pi,pawnIdx:pj}, path))
              moves.push({ type:"movePath", cardId:card.id, usingRank:rank, owner:pi, pawnIdx:pj, path });
          });
        });
        continue;
      }

      // 4: reculer (sur l’anneau uniquement)
      if (rank==="4"){
        player.pawns.forEach((pw,pj)=>{
          if (pw.location.kind!=="track") return;
          let cur = pw.location;
          const path = [];
          for(let i=0;i<4;i++){
            cur = { kind:"track", idx: modTrack(cur.idx - DIRECTION*1) };
            path.push(cur);
          }
          if (!isBlockedByOccupants(state, {owner:playerIndex,pawnIdx:pj}, path))
            moves.push({ type:"movePath", cardId:card.id, usingRank:rank, owner:playerIndex, pawnIdx:pj, path });
        });
        continue;
      }

      // A/K: sortir OU avancer (A=1 | K=13)
      if (rank==="A" || rank==="K"){
        const canStart = player.pawns.some(p=>p.location.kind==="base");
        if (canStart) moves.push({ type:"start", cardId:card.id, usingRank:rank });
      }

      // Avancées classiques + 7 décomposable simple
      if (["A","2","3","6","7","8","9","10","Q","K"].includes(rank)){
        const steps = rank==="A" ? 1 : rank==="K" ? 13 : rankToValue(rank);

        if (rank==="7"){
          const splits = [[7],[6,1],[5,2],[4,3]];
          for (const split of splits){
            const options = enumerateSevenSplits(state, playerIndex, split);
            moves.push(...options.map((pathOps)=>({ type:"sevenPaths", cardId:card.id, usingRank:rank, pathOps })));
          }
        } else {
          player.pawns.forEach((pw,pj)=>{
            if (pw.location.kind==="base" || pw.location.kind==="goal") return;

            // chemin normal
            let path = computePathForward(state, playerIndex, pw.location, steps);
            if (!isBlockedByOccupants(state, {owner:playerIndex,pawnIdx:pj}, path))
              moves.push({ type:"movePath", cardId:card.id, usingRank:rank, owner:playerIndex, pawnIdx:pj, path });

            // option MONTER si on est pile sur la fork
            const conf = confForPlayer(playerIndex);
            if (pw.location.kind==="track" && pw.location.idx===conf.forkIndex){
              const upPath = computePathUpFromFork(playerIndex, steps);
              if (upPath.length && !isBlockedByOccupants(state, {owner:playerIndex,pawnIdx:pj}, upPath))
                moves.push({ type:"movePath", cardId:card.id, usingRank:rank, owner:playerIndex, pawnIdx:pj, path: upPath, tag:"monte" });
            }
          });
        }
      }
    }
  }

  return moves;
}

function enumerateSevenSplits(state, playerIndex, split){
  const myRefs = [];
  state.players[playerIndex].pawns.forEach((pw,pj)=>{
    if (pw.location.kind!=="base" && pw.location.kind!=="goal") myRefs.push({ owner:playerIndex, pawnIdx:pj });
  });
  const results = [];
  function backtrack(i, acc){
    if (i===split.length){ results.push(acc); return; }
    for (const ref of myRefs){
      const startPos = state.players[ref.owner].pawns[ref.pawnIdx].location;
      const path = computePathForward(state, playerIndex, startPos, split[i]);
      if (!isBlockedByOccupants(state, ref, path)) backtrack(i+1, [...acc, { ref, path }]);

      const conf = confForPlayer(playerIndex);
      if (startPos.kind==="track" && startPos.idx===conf.forkIndex){
        const upPath = computePathUpFromFork(playerIndex, split[i]);
        if (!isBlockedByOccupants(state, ref, upPath)) backtrack(i+1, [...acc, { ref, path: upPath }]);
      }
    }
  }
  backtrack(0, []);
  return results;
}

/* ---------------- Appliquer les coups ---------------- */

function applyMove(state, playerIndex, move){
  const S = clone(state);
  const player = S.players[playerIndex];

  // on consomme la carte
  const ci = player.hand.findIndex(c=>c.id===move.cardId);
  if (ci>=0) player.hand.splice(ci,1);

  if (move.type==="swap"){
    const a = S.players[move.A.owner].pawns[move.A.idx];
    const b = S.players[move.B.owner].pawns[move.B.idx];
    const la = a.location; a.location = b.location; b.location = la;
    a.pieux = b.pieux = false; a.firstMove = b.firstMove = false;
    S.log.push(entry(playerIndex, "Valet: échange deux pions."));
    return S;
  }

  if (move.type==="start"){
    const entryKey = posKey({ kind:"track", idx: confForPlayer(playerIndex).startIndex });
    const occ = occupantAt(S, entryKey);
    if (occ){
      if (TEAM_OF(occ.owner)!==TEAM_OF(playerIndex) && !S.players[occ.owner].pawns[occ.pawnIdx].pieux){
        S.players[occ.owner].pawns[occ.pawnIdx] = { location:{kind:"base"}, pieux:false, firstMove:true };
      } else {
        S.log.push(entry(playerIndex, "Sortie impossible: case bloquée."));
        return S;
      }
    }
    const id = player.pawns.findIndex(p=>p.location.kind==="base");
    if (id>=0){
      player.pawns[id] = { location:{ kind:"track", idx: confForPlayer(playerIndex).startIndex }, pieux:true, firstMove:true };
      S.log.push(entry(playerIndex, "Sort un pion (pieux)."));
    }
    return S;
  }

  if (move.type==="movePath"){
    const { owner, pawnIdx, path } = move;
    if (!path.length) return S;
    const pawn = S.players[owner].pawns[pawnIdx];
    const last = path[path.length-1];

    // capture finale si adverse non pieux
    const occ = occupantAt(S, posKey(last));
    if (occ && TEAM_OF(occ.owner)!==TEAM_OF(owner)){
      const op = S.players[occ.owner].pawns[occ.pawnIdx];
      if (!op.pieux) S.players[occ.owner].pawns[occ.pawnIdx] = { location:{kind:"base"}, pieux:false, firstMove:true };
    }

    pawn.location = last;
    pawn.pieux = false;
    pawn.firstMove = false;

    // si on s’arrête sur un PORTAIL -> choix de téléportation au tour suivant
    if (last.kind==="portal"){
      const choices = PORTAL_IDS.filter(id => id !== last.base);
      S.pendingPortal = { owner, pawnIdx, fromPortal: last.base, choices };
    }

    // si on atteint la dernière case de HOME -> considérer “rentré”
    if (last.kind==="home" && last.step === confForPlayer(owner).homeLen){
      pawn.location = { kind:"goal", base: owner }; // stocké comme “rentré”
      S.log.push(entry(playerIndex, "Pion rentré dans l’écurie !"));
    } else {
      S.log.push(entry(playerIndex, `Avance (${move.usingRank})${move.tag==="monte"?" en montée":""}.`));
    }

    return S;
  }

  if (move.type==="sevenPaths"){
    for (const op of move.pathOps){
      const { ref, path } = op;
      if (!path.length) continue;
      const last = path[path.length-1];
      const occ = occupantAt(S, posKey(last));
      if (occ && TEAM_OF(occ.owner)!==TEAM_OF(ref.owner)){
        const opPawn = S.players[occ.owner].pawns[occ.pawnIdx];
        if (!opPawn.pieux) S.players[occ.owner].pawns[occ.pawnIdx] = { location:{kind:"base"}, pieux:false, firstMove:true };
      }
      const pawn = S.players[ref.owner].pawns[ref.pawnIdx];
      pawn.location = last; pawn.pieux = false; pawn.firstMove = false;
      if (last.kind==="portal"){
        const choices = PORTAL_IDS.filter(id=>id!==last.base);
        S.pendingPortal = { owner: ref.owner, pawnIdx: ref.pawnIdx, fromPortal: last.base, choices };
      }
      if (last.kind==="home" && last.step === confForPlayer(ref.owner).homeLen){
        pawn.location = { kind:"goal", base: ref.owner };
      }
    }
    S.log.push(entry(playerIndex, "7 décomposé."));
    return S;
  }

  return S;
}

function entry(playerIndex, text){ return { t: Date.now(), who: playerIndex, text }; }

/* ---------------- IA très simple ---------------- */

function chooseBotMove(state, playerIndex){
  const moves = legalMoves(state, playerIndex);
  if (!moves.length) return null;
  const score = (m)=> m.type==="start" ? 90
                   : m.type==="movePath" ? 70
                   : m.type==="sevenPaths" ? 75
                   : m.type==="swap" ? 40 : 10;
  return moves.reduce((b,m)=>score(m)>score(b)?m:b, moves[0]);
}

/* ---------------- UI ---------------- */

export default function App(){
  const [state, setState] = useState(()=>newGame());
  const moves = useMemo(()=>legalMoves(state, state.turn), [state]);

  useEffect(()=>{
    const pl = state.players[state.turn];
    if (pl.isBot && !state.exchangePhase && !state.gameOver){
      const t = setTimeout(()=>{
        if (pl.mustDiscard){ handleDiscardHand(); return; }
        const mv = chooseBotMove(state, state.turn);
        if (mv) applyAndNext(mv); else handleDiscardHand();
      }, 600);
      return ()=>clearTimeout(t);
    }
  }, [state]);

  function newGame(){
    const deck = buildDeck(true);
    const players = COLORS.map((color)=>({
      color, isBot:false, pawns: initialPawns(), hand: [],
      exchangedWithPartner:false, mustDiscard:false
    }));
    const S = { players, deck, discard:[], turn:0, dealer:0, exchangePhase:true,
      swappedCardBuffer:{}, pendingPortal:null, log:[], gameOver:false, roundDealCount:0 };
    startRound(S);
    return S;
  }

  function startRound(S){
    const give = S.roundDealCount===0 ? 5 : 4;
    for(let i=0;i<4;i++){
      const p = S.players[i];
      p.hand = p.hand.concat(S.deck.splice(0, give));
      p.exchangedWithPartner = false; p.mustDiscard = false;
    }
    if (S.deck.length===2) S.discard.push(...S.deck.splice(0));
    S.exchangePhase = true; S.roundDealCount += 1; S.turn = S.dealer;
  }

  function nextTurnAfterPlay(S){
    S.turn = (S.turn+1) % 4;
    const everyoneEmpty = S.players.every(p=>p.hand.length===0);
    if (everyoneEmpty){
      if (S.deck.length < 16) S.deck.push(...shuffle(S.discard.splice(0)));
      startRound(S);
    }
  }

  function checkVictory(S){ /* à brancher plus tard */ }

  function applyAndNext(move){
    setState(prev=>{ const S = applyMove(prev, prev.turn, move); checkVictory(S); if (!S.gameOver) nextTurnAfterPlay(S); return S; });
  }

  function handleDiscardHand(){
    setState(prev=>{ const S = clone(prev); const pl = S.players[S.turn]; S.discard.push(...pl.hand.splice(0)); S.log.push(entry(S.turn, "Jette sa main.")); nextTurnAfterPlay(S); return S; });
  }

  function toggleBot(i){ setState(prev=>{ const S = clone(prev); S.players[i].isBot = !S.players[i].isBot; return S; }); }

  function exchangeCard(i, cardId){
    setState(prev=>{
      const S = clone(prev); if (!S.exchangePhase) return S; const partner = (i+2)%4;
      const hand = S.players[i].hand; const idx = hand.findIndex(c=>c.id===cardId); if (idx<0) return S;
      const [card] = hand.splice(idx,1); (S.swappedCardBuffer[partner] ||= []).push(card); S.players[i].exchangedWithPartner = true;
      const a=i, b=partner;
      if (S.players[a].exchangedWithPartner && S.players[b].exchangedWithPartner){
        if (S.swappedCardBuffer[a]) { S.players[a].hand.push(...S.swappedCardBuffer[a]); delete S.swappedCardBuffer[a]; }
        if (S.swappedCardBuffer[b]) { S.players[b].hand.push(...S.swappedCardBuffer[b]); delete S.swappedCardBuffer[b]; }
        S.exchangePhase = false;
      }
      return S;
    });
  }

  function usePortal(destPortalId){
    setState(prev=>{
      const S = clone(prev); if (!S.pendingPortal) return S; const { owner, pawnIdx, choices } = S.pendingPortal; if (!choices.includes(destPortalId)) return S;
      const pawn = S.players[owner].pawns[pawnIdx];
      pawn.location = { kind:"portal", base: destPortalId };
      pawn.pieux = false; pawn.firstMove = false;
      S.log.push(entry(state.turn, `Téléportation vers sommet ${destPortalId}.`));
      S.pendingPortal = null;
      return S;
    });
  }

  return (
    <div className="min-h-screen w-full p-4 bg-neutral-100">
      <div className="max-w-6xl mx-auto grid grid-cols-12 gap-4">
        {/* Header */}
        <div className="col-span-12 flex items-center justify-between">
          <h1 className="text-2xl font-bold">Tok – Prototype</h1>
          <div className="flex gap-2 items-center">
            {state.pendingPortal && (
              <div className="flex gap-2 items-center">
                <span className="text-sm">Passage secret :</span>
                {state.pendingPortal.choices.map((c)=>(
                  <button key={c} className="px-3 py-1 rounded-2xl shadow bg-white" onClick={()=>usePortal(c)}>
                    Sommet {c}
                  </button>
                ))}
              </div>
            )}
            <button className="px-3 py-1 rounded-2xl shadow bg-white" onClick={()=>setState(()=>state /* noop to keep */)}> </button>
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
              {state.players.map((p,i)=>(
                <div key={i} className={`rounded-xl p-2 border ${i===state.turn?"border-black":"border-neutral-200"}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{labelPlayer(i)}</span>
                    <button className="text-xs px-2 py-1 rounded-full bg-neutral-100" onClick={()=>toggleBot(i)}>
                      {p.isBot ? "Bot" : "Humain"}
                    </button>
                  </div>
                  <div className="text-sm opacity-70">Couleur: {p.color}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow p-3 max-h-64 overflow-auto">
            <h3 className="font-semibold mb-2">Historique</h3>
            <ul className="text-sm space-y-1">
              {state.log.slice().reverse().map((l,i)=>(
                <li key={i}>
                  <span className="opacity-60 mr-1">{new Date(l.t).toLocaleTimeString()}</span>
                  {l.who>=0 && <strong className="mr-1">{labelPlayer(l.who)}:</strong>}
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

/* ----------- Rendu Plateau (avec bases + couloirs + fourches) ----------- */

function labelPlayer(i){ return ["J1 (Jaune)","J2 (Rouge)","J3 (Bleu)","J4 (Vert)"][i]; }
function colorToken(c){ switch(c){ case "yellow":return "#facc15"; case "red":return "#ef4444"; case "blue":return "#3b82f6"; case "green":return "#22c55e"; default:return "#9ca3af"; } }

function Board({ state }){
  // Dessin: anneau (48), sorties, fork(+4), portails(+8), couloirs (home), bases, et les BRANCHES (montée/descente)
  const R_RING = 42;           // rayon de l'anneau
  const R_PORTAL = 30;         // rayon approximatif des portails
  const R_HOME_BASE = 36;      // point de départ des couloirs (puis on va vers le centre)
  const STEP_SHIFT = 3;        // écart radial entre cases de couloir
  const R_FORK_INNER = 36;     // on place la montée entre 36→24 (4 pas)

  // utilitaires coord
  const toXY = (angle, r) => ({ x: 50 + r * Math.cos(angle), y: 50 + r * Math.sin(angle) });
  const angTrack = (i) => (2 * Math.PI * i) / TRACK_LEN;

  return (
    <div className="relative w-full aspect-square bg-gradient-to-br from-amber-100 to-amber-200 rounded-2xl">
      {/* Anneau principal (48 cases) */}
      {[...Array(TRACK_LEN)].map((_, i) => {
        const angle = angTrack(i);
        const { x: cx, y: cy } = toXY(angle, R_RING);
        const occ = occupantAt(state, posKey({ kind: "track", idx: i }));
        const isStart = START_INDEXES.includes(i);
        const isFork = START_INDEXES.some((s) => modTrack(s + DIRECTION * 4) === i);
        const isHomeEntry = START_INDEXES.some((s, idx) => confForPlayer(idx).homeEntry === i);
        return (
          <div
            key={i}
            className={`absolute -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full border flex items-center justify-center text-[10px]
              ${isFork ? "bg-amber-300 border-amber-700" : isHomeEntry ? "bg-emerald-200 border-emerald-700" : isStart ? "bg-amber-200 border-amber-600" : "bg-white border-neutral-400"}`}
            style={{ left: `${cx}%`, top: `${cy}%` }}
            title={`Case ${i}`}
          >
            {occ && <PawnDot color={state.players[occ.owner].color} />}
          </div>
        );
      })}

      {/* BRANCHES : montée (fork→portal) et descente (portal→rejoin) pour chaque joueur */}
      {COLORS.map((_, idx) => {
        const conf = confForPlayer(idx);
        // Montée: 4 cases à partir de la fork, le long de l'angle de la fork
        const forkAngle = angTrack(conf.forkIndex);
        const upNodes = [1, 2, 3, 4].map((step) => toXY(forkAngle, R_FORK_INNER - (step - 1) * STEP_SHIFT));
        // Portal (sommet) aligné visuellement avec +8 depuis start (déjà affiché ailleurs)
        const portalAngle = angTrack(modTrack(conf.startIndex + DIRECTION * 8));
        const portalXY = toXY(portalAngle, R_PORTAL);
        // Descente: 4 cases vers le rejoin (+12) le long de l'angle de rejoin
        const rejoinAngle = angTrack(conf.rejoinIndex);
        const downNodes = [4, 3, 2, 1].map((revStep) => toXY(rejoinAngle, R_PORTAL + (revStep) * STEP_SHIFT));

        // Occupan ts
        const occUp = (step) => occupantAt(state, posKey({ kind: "up", base: idx, step }));
        const occPortal = occupantAt(state, posKey({ kind: "portal", base: idx }));
        const occDown = (step) => occupantAt(state, posKey({ kind: "down", base: idx, step }));

        return (
          <React.Fragment key={`branch-${idx}`}>
            {/* Up 1..4 */}
            {upNodes.map((p, s) => (
              <div
                key={`up-${idx}-${s + 1}`}
                className="absolute -translate-x-1/2 -translate-y-1/2 w-5 h-5 rounded-full border bg-amber-100 border-amber-600 flex items-center justify-center text-[9px]"
                style={{ left: `${p.x}%`, top: `${p.y}%` }}
                title={`Montée ${idx} – ${s + 1}/4`}
              >
                {occUp(s + 1) && <PawnDot color={COLORS[idx]} />}
              </div>
            ))}

            {/* Portal (sommet) */}
            <div
              className="absolute -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full border bg-purple-200 border-purple-700 flex items-center justify-center text-[10px]"
              style={{ left: `${portalXY.x}%`, top: `${portalXY.y}%` }}
              title={`Sommet ${idx}`}
            >
              {occPortal && <PawnDot color={state.players[occPortal.owner].color} />}
            </div>

            {/* Down 1..4 */}
            {downNodes.map((p, s) => (
              <div
                key={`down-${idx}-${s + 1}`}
                className="absolute -translate-x-1/2 -translate-y-1/2 w-5 h-5 rounded-full border bg-amber-100 border-amber-600 flex items-center justify-center text-[9px]"
                style={{ left: `${p.x}%`, top: `${p.y}%` }}
                title={`Descente ${idx} – ${s + 1}/4`}
              >
                {occDown(s + 1) && <PawnDot color={COLORS[idx]} />}
              </div>
            ))}
          </React.Fragment>
        );
      })}

      {/* Couloirs d’arrivée */}
      {COLORS.map((_, idx) => {
        const conf = confForPlayer(idx);
        const entryAngle = angTrack(conf.homeEntry);
        return [...Array(conf.homeLen)].map((__, stepIdx) => {
          const step = stepIdx + 1;
          const r = R_HOME_BASE - step * STEP_SHIFT;
          const { x: cx, y: cy } = toXY(entryAngle, r);
          const occ = occupantAt(state, posKey({ kind: "home", base: idx, step }));
          const isLast = step === conf.homeLen;
          return (
            <div
              key={`${idx}-${step}`}
              className={`absolute -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full border flex items-center justify-center text-[10px] ${isLast ? "bg-emerald-300 border-emerald-700" : "bg-emerald-100 border-emerald-600"}`}
              style={{ left: `${cx}%`, top: `${cy}%` }}
              title={`Ecurie ${idx} - ${step}/${conf.homeLen}`}
            >
              {occ && <PawnDot color={COLORS[idx]} />}
            </div>
          );
        });
      })}

      {/* Bases / écuries (schéma simple 4 slots près de la sortie) */}
      {COLORS.map((c, idx) => {
        const s = START_INDEXES[idx];
        const angle = angTrack(s);
        const r = 32;
        const baseXY = toXY(angle, r);
        const slots = [
          [-8, -8],
          [8, -8],
          [-8, 8],
          [8, 8],
        ];
        return (
          <div
            key={`base-${idx}`}
            className="absolute"
            style={{ left: `${baseXY.x}%`, top: `${baseXY.y}%`, transform: "translate(-50%, -50%)" }}
          >
            <div className="w-16 h-16 rounded-xl border-2 border-neutral-600 flex items-center justify-center" style={{ background: "#fff8" }}>
              <div className="relative w-14 h-14">
                {slots.map((ofs, i2) => {
                  const occ = firstBasePawn(state, idx, i2);
                  return (
                    <div
                      key={i2}
                      className="absolute w-4 h-4 rounded-full border border-neutral-400"
                      style={{
                        left: `calc(50% + ${ofs[0]}px)`,
                        top: `calc(50% + ${ofs[1]}px)`,
                        transform: "translate(-50%,-50%)",
                        background: occ ? colorToken(c) : "#fff",
                      }}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function firstBasePawn(state, ownerIndex){
  const p = state.players[ownerIndex].pawns.find(x=>x.location.kind==="base");
  return p || null;
}

function PawnDot({ color }){ return <div className="w-3 h-3 rounded-full" style={{ background: colorToken(color) }}/>; }
(state, ownerIndex){
  const p = state.players[ownerIndex].pawns.find(x=>x.location.kind==="base");
  return p || null;
}

function PawnDot({ color }){ return <div className="w-3 h-3 rounded-full" style={{ background: colorToken(color) }}/>; }

/* ----------- Panneaux ----------- */

function TurnPanel({ state, moves, onPlay, onDiscard }){
  return (
    <div className="bg-white rounded-2xl shadow p-3">
      <h3 className="font-semibold mb-2">Actions</h3>
      {state.exchangePhase ? (
        <div className="text-sm opacity-70">Phase d'échange en cours.</div>
      ) : (
        <>
          <div className="text-sm mb-2">Coups légaux: {moves.length}</div>
          <div className="flex flex-wrap gap-2">
            {moves.slice(0, 20).map((m,i)=>(
              <button key={i} onClick={()=>onPlay(m)} className="px-2 py-1 rounded-xl bg-neutral-100 text-sm">
                {renderMoveLabel(m)}
              </button>
            ))}
          </div>
          {moves.length===0 && (
            <button onClick={onDiscard} className="mt-2 px-3 py-1 rounded-xl bg-neutral-100">Jeter la main</button>
          )}
        </>
      )}
    </div>
  );
}

function renderMoveLabel(m){
  if (m.type==="start") return `Sortir (${m.usingRank})`;
  if (m.type==="movePath") return `${m.usingRank}${m.tag==="monte"?" (monter)":""}`;
  if (m.type==="sevenPaths") return `7 décomposé`;
  if (m.type==="swap") return `Valet: échanger`;
  return "Coup";
}

function HandPanel({ state, moves, onPlay, onDiscard }){
  const me = state.players[state.turn];
  if (me.isBot) return <div className="opacity-60 text-sm">Bot en train de jouer...</div>;
  return (
    <div>
      <div className="mb-3 flex gap-2 flex-wrap">
        {me.hand.map((c)=>(
          <span key={c.id} className={`px-3 py-2 rounded-xl shadow text-sm bg-white border ${c.joker?"border-purple-500":"border-neutral-300"}`}>
            {c.joker ? "JOKER" : `${c.rank}${c.suit}`}
          </span>
        ))}
      </div>
      <div className="flex gap-2 flex-wrap">
        {moves.slice(0, 20).map((m,i)=>(
          <button key={i} onClick={()=>onPlay(m)} className="px-3 py-2 rounded-xl bg-neutral-100">
            {renderMoveLabel(m)}
          </button>
        ))}
        {moves.length===0 && (
          <button onClick={onDiscard} className="px-3 py-2 rounded-xl bg-neutral-100">Jeter la main</button>
        )}
      </div>
    </div>
  );
}

function ExchangePanel({ state, onChoose }){
  const i = state.turn; const me = state.players[i]; const partner = (i+2)%4;
  if (me.isBot) return <div className="text-sm opacity-60">Phase d'échange: le bot choisit une carte à donner...</div>;
  return (
    <div>
      <div className="mb-2">Choisis <strong>1 carte</strong> à donner à ton partenaire ({labelPlayer(partner)}).</div>
      <div className="flex gap-2 flex-wrap">
        {me.hand.map((c)=>(
          <button key={c.id} onClick={()=>onChoose(i, c.id)} className={`px-3 py-2 rounded-xl shadow text-sm bg-white border ${c.joker?"border-purple-500":"border-neutral-300"}`}>
            {c.joker ? "JOKER" : `${c.rank}${c.suit}`}
          </button>
        ))}
      </div>
      <p className="text-xs opacity-60 mt-2">Tu verras la carte reçue quand votre partenaire aura aussi donné.</p>
    </div>
  );
}
