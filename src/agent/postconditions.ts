export type ResponsePostconditions = {
  draftCreated: boolean;
  factualDataRead: boolean;
  factualIntent: boolean;
  sentMessageId: string | null;
};

export type EnforcedResponse = {
  text: string;
  violations: string[];
};

const CLAIMS_CHECK_PATTERN =
  /\b(?:i (?:checked|looked|found)|you (?:have|received|got)|no (?:new )?(?:emails?|mail)|in your inbox)\b/i;
const CLAIMS_DRAFT_PATTERN =
  /\b(?:i(?:'ve| have)? (?:drafted|prepared|created)|draft (?:is|was) ready)\b/i;
const CLAIMS_SEND_PATTERN =
  /\b(?:i(?:'ve| have)? sent|email (?:was|is|has been) sent|on its way)\b/i;
const DENIES_SEND_CAPABILITY_PATTERN =
  /\b(?:i (?:can(?:not|'t)|am unable to)|my tools (?:can(?:not|'t)|do not))\b[\s\S]{0,80}\b(?:send|sending)\b[\s\S]{0,30}\b(?:emails?|mails?|reply|it)\b/i;
const DENIES_NOTIFICATION_CAPABILITY_PATTERN =
  /\b(?:i (?:can(?:not|'t)|am unable to))\b[\s\S]{0,80}\b(?:watch|monitor|notify|real time)\b/i;

export function enforceResponsePostconditions(
  text: string,
  conditions: ResponsePostconditions
): EnforcedResponse {
  const violations: string[] = [];
  const claimsCheck = CLAIMS_CHECK_PATTERN.test(text);
  const claimsDraft = CLAIMS_DRAFT_PATTERN.test(text);
  const claimsSend = CLAIMS_SEND_PATTERN.test(text);
  const deniesSendCapability = DENIES_SEND_CAPABILITY_PATTERN.test(text);
  const deniesNotificationCapability =
    DENIES_NOTIFICATION_CAPABILITY_PATTERN.test(text);

  if (conditions.factualIntent && claimsCheck && !conditions.factualDataRead) {
    violations.push("unchecked_email_claim");
  }
  if (claimsDraft && !conditions.draftCreated) {
    violations.push("missing_draft_postcondition");
  }
  if (claimsSend && !conditions.sentMessageId) {
    violations.push("missing_send_postcondition");
  }
  if (deniesSendCapability) {
    violations.push("false_send_capability_denial");
  }
  if (deniesNotificationCapability) {
    violations.push("false_notification_capability_denial");
  }

  if (violations.includes("unchecked_email_claim")) {
    return {
      text: "I couldn’t verify that against your stored mail, so I won’t guess. Please ask me to check again.",
      violations,
    };
  }
  if (violations.includes("missing_send_postcondition")) {
    return {
      text: conditions.draftCreated
        ? "The draft is ready to review, but I did not receive a confirmed send result."
        : "I did not receive a confirmed send result, so I’m not claiming that email was sent.",
      violations,
    };
  }
  if (violations.includes("missing_draft_postcondition")) {
    return {
      text: "I wasn’t able to create a durable draft from that request. Tell me the recipient and what it should say.",
      violations,
    };
  }
  if (violations.includes("false_send_capability_denial")) {
    return {
      text: "I can compose and send email. Ask for a draft to preview first, or explicitly say “just send” with a recipient and usable message for a one-turn send.",
      violations,
    };
  }
  if (violations.includes("false_notification_capability_denial")) {
    return {
      text: "Incoming email automatically triggers a Telegram notification, so I’ll let you know here when something arrives.",
      violations,
    };
  }

  return { text, violations };
}
