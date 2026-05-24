export interface ConfirmGateInput {
  confirm?: boolean;
  acknowledge_live?: string;
}

export interface ConfirmGateOptions {
  expectedAck: string;
  extraEnvFlag?: string;
}

export class ConfirmGateError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "ConfirmGateError";
  }
}

export function requireConfirmGate(
  input: ConfirmGateInput,
  options: ConfirmGateOptions
): void {
  // 1. Check global env flag
  if (process.env.OHMY_SEO_ALLOW_LIVE_MUTATIONS !== "true") {
    throw new ConfirmGateError(
      "MISSING_GLOBAL_FLAG",
      "Global mutation flag missing. Set OHMY_SEO_ALLOW_LIVE_MUTATIONS=true to enable any platform mutations across ohmy-seo."
    );
  }
  // 2. Check platform-specific env flag
  if (process.env.YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS !== "true") {
    throw new ConfirmGateError(
      "MISSING_PLATFORM_FLAG",
      "Yandex Direct mutation flag missing. Set YANDEX_DIRECT_ALLOW_LIVE_MUTATIONS=true to enable Yandex Direct write operations. (Platform-isolated: does not read flags for other platforms.)"
    );
  }
  // 3. Optional extra flag (e.g. YANDEX_DIRECT_ALLOW_DELETE)
  if (options.extraEnvFlag && process.env[options.extraEnvFlag] !== "true") {
    throw new ConfirmGateError(
      "MISSING_EXTRA_FLAG",
      `Extra mutation flag missing: ${options.extraEnvFlag}=true required for this operation.`
    );
  }
  // 4. Confirm boolean
  if (input.confirm !== true) {
    throw new ConfirmGateError(
      "MISSING_CONFIRM",
      "confirm: true is required for this operation."
    );
  }
  // 5. acknowledge_live exact match
  if (input.acknowledge_live !== options.expectedAck) {
    throw new ConfirmGateError(
      "ACK_MISMATCH",
      `acknowledge_live mismatch. Expected exactly: "${options.expectedAck}". Got: ${JSON.stringify(input.acknowledge_live)}.`
    );
  }
}
