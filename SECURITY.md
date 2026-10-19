# Security Policy

## Reporting a vulnerability

Do not report security issues in public issues or pull requests. Open a
[private security advisory](https://github.com/nornzach/norn-memory/security/advisories/new)
instead, with:

- The affected component (library, server, dashboard) and commit
- Steps to reproduce
- The impact, and a proof of concept if you have one

Please confirm the issue yourself before reporting; unverified scanner output is not a report.

## Deployment notes

Norn-M is built for trusted networks. Exact records are stored in plaintext, and `AUTH_DISABLED=true` opens every endpoint. Keep auth on, give each agent its own scoped API key, and put the server behind HTTPS before exposing it beyond your own network.

## Supported versions

Security fixes go to `main`.
