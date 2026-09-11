# DoTodo Context

DoTodo is a daily desktop checklist whose current-day state remains visible while past days form an immutable history.

## Language

**Today**:
The checklist assigned to the computer's current local calendar date. New tasks can only be created here.
_Avoid_: Inbox, current list

**Day record**:
The preserved end state of one local calendar day's checklist.
_Avoid_: Archive snapshot, daily backup

**Task**:
A short actionable text item belonging to exactly one day record.
_Avoid_: Todo item, reminder, event

**Continuation**:
A new task created in Today from an unfinished historical task, linked to its source without altering the historical task.
_Avoid_: Move, rollover, reschedule

**History**:
The chronological collection of immutable day records before Today.
_Avoid_: Archive, log
