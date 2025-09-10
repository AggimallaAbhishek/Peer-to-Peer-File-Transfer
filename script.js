// --- Firebase Configuration ---
const firebaseConfig = JSON.parse(atob("eyJhcGlLZXkiOiJBSXphU3lBdTFLZUhVV2ExQTd6djhINHNNTmpCNnpnNE9SOVlWMmMiLCJhdXRoRG9tYWluIjoicDJwLWZpbGUtdHJhbnNmZXItYjQyYzUuZmlyZWJhc2VhcHAuY29tIiwicHJvamVjdElkIjoicDJwLWZpbGUtdHJhbnNmZXItYjQyYzUiLCJzdG9yYWdlQnVja2V0IjoicDJwLWZpbGUtdHJhbnNmZXItYjQyYzUuYXBwc3BvdC5jb20iLCJtZXNzYWdpbmdTZW5kZXJJZCI6IjI0NDg5NTM1MTgxNiJ9"));

// Import Firebase modules
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot, collection, addDoc, deleteDoc, writeBatch } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// --- WebRTC Configuration ---
const servers = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
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
    ],
};
const CHUNK_SIZE = 256 * 1024;
const BUFFERED_AMOUNT_LOW_THRESHOLD = 16 * 1024 * 1024;

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
let roomUnsubscribe = null;

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


// --- Core Logic ---
const initialize = () => {
    localId = crypto.randomUUID();
    const urlParams = new URLSearchParams(window.location.search);
    roomId = urlParams.get('id');
    if (roomId) {
        joinRoom(roomId);
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
};

const handleNewPeer = async (peerId, peerDoc) => {
    if (peerConnections.has(peerId) || peerId === localId) return;
    if (roomMode === 'p2p' && peerConnections.size >= 1) { return; }

    console.log(`New peer detected: ${peerId}`);
    const pc = new RTCPeerConnection(servers);
    const connection = { pc, dc: null, name: `Peer ${peerId.substring(0, 4)}`, unsubscribe: null };
    peerConnections.set(peerId, connection);
    updateParticipantsList();

    let peerOffer = peerDoc.data().offer;
    if (roomPassword) {
        try {
            peerOffer = await decryptData(peerOffer, roomPassword);
        } catch (e) {
            console.error("Failed to decrypt offer from peer - likely wrong password.");
            peerConnections.delete(peerId);
            updateParticipantsList();
            return;
        }
    }
    
    pc.onicecandidate = async (event) => {
        if (event.candidate) {
            const candidateCollection = collection(db, 'rooms', roomId, 'peers', peerId, 'hostCandidates');
            await addDoc(candidateCollection, event.candidate.toJSON());
        }
    };
    
    const peerCandidates = collection(db, 'rooms', roomId, 'peers', peerId, 'peerCandidates');
    const unsubscribe = onSnapshot(peerCandidates, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            const currentConnection = peerConnections.get(peerId);
            if (change.type === 'added' && currentConnection && currentConnection.pc.connectionState !== 'closed') {
                 currentConnection.pc.addIceCandidate(new RTCIceCandidate(change.doc.data()));
            }
        });
    });
    connection.unsubscribe = unsubscribe; // Store the unsubscribe function

    pc.ondatachannel = (event) => {
        const currentConnection = peerConnections.get(peerId);
        if (currentConnection) {
            currentConnection.dc = event.channel;
            setupDataChannel(peerId, currentConnection);
        }
    };

    await pc.setRemoteDescription(new RTCSessionDescription(peerOffer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    const peerRef = doc(db, 'rooms', roomId, 'peers', peerId);
    let answerToSend = { sdp: answer.sdp, type: answer.type };
    if (roomPassword) {
        answerToSend = await encryptData(answerToSend, roomPassword);
    }
    await updateDoc(peerRef, { answer: answerToSend });
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
    sharingModeContainer.classList.add('hidden'); // Hide until connected

    if (roomMode === 'group') participantsContainer.classList.remove('hidden');
    updateParticipantsList();
    updateStatus('Waiting for peer(s) to connect...', 'waiting');
    
    try {
        const roomRef = doc(collection(db, 'rooms'));
        roomId = roomRef.id;

        await setDoc(roomRef, { mode: roomMode, hasPassword: !!roomPassword, createdAt: new Date().toISOString() });
        
        if (roomMode === 'group') {
            setTimeout(() => {
                console.log(`Room ${roomId} expired after 1 hour. Deleting.`);
                deleteDoc(roomRef).catch(err => console.error("Error deleting expired room:", err));
            }, 3600 * 1000);
        }

        const peersCollection = collection(db, 'rooms', roomId, 'peers');
        roomUnsubscribe = onSnapshot(peersCollection, (snapshot) => {
            snapshot.docChanges().forEach((change) => {
                if (change.type === 'added') handleNewPeer(change.doc.id, change.doc);
                if (change.type === 'removed') {
                    const peerId = change.doc.id;
                    const connection = peerConnections.get(peerId);
                    if (connection) {
                        if (connection.unsubscribe) connection.unsubscribe(); // Unsubscribe!
                        connection.pc.close();
                    }
                    peerConnections.delete(peerId);
                    updateParticipantsList();
                }
            });
        });
        
        const shareLink = `${window.location.origin}${window.location.pathname}?id=${roomId}`;
        shareLinkInput.value = shareLink;
        qrCodeContainer.innerHTML = '';
        new QRCode(qrCodeContainer, { text: shareLink, width: 144, height: 144, colorDark : "#000000", colorLight : "#ffffff", correctLevel : QRCode.CorrectLevel.H });
        
        if (roomMode === 'p2p') {
            privacyNotice.textContent = 'For your privacy, the connection server for this room will self-destruct after your peer connects.';
        } else {
            privacyNotice.textContent = 'For your privacy, this group room will self-destruct after 1 hour.';
        }
        privacyNotice.classList.remove('hidden');

    } catch (error) {
        console.error("Error creating room:", error);
        updateStatus("Error: Could not create a share link.", 'error');
    }
};

const joinRoom = async (roomId) => {
    isHost = false;
    startScreen.classList.add('hidden');
    shareScreen.classList.remove('hidden');
    qrCodeArea.classList.add('hidden');
    sharingModeContainer.classList.add('hidden');
    updateStatus('Connecting...', 'progress');
    try {
        const roomRef = doc(db, 'rooms', roomId);
        const roomSnap = await getDoc(roomRef);
        if (!roomSnap.exists()) {
            updateStatus('Error: Room does not exist.', 'error');
            return;
        }
        
        roomMode = roomSnap.data().mode || 'p2p';
        if (roomMode === 'p2p') {
            privacyNotice.textContent = 'For your privacy, the connection server for this room self-destructs after you connect.';
        } else {
            privacyNotice.textContent = 'For your privacy, this group room will self-destruct after 1 hour.';
        }
        privacyNotice.classList.remove('hidden');

        if (roomMode === 'group') participantsContainer.classList.remove('hidden');

        if (roomSnap.data().hasPassword) {
            passwordPromptContainer.classList.remove('hidden');
            passwordPromptCancel.onclick = () => window.location.href = window.location.pathname;
            passwordPromptSubmit.onclick = () => {
                roomPassword = passwordPromptInput.value;
                passwordErrorText.classList.add('hidden');
                passwordPromptContainer.classList.add('hidden');
                proceedWithJoin(roomId);
            };
        } else {
            proceedWithJoin(roomId);
        }
    } catch (error) {
        console.error("Error joining room:", error);
        updateStatus("Error: Could not join session.", 'error');
    }
};

const proceedWithJoin = async (roomId) => {
    const pc = new RTCPeerConnection(servers);
    const connection = { pc, dc: null, name: 'Host', unsubscribe: null };
    peerConnections.set('host', connection);

    pc.onicecandidate = async (event) => {
        if (event.candidate) {
            const candidateCollection = collection(db, 'rooms', roomId, 'peers', localId, 'peerCandidates');
            await addDoc(candidateCollection, event.candidate.toJSON());
        }
    };
    
    const hostCandidates = collection(db, 'rooms', roomId, 'peers', localId, 'hostCandidates');
    const unsubscribe = onSnapshot(hostCandidates, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === 'added' && pc.connectionState !== 'closed') {
                pc.addIceCandidate(new RTCIceCandidate(change.doc.data()));
            }
        });
    });
    connection.unsubscribe = unsubscribe; // Store the unsubscribe function

    const dc = pc.createDataChannel('file-transfer');
    connection.dc = dc;
    setupDataChannel('host', connection);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const peerRef = doc(db, 'rooms', roomId, 'peers', localId);
    let offerToSend = { sdp: offer.sdp, type: offer.type };
    if (roomPassword) {
        offerToSend = await encryptData(offerToSend, roomPassword);
    }
    await setDoc(peerRef, { offer: offerToSend });

    onSnapshot(peerRef, async (snapshot) => {
        if (pc.connectionState === 'closed') return;
        
        let answer = snapshot.data()?.answer;
        if (!pc.currentRemoteDescription && answer) {
            try {
                if (roomPassword) {
                    answer = await decryptData(answer, roomPassword);
                }
                pc.setRemoteDescription(new RTCSessionDescription(answer));
            } catch (e) {
                console.error("Decryption failed - wrong password");
                passwordPromptInput.value = "";
                passwordErrorText.classList.remove('hidden');
                passwordPromptContainer.classList.remove('hidden');
                pc.close();
                peerConnections.delete('host');
            }
        }
    });
    
    window.addEventListener('beforeunload', () => deleteDoc(peerRef));
};

const setupDataChannel = (id, connection) => {
    connection.pc.onconnectionstatechange = () => {
        console.log(`Connection state with ${id} changed to: ${connection.pc.connectionState}`);
        if (connection.pc.connectionState === 'connected' && !isHost) {
            updateStatus(`Connected to ${roomMode === 'p2p' ? 'peer' : 'host'}!`, 'connected');
        }
        updateParticipantsList();
    };
    
    connection.dc.onopen = () => {
        console.log(`Data channel with ${id} opened.`);
        chatContainer.classList.remove('hidden');
        updateParticipantsList();
         if (isHost) {
            sharingModeContainer.classList.remove('hidden');
            showFileSharingView();
        }

         if (roomMode === 'p2p' && isHost) {
            qrCodeArea.classList.add('hidden');
            console.log('P2P connection established. Deleting signaling room from server.');
            const roomRef = doc(db, 'rooms', roomId);
            deleteDoc(roomRef).catch(err => console.error("Error deleting P2P room:", err));
            updateStatus('Connected to peer! Signaling server disconnected for privacy.', 'connected');
        }
    };
    connection.dc.onclose = () => {
        console.log(`Data channel with ${id} closed.`);
        const connectionToClose = peerConnections.get(id);
        if (connectionToClose) {
            if (connectionToClose.unsubscribe) connectionToClose.unsubscribe(); // Unsubscribe!
        }
        peerConnections.delete(id);
        updateParticipantsList();
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
    const textNode = Array.from(statusText.childNodes).find(node => node.nodeType === Node.TEXT_NODE);
    if (textNode) { textNode.textContent = ` ${text}`; } 
    else { statusText.appendChild(document.createTextNode(` ${text}`)); }
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

const stopSharing = () => {
    // Close all peer connections
    for (const [peerId, connection] of peerConnections.entries()) {
        if (connection.pc) {
            connection.pc.close();
        }
        if (connection.unsubscribe) {
            connection.unsubscribe();
        }
    }
    peerConnections.clear();

    // Host cleans up the room
    if (isHost && roomId) {
        if(roomUnsubscribe) roomUnsubscribe();
        const roomRef = doc(db, 'rooms', roomId);
        deleteDoc(roomRef).catch(err => console.error("Error deleting room:", err));
    }

    // Reset state
    isHost = false;
    roomId = null;
    roomPassword = null;
    filesToSend = [];
    receivingStates.clear();

    // Reset UI
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
    shareLinkInput.value = '';
    qrCodeContainer.innerHTML = '';
    roomPasswordInput.value = '';
    
    // Clean URL
    window.history.pushState({}, '', window.location.pathname);
};

initialize();

