import { useNavigate, useSearchParams } from "react-router-dom";
import { useState } from "react";
import { ClientOnly } from "@/components/ClientOnly";
import { useTrucMatch, clearSavedMatch } from "@/hooks/useTrucMatch";
import { usePlayerChat } from "@/hooks/usePlayerChat";
import { TrucBoard } from "@/components/truc/TrucBoard";
import { TableChat } from "@/components/truc/TableChat";
import type { RoomTextMessage } from "@/online/useRoomTextChat";
import type { PlayerId } from "@/game/types";
import { cardStrength, playerTotalEnvit } from "@/game/deck";
import type { ChatPhraseId } from "@/game/phrases";
import { useGameSettings, bluffRateOf } from "@/lib/gameSettings";
import { usePlayerIdentity } from "@/hooks/usePlayerIdentity";
import { usePlayerProfile } from "@/lib/playerProfile";
import { applyDifficulty } from "@/game/profileAdaptation";

const HUMAN: PlayerId = 0;
const PARTNER_PID: PlayerId = 2;

function PartidaLoading() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-background gap-4">
      <div className="h-10 w-10 rounded-full border-4 border-primary/30 border-t-primary animate-spin" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">Carregant la partida…</p>
    </main>
  );
}

export default function Partida() {
  return (
    <ClientOnly fallback={<PartidaLoading />}>
      <PartidaClient />
    </ClientOnly>
  );
}

function PartidaClient() {
  const [search] = useSearchParams();
  const camesRaw = Number(search.get("cames"));
  const manoRaw = Number(search.get("mano"));
  const targetCamaRaw = Number(search.get("targetCama"));
  const targetCames = (camesRaw === 1 || camesRaw === 2 || camesRaw === 3 ? camesRaw : 2);
  const initialMano = ((manoRaw === 0 || manoRaw === 1 || manoRaw === 2 || manoRaw === 3 ? manoRaw : 0)) as PlayerId;
  const targetCama = (targetCamaRaw === 9 || targetCamaRaw === 12 ? targetCamaRaw : 12);
  const resume = search.get("resume") === "1";
  const { messages, say } = usePlayerChat();
  const { settings, update } = useGameSettings();
  const { deviceId } = usePlayerIdentity();
  const { tuning: rawTuning, track, flush } = usePlayerProfile(deviceId || null, settings.botDifficulty, settings.botHonesty);
  const tuning = applyDifficulty(rawTuning, settings.botDifficulty);
  const bluffRate = bluffRateOf(settings.botHonesty);
  const [paused, setPaused] = useState(false);
  // Xat de text local (només l'humà escriu; els bots no participen).
  const [textMessages, setTextMessages] = useState<RoomTextMessage[]>([]);
  const handleSendText = async (text: string) => {
    setTextMessages((prev) => [
      ...prev,
      {
        id: Date.now() + Math.random(),
        seat: HUMAN,
        text,
        createdAt: Date.now(),
      },
    ]);
  };
  const seatNamesBySeat: Record<PlayerId, string> = {
    0: "Tu",
    1: "Bot Esq.",
    2: "Company",
    3: "Bot Dre.",
  };
  const {
    match,
    dispatch,
    humanActions,
    shoutFlash,
    lastShoutByPlayer,
    shoutLabelByPlayer,
    acceptedShoutByPlayer,
    shoutFamilyByPlayer,
    envitShoutByPlayer,
    envitShoutLabelByPlayer,
    envitOutcomeByPlayer,
    newGame,
    setPartnerCardHintForCurrentTrick,
    setPartnerPlayStrengthForCurrentTrick,
    setPartnerSilentForCurrentTrick,
    setPartnerFoldNextTruc,
    notifyChatPhrase,
    rivalsHaveSaid,
  } = useTrucMatch({
    say,
    targetCames,
    targetCama,
    initialMano,
    resume,
    tuning,
    bluffRate,
    trackProfile: track,
    // En acabar cada ronda, força un flush dels esdeveniments humans pendents.
    // El hook recarrega el perfil i recalcula `tuning`, que entra en vigor
    // immediatament per a les decisions dels bots de la ronda següent.
    onRoundEnd: () => { void flush(); },
    paused,
  });

  const r = match.round;
  const navigate = useNavigate();

  const [dealNonce, setDealNonce] = useState(0);
  const computedDealKey = (() => {
    const fullHands = r.hands[0].length + r.hands[1].length + r.hands[2].length + r.hands[3].length;
    const noPlays = r.tricks.length === 1 && r.tricks[0].cards.length === 0;
    if (fullHands === 12 && noPlays) {
      return `${match.history.length}-${match.cames}-${r.mano}#${dealNonce}`;
    }
    return null;
  })();

  const handleNewGame = () => {
    setDealNonce((n) => n + 1);
    newGame();
  };

  const handleAbandon = () => {
    clearSavedMatch();
    navigate("/");
  };

  const handleSay = (phraseId: ChatPhraseId) => {
    say(HUMAN, phraseId);
    notifyChatPhrase(HUMAN, phraseId);

    if (phraseId === "envida") {
      const envit = humanActions.find((a) => a.type === "shout" && a.what === "envit");
      if (envit) dispatch(HUMAN, envit);
      return;
    }
    if (phraseId === "tira-falta") {
      const falta = humanActions.find((a) => a.type === "shout" && a.what === "falta-envit");
      if (falta) dispatch(HUMAN, falta);
      return;
    }
    if (phraseId === "vamonos") {
      const noVull = humanActions.find((a) => a.type === "shout" && a.what === "no-vull");
      if (noVull && r.trucState.kind === "pending") dispatch(HUMAN, noVull);
      setPartnerFoldNextTruc();
      return;
    }
    if (phraseId === "juega-callado") { setPartnerSilentForCurrentTrick(); return; }
    if (phraseId === "pon-fort") { setPartnerCardHintForCurrentTrick("fort"); return; }
    if (phraseId === "pon-molesto") { setPartnerCardHintForCurrentTrick("molesto"); return; }
    if (phraseId === "vine-al-teu-tres") { setPartnerCardHintForCurrentTrick("tres"); return; }

    if (phraseId === "vine-a-mi" || phraseId === "vine-al-meu-tres") {
      setPartnerPlayStrengthForCurrentTrick("low");
      return;
    }
    if (phraseId === "vine-a-vore") {
      // L'humà té 7 oros o un 3: no força res al partner (juga lliure).
      // El compromís personal del propi humà es resol al jugar la carta
      // (la UI no obliga, l'humà tria; els bots sí honren el compromís
      // mitjançant selfVineAVoreRef).
      setPartnerPlayStrengthForCurrentTrick("free");
      return;
    }
    if (phraseId === "tinc-bona" || phraseId === "tinc-un-tres") {
      setPartnerPlayStrengthForCurrentTrick("free");
      return;
    }
    if (phraseId === "a-tu" || phraseId === "no-tinc-res") {
      setPartnerPlayStrengthForCurrentTrick("high");
      return;
    }

    if (phraseId === "tens-envit") {
      const partnerEnvit = playerTotalEnvit(r, PARTNER_PID);
      window.setTimeout(() => {
        let ans: ChatPhraseId;
        if (partnerEnvit >= 31) ans = Math.random() < 0.5 ? "envida" : "si";
        else if (partnerEnvit === 30) ans = Math.random() < 0.25 ? "si-tinc-n" : "si";
        else ans = "no";
        if (ans === "si-tinc-n") say(PARTNER_PID, ans, undefined, { n: partnerEnvit });
        else say(PARTNER_PID, ans);
      }, 1100);
      return;
    }

    if (phraseId === "vols-envide") {
      const partnerEnvit = playerTotalEnvit(r, PARTNER_PID);
      window.setTimeout(() => {
        let ans: ChatPhraseId;
        if (partnerEnvit >= 31) ans = Math.random() < 0.5 ? "envida" : "si";
        else if (partnerEnvit === 29 || partnerEnvit === 30) ans = Math.random() < 0.25 ? "si-tinc-n" : "no";
        else ans = "no";
        if (ans === "si-tinc-n") say(PARTNER_PID, ans, undefined, { n: partnerEnvit });
        else say(PARTNER_PID, ans);
      }, 1100);
      return;
    }

    if (phraseId === "quant-envit") {
      // Resposta única i sincera: "Tinc {n}" amb el valor real del company.
      const partnerEnvit = playerTotalEnvit(r, PARTNER_PID);
      window.setTimeout(() => {
        say(PARTNER_PID, "si-tinc-n", undefined, { n: partnerEnvit });
      }, 1100);
      return;
    }

    if (
      phraseId === "puc-anar" ||
      phraseId === "que-tens" ||
      phraseId === "portes-un-tres" ||
      phraseId === "tens-mes-dun-tres"
    ) {
      const partnerHand = r.hands[PARTNER_PID];
      const partnerEnvit = playerTotalEnvit(r, PARTNER_PID);
      const strongCards = partnerHand.filter((c) => cardStrength(c) >= 70).length;
      const topCards = partnerHand.filter((c) => cardStrength(c) >= 85).length;
      // Cartes ≥ 90 (As espases, As bastos, 7 espases) — autoritzen "Vine a mi!".
      const vineAMiCards = partnerHand.filter((c) => cardStrength(c) >= 90).length;
      // Manilla d'oros (7 oros, str=85) sense les ≥ 90.
      const has7Oros = partnerHand.some((c) => c.rank === 7 && c.suit === "oros");
      const onlyManillaOros = vineAMiCards === 0 && has7Oros;
      const hasThreeOrBetter = partnerHand.some((c) => cardStrength(c) >= 70);
      const threeCount = partnerHand.filter((c) => c.rank === 3).length;
      // Context per a "Vine al meu 3":
      //  - El meu equip (el del partner) ha guanyat la 1a baza, o
      //  - Algun rival del partner ha dit "No tinc res" en aquesta ronda.
      const firstTrick = r.tricks[0];
      const partnerTeam = PARTNER_PID % 2 === 0 ? "nos" : "ells";
      const partnerWonFirstTrick =
        !!firstTrick &&
        firstTrick.winner !== undefined &&
        firstTrick.parda !== true &&
        (firstTrick.winner % 2 === 0 ? "nos" : "ells") === partnerTeam;
      const rivalSaidNoTincRes = rivalsHaveSaid(PARTNER_PID, "no-tinc-res");
      const canSayVineAlMeuTres = threeCount >= 1 && (partnerWonFirstTrick || rivalSaidNoTincRes);
      window.setTimeout(() => {
        let answer: ChatPhraseId;
        if (phraseId === "portes-un-tres") {
          answer = threeCount >= 1 ? "si" : "no";
        } else if (phraseId === "tens-mes-dun-tres") {
          if (topCards >= 1) {
            answer = Math.random() < 0.5 ? "si" : "tinc-bona";
          } else if (threeCount >= 1) {
            answer = Math.random() < 0.5 ? "tinc-un-tres" : "no";
          } else {
            answer = "no";
          }
        } else if (phraseId === "que-tens") {
          if (vineAMiCards >= 1) {
            answer = "vine-a-mi";
          } else if (onlyManillaOros) {
            answer = Math.random() < 0.5 ? "tinc-bona" : "vine-a-vore";
          } else if (threeCount >= 1) {
            // Pool: "Tinc un 3" + "Vine a vore!" sempre; afegir "Vine al meu
            // tres" només si compleix el context.
            const pool: ChatPhraseId[] = ["tinc-un-tres", "vine-a-vore"];
            if (canSayVineAlMeuTres) pool.push("vine-al-meu-tres");
            answer = pool[Math.floor(Math.random() * pool.length)]!;
          } else {
            // Sense cap carta bona: "No tinc res" o "A tu" indistintament.
            answer = Math.random() < 0.5 ? "no-tinc-res" : "a-tu";
          }
        } else {
          // "puc-anar"
          if (vineAMiCards >= 1) {
            answer = "vine-a-mi";
          } else if (onlyManillaOros) {
            answer = Math.random() < 0.5 ? "tinc-bona" : "vine-a-vore";
          } else if (threeCount >= 1) {
            // Pool: "Tinc un 3" + "Vine a vore!" sempre; afegir "Vine al meu
            // tres" només si compleix el context.
            const pool: ChatPhraseId[] = ["tinc-un-tres", "vine-a-vore"];
            if (canSayVineAlMeuTres) pool.push("vine-al-meu-tres");
            answer = pool[Math.floor(Math.random() * pool.length)]!;
          } else {
            // Sense cap carta bona: "No tinc res" o "A tu" indistintament.
            answer = Math.random() < 0.5 ? "no-tinc-res" : "a-tu";
          }
        }
        say(PARTNER_PID, answer);
      }, 1100);
    }
  };

  return (
    <TrucBoard
      match={match}
      humanActions={humanActions}
      dispatch={dispatch}
      shoutFlash={shoutFlash}
      lastShoutByPlayer={lastShoutByPlayer}
      shoutLabelByPlayer={shoutLabelByPlayer}
      acceptedShoutByPlayer={acceptedShoutByPlayer}
      shoutFamilyByPlayer={shoutFamilyByPlayer}
      envitShoutByPlayer={envitShoutByPlayer}
      envitShoutLabelByPlayer={envitShoutLabelByPlayer}
      envitOutcomeByPlayer={envitOutcomeByPlayer}
      messages={messages}
      onSay={handleSay}
      onNewGame={handleNewGame}
      onAbandon={handleAbandon}
      dealKey={computedDealKey}
      turnTimeoutSec={settings.turnTimeoutSec}
      paused={paused}
      onPauseToggle={(next) => setPaused(next)}
    />
  );
}
