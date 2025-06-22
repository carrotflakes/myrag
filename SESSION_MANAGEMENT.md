# Chat Session Management

This document describes the chat session persistence functionality implemented in the RAG system.

## Features

### Automatic Session Management
- **Auto-save**: Every chat interaction is automatically saved to SQLite database
- **Session Restoration**: On startup, the most recent session is automatically loaded
- **Graceful Shutdown**: Sessions are saved when exiting with `quit` or `exit`

### Manual Session Commands

#### Save Session
```
save [session_id]
```
- Saves current chat state to specified session ID
- If no session_id provided, uses current session ID
- Example: `save my-important-chat`

#### Load Session
```
session <session_id>
```
- Loads a previously saved session
- Replaces current chat history with loaded session
- Example: `session my-important-chat`

#### List Sessions
```
sessions
```
- Shows all saved chat sessions
- Displays session ID, message count, and last updated time
- Sessions are ordered by most recent first

#### Delete Session
```
delete <session_id>
```
- Permanently removes a chat session from database
- Example: `delete old-session`

### Database Structure

#### Sessions Table
- `id`: Unique session identifier
- `created_at`: When session was first created
- `updated_at`: Last modification time
- `message_count`: Number of messages in session

#### Messages Table
- `session_id`: Reference to parent session
- `role`: Message type (user, ai, toolCall, toolResponse, webSearchCall)
- `content`: Message content (for user/ai/toolResponse messages)
- `function_name`: Tool function name (for toolCall messages)
- `arguments`: Tool arguments (for toolCall messages)
- `message_id`: Unique ID for tool-related messages
- `timestamp`: When message was created
- `message_order`: Order within session

### Session ID Format
Sessions are automatically generated with format:
```
session-YYYY-MM-DDTHH-MM-SS-sssZ-random
```
Example: `session-2025-06-22T13-12-38-343Z-gfopsz`

### Storage Location
- Database file: `chat_sessions.db` in project root
- Uses SQLite3 for persistence
- Fully ACID compliant

### Error Handling
- Failed saves are logged but don't interrupt chat flow
- Database errors are gracefully handled with fallbacks
- Connection cleanup on application exit

## Usage Examples

1. **Start chat**: Application automatically loads last session or creates new one
2. **Save important conversation**: `save important-research`
3. **Continue previous work**: `session important-research`
4. **Review all sessions**: `sessions`
5. **Clean up old sessions**: `delete old-session-id`
6. **Exit safely**: `quit` (automatically saves current state)

## Technical Implementation

The persistence system uses:
- SQLite3 database with proper foreign key constraints
- Comprehensive message serialization/deserialization
- Transaction-based operations for data integrity
- Automatic database initialization and schema creation
- Typed interfaces for type safety