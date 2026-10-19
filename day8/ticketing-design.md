# TicketHub Design

TicketHub sells concert and event tickets. The hard part is the big sale: far more people than seats arrive at once.

## 1. Requirements

**Functional:** browse and search events; view a seat map; hold seats for 5 minutes; pay; get tickets and list "my tickets"; release or expire holds.

**Non-functional:**
- **Speed:** browsing under 300 ms (p95); a hold under 500 ms, even in a big sale.
- **Correctness:** never sell a seat twice; never charge without a ticket (or give a ticket without payment); never lose an order.
- **Fairness:** first come, first served; max 4 seats per user; bot limits; holds expire.
- **Availability:** stay up in a big sale (a waiting page, not errors).
- **Security:** card data stays with the payment provider.

## 2. Estimates

Assume 1 day = 86,400 s, peak = 5× average, and sale users view 10 pages like normal users.

- **Normal day:** 50,000 × 10 = 500,000 views/day = **5.8/s** (29/s peak). 5,000 tickets/day = **0.058/s**.
- **Big sale (first 600 s):** 200,000 / 600 = **333 users/s**; 2,000,000 views / 600 = **3,333 views/s**; 20,000 seats / 600 = **33 sales/s**. That is 10 buyers per seat, so **180,000 users (90%) lose**.
- **Comparison:** the sale is about **576×** the normal rate, packed into 10 minutes. A system sized for a normal day fails in the first minute, so the load must be shaped. Data stays small (about 1.8M tickets/year).

## 3. API

- `GET /events?query=&date=` browse events (200)
- `GET /events/{id}` event details (200)
- `GET /events/{id}/seats` seat map with statuses (200)
- `POST /events/{id}/holds` body `{"seat_ids":[1201,1202]}`; returns `{hold_id, expires_at}` (201)
- `DELETE /holds/{id}` release a hold (204)
- `POST /orders` body `{hold_id}` plus an `Idempotency-Key` header; starts payment (201)
- `POST /payments/webhook` payment provider reports the result (200)
- `GET /me/tickets` the user's tickets (200)

Errors: 400 bad input or over 4 seats, 401 not logged in, 409 seat taken, 410 hold expired, 429 too many requests.

## 4. Data model

- **users:** `id` PK, `name`, `email` UNIQUE NOT NULL.
- **events:** `id` PK, `name`, `venue`, `starts_at`, `on_sale_at`.
- **seats:** `id` PK, `event_id` FK, `section`, `row_label`, `seat_number`, `price_cents`, `status` (AVAILABLE, HELD, SOLD), `held_by` FK users (nullable), `hold_expires_at`; UNIQUE (event_id, section, row_label, seat_number).
- **orders:** `id` PK, `user_id` FK, `event_id` FK, `status`, `total_cents`, `payment_ref` UNIQUE, `idempotency_key` UNIQUE.
- **tickets:** `id` PK, `order_id` FK, `seat_id` FK **UNIQUE**, `code` UNIQUE.

**Relationships:** user has many orders; event has many seats and many orders; order has many tickets; a seat has at most one ticket. Users and events are many-to-many through orders.

### Preventing two people buying the same seat

1. **Atomic hold.** One conditional UPDATE, never read-then-write:
   ```sql
   UPDATE seats SET status='HELD', held_by=:user, hold_expires_at=now()+interval '5 minutes'
   WHERE id=:seat AND (status='AVAILABLE' OR (status='HELD' AND hold_expires_at < now()));
   ```
   1 row changed = the user won the seat; 0 rows = someone was first, so return 409. The database locks the row, so simultaneous requests run one after another. Several seats are held in one transaction in sorted seat order: all or none, and no deadlocks.
2. **Check on payment.** One transaction confirms `held_by` is still this user and the hold has not expired, sets the seat `SOLD`, the order `PAID`, and inserts the tickets. Otherwise nothing is sold and the payment is refunded.
3. **Constraint safety net.** `UNIQUE (seat_id)` on `tickets` makes a second ticket for a seat impossible, even if the code has a bug.
4. **Expiry.** The hold query treats expired holds as free, and a worker cleans them up.
5. **Retries.** The idempotency key and UNIQUE `payment_ref` stop duplicate orders and charges.

## 5. Architecture

```
 Users --static files--> CDN
   |
   v
 Waiting Room (virtual queue, fixed admission rate)
   v
 Load Balancer
   v
 API Servers (stateless, scaled up before the sale)
   |-- seat map, rate limits --> Redis Cache (refreshed every 1-2 s)
   |-- browse reads ----------> Read Replica <-- replication -- Primary DB
   |-- holds, orders ---------------------------------------> Primary DB
   |-- payment --> Payment Provider --webhook--> API Servers
   +-- enqueue --> Message Queue --> Workers (email, tickets, hold expiry)
```

- **CDN:** serves static files and event pages near the user, so that traffic never reaches us.
- **Waiting room:** queues the 200,000 arrivals and admits them at a rate the system can handle, which keeps order fair.
- **Load balancer:** spreads requests across API servers and skips unhealthy ones.
- **API servers:** stateless servers running the hold, order and ticket logic; more can be added before a sale.
- **Redis cache:** holds the seat map and rate-limit counters in memory so most reads skip the database.
- **Primary database (SQL):** the source of truth; runs the transactions and enforces the constraints.
- **Read replica:** serves browsing so reads do not slow the primary.
- **Payment provider:** takes card details and reports the result by webhook.
- **Queue and workers:** send emails, create tickets and expire holds in the background.

**How it survives the big sale:**
- The waiting room turns 333 arrivals/s into a steady trickle (say 2,000 users inside at a time).
- The seat map comes from the cache, so only holds and payments reach the primary, which is a few hundred conditional updates a second.
- Once sold out, "sold out" is served from the cache, so the 180,000 losers do not hit the database.
- The sale time is known, so servers are scaled up and caches warmed beforehand.
- Per-user and per-IP rate limits and a 4-seat cap protect fairness.

## 6. Trade-offs

1. **SQL as source of truth vs. speed.** Deciding holds in SQL is slower than in Redis, but a cache can lose data or disagree, and a double-sold seat is the one failure we cannot accept. The waiting room and cache protect the database.
2. **Stale seat map vs. load.** A map cached 1-2 s may show a taken seat as free, so some users get a 409. We accept this to save thousands of reads per second.
3. **Waiting room: fairness and stability vs. friction.** Users wait and some give up, but without it the site would likely crash and bots would win.
4. **Hold length (5 minutes).** Longer helps slow payers but lets bots and idle users lock seats; shorter frees seats faster but may cut off real payments.
