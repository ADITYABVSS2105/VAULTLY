const fs = require('fs');
const path = require('path');

const files = ['index.html', 'style.css', 'app.js'];
const destDir = path.join(__dirname, 'public');

if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir);
}

files.forEach(f => {
  fs.copyFileSync(path.join(__dirname, f), path.join(destDir, f));
  console.log(`Copied ${f} to public/`);
});
