/** Shared privacy policy for error names and content-free machine reasons. */

export const UNEXPECTED_ERROR_REASON = "unexpected_error";

const MAX_MACHINE_REASON_LENGTH = 80;
const MACHINE_REASON_RE = /^[a-z][a-z0-9]*(?:[_:-][a-z0-9]+)*$/;
const ERROR_NAME_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,59}$/;

export function controlledMachineReason(reason: string | undefined): string {
  if (
    reason &&
    reason.length <= MAX_MACHINE_REASON_LENGTH &&
    MACHINE_REASON_RE.test(reason)
  ) {
    return reason;
  }
  return UNEXPECTED_ERROR_REASON;
}

export function controlledErrorName(name: string | undefined): string {
  return name && ERROR_NAME_RE.test(name) ? name : "Error";
}
