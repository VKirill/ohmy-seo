import fs from "node:fs";
import {
  parseServiceAccountJson,
  signJwtAssertion,
  exchangeJwtForAccessToken,
} from "@ohmy-seo/mcp-core/google-oauth";
import { insertAccount } from "../lib/db/accounts-repo.js";
import { errorToMcpContent } from "@ohmy-seo/mcp-core/errors";

const PKG_NAME = "gtm";

export async function runRegisterServiceAccount(input: {
  account_label: string;
  json_path: string;
  scopes: string;
}) {
  try {
    let content: string;
    try {
      content = fs.readFileSync(input.json_path, "utf-8");
    } catch (e) {
      throw new Error(`Cannot read file '${input.json_path}': ${e instanceof Error ? e.message : String(e)}`);
    }

    const sa = parseServiceAccountJson(content);
    const scopes = input.scopes.split(/\s+/).filter(Boolean);

    const assertion = signJwtAssertion({ sa, scopes });
    let accessToken: string;
    let expiresIn: number;
    try {
      const tokenResp = await exchangeJwtForAccessToken({ assertion, tokenUri: sa.token_uri });
      accessToken = tokenResp.access_token;
      expiresIn = tokenResp.expires_in;
    } catch (e) {
      throw new Error(
        `Service account verification failed — not saved. Check the key file and scopes. ` +
        `Error: ${e instanceof Error ? e.message : String(e)}`
      );
    }

    const now = Math.floor(Date.now() / 1000);
    const account = insertAccount(PKG_NAME, {
      label: input.account_label,
      auth_method: "service_account",
      google_email: sa.client_email,
      google_project_id: sa.project_id,
      service_account_json_plain: content,
      access_token_plain: accessToken,
      expires_at: now + expiresIn,
      scopes_granted: scopes.join(" "),
    });

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(
          {
            id: account.id,
            account_label: account.label,
            google_email: account.google_email,
            scopes_granted: account.scopes_granted,
          },
          null,
          2,
        ),
      }],
    };
  } catch (e) {
    return errorToMcpContent(e);
  }
}
