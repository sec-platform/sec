# Docker Desktop lifecycle boundary

`environment container-engine` is the canonical local read model for the two
independent lifecycle facts SEC needs:

- current-session engine availability, owned by the retained Docker command
  provider and the single bounded launcher lease;
- next-login startup intent, owned by Docker Desktop's **General > Start Docker
  Desktop when you sign in** setting.

The Windows `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run` entry is
not treated as the login-start semantic owner. Docker Desktop 4.87 can retain
that entry while its own `AutoStart` setting is false, so registration presence
alone cannot prove the user intent is enabled.

SEC reads only Docker's documented `%APPDATA%\\Docker\\settings-store.json`
location through the retained Windows Known Folder boundary. The projection is
bounded, fail-closed, and exposes no setting values other than the `AutoStart`
boolean and a digest. SEC never edits that file or the Windows registry.

The admitted Docker Desktop CLI supports `start`, `stop`, `restart`, and
`status`, but exposes no settings mutation command. Docker's administrator
settings reference also does not expose login-start as an enforceable setting.
Consequently, `disabled` reconciles to
`docker-desktop-settings-ui-required`; current-session `--start` remains a
separate bounded Effect and never claims to repair future-login behavior.

Primary interface references:

- <https://docs.docker.com/desktop/settings-and-maintenance/settings/>
- <https://docs.docker.com/desktop/features/desktop-cli/>
- <https://docs.docker.com/enterprise/security/hardened-desktop/settings-management/configure-json-file/>
