# TicketHub Design Document

TicketHub sells tickets for concerts and events. The hard part is the "big sale": a popular concert goes on sale and far more people than seats arrive at once.

## 1. Requirements

### Functional
- Browse and search events (by name, date, venue).
- View an event's seat map with the status of each seat.
- Hold chosen seats for 5 minutes while the user pays.
- Pay for the held seats (card payment through an external provider).
- Receive tickets (by email and in the app) and view "my tickets" later.
- Release held seats if the user cancels or the hold expires.

### Non-functional
- **Speed:** browsing pages under 300 ms for 95% of requests; seat hold under 500 ms, even during a big sale.
- **Correctness:** a seat is never sold to two people; a user is never charged without getting a ticket, or given a ticket without paying; orders are never lost.
- **Fairness:** first come, first served; a limit of 4 seats per user per event; bots and queue-jumping are limited; a failed or slow payment must not let someone keep a seat forever.
- **Availability:** the site stays up during a big sale and degrades gracefully (a waiting page, not an error page).
- **Security:** card details are handled by the payment provider and never stored by us.

## 2. Estimates

Assumptions: 1 day = 86,400 s; peak on a normal day = 5× the average; in the big sale each user views about 10 pages, as on a normal day.

### Normal day
- Page views: 50,000 visitors × 10 pages = 500,000/day = **5.8/s average**, **29/s peak**.
- Tickets: 5,000/day = **0.058/s** (one every 17 s), about 0.3/s at peak.
- This is light load for one small database.

### Big sale (200,000 people, 20,000 seats, first 10 minutes = 600 s)
- Arrivals: 200,000 / 600 = **333 users/s**.
- Page views: 200,000 × 10 / 600 = **3,333/s**.
- Seats sold: 20,000 / 600 = **33 sales/s** if every seat sells in the 10 minutes.
- Competition: 10 people want each seat, so **180,000 users (90%) will not get a ticket** and the design must treat that as the normal case.

### Comparison
- Page views, arrivals and ticket sales are all about **576× higher** than the normal-day average (3,333 / 5.8), and that is concentrated in 10 minutes.
- Sizing for the normal day would fail in the first minute of the sale. The design must be built for the peak, and the load must be shaped (see section 5).
- Data volume is small either way: 20,000 seats per concert and about 1.8 million tickets a year. The problem is bursts and contention, not storage.

## 3. API

All endpoints are JSON over HTTPS and need a logged-in user, except the browse endpoints.

| # | Method and path | Purpose | Success |
|---|---|---|---|
| 1 | `GET /events?query=&date=&page=` | Browse and search events | 200 |
| 2 | `GET /events/{id}` | Event details | 200 |
| 3 | `GET /events/{id}/seats` | Seat map with each seat's status | 200 |
| 4 | `POST /events/{id}/holds` | Hold seats for 5 minutes | 201 |
| 5 | `DELETE /holds/{id}` | Release a hold early | 204 |
| 6 | `POST /orders` | Start payment for a hold | 201 |
| 7 | `POST /payments/webhook` | Payment provider reports the result | 200 |
| 8 | `GET /me/tickets` | List the user's tickets | 200 |

Example for holding seats:

```
POST /events/42/holds
{ "seat_ids": [1201, 1202] }

201 Created
{ "hold_id": 987, "expires_at": "2026-11-01T19:05:00Z" }
```

- `POST /orders` takes `{ "hold_id": 987 }` and an `Idempotency-Key` header, so a retried request does not create two orders or two charges.
- Errors: `400` (bad input, or more than 4 seats), `401` (not logged in), `409` (a seat is no longer available), `410` (hold expired), `429` (too many requests).

## 4. Data model

### Tables
- **users**: `id` (PK), `name`, `email` (UNIQUE, NOT NULL), `created_at`.
- **events**: `id` (PK), `name`, `venue`, `starts_at`, `on_sale_at`, `total_seats`.
- **seats**: `id` (PK), `event_id` (FK to events), `section`, `row_label`, `seat_number`, `price_cents`, `status` (`AVAILABLE`, `HELD`, `SOLD`), `held_by` (FK to users, nullable), `hold_expires_at` (nullable). `UNIQUE (event_id, section, row_label, seat_number)`.
- **orders**: `id` (PK), `user_id` (FK), `event_id` (FK), `status` (`PENDING`, `PAID`, `CANCELLED`, `REFUNDED`), `total_cents`, `payment_ref` (UNIQUE), `idempotency_key` (UNIQUE), `created_at`.
- **tickets**: `id` (PK), `order_id` (FK to orders), `seat_id` (FK to seats, **UNIQUE**), `code` (UNIQUE, for the QR code).

### Relationships
- One user has many orders (one-to-many); one event has many seats and many orders (one-to-many).
- One order has many tickets (one-to-many); each ticket is for exactly one seat.
- Users and events are many-to-many through orders (a user can buy for many events, an event has many buyers).
- Seat-to-ticket is one-to-one at most: the UNIQUE on `tickets.seat_id` means a seat has zero or one ticket.

### How the design prevents two people buying the same seat

Two layers protect each seat. The first picks the winner. The second guarantees the rule even if the first has a bug.

1. **Atomic hold (the seat row is the lock).** A hold is one conditional `UPDATE` inside a transaction:

   ```sql
   UPDATE seats
   SET status = 'HELD', held_by = :user, hold_expires_at = now() + interval '5 minutes'
   WHERE id = :seat
     AND (status = 'AVAILABLE'
          OR (status = 'HELD' AND hold_expires_at < now()));
   ```

   If it changes 1 row, the user got the seat. If it changes 0 rows, someone else got it first and the API returns `409`. The database locks the row during the update, so two simultaneous requests are processed one after the other, and the second sees the first one's `HELD`. We never read the status and then write it in separate steps, because two users could both read `AVAILABLE`. Holding several seats happens in one transaction in a fixed (sorted) seat order: all seats are held or none are, and users cannot deadlock each other.
2. **Check on payment.** When the payment succeeds, one transaction confirms that `held_by` is still this user and the hold has not expired, sets `status = 'SOLD'`, marks the order `PAID` and inserts the tickets. If the hold had expired and another user took the seat, the transaction fails and the payment is refunded automatically.
3. **Constraint as the final safety net.** `UNIQUE (seat_id)` on `tickets` makes it physically impossible for the database to store two tickets for one seat, whatever the application code does. A second insert fails with a constraint error and the transaction rolls back.
4. **Expiry.** A worker releases expired holds, and the hold query itself also treats expired holds as available, so abandoned seats return to the pool even if the worker is late.
5. **Payment safety.** The idempotency key and the UNIQUE `payment_ref` stop a retry or a repeated webhook from creating a second order or charge.

## 5. Architecture

```
  Users
    |  static files, event pages
    +----------------------------> CDN
    |
    v
  Waiting Room (virtual queue, admits users at a fixed rate)
    |
    v
  Load Balancer
    |
    v
  API Servers (stateless, scaled up before the sale)
    |-- seat map, rate limits ----> Redis Cache <-- refreshed every 1-2 s
    |-- browse reads -------------> Read Replica <-- replication -- Primary DB
    |-- holds, orders (transactions) ----------------------------> Primary DB
    |-- payment --> Payment Provider --webhook--> API Servers
    +-- enqueue ---> Message Queue --> Workers (emails, tickets, hold expiry)
```

### Components
- **CDN:** serves images, scripts and event pages from servers near the user, so that traffic never reaches our servers.
- **Waiting room:** puts the 200,000 arrivals in a virtual queue and lets them in at a rate the system can handle, which protects the backend and makes the order fair.
- **Load balancer:** spreads requests over many API servers and skips unhealthy ones.
- **API servers:** stateless servers that run the logic (holds, orders, tickets), so more can be added before a sale.
- **Redis cache:** keeps the seat map, rate-limit counters and waiting-room state in memory so most reads never touch the database.
- **Primary database (SQL):** the single source of truth; it runs the hold and payment transactions and enforces the constraints.
- **Read replica:** serves browsing and search so reads do not slow down the transactions on the primary.
- **Payment provider:** takes card details and payment so we never store them, and reports the result by webhook.
- **Message queue and workers:** send emails, create tickets and release expired holds in the background, so a slow email never slows a purchase.

### How it survives the big sale
- **Shape the load:** the waiting room admits, for example, 2,000 users at a time instead of 200,000, so the 333 arrivals/s become a steady flow.
- **Keep reads off the database:** the seat map is served from the cache (a second or two old), so only holds and payments reach the primary. The primary then handles at most a few hundred conditional updates per second, which a single SQL database handles comfortably.
- **Fail fast when sold out:** once all 20,000 seats are sold, "sold out" is served from the cache, so the 180,000 people who missed out do not hit the database.
- **Prepare in advance:** the sale time is known, so API servers are scaled up and caches warmed beforehand.
- **Protect fairness:** rate limits per user and IP, a 4-seat limit, and a bot check at the waiting room.
- **Degrade gracefully:** if load is still too high, the waiting room slows admission instead of letting the site crash.

## 6. Trade-offs

1. **Database as the single source of truth vs. speed.** Deciding every hold in the SQL database is slower than doing it in Redis, but a cache can lose data or disagree with the database, and a double-sold seat is the one failure we cannot accept. We accept lower raw speed, and protect the database with the waiting room and the cache.
2. **Slightly stale seat map vs. load.** A seat map cached for 1-2 seconds can show a seat as free when it was just taken, so some users get a `409` after clicking. We accept this because it saves thousands of database reads per second; the hold query always has the final say.
3. **Waiting room: fairness and stability vs. user friction.** Users wait and some give up, but without it the site would likely crash and the fastest bots would win. We accept the friction.
4. **Hold length (5 minutes): fairness vs. convenience.** A longer hold gives slow payers time but locks seats away from others, and bots can hoard seats; a shorter hold frees seats quickly but may cut off real payments. We chose 5 minutes with a 4-seat limit.
5. **SQL vs. NoSQL.** The data is structured and relational, and we need transactions and constraints, so SQL fits. The cost is that one primary can become a write bottleneck, which is acceptable here because writes are limited to about 33 sales/s.
