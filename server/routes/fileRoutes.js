
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { randomUUID } = require("crypto");

const File = require("../models/File");
const Room = require("../models/Room");

const router = express.Router();

const uploadDir = path.join(__dirname, "../uploads");

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },

    filename: (req, file, cb) => {
        cb(null, randomUUID());
    }
});

const upload = multer({
    storage,
    limits: {
        fileSize: 500 * 1024 * 1024
    }
});

// Preview-supported MIME types
const previewMimeTypes = [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/avif",
    "application/pdf",
    "video/mp4",
    "video/webm",
    "video/ogg"
];

// Upload file
router.post("/upload", upload.single("file"), async (req, res) => {
    try {
        const { roomId, uploadedBy } = req.body;

        if (!roomId || !req.file) {
            return res.status(400).json({
                message: "Room ID and file are required"
            });
        }

        const room = await Room.findOne({
            roomId: roomId.toUpperCase(),
            active: true
        });

        if (!room) {
            fs.unlinkSync(req.file.path);

            return res.status(404).json({
                message: "Room not found"
            });
        }

        const savedFile = await File.create({
            roomId: room.roomId,
            originalName: path.basename(req.file.originalname),
            storedName: req.file.filename,
            size: req.file.size,
            mimeType: req.file.mimetype,
            uploadedBy: uploadedBy || "Unknown Device"
        });

        const io = req.app.get("io");

        io.to(room.roomId).emit("file-shared", savedFile);

        res.status(201).json({
            success: true,
            message: "File uploaded successfully",
            file: savedFile
        });

    } catch (error) {
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        res.status(500).json({
            message: error.message
        });
    }
});

// Get room files
router.get("/room/:roomId", async (req, res) => {
    try {
        const roomId = req.params.roomId.toUpperCase();

        const room = await Room.findOne({
            roomId,
            active: true
        });

        if (!room) {
            return res.status(404).json({
                message: "Room not found"
            });
        }

        const files = await File.find({ roomId })
            .sort({ uploadedAt: -1 });

        res.json({
            success: true,
            files
        });

    } catch (error) {
        res.status(500).json({
            message: error.message
        });
    }
});

// Preview file
router.get("/preview/:id", async (req, res) => {
    try {
        const file = await File.findById(req.params.id);

        if (!file) {
            return res.status(404).json({
                message: "File not found"
            });
        }

        // Only allow safe preview formats
        if (!previewMimeTypes.includes(file.mimeType)) {
            return res.status(415).json({
                message: "Preview is not supported for this file type"
            });
        }

        const filePath = path.join(uploadDir, file.storedName);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({
                message: "Physical file not found"
            });
        }

        res.setHeader("Content-Type", file.mimeType);
        res.setHeader("Content-Disposition", "inline");
        res.setHeader("X-Content-Type-Options", "nosniff");

        res.sendFile(filePath);

    } catch (error) {
        res.status(500).json({
            message: error.message
        });
    }
});

// Download file
router.get("/download/:id", async (req, res) => {
    try {
        const file = await File.findById(req.params.id);

        if (!file) {
            return res.status(404).json({
                message: "File not found"
            });
        }

        const filePath = path.join(uploadDir, file.storedName);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({
                message: "Physical file not found"
            });
        }

        res.download(filePath, file.originalName);

    } catch (error) {
        res.status(500).json({
            message: error.message
        });
    }
});

module.exports = router;
