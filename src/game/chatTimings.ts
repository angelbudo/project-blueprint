/**
 * Centralised timings for all chat-bubble flows between bots and the
 * human player. Keeping these in one place avoids inconsistent delays
 * between questions, answers and follow-up questions (e.g. the
 * "quant-envit" flow used to drift because each step picked its own
 * constant).
 *
 * All values are in milliseconds. Any new chat flow MUST import from
 * here instead of redefining its own delays.
 */

// -----------------------------------------------------------------------------
// Base consult timings (used by every "ask partner before playing" flow)
// -----------------------------------------------------------------------------

/** Delay before the bot says its question (gives the table time to settle). */
export const CONSULT_QUESTION_DELAY_MS = 600;

/** Delay before the (human-targeted) answer bubble is shown. */
export const CONSULT_ANSWER_DELAY_MS = 1300;

/** Faster answer delay used when both ends are bots (keeps chat snappy). */
export const CONSULT_BOT_ANSWER_DELAY_MS = 500;

/** Delay before the bot acts on the answer it just received. */
export const CONSULT_DECIDE_DELAY_MS = 950;

// -----------------------------------------------------------------------------
// Bubble visual durations
// -----------------------------------------------------------------------------

/** Default lifetime of a chat bubble (must match `usePlayerChat`). */
export const DEFAULT_BUBBLE_DURATION_MS = 4500;

/** Bubble lifetime used for the rival-pair opening of the first trick. */
export const RIVAL_FIRST_TRICK_BUBBLE_MS = 4000;

/** Pre-question delay for the rival-pair opening of the first trick. */
export const RIVAL_FIRST_TRICK_PRE_QUESTION_DELAY_MS = 300;

// -----------------------------------------------------------------------------
// Wait windows for partner / human inputs
// -----------------------------------------------------------------------------

/** Maximum time a bot waits for the human partner's chat reply. */
export const CONSULT_HUMAN_TIMEOUT_MS = 10000;

/** Time a 2nd-to-play bot waits for instructions on the 1st trick. */
export const SECOND_PLAYER_WAIT_MS = 7000;

/** How long a partner-bot takes to suggest "envida" during the wait window. */
export const PARTNER_BOT_INSTRUCTION_DELAY_MS = 2500;

/** General-purpose bot action delay (think time before playing a card). */
export const BOT_DELAY_MS = 850;

/** How long the bot waits for the human to act on an envit window. */
export const BOT_WAIT_FOR_HUMAN_ENVIT_MS = 5000;

// -----------------------------------------------------------------------------
// "quant-envit" follow-up flow (Sincere mode, doubt zone)
// -----------------------------------------------------------------------------
//
// When a bot asks "Tens envit?" and the partner answers "si" while the
// asking bot sits in the doubtful zone (24-29), the bot follows up with
// "Quant envit tens?" to learn the exact value before deciding.
//
// To avoid the bubbles of question/answer/follow-up overlapping, every
// step of the chain uses delays that are >= CONSULT_ANSWER_DELAY_MS.

/** Delay between the partner's "si" and the bot's "Quant envit tens?". */
export const QUANT_ENVIT_FOLLOWUP_QUESTION_DELAY_MS = Math.max(
  CONSULT_QUESTION_DELAY_MS,
  CONSULT_ANSWER_DELAY_MS,
);

/** Delay between "Quant envit tens?" and the partner's "Tinc {n}". */
export const QUANT_ENVIT_FOLLOWUP_ANSWER_DELAY_MS = Math.max(
  CONSULT_BOT_ANSWER_DELAY_MS,
  CONSULT_ANSWER_DELAY_MS,
);

/** Delay between the partner's "Tinc {n}" and the finalize() decision. */
export const QUANT_ENVIT_FOLLOWUP_FINALIZE_DELAY_MS = Math.max(
  CONSULT_DECIDE_DELAY_MS,
  CONSULT_ANSWER_DELAY_MS,
);

/**
 * Bundled object form of the "quant-envit" follow-up timings, useful for
 * tests and future flows that want to depend on the whole chain at once.
 */
export const QUANT_ENVIT_FOLLOWUP_TIMINGS = {
  questionDelayMs: QUANT_ENVIT_FOLLOWUP_QUESTION_DELAY_MS,
  answerDelayMs: QUANT_ENVIT_FOLLOWUP_ANSWER_DELAY_MS,
  finalizeDelayMs: QUANT_ENVIT_FOLLOWUP_FINALIZE_DELAY_MS,
} as const;
