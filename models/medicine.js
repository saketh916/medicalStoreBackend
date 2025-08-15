// backend/models/Medicine.js
const mongoose = require('mongoose');

const MedicineSchema = new mongoose.Schema({
  tabletName: { // This is the Brand Name
    type: String,
    required: [true, 'Tablet name is required'],
    trim: true,
    unique: true
  },
  quantityInStock: {
    type: Number,
    required: true,
    default: 0,
    min: [0, 'Quantity cannot be negative']
  },
  price: {
    type: Number,
    min: [0, 'Price cannot be negative'],
    required: true
  },
  dosageFrequency: { // e.g., "Every 6 hours", "8 hours gap", "Twice a day"
    type: String,
    trim: true
    // This field might be optional depending on the medicine
  },
  usageInstructions: { // e.g., "Take with food", "Dissolve in water before taking"
    type: String,
    trim: true
    // This field is optional
  },
  foodWarnings: { // e.g., "Avoid grapefruit juice", "Do not take with dairy"
    type: String,
    trim: true
    // This field is optional
  },
  // We should still keep a creation timestamp
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Medicine', MedicineSchema);