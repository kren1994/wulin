# WebSocket test scenarios

Run each scenario with 2 browser tabs (A and B). Use private window for tab B.

## 1) Room create and join

1. Tab A enters room code and joins.
2. Tab B enters same room code and joins.
3. Expected: both see each other, no error toast.

## 2) Guest reconnect

1. Start a game and play at least 2 moves.
2. Close tab B.
3. Re-open tab B and join same room.
4. Expected: B reconnects, board state and clocks recover.

## 3) Host disconnect failover path

1. Start game and ensure both players are seated.
2. Close host tab during game.
3. Wait for takeover/reconnect behavior.
4. Expected: remaining player does not lose state abruptly; reconnect path works.

## 4) Concurrent action safety

1. Have both tabs try to play quickly around turn boundaries.
2. Expected: invalid actions are rejected with notice; state remains consistent.

## 5) Snapshot recovery

1. Force temporary network interruption for one tab.
2. Restore network.
3. Expected: client requests snapshot and state converges.

## 6) Long-running clock sync

1. Play for at least 5 minutes.
2. Expected: both tabs show close clock values and timeout handling is correct.

## 7) Leave and rejoin cleanly

1. Guest leaves room via UI.
2. Guest joins again with same room code.
3. Expected: no stale ghost connection; participant list is correct.

## 8) Mobile check

1. Open on mobile browser.
2. Play basic actions (seat, ready, move).
3. Expected: no input regression after transport change.
