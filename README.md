# Chat Server Documentation

## Overview
This WebSocket-based chat server allows users to join rooms, send messages, and interact with others in real-time. It includes admin controls, user restrictions, and security features.

## Features
- **User Authentication**: Users must set a nickname before joining any room.
- **Room Management**: Users can create, join, and leave chat rooms.
- **Messaging**: Supports public messages in rooms and private messages to specific users.
- **Admin Controls**: Kick, ban, mute, and unmute users.
- **Security**: Password-protected rooms, user bans, and max room limits.
- **User Info**: WHOAMI command provides connection details.

## Installation & Setup
### Prerequisites
- Node.js installed

### Steps
1. Clone the repository:
   ```sh
   git clone https://github.com/your-repo/chat-server.git
   cd chat-server
   ```
2. Install dependencies:
   ```sh
   npm install
   ```
3. Start the server:
   ```sh
   node server.js
   ```

## Commands
### User Commands
| Command        | Description |
|---------------|-------------|
| `NICK <name>` | Set your username (cannot be changed later). |
| `WHOAMI`      | Show your username, IP, and server details. |
| `CREATE <room> [password]` | Create a new room (optional password). |
| `JOIN <room> [password]`   | Join an existing room. |
| `LEAVE <room>` | Leave a room. |
| `LIST`        | Show all active rooms. |
| `WHO <room>`  | List all users in a room. |
| `MSG <room> <message>` | Send a message to a room. |
| `PMSG <user> <message>` | Send a private message to a user. |

### Admin Commands
| Command      | Description |
|-------------|-------------|
| `KICK <user> [reason]` | Remove a user from a room. |
| `BAN <user>` | Ban a user from the server. |
| `UNBAN <user>` | Remove a ban on a user. |
| `MUTE <user>` | Mute a user in a room. |
| `UNMUTE <user>` | Unmute a user. |

## Restrictions
- Users cannot change their nickname after setting it.
- Users can only join a maximum of 5 rooms.
- Each room can hold a maximum of 100 users.
- Banned users cannot rejoin until unbanned.

## Testing & Debugging
- Use `wscat` to test WebSocket connections:
  ```sh
  npx wscat -c ws://localhost:3000
  ```
- Verify all commands and edge cases using multiple clients.

## Next Steps
- Implement a UI for the chat system.
- Enhance encryption for message security.
- Add logging and moderation tools for admins.

## License
MIT License

---
This document provides a complete reference for using and managing the chat server.

