// --- Signaling Configuration ---

// --- WebRTC Configuration ---
const DEFAULT_ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    {
        urls: 'turn:openrelay.metered.ca:80',
        username: 'openrelayproject',
        credential: 'openrelayproject'
    },
    {
        urls: "turn:openrelay.metered.ca:443",
        username: "openrelayproject",
        credential: "openrelayproject",
    },
    {
        urls: "turn:openrelay.metered.ca:443?transport=tcp",
        username: "openrelayproject",
        credential: "openrelayproject",
    },
    {
        urls: "turns:openrelay.metered.ca:443?transport=tcp",
        username: "openrelayproject",
        credential: "openrelayproject",
    },
];
const servers = { iceServers: [...DEFAULT_ICE_SERVERS] };
const CHUNK_SIZE = 256 * 1024;
const BUFFERED_AMOUNT_LOW_THRESHOLD = 16 * 1024 * 1024;

const getBackendBaseUrl = () => {
    const configuredUrl = window.DIRECTDROP_CONFIG?.backendUrl?.trim();
    if (configuredUrl) {
        return configuredUrl.replace(/\/+$/, '');
    }
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        return 'http://localhost:8080';
    }
    return '';
};

const getSignalingBaseUrl = () => {
    const backendBaseUrl = getBackendBaseUrl();
    return backendBaseUrl || window.location.origin;
};

const waitForSocketConnection = (socket, timeoutMs = 10000) => new Promise((resolve, reject) => {
    if (socket.connected) {
        resolve();
        return;
    }

    const onConnect = () => {
        cleanup();
        resolve();
    };
    const onError = (error) => {
        cleanup();
        reject(error || new Error('Could not connect to signaling server.'));
    };
    const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Signaling connection timed out.'));
    }, timeoutMs);

    const cleanup = () => {
        clearTimeout(timer);
        socket.off('connect', onConnect);
        socket.off('connect_error', onError);
    };

    socket.on('connect', onConnect);
    socket.on('connect_error', onError);
});

const emitSignaling = (event, payload, timeoutMs = 10000) => new Promise((resolve, reject) => {
    if (!signalingSocket) {
        reject(new Error('Signaling socket is not initialized.'));
        return;
    }

    signalingSocket.timeout(timeoutMs).emit(event, payload, (error, response) => {
        if (error) {
            reject(error);
            return;
        }
        if (!response?.ok) {
            reject(new Error(response?.error || `Signaling event failed: ${event}`));
            return;
        }
        resolve(response);
    });
});

const bindSignalingHandlers = () => {
    if (!signalingSocket || signalingHandlersBound) return;
    signalingHandlersBound = true;

    signalingSocket.on("disconnect", (reason) => {
        console.warn("Signaling disconnected:", reason);
    });

    signalingSocket.on("room:closed", ({ roomId: closedRoomId, reason }) => {
        if (!roomId || closedRoomId !== roomId) return;
        if (!isHost && reason !== "p2p-established") {
            updateStatus(`Session closed by host (${reason || 'closed'}).`, 'error');
        }
    });

    signalingSocket.on("room:peer-left", ({ roomId: eventRoomId, peerId }) => {
        if (!isHost || eventRoomId !== roomId) return;
        cleanupConnection(peerId, { closePeerConnection: true });
    });

    signalingSocket.on("room:peer-offer", ({ roomId: eventRoomId, peerId, offer }) => {
        if (!isHost || eventRoomId !== roomId) return;
        handleNewPeer(peerId, { offer }).catch((error) => {
            console.error("Failed to process peer offer:", error);
        });
    });

    signalingSocket.on("host:peer-candidate", ({ roomId: eventRoomId, peerId, candidate }) => {
        if (!isHost || eventRoomId !== roomId) return;
        const connection = peerConnections.get(peerId);
        if (connection && connection.pc.connectionState !== "closed") {
            connection.pc.addIceCandidate(new RTCIceCandidate(candidate))
                .catch((error) => console.error("Failed to add peer candidate on host:", error));
            return;
        }
        const queued = pendingPeerCandidates.get(peerId) || [];
        queued.push(candidate);
        pendingPeerCandidates.set(peerId, queued);
    });

    signalingSocket.on("peer:host-candidate", ({ roomId: eventRoomId, peerId, candidate }) => {
        if (isHost || eventRoomId !== roomId || peerId !== localId) return;
        const hostConnection = peerConnections.get("host");
        if (hostConnection && hostConnection.pc.connectionState !== "closed") {
            hostConnection.pc.addIceCandidate(new RTCIceCandidate(candidate))
                .catch((error) => console.error("Failed to add host candidate on peer:", error));
            return;
        }
        const queued = pendingHostCandidates.get(peerId) || [];
        queued.push(candidate);
        pendingHostCandidates.set(peerId, queued);
    });

    signalingSocket.on("peer:answer", ({ roomId: eventRoomId, peerId, answer }) => {
        if (isHost || eventRoomId !== roomId || peerId !== localId) return;
        const hostConnection = peerConnections.get("host");
        if (hostConnection) {
            applyHostAnswer(hostConnection, answer).catch((error) => {
                console.error("Failed to apply host answer:", error);
                updateStatus("Incorrect room password or invalid host response.", "error");
                passwordPromptInput.value = "";
                passwordErrorText.classList.remove("hidden");
                passwordPromptContainer.classList.remove("hidden");
                cleanupConnection("host", { closePeerConnection: true });
            });
            return;
        }
        pendingAnswers.set(peerId, answer);
    });

    signalingSocket.on("peer:join-error", ({ roomId: eventRoomId, peerId, reason }) => {
        if (isHost || eventRoomId !== roomId || peerId !== localId) return;
        updateStatus(reason || "Host rejected this join request.", "error");
        passwordPromptInput.value = "";
        passwordErrorText.classList.remove("hidden");
        passwordErrorText.textContent = reason || "Incorrect password. Please try again.";
        passwordPromptContainer.classList.remove("hidden");
        cleanupConnection("host", { closePeerConnection: true });
    });
};

const ensureSignalingSocket = async () => {
    if (!window.io) {
        throw new Error('Socket.IO client is missing. Check index.html.');
    }

    if (!signalingSocket) {
        signalingSocket = window.io(getSignalingBaseUrl(), {
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionAttempts: 10,
            reconnectionDelay: 500,
            timeout: 10000
        });
        bindSignalingHandlers();
    }

    await waitForSocketConnection(signalingSocket);
    return signalingSocket;
};

const loadRuntimeConfig = async () => {
    const backendBaseUrl = getBackendBaseUrl();
    if (!backendBaseUrl) return;

    try {
        const response = await fetch(`${backendBaseUrl}/api/runtime-config`, {
            headers: { Accept: 'application/json' }
        });
        if (!response.ok) return;

        const runtimeConfig = await response.json();
        if (Array.isArray(runtimeConfig.iceServers) && runtimeConfig.iceServers.length > 0) {
            const mergedIceServers = [...runtimeConfig.iceServers, ...DEFAULT_ICE_SERVERS];
            const seen = new Set();
            servers.iceServers = mergedIceServers.filter((server) => {
                const key = JSON.stringify({
                    urls: server.urls,
                    username: server.username || '',
                    credential: server.credential || ''
                });
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        }
    } catch (error) {
        console.warn('Backend config unavailable, using default ICE servers.', error);
    }
};

const getRtcConfiguration = () => ({
    iceServers: [...servers.iceServers],
    iceCandidatePoolSize: 10,
    iceTransportPolicy: 'all'
});

// --- DOM Elements ---
const dropZone = document.getElementById('drop-zone');
const startScreen = document.getElementById('start-screen');
const shareScreen = document.getElementById('share-screen');
const createP2PBtn = document.getElementById('create-p2p-btn');
const createGroupBtn = document.getElementById('create-group-btn');
const roomPasswordInput = document.getElementById('room-password-input');
const shareLinkInput = document.getElementById('share-link');
const copyBtn = document.getElementById('copy-btn');
const qrCodeArea = document.getElementById('qr-code-area');
const qrCodeContainer = document.getElementById('qr-code-container');
const statusContainer = document.getElementById('status-container');
const statusText = document.getElementById('status-text');
const statusSpinner = document.getElementById('status-spinner');
const statusMessage = document.getElementById('status-message');
const participantsContainer = document.getElementById('participants-container');
const participantsList = document.getElementById('participants-list');
const chatContainer = document.getElementById('chat-container');
const chatLog = document.getElementById('chat-log');
const chatInput = document.getElementById('chat-input');
const chatSendBtn = document.getElementById('chat-send-btn');
const sharingModeContainer = document.getElementById('sharing-mode-container');
const showFilesBtn = document.getElementById('show-files-btn');
const showTextBtn = document.getElementById('show-text-btn');
const fileSelectionContainer = document.getElementById('file-selection-container');
const fileInputFiles = document.getElementById('file-input-files');
const fileInputFolder = document.getElementById('file-input-folder');
const selectFilesBtn = document.getElementById('select-files-btn');
const selectFolderBtn = document.getElementById('select-folder-btn');
const textSelectionContainer = document.getElementById('text-selection-container');
const textSnippetInput = document.getElementById('text-snippet-input');
const sendTextBtn = document.getElementById('send-text-btn');
const fileConfirmationContainer = document.getElementById('file-confirmation-container');
const fileInfoText = document.getElementById('file-info-text');
const sendBtn = document.getElementById('send-btn');
const cancelBtn = document.getElementById('cancel-btn');
const receivedFilesContainer = document.getElementById('received-files-container');
const receivedFilesList = document.getElementById('received-files-list');
const receivedTextContainer = document.getElementById('received-text-container');
const receivedTextList = document.getElementById('received-text-list');
const zipOptionContainer = document.getElementById('zip-option-container');
const zipCheckbox = document.getElementById('zip-folder-checkbox');
const sendingQueueContainer = document.getElementById('sending-queue-container');
const sendingQueueList = document.getElementById('sending-queue-list');
const recipientSelectionContainer = document.getElementById('recipient-selection-container');
const recipientSelect = document.getElementById('recipient-select');
const passwordPromptContainer = document.getElementById('password-prompt-container');
const passwordPromptInput = document.getElementById('password-prompt-input');
const passwordErrorText = document.getElementById('password-error-text');
const passwordPromptCancel = document.getElementById('password-prompt-cancel');
const passwordPromptSubmit = document.getElementById('password-prompt-submit');
const privacyNotice = document.getElementById('privacy-notice');
const installBtn = document.getElementById('install-btn');
const stopShareBtn = document.getElementById('stop-share-btn');
const roomIdText = document.getElementById('room-id-text');

// --- Global State ---
let peerConnections = new Map();
let receivingStates = new Map(); // Key: peerId, Value: { metadata, buffer, size }
let localId;
let isHost = false;
let filesToSend = [];
let currentFileIndex = 0;
let roomId;
let roomMode = 'p2p';
let roomPassword = null;
let deferredInstallPrompt = null;
let connectionHintTimer = null;
let signalingSocket = null;
let signalingHandlersBound = false;
const pendingPeerCandidates = new Map();
const pendingHostCandidates = new Map();
const pendingAnswers = new Map();

const scheduleConnectionHint = () => {
    if (connectionHintTimer) clearTimeout(connectionHintTimer);
    connectionHintTimer = setTimeout(() => {
        const hasConnectedPeer = Array.from(peerConnections.values())
            .some((conn) => conn.pc.connectionState === 'connected');
        if (!hasConnectedPeer) {
            updateStatus('Still connecting... open the exact shared link and disable VPN/ad blocker if needed.', 'progress');
        }
    }, 25000);
};

const clearConnectionHint = () => {
    if (connectionHintTimer) {
        clearTimeout(connectionHintTimer);
        connectionHintTimer = null;
    }
};

const countActivePeerConnections = () => Array.from(peerConnections.values()).filter((connection) => {
    const state = connection?.pc?.connectionState;
    return state === 'new' || state === 'connecting' || state === 'connected';
}).length;

const createId = () => {
    if (crypto?.randomUUID) return crypto.randomUUID().replace(/-/g, '');
    return `${Date.now()}${Math.random().toString(16).slice(2, 10)}`;
};

const cleanupConnection = (id, { closePeerConnection = false } = {}) => {
    const existing = peerConnections.get(id);
    if (!existing) return;

    if (existing.cleanupTimer) {
        clearTimeout(existing.cleanupTimer);
        existing.cleanupTimer = null;
    }

    if (existing.unsubscribe) {
        existing.unsubscribe();
        existing.unsubscribe = null;
    }

    if (closePeerConnection && existing.pc && existing.pc.connectionState !== 'closed') {
        existing.pc.close();
    }

    peerConnections.delete(id);
    updateParticipantsList();
};

// --- Crypto Helpers ---
async function deriveKey(password, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await window.crypto.subtle.importKey('raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveKey']);
    return window.crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, keyMaterial, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

async function encryptData(data, password) {
    const salt = window.crypto.getRandomValues(new Uint8Array(16));
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt);
    const encodedData = new TextEncoder().encode(JSON.stringify(data));
    const encryptedContent = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encodedData);
    const result = new Uint8Array(salt.length + iv.length + encryptedContent.byteLength);
    result.set(salt);
    result.set(iv, salt.length);
    result.set(new Uint8Array(encryptedContent), salt.length + iv.length);
    return btoa(String.fromCharCode.apply(null, result));
}

async function decryptData(encryptedBase64, password) {
    const encryptedBytes = new Uint8Array(atob(encryptedBase64).split('').map(c => c.charCodeAt(0)));
    const salt = encryptedBytes.slice(0, 16);
    const iv = encryptedBytes.slice(16, 28);
    const data = encryptedBytes.slice(28);
    const key = await deriveKey(password, salt);
    const decryptedContent = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return JSON.parse(new TextDecoder().decode(decryptedContent));
}

const applyHostAnswer = async (connection, answerPayload) => {
    if (!connection || !connection.pc || connection.pc.connectionState === 'closed') return;

    let answer = answerPayload;
    if (roomPassword) {
        answer = await decryptData(answerPayload, roomPassword);
    }

    if (!connection.pc.currentRemoteDescription) {
        await connection.pc.setRemoteDescription(new RTCSessionDescription(answer));
    }
};


// --- Core Logic ---
const initialize = async () => {
    await loadRuntimeConfig();
    localId = createId();
    const urlParams = new URLSearchParams(window.location.search);
    const rawRoomId = urlParams.get('id');
    roomId = rawRoomId ? decodeURIComponent(rawRoomId).trim() : null;
    if (roomId) {
        joinRoom(roomId);
    } else if (rawRoomId === '') {
        updateStatus('Invalid share link. Ask host to copy the full link.', 'error');
    }
    createP2PBtn.addEventListener('click', () => { roomMode = 'p2p'; createRoom(); });
    createGroupBtn.addEventListener('click', () => { roomMode = 'group'; createRoom(); });
    copyBtn.addEventListener('click', shareOrCopyLink);
    chatSendBtn.addEventListener('click', sendChatMessage);
    chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sendChatMessage(); } });
    selectFilesBtn.addEventListener('click', () => fileInputFiles.click());
    selectFolderBtn.addEventListener('click', () => fileInputFolder.click());
    fileInputFiles.addEventListener('change', handleFileSelect);
    fileInputFolder.addEventListener('change', handleFileSelect);
    sendBtn.addEventListener('click', startSendingFiles);
    cancelBtn.addEventListener('click', cancelFileSelection);
    showFilesBtn.addEventListener('click', showFileSharingView);
    showTextBtn.addEventListener('click', showTextSharingView);
    sendTextBtn.addEventListener('click', sendTextSnippet);
    dropZone.addEventListener('dragover', handleDragOver);
    dropZone.addEventListener('dragleave', handleDragLeave);
    dropZone.addEventListener('drop', handleDrop);
    stopShareBtn.addEventListener('click', stopSharing);

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch((error) => {
            console.warn('Service worker registration failed:', error);
        });
    }

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredInstallPrompt = e;
        installBtn.classList.remove('hidden');
    });

    installBtn.addEventListener('click', async () => {
        if (deferredInstallPrompt) {
            deferredInstallPrompt.prompt();
            const { outcome } = await deferredInstallPrompt.userChoice;
            console.log(`User response to the install prompt: ${outcome}`);
            deferredInstallPrompt = null;
            installBtn.classList.add('hidden');
        }
    });

    window.addEventListener('appinstalled', () => {
        deferredInstallPrompt = null;
        installBtn.classList.add('hidden');
        console.log('PWA was installed');
    });
    window.addEventListener('beforeunload', () => {
        if (!signalingSocket || !roomId) return;
        if (isHost) {
            signalingSocket.emit('host:close-room', { roomId, reason: 'host-page-unload' });
        } else {
            signalingSocket.emit('peer:leave-room', { roomId, peerId: localId });
        }
    });
};

const handleNewPeer = async (peerId, peerPayload) => {
    if (peerConnections.has(peerId) || peerId === localId) return;

    if (roomMode === 'p2p' && countActivePeerConnections() >= 1) {
        await emitSignaling('host:reject-peer', {
            roomId,
            peerId,
            reason: 'Room already has an active peer.'
        }).catch((error) => {
            console.error('Failed to reject extra peer in P2P room:', error);
        });
        return;
    }

    console.log(`New peer detected: ${peerId}`);
    const pc = new RTCPeerConnection(getRtcConfiguration());
    const connection = { pc, dc: null, name: `Peer ${peerId.substring(0, 4)}`, unsubscribe: null, cleanupTimer: null };
    peerConnections.set(peerId, connection);
    updateParticipantsList();

    let peerOffer = peerPayload.offer;
    if (roomPassword) {
        try {
            peerOffer = await decryptData(peerOffer, roomPassword);
        } catch (error) {
            console.error('Failed to decrypt peer offer:', error);
            await emitSignaling('host:reject-peer', {
                roomId,
                peerId,
                reason: 'Incorrect room password. Please retry.'
            }).catch((emitError) => {
                console.error('Failed to notify peer about password mismatch:', emitError);
            });
            cleanupConnection(peerId, { closePeerConnection: true });
            return;
        }
    }

    pc.onicecandidate = async (event) => {
        if (!event.candidate) return;
        try {
            await emitSignaling('host:ice-candidate', {
                roomId,
                peerId,
                candidate: event.candidate.toJSON()
            });
        } catch (error) {
            console.error('Failed to publish host ICE candidate:', error);
        }
    };

    pc.ondatachannel = (event) => {
        const currentConnection = peerConnections.get(peerId);
        if (currentConnection) {
            currentConnection.dc = event.channel;
            setupDataChannel(peerId, currentConnection);
        }
    };

    await pc.setRemoteDescription(new RTCSessionDescription(peerOffer));

    const queuedCandidates = pendingPeerCandidates.get(peerId) || [];
    pendingPeerCandidates.delete(peerId);
    queuedCandidates.forEach((candidate) => {
        pc.addIceCandidate(new RTCIceCandidate(candidate))
            .catch((error) => console.error('Failed to flush queued peer candidate:', error));
    });

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    let answerToSend = { sdp: answer.sdp, type: answer.type };
    if (roomPassword) {
        answerToSend = await encryptData(answerToSend, roomPassword);
    }
    await emitSignaling('host:answer', { roomId, peerId, answer: answerToSend });
};

const createRoom = async () => {
    isHost = true;
    if (roomMode === 'group') {
        roomPassword = roomPasswordInput.value || null;
    } else {
        roomPassword = null;
    }

    startScreen.classList.add('hidden');
    shareScreen.classList.remove('hidden');
    sharingModeContainer.classList.add('hidden');

    if (roomMode === 'group') participantsContainer.classList.remove('hidden');
    updateParticipantsList();
    updateStatus('Waiting for peer(s) to connect...', 'waiting');
    scheduleConnectionHint();

    try {
        await ensureSignalingSocket();

        roomId = createId();
        await emitSignaling('host:create-room', {
            roomId,
            mode: roomMode,
            hasPassword: Boolean(roomPassword)
        });

        const shareLink = `${window.location.origin}${window.location.pathname}?id=${encodeURIComponent(roomId)}`;
        shareLinkInput.value = shareLink;
        roomIdText.textContent = `Room ID: ${roomId}`;
        roomIdText.classList.remove('hidden');
        qrCodeContainer.innerHTML = '';
        new QRCode(qrCodeContainer, {
            text: shareLink,
            width: 144,
            height: 144,
            colorDark: '#000000',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.H
        });

        if (roomMode === 'p2p') {
            privacyNotice.textContent = 'For your privacy, the connection server for this room will self-destruct after your peer connects.';
        } else {
            privacyNotice.textContent = 'For your privacy, this group room will self-destruct after 1 hour.';
        }
        privacyNotice.classList.remove('hidden');
    } catch (error) {
        console.error('Error creating room:', error);
        clearConnectionHint();
        updateStatus('Error: Could not create a share link.', 'error');
    }
};

const joinRoom = async (roomId) => {
    if (!roomId || roomId.length < 8) {
        updateStatus('Invalid room link. Ask host to share the exact link or QR.', 'error');
        return;
    }

    isHost = false;
    startScreen.classList.add('hidden');
    shareScreen.classList.remove('hidden');
    qrCodeArea.classList.add('hidden');
    sharingModeContainer.classList.add('hidden');
    updateStatus('Connecting...', 'progress');
    scheduleConnectionHint();

    try {
        await ensureSignalingSocket();

        const roomInfo = await emitSignaling('room:get-info', { roomId });
        roomMode = roomInfo.mode || 'p2p';
        const hasPassword = Boolean(roomInfo.hasPassword);

        if (roomMode === 'p2p') {
            privacyNotice.textContent = 'For your privacy, the connection server for this room self-destructs after you connect.';
        } else {
            privacyNotice.textContent = 'For your privacy, this group room will self-destruct after 1 hour.';
        }
        privacyNotice.classList.remove('hidden');

        if (roomMode === 'group') participantsContainer.classList.remove('hidden');

        if (hasPassword) {
            passwordPromptContainer.classList.remove('hidden');
            passwordErrorText.classList.add('hidden');
            passwordErrorText.textContent = 'Incorrect password. Please try again.';
            passwordPromptCancel.onclick = () => {
                window.location.href = window.location.pathname;
            };
            passwordPromptSubmit.onclick = async () => {
                roomPassword = passwordPromptInput.value;
                if (!roomPassword || !roomPassword.trim()) {
                    passwordErrorText.textContent = 'Password is required.';
                    passwordErrorText.classList.remove('hidden');
                    return;
                }
                passwordErrorText.classList.add('hidden');
                passwordPromptContainer.classList.add('hidden');
                try {
                    await proceedWithJoin(roomId);
                } catch (error) {
                    console.error('Error joining password-protected room:', error);
                    updateStatus('Error: Could not connect to host. Please try again.', 'error');
                    passwordPromptContainer.classList.remove('hidden');
                }
            };
        } else {
            roomPassword = null;
            await proceedWithJoin(roomId);
        }
    } catch (error) {
        console.error('Error joining room:', error);
        clearConnectionHint();
        updateStatus('Error: Could not join session.', 'error');
    }
};

const proceedWithJoin = async (roomId) => {
    const pc = new RTCPeerConnection(getRtcConfiguration());
    const connection = { pc, dc: null, name: 'Host', unsubscribe: null, cleanupTimer: null };
    peerConnections.set('host', connection);

    pc.onicecandidate = async (event) => {
        if (!event.candidate) return;
        try {
            await emitSignaling('peer:ice-candidate', {
                roomId,
                peerId: localId,
                candidate: event.candidate.toJSON()
            });
        } catch (error) {
            console.error('Failed to publish peer ICE candidate:', error);
        }
    };

    const dc = pc.createDataChannel('file-transfer');
    connection.dc = dc;
    setupDataChannel('host', connection);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    let offerToSend = { sdp: offer.sdp, type: offer.type };
    if (roomPassword) {
        offerToSend = await encryptData(offerToSend, roomPassword);
    }

    await emitSignaling('peer:join-room', {
        roomId,
        peerId: localId,
        offer: offerToSend
    });

    const queuedCandidates = pendingHostCandidates.get(localId) || [];
    pendingHostCandidates.delete(localId);
    queuedCandidates.forEach((candidate) => {
        pc.addIceCandidate(new RTCIceCandidate(candidate))
            .catch((error) => console.error('Failed to flush queued host candidate:', error));
    });

    if (pendingAnswers.has(localId)) {
        const pendingAnswer = pendingAnswers.get(localId);
        pendingAnswers.delete(localId);
        await applyHostAnswer(connection, pendingAnswer);
    }
};

const setupDataChannel = (id, connection) => {
    connection.pc.onconnectionstatechange = () => {
        const state = connection.pc.connectionState;
        console.log(`Connection state with ${id} changed to: ${state}`);

        if (state === 'connected') {
            if (connection.cleanupTimer) {
                clearTimeout(connection.cleanupTimer);
                connection.cleanupTimer = null;
            }
        }

        if (state === 'connected' && !isHost) {
            updateStatus(`Connected to ${roomMode === 'p2p' ? 'peer' : 'host'}!`, 'connected');
        }
        if (state === 'failed' || state === 'closed') {
            clearConnectionHint();
            updateStatus('Connection failed. Refresh both devices and try again.', 'error');
            cleanupConnection(id);
        }
        if (state === 'disconnected') {
            if (connection.cleanupTimer) clearTimeout(connection.cleanupTimer);
            connection.cleanupTimer = setTimeout(() => {
                const current = peerConnections.get(id);
                if (current && current.pc.connectionState === 'disconnected') {
                    console.warn(`Cleaning up stalled connection: ${id}`);
                    cleanupConnection(id, { closePeerConnection: true });
                }
            }, 10000);
        }
        updateParticipantsList();
    };

    connection.pc.oniceconnectionstatechange = () => {
        const iceState = connection.pc.iceConnectionState;
        console.log(`ICE state with ${id}: ${iceState}`);
        if (iceState === 'checking') {
            updateStatus('Establishing secure peer connection...', 'progress');
        }
        if (iceState === 'failed') {
            clearConnectionHint();
            updateStatus('Could not establish network route between devices.', 'error');
            cleanupConnection(id, { closePeerConnection: true });
        }
    };

    connection.pc.onicecandidateerror = (event) => {
        console.warn(`ICE candidate error with ${id}:`, event.errorText || event);
    };
    
    connection.dc.onopen = () => {
        console.log(`Data channel with ${id} opened.`);
        clearConnectionHint();
        chatContainer.classList.remove('hidden');
        updateParticipantsList();
        if (isHost) {
            sharingModeContainer.classList.remove('hidden');
            showFileSharingView();
        }

        if (roomMode === 'p2p' && isHost) {
            qrCodeArea.classList.add('hidden');
            console.log('P2P connection established. Closing signaling room.');
            emitSignaling('host:close-room', { roomId, reason: 'p2p-established' })
                .catch((error) => console.warn('Failed to close signaling room:', error));
            updateStatus('Connected to peer! Signaling server disconnected for privacy.', 'connected');
        }
    };
    connection.dc.onclose = () => {
        console.log(`Data channel with ${id} closed.`);
        cleanupConnection(id);
         if (roomMode === 'p2p' && isHost) {
            qrCodeArea.classList.remove('hidden');
        }
    };
    connection.dc.onmessage = (event) => handleDataChannelMessage(event, id);
};

const handleFileSelect = (event) => {
    const fileList = event.target.files;
    if (!fileList || fileList.length === 0) return;

    if (isHost && peerConnections.size === 0) {
        updateStatus('Select files after a peer has connected.', 'error');
        fileInputFiles.value = null;
        fileInputFolder.value = null; 
        return;
    }

    zipOptionContainer.classList.add('hidden');
    recipientSelectionContainer.classList.add('hidden');

    if (fileList[0].webkitRelativePath) {
        const folderName = fileList[0].webkitRelativePath.split('/')[0];
        filesToSend = Array.from(fileList);
        const totalSize = filesToSend.reduce((acc, file) => acc + file.size, 0);
        fileInfoText.textContent = `Folder: ${folderName} (${filesToSend.length} files, ${formatBytes(totalSize)})`;
        
        zipOptionContainer.classList.remove('hidden');
        zipCheckbox.checked = true;
    } else {
        filesToSend = Array.from(fileList);
        const totalSize = filesToSend.reduce((acc, file) => acc + file.size, 0);
        fileInfoText.textContent = `${filesToSend.length} files selected (${formatBytes(totalSize)})`;
    }
    
    if (isHost && roomMode === 'group' && peerConnections.size > 0) {
        recipientSelect.innerHTML = '<option value="broadcast">Broadcast to Everyone</option>';
        for (const [peerId, connection] of peerConnections.entries()) {
            const option = document.createElement('option');
            option.value = peerId;
            option.textContent = connection.name;
            recipientSelect.appendChild(option);
        }
        recipientSelectionContainer.classList.remove('hidden');
    }
    
    sendBtn.textContent = (roomMode === 'group' && recipientSelect.value === 'broadcast') ? 'Broadcast' : 'Send';
    fileSelectionContainer.classList.add('hidden');
    fileConfirmationContainer.classList.remove('hidden');
};

const startSendingFiles = async () => {
    if (zipCheckbox.offsetParent !== null && zipCheckbox.checked) {
        updateStatus('Zipping folder...', 'progress');
        try {
            const folderName = filesToSend[0].webkitRelativePath.split('/')[0];
            const zip = new JSZip();
            filesToSend.forEach(file => zip.file(file.webkitRelativePath, file));
            const zipBlob = await zip.generateAsync({ type: "blob" });
            filesToSend = [new File([zipBlob], `${folderName}.zip`, { type: "application/zip" })];
        } catch(err) {
            console.error("Error zipping folder: ", err);
            updateStatus('Error zipping folder.', 'error');
            return;
        }
    }

    sendingQueueList.innerHTML = '';
    filesToSend.forEach((file, index) => {
        const queueItem = document.createElement('div');
        queueItem.innerHTML = `<div id="queue-item-${index}" class="p-2 bg-gray-700 rounded-lg"><div class="flex items-center justify-between"><div><p class="text-sm font-semibold truncate">${file.name}</p><p class="text-xs text-gray-400">${formatBytes(file.size)}</p></div><div id="queue-status-${index}" class="text-xs text-gray-400 font-semibold">Queued</div></div><div id="queue-progress-container-${index}" class="hidden w-full bg-gray-900 rounded-full h-1.5 mt-1"><div id="queue-progress-bar-${index}" class="bg-indigo-500 h-1.5 rounded-full" style="width: 0%"></div></div></div>`;
        sendingQueueList.appendChild(queueItem);
    });
    currentFileIndex = 0;
    fileConfirmationContainer.classList.add('hidden');
    sendingQueueContainer.classList.remove('hidden');
    
    const targetPeerId = (roomMode === 'p2p') ? peerConnections.keys().next().value : recipientSelect.value;
    sendNextFile(targetPeerId);
};

const sendToTarget = (targetPeerId, data, excludePeerId = null) => {
    if (targetPeerId === 'broadcast') {
        broadcastToPeers(data, excludePeerId);
    } else {
        const connection = peerConnections.get(targetPeerId);
        if (connection && connection.dc && connection.dc.readyState === 'open') {
            connection.dc.send(data);
        }
    }
};

const broadcastToPeers = (data, excludePeerId = null) => {
    for (const [peerId, connection] of peerConnections.entries()) {
        if (peerId !== excludePeerId && connection.dc && connection.dc.readyState === 'open') {
            connection.dc.send(data);
        }
    }
};

const sendNextFile = (targetPeerId) => {
    if (currentFileIndex >= filesToSend.length) {
        updateStatus('Send complete.', 'connected');
        return;
    }
    const statusEl = document.getElementById(`queue-status-${currentFileIndex}`);
    const progressContainerEl = document.getElementById(`queue-progress-container-${currentFileIndex}`);
    if(statusEl) statusEl.textContent = 'Sending...';
    if(progressContainerEl) progressContainerEl.classList.remove('hidden');
    
    const file = filesToSend[currentFileIndex];
    const fileMetadata = { name: file.name, size: file.size, type: file.type };
    const statusMessage = (targetPeerId === 'broadcast' || roomMode === 'group') ? 'Broadcasting' : 'Sending';
    updateStatus(`${statusMessage} ${currentFileIndex + 1}/${filesToSend.length}: ${file.name}`, 'progress');
    sendToTarget(targetPeerId, JSON.stringify({ type: 'metadata', payload: fileMetadata }));
    
    let offset = 0;
    const fileReader = new FileReader();
    
    const checkAndRead = () => {
        let allReady = false;
        const targets = (targetPeerId === 'broadcast') ? Array.from(peerConnections.values()) : [peerConnections.get(targetPeerId)];
        allReady = targets.every(c => c && c.dc && c.dc.bufferedAmount < BUFFERED_AMOUNT_LOW_THRESHOLD);
        if(allReady) readNextChunk();
    };
    
    const readNextChunk = () => {
        const slice = file.slice(offset, offset + CHUNK_SIZE);
        fileReader.readAsArrayBuffer(slice);
    };
    
    fileReader.onload = () => {
        sendToTarget(targetPeerId, fileReader.result);
        offset += fileReader.result.byteLength;
        updateProgressBar(offset, file.size, currentFileIndex);
        if (offset < file.size) {
            checkAndRead();
        } else {
            const doneStatusEl = document.getElementById(`queue-status-${currentFileIndex}`);
            if(doneStatusEl) doneStatusEl.textContent = 'Done ✓';
            currentFileIndex++;
            sendNextFile(targetPeerId);
        }
    };

    const connectionsToCheck = (targetPeerId === 'broadcast') ? Array.from(peerConnections.values()) : [peerConnections.get(targetPeerId)];
    for (const connection of connectionsToCheck) {
        if (connection && connection.dc) {
            connection.dc.onbufferedamountlow = () => {
                if (offset < file.size) checkAndRead();
            };
        }
    }
    checkAndRead();
};

const handleDataChannelMessage = async (event, senderId) => {
    let data = event.data;
    if (typeof data === 'string') {
        try {
            let parsedData = JSON.parse(data);
            if (parsedData.type) {
                if (roomPassword && parsedData.encrypted) {
                    parsedData.payload = await decryptData(parsedData.payload, roomPassword);
                }
                if (parsedData.type === 'chat') {
                    if (isHost) broadcastToPeers(JSON.stringify(parsedData), senderId);
                    appendChatMessage(parsedData.payload, 'received', parsedData.sender);
                } else if (parsedData.type === 'metadata') {
                   receivingStates.set(senderId, {
                        metadata: parsedData.payload,
                        buffer: [],
                        size: 0
                    });
                    updateStatus(`Receiving file: ${parsedData.payload.name}`, 'progress');
                } else if (parsedData.type === 'text-snippet') {
                    if (isHost) broadcastToPeers(JSON.stringify(parsedData), senderId);
                    displayReceivedText(parsedData.payload, parsedData.sender);
                }
                return;
            }
        } catch(e) { /* Not a JSON control message */ }
    }
    
    const state = receivingStates.get(senderId);
    if (!state) return; // Ignore chunk if we have no metadata for it

    state.buffer.push(data);
    state.size += (data instanceof ArrayBuffer) ? data.byteLength : data.size;

    if (state.metadata && state.size === state.metadata.size) {
        const receivedFile = new Blob(state.buffer, { type: state.metadata.type });
        
        const receivedItem = document.createElement('div');
        receivedItem.className = 'w-full bg-gray-700 p-2 rounded-lg text-sm flex items-center justify-between';
        
        const fileInfo = document.createElement('div');
        fileInfo.innerHTML = `<p class="font-semibold truncate">${state.metadata.name}</p><p class="text-xs text-gray-400">${formatBytes(state.metadata.size)}</p>`;
        
        const downloadButton = document.createElement('button');
        downloadButton.textContent = 'Download';
        downloadButton.className = 'bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-1 px-3 rounded-md text-xs';
        downloadButton.onclick = () => {
            const link = document.createElement('a');
            link.href = URL.createObjectURL(receivedFile);
            link.download = state.metadata.name;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);
            downloadButton.textContent = 'Downloaded!';
            downloadButton.disabled = true;
            downloadButton.classList.remove('bg-emerald-600', 'hover:bg-emerald-700');
            downloadButton.classList.add('bg-gray-500', 'cursor-not-allowed');
        };

        receivedItem.appendChild(fileInfo);
        receivedItem.appendChild(downloadButton);
        receivedFilesList.appendChild(receivedItem);

        receivedFilesContainer.classList.remove('hidden');
        updateStatus(`File "${state.metadata.name}" received.`, 'connected');

        // Clean up the state for this completed transfer
        receivingStates.delete(senderId);
    }
};

const sendChatMessage = async () => {
    const message = chatInput.value;
    if (!message.trim()) return;
    const senderName = isHost ? 'Host' : `Peer ${localId.substring(0, 4)}`;
    let chatPayload = { type: 'chat', payload: message, sender: senderName };

    if (roomPassword) {
        chatPayload.payload = await encryptData(message, roomPassword);
        chatPayload.encrypted = true;
    }

    const payloadString = JSON.stringify(chatPayload);

    if (isHost) {
        broadcastToPeers(payloadString);
    } else {
        const hostConnection = peerConnections.get('host');
        if (hostConnection && hostConnection.dc && hostConnection.dc.readyState === 'open') {
            hostConnection.dc.send(payloadString);
        }
    }
    appendChatMessage(message, 'sent');
    chatInput.value = '';
    chatInput.focus();
};

const sendTextSnippet = async () => {
    const text = textSnippetInput.value;
    if (!text.trim()) return;

    const senderName = isHost ? 'Host' : `Peer ${localId.substring(0, 4)}`;
    let textPayload = { type: 'text-snippet', payload: text, sender: senderName };

    if (roomPassword) {
        textPayload.payload = await encryptData(text, roomPassword);
        textPayload.encrypted = true;
    }

    const payloadString = JSON.stringify(textPayload);
    const targetPeerId = (roomMode === 'p2p') ? peerConnections.keys().next().value : 'broadcast';
    
    sendToTarget(targetPeerId, payloadString);

    updateStatus(`Text snippet sent.`, 'connected');
    textSnippetInput.value = '';
};

const displayReceivedText = (text, sender) => {
    receivedTextContainer.classList.remove('hidden');
    const snippetEl = document.createElement('div');
    snippetEl.className = 'bg-gray-700 rounded-lg p-3 space-y-2';
    
    const textContent = document.createElement('pre');
    textContent.textContent = text;
    textContent.className = 'text-sm text-white whitespace-pre-wrap break-words';
    
    const fromText = document.createElement('p');
    fromText.textContent = `From: ${sender}`;
    fromText.className = 'text-xs text-gray-400';
    
    const copyButton = document.createElement('button');
    copyButton.textContent = 'Copy Text';
    copyButton.className = 'w-full text-xs bg-blue-600 hover:bg-blue-700 text-white font-bold py-1 px-2 rounded-md';
    copyButton.onclick = () => {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.top = '-9999px';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
            document.execCommand('copy');
            copyButton.textContent = 'Copied!';
        } catch (err) {
            console.error('Failed to copy text: ', err);
            copyButton.textContent = 'Copy Failed';
        }
        document.body.removeChild(textArea);
        setTimeout(() => copyButton.textContent = 'Copy Text', 2000);
    };
    
    snippetEl.appendChild(fromText);
    snippetEl.appendChild(textContent);
    snippetEl.appendChild(copyButton);
    receivedTextList.appendChild(snippetEl);
};

const appendChatMessage = (message, type, sender = 'You') => {
    const messageEl = document.createElement('p');
    const prefix = type === 'sent' ? 'You: ' : `${sender}: `;
    messageEl.textContent = prefix + message;
    messageEl.className = type === 'sent' ? 'text-right text-indigo-300' : 'text-left text-emerald-300';
    chatLog.appendChild(messageEl);
    chatLog.scrollTop = chatLog.scrollHeight;
};

const updateParticipantsList = () => {
    participantsList.innerHTML = '';
    if (isHost) {
         const hostEl = document.createElement('div');
         hostEl.className = 'p-2 bg-gray-700 rounded-lg text-sm font-semibold flex justify-between items-center';
         hostEl.innerHTML = `<span>You (Host)</span> <span class="text-xs text-green-400">Connected</span>`;
         participantsList.appendChild(hostEl);
    }
    for (const [peerId, connection] of peerConnections.entries()) {
        const peerEl = document.createElement('div');
        const state = connection.pc.connectionState;
        const statusColor = state === 'connected' ? 'text-green-400' : 'text-yellow-400';
        peerEl.className = 'p-2 bg-gray-700 rounded-lg text-sm font-semibold flex justify-between items-center';
        peerEl.innerHTML = `<span>${connection.name}</span> <span class="text-xs ${statusColor}">${state}</span>`;
        participantsList.appendChild(peerEl);
    }
};

const cancelFileSelection = () => {
    filesToSend = [];
    currentFileIndex = 0;
    fileInputFiles.value = null;
    fileInputFolder.value = null;
    zipOptionContainer.classList.add('hidden');
    recipientSelectionContainer.classList.add('hidden');
    fileConfirmationContainer.classList.add('hidden');
    sendingQueueContainer.classList.add('hidden');
    sendingQueueList.innerHTML = '';
    showFileSharingView();
};

const shareOrCopyLink = async () => {
    const urlToShare = shareLinkInput.value;
    if (navigator.share) {
        try {
            await navigator.share({ title: 'DirectDrop File Share', text: 'Join my secure file transfer session:', url: urlToShare });
            copyBtn.textContent = 'Shared!';
            setTimeout(() => { copyBtn.textContent = 'Share'; }, 2000);
        } catch (error) {
            if (error.name !== 'AbortError') { // Don't show error if user cancels share dialog
                console.warn('Share API failed, falling back to copy.', error);
                copyToClipboard();
            }
        }
    } else {
        copyToClipboard();
    }
};

const copyToClipboard = () => {
    shareLinkInput.select();
    shareLinkInput.setSelectionRange(0, 99999); // For mobile devices
    try {
        document.execCommand('copy');
        copyBtn.textContent = 'Copied!';
    } catch (err) {
        console.error('Failed to copy: ', err);
        copyBtn.textContent = 'Copy Failed';
    }
    setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
};

const updateStatus = (text, state = 'waiting') => {
    statusContainer.classList.remove('bg-gray-700', 'bg-indigo-700', 'bg-green-700', 'bg-red-700');
    switch (state) {
        case 'progress': statusContainer.classList.add('bg-indigo-700'); statusSpinner.classList.remove('hidden'); break;
        case 'connected': statusContainer.classList.add('bg-green-700'); statusSpinner.classList.add('hidden'); break;
        case 'error': statusContainer.classList.add('bg-red-700'); statusSpinner.classList.add('hidden'); break;
        case 'waiting': default: statusContainer.classList.add('bg-gray-700'); statusSpinner.classList.remove('hidden'); break;
    }
    if (statusMessage) {
        statusMessage.textContent = text;
    } else {
        statusText.textContent = text;
    }
};

const updateProgressBar = (value, max, index) => {
    const progressBar = document.getElementById(`queue-progress-bar-${index}`);
    if(progressBar) {
        const percentage = Math.round((value / max) * 100);
        progressBar.style.width = `${percentage}%`;
    }
};

const formatBytes = (bytes, decimals = 2) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

const showFileSharingView = () => {
    showFilesBtn.classList.add('bg-gray-600', 'text-white');
    showFilesBtn.classList.remove('text-gray-400');
    showTextBtn.classList.remove('bg-gray-600', 'text-white');
    showTextBtn.classList.add('text-gray-400');

    fileSelectionContainer.classList.remove('hidden');
    textSelectionContainer.classList.add('hidden');
};

const showTextSharingView = () => {
    showTextBtn.classList.add('bg-gray-600', 'text-white');
    showTextBtn.classList.remove('text-gray-400');
    showFilesBtn.classList.remove('bg-gray-600', 'text-white');
    showFilesBtn.classList.add('text-gray-400');

    textSelectionContainer.classList.remove('hidden');
    fileSelectionContainer.classList.add('hidden');
};

const handleDragOver = (e) => { e.preventDefault(); if (!sharingModeContainer.classList.contains('hidden')) { dropZone.classList.add('drag-over'); } };
const handleDragLeave = (e) => { e.preventDefault(); dropZone.classList.remove('drag-over'); };
const handleDrop = (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    if (!sharingModeContainer.classList.contains('hidden') && fileSelectionContainer.style.display !== 'none' && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
         handleFileSelect({ target: { files: e.dataTransfer.files } });
         e.dataTransfer.clearData();
    }
};

const stopSharing = async () => {
    clearConnectionHint();

    const activeRoomId = roomId;
    const wasHost = isHost;

    for (const [peerId] of peerConnections.entries()) {
        cleanupConnection(peerId, { closePeerConnection: true });
    }

    if (signalingSocket?.connected && activeRoomId) {
        try {
            if (wasHost) {
                await emitSignaling('host:close-room', {
                    roomId: activeRoomId,
                    reason: 'host-stopped-sharing'
                });
            } else {
                await emitSignaling('peer:leave-room', {
                    roomId: activeRoomId,
                    peerId: localId
                });
            }
        } catch (error) {
            console.warn('Failed to clean up signaling room:', error);
        }
    }

    isHost = false;
    roomId = null;
    roomPassword = null;
    filesToSend = [];
    receivingStates.clear();
    pendingPeerCandidates.clear();
    pendingHostCandidates.clear();
    pendingAnswers.clear();

    shareScreen.classList.add('hidden');
    startScreen.classList.remove('hidden');
    participantsList.innerHTML = '';
    sendingQueueList.innerHTML = '';
    receivedFilesList.innerHTML = '';
    receivedTextList.innerHTML = '';
    chatLog.innerHTML = '';
    participantsContainer.classList.add('hidden');
    chatContainer.classList.add('hidden');
    sharingModeContainer.classList.add('hidden');
    sendingQueueContainer.classList.add('hidden');
    receivedFilesContainer.classList.add('hidden');
    receivedTextContainer.classList.add('hidden');
    passwordPromptContainer.classList.add('hidden');
    passwordErrorText.classList.add('hidden');
    passwordPromptInput.value = '';
    shareLinkInput.value = '';
    roomIdText.textContent = '';
    roomIdText.classList.add('hidden');
    qrCodeContainer.innerHTML = '';
    roomPasswordInput.value = '';

    window.history.pushState({}, '', window.location.pathname);
};

initialize().catch((error) => {
    console.error('Initialization failed:', error);
    updateStatus('Error: Failed to initialize app.', 'error');
});

