# Docker Desktop lifecycle boundary

`environment container-engine` is the canonical local read model for the two
independent lifecycle facts SEC needs:

- current-session engine availability, owned by the retained Docker CLI
  readback boundary, the retained `Docker Desktop.exe` launcher boundary and
  the single bounded launcher lease;
- next-login startup intent, owned by Docker Desktop's **General > Start Docker
  Desktop when you sign in** setting.

The Windows `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run` entry is
not treated as the login-start semantic owner. Docker Desktop 4.87 can retain
that entry while its own `AutoStart` setting is false, so registration presence
alone cannot prove the user intent is enabled.

SEC can observe Docker Desktop's current `%APPDATA%\\Docker\\settings-store.json`
provider value through the retained Windows Known Folder boundary, but Docker
does not publish a stable machine schema for that file. The bounded projection
therefore reports `observed-provider-value / schema-unsupported`; it binds only
the parsed `AutoStart` value, observation-provider revision and physical file
receipt. Unrelated settings bytes do not enter command-provider identity or the
semantic value digest. SEC never edits that file or the Windows registry.

SEC bypasses the affected CLI `desktop start` lock path: it retains the GUI
launcher/cwd, journals the attempt before spawn, and uses `docker info` for the
handle-independent final readback. Lost-handle recovery never reopens the
original deadline.

Docker's administrator settings reference does not expose login-start as an
enforceable setting. Consequently, neither observed boolean value is promoted
to product `satisfied`. Docker Desktop Settings UI remains the only mutation
owner; current-session start remains a separate bounded Effect and never claims
to repair future-login behavior.

Primary interface references:

- <https://docs.docker.com/desktop/settings-and-maintenance/settings/>
- <https://docs.docker.com/desktop/features/desktop-cli/>
- <https://docs.docker.com/enterprise/security/hardened-desktop/settings-management/configure-json-file/>
