# Webhook Callback URL Policy

To prevent Server-Side Request Forgery (SSRF), webhook callback URLs are
validated both **at registration time** (`POST /api/indexer/webhooks`) and
**at delivery time** (in `webhookService`). The delivery-time check re-resolves
the host to defend against DNS rebinding.

Validation is implemented in `src/utils/ssrfGuard.ts`.

## Allowed

- Scheme must be `http` or `https`.
- The host must resolve **only** to public, globally routable IP addresses.

## Blocked

A callback URL is rejected (HTTP `400` at registration; delivery is aborted and
logged) when its scheme is not http/https, when its host cannot be resolved, or
when **any** resolved address falls in a reserved range:

### IPv4

| Range            | Description                                        |
| ---------------- | -------------------------------------------------- |
| `0.0.0.0/8`      | "This" network                                     |
| `10.0.0.0/8`     | RFC1918 private                                    |
| `100.64.0.0/10`  | Carrier-grade NAT                                  |
| `127.0.0.0/8`    | Loopback (e.g. `127.0.0.1`)                        |
| `169.254.0.0/16` | Link-local, incl. cloud metadata `169.254.169.254` |
| `172.16.0.0/12`  | RFC1918 private                                    |
| `192.0.0.0/24`   | IETF protocol assignments                          |
| `192.0.2.0/24`   | TEST-NET-1                                         |
| `192.168.0.0/16` | RFC1918 private                                    |
| `198.18.0.0/15`  | Benchmarking                                       |
| `224.0.0.0/4`    | Multicast                                          |
| `240.0.0.0/4`    | Reserved, incl. `255.255.255.255`                  |

### IPv6

| Range           | Description                                      |
| --------------- | ------------------------------------------------ |
| `::/128`        | Unspecified                                      |
| `::1/128`       | Loopback                                         |
| `fc00::/7`      | Unique local addresses                           |
| `fe80::/10`     | Link-local                                       |
| `::ffff:0:0/96` | IPv4-mapped — evaluated against IPv4 rules above |

## Out of scope

- Allowlist UI for trusted destinations.
- Routing outbound webhook traffic through an egress proxy.
