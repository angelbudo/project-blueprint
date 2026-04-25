/**
 * Locucions per a accions de cant (truc, envit, etc.) usant la
 * Web Speech API del navegador. No requereix backend ni claus.
 *
 * Prioritzem una veu masculina i amb molt d'ímpetu, llegint els
 * missatges com a exclamacions.
 */

// Estat global de mute per a totes les locucions
let isMuted = false;

export function getMuted(): boolean {
  return isMuted;
}

export function setMuted(muted: boolean): void {
  isMuted = muted;
  // Cancel·la qualsevol locució activa quan es muta
  if (muted && typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

export function toggleMuted(): boolean {
  setMuted(!isMuted);
  return isMuted;
}

const SHOUT_TEXT: Record<string, string> = {
  truc: "Truc!",
  retruc: "Retruc!",
  quatre: "Quatre val!",
  "joc-fora": "Joc fora!",
  envit: "Envit!",
  renvit: "Renvit!",
  "falta-envit": "Falta envit!",
  vull: "Vull!",
  "no-vull": "No vull!",
};

// Pistes per detectar veus masculines (els navegadors no exposen el gènere
// directament, però el nom de la veu sol indicar-ho).
const MALE_HINTS = [
  "male",
  "hombre",
  "masculin",
  "diego",
  "jorge",
  "carlos",
  "pablo",
  "enrique",
  "miguel",
  "juan",
  "pau",
  "jordi",
  "arnau",
  "marc",
  "roger",
  "david",
  "daniel",
  "thomas",
  "google español",
  "google català",
];
const FEMALE_HINTS = [
  "female",
  "mujer",
  "femen",
  "monica",
  "mónica",
  "paulina",
  "marisol",
  "esperanza",
  "laura",
  "helena",
  "nuria",
  "núria",
  "montserrat",
  "sara",
];

let cachedVoice: SpeechSynthesisVoice | null = null;

function getPreferredLang(): "ca" | "es" {
  if (typeof window === "undefined") return "ca";
  try {
    const raw = window.localStorage.getItem("truc:settings:v1");
    if (!raw) return "ca";
    const parsed = JSON.parse(raw) as { language?: string };
    return parsed.language === "es" ? "es" : "ca";
  } catch {
    return "ca";
  }
}

function scoreVoice(v: SpeechSynthesisVoice, preferred: "ca" | "es"): number {
  const name = v.name.toLowerCase();
  let score = 0;
  // Prioritza l'idioma preferit; l'altre també puntua però menys.
  if (preferred === "ca") {
    if (/^ca/i.test(v.lang)) score += 100;
    else if (/^es/i.test(v.lang)) score += 60;
  } else {
    if (/^es/i.test(v.lang)) score += 100;
    else if (/^ca/i.test(v.lang)) score += 60;
  }
  // Gènere: bonifiquem masculí, penalitzem femení.
  if (MALE_HINTS.some((h) => name.includes(h))) score += 40;
  if (FEMALE_HINTS.some((h) => name.includes(h))) score -= 30;
  // Preferim veus de Google / natives de qualitat.
  if (name.includes("google")) score += 10;
  if (name.includes("natural") || name.includes("enhanced") || name.includes("premium")) score += 15;
  return score;
}

function pickVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  if (cachedVoice) return cachedVoice;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const preferred = getPreferredLang();
  const sorted = [...voices].sort((a, b) => scoreVoice(b, preferred) - scoreVoice(a, preferred));
  cachedVoice = sorted[0] ?? null;
  return cachedVoice;
}

/** Invalida la veu cachejada perquè es torni a triar segons l'idioma. */
export function resetVoiceCache() {
  cachedVoice = null;
}

if (typeof window !== "undefined" && "speechSynthesis" in window) {
  window.speechSynthesis.onvoiceschanged = () => {
    cachedVoice = null;
    pickVoice();
  };
  pickVoice();
}

/**
 * Converteix el text en una versió "cridada" perquè la síntesi el
 * llegeixi com una exclamació amb més ímpetu (majúscules, signes
 * d'exclamació duplicats i una mica de redundància).
 */
function toShoutText(text: string): string {
  const clean = text.replace(/!+$/g, "").trim();
  return `${clean.toUpperCase()}!!`;
}

/**
 * Locuta el text donat amb molt d'ímpetu, com una exclamació.
 * Una sola emissió, sense eco. Augmenta rate i pitch per donar força.
 * Si està silenciat, no fa res.
 */
export function speak(text: string) {
  try {
    if (isMuted) return;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    const shoutText = toShoutText(text);
    const utter = new SpeechSynthesisUtterance(shoutText);
    const voice = pickVoice();
    if (voice) {
      utter.voice = voice;
      utter.lang = voice.lang;
    } else {
      utter.lang = "ca-ES";
    }
    // Paràmetres per a una exclamació amb força:
    // - rate alt: més enèrgic
    // - pitch baix-mig: timbre més masculí i ferm
    // - volume al màxim
    utter.rate = 1.25;
    utter.pitch = 0.7;
    utter.volume = 1.0;
    synth.cancel();
    synth.speak(utter);
  } catch {
    // Ignora errors de plataformes sense suport.
  }
}

/**
 * Locuta el cant (shout) corresponent. Accepta un `labelOverride`
 * (per exemple "Truc i passe!") perquè es digui exactament el text
 * que apareix en pantalla.
 */
export function speakShout(what: string, labelOverride?: string) {
  const text = labelOverride ?? SHOUT_TEXT[what];
  if (!text) return;
  speak(text);
}
