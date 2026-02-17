# Telegram API Rate Limiting and Message Batching

This document explains the rate limiting and message batching optimizations implemented to prevent hitting Telegram Bot API limits.

## Problem

Telegram Bot API has strict rate limits:
- **30 messages per second** (global, across all chats)
- **20 messages per minute** per chat
- `editMessageText` counts toward these limits

During streaming responses with multiple tool executions, the bot could easily exceed these limits:
- Each tool execution sent a status message
- Tool spinners updated every 1.5 seconds
- Streaming text updates every 3 seconds
- Example: 5 tools × 10s each = ~40 API calls in 50 seconds → **risk of 429 errors**

## Solution

### 1. Global Rate Limiter (`telegram-rate-limiter.ts`)

Tracks all Telegram API calls globally using sliding window algorithm:

```typescript
// Before making ANY Telegram API call:
await telegramRateLimiter.acquireSlot(chatId);
// Automatically delays if approaching limits
```

**Features:**
- Tracks calls per second (global limit: 25/s, buffer under 30/s)
- Tracks calls per minute per chat (limit: 18/min, buffer under 20/min)
- Automatically calculates and applies necessary delays
- Self-cleaning (removes old records)

### 2. Message Batching Queue (`telegram-message-queue.ts`)

Intelligently batches and merges messages by priority:

#### Priority Levels

| Priority | Delay | Use Case |
|----------|-------|----------|
| `CRITICAL` | 0ms (immediate) | User interaction buttons, done message |
| `HIGH` | 100ms | New text segments, important notifications |
| `NORMAL` | 3s | Streaming text updates |
| `LOW` | 3s (merged) | Tool statuses, thinking messages |

#### Message Merging

**Before:**
```
🔧 Reading file.ts ...
📝 Editing config.json ..
🔍 Grepping pattern ...
📂 Globbing *.ts .....
✅ Writing output.txt ..
```
5 separate messages, constantly updating

**After:**
```
⚙️ Tools
🔧 Reading file.ts...
📝 Editing config.json...
🔍 Grepping pattern...
✓ Writing output.txt
2/4 complete
```
1 merged message with animated spinner (⚙️ → 🔧 → ⚡ → 💫), updated immediately when status changes

### 3. Integration in `streaming.ts`

All status callbacks now use the message queue:

```typescript
// Thinking messages (low priority, hidden by default)
await telegramMessageQueue.enqueue(ctx, MessageType.THINKING, ...)

// Tool status (merged into single overview)
await telegramMessageQueue.enqueue(ctx, MessageType.TOOL_STATUS, ...)

// Text updates (batched)
await telegramMessageQueue.enqueue(ctx, MessageType.TEXT_UPDATE, ...)

// Buttons (immediate)
await telegramMessageQueue.enqueue(ctx, MessageType.BUTTON, MessagePriority.CRITICAL, ...)
```

## Configuration

Add to your `.env`:

```bash
# Telegram API rate limiting
TELEGRAM_RATE_LIMIT_DEBUG=false

# Message batching and optimization
MESSAGE_BATCHING_ENABLED=true      # Enable batching (default: true)
MERGE_TOOL_STATUSES=true          # Merge tools into overview (default: true)
SHOW_THINKING_MESSAGES=false      # Show thinking messages (default: false)
```

## Impact

### API Calls Reduction

Typical scenario (5 tools, 50 seconds):

| Scenario | Before | After | Reduction |
|----------|--------|-------|-----------|
| Tool status messages | 5 initial + ~33 spinner updates | 1 merged overview | **-95%** |
| Thinking messages | 1-5 messages | 0 (hidden) | **-100%** |
| Text streaming updates | ~16 edits | ~5 batched edits | **-70%** |
| **Total** | **~40 calls** | **~10 calls** | **-75%** |

### User Experience

- ✅ Cleaner interface (fewer spam messages)
- ✅ Single tool overview shows progress at a glance
- ✅ **Animated spinner** - Visual feedback that system is working (prevents "stuck" feeling)
- ✅ **Immediate updates** - Tool status changes update instantly (not batched)
- ✅ **Responsive batching** - 1.5s delay instead of 3s for text updates
- ✅ No rate limit errors (429)
- ✅ Faster response (less API overhead)
- ✅ Critical messages (buttons, done) still immediate

## Implementation Details

### Rate Limiter Algorithm

Uses sliding window token bucket:
1. Maintains array of recent API call timestamps
2. Before each call, calculates calls in last 1s (global) and 1min (per-chat)
3. If at limit, calculates delay needed for oldest call to expire
4. Automatically sleeps before making call
5. Periodically cleans up old timestamps (>1 minute)

### Message Queue Architecture

```
User action → statusCallback → Message Queue
                                     ↓
                              Priority sorting
                                     ↓
                              Batching timer
                                     ↓
                              Message merging
                                     ↓
                              Rate limiter
                                     ↓
                              Telegram API
```

### Tool Merging Logic

- Tracks active tools per chat in a Map
- Creates/updates a single "tool overview" message
- Updates when tool status changes (start → running → done)
- Automatically removes completed tools after 2s
- Deletes overview message when all tools done

## Monitoring

Debug rate limiting:
```bash
TELEGRAM_RATE_LIMIT_DEBUG=true bun run start
```

Check rate limit status programmatically:
```typescript
const status = telegramRateLimiter.getStatus(chatId);
console.log(status);
// {
//   globalCallsLastSecond: 12,
//   chatCallsLastMinute: 5,
//   globalLimit: 25,
//   chatLimit: 18
// }
```

## Testing

To test with heavy tool usage:
1. Ask Claude to perform multiple operations requiring different tools
2. Example: "Read 5 different files, search for patterns in each, and summarize"
3. Observe single tool overview message instead of spam
4. No 429 rate limit errors even with many tools

## Backward Compatibility

- All changes are backward compatible
- Can disable batching via `MESSAGE_BATCHING_ENABLED=false`
- Can disable tool merging via `MERGE_TOOL_STATUSES=false`
- Original behavior available by disabling both

## Responsiveness Optimizations

To prevent "stuck" feeling:

1. **Tool updates are immediate** - Not batched, updated as soon as status changes
2. **Animated spinner** - Cycles through emoji (⚙️ → 🔧 → ⚡ → 💫) every 1s to show activity
3. **Shorter delays** - Text batching uses 1.5s instead of 3s
4. **Smart rate limiting** - Only delays when actually approaching limits

## Future Improvements

Potential enhancements:
- [ ] Adaptive batching delays based on actual rate limit pressure
- [ ] Message coalescing for rapid text updates (skip intermediate edits)
- [ ] Priority queue preemption (cancel low-priority pending on critical)
- [ ] Metrics collection (track API call reduction over time)
- [ ] User-configurable spinner speed and style
