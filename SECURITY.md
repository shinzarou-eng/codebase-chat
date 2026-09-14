# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 0.16.x | ✅ |
| < 0.16.0 | ❌ |

## Reporting a vulnerability

If you discover a security issue in `codebase-chat`, please open a private vulnerability report at:

https://github.com/shinzarou-eng/codebase-chat/security/advisories

Do **not** open a public issue for security bugs.

We will respond within 5 business days and release a patch as soon as possible.

## What we consider security issues

- Exposure of API keys or tokens in logs
- Unauthorized filesystem access outside the configured project path
- Injection through prompt or file handling
- Any way to escape the local-sandbox boundary

## Design notes

- `codebase-chat` only reads files from the project path you provide.
- It does not upload your code to a cloud service.
- Report files may include relative file paths; no absolute system paths are exposed by default.
