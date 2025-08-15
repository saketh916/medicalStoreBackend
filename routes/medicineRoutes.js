const express = require('express');
const router = express.Router();
const axios = require('axios');
const Fuse = require('fuse.js');
const Medicine = require('../models/medicine');
const { GoogleGenerativeAI } = require('@google/generative-ai'); // Import Google's GenAI library

// Ensure your .env file has GOOGLE_API_KEY=YOUR_API_KEY
// In your main server.js or app.js, make sure to call: require('dotenv').config();

// Initialize Google Generative AI client
// Access your API key as an environment variable (recommended)
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

// Route to add new medicine (remains the same)
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

    medicine = new Medicine({ tabletName, quantityInStock, price, dosageFrequency, usageInstructions, foodWarnings });
    await medicine.save();
    res.status(201).json({ msg: `'${tabletName}' added.`, medicine });

  } catch (err) {
    console.error(err.message);
    if (err.code === 11000) {
      return res.status(400).json({ msg: `Medicine '${req.body.tabletName}' already exists.` });
    }
    res.status(500).send('Server Error');
  }
});

// Route to check medicine or find alternatives using Google Gemini
router.get('/check', async (req, res) => {
  const { name, model } = req.query; // Destructure `model` from query parameters

  if (!name) {
    return res.status(400).json({ error: 'Medicine name query parameter is required' });
  }

  try {
    // Step 1: Check for exact local stock match
    let localMedicine = await Medicine.findOne({
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

    // Step 2: Fuzzy search for local alternatives
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

    // Step 3: Query Google Gemini for therapeutic alternatives
    console.log(`'${name}' not in local stock. Querying Google Gemini for alternatives...`);
    let geminiAlternatives = [];

    const modelToUse = model || "gemini-2.5-flash-lite-preview-06-17"; // Use the provided model, or default to the specified Gemini model

    // Validate the model name if you have a fixed set of allowed models
    const allowedGeminiModels = ["gemini-2.5-flash-lite-preview-06-17", "gemini-1.5-pro", "gemini-1.5-flash"]; // Add other Gemini models you might support
    if (!allowedGeminiModels.includes(modelToUse)) {
      return res.status(400).json({ error: `Invalid Gemini model specified. Supported models are: ${allowedGeminiModels.join(', ')}` });
    }


    try {
      const geminiModel = genAI.getGenerativeModel({ model: modelToUse });

      const result = await geminiModel.generateContent({
        contents: [{ role: "user", parts: [{ text: `What are some common therapeutic alternatives or generic equivalents for the medicine "${name}"? Please list up to 3 names, without providing dosages or instructions, and only provide the names in a comma-separated list. If you cannot find any, say "None".` }] }],
        generationConfig: {
          maxOutputTokens: 100, // Limit the response length
          temperature: 0.2, // Keep it low for more factual/less creative responses
        },
        safetySettings: [ // Recommended for production to filter harmful content
          {
            category: "HARM_CATEGORY_HARASSMENT",
            threshold: "BLOCK_MEDIUM_AND_ABOVE",
          },
          {
            category: "HARM_CATEGORY_HATE_SPEECH",
            threshold: "BLOCK_MEDIUM_AND_ABOVE",
          },
          {
            category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
            threshold: "BLOCK_MEDIUM_AND_ABOVE",
          },
          {
            category: "HARM_CATEGORY_DANGEROUS_CONTENT",
            threshold: "BLOCK_MEDIUM_AND_ABOVE",
          },
        ],
      });

      const rawGeminiResponse = result.response.text();
      console.log("Raw Gemini Response:", rawGeminiResponse);

      // Attempt to parse the comma-separated list
      if (rawGeminiResponse && rawGeminiResponse.toLowerCase() !== "none") {
        geminiAlternatives = rawGeminiResponse.split(',').map(alt => alt.trim()).filter(Boolean); // Filter out empty strings
      }

    } catch (apiError) {
      console.error("Google Gemini API fetch error:", apiError.message);
      // Log more details for debugging if needed:
      // console.error("Google Gemini API Error Details:", apiError.response ? apiError.response.data : apiError);
      return res.status(502).json({ error: 'Error communicating with Google Gemini API.' });
    }

    const top3GeminiAlternatives = geminiAlternatives.slice(0, 3);

    console.log(`Google Gemini suggested alternatives (top 3): ${top3GeminiAlternatives.join(', ') || 'None'}`);

    // Step 4: Check local stock for Gemini alternatives
    if (top3GeminiAlternatives.length > 0) {
      for (const altName of top3GeminiAlternatives) {
        console.log(`Checking local stock for Google Gemini alternative: ${altName}`);
        const alternativeInStock = await Medicine.findOne({
          tabletName: new RegExp(`^${altName}$`, 'i'),
          quantityInStock: { $gt: 0 }
        });

        if (alternativeInStock) {
          return res.json({
            status: 'alternative_available_locally',
            message: `'${name}' is not available, but this Google Gemini-suggested alternative is in stock. **Disclaimer: This suggestion is for informational purposes only and should be confirmed by a healthcare professional.**`,
            data: alternativeInStock
          });
        }
      }
    }

    // Step 5: No alternatives found in stock or from Google Gemini
    return res.json({
      status: 'not_available_locally_and_no_stocked_alternatives',
      message: `'${name}' is not in local stock. Google Gemini alternatives were checked, but none are currently in our stock. **Disclaimer: This information is for informational purposes only and should be confirmed by a healthcare professional.**`,
      geminiSuggestions: top3GeminiAlternatives
    });

  } catch (err) {
    console.error("Overall error in /check route:", err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;