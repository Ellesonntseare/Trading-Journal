'use strict';
// Usage (stop the journal first):  node reset-password.js <username> <new password>
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { hashPassword } = require('./auth');

const DATA_DIR = path.resolve(process.env.JOURNAL_DATA_DIR || path.join(__dirname, 'data'));
const [, , nameArg, newPass] = process.argv;
if (!nameArg || !newPass) {
  console.log('Usage: node reset-password.js <username> <new password>');
  process.exit(1);
}
if (newPass.length < 8) {
  console.log('The new password must be at least 8 characters.');
  process.exit(1);
}
const usersFile = path.join(DATA_DIR, 'users.json');
const sessionsFile = path.join(DATA_DIR, 'sessions.json');
let users;
try {
  users = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
} catch (e) {
  console.log('No accounts found in ' + DATA_DIR);
  process.exit(1);
}
const user = users.find((u) => u.username === nameArg.trim().toLowerCase());
if (!user) {
  console.log('No account called "' + nameArg + '". Accounts: ' + users.map((u) => u.username).join(', '));
  process.exit(1);
}
hashPassword(newPass).then((h) => {
  user.passHash = h;
  fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
  try {
    const sessions = JSON.parse(fs.readFileSync(sessionsFile, 'utf8'));
    Object.keys(sessions).forEach((k) => sessions[k].uid === user.id && delete sessions[k]);
    fs.writeFileSync(sessionsFile, JSON.stringify(sessions, null, 2));
  } catch (e) {}
  console.log('Password reset for "' + user.username + '". They are logged out everywhere.');
});
