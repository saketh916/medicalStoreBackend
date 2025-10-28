const express = require('express');
const router = express.Router();
const axios = require('axios');
const Fuse = require('fuse.js');
const Medicine = require('../models/medicine');
const { GoogleGenerativeAI } = require('@google/generative-ai'); 
require('dotenv').config();

// ✅ Initialize Google Generative AI
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

// ✅ Allowed Gemini models (latest, working as of Oct 2025)
const allowedGeminiModels = [
  "gemini-2.5-flash-lite-preview-06-17", // stable + free tier
  "gemini-2.0-flash-exp",
  "gemini-2.0-pro-exp"
];

// ✅ Add new medicine
router.post('/', async (req, res) => {
  try {
    const { tabletName, quantityInStock, price, dosageFrequency, usageInstructions, foodWarnings } = req.body;

    if (!tabletName || quantityInStock === undefined) {
      return res.status(400).json({ msg: 'Tablet name and quantity are required.' });
    }

    let existing = await Medicine.findOne({ tabletName });
    if (existing) {
      return res.status(400).json({ msg: `Medicine '${tabletName}' already exists.` });
    }

    const newMed = new Medicine({ tabletName, quantityInStock, price, dosageFrequency, usageInstructions, foodWarnings });
    await newMed.save();

    res.status(201).json({ msg: `'${tabletName}' added successfully.`, medicine: newMed });
  } catch (err) {
    console.error('Error adding medicine:', err.message);
    if (err.code === 11000) {
      return res.status(400).json({ msg: `Medicine '${req.body.tabletName}' already exists.` });
    }
    res.status(500).send('Server Error');
  }
});

// ✅ Check medicine or find alternatives using Google Gemini
router.get('/check', async (req, res) => {
  const { name, model } = req.query;

  if (!name) {
    return res.status(400).json({ error: 'Medicine name query parameter is required.' });
  }

  try {
    // 1️⃣ Exact local match
    const localMedicine = await Medicine.findOne({
      tabletName: new RegExp(`^${name}$`, 'i'),
      quantityInStock: { $gt: 0 }
    });

    if (localMedicine) {
      return res.json({
        status: 'available_locally',
        message: `'${name}' is available in your inventory.`,
        data: localMedicine
      });
    }

    // 2️⃣ Fuzzy match in local DB
    const all = await Medicine.find({});
    const fuse = new Fuse(all, { keys: ['tabletName'], threshold: 0.3 });
    const fuzzyResults = fuse.search(name);
    const topFuzzy = fuzzyResults.slice(0, 3).map(r => r.item.tabletName);

    if (topFuzzy.length > 0) {
      return res.json({
        status: 'not_found_but_similar_exist',
        message: `'${name}' not found, but here are some close matches in your stock:`,
        suggestions: topFuzzy
      });
    }

    // 3️⃣ Query Gemini for external suggestions
    console.log(`'${name}' not found locally. Querying Google Gemini...`);
    const modelToUse = model || "gemini-2.5-flash-lite-preview-06-17";

    if (!allowedGeminiModels.includes(modelToUse)) {
      return res.status(400).json({
        error: `Invalid Gemini model. Allowed: ${allowedGeminiModels.join(', ')}`
      });
    }

    let geminiAlternatives = [];

    try {
      const geminiModel = genAI.getGenerativeModel({ model: modelToUse });

      const prompt = `What are some generic or therapeutic alternatives for "${name}"? 
      List up to 3 medicine names only, separated by commas. 
      If none are known, just respond with "None".`;

      const result = await geminiModel.generateContent(prompt);
      const rawResponse = result.response.text();
      console.log("Raw Gemini Response:", rawResponse);

      if (rawResponse && rawResponse.toLowerCase() !== "none") {
        geminiAlternatives = rawResponse.split(',')
          .map(x => x.trim())
          .filter(Boolean);
      }
    } catch (apiErr) {
      console.error("❌ Gemini API Error:", apiErr.message);
      return res.status(502).json({
        error: 'Error communicating with Google Gemini API.',
        details: apiErr.message
      });
    }

    const top3 = geminiAlternatives.slice(0, 3);
    console.log(`Gemini suggested: ${top3.join(', ') || 'None'}`);

    // 4️⃣ Check if any Gemini suggestion exists locally
    for (const alt of top3) {
      const inStock = await Medicine.findOne({
        tabletName: new RegExp(`^${alt}$`, 'i'),
        quantityInStock: { $gt: 0 }
      });
      if (inStock) {
        return res.json({
          status: 'alternative_available_locally',
          message: `'${name}' is unavailable, but Gemini suggested an alternative that is in stock.`,
          data: inStock,
          disclaimer: 'Suggestions are informational only; consult a healthcare professional.'
        });
      }
    }

    // 5️⃣ None available locally or suggested
    return res.json({
      status: 'not_available_anywhere',
      message: `'${name}' is not in local stock. Gemini suggestions were checked but none are in stock.`,
      geminiSuggestions: top3,
      disclaimer: 'This information is for educational use; verify with a licensed pharmacist.'
    });

  } catch (err) {
    console.error("🔥 Error in /check route:", err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
