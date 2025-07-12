const express = require('express');
const path    = require('path');
const app     = express();
const PORT    = process.env.PORT || 4000;

// 1) serve anything under /public as static
app.use(express.static(path.join(__dirname, 'public')));  // :contentReference[oaicite:1]{index=1}

// 2) fallback for “/”
app.get('/', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);

app.listen(PORT, () =>
  console.log(`edit.kabkimd.nl listening on port ${PORT}`)
);
