# Maintenance Mode

Outflow has one server-backed maintenance switch for configured web, PWA, macOS, iOS, and Android builds. It is an operational availability control, not an authorization boundary for local data.

## Administrator Setup

1. Apply every migration, including `20260721020000_app_maintenance_mode.sql`.
2. Create the operator's account through the normal passwordless authentication flow.
3. Using the trusted Supabase dashboard or Admin API, set that user's protected `app_metadata` to include `"outflow_role": "admin"`. Do not put an administrator email allowlist, service key, or role override in browser configuration.
4. Sign out and back in so the verified session receives the updated server claim.
5. Open `https://thedudeb.github.io/Outflow/?view=admin` and use the maintenance control.

Enabling maintenance requires two selections. Disabling it is immediate. Every actual state change writes a private audit event with the administrator account and timestamp. Repeating the current state does not create a duplicate event. The public status response contains only a schema version, maintenance boolean, and update timestamp.

## Client Behavior

Configured clients check service status at launch, every 15 seconds while visible, after reconnecting, when focused, and when returning to the foreground. The landing page, privacy page, and tracker are replaced by `app in maintenance mode thank you for understanding` while the switch is active. The admin console remains reachable so an operator can restore access.

Once a client observes maintenance mode, it caches that state and remains blocked if the status service later becomes unreachable. A client that is offline before it has ever observed the enabled state cannot receive a remote change; this is an unavoidable limit of offline-capable software. Store-managed and PWA updates do not replace the status check and continue using their normal delivery paths.

The switch blocks the shipped user interface. It does not erase local records, sign users out, interrupt app distribution, or serve as a substitute for revoking compromised credentials and disabling affected backend services during a security incident.
