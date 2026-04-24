const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors()); // ⭐ IMPORTANT
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Server is running 🚀');
});

app.post('/contact', (req, res) => {
  console.log("Data received:", req.body);
  res.send('Message received successfully!');
});

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});