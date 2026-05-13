---
title: "Time-Off Microservice — Requirements in Plain Terms"
author: "ExampleHR Engineering"
date: "2026-05-12"
geometry: margin=2.5cm
fontsize: 11pt
mainfont: DejaVu Serif
colorlinks: true
linkcolor: blue
---

# What Are We Building?

A backend service that lets employees request time off through **ExampleHR**, while keeping those requests in sync with an external **HR system** (called the HCM — think Workday or SAP). The HCM is the "source of truth" for how many leave days each employee actually has.

---

# The Core Problem (In Plain English)

Imagine Alice has **10 vacation days**. She opens ExampleHR and requests 2 days off. Simple so far. But here's what makes it hard:

1. **Two systems, one truth.** ExampleHR is the interface, but the HCM holds the real balance. If ExampleHR and the HCM disagree, bad things happen — Alice could end up with more leave than she's entitled to, or be incorrectly told she has no leave left.

2. **The HCM changes balances on its own.** On Alice's work anniversary, the HCM might automatically add 5 bonus days. ExampleHR won't know about this unless it's told.

3. **Two requests can arrive at the same time.** Alice and her colleague Bob both submit requests simultaneously. Together they might exceed the available balance. The system must ensure only one goes through.

4. **The HCM is not 100% reliable.** Sometimes the HCM won't return an error even when a request exceeds the balance. ExampleHR can't blindly trust HCM's error responses — it needs its own safety checks.

---

# What the System Must Do

## For Employees

- **See an accurate balance** — available days = what the HCM says minus any requests they've already submitted that are waiting for manager approval.
- **Get instant feedback** — when they submit a request, they immediately know if it was accepted or rejected (insufficient balance, invalid dates, etc.).
- **Cancel requests** — before or after manager approval.

## For Managers

- **Approve or reject requests** — knowing the balance shown is valid and up to date.
- **Approve with confidence** — the system does a live check with the HCM at approval time to make sure the balance hasn't changed.

## For the System

- **Stay in sync with the HCM** — via two mechanisms:
  - *Real-time:* the HCM can push a single balance update (e.g., after an anniversary bonus).
  - *Batch:* the HCM can push a full snapshot of all employee balances periodically.
- **Never over-allocate leave** — even if two employees (or the same employee twice) submit requests at exactly the same moment.
- **Be defensive** — even if the HCM silently accepts an invalid request, ExampleHR catches it first.

---

# Key Business Rules

| Rule | Plain Explanation |
|------|-------------------|
| Balances are per employee per location | Alice in London and Alice in New York have separate leave pools |
| Available = HCM balance - pending days | Pending means "submitted, not yet approved/rejected" |
| Pending reservation is immediate | The moment you submit a request, those days are reserved locally |
| HCM is notified only on approval | Draft/pending requests don't go to HCM; only approved ones do |
| Approved cancellation credits back | Cancelling an approved request tells the HCM to refund the days |
| Discrepancies are flagged, not auto-fixed | If HCM shows fewer days than our pending requests, a human must review |

---

# Request Lifecycle

```
Employee submits  >  PENDING  >  Manager approves  >  APPROVED  >  Period ends  >  COMPLETED
                        |
                        |-- Manager rejects  >  REJECTED
                        |
                        \-- Employee cancels  >  CANCELLED

                                                APPROVED  >  Employee cancels  >  CANCELLED
```

---

# What the System Does NOT Do

- It does not enforce leave policies (e.g., "you can't take more than 5 days consecutively") — that's the HCM's job.
- It does not handle weekends or public holidays in date calculations — the number of days is provided by the caller.
- It does not send email or push notifications.
- It does not handle multiple tenants (single company assumed).

---

# Who Talks to Whom

```
Employee / Manager
       |
       v
  ExampleHR API  ---------------------->  HCM (Workday/SAP)
       |                                        |
       |  <<-- "How many days does Alice have?"  |
       |  --> "Approve 2 days for Alice"        |
       |                                        |
       <<-- "Alice just got a 5-day bonus"  <<---
       <<-- "Here's everyone's balance"     <<---
```

---

# Summary

In one sentence: **ExampleHR is the face, the HCM is the truth — this service makes sure they always agree, and protects employees from ever accidentally going over their balance, no matter how fast they click.**
