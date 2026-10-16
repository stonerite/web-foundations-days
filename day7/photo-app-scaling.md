# SnapShare Scaling Plan

SnapShare is a photo-sharing app. Users upload photos and scroll a feed of photos from people they follow. This plan estimates the load and describes an architecture that can handle it.

## 1. Assumptions

- 10 million registered users.
- 10% of registered users are active on any given day.
- Each active user uploads 1 photo per day.
- Each active user views 50 feed pages per day.
- An average original photo is 2 MB.
- Each photo also gets a thumbnail of 50 KB.
- Peak traffic is 5× the daily average.
- A day has 86,400 seconds, and traffic is treated as spread evenly over the day to get the average.
- 1 feed page view = 1 request to the feed API.
- Sizes use decimal units (1 TB = 1,000,000 MB). Replication and backups are not counted.
- Storage is for photos only. Database rows (captions, follows, likes) are small by comparison.

## 2. Estimates

### Daily active users (DAU)

- 10,000,000 × 10% = **1,000,000 DAU**

### Uploads per second

- Uploads per day: 1,000,000 × 1 = 1,000,000
- Average: 1,000,000 / 86,400 ≈ **11.6 uploads/s**
- Peak (5×): 11.6 × 5 ≈ **58 uploads/s**

### Feed views per second

- Feed views per day: 1,000,000 × 50 = 50,000,000
- Average: 50,000,000 / 86,400 ≈ **579 feed views/s**
- Peak (5×): 579 × 5 ≈ **2,894 feed views/s**

### Photo storage per year

- Per photo: 2 MB original + 0.05 MB thumbnail = 2.05 MB
- Per day: 1,000,000 × 2.05 MB = 2.05 TB
- Per year: 2.05 TB × 365 ≈ **748 TB** (about 730 TB of originals and 18.25 TB of thumbnails)

## 3. Read-heavy or write-heavy?

**SnapShare is read-heavy.**

- There are 50 feed views for every 1 upload, a read-to-write ratio of about 50:1.
- Each feed page also shows several photos, so the number of image fetches is much higher than the number of feed requests.
- If a page shows about 10 thumbnails, that is around 5,800 thumbnail fetches/s on average, and about 29,000/s at peak.

What this means for the design:

- Make reads cheap: serve images from a CDN, and keep hot feed data in a cache so most requests never reach the database.
- Add read replicas so feed queries do not compete with writes on the primary database.
- Keep the write path simple and safe. Writes are only about 58/s at peak, so one primary database can handle them. The heavy work (thumbnails) is moved off the request path with a queue.
- Reads can be slightly stale (a new photo showing up a few seconds late is fine), which lets us cache aggressively.

## 4. Why photos should not be stored in the database

- **Size:** at about 748 TB per year, photos would make the database enormous, and backups, restores and replication would become very slow.
- **Cost:** database storage is far more expensive per GB than object storage.
- **Performance:** large binary blobs fill the database's memory and disk cache and slow down normal queries.
- **Delivery:** a database cannot serve files directly to browsers or work with a CDN, so every image view would go through an app server.
- **Scaling:** object storage scales almost without limit and is built for files.

Instead, the photo files go into **object storage** (such as Amazon S3). The database stores only the metadata, including the photo's object key or URL, the owner, the caption and the upload time.

## 5. Architecture diagram

```
                           +----------------+
                           |    Users       |
                           | (mobile / web) |
                           +--------+-------+
                                    |
            +-----------------------+------------------------+
            | images (GET)                                   | API calls (feed, upload)
            v                                                v
   +------------------+                              +------------------+
   |       CDN        |                              |  Load Balancer   |
   | (cached photos & |                              +---------+--------+
   |   thumbnails)    |                                        |
   +--------+---------+                      +-----------------+-----------------+
            | cache miss                     |                 |                 |
            |                                v                 v                 v
            |                         +------------+    +------------+    +------------+
            |                         | App Server |    | App Server |    | App Server |
            |                         +-----+------+    +-----+------+    +-----+------+
            |                               |                 |                 |
            |            +------------------+-----------------+-----------------+
            |            |                  |                                   |
            |            v                  v                                   v
            |     +-------------+   +----------------+                  +---------------+
            |     |    Cache    |   |    Database    |  replication     |     Queue     |
            |     |   (Redis)   |   |   (primary:    |----------------> | (thumbnail    |
            |     |  feeds,     |   |    writes)     |   +----------+   |  jobs)        |
            |     |  hot data   |   +----------------+   | Read     |   +-------+-------+
            |     +-------------+                        | Replica  |           |
            |                                            | (reads)  |           v
            |                                            +----------+   +---------------+
            |                                                           | Worker(s)     |
            |                                                           | make thumbnail|
            |                                                           +-------+-------+
            |                                                                   |
            |                    +---------------------------+   read original  |
            +------------------->|      Object Storage       |<-----------------+
                                 |  /originals/  /thumbnails/|   write thumbnail
                                 +---------------------------+
                                          ^
                                          | upload original (presigned URL)
                                          | from the user's device
```

Reading the diagram:

- **Image requests** go to the CDN first. On a miss, the CDN fetches from object storage.
- **API requests** (feed, upload) go through the load balancer to an app server.
- App servers read from the cache first, then the read replica. They write to the primary database.
- The primary database copies its changes to the read replica.
- App servers put thumbnail jobs on the queue. Workers take jobs from it, read the original from object storage and write the thumbnail back.

## 6. What each component does

- **CDN:** solves slow and expensive image delivery by serving cached photos and thumbnails from servers close to the user, so most image traffic never reaches our own servers.
- **Load balancer:** solves the single-server bottleneck and single point of failure by spreading requests across many app servers and skipping any that are unhealthy.
- **App servers:** solve the need to run the business logic (log in, feed building, upload handling) by running it on many identical, stateless machines that can be added or removed as load changes.
- **Cache:** solves slow, repeated database reads by keeping frequently requested data, such as feed pages and user profiles, in fast memory.
- **Database (primary):** solves the need to store structured data safely by holding users, follows, photo metadata and captions, and handling every write.
- **Read replica:** solves read overload on the primary by keeping a copy of the data that serves feed and profile reads.
- **Object storage:** solves the problem of storing hundreds of terabytes of photo files cheaply and durably by holding the originals and thumbnails outside the database.
- **Queue:** solves slow uploads and traffic spikes by holding thumbnail jobs so the user does not wait, and so a burst of uploads does not overwhelm the workers.
- **Worker:** solves the CPU-heavy work of resizing images by processing jobs from the queue in the background, and workers can be scaled separately from the app servers.

## 7. Upload flow, step by step

1. The user picks a photo in the app and taps Upload.
2. The app sends an upload request to the API. It goes through the load balancer to an app server.
3. The app server checks that the user is logged in, and checks the file type and size limits.
4. The app server creates a photo record in the primary database with status `processing`, and gets back a new photo ID.
5. The app server returns a short-lived presigned upload URL for object storage, so the photo goes straight there instead of through the app server.
6. The user's device uploads the original photo to object storage (for example under `originals/<photo-id>.jpg`).
7. When the upload finishes, the app confirms it with the app server (or object storage sends an event).
8. The app server puts a "create thumbnail for photo `<photo-id>`" job on the queue, and responds to the user straight away with "Upload successful".
9. A worker takes the job from the queue and reads the original from object storage.
10. The worker resizes the photo into a 50 KB thumbnail and writes it to object storage (for example `thumbnails/<photo-id>.jpg`).
11. The worker updates the photo record in the primary database to status `ready` and saves the thumbnail location.
12. The cache entries for the followers' feeds are invalidated or updated, so the new photo appears.
13. Followers load their feed, and the images come from the CDN, which fetches from object storage on its first miss.
14. If a worker fails, the job returns to the queue and is retried. Jobs that keep failing go to a dead-letter queue to be looked at.

## 8. Trade-offs

### 1. Caching: speed versus freshness

- **Benefit:** a cache makes feeds fast and takes most of the load off the database, which matters because the system is read-heavy.
- **Cost:** cached data can be stale. A new photo, a deleted photo or a new follow may not show up immediately, and cache invalidation adds complexity.
- **Decision:** accept a few seconds of staleness for feeds, because a feed that is a few seconds behind is not a problem for a photo app.

### 2. Read replica: scalability versus consistency

- **Benefit:** replicas spread the read load and add resilience.
- **Cost:** replication is asynchronous, so a replica can lag behind the primary. A user might upload a photo and not see it in their own feed right away.
- **Decision:** read from replicas by default, and read from the primary (or the cache just written to) for a user's own recent actions.

### 3. Queue and worker: fast uploads versus delayed thumbnails

- **Benefit:** the user does not wait for image processing, and spikes are absorbed by the queue.
- **Cost:** for a short time after upload the thumbnail does not exist yet, so the app must show a placeholder or the original. There is also another system (the queue and workers) to run and monitor.
- **Decision:** accept the delay, because thumbnails are usually ready within seconds.

### 4. Object storage plus CDN: low cost versus more moving parts

- **Benefit:** cheap, durable storage and fast image delivery worldwide.
- **Cost:** CDN bandwidth is billed, cached copies can be out of date after a photo is deleted, and uploads and metadata live in two systems that must be kept in step (a photo record can exist without a file, or the reverse).
- **Decision:** accept this, because storing about 748 TB per year in the database would be far worse.
