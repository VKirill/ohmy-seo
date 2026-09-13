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

  const granted = (account.scopes_granted ?? "").split(" ").filter(Boolean);
  if (!granted.includes(requiredScope)) {
    throw new InsufficientScopeError(
      `Account "${account.label}" is missing required scope "${requiredScope}". ` +
        `Re-authorize via start_google_oauth_flow with scope included.`
    );
  }

  return account;
}
