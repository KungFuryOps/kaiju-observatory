# Kaiju Observatory

Kaiju Observatory is a small public development laboratory for detecting
structural changes in allowlisted ranking pages without publishing entry
identities or source-specific configuration.

It reports aggregate metadata such as table shapes, word-count distributions,
duplicate counts, link patterns, date counts, and form shapes. Text, identifiers,
route names, query keys, query values, and JavaScript calls are redacted.

## Boundaries

- Read-only requests to one HTTPS origin configured in a protected GitHub
  environment.
- A small set of fixed, generic inspection profiles.
- One source request per run and, optionally, one same-origin detail request.
- No database connection, production credentials, personal identifiers, or writes.
- No arbitrary URL input and no general-purpose proxy behavior.
- Pull requests run synthetic tests only. Live inspection requires collaborator
  access and the protected environment.
- Results are printed as redacted workflow logs; raw responses are not retained.

## GitHub Actions

Open **Actions > Inspect configured source > Run workflow**, select a profile,
and choose whether to follow at most one direct entry link. `landing` inspects
the initial page; the `series-*` profiles inspect privately configured views;
`correlation` compares their opaque source identities and emits counts only.

The workflow uses a standard GitHub-hosted runner with read-only repository
permissions, no persisted checkout credentials, and a five-minute timeout.

## Local development

Local development uses synthetic fixtures and does not require network access:

```bash
npm ci
npm test
npm run typecheck
```

Live source settings are intentionally absent from the repository. They belong
in the `source-inspection` GitHub environment as encrypted secrets.

## Responsible use

This project is for development and testing of the software in this repository.
It is not a hosted extraction service, data mirror, or mechanism for bypassing
access controls. Keep request volume minimal and respect source availability.
