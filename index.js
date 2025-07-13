const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');
const multer = require('multer');

const PORT = process.env.PORT || 4000;
const CONTENT_ROOT = '/var/www/kabkimd';

//──────────────────────────────────────────────────────────────────────────────
// Helper to ensure users stay within their own folder
function resolveUserPath(user, rel) {
  const base = path.resolve(CONTENT_ROOT, user);
  const abs  = path.resolve(base, rel);
  if (!abs.startsWith(base)) {
    throw new Error('Invalid path: ' + rel);
  }
  return abs;
}

//──────────────────────────────────────────────────────────────────────────────
// Multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const relDir = req.query.path || '';
    const absDir = resolveUserPath(req.user.username, relDir);
    cb(null, absDir);
  },
  filename: (req, file, cb) => cb(null, file.originalname)
});
const upload = multer({ storage });

//──────────────────────────────────────────────────────────────────────────────
// Express setup
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

//──────────────────────────────────────────────────────────────────────────────
// Session + Passport authentication
app.use(session({
  secret: 'a-very-secret-string',
  resave: false,
  saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());

// In-memory user store (replace with DB in production)
const users = {
  ladybug:  { passwordHash: bcrypt.hashSync('yourPassword1', 10) },
  queenant: { passwordHash: bcrypt.hashSync('yourPassword2', 10) },
  queenbee: { passwordHash: bcrypt.hashSync('yourPassword3', 10) }
};

passport.use(new LocalStrategy((username, password, done) => {
  const user = users[username];
  if (!user) {
    return done(null, false, { message: 'Unknown user' });
  }
  if (!bcrypt.compareSync(password, user.passwordHash)) {
    return done(null, false, { message: 'Invalid password' });
  }
  return done(null, { username });
}));

passport.serializeUser((user, done) => done(null, user.username));
passport.deserializeUser((username, done) => {
  if (users[username]) {
    return done(null, { username });
  }
  return done(null, false);
});

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect('/login');
}

//──────────────────────────────────────────────────────────────────────────────
// Authentication routes
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login',
  passport.authenticate('local', {
    successRedirect: '/',
    failureRedirect: '/login'
  })
);

app.get('/logout', (req, res, next) => {
  req.logout(err => {
    if (err) return next(err);
    res.redirect('/login');
  });
});

//──────────────────────────────────────────────────────────────────────────────
// Serve editor UI
app.use('/', ensureAuthenticated, express.static(path.join(__dirname, 'public')));
app.get('/', ensureAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

//──────────────────────────────────────────────────────────────────────────────
// File read/write API
app.get('/api/file', ensureAuthenticated, async (req, res) => {
  const rel = req.query.path;
  if (!rel) return res.status(400).send('Missing path parameter');
  try {
    const abs = resolveUserPath(req.user.username, rel);
    const content = await fs.readFile(abs, 'utf8');
    res.send(content);
  } catch (err) {
    console.error(err);
    res.status(500).send(err.message);
  }
});

app.post('/api/file', ensureAuthenticated, async (req, res) => {
  const { path: rel, content } = req.body;
  if (!rel) return res.status(400).send('Missing path');
  try {
    const abs = resolveUserPath(req.user.username, rel);
    await fs.writeFile(abs, content, 'utf8');
    res.send('OK');
  } catch (err) {
    console.error(err);
    res.status(500).send(err.message);
  }
});

//──────────────────────────────────────────────────────────────────────────────
// Directory tree for jsTree
app.get('/api/tree', ensureAuthenticated, async (req, res) => {
  const rel = req.query.path || '';
  try {
    const abs = resolveUserPath(req.user.username, rel);
    const entries = await fs.readdir(abs, { withFileTypes: true });
    const tree = entries.map(d => ({
      id:       path.posix.join(rel, d.name),
      parent:   rel === '' ? '#' : rel,
      text:     d.name,
      children: d.isDirectory(),
      type:     d.isDirectory() ? 'folder' : 'file'
    }));
    res.json(tree);
  } catch (err) {
    console.error(err);
    res.status(500).send(err.message);
  }
});

//──────────────────────────────────────────────────────────────────────────────
// File operations: mkdir, touch, rename, delete
app.post('/api/mkdir', ensureAuthenticated, async (req, res) => {
  try {
    await fs.mkdir(resolveUserPath(req.user.username, req.body.path));
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/touch', ensureAuthenticated, async (req, res) => {
  try {
    const abs = resolveUserPath(req.user.username, req.body.path);
    await fs.writeFile(abs, '', { flag: 'wx' });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/rename', ensureAuthenticated, async (req, res) => {
  try {
    await fs.rename(
      resolveUserPath(req.user.username, req.body.oldPath),
      resolveUserPath(req.user.username, req.body.newPath)
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/rm', ensureAuthenticated, async (req, res) => {
  try {
    const abs = resolveUserPath(req.user.username, req.body.path);
    const stat = await fs.stat(abs);
    if (stat.isDirectory()) await fs.rmdir(abs);
    else await fs.unlink(abs);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

//──────────────────────────────────────────────────────────────────────────────
// File upload
app.post('/api/upload', ensureAuthenticated, upload.array('files'), (req, res) => {
  res.json({ ok: true, files: req.files.map(f => f.originalname) });
});

//──────────────────────────────────────────────────────────────────────────────
// Expose current user
app.get('/api/user', ensureAuthenticated, (req, res) => {
  res.json({ username: req.user.username });
});

//──────────────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`edit.kabkimd.nl listening on port ${PORT}`);
});
