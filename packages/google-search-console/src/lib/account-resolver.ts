import { findAccountByLabel, getDefaultAccount } from "./db/accounts-repo.js";
import type { GoogleAccountRow } from "./db/accounts-repo.js";

export type AccountRow = GoogleAccountRow;

export class AccountNotFoundError extends Error {
  constructor(label: string) {
    super(`Google account "${label}" not found`);
    this.name = "AccountNotFoundError";
  }
}

export class AmbiguousAccountError extends Error {
  constructor() {
    super(
      "Multiple Google accounts found and none is set as default. " +
        "Set a default with set_default_google_account or pass account_label."
    );
    this.name = "AmbiguousAccountError";
  }
}

export class InsufficientScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsufficientScopeError";
  }
}

/**
 * The full `webmasters` scope includes read access, so an account granted only
 * the full scope (what the hosted app requests) satisfies `webmasters.readonly`.
 */
export function hasScope(scopesGranted: string | null | undefined, required: string): boolean {
  const granted = (scopesGranted ?? "").split(" ").filter(Boolean);
  if (granted.includes(required)) return true;
  return required.endsWith(".readonly") && granted.includes(required.slice(0, -".readonly".length));
}

export async function resolveAccount(
  packageName: string,
  requiredScope: string,
  optionalLabel?: string
): Promise<AccountRow> {
  let account: GoogleAccountRow | null;

  if (optionalLabel) {
    account = findAccountByLabel(packageName, optionalLabel);
    if (!account) {
      throw new AccountNotFoundError(optionalLabel);
    }
  } else {
    account = getDefaultAccount(packageName);
    if (!account) {
      throw new AmbiguousAccountError();
    }
  }

  if (!hasScope(account.scopes_granted, requiredScope)) {
    throw new InsufficientScopeError(
      `Account "${account.label}" is missing required scope "${requiredScope}". ` +
        `Re-authorize via start_google_oauth_flow with scope included.`
    );
  }

  return account;
}
