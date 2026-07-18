# Threat model

## Protected information

- Entry names and source identifiers.
- The configured source origin, paths, field names, and profile values.
- Query values that could contain personal data.
- Raw responses returned by the source.
- Credentials, private-repository content, configured commands, and datastore
  details.

## Controls

- Source settings are encrypted environment secrets and are absent from Git.
- Workflow inputs select fixed profiles and cannot choose a host or arbitrary URL.
- Followed links are restricted to the configured HTTPS origin.
- Tables are represented by lengths, booleans, counts, and generic URL shapes.
- Names are used in memory only for aggregate distributions and duplicate counts.
- Form names, labels, values, route names, query keys, and script calls are redacted.
- Workflows use `contents: read`, short timeouts, and no persisted Git credentials.
- Pull-request CI runs synthetic tests and type checking without network inspection.
- The private pipeline has no public inputs and is restricted to its protected
  environment and default branch.
- Private target access uses a dedicated read-only deploy key.
- Dependency and command output is redirected to temporary runner files, removed
  on exit, and never uploaded as an artifact.

## Residual risks

- Public workflow metadata reveals which generic profile was inspected.
- Structural information such as text length can be visible in logs.
- GitHub and the configured public source observe the hosted runner's address.
- A future code change could weaken redaction, so privacy assertions remain in CI.
- Code merged into the protected default branch can access environment secrets;
  branch protection and mandatory CI are therefore part of the security boundary.
