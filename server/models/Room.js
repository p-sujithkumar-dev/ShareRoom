const mongoose = require("mongoose");

const roomSchema = new mongoose.Schema({
    roomId: {
        type: String,
        required: true,
        unique: true
    },

    roomName: {
        type: String,
        default: "My Shared Room"
    },

    createdAt: {
        type: Date,
        default: Date.now
    },

    active: {
        type: Boolean,
        default: true
    }
});

module.exports = mongoose.model("Room", roomSchema);