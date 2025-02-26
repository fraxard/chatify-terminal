const WebSocket = require('ws');
const express = require('express');

const app = express();
const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });

const MAX_MESSAGE_LENGTH = 200;
const MAX_ROOMS_PER_USER = 5;
const MAX_USERS_PER_ROOM = 100;

let users = {};
const rooms = {};
const activeUsers = new Set();
const bannedUsers = new Set(); // Store banned usernames
const mutedUsers = new Set(); // Store muted users
const channels = {};
const userRooms = {}; // Track rooms per user


const admins = {
    "admin": "securepass123",
    "mod": "modpassword"
};

wss.on('connection', (ws) => {
    console.log('New client connected');
    ws.rooms = new Set(); // Track all rooms the user is in
    // Add a flag to track if the nickname has been set
    ws.nicknameSet = false;


    ws.on('message', (message) => {
        console.log(`Received: ${message}`);
        const msg = message.toString().trim();
        const [command, ...args] = msg.split(" ");

        if (ws.awaitingPassword) {
            console.log("DEBUG: Expected password:", admins[ws.awaitingPassword]);
            console.log("DEBUG: Received password:", message);

            if (message.toString().trim() === admins[ws.awaitingPassword].trim()) {
                ws.username = ws.awaitingPassword;
                activeUsers.add(ws.username);
                ws.send('✅ Admin access granted.');
                console.log(`✔ Admin ${ws.username} logged in.`);
                ws.isAdmin = true;
            } else {
                ws.send('❌ Incorrect password. Try again.');
                console.log("❌ Incorrect password entered.");
            }

            ws.awaitingPassword = null;  // Reset after checking
        }

        // If the user hasn't set a nickname, force them to set one
        if (!ws.username && command !== "NICK") {
            ws.send("❌ You must set a nickname first! Use: NICK <your_name>");
            return;
        }

        switch (command) {
            case 'NICK':
                const newUsername = args[0];

                if (!newUsername) {
                    ws.send('ERROR: Username cannot be empty.');
                    return;
                }

                if (ws.usernameSet) {
                    ws.send('❌ ERROR: You cannot change your username after setting it once.');
                    return;
                }

                if (activeUsers.has(newUsername)) {
                    ws.send(`ERROR: Username "${newUsername}" is already taken.`);
                    return;
                }

                if (admins[newUsername]) {
                    ws.send("🔒 Enter password:");
                    ws.awaitingPassword = newUsername;
                    return;
                }

                ws.username = newUsername;
                activeUsers.add(newUsername);
                ws.usernameSet = true;
                ws.send(`Your nickname is now ${ws.username}`);
                break;


            case 'CREATE': {
                const roomName = args[0];
                const roomPassword = args[1] || null; // Password is optional

                if (!roomName) {
                    ws.send('❌ ERROR: Room name is required.');
                    return;
                }

                if (rooms[roomName]) {
                    ws.send(`❌ ERROR: Room "${roomName}" already exists.`);
                    return;
                }

                rooms[roomName] = { users: new Set(), password: roomPassword };
                ws.send(`✅ Room "${roomName}" created successfully! ${roomPassword ? '🔒 Password is set.' : '🔓 No password required.'}`);
                break;
            }


            case "JOIN":
                if (args.length < 1) {
                    ws.send(`[${getTimestamp()}] ERROR: No room specified.`);
                    return;
                }
                if (bannedUsers.has(ws.username)) {
                    ws.send(`[${getTimestamp()}] ❌ You are banned from this server.`);
                    ws.close(); // Immediately disconnect banned users
                    return;
                }

                // Check room limit
                if (ws.rooms.size >= MAX_ROOMS_PER_USER) {
                    ws.send(`You cannot join more than ${MAX_ROOMS_PER_USER} rooms`);
                    return;
                }

                // Inside the JOIN command
                const userRoomCount = Object.entries(rooms).filter(([_, room]) =>
                    room.users.has(ws.username)
                ).length;

                if (userRoomCount >= MAX_ROOMS_PER_USER) {
                    ws.send(`You cannot join more than ${MAX_ROOMS_PER_USER} rooms`);
                    return;
                }
                const roomName = args[0];
                const enteredPassword = args[1] || null; // Password is optional

                if (!rooms[roomName]) {
                    ws.send(`[${getTimestamp()}] ❌ ERROR: Room "${roomName}" does not exist! Use "/CREATE ${roomName} [password]" to create one.`);
                    return;
                }

                // Check if the room requires a password
                if (rooms[roomName].password && rooms[roomName].password !== enteredPassword) {
                    ws.send(`[${getTimestamp()}] ❌ ERROR: Incorrect password.`);
                    return;
                }
                // Adding to room
                rooms[roomName].users.add(ws.username);
                ws.room = roomName;

                ws.send(`[${getTimestamp()}] ✅ You joined ${ws.room}`);
                broadcast(`[${getTimestamp()}] ${ws.username} joined ${ws.room}`, ws.room);
                break;

            case "WHO":  // Remove the slash
                const targetRoom = args[0];

                if (!rooms[targetRoom]) {
                    ws.send(`Room ${targetRoom} does not exist.`);
                } else if (rooms[targetRoom].users.size === 0) {  // Check users Set size
                    ws.send(`Room ${targetRoom} exists but has no users.`);
                } else {
                    ws.send(`Users in ${targetRoom}: ${Array.from(rooms[targetRoom].users).join(", ")}`);
                }
                break;

            case "MSG":
                if (mutedUsers.has(ws.username)) {
                    ws.send("You are muted and cannot send messages");
                    return;
                }
                if (!ws.room) {
                    ws.send("ERROR: You must join a room first!");
                    return;
                }
                if (args.length < 2) {
                    ws.send("ERROR: Invalid format. Use MSG room Your message");
                    return;
                }
                const target = args[0];
                const chatMessage = args.slice(1).join(" ").replace(/^:/, "");
                if (!rooms[target]?.users.has(ws.username)) {
                    ws.send(`❌ You are not in room "${target}".`);
                    return;
                }
                broadcast(`[${target}] ${ws.username}: ${chatMessage}`, target, ws);
                break;


            case 'PMSG':  // Private messaging command
                if (args.length < 2) {
                    ws.send("❌ ERROR: Usage: MSG <username> <message>");
                    return;
                }
                const recipientName = args[0];
                const privateMessage = args.slice(1).join(" ");

                // Find the recipient WebSocket connection
                let recipientSocket = null;
                wss.clients.forEach(client => {
                    if (client.username === recipientName) {
                        recipientSocket = client;
                    }
                });

                if (!recipientSocket) {
                    ws.send(`[${getTimestamp()}]❌ ERROR: User "${recipientName}" not found.`);
                    return;
                }

                // Send private message only to sender and recipient
                ws.send(`[${getTimestamp()}]📩 (Private) To ${recipientName}: ${privateMessage}`);
                recipientSocket.send(`[${getTimestamp()}]📩 (Private) From ${ws.username}: ${privateMessage}`);
                break;

            case "LIST":
                if (Object.keys(rooms).length === 0) {
                    ws.send("No active rooms.");
                } else {
                    ws.send(`Active rooms: ${Object.keys(rooms).join(", ")}`);
                }
                break;

            case "TOPIC":
                if (!ws.isAdmin) {
                    ws.send("❌ ERROR: Only admins can set topics.");
                    return;
                }
                const topicRoom = args[0];
                const topicMessage = args.slice(1).join(" ").replace(/^:/, "").trim();

                if (!topicRoom || !rooms[topicRoom]) {
                    ws.send("ERROR: Room not found.");
                    return;
                }

                rooms[topicRoom].topic = topicMessage;
                broadcast(`📢 Topic for ${topicRoom} changed to: ${topicMessage}`, topicRoom);
                break;

            case 'KICK':
                if (ws.isAdmin) {
                    const targetUser = args[0];
                    const reason = args.slice(1).join("") || "No reason specified"
                    let found = false;

                    // Iterate over all connected users
                    for (let client of wss.clients) {
                        if (client.username === targetUser) {
                            client.send(`You have been Kicked by an admin. Reason: ${reason}`);
                            client.close(); // Disconnect the target user
                            found = true;
                            broadcast(`🚨 User ${targetUser} was kicked by admin.`);
                            break;
                        }
                    }

                    if (!found) {
                        ws.send(`❌ User ${targetUser} not found.`);
                    }
                } else {
                    ws.send('❌ You are not an admin.');
                }
                break;

            case 'BAN':
                if (ws.isAdmin) {
                    const targetUser = args[0];
                    let found = false;

                    for (let client of wss.clients) {
                        if (client.username === targetUser) {
                            bannedUsers.add(targetUser); // Add to ban list
                            client.close(); // Disconnect the user
                            found = true;
                            broadcast(`🚨 User ${targetUser} has been banned by an admin.`);
                            break;
                        }
                    }

                    if (!found) {
                        ws.send(`❌ User ${targetUser} not found.`);
                    }
                } else {
                    ws.send('❌ You are not an admin.');
                }
                break;


            case "UNBAN":
                if (!ws.isAdmin) {
                    ws.send(`[${getTimestamp()}] ❌ ERROR: Only admins can unban users.`);
                    return;
                }
                if (args.length < 1) {
                    ws.send(`[${getTimestamp()}] ❌ ERROR: Usage: UNBAN <username>`);
                    return;
                }

                const userToUnban = args[0];

                if (!bannedUsers.has(userToUnban)) {
                    ws.send(`[${getTimestamp()}] ❌ ERROR: User "${userToUnban}" is not banned.`);
                    return;
                }

                bannedUsers.delete(userToUnban);
                ws.send(`[${getTimestamp()}] ✅ SUCCESS: "${userToUnban}" has been unbanned.`);
                broadcast(`[${getTimestamp()}] ⚠️ User "${userToUnban}" has been unbanned by ${ws.username}.`, "global");
                break;


            case "MUTE":
                if (ws.isAdmin) {
                    const targetUser = args[0];
                    if (!targetUser) {
                        ws.send("❌ ERROR: No user specified.");
                        return;
                    }

                    mutedUsers.add(targetUser);
                    broadcast(`🔇 User ${targetUser} has been muted by an admin.`);
                } else {
                    ws.send('❌ You are not an admin.');
                }
                break;

            case "UNMUTE":
                if (ws.isAdmin) {
                    const targetUser = args[0];
                    if (!targetUser) {
                        ws.send("❌ ERROR: No user specified.");
                        return;
                    }

                    if (mutedUsers.has(targetUser)) {
                        mutedUsers.delete(targetUser);
                        broadcast(`🔊 User ${targetUser} has been unmuted.`);
                    } else {
                        ws.send(`❌ User ${targetUser} is not muted.`);
                    }
                } else {
                    ws.send('❌ You are not an admin.');
                }
                break;

            case 'WHOAMI':
                const clientIP = ws._socket.remoteAddress;  // Get user's local IP
                const connectionTime = ws.connectionTime || new Date().toISOString(); // Store connection time
                const userAgent = ws._socket.headers ? ws._socket.headers['user-agent'] : 'Unknown'; // Get browser/device info
                const protocol = ws._socket.encrypted ? 'WSS (Secure)' : 'WS (Unsecure)'; // Check if it's WS or WSS
                const serverIP = ws._socket.server.address().address; // Get server's IP
                const serverPort = ws._socket.server.address().port; // Get server's port
                const userID = ws.userID || 'N/A'; // If you use user IDs, fetch it

                ws.send(`ℹ️ **User Info:**`);
                ws.send(`👤 Username: ${ws.username || 'Guest'}`);
                ws.send(`🆔 User ID: ${userID}`);
                ws.send(`🌍 Your IP: ${clientIP}`);
                ws.send(`📡 Protocol: ${protocol}`);
                ws.send(`🕒 Connected since: ${connectionTime}`);
                ws.send(`🖥 Device: ${userAgent}`);
                ws.send(`🔗 Server: ${serverIP}:${serverPort}`);
                break;

            case "PART":
                const roomToLeave = args[0];
                if (!roomToLeave) {
                    ws.send("❌ ERROR: Usage: PART <room>");
                    return;
                }

                // Check if the room exists and the user is in it
                if (!rooms[roomToLeave]?.users.has(ws.username)) {
                    ws.send(`❌ You are not in room "${roomToLeave}".`);
                    return;
                }

                // Remove user from the room
                rooms[roomToLeave].users.delete(ws.username);
                ws.rooms.delete(roomToLeave);
                broadcast(`[${getTimestamp()}] ${ws.username} left ${roomToLeave}`, roomToLeave);
                cleanupRoom(roomToLeave);
                ws.send(`✅ Left room "${roomToLeave}"`); // Confirmation message
                break;

            case "QUIT":
                if (ws.username) {
                    // Leave all rooms
                    ws.rooms.forEach(roomName => {
                        rooms[roomName].users.delete(ws.username);
                        broadcast(`${ws.username} has quit`, roomName);
                        cleanupRoom(roomName);
                    });
                    ws.rooms.clear();
                    activeUsers.delete(ws.username);
                    delete users[ws.username];
                }
                ws.close();
                break;
        }
    });

    // Add proper disconnection handling
    ws.on('close', () => {
        try {
            if (ws.username) {
                activeUsers.delete(ws.username);
                // Leave all rooms
                ws.rooms.forEach(roomName => {
                    rooms[roomName].users.delete(ws.username);
                    broadcast(`${ws.username} disconnected`, roomName);
                    cleanupRoom(roomName);
                });
                ws.rooms.clear();
                delete users[ws.username];
            }
        } catch (err) {
            console.error(`Cleanup error: ${err}`);
        }
    });

    ws.on('error', (error) => {
        console.error(`Client Error for ${ws.username}:`, error);
    });
});

function broadcast(message, room, sender) {
    console.log(`🔹 Broadcasting to ${room}: ${message}`);
    // Block muted users from sending messages
    if (sender && mutedUsers.has(sender.username)) {
        sender.send(`[${getTimestamp()}]❌ You are muted and cannot send messages.`);
        return;
    }
    const timestampedMessage = `[${getTimestamp()}] ${message}`;
    try {
        if (message.length > MAX_MESSAGE_LENGTH) {
            throw new Error("Message too long");
        }

        wss.clients.forEach((client) => {
            try {
                if (client !== sender && client.readyState === WebSocket.OPEN && rooms[room]?.users.has(client.username)) {
                    client.send(timestampedMessage);
                }
            } catch (err) {
                console.error(`Failed to send to client: ${err}`);
            }
        });
    } catch (err) {
        console.error(`Broadcast error: ${err}`);
        if (sender) {
            sender.send(`Error: ${err.message}`);
        }
    }
}

// Add room cleanup
function cleanupRoom(roomName) {
    if (rooms[roomName] && rooms[roomName].users.size === 0) {
        delete rooms[roomName];
    }
}

function getTimestamp() {
    return new Date().toLocaleTimeString(); // e.g., "10:30:45 AM"
}

server.listen(3000, () => console.log("Server running on http://localhost:3000"));