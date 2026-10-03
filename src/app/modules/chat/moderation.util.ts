/**
 * Content moderation utility for anti-circumvention and trust/safety.
 * Detects off-platform contact sharing (phone, email, URLs, social handles/apps)
 * and redacts/masks the detected segments to protect buyers and sellers.
 */

export interface IModerationResult {
  isClean: boolean;
  rules: string[];
  maskedText: string;
  violations: Array<{
    rule: string;
    matchedText: string;
  }>;
}

// Regex patterns
const GUINEA_AND_INTL_PHONE_REGEX =
  /(?:\+?224[-.\s]*)?(?:6[1256]|7[0-9])[-.\s]*(?:\d[-.\s]*){6,7}\b|\b(?:\+?\d{1,3}[-.\s]*)?(?:\d[-.\s]*){8,13}\b/gi;

const EMAIL_REGEX =
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gi;

const URL_REGEX =
  /(?:https?:\/\/|www\.)[^\s]+|\b[a-zA-Z0-9-]+\.(?:com|org|net|gn|fr|io|app|biz|info|site|me|co)\b(?:\/[^\s]*)?/gi;

const SOCIAL_KEYWORD_REGEX =
  /\b(?:whatsapp|telegram|viber|signal|snapchat|instagram|facebook|tiktok|fb|insta)\b/gi;

const SOCIAL_HANDLE_REGEX =
  /@([A-Za-z0-9_.]{3,30})/gi;

const MASK_PLACEHOLDER = "[CONTACT MASQUÉ - Kadou24h]";

/**
 * Inspects text for circumvention and contact sharing attempts.
 * Returns whether text is clean, triggered rules, and masked text version.
 */
export const inspectContent = (text: string): IModerationResult => {
  if (!text || typeof text !== "string") {
    return {
      isClean: true,
      rules: [],
      maskedText: text || "",
      violations: [],
    };
  }

  const rules: Set<string> = new Set();
  const violations: Array<{ rule: string; matchedText: string }> = [];
  let masked = text;

  // 1. Check for Phone numbers
  const phoneMatches = text.match(GUINEA_AND_INTL_PHONE_REGEX);
  if (phoneMatches) {
    for (const match of phoneMatches) {
      // Filter out small isolated numbers that aren't phone numbers (e.g. single dates or short prices)
      const digitCount = match.replace(/\D/g, "").length;
      if (digitCount >= 8) {
        rules.add("phone");
        violations.push({ rule: "phone", matchedText: match.trim() });
        masked = masked.replace(match, MASK_PLACEHOLDER);
      }
    }
  }

  // 2. Check for Emails
  const emailMatches = text.match(EMAIL_REGEX);
  if (emailMatches) {
    rules.add("email");
    for (const match of emailMatches) {
      violations.push({ rule: "email", matchedText: match.trim() });
      masked = masked.replace(match, MASK_PLACEHOLDER);
    }
  }

  // 3. Check for URLs / Domains
  const urlMatches = text.match(URL_REGEX);
  if (urlMatches) {
    rules.add("url");
    for (const match of urlMatches) {
      violations.push({ rule: "url", matchedText: match.trim() });
      masked = masked.replace(match, MASK_PLACEHOLDER);
    }
  }

  // 4. Check for Social handles (@username)
  const handleMatches = text.match(SOCIAL_HANDLE_REGEX);
  if (handleMatches) {
    rules.add("social");
    for (const match of handleMatches) {
      violations.push({ rule: "social", matchedText: match.trim() });
      masked = masked.replace(match, MASK_PLACEHOLDER);
    }
  }

  // 5. Check for Social platform keywords (WhatsApp, Telegram, etc.)
  const keywordMatches = text.match(SOCIAL_KEYWORD_REGEX);
  if (keywordMatches) {
    rules.add("social");
    for (const match of keywordMatches) {
      violations.push({ rule: "social", matchedText: match.trim() });
      masked = masked.replace(match, MASK_PLACEHOLDER);
    }
  }

  const triggeredRules = Array.from(rules);
  const isClean = triggeredRules.length === 0;

  return {
    isClean,
    rules: triggeredRules,
    maskedText: masked,
    violations,
  };
};
