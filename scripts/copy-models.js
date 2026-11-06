// Copies the face-recognition models that ship inside the npm package into public/models,
// so the camera step works offline (no CDN, nothing downloaded at run time).
const fs = require('fs');
const path = require('path');
const from = path.join(__dirname, '..', 'node_modules', '@vladmandic', 'face-api', 'model');
const to = path.join(__dirname, '..', 'public', 'models');
if (!fs.existsSync(from)) { console.log('face-api models not found yet (run npm install first)'); process.exit(0); }
fs.mkdirSync(to, { recursive: true });
['tiny_face_detector', 'face_landmark_68', 'face_recognition'].forEach((n) => {
  fs.readdirSync(from).filter((f) => f.startsWith(n) && !f.startsWith(`${n}_tiny`)).forEach((f) => fs.copyFileSync(path.join(from, f), path.join(to, f)));
});
console.log('face models ready in public/models');
