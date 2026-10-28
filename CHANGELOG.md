# Changelog

Changes to the course that learners notice, newest first. The live site deploys every merge to `main`, so each entry is dated by the day it went live (UTC) rather than by a version number. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## 2026-10-24

### Changed
- **Compiler-error questions now count toward perfect lessons** ([#133](https://github.com/abhishekangira/The-Definitive-C-Course/pull/133)). In an exercise that shows a compiler error, each question it asks ("Which line is the compiler pointing at?", what is wrong, and "Which stage failed?" where it asks one) is scored on your first Check, like predictions and quiz questions.
  - **What you may lose:** if you earned a perfect mark on a lesson with one of these exercises before this change, the lesson is no longer perfect, because your earlier answers were never saved. "Perfect lessons" on the course map counts one fewer for each such lesson. Your other progress is untouched.
  - **Lessons affected** (8):
    - Module 1: lesson 1 "Hello, compiled world", 2 "Types are layouts", 3 "Control flow", 4 "Functions and scope", 6 "Read the compiler like a linter".
    - Module 2: lesson 1 "Binary and hex", 3 "Unsigned and two's complement", 4 "Bitwise operators and masks".
  - **How to get the mark back:** open the lesson and answer its compiler-error exercises again, then press Check. If every answer is right on that first Check, the lesson is perfect again. The celebration does not play a second time for a lesson it already played for.
  - **Fair warning:** that Check is scored as your first answer even though you have seen the exercise before. A wrong answer then stays wrong; only "Reset all progress" in Settings clears it, and that clears all your progress.
- **"Reset all progress" also clears the perfect-lesson celebrations**, so a lesson you make perfect again after a reset celebrates again ([#133](https://github.com/abhishekangira/The-Definitive-C-Course/pull/133)).

### Added
- **Ctrl+Enter (Cmd+Enter on a Mac) in a prediction box** locks in your prediction and runs the code, or reveals the output ([#133](https://github.com/abhishekangira/The-Definitive-C-Course/pull/133)).
