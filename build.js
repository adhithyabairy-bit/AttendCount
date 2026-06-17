const fs = require('fs');
const path = require('path');

const srcDir = __dirname;
const destDir = path.join(__dirname, 'www');

// Create www directory if it doesn't exist
if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir);
}

// Helper to recursively copy directories
function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest);
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (let entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Files to copy
const filesToCopy = [
  'index.html',
  'dashboard.html',
  'holiday_management_calendar_sync.html',
  'manage_classes_summary_view.html',
  'step2_unified_timetable_assignment.html',
  'step3_attendance_initialisation.html',
  'privacy_policy.html',
  'app.js',
  'config.js',
  'styles.css',
  'manifest.json',
  'sw.js'
];

// Directories to copy
const dirsToCopy = [
  'js',
  'icons',
  '.well-known'
];

console.log('Building web assets for Capacitor...');

// Clean existing www directory contents (excluding www directory itself)
if (fs.existsSync(destDir)) {
  const entries = fs.readdirSync(destDir, { withFileTypes: true });
  for (let entry of entries) {
    const entryPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      fs.rmSync(entryPath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(entryPath);
    }
  }
}

// Copy files
filesToCopy.forEach(file => {
  const srcPath = path.join(srcDir, file);
  const destPath = path.join(destDir, file);
  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, destPath);
    console.log(`Copied file: ${file}`);
  } else {
    console.warn(`File not found: ${file}`);
  }
});

// Copy directories
dirsToCopy.forEach(dir => {
  const srcPath = path.join(srcDir, dir);
  const destPath = path.join(destDir, dir);
  if (fs.existsSync(srcPath)) {
    copyDir(srcPath, destPath);
    console.log(`Copied directory: ${dir}`);
  } else {
    console.warn(`Directory not found: ${dir}`);
  }
});

console.log('Build complete! Web assets are in /www');
