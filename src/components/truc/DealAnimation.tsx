import { useEffect, useRef, useState } from "react";
import { PlayerId, nextPlayer } from "@/game/types";
import { PlayingCard } from "./PlayingCard";
import { getMuted } from "@/lib/speech";

// Context d'àudio compartit (reutilitzat per evitar latència i fuites).
let sharedAudioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext | null {
  try {
    if (typeof window === "undefined") return null;
    const AudioCtx =
      (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
        .AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!sharedAudioCtx || sharedAudioCtx.state === "closed") {
      sharedAudioCtx = new AudioCtx();
    }
    if (sharedAudioCtx.state === "suspended") {
      void sharedAudioCtx.resume();
    }
    return sharedAudioCtx;
  } catch {
    return null;
  }
}

/**
 * So realista d'una carta lliscant i caient sobre la taula.
 * Combina:
 *  - "Swoosh": soroll rosa filtrat amb un sweep de freqüència (lliscament).
 *  - "Tap": un click greu i curt amb una mica de fusta (impacte sobre la taula).
 * Petita variació aleatòria perquè cada repartiment soni diferent.
 */
function playDealSound() {
  if (getMuted()) return;
  const ctx = getAudioCtx();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;

    // Bus màster amb una mica de compressió suau.
    const master = ctx.createGain();
    master.gain.value = 0.10;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 12;
    comp.ratio.value = 3;
    comp.attack.value = 0.003;
    comp.release.value = 0.12;
    master.connect(comp);
    comp.connect(ctx.destination);

    // ---- SWOOSH (lliscament del paper) ----
    const swooshDur = 0.22 + Math.random() * 0.06;
    const noiseLen = Math.floor(ctx.sampleRate * swooshDur);
    const noiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const ndata = noiseBuf.getChannelData(0);
    // Soroll rosa aproximat (filtre IIR senzill) per a un timbre més càlid.
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < noiseLen; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.96300 * b1 + white * 0.2965164;
      b2 = 0.57000 * b2 + white * 1.0526913;
      const pink = (b0 + b1 + b2 + white * 0.1848) * 0.18;
      // Envolupant: atac ràpid, sosteniment curt, caiguda suau.
      const t = i / noiseLen;
      const env = Math.pow(t, 0.4) * Math.pow(1 - t, 1.2) * 3.2;
      ndata[i] = pink * env;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf;

    // Filtre passa-banda amb sweep: de greu cap a mig-agut (paper que llisca).
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(450, now);
    bp.frequency.exponentialRampToValueAtTime(2200, now + swooshDur * 0.85);

    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 220;

    const swooshGain = ctx.createGain();
    swooshGain.gain.value = 0.85;

    noise.connect(bp);
    bp.connect(hp);
    hp.connect(swooshGain);
    swooshGain.connect(master);

    // ---- TAP (impacte de la carta sobre la taula) ----
    const tapStart = now + swooshDur * 0.78;
    const tapDur = 0.07;
    const tapLen = Math.floor(ctx.sampleRate * tapDur);
    const tapBuf = ctx.createBuffer(1, tapLen, ctx.sampleRate);
    const tdata = tapBuf.getChannelData(0);
    for (let i = 0; i < tapLen; i++) {
      const t = i / tapLen;
      // Impuls curt: mescla de soroll i ona greu amb caiguda exponencial.
      const env = Math.exp(-t * 28);
      const tone = Math.sin(2 * Math.PI * 110 * (i / ctx.sampleRate));
      tdata[i] = (tone * 0.7 + (Math.random() * 2 - 1) * 0.5) * env;
    }
    const tap = ctx.createBufferSource();
    tap.buffer = tapBuf;
    const tapFilter = ctx.createBiquadFilter();
    tapFilter.type = "lowpass";
    tapFilter.frequency.value = 1800;
    const tapGain = ctx.createGain();
    tapGain.gain.value = 0.6;
    tap.connect(tapFilter);
    tapFilter.connect(tapGain);
    tapGain.connect(master);

    noise.start(now);
    noise.stop(now + swooshDur + 0.02);
    tap.start(tapStart);
    tap.stop(tapStart + tapDur + 0.02);
  } catch {
    // Ignora errors silenciosament.
  }
}

/** Posicions destí indexades per posició relativa des del jugador local. */
const TARGETS_BY_REL: Record<0 | 1 | 2 | 3, { x: string; y: string; rot: string }> = {
  0: { x: "50%", y: "92%", rot: "0deg" },
  1: { x: "97%", y: "42%", rot: "90deg" },
  2: { x: "50%", y: "8%", rot: "180deg" },
  3: { x: "3%", y: "42%", rot: "-90deg" },
};
const ORIGIN_BY_REL: Record<0 | 1 | 2 | 3, { x: string; y: string }> = {
  0: { x: "50%", y: "85%" },
  1: { x: "90%", y: "50%" },
  2: { x: "50%", y: "15%" },
  3: { x: "10%", y: "50%" },
};

interface DealAnimationProps {
  /** Clau que canvia cada vegada que es reparteix una nova mà. */
  dealKey: string;
  dealer: PlayerId;
  mano: PlayerId;
  onCardLanded: (player: PlayerId, indexInHand: number) => void;
  onComplete: () => void;
  /** Seient (0..3) que es mostra a baix. Per defecte 0. */
  perspectiveSeat?: PlayerId;
}

interface FlyingCard {
  id: string;
  player: PlayerId;
  indexInHand: number;
  startedAt: number;
  arrivedAt: number;
  arrived: boolean;
}

const STAGGER_MS = 140;
const FLY_DURATION_MS = 380;

export function DealAnimation({
  dealKey,
  dealer,
  mano,
  onCardLanded,
  onComplete,
  perspectiveSeat = 0,
}: DealAnimationProps) {
  const [cards, setCards] = useState<FlyingCard[]>([]);
  const completedRef = useRef(false);

  useEffect(() => {
    completedRef.current = false;
    // Genera l'ordre de repartiment: 12 cartes (4 jugadors x 3),
    // començant pel mano i en sentit horari.
    const list: FlyingCard[] = [];
    let p: PlayerId = mano;
    const handIdx: Record<PlayerId, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
    for (let i = 0; i < 12; i++) {
      list.push({
        id: `${dealKey}-${i}`,
        player: p,
        indexInHand: handIdx[p]++,
        startedAt: i * STAGGER_MS,
        arrivedAt: i * STAGGER_MS + FLY_DURATION_MS,
        arrived: false,
      });
      p = nextPlayer(p);
    }
    setCards(list);

    const timeouts: number[] = [];
    list.forEach((c) => {
      // So "whoosh" quan la carta surt volant
      timeouts.push(
        window.setTimeout(() => {
          playDealSound();
        }, c.startedAt),
      );
      timeouts.push(
        window.setTimeout(() => {
          onCardLanded(c.player, c.indexInHand);
          setCards((prev) =>
            prev.map((x) => (x.id === c.id ? { ...x, arrived: true } : x)),
          );
        }, c.arrivedAt),
      );
    });
    const totalMs = (list.length - 1) * STAGGER_MS + FLY_DURATION_MS + 80;
    timeouts.push(
      window.setTimeout(() => {
        if (completedRef.current) return;
        completedRef.current = true;
        onComplete();
      }, totalMs),
    );
    return () => {
      timeouts.forEach((t) => window.clearTimeout(t));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealKey]);

  const relOf = (p: PlayerId) => (((p - perspectiveSeat) + 4) % 4) as 0 | 1 | 2 | 3;
  const origin = ORIGIN_BY_REL[relOf(dealer)];

  return (
    <div className="absolute inset-0 z-40 pointer-events-none overflow-hidden">
      {cards.map((c) => {
        const target = TARGETS_BY_REL[relOf(c.player)];
        const style: React.CSSProperties = c.arrived
          ? {
              left: target.x,
              top: target.y,
              transform: `translate(-50%, -50%) rotate(${target.rot}) scale(0.92)`,
              opacity: 0,
              transition: `left ${FLY_DURATION_MS}ms cubic-bezier(0.22, 0.8, 0.3, 1), top ${FLY_DURATION_MS}ms cubic-bezier(0.22, 0.8, 0.3, 1), transform ${FLY_DURATION_MS}ms cubic-bezier(0.22, 0.8, 0.3, 1), opacity 120ms ease-out ${FLY_DURATION_MS - 120}ms`,
            }
          : {
              left: origin.x,
              top: origin.y,
              transform: "translate(-50%, -50%) rotate(-8deg) scale(1)",
              opacity: 1,
              transition: "none",
              animationDelay: `${c.startedAt}ms`,
            };
        return (
          <div
            key={c.id}
            className="absolute will-change-transform"
            style={style}
          >
            <div className="card-shadow">
              <PlayingCard faceDown size="sm" />
            </div>
          </div>
        );
      })}
    </div>
  );
}
