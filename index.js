const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');

const PORT = process.env.PORT || 4000;
const CONTENT_ROOT = '/var/www/kabkimd';

const app = express();

// Authentication setup
const users = {
  ladybug: { passwordHash: bcrypt.hashSync('yourPassword1', 10) },
  queenant: { passwordHash: bcrypt.hashSync('yourPassword2', 10) },
  queenbee: { passwordHash: bcrypt.hashSync('yourPassword3', 10) },
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

// Middlewares
app.use(session({
  secret: 'a-very-secret-string',
  resave: false,
  saveUninitialized: false,
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Auth check middleware
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect('/login');
}

// Authentication routes
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login',
  passport.authenticate('local', {
    successRedirect: '/',
    failureRedirect: '/login',
  })
);

app.get('/logout', (req, res, next) => {
  req.logout(err => {
    if (err) {
      return next(err);
    }
    res.redirect('/login');
  });
});

// Serve editor UI
app.use('/', ensureAuthenticated, express.static(path.join(__dirname, 'public')));
app.get('/', ensureAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// File API routes
app.get('/api/file', ensureAuthenticated, async (req, res) => {
  try {
    const rel = req.query.path;
    if (!rel) {
      return res.status(400).send('Missing path parameter');
    }
    const abs = path.resolve(CONTENT_ROOT, req.user.username, rel);
    if (!abs.startsWith(path.resolve(CONTENT_ROOT))) {
      return res.status(400).send('Invalid path');
    }
    const content = await fs.readFile(abs, 'utf8');
    res.send(content);
  } catch (err) {
    console.error(err);
    res.status(500).send(err.toString());
  }
});

app.post('/api/file', ensureAuthenticated, async (req, res) => {
  try {
    const { path: rel, content } = req.body;
    if (!rel) {
      return res.status(400).send('Missing path');
    }
    const abs = path.resolve(CONTENT_ROOT, req.user.username, rel);
    if (!abs.startsWith(path.resolve(CONTENT_ROOT))) {
      return res.status(400).send('Invalid path');
    }
    await fs.writeFile(abs, content, 'utf8');
    res.send('OK');
  } catch (err) {
    console.error(err);
    res.status(500).send(err.toString());
  }
});

/**
 * GET /api/tree?path=relative/path
 * → returns JSON array of { id, parent, text, children, type }
 *    suitable for jsTree
 */
app.get('/api/tree', ensureAuthenticated, async (req, res) => {
  const rel    = req.query.path || '';  // e.g. "" or "subdir/file.txt"
  const userDir = path.resolve(CONTENT_ROOT, req.user.username);
  const abs    = path.resolve(userDir, rel);
  // prevent out-of-bounds
  if (!abs.startsWith(userDir)) 
    return res.status(400).send('Invalid path');

  try {
    const entries = await fs.readdir(abs, { withFileTypes: true });
    const tree = entries.map(dirent => ({
      id:       path.posix.join(rel, dirent.name),    // jsTree node id
      parent:   rel === '' ? '#' : rel,               // root’s parent is '#'
      text:     dirent.name,
      children: dirent.isDirectory(),
      type:     dirent.isDirectory() ? 'folder' : 'file'
    }));
    res.json(tree);
  } catch (err) {
    res.status(500).send(err.toString());
  }
});


app.listen(PORT, () => {
  console.log(`edit.kabkimd.nl listening on port ${PORT}`);
});
