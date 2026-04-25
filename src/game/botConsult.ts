import type { MatchState, PlayerId, Card } from "./types";
import { partnerOf, teamOf } from "./types";
import { bestEnvit, cardStrength, playerTotalEnvit } from "./deck";
import type { ChatPhraseId } from "./phrases";
import type { BotTuning } from "./profileAdaptation";
import { NEUTRAL_TUNING } from "./profileAdaptation";

export type PartnerAdvice = "strong" | "weak" | "neutral";

/**
 * Indica si el bot está a punto de tirar como primero de su pareja
 * en una baza (su compañero aún no ha jugado en esta baza).
 */
export function isBotOpeningForTeam(m: MatchState, bot: PlayerId): boolean {
  const r = m.round;
  if (r.phase !== "playing" && r.phase !== "envit") return false;
  if (r.turn !== bot) return false;
  if (r.envitState.kind === "pending") return false;
  if (r.trucState.kind === "pending") return false;
  const trick = r.tricks[r.tricks.length - 1];
  if (!trick) return false;
  const partner = partnerOf(bot);
  const partnerPlayed = trick.cards.some((tc) => tc.player === partner);
  if (partnerPlayed) return false;
  // Si yo soy el primero de la baza está claro que el partner no ha jugado.
  // Si yo voy en 3er lugar (mi partner aún no jugó) también soy el primero de mi pareja.
  return true;
}

/**
 * Comprova si el bot té alguna carta "bona de truc":
 * 3, manilla d'oros (7 oros), manilla d'espases (7 espases),
 * as de bastos o as d'espases.
 */
export function hasGoodTrucCard(m: MatchState, bot: PlayerId): boolean {
  const hand = m.round.hands[bot];
  return hand.some(
    (c) =>
      c.rank === 3 ||
      (c.rank === 7 && (c.suit === "oros" || c.suit === "espases")) ||
      (c.rank === 1 && (c.suit === "bastos" || c.suit === "espases")),
  );
}

/**
 * Comprova si el bot té els dos asos (espases + bastos): ja té el truc guanyat.
 */
export function hasBothAces(m: MatchState, bot: PlayerId): boolean {
  const hand = m.round.hands[bot];
  const hasAsEspases = hand.some((c) => c.rank === 1 && c.suit === "espases");
  const hasAsBastos = hand.some((c) => c.rank === 1 && c.suit === "bastos");
  return hasAsEspases && hasAsBastos;
}

/**
 * Decide si el bot debe consultar al compañero antes de tirar.
 * Reglas:
 *  - Primera baza i és el primer de la seua parella: consulta SEMPRE si té
 *    alguna carta bona de truc (excepte si ja té els dos asos).
 *  - Primera baza sense cartes bones: no consulta (dirà "A tu!" i tirarà).
 *  - Segunda baza: consulta si la mejor carta restante es media (duda).
 */
export function shouldConsultPartner(
  m: MatchState,
  bot: PlayerId,
  tuning: BotTuning = NEUTRAL_TUNING,
): boolean {
  const r = m.round;
  const hand = r.hands[bot];
  if (hand.length === 0) return false;

  // Si el company ja ha jugat la seua carta en aquesta baza, no té sentit
  // preguntar-li res: ja ha mostrat el que tenia per a esta baza.
  const currentTrick = r.tricks[r.tricks.length - 1];
  const partner = partnerOf(bot);
  if (currentTrick && currentTrick.cards.some((tc) => tc.player === partner)) {
    return false;
  }

  const strengths = hand.map((c) => cardStrength(c)).sort((a, b) => b - a);
  const top = strengths[0]!;
  const low = strengths[strengths.length - 1]!;
  const trickIdx = r.tricks.length - 1;

  // `consultRate` modulates probabilistic consultations:
  //  - conservative bots (rate>1) ask more often, including without strong cards
  //  - aggressive bots (rate<1) skip the chat and play directly
  // Mandatory consults (carta bona de truc as opener) are still always done
  // because they are tactically required, not chat-flavor.
  const cr = Math.max(0, tuning.consultRate ?? 1);
  const clamp = (p: number) => Math.max(0, Math.min(1, p * cr));

  if (trickIdx === 0) {
    // Equip rival (Bot Esq. ↔ Bot Dre.): repliquem la mateixa lògica
    // que entre el jugador humà i el seu company. El primer de la parella
    // en obrir la baza SEMPRE pregunta al seu company perquè la conversa
    // entre bots rivals siga sempre visible (excepte si ja té els dos asos).
    const HUMAN_PID: PlayerId = 0;
    const partner = partnerOf(bot);
    const isRivalBotPair = bot !== HUMAN_PID && partner !== HUMAN_PID;
    if (isRivalBotPair && isBotOpeningForTeam(m, bot)) {
      if (hasBothAces(m, bot)) return false;
      // Aggressive bots skip even rival-pair chat sometimes; conservative
      // always asks. Cap at 0.4 so aggressive still talks ~40 %.
      return Math.random() < Math.max(0.4, Math.min(1, cr));
    }

    // Si és el primer de la seua parella en obrir la baza, consulta
    // gairebé sempre per a fer xat: amb carta bona de truc, segur; sense
    // ella, amb una probabilitat alta perquè la conversa entre rivals
    // siga visible. Excepció: si ja té els dos asos, no cal consultar.
    if (isBotOpeningForTeam(m, bot)) {
      if (hasBothAces(m, bot)) return false;
      if (hasGoodTrucCard(m, bot)) {
        // Tactically required → always ask in conservative/balanced.
        // Aggressive may skip ~30 % of the time to play faster.
        return Math.random() < Math.max(0.7, Math.min(1, cr));
      }
      // Sense carta bona: encara consulta sovint per a fer xat visible.
      return Math.random() < clamp(0.7);
    }
    // Si no és el primer, manté el comportament anterior (mescla = dubte).
    const hasHigh = strengths.some((s) => s >= 70);
    const hasLow = strengths.some((s) => s <= 35);
    if (!(hasHigh && hasLow)) return false;
    return Math.random() < clamp(0.55);
  }

  if (trickIdx === 1) {
    // Quedan 2 cartas
    if (top - low < 25) return false; // similares, sin duda
    return Math.random() < clamp(0.65);
  }

  // 3a baza: queda 1 carta, no hay decisión
  return false;
}

/** Elige aleatoriamente una pregunta apropiada al contexto. */
export function pickQuestion(m: MatchState, bot: PlayerId): ChatPhraseId {
  const r = m.round;
  const trickIdx = r.tricks.length - 1;
  const pool: ChatPhraseId[] =
    trickIdx === 0
      ? ["puc-anar", "que-tens", "tens-mes-dun-tres", "portes-un-tres"]
      : ["que-tens", "puc-anar", "portes-un-tres"];
  return pool[Math.floor(Math.random() * pool.length)]!;
}

/** Context opcional per a refinar les respostes del mode sincer. */
export interface PartnerAnswerContext {
  /** Algun rival del `partner` ha dit "No tinc res" en la 1a baza. */
  rivalSaidNoTincRes?: boolean;
}

/** El compañero (sea bot o humano) responde según su mano restante. */
export function partnerAnswerFor(
  m: MatchState,
  partner: PlayerId,
  question: ChatPhraseId,
  bluffRate: number = 0,
  ctx: PartnerAnswerContext = {},
): ChatPhraseId {
  const r = m.round;
  const hand = r.hands[partner];
  const envit = playerTotalEnvit(r, partner);
  // Comptatge de cartes per força (només cartes que encara estan a la mà).
  // Terminologia: la "manilla" d'un coll és el 7 d'eixe coll. En Truc Valencià
  // només les manilles d'espases (90) i d'oros (85) tenen força afegida; les
  // de copes i bastos valen com un 7 normal. Les cartes que autoritzen un
  // "Vine a mi!" en mode sincer són les ≥ 90: As d'espases (100), As de
  // bastos (95) i manilla d'espases (7 espases, 90). La manilla d'oros (7
  // oros, 85) sola no autoritza "Vine a mi!" — només "Algo tinc".
  const vineAMiCards = hand.filter((c) => cardStrength(c) >= 90).length;
  const topCards = hand.filter((c) => cardStrength(c) >= 80).length; // afegeix la manilla d'oros
  const strongCards = hand.filter((c) => cardStrength(c) >= 65).length; // 3, asos forts
  const threes = hand.filter((c) => c.rank === 3).length;
  // "Carta bona de truc" = 3, 7 oros, 7 espases, As bastos, As espases (strength ≥ 70).
  // Si no se'n té cap, mai s'ha de respondre "Vine a vore" — cal dir "No tinc res" o "A tu!".
  const hasTrucCard = topCards >= 1 || threes >= 1;
  const hasGood = hasTrucCard;

  // Context tàctic per a "Vine al meu 3":
  //  - El meu equip ha guanyat la 1a baza (ja resolta i sense parda).
  //  - O algun rival ha dit "No tinc res" (eq. rival sense res a la 1a baza).
  const myTeam = teamOf(partner);
  const firstTrick = r.tricks[0];
  const wonFirstTrick =
    !!firstTrick &&
    firstTrick.winner !== undefined &&
    firstTrick.parda !== true &&
    teamOf(firstTrick.winner!) === myTeam;
  const rivalSaidNoTincRes = ctx.rivalSaidNoTincRes === true;
  const canSayVineAlMeuTres = threes >= 1 && (wonFirstTrick || rivalSaidNoTincRes);

  // Decideix si el bot mentirà en aquesta resposta (segons el perfil
  // d'honestedat). En mode "sincero" mai menteix.
  const lie = bluffRate > 0 && Math.random() < bluffRate;

  // "Tens envit?" → resposta segons l'envit total:
  //  - ≥31 → "Envida!" o "Sí" (tria aleatòria; mai diu el número exacte).
  //  - =30 → normalment "Sí", a vegades "Tinc {n}" revelant 30.
  //  - <30 → "No".
  if (question === "tens-envit") {
    let truth: ChatPhraseId;
    if (envit >= 31) {
      // Sincer (bluffRate === 0): sempre avisa amb "Envida!" perquè el
      // company envide; mai amaga la jugada.
      truth = bluffRate === 0 ? "envida" : (Math.random() < 0.5 ? "envida" : "si");
    } else if (envit === 30) {
      truth = Math.random() < 0.25 ? "si-tinc-n" : "si";
    } else {
      truth = "no";
    }
    if (lie) {
      if (truth === "no") return "si";
      return "no";
    }
    return truth;
  }

  // "Vols que envide?" → resposta segons l'envit total:
  //  - ≥31 → "Sí" o "Envida!" (tria aleatòria).
  //  - 29 o 30 → normalment "No", a vegades "Tinc {n}" revelant el valor.
  //  - <29 → "No".
  if (question === "vols-envide") {
    let truth: ChatPhraseId;
    if (envit >= 31) {
      // Sincer: sempre "Envida!" per indicar al company que envide.
      truth = bluffRate === 0 ? "envida" : (Math.random() < 0.5 ? "envida" : "si");
    } else if (envit === 29 || envit === 30) {
      truth = Math.random() < 0.25 ? "si-tinc-n" : "no";
    } else {
      truth = "no";
    }
    if (lie) {
      if (truth === "no") return "si";
      return "no";
    }
    return truth;
  }

  // "Quant envit tens?" → resposta única "Tinc {n}" amb el valor real.
  // El caller s'encarrega de passar la variable {n} amb l'envit del company.
  if (question === "quant-envit") {
    return "si-tinc-n";
  }

  // "Portes un tres?" → resposta estricta: només "Sí" si té un 3, "No" altrament.
  if (question === "portes-un-tres") {
    const truth: ChatPhraseId = threes >= 1 ? "si" : "no";
    if (lie) return truth === "si" ? "no" : "si";
    return truth;
  }
  if (question === "tens-mes-dun-tres") {
    // Regla estricta segons el jugador:
    //  - Té top card (7 oros/espases o As bastos/espases) →
    //      "Sí" o "Algo tinc" (equivalents, tria aleatòria).
    //  - No té top card però té un 3 → "Tinc un 3" o "No".
    //  - No té res del que es pregunta → "No".
    let answer: ChatPhraseId;
    if (topCards >= 1) {
      answer = Math.random() < 0.5 ? "si" : "tinc-bona";
    } else if (threes >= 1) {
      answer = Math.random() < 0.5 ? "tinc-un-tres" : "no";
    } else {
      answer = "no";
    }
    if (lie) {
      // Mentides coherents amb les úniques respostes possibles a la pregunta.
      // Només s'aplica fora del mode Sincero (bluffRate > 0).
      if (answer === "no") return Math.random() < 0.5 ? "si" : "tinc-bona";
      if (answer === "si" || answer === "tinc-bona") return "no";
      // tinc-un-tres → menteix dient "no"
      return "no";
    }
    return answer;
  }
  if (question === "que-tens") {
    // Mode sincer:
    //  - "Vine a mi!" → només amb cartes ≥ 90 (As d'espases, As de bastos
    //                   o manilla d'espases). La manilla d'oros sola NO.
    //  - "Algo tinc" / "Vine a vore!" → amb manilla d'oros (7 oros) o
    //                   un 3 (sense cap carta ≥ 90).
    //  - "Vine al meu tres" → només si té un 3 i el seu equip ha guanyat
    //                   la 1a baza, o algun rival ha dit "No tinc res"
    //                   en la 1a baza. Mai en la pròpia 1a baza sense
    //                   eixa info.
    //  - "No tinc res" altrament.
    let answer: ChatPhraseId;
    if (vineAMiCards >= 1) answer = "vine-a-mi";
    else if (topCards >= 1) {
      answer = Math.random() < 0.5 ? "tinc-bona" : "vine-a-vore";
    } else if (threes >= 1) {
      // Té un 3 sense top card.
      const pool: ChatPhraseId[] = ["tinc-un-tres", "vine-a-vore"];
      if (canSayVineAlMeuTres) pool.push("vine-al-meu-tres");
      answer = pool[Math.floor(Math.random() * pool.length)]!;
    } else {
      // Sense 3 ni cap top card: pot dir "No tinc res" o "A tu" indistintament.
      answer = Math.random() < 0.5 ? "no-tinc-res" : "a-tu";
    }
    if (lie) return (answer === "no-tinc-res" || answer === "a-tu") ? "tinc-bona" : "no-tinc-res";
    return answer;
  }
  // "puc-anar"
  // Mode sincer: només pot dir "Vine a mi!" si té una carta ≥ 90.
  // Amb només la manilla d'oros pot dir "Algo tinc" o "Vine a vore!".
  // Amb un 3 sense top:
  //   - Pool base: "Tinc un 3" + "Vine a vore!" sempre.
  //   - Afegir "Vine al meu tres" només si compleix el context (1a baza
  //     guanyada o rival ja ha dit "No tinc res").
  if (hasTrucCard) {
    let answer: ChatPhraseId;
    if (vineAMiCards >= 1) answer = "vine-a-mi";
    else if (topCards >= 1) {
      answer = Math.random() < 0.5 ? "tinc-bona" : "vine-a-vore";
    } else if (threes >= 1) {
      const pool: ChatPhraseId[] = ["tinc-un-tres", "vine-a-vore"];
      if (canSayVineAlMeuTres) pool.push("vine-al-meu-tres");
      answer = pool[Math.floor(Math.random() * pool.length)]!;
    } else {
      answer = "a-tu";
    }
    if (lie) return "a-tu";
    return answer;
  }
  // Sense cap carta bona de truc: mai "vine-a-vore". Avisa al company
  // amb "No tinc res" o "A tu" indistintament.
  if (lie) return "vine-a-mi";
  return Math.random() < 0.5 ? "no-tinc-res" : "a-tu";
}

/**
 * Converteix la resposta del company en consell tàctic per a triar carta.
 * Si es passa la `question` original, també interpreta correctament les
 * respostes curtes "Sí" i "No" (que altrament serien neutres).
 */
export function adviceFromAnswer(
  answer: ChatPhraseId,
  question?: ChatPhraseId,
): PartnerAdvice {
  // Respostes "Sí"/"No": el sentit depèn de la pregunta.
  if (answer === "si" || answer === "no") {
    const positive = answer === "si";
    switch (question) {
      // Preguntes on un "Sí" significa que el company té cartes fortes.
      case "puc-anar":
      case "que-tens":
      case "portes-un-tres":
      case "tens-mes-dun-tres":
        return positive ? "strong" : "weak";
      // "Tens envit?" no afecta directament la tria de carta de truc.
      case "tens-envit":
      default:
        return "neutral";
    }
  }

  switch (answer) {
    case "vine-a-mi":
    case "vine-al-meu-tres":
    case "tinc-bona":
    case "tinc-un-tres":
      return "strong";
    case "no-tinc-res":
      return "weak";
    case "a-tu":
      // Quan es respon a "puc-anar" o "que-tens", "A tu" equival a "No tinc res".
      if (question === "puc-anar" || question === "que-tens") return "weak";
      return "neutral";
    case "vine-a-vore":
    case "vine-al-teu-tres":
    default:
      return "neutral";
  }
}
