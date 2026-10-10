# School Database Design

A small database for a school that records which students are enrolled on which courses, and the grade they got. It has three tables: `students`, `courses` and `enrolments`.

## Tables

### students
- Holds one row per student: `id` (primary key), `name` (required) and `email` (required).
- `email` is `UNIQUE`, so two students cannot share an email address.

### courses
- Holds one row per course: `id` (primary key), `title` (required) and `credits` (required, must be greater than 0).
- A course exists whether or not anyone has enrolled on it yet.

### enrolments
- Holds one row per student-on-course: `id` (primary key), `student_id`, `course_id`, `enrolled_on` and `grade`.
- `student_id` and `course_id` are foreign keys to `students` and `courses`, so an enrolment cannot point at a student or course that does not exist.
- `UNIQUE (student_id, course_id)` stops the same student enrolling on the same course twice.
- `grade` is allowed to be `NULL` (not graded yet) and must be between 0 and 100 when it is set.

## Relationships

- **One-to-many:** one student can have many enrolments, but each enrolment belongs to exactly one student. The same is true for courses: one course has many enrolments, and each enrolment belongs to one course.
- **Many-to-many:** students and courses are many-to-many. A student takes several courses, and a course has several students.
- **Why a join table is needed:** a relational table cannot store a list in one cell, so putting `course_id` in `students` (or `student_id` in `courses`) would force repeated rows or comma-separated values. The `enrolments` table solves this by turning one many-to-many relationship into two one-to-many relationships. It is also the natural home for facts about the pairing itself, such as the grade and the enrolment date, which belong to neither the student nor the course alone.

## Index

- **Index to add:** `CREATE INDEX idx_enrolments_course_id ON enrolments (course_id);`
- **Reason:** the `UNIQUE (student_id, course_id)` constraint already creates an index that speeds up searches by `student_id`, but searches that start from the course cannot use it. "All students on one course" and "number of students per course" both look up enrolments by `course_id`. Without this index the database has to scan the whole table, which gets slow as enrolments grow. With it, it jumps straight to the matching rows.

## SQL or NoSQL?

I would choose SQL for this system. The data is structured and every record has the same shape. The core of it is a many-to-many relationship, and the questions we want to ask (which courses a student takes, who is on a course, how many students per course, who has no enrolments) are joins and aggregates, which SQL does well. SQL also enforces the rules at the database level: foreign keys prevent enrolments for people or courses that do not exist, `UNIQUE` prevents duplicate enrolments and emails, and `NOT NULL` and `CHECK` keep bad values out. A school's data is also fairly small and changes in transactions, such as enrolling a student, where consistency matters more than extreme scale. A NoSQL document database would make sense if the data were very large, had no fixed shape, or was always read as one whole document. Here, it would mean duplicating student or course data inside documents and checking those rules in application code instead.
