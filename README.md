this is the live demo link to the website -- https://p2pfile-transfer.netlify.app/


DirectDrop: Secure P2P File Sharing
DirectDrop is a simple, secure, and serverless way to transfer files directly between two devices using only a web browser. Built with WebRTC, it establishes a direct peer-to-peer connection, ensuring that your files are never uploaded to or stored on a central server.

✨ Features
🔒 Secure & Private: Files are transferred directly between peers, encrypted in transit using DTLS (a standard part of WebRTC). No middleman server sees your data.

🌐 Serverless Transfer: Files are never stored in the cloud. We only use a signaling server (Firebase) to help the two browsers find each other.

🔗 Multiple Connection Methods: Share a session with a simple link, a short Room ID, or a scannable QR code.

📁 Multi-File Support: Send multiple files or entire folders at once.

💬 Integrated Chat: A simple text chat is included for communication during the transfer.

📱 PWA Ready: Installable as a Progressive Web App for an app-like experience and offline access.

🖱️ Drag & Drop: Easily drag files onto the application to start a transfer.

🚀 Lightweight: Built with vanilla JavaScript, HTML, and Tailwind CSS. No heavy frameworks are needed.

🛠️ How It Works
DirectDrop leverages the power of WebRTC to create a direct data channel between two browsers. The process is as follows:

Signaling: When a user clicks "Create Share Link," the app generates a WebRTC "offer" and a unique Room ID. This offer is stored in a Firebase Firestore document.

Connection: The second user opens the shared link or enters the Room ID. Their browser reads the offer from Firestore, creates an "answer," and updates the document.

ICE Candidates: Both browsers exchange network information (ICE candidates) via the Firestore document to find the best path to connect to each other.

Direct Connection: Once a path is found, a secure, direct P2P connection is established. The Firestore signaling server is no longer needed for the file transfer itself.

File Transfer: Files are split into chunks (currently 256 KB) and sent directly over the encrypted WebRTC data channel.

Important: Firebase is used only for the initial handshake (signaling). The files themselves are transferred directly between the two users and are never sent to or stored on any server.

🚀 Getting Started
Using the Live App
Sender:

Open the DirectDrop web application.

Click - https://p2pfile-transfer.netlify.app/

Send the generated URL, Room ID, or QR code to the other person.

Receiver:

Open the URL from the sender (or go to the site and enter the Room ID).

Once the status shows "Connected to peer!", the sender can select files to begin the transfer.

Local Development
To run this project on your local machine:

Clone the repository:

git clone [https://github.com/your-username/directdrop.git](https://github.com/your-username/directdrop.git)
cd directdrop

Set up Firebase:

Go to the Firebase Console and create a new project.

Create a new Firestore Database.

In your project settings, create a new Web App and copy the firebaseConfig object.

Update Configuration:

Open the index.html file.

Find the firebaseConfig constant.

Replace the existing atob(...) encoded string with your own firebaseConfig object, encoded in base64. You can use an online tool to encode your configuration JSON.

Run a local server:

Since this project uses ES Modules, you need to serve it from a local web server.

If you have Node.js, you can use the serve package:

npx serve

Open your browser to the URL provided (e.g., http://localhost:3000).

📁 File Structure
index.html: The main file containing all the application logic, HTML structure, and styling.

manifest.json: The Progressive Web App manifest file, allowing the app to be "installed."

sw.js: The Service Worker file, which handles caching for offline access.

README.md: You are here!

📜 License
This project is licensed under the MIT License. See the LICENSE file for details.
