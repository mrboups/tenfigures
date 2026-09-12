import { decrypt } from "./crypto.ts";
import type { ExchangeRow } from "./db.ts";
import type { Creds } from "./exchanges.ts";

export function credsOf(row: ExchangeRow, keySecret: string): Creds {
  return {
    apiKey: decrypt(row.api_key_enc, keySecret),
    secret: decrypt(row.api_secret_enc, keySecret),
    passphrase: row.passphrase_enc
      ? decrypt(row.passphrase_enc, keySecret)
      : null,
  };
}
