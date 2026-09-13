/**
 * Deprecated — use start_google_oauth_flow which auto-completes via loopback.
 * OOB flow is no longer supported by Google (deprecated 2023-01-31).
 */

export async function runCompleteGoogleOauthFlow(_input: {
  app_label: string;
  account_label: string;
  code: string;
  state: string;
}) {
  return {
    isError: true as const,
    content: [{
      type: "text" as const,
      text: "Deprecated. Use start_google_oauth_flow which auto-completes via loopback. " +
        "OOB flow no longer supported since Google deprecated it on 2023-01-31.",
    }],
  };
}
