---
title: Secret Encryption and Package Configuration
type: component
created: 2026-10-16
updated: 2026-10-16
status: active
confidence: medium
tags: [encryption, configuration, mcp-core]
sources:
  - packages/core/src/config/package-config.ts
  - packages/core/src/crypto/master-key.ts
  - packages/core/src/crypto/secret-cipher.ts
  - packages/core/src/config/package-config.ts
  - packages/core/src/crypto/index.ts
  - packages/core/src/index.ts
---
# Secret Encryption and Package Configuration

TL;DR: Package config maps a package to environment-variable names, validates its 32-byte hexadecimal master key, and selects a database path. The crypto helper uses AES-256-GCM with a random 12-byte IV and an appended 16-byte authentication tag (`packages/core/src/config/package-config.ts:37-68`, `packages/core/src/crypto/secret-cipher.ts:5-29`).

## Purpose

The config resolver provides package-specific key and database settings. The crypto module encrypts string secrets to buffers and decrypts those buffers using the active master-key environment variable (`packages/core/src/config/package-config.ts:19-26`, `packages/core/src/crypto/secret-cipher.ts:10-29`).

## How it works

1. `resolvePackageConfig` strips the `@ohmy-seo/` scope and maps known package names to environment prefixes; unknown names become `MCP_` plus uppercased underscore-separated package name (`packages/core/src/config/package-config.ts:9-17`, `packages/core/src/config/package-config.ts:37-45`).
2. It calls `setMasterKeyEnv`, requires exactly 64 hexadecimal characters for `${PREFIX}_MASTER_KEY`, and returns the decoded key, selected database path, and prefix (`packages/core/src/config/package-config.ts:46-68`).
3. `getMasterKey` reads the active environment variable (or the Yandex legacy fallback), caches the decoded buffer, and clears that cache when the selected environment variable changes (`packages/core/src/crypto/master-key.ts:1-3`, `packages/core/src/crypto/master-key.ts:14-37`).
4. `encryptSecret` generates a random IV and returns `IV || ciphertext || authentication tag`; `decryptSecret` validates the minimum frame length and authenticates during decryption (`packages/core/src/crypto/secret-cipher.ts:5-29`).

### Configuration variants

| Variant | Prefix/path rule | Outcome |
|---|---|---|
| Known package | Explicit package-to-prefix map | Uses that package's `${PREFIX}_MASTER_KEY` and `${PREFIX}_DB_PATH` (`packages/core/src/config/package-config.ts:9-17`, `packages/core/src/config/package-config.ts:46-68`). |
| Scoped name | Removes `@ohmy-seo/` before lookup | Same mapped prefix as the unscoped workspace name (`packages/core/src/config/package-config.ts:37-42`). |
| Unknown package | Derives `MCP_<UPPER_UNDERSCORE>` | Uses derived key and path variable names (`packages/core/src/config/package-config.ts:43-48`). |
| Database path unset/empty | Resolves `data/state.db` from process working directory | Returns that default path (`packages/core/src/config/package-config.ts:61-68`). |

### Failure behavior

- Missing or malformed key causes config resolution and `getMasterKey` to throw with the required 64-hex format (`packages/core/src/config/package-config.ts:53-59`, `packages/core/src/crypto/master-key.ts:26-34`).
- Decrypt rejects a buffer shorter than 28 bytes; wrong key or modified bytes fail authenticated decryption (`packages/core/src/crypto/secret-cipher.ts:5-8`, `packages/core/src/crypto/secret-cipher.ts:19-29`).

## Business rules

- Keys are 32 bytes represented as 64 hexadecimal characters; encoding accepts uppercase and lowercase hex (`packages/core/src/config/package-config.ts:53-58`).
- The active key environment variable is mutable process state; switching it clears the cached key (`packages/core/src/crypto/master-key.ts:3-4`, `packages/core/src/crypto/master-key.ts:14-18`).
- Encryption is randomized: a new IV is generated for every call (`packages/core/src/crypto/secret-cipher.ts:10-16`).

## Public API

| Export | File:line | Purpose |
|---|---|---|
| `PackageConfig`, `resolvePackageConfig` | `packages/core/src/config/package-config.ts:19-26`, `packages/core/src/config/package-config.ts:37-69` | Resolve key, database path, and prefix. |
| `setMasterKeyEnv`, `getMasterKey` | `packages/core/src/crypto/master-key.ts:14-38` | Select and load the key. |
| `encryptSecret`, `decryptSecret` | `packages/core/src/crypto/secret-cipher.ts:10-29` | Authenticated string encryption. |

## Package shape

- Package environment mapping: `config/package-config.ts`.
- Active key selection: `crypto/master-key.ts`.
- Cipher framing: `crypto/secret-cipher.ts`.
- Database columns storing encrypted values are described in [credential data model](../data-model/credentials.md).

## Internal model

The key buffer is cached in memory after first use, with one process-global active environment name. `resolvePackageConfig` changes that name before reading the package-specific key (`packages/core/src/crypto/master-key.ts:3-4`, `packages/core/src/crypto/master-key.ts:14-37`, `packages/core/src/config/package-config.ts:49-55`).

## Dependencies

The feature uses Node crypto for random bytes and AES-GCM. Package config uses Node path resolution (`packages/core/src/crypto/secret-cipher.ts:1-3`, `packages/core/src/config/package-config.ts:1-2`).

<!-- lane-pilot:backlinks -->
## Referenced by

- [MCP Core Overview](../overview.md)
