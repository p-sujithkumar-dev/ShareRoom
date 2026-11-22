const express = require("express");
const { randomBytes } = require("crypto");
const Room = require("../models/Room");

const router = express.Router();

// Create room
router.post("/create", async (req, res) => {
    try {
        let roomId;
        let exists = true;

        while (exists) {
            roomId = randomBytes(4).toString("hex").toUpperCase();
            exists = await Room.exists({ roomId });
        }

        const room = await Room.create({
            roomId,
            roomName: req.body.roomName || "My Shared Room"
        });

        res.status(201).json({
            success: true,
            message: "Room created successfully",
            room
        });

    } catch (error) {
        res.status(500).json({
            message: error.message
        });
    }
});

// Join room
router.get("/join/:roomId", async (req, res) => {
    try {
        const room = await Room.findOne({
            roomId: req.params.roomId.toUpperCase(),
            active: true
        });

        if (!room) {
            return res.status(404).json({
                message: "Room not found"
            });
        }

        res.json({
            success: true,
            room
        });

    } catch (error) {
        res.status(500).json({
            message: error.message
        });
    }
});

module.exports = router;