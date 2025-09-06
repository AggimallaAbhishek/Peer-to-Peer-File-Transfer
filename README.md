**This is the live demo link to the website** -- https://p2pfile-transfer.netlify.app/


DirectDrop - Secure P2P File Sharing
DirectDrop is a secure, decentralized, and privacy-focused peer-to-peer (P2P) file sharing application built entirely with web technologies. It uses WebRTC for direct data transfer between browsers, eliminating the need for a central server to handle your files. A lightweight signaling server using Firebase Firestore is used only for the initial connection setup.

Features
Serverless File Transfers: Files are sent directly between peers (browsers) using WebRTC, ensuring privacy and speed.

Multiple Sharing Modes:

1-to-1 Sharing: Create a private room for secure transfer with a single person.

Group Broadcasting: Host a room and broadcast files, text, and messages to multiple participants simultaneously.

End-to-End Encryption: Secure your group sessions with a password. All data (files, text, and chat) is encrypted end-to-end using the Web Crypto API (AES-GCM).

Versatile Sharing:

Files & Folders: Share individual files or entire folders.

Folder Zipping: Automatically compress and send folders as a single .zip file.

Text Snippets: Quickly share code snippets, notes, or links.

Easy Connection:

Shareable Link: Instantly generate a unique link for your session.

QR Code: A scannable QR code is created for easily connecting mobile devices.

Real-time Communication: An integrated chat allows participants to communicate during the session.

Privacy-First Design:

P2P Session Cleanup: The signaling room for 1-to-1 sessions is deleted from the server the moment a connection is established.

Group Session Expiry: Group rooms and their metadata are automatically deleted after 1 hour.

Progressive Web App (PWA): Installable on both mobile and desktop platforms for a native app-like experience.

Modern UI: A clean, responsive, and user-friendly interface with drag-and-drop support, real-time progress indicators, and a dark mode theme.

How It Works
The application leverages WebRTC to create a direct peer-to-peer connection. However, to initiate this connection, peers need a way to find and communicate with each other. This process is called signaling.

Initiation (Host): The user who creates a room becomes the "host." The application generates a unique roomId and stores it in a Firebase Firestore document.

Signaling: The host generates a WebRTC "offer" and a share link (.../?id=<roomId>). When a peer joins using this link, they generate a WebRTC "answer." These offers and answers, along with ICE candidates (which describe how to connect), are exchanged via the Firestore document.

Direct Connection: Once the signaling is complete, a direct, secure RTCPeerConnection is established between the users.

Data Transfer: All files, text, and chat messages are now sent directly through this encrypted P2P channel, bypassing any central server.

Cleanup: For maximum privacy, the Firestore document acting as the signaling channel is automatically deleted immediately after a 1-to-1 connection is made or after 1 hour for group rooms.

How to Use
To Share (as Host):
Open the DirectDrop application.

Choose "Share with One Person" or "Broadcast to a Group".

(Optional) For group sharing, enter a password to encrypt the session.

Share the generated link or have the other person scan the QR code.

Wait for the peer(s) to connect.

Once connected, select files/folders, type text, or chat to share.

To Receive (as Peer):
Open the share link provided by the host.

(Optional) If the room is password-protected, you will be prompted to enter the password.

Wait to be connected to the host.

Once connected, you will be able to receive files, text, and chat messages. Download buttons will appear for any received files.

Technology Stack
Frontend: HTML5, CSS3, JavaScript (ES Modules)

Styling: Tailwind CSS

P2P Communication: WebRTC (RTCPeerConnection, RTCDataChannel)

Signaling: Google Firebase Firestore

QR Code Generation: qrcode.js

File Compression: jszip.min.js

Encryption: Web Crypto API (AES-GCM)
