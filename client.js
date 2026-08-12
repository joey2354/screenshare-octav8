// WebSocket and WebRTC configuration
// Auto-detect WebSocket URL based on current page location
const WS_URL = window.location.protocol === 'https:' 
    ? `wss://${window.location.host}` 
    : `ws://${window.location.host}`;

const ICE_SERVERS = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// Global variables
let ws = null;
let localStream = null;
let localAudioStream = null;
let peerConnections = {};
let roomId = null;
let username = null;
let isPresenter = false;
let userId = null;
let isMicActive = false;

// DOM elements
const usernameInput = document.getElementById('username');
const roomIdInput = document.getElementById('roomId');
const connectBtn = document.getElementById('connectBtn');
const shareBtn = document.getElementById('shareBtn');
const stopBtn = document.getElementById('stopBtn');
const micBtn = document.getElementById('micBtn');
const remoteVideo = document.getElementById('remoteVideo');
const remoteAudio = document.getElementById('remoteAudio');
const connectionStatus = document.getElementById('connectionStatus');
const roleStatus = document.getElementById('roleStatus');
const roomStatus = document.getElementById('roomStatus');
const viewerCount = document.getElementById('viewerCount');
const viewerList = document.getElementById('viewerList');
const viewerListContainer = document.getElementById('viewerListContainer');
const videoTitle = document.getElementById('videoTitle');

// Parse URL parameters on page load
window.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const userIdParam = urlParams.get('userId');
    const usernameParam = urlParams.get('username');
    const actionParam = urlParams.get('action');
    const targetUserParam = urlParams.get('targetUser');

    if (userIdParam) {
        userId = userIdParam;
        username = usernameParam || `User_${userId}`;
        usernameInput.value = username;

        if (actionParam === 'create') {
            // Auto-create room for this user
            roomId = `room_${userId}`;
            roomIdInput.value = roomId;
            
            // Show message
            showAutoMessage(`Creating screen share room for ${username}...`);
            
            // Auto-connect after a brief delay
            setTimeout(() => {
                connectToRoom();
            }, 500);
        } else if (actionParam === 'join' && targetUserParam) {
            // Auto-join target user's room
            roomId = `room_${targetUserParam}`;
            roomIdInput.value = roomId;
            
            // Show message
            showAutoMessage(`Joining User ${targetUserParam}'s screen share...`);
            
            // Auto-connect after a brief delay
            setTimeout(() => {
                connectToRoom();
            }, 500);
        }
    }
});

// Show auto-connection message
function showAutoMessage(message) {
    const infoBox = document.querySelector('.info-box');
    if (infoBox) {
        const autoMsg = document.createElement('p');
        autoMsg.style.color = '#2196f3';
        autoMsg.style.fontWeight = 'bold';
        autoMsg.textContent = `🔄 ${message}`;
        infoBox.insertBefore(autoMsg, infoBox.firstChild);
        
        // Remove after 3 seconds
        setTimeout(() => {
            autoMsg.remove();
        }, 3000);
    }
}

// Event listeners
connectBtn.addEventListener('click', connectToRoom);
shareBtn.addEventListener('click', startScreenShare);
stopBtn.addEventListener('click', stopScreenShare);
micBtn.addEventListener('click', toggleMicrophone);

// Connect to room
function connectToRoom() {
    username = usernameInput.value.trim();
    roomId = roomIdInput.value.trim();

    if (!username || !roomId) {
        alert('Please enter both your name and a room ID');
        return;
    }

    // Connect to WebSocket server
    console.log('Connecting to:', WS_URL);
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
        console.log('Connected to signaling server');
        updateConnectionStatus('online');
        
        // Join room
        sendMessage({
            type: 'join',
            roomId: roomId,
            username: username
        });

        connectBtn.disabled = true;
        shareBtn.disabled = false;
        micBtn.disabled = false;
        usernameInput.disabled = true;
        roomIdInput.disabled = true;
    };

    ws.onmessage = async (event) => {
        const message = JSON.parse(event.data);
        await handleSignalingMessage(message);
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        alert('Failed to connect to server');
    };

    ws.onclose = () => {
        console.log('Disconnected from signaling server');
        updateConnectionStatus('offline');
        cleanup();
    };
}

// Handle signaling messages
async function handleSignalingMessage(message) {
    console.log('Received message:', message.type);

    switch (message.type) {
        case 'joined':
            roomStatus.textContent = roomId;
            updateViewerList(message.users);
            break;

        case 'user-joined':
            console.log('👤 User joined:', message.username, '(', message.userId, ')');
            updateViewerList(message.users);
            
            // DON'T create connection here - wait for viewer-ready signal
            // This prevents race conditions and ensures proper WebRTC initialization
            console.log('⏳ Waiting for viewer-ready signal from:', message.userId);
            break;

        case 'user-left':
            console.log('User left:', message.username);
            updateViewerList(message.users);
            
            if (peerConnections[message.userId]) {
                peerConnections[message.userId].close();
                delete peerConnections[message.userId];
            }
            break;

        case 'presenter-started':
            if (!isPresenter) {
                roleStatus.textContent = 'Viewer';
                videoTitle.textContent = `📺 Watching ${message.presenterName}'s Screen`;
                await createPeerConnection(message.presenterId, false);
            }
            break;

        case 'presenter-stopped':
            if (!isPresenter) {
                roleStatus.textContent = 'Viewer';
                videoTitle.textContent = '📺 Screen Share (Waiting for presenter...)';
                remoteVideo.srcObject = null;
                remoteAudio.srcObject = null;
                
                if (peerConnections[message.presenterId]) {
                    peerConnections[message.presenterId].close();
                    delete peerConnections[message.presenterId];
                }
            }
            break;

        case 'audio-status-changed':
            console.log(`User ${message.username} audio: ${message.hasAudio ? 'ON' : 'OFF'}`);
            updateViewerList(message.users);
            break;

        case 'viewer-ready':
            // A viewer is ready to receive our stream
            console.log('📥 Received viewer-ready from:', message.from);
            console.log('   Current state - isPresenter:', isPresenter, '| localStream:', !!localStream, '| isMicActive:', isMicActive);
            
            if (isPresenter && (localStream || isMicActive)) {
                // Check if we already have a connection with this peer
                if (peerConnections[message.from]) {
                    console.log('⚠️ Peer connection already exists for:', message.from);
                    console.log('   State:', peerConnections[message.from].connectionState);
                    
                    // If connection is failed or closed, recreate it
                    if (peerConnections[message.from].connectionState === 'failed' || 
                        peerConnections[message.from].connectionState === 'closed') {
                        console.log('🔄 Recreating failed connection');
                        peerConnections[message.from].close();
                        delete peerConnections[message.from];
                        await createPeerConnection(message.from, true);
                    } else {
                        console.log('✅ Existing connection is good, skipping');
                    }
                } else {
                    console.log('✅ Creating new peer connection for viewer:', message.from);
                    await createPeerConnection(message.from, true);
                }
            } else {
                console.log('⚠️ Cannot create connection:');
                console.log('   - isPresenter:', isPresenter);
                console.log('   - localStream exists:', !!localStream);
                console.log('   - isMicActive:', isMicActive);
            }
            break;

        case 'offer':
            await handleOffer(message);
            break;

        case 'answer':
            await handleAnswer(message);
            break;

        case 'ice-candidate':
            await handleIceCandidate(message);
            break;

        case 'error':
            alert(message.message);
            break;
    }
}

// Create peer connection
async function createPeerConnection(peerId, isInitiator) {
    console.log(`Creating peer connection with ${peerId}, initiator: ${isInitiator}`);

    const pc = new RTCPeerConnection(ICE_SERVERS);
    peerConnections[peerId] = pc;

    // Add local streams if we're the presenter
    if (isPresenter && localStream) {
        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
            console.log(`Added screen track: ${track.kind}`);
        });
    }
    
    // Add microphone for BOTH presenter and viewer
    if (isMicActive && localAudioStream) {
        localAudioStream.getTracks().forEach(track => {
            pc.addTrack(track, localAudioStream);
            console.log(`Added audio track: ${track.kind}`);
        });
    }

    // Handle incoming stream
    pc.ontrack = (event) => {
        console.log('Received remote track:', event.track.kind);
        
        if (event.track.kind === 'video') {
            if (!remoteVideo.srcObject || remoteVideo.srcObject.id !== event.streams[0].id) {
                remoteVideo.srcObject = event.streams[0];
                console.log('✅ Video stream connected');
            }
        } else if (event.track.kind === 'audio') {
            // Create or update audio element for this peer
            let audioElement = document.getElementById(`audio_${peerId}`);
            if (!audioElement) {
                audioElement = document.createElement('audio');
                audioElement.id = `audio_${peerId}`;
                audioElement.autoplay = true;
                document.body.appendChild(audioElement);
            }
            audioElement.srcObject = event.streams[0];
            console.log(`✅ Audio stream connected from peer ${peerId}`);
        }
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            sendMessage({
                type: 'ice-candidate',
                candidate: event.candidate,
                to: peerId,
                roomId: roomId
            });
        }
    };

    // Handle connection state
    pc.onconnectionstatechange = () => {
        console.log(`Connection state with ${peerId}: ${pc.connectionState}`);
        
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
            console.log(`Connection with ${peerId} lost, cleaning up`);
            const audioElement = document.getElementById(`audio_${peerId}`);
            if (audioElement) {
                audioElement.remove();
            }
        }
    };

    // If we're the initiator, create and send offer
    if (isInitiator) {
        console.log(`📤 Initiating connection to ${peerId}`);
        console.log(`   - Local stream exists: ${!!localStream}`);
        console.log(`   - Mic active: ${isMicActive}`);
        console.log(`   - Tracks added to PC: ${pc.getSenders().length}`);
        
        try {
            console.log('Creating offer...');
            const offer = await pc.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true
            });
            console.log('✅ Offer created');
            
            await pc.setLocalDescription(offer);
            console.log('✅ Local description set');
            
            console.log(`📨 Sending offer to ${peerId}`);
            sendMessage({
                type: 'offer',
                offer: offer,
                to: peerId,
                roomId: roomId
            });
            console.log('✅ Offer sent successfully');
        } catch (error) {
            console.error('❌ Error creating offer:', error);
        }
    } else {
        console.log(`⏸️ Not initiating - waiting for offer from ${peerId}`);
    }
}

// Handle incoming offer
async function handleOffer(message) {
    console.log('Handling offer from:', message.from);
    
    // Create peer connection if it doesn't exist
    if (!peerConnections[message.from]) {
        await createPeerConnection(message.from, false);
    }
    
    const pc = peerConnections[message.from];
    
    try {
        await pc.setRemoteDescription(new RTCSessionDescription(message.offer));
        
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        
        sendMessage({
            type: 'answer',
            answer: answer,
            to: message.from,
            roomId: roomId
        });
    } catch (error) {
        console.error('Error handling offer:', error);
    }
}

// Handle answer
async function handleAnswer(message) {
    const pc = peerConnections[message.from];
    if (pc) {
        try {
            await pc.setRemoteDescription(new RTCSessionDescription(message.answer));
        } catch (error) {
            console.error('Error handling answer:', error);
        }
    }
}

// Handle ICE candidate
async function handleIceCandidate(message) {
    const pc = peerConnections[message.from];
    if (pc) {
        try {
            await pc.addIceCandidate(new RTCIceCandidate(message.candidate));
        } catch (error) {
            console.error('Error adding ICE candidate:', error);
        }
    }
}

// Start screen sharing
async function startScreenShare() {
    try {
        // Request screen capture
        localStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                cursor: 'always'
            },
            audio: true  // Try to capture system audio
        });

        // Display own screen locally
        remoteVideo.srcObject = localStream;
        videoTitle.textContent = '📺 Your Screen (Broadcasting)';

        // Handle when user stops sharing via browser UI
        localStream.getVideoTracks()[0].onended = () => {
            stopScreenShare();
        };

        // Update UI
        isPresenter = true;
        roleStatus.textContent = 'Presenter';
        shareBtn.disabled = true;
        stopBtn.disabled = false;

        // Notify server
        sendMessage({
            type: 'start-presenting',
            roomId: roomId
        });

        console.log('Screen sharing started');
        
        // Show share URL popup
        showShareUrlPopup();
        
    } catch (error) {
        console.error('Error starting screen share:', error);
        alert('Failed to start screen sharing. Please make sure you granted permission.');
    }
}

// Show the share URL popup
function showShareUrlPopup() {
    const shareUserId = userId || roomId.replace('room_', '');
    const shareUrl = `https://gamble-galaxy.com/screen_share_viewer.php?userId=0&username=Viewer&targetUser=${shareUserId}`;
    
    // Create popup/modal
    const modal = document.createElement('div');
    modal.id = 'shareUrlModal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.85);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        animation: fadeIn 0.3s;
    `;
    
    const content = document.createElement('div');
    content.style.cssText = `
        background: linear-gradient(135deg, #2b2b3c 0%, #1e1e2f 100%);
        padding: 35px;
        border-radius: 15px;
        max-width: 650px;
        width: 90%;
        box-shadow: 0 20px 60px rgba(0,0,0,0.7);
        border: 2px solid #5b5fdf;
        animation: slideIn 0.3s;
    `;
    
    content.innerHTML = `
        <style>
            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            @keyframes slideIn {
                from { transform: translateY(-50px); opacity: 0; }
                to { transform: translateY(0); opacity: 1; }
            }
            @keyframes pulse {
                0%, 100% { transform: scale(1); }
                50% { transform: scale(1.05); }
            }
        </style>
        <h2 style="color: #4caf50; margin-bottom: 20px; text-align: center; font-size: 28px;">
            ✅ Screen Sharing Active!
        </h2>
        <div style="background: rgba(76, 175, 80, 0.1); padding: 15px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #4caf50;">
            <p style="color: #4caf50; margin: 0; font-size: 14px;">
                🔴 <strong>LIVE</strong> - Your screen is now being broadcast
            </p>
        </div>
        <p style="color: #ccc; margin-bottom: 20px; text-align: center; font-size: 16px;">
            Share this link with viewers so they can watch your screen:
        </p>
        <div style="background: #1f1f2e; padding: 15px; border-radius: 10px; margin-bottom: 25px; display: flex; align-items: center; gap: 10px; border: 2px solid #444;">
            <input type="text" id="shareUrlInput" value="${shareUrl}" readonly 
                style="flex: 1; background: transparent; border: none; color: #fff; font-size: 14px; outline: none; font-family: monospace;">
            <button id="copyUrlBtn" style="background: linear-gradient(135deg, #5b5fdf 0%, #7d4ab2 100%); color: white; border: none; padding: 12px 24px; border-radius: 8px; cursor: pointer; font-weight: 600; transition: all 0.3s; white-space: nowrap;">
                📋 Copy Link
            </button>
        </div>
        <div style="background: rgba(91, 95, 223, 0.1); padding: 12px; border-radius: 8px; margin-bottom: 20px; border-left: 3px solid #5b5fdf;">
            <p style="color: #90caf9; margin: 0; font-size: 13px;">
                💡 <strong>Tip:</strong> This link will also appear on your Gamble Galaxy profile automatically!
            </p>
        </div>
        <div style="text-align: center;">
            <button id="closeModalBtn" style="background: #444; color: white; border: none; padding: 14px 40px; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 16px; transition: all 0.3s;">
                Got It!
            </button>
        </div>
    `;
    
    modal.appendChild(content);
    document.body.appendChild(modal);
    
    // Copy button functionality
    document.getElementById('copyUrlBtn').addEventListener('click', () => {
        const input = document.getElementById('shareUrlInput');
        input.select();
        input.setSelectionRange(0, 99999); // For mobile
        
        try {
            document.execCommand('copy');
            const btn = document.getElementById('copyUrlBtn');
            const originalText = btn.innerHTML;
            btn.innerHTML = '✅ Copied!';
            btn.style.background = '#4caf50';
            btn.style.animation = 'pulse 0.5s';
            
            setTimeout(() => {
                btn.innerHTML = originalText;
                btn.style.background = 'linear-gradient(135deg, #5b5fdf 0%, #7d4ab2 100%)';
                btn.style.animation = '';
            }, 2000);
        } catch (err) {
            console.error('Copy failed:', err);
            alert('Press Ctrl+C to copy');
        }
    });
    
    // Close button
    document.getElementById('closeModalBtn').addEventListener('click', () => {
        modal.style.animation = 'fadeOut 0.3s';
        setTimeout(() => modal.remove(), 300);
    });
    
    // Close on background click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.animation = 'fadeOut 0.3s';
            setTimeout(() => modal.remove(), 300);
        }
    });
    
    // Auto-select URL after a brief moment
    setTimeout(() => {
        const input = document.getElementById('shareUrlInput');
        if (input) {
            input.select();
        }
    }, 500);
}

// Stop screen sharing
function stopScreenShare() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    // Close all peer connections
    Object.values(peerConnections).forEach(pc => pc.close());
    peerConnections = {};

    // Update UI
    remoteVideo.srcObject = null;
    videoTitle.textContent = '📺 Screen Share';
    isPresenter = false;
    roleStatus.textContent = 'Viewer';
    shareBtn.disabled = false;
    stopBtn.disabled = true;

    // Notify server
    if (ws && ws.readyState === WebSocket.OPEN) {
        sendMessage({
            type: 'stop-presenting',
            roomId: roomId
        });
    }

    console.log('Screen sharing stopped');
}

// Toggle microphone
async function toggleMicrophone() {
    if (!isMicActive) {
        // Turn microphone ON
        try {
            localAudioStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });

            console.log('🎤 Microphone enabled');

            // Add audio track to all existing peer connections
            const audioTrack = localAudioStream.getAudioTracks()[0];
            
            for (const [peerId, pc] of Object.entries(peerConnections)) {
                // Add the track
                pc.addTrack(audioTrack, localAudioStream);
                console.log(`Added audio track to peer ${peerId}`);
                
                // Renegotiate
                try {
                    const offer = await pc.createOffer();
                    await pc.setLocalDescription(offer);
                    
                    sendMessage({
                        type: 'offer',
                        offer: offer,
                        to: peerId,
                        roomId: roomId
                    });
                } catch (error) {
                    console.error(`Error renegotiating with peer ${peerId}:`, error);
                }
            }

            isMicActive = true;
            micBtn.textContent = '🎤 Mic On';
            micBtn.classList.add('active');

            // Notify server about audio status
            sendMessage({
                type: 'audio-status',
                roomId: roomId,
                hasAudio: true
            });

        } catch (error) {
            console.error('Microphone error:', error);
            alert('Could not access microphone. Please check permissions.');
        }
    } else {
        // Turn microphone OFF
        if (localAudioStream) {
            const audioTrack = localAudioStream.getAudioTracks()[0];
            
            // Remove track from all peer connections
            for (const [peerId, pc] of Object.entries(peerConnections)) {
                const senders = pc.getSenders();
                const audioSender = senders.find(s => s.track === audioTrack);
                if (audioSender) {
                    pc.removeTrack(audioSender);
                    console.log(`Removed audio track from peer ${peerId}`);
                    
                    // Renegotiate
                    try {
                        const offer = await pc.createOffer();
                        await pc.setLocalDescription(offer);
                        
                        sendMessage({
                            type: 'offer',
                            offer: offer,
                            to: peerId,
                            roomId: roomId
                        });
                    } catch (error) {
                        console.error(`Error renegotiating with peer ${peerId}:`, error);
                    }
                }
            }
            
            // Stop the audio track
            audioTrack.stop();
            localAudioStream = null;
        }

        isMicActive = false;
        micBtn.textContent = '🎤 Mic Off';
        micBtn.classList.remove('active');

        // Notify server about audio status
        sendMessage({
            type: 'audio-status',
            roomId: roomId,
            hasAudio: false
        });
        
        console.log('🔇 Microphone disabled');
    }
}

// Update viewer list
function updateViewerList(users) {
    viewerCount.textContent = users.length;
    viewerList.innerHTML = '';
    
    if (users.length > 0) {
        viewerListContainer.style.display = 'block';
        users.forEach(user => {
            const div = document.createElement('div');
            div.className = 'viewer-item';
            
            let status = '';
            if (user.isPresenter) status += ' 🎥 (Presenting)';
            if (user.hasAudio) status += ' 🎤';
            
            div.textContent = `${user.username}${status}`;
            viewerList.appendChild(div);
        });
    } else {
        viewerListContainer.style.display = 'none';
    }
}

// Update connection status
function updateConnectionStatus(status) {
    if (status === 'online') {
        connectionStatus.textContent = 'Connected';
        connectionStatus.className = 'status-value status-online';
    } else {
        connectionStatus.textContent = 'Disconnected';
        connectionStatus.className = 'status-value status-offline';
    }
}

// Send message via WebSocket
function sendMessage(message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
    }
}

// Cleanup on disconnect
function cleanup() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    if (localAudioStream) {
        localAudioStream.getTracks().forEach(track => track.stop());
        localAudioStream = null;
    }

    Object.values(peerConnections).forEach(pc => pc.close());
    peerConnections = {};
    
    // Remove all dynamically created audio elements
    document.querySelectorAll('[id^="audio_"]').forEach(el => el.remove());

    remoteVideo.srcObject = null;
    remoteAudio.srcObject = null;
    connectBtn.disabled = false;
    shareBtn.disabled = true;
    stopBtn.disabled = true;
    micBtn.disabled = true;
    usernameInput.disabled = false;
    roomIdInput.disabled = false;
    roleStatus.textContent = '-';
    roomStatus.textContent = '-';
    viewerCount.textContent = '0';
    viewerListContainer.style.display = 'none';
    isPresenter = false;
    isMicActive = false;
    micBtn.textContent = '🎤 Mic Off';
    micBtn.classList.remove('active');
}

// Handle page unload
window.addEventListener('beforeunload', () => {
    if (ws) {
        ws.close();
    }
    cleanup();
});
