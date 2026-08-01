const RAW_TOOL_CALL_SECTION_PATTERN =
  /<\|tool_calls_section_begin\|>[\s\S]*?(?:<\|tool_calls_section_end\|>|$)/g;
const RAW_TOOL_CALL_TOKEN_PATTERN =
  /<\|(?:tool_calls_section|tool_call|tool_call_argument)_[a-z_]+\|>/g;

export function cleanModelText(value: string): string {
  return value
    .replace(RAW_TOOL_CALL_SECTION_PATTERN, "")
    .replace(RAW_TOOL_CALL_TOKEN_PATTERN, "")
    .trim();
}
