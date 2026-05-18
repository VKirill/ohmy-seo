import { listAccounts, getAccountByLabel } from "./db/accounts-repo.js";
import { hasScope, type Scope } from "./scopes.js";
import { AccountNotFoundError, NoMatchingAccountError } from "./errors.js";
import type { AccountRow } from "./db/accounts-repo.js";

export function resolveAccount(scope: Scope, explicitLabel?: string): AccountRow {
  // Case A: explicit label provided
  if (explicitLabel) {
    const acc = getAccountByLabel(explicitLabel);
    if (!acc) throw new AccountNotFoundError(explicitLabel);
    if (!hasScope(acc.scopes_granted, scope)) {
      throw new Error(
        `Account '${explicitLabel}' lacks required scope '${scope}'. Granted: '${acc.scopes_granted}'. ` +
          `Re-run start_oauth_flow with a different OAuth app that declares this scope.`
      );
    }
    return acc;
  }

  // Case B: implicit — find all accounts with the required scope
  const all = listAccounts(); // returns AccountPublic[] without tokens
  const candidates = all.filter((a) => hasScope(a.scopes_granted, scope));

  if (candidates.length === 0) {
    throw new NoMatchingAccountError(scope, []);
  }

  let chosen;
  if (candidates.length === 1) {
    chosen = candidates[0];
  } else {
    const defaults = candidates.filter((a) => a.is_default === 1);
    if (defaults.length === 1) {
      chosen = defaults[0];
    } else {
      throw new NoMatchingAccountError(
        scope,
        candidates.map((c) => c.label)
      );
    }
  }

  // Re-read full row with tokens
  const full = getAccountByLabel(chosen.label);
  if (!full) throw new Error(`Internal: account '${chosen.label}' disappeared mid-resolve`);
  return full;
}
