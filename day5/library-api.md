# Library API Design: Books Resource

A REST API for a library's `books` resource. All requests and responses use JSON (`Content-Type: application/json`).

## Base URL

- `/api/v1`

## Book representation

- `id` (integer, assigned by the server)
- `title` (string, required)
- `author` (string, required)
- `isbn` (string, required)
- `publishedYear` (integer, optional)
- `available` (boolean, defaults to `true`)

## Endpoints

### 1. List books

- **Method:** `GET`
- **Path:** `/api/v1/books`
- **Description:** Returns all books in the library.
- **Request body:** none
- **Success status:** `200 OK`

### 2. Get one book

- **Method:** `GET`
- **Path:** `/api/v1/books/{id}`
- **Description:** Returns the single book with the given id.
- **Request body:** none
- **Success status:** `200 OK`

### 3. Create a book

- **Method:** `POST`
- **Path:** `/api/v1/books`
- **Description:** Adds a new book to the library.
- **Example request body:**
  ```json
  {
    "title": "Things Fall Apart",
    "author": "Chinua Achebe",
    "isbn": "9780385474542",
    "publishedYear": 1958
  }
  ```
- **Success status:** `201 Created` (with a `Location: /api/v1/books/{id}` header)

### 4. Replace a book

- **Method:** `PUT`
- **Path:** `/api/v1/books/{id}`
- **Description:** Replaces the whole book record; all required fields must be sent.
- **Example request body:**
  ```json
  {
    "title": "Things Fall Apart",
    "author": "Chinua Achebe",
    "isbn": "9780385474542",
    "publishedYear": 1958,
    "available": false
  }
  ```
- **Success status:** `200 OK`

### 5. Update part of a book

- **Method:** `PATCH`
- **Path:** `/api/v1/books/{id}`
- **Description:** Changes only the fields sent, for example marking a book as borrowed.
- **Example request body:**
  ```json
  {
    "available": false
  }
  ```
- **Success status:** `200 OK`

### 6. Delete a book

- **Method:** `DELETE`
- **Path:** `/api/v1/books/{id}`
- **Description:** Removes the book from the library.
- **Request body:** none
- **Success status:** `204 No Content`

### 7. List books by an author

- **Method:** `GET`
- **Path:** `/api/v1/books?author={name}`
- **Example:** `/api/v1/books?author=Chinua%20Achebe`
- **Description:** Returns only the books written by the given author, using the `author` query parameter.
- **Request body:** none
- **Success status:** `200 OK` (an empty list `[]` if the author has no books)

## Error codes

### 400 Bad Request

- **Meaning:** The request is malformed or fails validation, so the server cannot process it.
- **Example 1:** `POST /api/v1/books` with a body that is missing the required `title` field.
- **Example 2:** `GET /api/v1/books/abc`, where the id is not a number.
- **Example response body:**
  ```json
  {
    "error": "Bad Request",
    "message": "The field 'title' is required."
  }
  ```

### 404 Not Found

- **Meaning:** The requested book does not exist.
- **Example 1:** `GET /api/v1/books/9999` when no book has id 9999.
- **Example 2:** `DELETE /api/v1/books/42` when book 42 was already deleted.
- **Example response body:**
  ```json
  {
    "error": "Not Found",
    "message": "No book exists with id 9999."
  }
  ```
