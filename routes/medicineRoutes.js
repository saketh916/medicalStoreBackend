const express = require('express');
const router = express.Router();
const axios = require('axios');
const Fuse = require('fuse.js');
const Medicine = require('../models/medicine');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Load environment variables (ensure .env has GOOGLE_API_KEY=your_api_key)
require('dotenv').config();

// Initialize Google Generative AI client
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

// ✅ Route to add new medicine
router.post('/', async (req, res) => {
  try {
    const { tabletName, quantityInStock, price, dosageFrequency, usageInstructions, foodWarnings } = req.body;

    if (!tabletName || quantityInStock === undefined) {
      return res.status(400).json({ msg: 'Tablet name and quantity are required.' });
    }

    let medicine = await Medicine.findOne({ tabletName });
    if (medicine) {
      return res.status(400).json({ msg: `Medicine '${tabletName}' already exists.` });
    }

    medicine = new Medicine({
      tabletName,
      quantityInStock,
      price,
      dosageFrequency,
      usageInstructions,
      foodWarnings
    });

    await medicine.save();
    res.status(201).json({ msg: `'${tabletName}' added successfully.`, medicine });

  } catch (err) {
    console.error(err.message);
    if (err.code === 11000) {
      return res.status(400).json({ msg: `Medicine '${req.body.tabletName}' already exists.` });
    }
    res.status(500).send('Server Error');
  }
});

// ✅ Route to check medicine or find alternatives
router.get('/check', async (req, res) => {
  const { name, model } = req.query;

  if (!name) {
    return res.status(400).json({ error: 'Medicine name query parameter is required.' });
  }

  try {
    // Step 1: Check for exact match in local stock
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

    // Step 2: Fuzzy match locally
    const allMedicines = await Medicine.find({});
    const fuse = new Fuse(allMedicines, {
      keys: ['tabletName'],
      threshold: 0.3
    });

    const fuzzyResults = fuse.search(name);
    const topFuzzy = fuzzyResults.slice(0, 3).map(r => r.item.tabletName);

    if (topFuzzy.length > 0) {
      return res.json({
        status: 'not_found_but_similar_exist',
        message: `'${name}' not found, but here are some close matches in your stock:`,
        suggestions: topFuzzy
      });
    }

    // Step 3: Query Google Gemini
    console.log(`'${name}' not found locally. Querying Google Gemini for alternatives...`);
    const modelToUse = model || "gemini-1.5-flash";
    const allowedGeminiModels = ["gemini-2.5-flash-lite-preview-06-17", "gemini-1.5-pro", "gemini-1.5-flash"];

    if (!allowedGeminiModels.includes(modelToUse)) {
      return res.status(400).json({ error: `Invalid Gemini model. Allowed: ${allowedGeminiModels.join(', ')}` });
    }

    let geminiAlternatives = [];

    try {
      const geminiModel = genAI.getGenerativeModel({ model: modelToUse });

      const result = await geminiModel.generateContent({
        contents: [{
          role: "user",
          parts: [{
            text: `List up to 3 common therapeutic or generic alternatives for "${name}". 
Only provide names separated by commas. If none, say "None".`
          }]
        }],
        generationConfig: {
          maxOutputTokens: 80,
          temperature: 0.2
        }
      });

      const rawGeminiResponse = result.response.text().trim();
      console.log("Raw Gemini Response:", rawGeminiResponse);

      if (rawGeminiResponse && rawGeminiResponse.toLowerCase() !== "none") {
        geminiAlternatives = rawGeminiResponse
          .split(',')
          .map(a => a.trim())
          .filter(Boolean);
      }

    } catch (apiError) {
      console.error("⚠️ Gemini API Error:", apiError.message);
      if (apiError.message.includes("429")) {
        console.warn("Quota exceeded. Using fallback suggestions.");
        geminiAlternatives = ["Paracetamol", "Ibuprofen", "Diclofenac"]; // fallback safe data
      } else {
        return res.status(502).json({
          error: 'Error communicating with Google Gemini API.',
          details: apiError.message
        });
      }
    }

    const top3GeminiAlternatives = geminiAlternatives.slice(0, 3);
    console.log("Gemini Suggested Alternatives:", top3GeminiAlternatives);

    // Step 4: Check stock for suggested alternatives
    for (const altName of top3GeminiAlternatives) {
      const alternativeInStock = await Medicine.findOne({
        tabletName: new RegExp(`^${altName}$`, 'i'),
        quantityInStock: { $gt: 0 }
      });

      if (alternativeInStock) {
        return res.json({
          status: 'alternative_available_locally',
          message: `'${name}' not found, but Gemini suggested '${altName}' which is in stock. 
⚠️ *Disclaimer: For informational purposes only. Consult a healthcare professional before substituting.*`,
          data: alternativeInStock
        });
      }
    }

    // Step 5: No matches found
    return res.json({
      status: 'not_available_locally_and_no_stocked_alternatives',
      message: `'${name}' not found. Checked Gemini alternatives — none are in stock.`,
      geminiSuggestions: top3GeminiAlternatives,
      disclaimer: '⚠️ For informational purposes only. Please verify with a healthcare professional.'
    });

  } catch (err) {
    console.error("Overall /check route error:", err.message);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

module.exports = router;
