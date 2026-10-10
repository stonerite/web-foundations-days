-- day6/school.sql
-- School database: students, courses and enrolments (SQLite)

PRAGMA foreign_keys = ON;

-- Clean start so the script can be re-run safely
DROP TABLE IF EXISTS enrolments;
DROP TABLE IF EXISTS courses;
DROP TABLE IF EXISTS students;

-- ---------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------

CREATE TABLE students (
    id    INTEGER PRIMARY KEY,
    name  TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE
);

CREATE TABLE courses (
    id      INTEGER PRIMARY KEY,
    title   TEXT NOT NULL,
    credits INTEGER NOT NULL DEFAULT 3 CHECK (credits > 0)
);

-- Join table: one row = one student enrolled on one course
CREATE TABLE enrolments (
    id          INTEGER PRIMARY KEY,
    student_id  INTEGER NOT NULL,
    course_id   INTEGER NOT NULL,
    enrolled_on TEXT NOT NULL DEFAULT (date('now')),
    grade       INTEGER CHECK (grade IS NULL OR grade BETWEEN 0 AND 100),
    FOREIGN KEY (student_id) REFERENCES students (id) ON DELETE CASCADE,
    FOREIGN KEY (course_id)  REFERENCES courses (id)  ON DELETE CASCADE,
    -- A student cannot enrol on the same course twice
    UNIQUE (student_id, course_id)
);

-- ---------------------------------------------------------------
-- 2. Sample data
-- ---------------------------------------------------------------

INSERT INTO students (id, name, email) VALUES
    (1, 'Amina Wanjiru', 'amina.wanjiru@example.com'),
    (2, 'Brian Otieno',  'brian.otieno@example.com'),
    (3, 'Cynthia Mutua', 'cynthia.mutua@example.com'),
    (4, 'David Kiptoo',  'david.kiptoo@example.com');   -- not enrolled yet

INSERT INTO courses (id, title, credits) VALUES
    (1, 'Web Foundations',   4),
    (2, 'Databases with SQL', 3),
    (3, 'JavaScript Basics', 3);

INSERT INTO enrolments (student_id, course_id, enrolled_on, grade) VALUES
    (1, 1, '2026-09-01', 78),
    (1, 2, '2026-09-01', NULL),
    (2, 1, '2026-09-02', 64),
    (2, 3, '2026-09-02', 71),
    (3, 1, '2026-09-03', NULL),
    (3, 2, '2026-09-03', 88);

-- ---------------------------------------------------------------
-- 3. Queries
-- ---------------------------------------------------------------

-- Q1. All courses for one student (by name)
SELECT c.title, c.credits, e.grade
FROM students AS s
JOIN enrolments AS e ON e.student_id = s.id
JOIN courses    AS c ON c.id = e.course_id
WHERE s.name = 'Amina Wanjiru'
ORDER BY c.title;

-- Q2. All students on one course
SELECT s.name, s.email, e.grade
FROM courses AS c
JOIN enrolments AS e ON e.course_id = c.id
JOIN students   AS s ON s.id = e.student_id
WHERE c.title = 'Web Foundations'
ORDER BY s.name;

-- Q3. Number of students per course (LEFT JOIN keeps courses with 0 students)
SELECT c.title, COUNT(e.id) AS student_count
FROM courses AS c
LEFT JOIN enrolments AS e ON e.course_id = c.id
GROUP BY c.id, c.title
ORDER BY student_count DESC, c.title;

-- Q4. Students who have no enrolments
SELECT s.id, s.name, s.email
FROM students AS s
LEFT JOIN enrolments AS e ON e.student_id = s.id
WHERE e.id IS NULL;

-- Q5. Update one enrolment's grade (Amina's grade in Databases with SQL)
UPDATE enrolments
SET grade = 85
WHERE student_id = (SELECT id FROM students WHERE name = 'Amina Wanjiru')
  AND course_id  = (SELECT id FROM courses  WHERE title = 'Databases with SQL');

-- Check the update
SELECT s.name, c.title, e.grade
FROM enrolments AS e
JOIN students AS s ON s.id = e.student_id
JOIN courses  AS c ON c.id = e.course_id
WHERE s.name = 'Amina Wanjiru'
ORDER BY c.title;
