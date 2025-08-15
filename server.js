// backend/server.js
require('dotenv').config(); // Loads environment variables from .env file
const express = require('express');
const cors = require('cors'); // Import cors
const mongoose = require('mongoose');
const medicineRoutes = require('./routes/medicineRoutes');
const app = express();

// Middleware
app.use(cors()); // Enable CORS for all routes - allows frontend to talk to backend
app.use(express.json()); // To parse incoming JSON requests

// A simple test route
app.get('/', (req, res) => {
    res.send('Hello from Medical Store Assistant API!');
});

app.use('/api/medicines', medicineRoutes);

const PORT = process.env.PORT || 5000; // Use port from .env or default to 5000
const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI).then(
    () => {
        console.log("mongodb is connected");

        app.listen(PORT, '0.0.0.0', () => {
            console.log(`server is running on http://0.0.0.0:${PORT}`)
        })
    }

    )

.catch (err => {
    console.log("mongodb connection error:", err.message);
    process.exit(1);
})
