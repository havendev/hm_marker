import type { SubtitleSegment } from "./types";

// Characters/patterns that indicate non-speech content
const MUSIC_MARKERS = /[\u266a\u266b\u266c\u266d\u266e\u266f♪♫♬♩]/g;
const NOISE_PATTERNS = /[\u266a\u266b\u266c\u266d\u266e\u266f♪♫♬♩\s]/g;
const MUSIC_WORDS = /音乐|音效|背景音|笑声|掌声|欢呼/g;

const ALL_NOISE = new RegExp(
  "[\\u266a\\u266b\\u266c\\u266d\\u266e\\u266f♪♫♬♩\\s]" +
  "|音乐|音效|背景音|笑声|掌声|欢呼",
  "g",
);

/**
 * Assess subtitle quality. Returns { quality, reason }.
 * quality: "good" | "low" | "junk"
 */
export function assessSubtitleQuality(
  subtitle: string,
  segments?: SubtitleSegment[],
): { quality: "good" | "low" | "junk"; reason?: string } {
  if (!subtitle || subtitle.trim().length === 0) return { quality: "junk", reason: "empty" };

  const totalLen = subtitle.length;

  // 1) Count music markers
  const musicMatches = subtitle.match(MUSIC_MARKERS);
  const musicCount = musicMatches ? musicMatches.length : 0;

  // 2) Remove all noise (music markers + whitespace), check what's left
  const speechChars = subtitle.replace(ALL_NOISE, "").length;
  const speechRatio = speechChars / totalLen;

  // 3) Count unique segments (detect repetition)
  const segs = segments || [];
  const uniqueSegs = new Set(segs.map((s) => s.text.trim()));
  const uniqueRatio = segs.length > 0 ? uniqueSegs.size / segs.length : 1;

  // Junk: mostly music markers or symbols
  if (musicCount > 10 && speechRatio < 0.3) {
    return { quality: "junk", reason: "mostly_music_markers" };
  }

  // Low: high music marker ratio but some speech
  if (musicCount > 5 && speechRatio < 0.5) {
    return { quality: "low", reason: "high_music_ratio" };
  }

  // Junk: too repetitive (>80% identical segments)
  if (segs.length > 10 && uniqueRatio < 0.2) {
    return { quality: "junk", reason: "highly_repetitive" };
  }

  // Low: very short effective content
  if (speechChars < 20) {
    return { quality: "junk", reason: "too_short" };
  }

  return { quality: "good" };
}

/**
 * Filter out junk segments (pure music markers, single symbols, etc.)
 */
export function filterJunkSegments(segments: SubtitleSegment[]): SubtitleSegment[] {
  return segments.filter((seg) => {
    const t = seg.text.trim();
    if (t.length === 0) return false;
    // Remove pure music marker lines
    const cleaned = t.replace(MUSIC_MARKERS, "").trim();
    const cleaned2 = cleaned.replace(MUSIC_WORDS, "").trim();
    if (cleaned2.length === 0) return false;
    // Remove lines that are just one or two repeated symbols
    if (cleaned2.length <= 2 && /[^a-zA-Z0-9\u4e00-\u9fff]/.test(cleaned2)) return false;
    return true;
  });
}

/**
 * Clean subtitle: filter segments, rebuild text.
 * Returns null if quality is too low.
 */
export function cleanSubtitle(
  subtitle: string,
  segments?: SubtitleSegment[],
): { subtitle: string; segments?: SubtitleSegment[] } | null {
  const assessment = assessSubtitleQuality(subtitle, segments);
  if (assessment.quality === "junk") return null;

  if (!segments || segments.length === 0) {
    // No segments, just check the flat text
    const cleaned = subtitle.replace(/音乐\s*♪?/g, "").trim();
    if (cleaned.length < 10) return null;
    return { subtitle: cleaned };
  }

  const filtered = filterJunkSegments(segments);
  if (filtered.length === 0) return null;

  const cleanedText = filtered.map((s) => s.text).join(" ");
  // Re-assess after cleaning
  const reassessed = assessSubtitleQuality(cleanedText, filtered);
  if (reassessed.quality === "junk") return null;

  return {
    subtitle: cleanedText,
    segments: filtered,
  };
}
