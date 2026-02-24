/**
 * Helper functions for the dashboard components.
 */

/**
 * Format elapsed time in seconds to human-readable string.
 */
function formatElapsed(seconds) {
  if (seconds == null || seconds < 0) return '';
  if (seconds < 60) return Math.round(seconds) + 's';
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return mins + 'm' + secs + 's';
}

/**
 * Calculate elapsed time for a run record.
 */
function calcElapsed(run) {
  if (!run.started_at) return '';
  const end = run.ended_at || (Date.now() / 1000);
  return formatElapsed(end - run.started_at);
}

/**
 * Format tool call arguments for display.
 */
function formatToolCallArgs(tc) {
  if (!tc) return '';
  const args = tc.arguments || tc.args;
  if (!args) return '';
  if (typeof args === 'string') {
    try {
      return JSON.stringify(JSON.parse(args), null, 2);
    } catch {
      return args;
    }
  }
  return JSON.stringify(args, null, 2);
}

/**
 * Truncate text to maxLen characters.
 * Returns empty string for null/undefined.
 */
function truncateText(text, maxLen = 200) {
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen) + '...';
}

/**
 * Convert zero-based child index to letter label for chat view.
 * Index 0 → "A", 1 → "B", ..., 25 → "Z", 26+ → number fallback.
 */
function assignChildLetter(index) {
  if (index < 26) return String.fromCharCode(65 + index);
  return String(index + 1);
}

/**
 * Persona color system for chat view.
 * Boss gets a warm gold; children rotate through 6 distinct colors.
 */
const BOSS_COLOR = '#C2705A';  // 柿色 (Persimmon)

const CHILD_COLORS = [
  '#5B9E8F',  // 青磁 (Celadon)
  '#C49555',  // 琥珀 (Amber)
  '#8A7ABF',  // 藤色 (Wisteria)
  '#5B9E78',  // 若竹 (Bamboo)
  '#C47B8A',  // 桃花 (Peach blossom)
  '#6B8EB5',  // 群青薄 (Pale ultramarine)
];

const BACKSTAGE_COLOR = '#8A7ABF';  // 藤色 (Wisteria) — 舞台裏ペルソナ

function getPersonaColor(colorIdx) {
  if (colorIdx === -2) return BACKSTAGE_COLOR;
  if (colorIdx < 0) return BOSS_COLOR;
  return CHILD_COLORS[colorIdx % CHILD_COLORS.length];
}
