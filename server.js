const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 8080;

// Create HTTP server that serves static files
const server = http.createServer((req, res) => {
    // Parse URL to separate path from query string
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    const query = parsedUrl.query;
    
    console.log('HTTP Request:', req.url);
    console.log('Pathname:', pathname);
    
    // API endpoint to check if a user is presenting
    if (pathname === '/api/is-presenting') {
        const userId = query.userId;
        
        if (!userId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'userId parameter required' }));
            return;
        }
        
        // Determine if this is a mobile camera check
        let roomId;
        if (userId.startsWith('mobile_')) {
            // Mobile camera check: mobile_289 -> mobile_room_289
            const numericId = userId.replace('mobile_', '');
            roomId = `mobile_room_${numericId}`;
        } else {
            // Screen share check: 289 -> room_289
            roomId = `room_${userId}`;
        }
        
        const room = rooms.get(roomId);
        const isPresenting = room && room.presenter !== null;
        const viewerCount = room ? room.users.size : 0;
        
        let username = null;
        if (isPresenting && room) {
            const presenter = room.users.get(room.presenter);
            if (presenter) {
                username = presenter.username;
            }
        }
        
        // Debug logging
        console.log(`is-presenting check: userId=${userId}, roomId=${roomId}, isPresenting=${isPresenting}, viewerCount=${viewerCount}`);
        
        res.writeHead(200, { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'  // Allow CORS for Gamble Galaxy
        });
        
        const responseData = { 
            userId,
            username,
            isPresenting,
            roomId,
            viewerCount: isPresenting ? viewerCount : 0
        };
        
        console.log(`is-presenting response:`, JSON.stringify(responseData));
        
        res.end(JSON.stringify(responseData));
        return;
    }
    
    // API endpoint to get all active presenters
    if (pathname === '/api/active-presenters') {
        const activePresenters = [];
        
        rooms.forEach((room, roomId) => {
            if (room.presenter) {
                const presenter = room.users.get(room.presenter);
                if (presenter) {
                    // Extract userId from roomId (format: room_123 or mobile_room_123)
                    const userId = roomId.replace('room_', '').replace('mobile_', '');
                    activePresenters.push({
                        userId,
                        username: presenter.username,
                        roomId,
                        viewerCount: room.users.size,
                        type: roomId.startsWith('mobile_room_') ? 'mobile-cam' : 'screen-share'
                    });
                }
            }
        });
        
        res.writeHead(200, { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'  // Allow CORS for Gamble Galaxy
        });
        res.end(JSON.stringify({ 
            count: activePresenters.length,
            presenters: activePresenters
        }));
        return;
    }
    
    // Handle CORS preflight requests
    if (req.method === 'OPTIONS') {
        res.writeHead(200, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        res.end();
        return;
    }
    
    // Determine which file to serve based on pathname and action parameter
    let filePath;
    if (pathname === '/' || pathname === '/index.html') {
        // Check if this is a viewer or host request
        if (query.action === 'join' && query.targetUser) {
            // This is a viewer joining someone's screen
            filePath = path.join(__dirname, 'screen_share_viewer.html');
        } else {
            // This is a host or regular access
            filePath = path.join(__dirname, 'index.html');
        }
    } 
    else if (pathname === '/viewer' || pathname === '/screen_share_viewer.html') { filePath = path.join(__dirname, 'screen_share_viewer.html');} 
    else if (pathname === '/mobile_cam.html') {filePath = path.join(__dirname, 'mobile_cam.html');} 
    else if (pathname === '/mobile_cam_flipadeals.html') { filePath = path.join(__dirname, 'mobile_cam_flipadeals.html')} 
    else if (pathname === '/mobile_cam_viewer.html') { filePath = path.join(__dirname, 'mobile_cam_viewer.html');} 
    else if (pathname === '/mobile_cam_viewer_flipadeals.html') { filePath = path.join(__dirname, 'mobile_cam_viewer_flipadeals.html');}
    else if (pathname === '/mobile_cam_client.js') { filePath = path.join(__dirname, 'mobile_cam_client.js');} 
    else if (pathname === '/mobile_cam_client_flipadeals.js') { filePath = path.join(__dirname, 'mobile_cam_client_flipadeals.js');} 
    else if (pathname === '/mobile_cam_popup.js') { filePath = path.join(__dirname, 'mobile_cam_popup.js');} 
    else if (pathname === '/mobile_cam_popup_flipadeals.js') { filePath = path.join(__dirname, 'mobile_cam_popup_flipadeals.js');} 
    else if (pathname === '/embed.html') { filePath = path.join(__dirname, 'embed.html');} 
    else if (pathname === '/embed_flipadeals.html') { filePath = path.join(__dirname, 'embed_flipadeals.html');}
    else if (pathname === '/screen_share_viewer_final.html') { filePath = path.join(__dirname, 'screen_share_viewer_final.html');} 
    else if (pathname === '/screen_share_viewer_final_flipadeals.html') { filePath = path.join(__dirname, 'screen_share_viewer_final_flipadeals.html');} 
    else if (pathname === '/screen_share_viewer_embed.html') { filePath = path.join(__dirname, 'screen_share_viewer_embed.html');} 
    else if (pathname === '/screen_share_viewer_embed_flipadeals.html') { filePath = path.join(__dirname, 'screen_share_viewer_embed_flipadeals.html');} 
    else if (pathname === '/client.js') { filePath = path.join(__dirname, 'client.js');} 
    else if (pathname === '/client_flipadeals.js') { filePath = path.join(__dirname, 'client_flipadeals.js');} 
    else if (pathname === '/screen_share_popup.js') { filePath = path.join(__dirname, 'screen_share_popup.js');} 
    else if (pathname === '/screen_share_popup_flipadeals.js') { filePath = path.join(__dirname, 'screen_share_popup_flipadeals.js');}
    else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
        return;
    }

    // Read and serve the file
    fs.readFile(filePath, (err, data) => {
        if (err) {
            console.error('Error reading file:', err);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('500 Internal Server Error');
            return;
        }

        // Set content type based on file extension
        const ext = path.extname(filePath);
        const contentType = ext === '.html' ? 'text/html' : 
                          ext === '.js' ? 'application/javascript' : 
                          'text/plain';

        // Add CORS headers for JS files to allow cross-origin loading
        const headers = { 'Content-Type': contentType };
        if (ext === '.js') {
            headers['Access-Control-Allow-Origin'] = '*';
            headers['Access-Control-Allow-Methods'] = 'GET';
        }

        res.writeHead(200, headers);
        res.end(data);
    });
});

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Store rooms and users
const rooms = new Map(); // roomId -> { users: Map, presenter: userId }
const users = new Map(); // userId -> { ws, username, roomId, isPresenter, hasAudio }

// Generate unique ID
function generateId() {
    return Math.random().toString(36).substr(2, 9);
}

// Broadcast to all users in a room except sender
function broadcastToRoom(roomId, message, excludeUserId = null) {
    const room = rooms.get(roomId);
    if (!room) return;

    room.users.forEach((user, userId) => {
        if (userId !== excludeUserId && user.ws.readyState === WebSocket.OPEN) {
            user.ws.send(JSON.stringify(message));
        }
    });
}

// Send to specific user
function sendToUser(userId, message) {
    const user = users.get(userId);
    if (user && user.ws.readyState === WebSocket.OPEN) {
        user.ws.send(JSON.stringify(message));
    }
}

// Get room users info
function getRoomUsersInfo(roomId) {
    const room = rooms.get(roomId);
    if (!room) return [];

    return Array.from(room.users.entries()).map(([userId, user]) => ({
        userId,
        username: user.username,
        isPresenter: userId === room.presenter,
        hasAudio: user.hasAudio || false
    }));
}

// Handle WebSocket connections
wss.on('connection', (ws) => {
    const userId = generateId();
    console.log(`New WebSocket connection: ${userId}`);

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            handleMessage(ws, userId, message);
        } catch (error) {
            console.error('Error parsing message:', error);
        }
    });

    ws.on('close', () => {
        handleDisconnect(userId);
    });

    ws.on('error', (error) => {
        console.error(`WebSocket error for ${userId}:`, error);
    });
});

// Handle incoming messages
function handleMessage(ws, userId, message) {
    console.log(`Message from ${userId}:`, message.type);

    switch (message.type) {
        case 'join':
            handleJoin(ws, userId, message);
            break;

        case 'start-presenting':
            handleStartPresenting(userId, message);
            break;

        case 'stop-presenting':
            handleStopPresenting(userId, message);
            break;

        case 'audio-status':
            handleAudioStatus(userId, message);
            break;

        case 'viewer-ready':
            // Forward viewer-ready to the presenter
            const room = rooms.get(message.roomId);
            if (room && room.presenter) {
                sendToUser(room.presenter, {
                    type: 'viewer-ready',
                    from: userId,
                    roomId: message.roomId
                });
            }
            break;

        case 'offer':
        case 'answer':
        case 'ice-candidate':
            // Forward signaling messages
            if (message.to) {
                sendToUser(message.to, {
                    ...message,
                    from: userId
                });
            }
            break;

        default:
            console.log('Unknown message type:', message.type);
    }
}

// Handle user joining a room
function handleJoin(ws, userId, message) {
    const { roomId, username } = message;

    if (!roomId || !username) {
        ws.send(JSON.stringify({
            type: 'error',
            message: 'Room ID and username are required'
        }));
        return;
    }

    // Create room if it doesn't exist
    if (!rooms.has(roomId)) {
        rooms.set(roomId, {
            users: new Map(),
            presenter: null
        });
        console.log(`Room created: ${roomId}`);
    }

    const room = rooms.get(roomId);

    // Add user to room
    const userInfo = {
        ws,
        username,
        roomId,
        isPresenter: false,
        hasAudio: false
    };

    room.users.set(userId, userInfo);
    users.set(userId, userInfo);

    console.log(`User ${username} (${userId}) joined room ${roomId}`);

    // Send confirmation to user
    ws.send(JSON.stringify({
        type: 'joined',
        roomId,
        userId,
        users: getRoomUsersInfo(roomId)
    }));

    // Notify others in room about new user
    broadcastToRoom(roomId, {
        type: 'user-joined',
        userId,
        username,
        users: getRoomUsersInfo(roomId)
    }, userId);

    // If there's an active presenter, notify the new user
    if (room.presenter) {
        const presenter = room.users.get(room.presenter);
        if (presenter) {
            ws.send(JSON.stringify({
                type: 'presenter-started',
                presenterId: room.presenter,
                presenterName: presenter.username,
                hasAudio: presenter.hasAudio || false
            }));
        }
    }
}

// Handle user starting to present
function handleStartPresenting(userId, message) {
    const user = users.get(userId);
    if (!user) return;

    const { roomId } = message;
    const room = rooms.get(roomId);
    
    if (!room) return;

    // Check if there's already a presenter
    if (room.presenter && room.presenter !== userId) {
        sendToUser(userId, {
            type: 'error',
            message: 'Another user is already presenting in this room'
        });
        return;
    }

    room.presenter = userId;
    user.isPresenter = true;

    console.log(`User ${user.username} started presenting in room ${roomId}`);

    // Notify all users in room
    broadcastToRoom(roomId, {
        type: 'presenter-started',
        presenterId: userId,
        presenterName: user.username,
        hasAudio: user.hasAudio || false
    });
}

// Handle user stopping presentation
function handleStopPresenting(userId, message) {
    const user = users.get(userId);
    if (!user) return;

    const { roomId } = message;
    const room = rooms.get(roomId);
    
    if (!room) return;

    if (room.presenter === userId) {
        room.presenter = null;
        user.isPresenter = false;

        console.log(`User ${user.username} stopped presenting in room ${roomId}`);

        // Notify all users in room
        broadcastToRoom(roomId, {
            type: 'presenter-stopped',
            presenterId: userId
        });
    }
}

// Handle audio status updates
function handleAudioStatus(userId, message) {
    const user = users.get(userId);
    if (!user) return;

    const { roomId, hasAudio } = message;
    const room = rooms.get(roomId);
    
    if (!room) return;

    user.hasAudio = hasAudio;

    console.log(`User ${user.username} audio status: ${hasAudio ? 'ON' : 'OFF'}`);

    // Notify all users in room about audio status change
    broadcastToRoom(roomId, {
        type: 'audio-status-changed',
        userId: userId,
        username: user.username,
        hasAudio: hasAudio,
        users: getRoomUsersInfo(roomId)
    });
}

// Handle user disconnect
function handleDisconnect(userId) {
    const user = users.get(userId);
    if (!user) return;

    const { roomId, username, isPresenter } = user;
    const room = rooms.get(roomId);

    console.log(`User ${username} (${userId}) disconnected from room ${roomId}`);

    if (room) {
        // Remove user from room
        room.users.delete(userId);

        // If presenter disconnected, clear presenter
        if (isPresenter && room.presenter === userId) {
            room.presenter = null;
            
            broadcastToRoom(roomId, {
                type: 'presenter-stopped',
                presenterId: userId
            });
        }

        // Notify others
        broadcastToRoom(roomId, {
            type: 'user-left',
            userId,
            username,
            users: getRoomUsersInfo(roomId)
        });

        // Delete room if empty
        if (room.users.size === 0) {
            rooms.delete(roomId);
            console.log(`Room ${roomId} deleted (empty)`);
        }
    }

    users.delete(userId);
}

// Start server
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`   HTTP: http://localhost:${PORT}`);
    console.log(`   WebSocket: ws://localhost:${PORT}`);
    console.log(`   Screen Share: http://localhost:${PORT}/`);
    console.log(`   Mobile Cam: http://localhost:${PORT}/mobile_cam.html`);
    console.log(`   API: http://localhost:${PORT}/api/is-presenting?userId=X`);
    console.log(`   API: http://localhost:${PORT}/api/active-presenters`);
});

// Handle server errors
server.on('error', (error) => {
    console.error('Server error:', error);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down server...');
    wss.clients.forEach(client => {
        client.close();
    });
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});
