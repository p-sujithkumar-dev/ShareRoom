const mongoose = require("mongoose");

const fileSchema = new mongoose.Schema({
    roomId: {
        type: String,
        required: true
    },

    originalName: {
        type: String,
        required: true
    },

    storedName: {
        type: String,
        required: true
    },

    size: {
        type: Number,
        required: true
    },

    mimeType: {
        type: String
    },

    uploadedBy: {
        type: String,
        default: "Unknown Device"
    },

    uploadedAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model("File", fileSchema);