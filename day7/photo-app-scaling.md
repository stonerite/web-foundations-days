# SnapShare Scaling Plan

SnapShare lets users upload photos and scroll a feed of photos from people they follow.

## 1. Assumptions

- 10,000,000 registered users; 10% are active each day.
- Each active user uploads 1 photo/day and views 50 feed pages/day.
- Original photo: 2 MB. Thumbnail: 50 KB. Each feed page shows about 10 thumbnails.
- Peak = 5× the average. A day = 86,400 s. 1 TB = 1,000,000 MB.
- Storage counts photo files only (no replication or backups).

## 2. Estimates

- **Daily active users:** 10,000,000 × 10% = **1,000,000**
- **Uploads/s:** 1,000,000 / 86,400 = **11.6 average**, **58 peak**
- **Feed views/s:** (1,000,000 × 50) / 86,400 = **579 average**, **2,894 peak**
- **Thumbnail fetches/s:** 579 × 10 = about 5,800 average, 29,000 peak
- **Storage per year:** 1,000,000 × 2.05 MB = 2.05 TB/day × 365 = **about 748 TB** (730 TB originals + 18.25 TB thumbnails)

## 3. Read-heavy or write-heavy?

**Read-heavy.** There are 50 feed views per upload (50:1), and each view loads many images. So:
- serve images through a CDN and hot data from a cache;
- send feed reads to a read replica and keep writes on the primary (only 58/s at peak);
- move slow work (thumbnails) off the request path with a queue;
- accept slightly stale reads, which lets us cache aggressively.

**Why photos stay out of the database:** 748 TB/year would bloat the database, its backups and replication, and fill its memory cache with blobs. Database storage costs far more than object storage, and a database cannot serve files to a CDN. Photo files go in **object storage**; the database keeps only metadata (owner, caption, time, object key).

## 4. Architecture diagram

```
  Users ---------------------------------+
    | API calls (feed, upload)           | image GETs
    v                                    v
  Load Balancer                         CDN
    |                                    | cache miss
    v                                    v
  App Servers --- presigned URL ---> Object Storage <---+
    |   |   |                        (originals,        |
    |   |   |                         thumbnails)       | read original,
    |   |   +-- enqueue job --> Queue --> Worker -------+ write thumbnail
    |   |
    |   +-- reads: Cache (Redis) first, then Read Replica
    +------ writes: Primary DB --- replicates ---> Read Replica
```

Users upload the original photo straight to Object Storage using the presigned URL, so the file never passes through the app servers.

## 5. What each component does

- **CDN:** serves photos and thumbnails from servers near the user, so most image traffic never reaches our systems.
- **Load balancer:** spreads requests across app servers and skips unhealthy ones, removing the single-server bottleneck.
- **App servers:** run the business logic (login, feed, upload handling) as identical stateless machines that can be added as load grows.
- **Cache:** keeps feed pages and hot data in fast memory so repeated reads skip the database.
- **Database (primary):** stores users, follows and photo metadata, and handles all writes.
- **Read replica:** serves feed and profile reads so they do not slow down the primary.
- **Object storage:** holds hundreds of terabytes of photo files cheaply and durably outside the database.
- **Queue:** holds thumbnail jobs so users never wait and upload spikes do not overwhelm the workers.
- **Worker:** does the CPU-heavy resizing in the background and can be scaled separately from the app servers.

## 6. Upload flow

1. The client sends an upload request; the load balancer routes it to an app server.
2. The app server checks login, file type and size limits.
3. It creates a photo row in the primary database with status `processing` and returns a photo ID plus a short-lived **presigned URL**.
4. The client uploads the original directly to object storage (for example `originals/<id>.jpg`).
5. The client tells the app server the upload finished (or object storage sends an event).
6. The app server puts a "make thumbnail for `<id>`" job on the **queue** and tells the user "Upload successful".
7. A worker takes the job and reads the original from object storage.
8. The worker creates a 50 KB thumbnail and writes it to object storage (`thumbnails/<id>.jpg`).
9. The worker sets the photo row to `ready` and saves the thumbnail location.
10. The followers' feed cache entries are invalidated, so the photo appears; images load via the CDN.

**Failures:**
- If a worker crashes, the job is not acknowledged and returns to the queue for a retry. Jobs that keep failing go to a dead-letter queue for inspection.
- Thumbnail jobs are idempotent (same input, same output file), so a retry is safe.
- Until the thumbnail exists, the app shows a placeholder.
- If a client never uploads, the row stays `processing`; a cleanup job deletes rows and files that are still unfinished after 24 hours.

## 7. Trade-offs

1. **Cache: speed vs freshness.** The cache makes feeds fast, but a new or deleted photo can show up late. We accept a few seconds of staleness.
2. **Read replica: scale vs consistency.** Replication lags, so a user might not see their own new photo at once. Reads go to replicas by default; a user's own recent actions read from the primary.
3. **Queue and worker: fast uploads vs delayed thumbnails.** Users do not wait, but thumbnails appear seconds later and we must run and monitor the queue and workers.
4. **Object storage and CDN: low cost vs more moving parts.** Cheap, durable files, but CDN bandwidth is billed, deleted photos can linger in CDN caches, and file and metadata can fall out of step (a row without a file, or the reverse).
